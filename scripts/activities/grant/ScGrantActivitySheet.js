import { Constants } from "../../constants/Constants.js";
import { ScGrantActivityService } from "./ScGrantActivityService.js";
import { ScGrantEntryHelpers } from "./ScGrantEntryHelpers.js";

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
        return {
          index,
          type: entry.type,
          uuid: entry.uuid,
          quantity: entry.quantity,
          name: document?.name ?? entry.uuid,
          img: document?.img ?? (isTable ? "icons/svg/d20-grey.svg" : "icons/svg/hazard.svg"),
          isTable,
          typeLabel: game.i18n.localize(isTable
            ? "SCMOREACTIVITIES.Activities.ScGrant.Fields.Source.TypeTable"
            : "SCMOREACTIVITIES.Activities.ScGrant.Fields.Source.TypeItem"),
          missing: Boolean(entry.uuid) && !document
        };
      })
    );

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

  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    const rawGrants = foundry.utils.getProperty(submitData, "grants");
    foundry.utils.setProperty(submitData, "grants", this.#normalizeGrantSubmitData(rawGrants));

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

    this.element.querySelector("[data-action='toggle-check-tray']")?.addEventListener("click", (event) => {
      event.preventDefault();
      const tray = this.element.querySelector("[data-grant-check-tray]");
      if (!tray) {
        return;
      }
      tray.classList.toggle("collapsed");
      this.#checkTrayExpanded = !tray.classList.contains("collapsed");
    });
  }

  #cloneGrants() {
    return (this.activity?.grants ?? []).map((entry) => ScGrantEntryHelpers.normalizeEntry(entry));
  }

  #bindListDrop(listElement) {
    listElement.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    listElement.addEventListener("drop", async(event) => {
      if (event.target?.closest?.("[data-grant-drop]")) {
        return;
      }
      event.preventDefault();
      const data = TextEditor.getDragEventData(event);
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
      const data = TextEditor.getDragEventData(event);
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
      const normalized = ScGrantEntryHelpers.normalizeEntry(entry);
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
