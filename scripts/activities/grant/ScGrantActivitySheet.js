import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScGrantActivityService } from "./ScGrantActivityService.js";
import { ScGrantBastionOrders } from "./ScGrantBastionOrders.js";
import { ScGrantEntryHelpers } from "./ScGrantEntryHelpers.js";
import { ScGrantTableResults } from "./ScGrantTableResults.js";

const SHOWN_ISSUES = 4;
const ISSUE_KEYS = Object.freeze({
  [ScGrantTableResults.CODES.EMPTY]: "Empty",
  [ScGrantTableResults.CODES.EXHAUSTED]: "Exhausted",
  [ScGrantTableResults.CODES.NOT_ITEM]: "NotItem",
  [ScGrantTableResults.CODES.MISSING]: "Missing",
  [ScGrantTableResults.CODES.TOO_DEEP]: "TooDeep",
  [ScGrantTableResults.CODES.CYCLE]: "Cycle"
});

export class ScGrantActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--grant"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-grant-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  #checkTrayExpanded = null;
  #bastionTrayExpanded = null;
  #advancedTrayExpanded = null;

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.recipient = this.activity?.recipient ?? "self";
    context.recipientOptions = [
      {
        value: "self",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Recipient.Choices.Self")
      },
      {
        value: "target",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Recipient.Choices.Target")
      }
    ];

    context.grants = await Promise.all(
      (this.activity?.grants ?? []).map(async(rawEntry, index) => {
        const entry = ScGrantEntryHelpers.normalizeEntry(rawEntry);
        let document = null;
        try {
          document = entry.uuid ? await fromUuid(entry.uuid) : null;
        } catch {
          document = null;
        }

        const isTable = entry.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE;
        const missing = Boolean(entry.uuid) && !document;
        const validation = isTable && document ? await ScGrantActivitySheet.#validateTable(document) : null;
        return {
          index,
          type: entry.type,
          uuid: entry.uuid,
          quantity: entry.quantity,
          cost: entry.cost,
          name: document?.name ?? entry.uuid,
          img: document?.img ?? (isTable ? "icons/svg/d20-grey.svg" : "icons/svg/hazard.svg"),
          isTable,
          typeIcon: isTable ? "fa-solid fa-table-list" : "fa-solid fa-box",
          typeLabel: game.i18n.localize(isTable
            ? "SCMOREACTIVITIES.Activities.ScGrant.Fields.Source.TypeTable"
            : "SCMOREACTIVITIES.Activities.ScGrant.Fields.Source.TypeItem"),
          quantityLabel: game.i18n.localize(isTable
            ? "SCMOREACTIVITIES.Activities.ScGrant.Fields.Quantity.Draws"
            : "SCMOREACTIVITIES.Activities.ScGrant.Fields.Quantity.Label"),
          missing,
          status: missing ? "invalid" : (validation?.status ?? "valid"),
          validation
        };
      })
    );
    context.invalidSourceCount = context.grants.filter((entry) => entry.status === "invalid").length;
    context.invalidSourceBadge = context.invalidSourceCount
      ? game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Validation.InvalidBadge", { count: context.invalidSourceCount })
      : "";

    this.#prepareSelectionContext(context);
    await this.#prepareBastionContext(context);

    context.itemFlags = this.#cloneItemFlags().map((row, index) => ({
      index,
      ...row,
      invalid: Boolean(row.key.trim()) && !ScGrantEntryHelpers.isValidItemFlagKey(row.key)
    }));
    context.advancedTrayExpanded = this.#advancedTrayExpanded ?? context.itemFlags.length > 0;

    context.check = ScGrantEntryHelpers.normalizeCheck(this.activity?.check);
    context.checkEnabled = ScGrantEntryHelpers.isCheckEnabled(context.check);
    context.checkTrayExpanded = this.#checkTrayExpanded ?? context.checkEnabled;
    context.showDcFormula = !context.check.dc.calculation;

    const abilities = Object.entries(CONFIG.DND5E?.abilities ?? {}).map(([value, config]) => ({
      value,
      label: config?.label ?? value
    }));
    const abilityLabel = (key) => CONFIG.DND5E?.abilities?.[key]?.label ?? key;
    const abilityGroup = game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Check.Kind.GroupAbilities");
    const skillGroup = game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Check.Kind.GroupSkills");

    context.checkSelection = context.check.skill
      ? `skill:${context.check.skill}`
      : (context.check.ability ? `ability:${context.check.ability}` : "");
    context.checkKindOptions = [
      { value: "", label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Check.Kind.None") },
      ...abilities.map(({ value, label }) => ({
        value: `ability:${value}`,
        label,
        group: abilityGroup
      })),
      ...Object.entries(CONFIG.DND5E?.skills ?? {}).map(([value, config]) => ({
        value: `skill:${value}`,
        label: `${config?.label ?? value} (${abilityLabel(config?.ability)})`,
        group: skillGroup
      }))
    ];

    context.checkCalculationOptions = [
      { value: "", label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Check.DC.CustomFormula") },
      { value: "spellcasting", label: game.i18n.localize("DND5E.SpellAbility") },
      ...abilities
    ];

    const dcActor = this.activity?.actor ?? this.activity?.item?.actor ?? null;
    if (context.check.dc.calculation && dcActor) {
      const dc = await ScGrantActivityService.resolveCheckDc(this.activity, context.check);
      context.dcPreview = game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Fields.Check.DC.Preview", { dc });
    } else {
      context.dcPreview = game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Check.DC.FromAbility");
    }

    return context;
  }

  /**
   * What the sheet shows about a table source: a summary of what it can grant
   * when it works, or the reasons some of its results grant nothing.
   */
  static async #validateTable(table) {
    let report;
    try {
      report = await ScGrantTableResults.inspect(table, { resolve: ScGrantTableResults.lookup });
    } catch (error) {
      Logger.warn("Could not validate a grant roll table.", error);
      return null;
    }

    const summary = report.depth > 1
      ? game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Validation.SummaryNested", {
        items: report.itemCount, tables: report.tableCount, depth: report.depth
      })
      : game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Validation.Summary", { items: report.itemCount });
    const messages = report.issues.slice(0, SHOWN_ISSUES).map((issue) => ({
      level: issue.level,
      text: game.i18n.format(`SCMOREACTIVITIES.Activities.ScGrant.Validation.Issue.${ISSUE_KEYS[issue.code]}`, {
        table: issue.table ?? "",
        result: issue.result ?? "",
        inner: issue.inner ?? "",
        max: issue.max ?? ScGrantTableResults.MAX_DEPTH
      })
    }));
    if (report.issues.length > SHOWN_ISSUES) {
      messages.push({
        level: "more",
        text: game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Validation.More", {
          count: report.issues.length - SHOWN_ISSUES
        })
      });
    }

    const titleKey = report.status === "invalid" ? "InvalidTitle" : "WarningTitle";
    return {
      status: report.status,
      summary,
      title: report.issues.length ? game.i18n.localize(`SCMOREACTIVITIES.Activities.ScGrant.Validation.${titleKey}`) : "",
      messages,
      statusIcon: {
        valid: "fa-solid fa-circle-check",
        warning: "fa-solid fa-triangle-exclamation",
        invalid: "fa-solid fa-circle-xmark"
      }[report.status]
    };
  }

  #prepareSelectionContext(context) {
    const { CHOOSE, ALL, BUDGET } = ScGrantEntryHelpers.SELECTION_MODES;
    const selection = ScGrantEntryHelpers.normalizeSelection(this.activity?.selection);
    const sourceCount = context.grants.filter((entry) => entry.uuid).length;
    context.selection = selection;
    context.isChoose = selection.mode === CHOOSE;
    context.isBudget = selection.mode === BUDGET;
    context.selectionModeOptions = [
      { value: ALL, icon: "fa-solid fa-boxes-stacked", key: "All" },
      { value: CHOOSE, icon: "fa-solid fa-hand-pointer", key: "Choose" },
      { value: BUDGET, icon: "fa-solid fa-scale-balanced", key: "Budget" }
    ].map(({ value, icon, key }) => ({
      value,
      icon,
      selected: selection.mode === value,
      label: game.i18n.localize(`SCMOREACTIVITIES.Activities.ScGrant.Fields.Selection.Choices.${key}`)
    }));
    const hintKey = { [ALL]: "All", [CHOOSE]: "Choose", [BUDGET]: "Budget" }[selection.mode];
    context.selectionHint = game.i18n.format(
      `SCMOREACTIVITIES.Activities.ScGrant.Fields.Selection.Hint${hintKey}`,
      { count: selection.count, budget: selection.budget }
    );
    context.selectionBadge = "";
    if (context.isChoose && sourceCount) {
      context.selectionBadge = game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Fields.Selection.Badge", {
        count: Math.min(selection.count, sourceCount),
        total: sourceCount
      });
    } else if (context.isBudget) {
      context.selectionBadge = game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Fields.Selection.BudgetBadge", {
        budget: selection.budget
      });
    }
  }

  async #prepareBastionContext(context) {
    const item = this.activity?.item ?? null;
    context.isFacility = ScGrantBastionOrders.isFacility(item);
    if (!context.isFacility) {
      return;
    }

    const { BASTION, INSTANT } = ScGrantEntryHelpers.DELIVERY_MODES;
    const delivery = ScGrantEntryHelpers.normalizeDelivery(this.activity?.delivery);
    context.delivery = delivery;
    context.bastionEnabled = delivery === BASTION;
    context.bastion = ScGrantEntryHelpers.normalizeBastion(this.activity?.bastion);
    context.bastionTrayExpanded = this.#bastionTrayExpanded ?? context.bastionEnabled;
    context.deliveryOptions = [
      { value: INSTANT, label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Delivery.Choices.Instant") },
      { value: BASTION, label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Delivery.Choices.Bastion") }
    ];
    context.bastionOrderOptions = ScGrantEntryHelpers.BASTION_ORDERS.map((value) => ({
      value,
      label: ScGrantBastionOrders.orderLabel(value)
    }));

    const pending = ScGrantBastionOrders.pendingOf(item);
    // An undelivered order shows in every grant of the facility, so it stays
    // recoverable when the activity that issued it was deleted.
    if (!pending || (pending.activityId !== this.activity?.id && !ScGrantBastionOrders.awaitsDelivery(pending))) {
      context.bastionStatus = null;
      return;
    }
    const progress = item.system?.progress ?? {};
    const sources = await Promise.all((pending.entries ?? []).map(async(entry) => {
      const document = await fromUuid(entry.uuid).catch(() => null);
      return `${entry.quantity}× ${document?.name ?? entry.uuid}`;
    }));
    const undelivered = ScGrantBastionOrders.awaitsDelivery(pending);
    const orderLabel = ScGrantBastionOrders.orderLabel(pending.order);
    context.bastionStatus = {
      undelivered,
      canResolve: ScGrantBastionOrders.isResolver() && ScGrantBastionOrders.canResolve(item, pending),
      label: undelivered
        ? game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Bastion.Undelivered", {
          order: orderLabel,
          reason: ScGrantBastionOrders.reasonLabel(pending)
        })
        : game.i18n.format("SCMOREACTIVITIES.Activities.ScGrant.Bastion.Status", {
          order: orderLabel,
          value: Number(progress.value) || 0,
          max: Number(progress.max) || 0
        }),
      pct: undelivered ? 100 : Number(progress.pct) || 0,
      sources: sources.join(", ")
    };
    // An undelivered order needs the GM's attention, so its tray opens.
    if (undelivered && this.#bastionTrayExpanded === null) {
      context.bastionTrayExpanded = true;
    }
  }

  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    const rawGrants = foundry.utils.getProperty(submitData, "grants");
    foundry.utils.setProperty(submitData, "grants", this.#normalizeGrantSubmitData(rawGrants));
    const rawItemFlags = foundry.utils.getProperty(submitData, "itemFlags");
    foundry.utils.setProperty(submitData, "itemFlags", rawItemFlags
      ? ScGrantActivitySheet.#indexedRows(rawItemFlags).map((row) => ({
        key: String(row?.key ?? "").trim(),
        value: String(row?.value ?? "")
      }))
      : this.#cloneItemFlags());

    const selection = foundry.utils.getProperty(submitData, "checkSelection");
    if (selection !== undefined) {
      delete submitData.checkSelection;
      let ability = "";
      let skill = "";
      if (String(selection).startsWith("ability:")) {
        ability = String(selection).slice("ability:".length);
      } else if (String(selection).startsWith("skill:")) {
        skill = String(selection).slice("skill:".length);
        ability = CONFIG.DND5E?.skills?.[skill]?.ability ?? "";
      }
      foundry.utils.setProperty(submitData, "check.ability", ability);
      foundry.utils.setProperty(submitData, "check.skill", skill);
    }
    return submitData;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const listElement = this.element.querySelector("[data-grant-list]");
    if (listElement) {
      this.#bindListDrop(listElement);
    }

    this.element.querySelector("[data-action='add-grant']")?.addEventListener("click", async(event) => {
      event.preventDefault();
      const grants = this.#cloneGrants();
      grants.push({ type: ScGrantEntryHelpers.SOURCE_TYPES.ITEM, uuid: "", quantity: "1" });
      await this.activity.update({ grants });
      this.render();
    });

    this.element.querySelectorAll("[data-action='remove-grant']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        if (!Number.isInteger(index)) {
          return;
        }
        const grants = this.#cloneGrants();
        grants.splice(index, 1);
        await this.activity.update({ grants });
        this.render();
      });
    });

    this.element.querySelectorAll("[data-grant-drop]").forEach((input) => {
      this.#bindRowInput(input);
    });

    this.element.querySelectorAll("[data-action='open-grant-source']").forEach((element) => {
      element.addEventListener("click", async(event) => {
        event.preventDefault();
        const document = await fromUuid(element.dataset.uuid).catch(() => null);
        document?.sheet?.render(true);
      });
    });

    this.element.querySelector("[data-action='toggle-check-tray']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.#checkTrayExpanded = this.#toggleTray("[data-grant-check-tray]") ?? this.#checkTrayExpanded;
    });

    this.element.querySelector("[data-action='toggle-advanced-tray']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.#advancedTrayExpanded = this.#toggleTray("[data-grant-advanced-tray]") ?? this.#advancedTrayExpanded;
    });

    this.element.querySelector("[data-action='add-item-flag']")?.addEventListener("click", async(event) => {
      event.preventDefault();
      this.#advancedTrayExpanded = true;
      await this.activity.update({ itemFlags: [...this.#cloneItemFlags(), { key: "", value: "" }] });
      this.render();
    });

    this.element.querySelectorAll("[data-action='remove-item-flag']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        if (!Number.isInteger(index)) {
          return;
        }
        const itemFlags = this.#cloneItemFlags();
        itemFlags.splice(index, 1);
        await this.activity.update({ itemFlags });
        this.render();
      });
    });

    this.element.querySelector("[data-action='toggle-bastion-tray']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.#bastionTrayExpanded = this.#toggleTray("[data-grant-bastion-tray]") ?? this.#bastionTrayExpanded;
    });

    this.element.querySelector("[data-action='retry-bastion-delivery']")?.addEventListener("click", async(event) => {
      event.preventDefault();
      event.currentTarget.disabled = true;
      await ScGrantBastionOrders.retry(this.activity.item);
      this.render();
    });

    this.element.querySelector("[data-action='discard-bastion-delivery']")?.addEventListener("click", async(event) => {
      event.preventDefault();
      if (await ScGrantBastionOrders.confirmDiscard()) {
        await ScGrantBastionOrders.discard(this.activity.item);
        this.render();
      }
    });
  }

  /** Flips a collapsible tray and returns whether it is now expanded, or `null` without one. */
  #toggleTray(selector) {
    const tray = this.element.querySelector(selector);
    if (!tray) {
      return null;
    }
    tray.classList.toggle("collapsed");
    return !tray.classList.contains("collapsed");
  }

  #cloneItemFlags() {
    return (this.activity?.itemFlags ?? []).map((row) => ({
      key: String(row?.key ?? ""),
      value: String(row?.value ?? "")
    }));
  }

  /** Form rows submitted as `{ 0: {...}, 1: {...} }` (or an array), in index order. */
  static #indexedRows(raw) {
    return Array.isArray(raw)
      ? raw
      : Object.entries(raw).sort(([left], [right]) => Number(left) - Number(right)).map(([, value]) => value);
  }

  #cloneGrants() {
    return (this.activity?.grants ?? []).map((entry) => ScGrantEntryHelpers.normalizeEntry(entry));
  }

  #bindListDrop(listElement) {
    let depth = 0;
    const highlight = (on) => listElement.classList.toggle("is-dragover", on);
    listElement.addEventListener("dragenter", () => {
      depth += 1;
      highlight(true);
    });
    listElement.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) {
        highlight(false);
      }
    });
    listElement.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    // Captured, so a drop a row input handles (and stops) still clears the highlight.
    listElement.addEventListener("drop", () => {
      depth = 0;
      highlight(false);
    }, true);

    listElement.addEventListener("drop", async(event) => {
      if (event.target?.closest?.("[data-grant-drop]")) {
        return;
      }
      event.preventDefault();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const uuid = String(data?.uuid ?? "").trim();
      if (!uuid) {
        return;
      }
      await this.#addGrantSource(uuid);
    });
  }

  #bindRowInput(input) {
    input.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    input.addEventListener("drop", async(event) => {
      event.preventDefault();
      event.stopPropagation();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const uuid = String(data?.uuid ?? "").trim();
      if (!uuid) {
        return;
      }
      await this.#addGrantSource(uuid, Number(input.dataset.index));
    });

    input.addEventListener("keydown", async(event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      const uuid = String(input.value ?? "").trim();
      if (!uuid) {
        return;
      }
      await this.#addGrantSource(uuid, Number(input.dataset.index));
    });
  }

  async #addGrantSource(uuid, rowIndex = null) {
    const document = await fromUuid(uuid).catch(() => null);
    const documentName = document?.documentName ?? document?.constructor?.documentName ?? "";

    let type = null;
    if (documentName === "Item") {
      type = ScGrantEntryHelpers.SOURCE_TYPES.ITEM;
    } else if (documentName === "RollTable") {
      type = ScGrantEntryHelpers.SOURCE_TYPES.TABLE;
    }

    if (!type) {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Error.InvalidUuid",
        { uuid },
        `Invalid grant item UUID: ${uuid}`
      ));
      return;
    }

    const grants = this.#cloneGrants();
    if (type === ScGrantEntryHelpers.SOURCE_TYPES.ITEM
      && grants.some((entry, index) => entry.uuid === uuid && index !== rowIndex)) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.DuplicateItem",
        "This item is already in the granted items list."
      ));
      return;
    }

    if (Number.isInteger(rowIndex) && grants[rowIndex]) {
      grants[rowIndex] = { ...grants[rowIndex], type, uuid };
    } else {
      grants.push({ type, uuid, quantity: "1" });
    }

    await this.activity.update({ grants });
    this.render();
  }

  #normalizeGrantSubmitData(rawGrants) {
    if (!rawGrants) {
      return this.#cloneGrants();
    }

    const entries = Array.isArray(rawGrants)
      ? rawGrants
      : Object.entries(rawGrants)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, value]) => value);

    const previous = this.#cloneGrants();
    return entries.map((entry, index) => {
      // The weight input only renders in the budget mode; keep stored weights otherwise.
      const normalized = ScGrantEntryHelpers.normalizeEntry({
        cost: previous[index]?.cost,
        ...entry
      });
      normalized.quantity = this.#validateQuantityFormula(normalized.quantity, previous[index]?.quantity ?? "1");
      return normalized;
    });
  }

  #validateQuantityFormula(formula, fallback) {
    const RollClass = globalThis.Roll;
    if (typeof RollClass?.validate !== "function" || RollClass.validate(formula)) {
      return formula;
    }
    ui.notifications?.warn?.(Constants.format(
      "SCMOREACTIVITIES.Activities.ScGrant.Warning.InvalidQuantityFormula",
      { formula },
      `Invalid quantity formula "${formula}". Keeping the previous value.`
    ));
    return ScGrantEntryHelpers.normalizeQuantityFormula(fallback);
  }
}
