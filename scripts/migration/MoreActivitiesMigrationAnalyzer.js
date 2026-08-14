import { Constants } from "../constants/Constants.js";
import { Logger } from "../support/Logger.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";
import { LEGACY_MORE_ACTIVITIES_TYPES } from "./LegacyMoreActivities.js";
import { MoreActivitiesMigrationConverter } from "./MoreActivitiesMigrationConverter.js";
import { MoreActivitiesMigrationPackScanner } from "./MoreActivitiesMigrationPackScanner.js";

const UI_YIELD_INTERVAL = 150;

export class MoreActivitiesMigrationAnalyzer {
  async analyze({
    previewId = null,
    onProgress = null,
    includeCompendiums = null,
    includeExternalPacks = null
  } = {}) {
    const scanCompendiums = includeCompendiums ?? ModuleSettings.isMigrationCompendiumScanEnabled();
    const scanExternalPacks = includeExternalPacks ?? ModuleSettings.isMigrationExternalPackScanEnabled();
    const startedAt = MoreActivitiesMigrationAnalyzer.#now();

    const state = {
      entries: [],
      activitiesByType: Object.fromEntries(LEGACY_MORE_ACTIVITIES_TYPES.map((type) => [type, 0])),
      worldItems: 0,
      actorItems: 0,
      compendiumItems: 0,
      convertible: 0,
      blocked: 0,
      scannedWorldItems: 0,
      scannedActorItems: 0,
      scannedCompendiumItems: 0,
      scannedPacks: 0,
      lockedPacks: [],
      skippedExternalPacks: []
    };

    Logger.debug("Migration preview starting.", {
      previewId,
      scanCompendiums,
      scanExternalPacks,
      legacyModuleActive: game?.modules?.get?.("more-activities")?.active === true
    });

    await this.#scanWorldItems(state, { previewId, onProgress });
    await this.#scanActors(state, { previewId, onProgress });

    if (scanCompendiums) {
      await this.#scanCompendiums(state, {
        previewId,
        onProgress,
        includeExternalPacks: scanExternalPacks
      });
    } else {
      Logger.debug("Compendium scanning is disabled by setting; packs were not inspected.");
    }

    MoreActivitiesMigrationAnalyzer.#emitProgress(onProgress, {
      phase: "done",
      current: 1,
      total: 1,
      detail: ""
    });

    const durationMs = Math.round(MoreActivitiesMigrationAnalyzer.#now() - startedAt);
    const totalItems = state.worldItems + state.actorItems + state.compendiumItems;
    const totalScanned = state.scannedWorldItems + state.scannedActorItems + state.scannedCompendiumItems;

    Logger.info(
      `Migration preview finished in ${durationMs}ms: scanned ${totalScanned} item(s) across ${state.scannedPacks} compendium(s), `
      + `found ${totalItems} item(s) with legacy activities (${state.convertible} convertible, ${state.blocked} blocked).`
    );
    Logger.debug("Migration preview breakdown.", {
      previewId,
      scannedWorldItems: state.scannedWorldItems,
      scannedActorItems: state.scannedActorItems,
      scannedCompendiumItems: state.scannedCompendiumItems,
      scannedPacks: state.scannedPacks,
      worldItems: state.worldItems,
      actorItems: state.actorItems,
      compendiumItems: state.compendiumItems,
      activitiesByType: state.activitiesByType,
      lockedPacks: state.lockedPacks.map((pack) => pack.id),
      skippedExternalPacks: state.skippedExternalPacks.map((pack) => pack.id)
    });

    if (!totalItems) {
      Logger.info(
        "Migration preview found no legacy more-activities entries. "
        + `Compendium scanning was ${scanCompendiums ? "enabled" : "DISABLED"} and external (system/module) packs were `
        + `${scanExternalPacks ? "included" : "EXCLUDED"}.`
      );
    }

    return Object.freeze({
      previewId,
      generatedAt: new Date().toISOString(),
      durationMs,
      moduleVersion: game?.modules?.get?.(Constants.MODULE_ID)?.version ?? "0.0.0",
      moreActivitiesVersion: game?.modules?.get?.("more-activities")?.version ?? null,
      worldId: game?.world?.id ?? null,
      includeCompendiums: scanCompendiums,
      includeExternalPacks: scanExternalPacks,
      scannedWorldItems: state.scannedWorldItems,
      scannedActorItems: state.scannedActorItems,
      scannedCompendiumItems: state.scannedCompendiumItems,
      scannedPacks: state.scannedPacks,
      worldItems: state.worldItems,
      actorItems: state.actorItems,
      compendiumItems: state.compendiumItems,
      activitiesByType: state.activitiesByType,
      convertible: state.convertible,
      blocked: state.blocked,
      lockedPacks: Object.freeze([...state.lockedPacks]),
      skippedExternalPacks: Object.freeze([...state.skippedExternalPacks]),
      entries: Object.freeze(state.entries),
      warnings: Object.freeze(MoreActivitiesMigrationAnalyzer.#buildWarnings(state, { scanCompendiums }))
    });
  }

  async #scanWorldItems(state, { previewId, onProgress }) {
    const items = game?.items?.contents ?? [];
    Logger.debug(`Scanning ${items.length} world item(s).`);

    for (const [index, item] of items.entries()) {
      state.scannedWorldItems += 1;
      const entry = await this.#analyzeItem(item, { source: "world", previewId });
      if (entry) {
        state.worldItems += 1;
        MoreActivitiesMigrationAnalyzer.#pushEntry(state, entry);
      }

      MoreActivitiesMigrationAnalyzer.#emitProgress(onProgress, {
        phase: "world-items",
        current: index + 1,
        total: items.length,
        detail: item?.name ?? ""
      });
      await MoreActivitiesMigrationAnalyzer.#yieldToUi(index);
    }
  }

  async #scanActors(state, { previewId, onProgress }) {
    const actors = game?.actors?.contents ?? [];
    Logger.debug(`Scanning items on ${actors.length} world actor(s).`);

    for (const [index, actor] of actors.entries()) {
      for (const item of actor?.items?.contents ?? []) {
        state.scannedActorItems += 1;
        const entry = await this.#analyzeItem(item, { source: "actor", actor, previewId });
        if (entry) {
          state.actorItems += 1;
          MoreActivitiesMigrationAnalyzer.#pushEntry(state, entry);
        }
      }

      MoreActivitiesMigrationAnalyzer.#emitProgress(onProgress, {
        phase: "actor-items",
        current: index + 1,
        total: actors.length,
        detail: actor?.name ?? ""
      });
      await MoreActivitiesMigrationAnalyzer.#yieldToUi(index, 25);
    }
  }

  async #scanCompendiums(state, { previewId, onProgress, includeExternalPacks }) {
    const { packs, skippedExternalPacks } = MoreActivitiesMigrationPackScanner.collectPacks({ includeExternalPacks });
    state.skippedExternalPacks = skippedExternalPacks;

    Logger.debug(
      `Scanning ${packs.length} compendium pack(s); skipped ${skippedExternalPacks.length} external pack(s).`,
      { packs: packs.map((pack) => pack?.collection) }
    );

    for (const [index, pack] of packs.entries()) {
      const descriptor = MoreActivitiesMigrationPackScanner.describe(pack);
      MoreActivitiesMigrationAnalyzer.#emitProgress(onProgress, {
        phase: "compendiums",
        current: index,
        total: packs.length,
        detail: descriptor.label
      });

      const packStartedAt = MoreActivitiesMigrationAnalyzer.#now();
      let packEntries = 0;

      try {
        const loaded = await MoreActivitiesMigrationPackScanner.loadPackItems(pack);
        state.scannedPacks += 1;

        for (const { item, actor } of loaded) {
          state.scannedCompendiumItems += 1;
          const entry = await this.#analyzeItem(item, {
            source: "compendium",
            actor,
            previewId,
            pack: descriptor
          });
          if (entry) {
            state.compendiumItems += 1;
            packEntries += 1;
            MoreActivitiesMigrationAnalyzer.#pushEntry(state, entry);
          }
        }

        if (packEntries && descriptor.locked) {
          state.lockedPacks.push(descriptor);
        }

        Logger.debug(
          `Compendium "${descriptor.id}" scanned in ${Math.round(MoreActivitiesMigrationAnalyzer.#now() - packStartedAt)}ms: `
          + `${loaded.length} item(s), ${packEntries} with legacy activities.`
        );
      } catch (error) {
        Logger.error(`Failed to scan compendium "${descriptor.id}".`, error);
      }

      MoreActivitiesMigrationAnalyzer.#emitProgress(onProgress, {
        phase: "compendiums",
        current: index + 1,
        total: packs.length,
        detail: descriptor.label
      });
      await MoreActivitiesMigrationAnalyzer.#yieldToUi(index, 1);
    }
  }

  async #analyzeItem(item, { source, actor = null, previewId = null, pack = null } = {}) {
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

    Logger.debug(
      `Found ${legacyActivities.length} legacy activity entry(ies) on "${item?.name ?? item?.id}" (${item?.uuid ?? "no-uuid"}).`,
      { source, packId: pack?.id ?? null, types: legacyActivities.map((activity) => activity.legacyType) }
    );

    return Object.freeze({
      itemUuid: item?.uuid ?? null,
      itemId: item?.id ?? null,
      itemName: item?.name ?? "",
      itemType: item?.type ?? "",
      source,
      packId: pack?.id ?? null,
      packLabel: pack?.label ?? null,
      packLocked: pack?.locked === true,
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

  static #pushEntry(state, entry) {
    state.entries.push(entry);
    for (const activity of entry.activities) {
      state.activitiesByType[activity.legacyType] += 1;
      if (activity.convertible) {
        state.convertible += 1;
      } else {
        state.blocked += 1;
      }
    }
  }

  static #buildWarnings(state, { scanCompendiums }) {
    const warnings = [];

    if (game?.modules?.get?.("more-activities")?.active) {
      warnings.push(Constants.localize(
        "SCMOREACTIVITIES.Migration.Warning.LegacyModuleActive",
        "The legacy more-activities module is still active. Keep both modules enabled only during preview or migration."
      ));
    }

    if (!scanCompendiums) {
      warnings.push(Constants.localize(
        "SCMOREACTIVITIES.Migration.Warning.CompendiumScanDisabled",
        "Compendium scanning is disabled in the module settings, so packs were not inspected."
      ));
    }

    if (state.skippedExternalPacks.length) {
      warnings.push(Constants.format(
        "SCMOREACTIVITIES.Migration.Warning.ExternalPacksSkipped",
        { count: state.skippedExternalPacks.length },
        `${state.skippedExternalPacks.length} system/module compendium(s) were skipped. Enable "Include system and module compendiums" to scan them.`
      ));
    }

    if (state.lockedPacks.length) {
      const labels = state.lockedPacks.map((pack) => pack.label).join(", ");
      warnings.push(ModuleSettings.isMigrationPackUnlockEnabled()
        ? Constants.format(
          "SCMOREACTIVITIES.Migration.Warning.LockedPacksAutoUnlock",
          { packs: labels },
          `These compendiums are locked and will be unlocked automatically during apply, then re-locked: ${labels}.`
        )
        : Constants.format(
          "SCMOREACTIVITIES.Migration.Warning.LockedPacksManual",
          { packs: labels },
          `These compendiums are locked and automatic unlocking is disabled. Unlock them manually before applying: ${labels}.`
        ));
    }

    return warnings;
  }

  static #emitProgress(onProgress, payload) {
    if (typeof onProgress !== "function") {
      return;
    }

    try {
      onProgress(payload);
    } catch (error) {
      Logger.error("Migration progress callback failed.", error);
    }
  }

  static async #yieldToUi(index, interval = UI_YIELD_INTERVAL) {
    if (index % interval !== 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  static #now() {
    return typeof performance?.now === "function" ? performance.now() : Date.now();
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
