import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

export class ScGrantActivityService {
  static async execute(activity) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    if (!actor) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.MissingActor",
        "This grant activity needs an actor."
      ));
      return { canceled: true, reason: "missing-actor" };
    }

    if (!actor.isOwner) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.ActorPermission",
        "You do not have permission to grant items to this actor."
      ));
      return { canceled: true, reason: "actor-permission" };
    }

    const entries = ScGrantActivityService.#normalizeEntries(activity?.grants ?? []);
    if (!entries.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.MissingItems",
        "Add at least one granted item before using this activity."
      ));
      return { canceled: true, reason: "missing-items" };
    }

    try {
      const sources = await ScGrantActivityService.#resolveSources(entries);
      const createData = [];
      const quantityUpdates = [];
      let totalGranted = 0;

      for (const { entry, item } of sources) {
        const existingStack = ScGrantActivityService.#findExistingStack(actor, item, activity);
        const documents = ScGrantActivityService.#createDocumentsForEntry(entry, item, activity, existingStack);
        createData.push(...documents);
        if (existingStack && ScGrantActivityService.#supportsQuantity(existingStack.toObject())) {
          quantityUpdates.push({
            _id: existingStack.id,
            "system.quantity": (Number(existingStack.system?.quantity) || 0) + entry.quantity
          });
        }
        totalGranted += entry.quantity;
      }

      if (!createData.length && !quantityUpdates.length) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScGrant.Warning.MissingItems",
          "Add at least one granted item before using this activity."
        ));
        return { canceled: true, reason: "no-create-data" };
      }

      const updated = quantityUpdates.length
        ? await actor.updateEmbeddedDocuments("Item", quantityUpdates)
        : [];

      const created = createData.length
        ? await actor.createEmbeddedDocuments("Item", createData)
        : [];
      ui.notifications?.info?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Info.GrantedItems",
        { count: totalGranted, actor: actor.name ?? "" },
        `Granted ${totalGranted} item(s).`
      ));

      return {
        canceled: false,
        actor,
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

  static #normalizeEntries(entries = []) {
    return entries
      .map((entry) => ({
        uuid: String(entry?.uuid ?? "").trim(),
        quantity: Math.max(1, Number(entry?.quantity) || 1)
      }))
      .filter((entry) => entry.uuid);
  }

  static async #resolveSources(entries) {
    const resolved = [];
    for (const entry of entries) {
      const item = await fromUuid(entry.uuid);
      if (!item || !ScGrantActivityService.#isItemDocument(item)) {
        throw new Error(Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Error.InvalidUuid",
          { uuid: entry.uuid },
          `Invalid grant item UUID: ${entry.uuid}`
        ));
      }
      resolved.push({ entry, item });
    }
    return resolved;
  }

  static #isItemDocument(document) {
    return document?.documentName === "Item" || document?.constructor?.documentName === "Item";
  }

  static #createDocumentsForEntry(entry, sourceItem, activity, existingStack = null) {
    const baseData = sourceItem.toObject();
    delete baseData._id;

    const flags = foundry.utils.mergeObject(baseData.flags ?? {}, {
      [Constants.MODULE_ID]: {
        grantActivityId: activity?.id ?? null,
        grantSourceUuid: sourceItem.uuid ?? entry.uuid
      }
    }, { inplace: false });

    const quantity = Math.max(1, Number(entry.quantity) || 1);
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
