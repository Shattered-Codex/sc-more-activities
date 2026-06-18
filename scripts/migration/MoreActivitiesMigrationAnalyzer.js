import { Constants } from "../constants/Constants.js";
import { LEGACY_MORE_ACTIVITIES_TYPES } from "./LegacyMoreActivities.js";
import { MoreActivitiesMigrationConverter } from "./MoreActivitiesMigrationConverter.js";

export class MoreActivitiesMigrationAnalyzer {
  async analyze({ previewId = null } = {}) {
    const entries = [];
    const activitiesByType = Object.fromEntries(LEGACY_MORE_ACTIVITIES_TYPES.map((type) => [type, 0]));
    let worldItems = 0;
    let actorItems = 0;
    let convertible = 0;
    let blocked = 0;
    let scannedWorldItems = 0;
    let scannedActorItems = 0;

    for (const item of game?.items?.contents ?? []) {
      scannedWorldItems += 1;
      const entry = await this.#analyzeItem(item, { source: "world", previewId });
      if (!entry) {
        continue;
      }
      worldItems += 1;
      entries.push(entry);
      for (const activity of entry.activities) {
        activitiesByType[activity.legacyType] += 1;
        if (activity.convertible) {
          convertible += 1;
        } else {
          blocked += 1;
        }
      }
    }

    for (const actor of game?.actors?.contents ?? []) {
      for (const item of actor?.items?.contents ?? []) {
        scannedActorItems += 1;
        const entry = await this.#analyzeItem(item, {
          source: "actor",
          actor,
          previewId
        });
        if (!entry) {
          continue;
        }
        actorItems += 1;
        entries.push(entry);
        for (const activity of entry.activities) {
          activitiesByType[activity.legacyType] += 1;
          if (activity.convertible) {
            convertible += 1;
          } else {
            blocked += 1;
          }
        }
      }
    }

    const warnings = [];
    if (game?.modules?.get?.("more-activities")?.active) {
      warnings.push(Constants.localize(
        "SCMOREACTIVITIES.Migration.Warning.LegacyModuleActive",
        "The legacy more-activities module is still active. Keep both modules enabled only during preview or migration."
      ));
    }

    return Object.freeze({
      previewId,
      generatedAt: new Date().toISOString(),
      moduleVersion: game?.modules?.get?.(Constants.MODULE_ID)?.version ?? "0.0.0",
      moreActivitiesVersion: game?.modules?.get?.("more-activities")?.version ?? null,
      worldId: game?.world?.id ?? null,
      scannedWorldItems,
      scannedActorItems,
      worldItems,
      actorItems,
      activitiesByType,
      convertible,
      blocked,
      entries: Object.freeze(entries),
      warnings: Object.freeze(warnings)
    });
  }

  async #analyzeItem(item, { source, actor = null, previewId = null } = {}) {
    const activityMap = MoreActivitiesMigrationAnalyzer.#activityMap(item);
    const legacyActivities = [];
    for (const [activityId, activitySource] of Object.entries(activityMap)) {
      const legacyType = String(activitySource?.type ?? "").trim();
      if (!LEGACY_MORE_ACTIVITIES_TYPES.includes(legacyType)) {
        continue;
      }

      const context = await this.#buildContext(activitySource, item, previewId);
      const preview = MoreActivitiesMigrationConverter.preview(activitySource, context);
      legacyActivities.push(Object.freeze({
        activityId,
        activityName: String(activitySource?.name ?? activitySource?.label ?? activityId),
        legacyType,
        targetType: preview.targetType,
        convertible: preview.convertible === true,
        lossy: preview.lossy === true,
        reason: preview.reason ?? null,
        warnings: Object.freeze([...(preview.warnings ?? [])])
      }));
    }

    if (!legacyActivities.length) {
      return null;
    }

    return Object.freeze({
      itemUuid: item?.uuid ?? null,
      itemId: item?.id ?? null,
      itemName: item?.name ?? "",
      itemType: item?.type ?? "",
      source,
      actorUuid: actor?.uuid ?? item?.actor?.uuid ?? null,
      actorName: actor?.name ?? item?.actor?.name ?? null,
      legacyActivityCount: legacyActivities.length,
      activities: Object.freeze(legacyActivities)
    });
  }

  async #buildContext(activitySource, item, previewId) {
    const context = { previewId };
    if (String(activitySource?.type ?? "") === "advancement") {
      const sourceItemUuid = String(activitySource?.sourceItem ?? "").trim();
      if (sourceItemUuid && typeof globalThis.fromUuid === "function") {
        const sourceItem = await globalThis.fromUuid(sourceItemUuid).catch(() => null);
        context.sourceItemAdvancements = sourceItem?.system?.advancement ?? {};
      }
    }
    context.itemUuid = item?.uuid ?? null;
    return context;
  }

  static #activityMap(item) {
    const activities = item?.toObject?.()?.system?.activities ?? item?.system?.activities ?? {};
    if (Array.isArray(activities)) {
      return Object.fromEntries(activities.map((activity) => {
        const id = String(activity?._id ?? activity?.id ?? foundry.utils.randomID());
        return [id, activity];
      }));
    }
    return activities && typeof activities === "object" ? activities : {};
  }
}

