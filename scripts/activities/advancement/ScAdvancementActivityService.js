import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

export class ScAdvancementActivityService {
  static async execute(activity, results = {}) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    if (!actor) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.MissingActor",
        "This advancement activity needs an actor."
      ));
      return { canceled: true, reason: "missing-actor" };
    }

    if (!actor.isOwner) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.ActorPermission",
        "You do not have permission to trigger advancements for this actor."
      ));
      return { canceled: true, reason: "actor-permission" };
    }

    const sourceItemUuid = String(activity?.sourceItemUuid ?? "").trim();
    if (!sourceItemUuid) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.MissingSourceItem",
        "Select a source item with advancements before using this activity."
      ));
      return { canceled: true, reason: "missing-source-item" };
    }

    const selections = ScAdvancementActivityService.#normalizeSelections(activity?.selections ?? []);
    if (!selections.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.MissingSelections",
        "Select at least one advancement entry before using this activity."
      ));
      return { canceled: true, reason: "missing-selections" };
    }

    try {
      const sourceItem = await fromUuid(sourceItemUuid);
      if (!ScAdvancementActivityService.#isItemDocument(sourceItem)) {
        ui.notifications?.error?.(Constants.format(
          "SCMOREACTIVITIES.Activities.ScAdvancement.Error.InvalidSourceItem",
          { uuid: sourceItemUuid },
          `Invalid advancement source item UUID: ${sourceItemUuid}`
        ));
        return { canceled: true, reason: "invalid-source-item" };
      }

      const actorItem = ScAdvancementActivityService.#findActorItem(actor, sourceItem);
      if (!actorItem) {
        ui.notifications?.warn?.(Constants.format(
          "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.ActorMissingSourceItem",
          { item: sourceItem.name ?? "" },
          `The actor does not currently own the source item: ${sourceItem.name ?? ""}`
        ));
        return { canceled: true, reason: "actor-missing-source-item" };
      }

      const manager = new dnd5e.applications.advancement.AdvancementManager(actor, {});
      const clonedItem = manager.clone.items.get(actorItem.id);
      if (!clonedItem) {
        ui.notifications?.warn?.(Constants.format(
          "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.ActorMissingSourceItem",
          { item: actorItem.name ?? "" },
          `The actor does not currently own the source item: ${actorItem.name ?? ""}`
        ));
        return { canceled: true, reason: "missing-cloned-item" };
      }

      const flows = ScAdvancementActivityService.#buildFlows(clonedItem, selections);
      if (!flows.length) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.NoApplicableSelections",
          "No applicable advancement entries were found for this actor item."
        ));
        return { canceled: true, reason: "no-applicable-selections" };
      }

      flows.forEach((flow) => {
        manager.steps.push({ type: "forward", flow });
      });

      if (!manager.steps.length) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScAdvancement.Warning.NoApplicableSelections",
          "No applicable advancement entries were found for this actor item."
        ));
        return { canceled: true, reason: "no-manager-steps" };
      }

      results.advancementManager = manager;
      manager.render(true);

      return {
        canceled: false,
        actor,
        actorItem,
        manager
      };
    } catch (error) {
      Logger.error("Could not execute sc-advancement activity.", error);
      ui.notifications?.error?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScAdvancement.Error.ExecutionFailed",
        { error: error?.message ?? String(error) },
        `Could not trigger advancements: ${error?.message ?? String(error)}`
      ));
      return { canceled: true, error };
    }
  }

  static #normalizeSelections(selections = []) {
    const deduped = new Map();
    for (const selection of selections) {
      const advancementId = String(selection?.advancementId ?? "").trim();
      const level = Math.max(0, Math.floor(Number(selection?.level) || 0));
      if (!advancementId) {
        continue;
      }
      deduped.set(`${advancementId}:${level}`, { advancementId, level });
    }

    return Array.from(deduped.values()).sort((left, right) => {
      if (left.level !== right.level) {
        return left.level - right.level;
      }
      return left.advancementId.localeCompare(right.advancementId);
    });
  }

  static #isItemDocument(document) {
    return document?.documentName === "Item" || document?.constructor?.documentName === "Item";
  }

  static #findActorItem(actor, sourceItem) {
    return actor.items.find((item) => {
      const compendiumSource = item?._source?._stats?.compendiumSource ?? null;
      return item.id === sourceItem.id || compendiumSource === sourceItem.uuid;
    }) ?? null;
  }

  static #buildFlows(item, selections) {
    const flows = [];

    for (const selection of selections) {
      const advancement = item.advancement?.byId?.[selection.advancementId];
      if (!advancement?.levels?.includes(selection.level)) {
        continue;
      }

      const levelFlows = dnd5e.applications.advancement.AdvancementManager
        .flowsForLevel(item, selection.level)
        .filter((flow) => flow?.advancement?.id === selection.advancementId);
      flows.push(...levelFlows);
    }

    return flows;
  }
}
