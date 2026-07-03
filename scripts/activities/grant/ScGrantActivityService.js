import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScGrantEntryHelpers } from "./ScGrantEntryHelpers.js";

export class ScGrantActivityService {
  static async execute(activity) {
    const sourceActor = activity?.actor ?? activity?.item?.actor ?? null;
    if (!sourceActor) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.MissingActor",
        "This grant activity needs an actor."
      ));
      return { canceled: true, reason: "missing-actor" };
    }

    const recipientActor = ScGrantActivityService.#resolveRecipientActor(activity, sourceActor);
    if (!recipientActor) {
      return { canceled: true, reason: "missing-recipient" };
    }

    if (!recipientActor.isOwner) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.ActorPermission",
        "You do not have permission to grant items to this actor."
      ));
      return { canceled: true, reason: "recipient-permission" };
    }

    const entries = ScGrantEntryHelpers.normalizeEntries(activity?.grants ?? []);
    if (!entries.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.MissingItems",
        "Add at least one granted item before using this activity."
      ));
      return { canceled: true, reason: "missing-items" };
    }

    try {
      const check = ScGrantEntryHelpers.normalizeCheck(activity?.check);
      let checkInfo = null;
      if (ScGrantEntryHelpers.isCheckEnabled(check)) {
        const checkResult = await ScGrantActivityService.#performCheck(activity, recipientActor, check);
        if (checkResult.canceled) {
          return { canceled: true, reason: "check-canceled" };
        }
        if (!checkResult.passed) {
          ui.notifications?.info?.(Constants.format(
            "SCMOREACTIVITIES.Activities.ScGrant.Info.CheckFailed",
            { actor: recipientActor.name ?? "", dc: checkResult.dc },
            `${recipientActor.name ?? "The actor"} failed the check (DC ${checkResult.dc}). No items granted.`
          ));
          return { canceled: false, checkPassed: false, updated: [], created: [] };
        }
        checkInfo = {
          dc: checkResult.dc,
          total: Number(checkResult.roll?.total) || 0
        };
      }

      const rollData = activity?.getRollData?.() ?? sourceActor?.getRollData?.() ?? {};
      const { sources, lines, rolls } = await ScGrantActivityService.#resolveSources(entries, rollData);
      const createData = [];
      const quantityUpdates = [];
      let totalGranted = 0;

      for (const source of sources) {
        const existingStack = ScGrantActivityService.#findExistingStack(recipientActor, source.item, activity);
        const documents = ScGrantActivityService.#createDocumentsForEntry(source, activity, existingStack);
        createData.push(...documents);
        if (existingStack && ScGrantActivityService.#supportsQuantity(existingStack.toObject())) {
          quantityUpdates.push({
            _id: existingStack.id,
            "system.quantity": (Number(existingStack.system?.quantity) || 0) + source.quantity
          });
        }
        totalGranted += source.quantity;
      }

      if (!createData.length && !quantityUpdates.length) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScGrant.Warning.NoResolvedItems",
          "No valid items could be resolved for this grant activity."
        ));
        return { canceled: true, reason: "no-create-data" };
      }

      const updated = quantityUpdates.length
        ? await recipientActor.updateEmbeddedDocuments("Item", quantityUpdates)
        : [];

      const created = createData.length
        ? await recipientActor.createEmbeddedDocuments("Item", createData)
        : [];

      await ScGrantActivityService.#createChatCard(activity, recipientActor, lines, rolls, checkInfo);
      ui.notifications?.info?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Info.GrantedItems",
        { count: totalGranted, actor: recipientActor.name ?? "" },
        `Granted ${totalGranted} item(s).`
      ));

      return {
        canceled: false,
        checkPassed: true,
        actor: recipientActor,
        updated,
        created
      };
    } catch (error) {
      Logger.error("Could not execute sc-grant activity.", error);
      ui.notifications?.error?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Error.ExecutionFailed",
        { error: error?.message ?? String(error) },
        `Could not grant items: ${error?.message ?? String(error)}`
      ));
      return { canceled: true, error };
    }
  }

  static #resolveRecipientActor(activity, sourceActor) {
    const recipient = String(activity?.recipient ?? "self").trim().toLowerCase();
    if (recipient !== "target") {
      return sourceActor;
    }

    const targets = Array.from(game?.user?.targets ?? []);
    if (targets.length !== 1) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.TargetRequired",
        "Target exactly one token to receive granted items."
      ));
      return null;
    }

    const targetActor = targets[0]?.actor ?? null;
    if (!targetActor) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.TargetActorMissing",
        "The selected target token does not have a valid actor."
      ));
      return null;
    }

    return targetActor;
  }

  static async #performCheck(activity, actor, check) {
    const dc = await ScGrantActivityService.resolveCheckDc(activity, check);
    let rolls = null;

    if (check.skill && typeof actor?.rollSkill === "function") {
      rolls = await actor.rollSkill({
        skill: check.skill,
        ability: check.ability || undefined,
        target: dc
      }, {}, {});
    } else if (check.ability && typeof actor?.rollAbilityCheck === "function") {
      rolls = await actor.rollAbilityCheck({
        ability: check.ability,
        target: dc
      }, {}, {});
    } else {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.CheckUnavailable",
        "Could not roll the configured grant check."
      ));
      return { canceled: true };
    }

    const roll = ScGrantActivityService.#extractRoll(rolls);
    if (!roll) {
      return { canceled: true };
    }

    return {
      canceled: false,
      passed: (Number(roll.total) || 0) >= dc,
      dc,
      roll
    };
  }

  static async resolveCheckDc(activity, check) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const calculation = check.dc.calculation;

    let ability = "";
    if (calculation === "spellcasting") {
      ability = activity?.spellcastingAbility
        ?? actor?.system?.attributes?.spellcasting
        ?? "";
    } else if (calculation) {
      ability = calculation;
    }

    if (ability) {
      const abilityDc = Number(actor?.system?.abilities?.[ability]?.dc);
      if (Number.isFinite(abilityDc) && abilityDc > 0) {
        return abilityDc;
      }
      return 8 + (Number(actor?.system?.attributes?.prof) || 0);
    }

    const formula = check.dc.formula;
    if (formula) {
      const rollData = activity?.getRollData?.({ deterministic: true })
        ?? actor?.getRollData?.({ deterministic: true })
        ?? {};
      const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
      const value = typeof simplify === "function"
        ? simplify(formula, rollData)
        : Number(formula);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }

    return 10;
  }

  static #extractRoll(rolls) {
    if (!rolls) {
      return null;
    }
    if (Array.isArray(rolls)) {
      return rolls.find((roll) => Number.isFinite(Number(roll?.total))) ?? null;
    }
    return Number.isFinite(Number(rolls?.total)) ? rolls : null;
  }

  static async #resolveSources(entries, rollData) {
    const grouped = new Map();
    const lines = [];
    const rolls = [];
    const append = (item, quantity, tableUuid = null) => {
      const key = item.uuid ?? item.id;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        grouped.set(key, { item, quantity, tableUuid });
      }
    };

    for (const entry of entries) {
      const { quantity, roll } = await ScGrantActivityService.#rollQuantity(entry.quantity, rollData);
      if (roll) {
        rolls.push(roll);
      }

      if (entry.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE) {
        const table = await fromUuid(entry.uuid).catch(() => null);
        if (!table || table.documentName !== "RollTable") {
          ui.notifications?.warn?.(Constants.format(
            "SCMOREACTIVITIES.Activities.ScGrant.Warning.InvalidTable",
            { uuid: entry.uuid },
            `Invalid roll table UUID: ${entry.uuid}`
          ));
          continue;
        }
        const drawnItems = await ScGrantActivityService.#drawTableItems(table, quantity);
        const counts = new Map();
        for (const drawnItem of drawnItems) {
          append(drawnItem, 1, table.uuid);
          const key = drawnItem.uuid ?? drawnItem.id;
          const existing = counts.get(key);
          if (existing) {
            existing.quantity += 1;
          } else {
            counts.set(key, { uuid: drawnItem.uuid, name: drawnItem.name ?? "", quantity: 1 });
          }
        }
        lines.push({
          kind: "table",
          uuid: table.uuid,
          name: table.name ?? "",
          draws: quantity,
          formula: roll ? roll.formula : null,
          total: roll?.total ?? null,
          items: Array.from(counts.values())
        });
        continue;
      }

      const item = await fromUuid(entry.uuid).catch(() => null);
      if (!item || !ScGrantActivityService.#isItemDocument(item)) {
        throw new Error(Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Error.InvalidUuid",
          { uuid: entry.uuid },
          `Invalid grant item UUID: ${entry.uuid}`
        ));
      }
      append(item, quantity);
      lines.push({
        kind: "item",
        uuid: item.uuid,
        name: item.name ?? "",
        quantity,
        formula: roll ? roll.formula : null,
        total: roll?.total ?? null
      });
    }

    return { sources: Array.from(grouped.values()), lines, rolls };
  }

  static async #rollQuantity(formula, rollData) {
    const normalized = ScGrantEntryHelpers.normalizeQuantityFormula(formula);
    if (/^\d+$/.test(normalized)) {
      return { quantity: ScGrantEntryHelpers.coerceQuantity(normalized), roll: null };
    }
    try {
      const roll = new Roll(normalized, rollData);
      await roll.evaluate();
      return { quantity: ScGrantEntryHelpers.coerceQuantity(roll.total), roll };
    } catch {
      return { quantity: 1, roll: null };
    }
  }

  static async #createChatCard(activity, recipientActor, lines, rolls, checkInfo) {
    if (!lines.length) {
      return;
    }

    const rollSuffix = (line) => (line.formula
      ? ` <span class="sc-ma-grant-card-roll">(${line.formula} = ${line.total})</span>`
      : "");

    const listHtml = lines.map((line) => {
      if (line.kind === "table") {
        const children = line.items.length
          ? line.items.map((item) => `<li>${item.quantity} &times; @UUID[${item.uuid}]{${item.name}}</li>`).join("")
          : `<li>${Constants.localize(
            "SCMOREACTIVITIES.Activities.ScGrant.Card.TableEmpty",
            "No items drawn."
          )}</li>`;
        const drawsText = Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Card.TableDraws",
          { count: line.draws },
          `${line.draws} draw(s)`
        );
        return `<li>@UUID[${line.uuid}]{${line.name}} &mdash; ${drawsText}${rollSuffix(line)}<ul>${children}</ul></li>`;
      }
      return `<li>${line.quantity} &times; @UUID[${line.uuid}]{${line.name}}${rollSuffix(line)}</li>`;
    }).join("");

    const parts = [
      `<p class="sc-ma-grant-card-header">${Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Card.Received",
        { actor: recipientActor.name ?? "" },
        `${recipientActor.name ?? "The actor"} received:`
      )}</p>`
    ];
    if (checkInfo) {
      parts.push(`<p class="sc-ma-grant-card-check">${Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Card.CheckPassed",
        { dc: checkInfo.dc, total: checkInfo.total },
        `Check passed (DC ${checkInfo.dc}, rolled ${checkInfo.total}).`
      )}</p>`);
    }
    parts.push(`<ul class="sc-ma-grant-card-list">${listHtml}</ul>`);

    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: recipientActor }),
        content: `<div class="sc-ma-grant-card">${parts.join("")}</div>`,
        rolls
      });
    } catch (error) {
      Logger.warn("Could not create sc-grant chat card.", error);
    }
  }

  static async #drawTableItems(table, draws) {
    const { results } = await table.drawMany(draws, { displayChat: false });
    const items = [];
    let invalidCount = 0;

    for (const result of results ?? []) {
      const uuid = ScGrantActivityService.#resultDocumentUuid(result);
      const document = uuid ? await fromUuid(uuid).catch(() => null) : null;
      if (document && ScGrantActivityService.#isItemDocument(document)) {
        items.push(document);
      } else {
        invalidCount += 1;
      }
    }

    if (invalidCount > 0) {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.TableInvalidResults",
        { count: invalidCount, table: table.name ?? "" },
        `${invalidCount} result(s) from "${table.name ?? ""}" did not resolve to items and were ignored.`
      ));
    }

    return items;
  }

  static #resultDocumentUuid(result) {
    if (result?.documentUuid) {
      return String(result.documentUuid);
    }
    const collection = result?.documentCollection;
    const id = result?.documentId;
    if (!collection || !id) {
      return null;
    }
    const isPack = collection.includes(".");
    return isPack ? `Compendium.${collection}.Item.${id}` : `${collection}.${id}`;
  }

  static #isItemDocument(document) {
    return document?.documentName === "Item" || document?.constructor?.documentName === "Item";
  }

  static #createDocumentsForEntry(source, activity, existingStack = null) {
    const { item: sourceItem, quantity, tableUuid } = source;
    const baseData = sourceItem.toObject();
    delete baseData._id;

    const moduleFlags = {
      grantActivityId: activity?.id ?? null,
      grantSourceUuid: sourceItem.uuid ?? null
    };
    if (tableUuid) {
      moduleFlags.grantTableUuid = tableUuid;
    }
    const flags = foundry.utils.mergeObject(baseData.flags ?? {}, {
      [Constants.MODULE_ID]: moduleFlags
    }, { inplace: false });

    if (existingStack && ScGrantActivityService.#supportsQuantity(baseData)) {
      return [];
    }

    if (ScGrantActivityService.#supportsQuantity(baseData)) {
      baseData.system.quantity = quantity;
      baseData.flags = flags;
      return [baseData];
    }

    const documents = [];
    for (let index = 0; index < quantity; index += 1) {
      const clone = foundry.utils.deepClone(baseData);
      clone.flags = foundry.utils.deepClone(flags);
      documents.push(clone);
    }
    return documents;
  }

  static #supportsQuantity(itemData) {
    return typeof itemData?.system?.quantity === "number";
  }

  static #findExistingStack(actor, sourceItem, activity) {
    return actor.items.find((item) => {
      const sourceUuid = item.flags?.[Constants.MODULE_ID]?.grantSourceUuid;
      const activityId = item.flags?.[Constants.MODULE_ID]?.grantActivityId;
      const compendiumSource = item?._source?._stats?.compendiumSource ?? item?.system?._source?.compendiumSource ?? null;
      return ScGrantActivityService.#supportsQuantity(item.toObject())
        && (sourceUuid === sourceItem.uuid || compendiumSource === sourceItem.uuid)
        && (activityId === activity?.id || compendiumSource === sourceItem.uuid);
    }) ?? null;
  }
}
