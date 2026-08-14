import { Constants } from "../constants/Constants.js";
import { Logger } from "../support/Logger.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";
import { MoreActivitiesMigrationAnalyzer } from "./MoreActivitiesMigrationAnalyzer.js";
import { MoreActivitiesMigrationBackupService } from "./MoreActivitiesMigrationBackupService.js";
import { MoreActivitiesMigrationConverter } from "./MoreActivitiesMigrationConverter.js";
import { MoreActivitiesMigrationPackScanner } from "./MoreActivitiesMigrationPackScanner.js";

export class MoreActivitiesMigrationService {
  #analyzer;

  constructor({ analyzer = new MoreActivitiesMigrationAnalyzer() } = {}) {
    this.#analyzer = analyzer;
  }

  async previewMoreActivitiesMigration({ onProgress = null } = {}) {
    MoreActivitiesMigrationService.#assertGm();
    const previewId = foundry.utils.randomID();
    return this.#analyzer.analyze({ previewId, onProgress });
  }

  async migrateMoreActivities({ preview, onProgress = null } = {}) {
    MoreActivitiesMigrationService.#assertGm();
    if (!preview?.previewId || !Array.isArray(preview?.entries)) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Migration.Error.PreviewRequired",
        "Run a migration preview before applying changes."
      ));
    }

    Logger.info(`Applying more-activities migration for preview ${preview.previewId} (${preview.entries.length} item(s)).`);

    const backup = await MoreActivitiesMigrationBackupService.createBackup(preview);
    const report = {
      id: foundry.utils.randomID(),
      previewId: preview.previewId,
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      moduleVersion: game?.modules?.get?.(Constants.MODULE_ID)?.version ?? "0.0.0",
      moreActivitiesVersion: game?.modules?.get?.("more-activities")?.version ?? null,
      worldId: game?.world?.id ?? null,
      updatedItems: 0,
      restoredItems: 0,
      convertedActivities: 0,
      skippedActivities: 0,
      failedItems: 0,
      unlockedPacks: [],
      items: [],
      warnings: [...(preview.warnings ?? [])]
    };

    const packIds = MoreActivitiesMigrationService.#collectPackIds(preview.entries);
    const unlockedPackIds = await MoreActivitiesMigrationService.#unlockIfEnabled(packIds);
    report.unlockedPacks = [...unlockedPackIds];

    try {
      await this.#applyEntries(preview, report, onProgress);
    } finally {
      await MoreActivitiesMigrationPackScanner.relockPacks(unlockedPackIds);
    }

    Logger.info(
      `Migration apply finished: ${report.updatedItems} item(s) updated, ${report.convertedActivities} activity entries converted, `
      + `${report.skippedActivities} skipped, ${report.failedItems} failed.`
    );

    return Object.freeze(report);
  }

  async #applyEntries(preview, report, onProgress) {
    const entries = preview.entries ?? [];

    for (const [index, entry] of entries.entries()) {
      MoreActivitiesMigrationService.#emitProgress(onProgress, {
        phase: "apply",
        current: index,
        total: entries.length,
        detail: entry?.itemName ?? ""
      });

      Logger.debug(`Applying ${index + 1}/${entries.length}: "${entry?.itemName ?? entry?.itemUuid}".`);
      await this.#applyEntry(entry, report);

      MoreActivitiesMigrationService.#emitProgress(onProgress, {
        phase: "apply",
        current: index + 1,
        total: entries.length,
        detail: entry?.itemName ?? ""
      });
      await MoreActivitiesMigrationService.#yieldToUi(index);
    }
  }

  async #applyEntry(entry, report) {
    const item = await fromUuid(entry.itemUuid).catch(() => null);
    if (!item) {
      Logger.warn(`Migration skipped "${entry.itemName}" because ${entry.itemUuid} could not be resolved.`);
      report.failedItems += 1;
      report.items.push({
        itemUuid: entry.itemUuid,
        itemName: entry.itemName,
        status: "failed",
        reason: "item-not-found"
      });
      return;
    }

    const lockedPackId = MoreActivitiesMigrationService.#lockedPackIdFor(entry);
    if (lockedPackId) {
      Logger.warn(`Migration skipped "${entry.itemName}" because compendium "${lockedPackId}" is locked.`);
      report.failedItems += 1;
      report.items.push({
        itemUuid: entry.itemUuid,
        itemName: entry.itemName,
        packId: lockedPackId,
        status: "failed",
        reason: "pack-locked"
      });
      return;
    }

    const activityMap = MoreActivitiesMigrationService.#clone(item.toObject()?.system?.activities ?? {});
    let changed = false;
    const itemReport = {
      itemUuid: item.uuid,
      itemName: item.name ?? "",
      packId: entry.packId ?? null,
      status: "skipped",
      convertedActivities: [],
      skippedActivities: []
    };

    for (const activityEntry of entry.activities ?? []) {
      if (!activityEntry.convertible) {
        report.skippedActivities += 1;
        itemReport.skippedActivities.push({
          activityId: activityEntry.activityId,
          legacyType: activityEntry.legacyType,
          reason: activityEntry.reason ?? "blocked"
        });
        continue;
      }

      const activitySource = activityMap?.[activityEntry.activityId];
      if (!activitySource) {
        report.skippedActivities += 1;
        itemReport.skippedActivities.push({
          activityId: activityEntry.activityId,
          legacyType: activityEntry.legacyType,
          reason: "activity-not-found"
        });
        continue;
      }

      const context = await this.#buildConversionContext(activitySource, report.previewId);
      const conversion = MoreActivitiesMigrationConverter.convert(activitySource, {
        ...context,
        previewId: report.previewId,
        migratedAt: report.createdAt
      });
      if (!conversion.ok || !conversion.convertedSource) {
        report.skippedActivities += 1;
        itemReport.skippedActivities.push({
          activityId: activityEntry.activityId,
          legacyType: activityEntry.legacyType,
          reason: conversion.reason ?? "conversion-failed"
        });
        continue;
      }

      activityMap[activityEntry.activityId] = conversion.convertedSource;
      changed = true;
      report.convertedActivities += 1;
      itemReport.convertedActivities.push({
        activityId: activityEntry.activityId,
        legacyType: activityEntry.legacyType,
        targetType: conversion.targetType,
        warnings: [...(conversion.warnings ?? [])]
      });
    }

    if (!changed) {
      Logger.debug(`No convertible activity entries on "${item.name}"; item left untouched.`);
      report.items.push(itemReport);
      return;
    }

    try {
      await item.update({ "system.activities": activityMap });
      const refreshed = await fromUuid(item.uuid).catch(() => null);
      const refreshedActivities = refreshed?.toObject?.()?.system?.activities ?? {};
      const verifyCount = Object.keys(refreshedActivities).length;
      const expectedCount = Object.keys(activityMap).length;
      if (verifyCount !== expectedCount) {
        throw new Error(`Activity count mismatch after migration. Expected ${expectedCount}, got ${verifyCount}.`);
      }
      report.updatedItems += 1;
      itemReport.status = "updated";
      report.items.push(itemReport);
      Logger.debug(`Migrated "${item.name}" (${item.uuid}): ${itemReport.convertedActivities.length} activity entry(ies).`);
    } catch (error) {
      Logger.error(`Migration failed for "${item.name}" (${item.uuid}).`, error);
      report.failedItems += 1;
      itemReport.status = "failed";
      itemReport.reason = error?.message ?? String(error);
      report.items.push(itemReport);
    }
  }

  async restoreMoreActivitiesMigrationBackup({ backupId = null, onProgress = null } = {}) {
    MoreActivitiesMigrationService.#assertGm();
    const backup = backupId
      ? MoreActivitiesMigrationBackupService.getBackup(backupId)
      : MoreActivitiesMigrationBackupService.getLatestBackup();
    if (!backup) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Migration.Error.BackupMissing",
        "No migration backup was found to restore."
      ));
    }

    Logger.info(`Restoring more-activities migration backup ${backup.id} (${backup.items?.length ?? 0} item(s)).`);

    const report = {
      id: foundry.utils.randomID(),
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      restoredItems: 0,
      failedItems: 0,
      unlockedPacks: [],
      items: []
    };

    const entries = backup.items ?? [];
    const packIds = MoreActivitiesMigrationService.#collectPackIds(entries);
    const unlockedPackIds = await MoreActivitiesMigrationService.#unlockIfEnabled(packIds);
    report.unlockedPacks = [...unlockedPackIds];

    try {
      for (const [index, entry] of entries.entries()) {
        MoreActivitiesMigrationService.#emitProgress(onProgress, {
          phase: "restore",
          current: index,
          total: entries.length,
          detail: entry?.itemName ?? ""
        });

        Logger.debug(`Restoring ${index + 1}/${entries.length}: "${entry?.itemName ?? entry?.itemUuid}".`);
        await MoreActivitiesMigrationService.#restoreEntry(entry, report);

        MoreActivitiesMigrationService.#emitProgress(onProgress, {
          phase: "restore",
          current: index + 1,
          total: entries.length,
          detail: entry?.itemName ?? ""
        });
        await MoreActivitiesMigrationService.#yieldToUi(index);
      }
    } finally {
      await MoreActivitiesMigrationPackScanner.relockPacks(unlockedPackIds);
    }

    Logger.info(`Migration restore finished: ${report.restoredItems} restored, ${report.failedItems} failed.`);

    return Object.freeze(report);
  }

  static async #restoreEntry(entry, report) {
    const item = await fromUuid(entry.itemUuid).catch(() => null);
    if (!item) {
      Logger.warn(`Restore skipped "${entry.itemName}" because ${entry.itemUuid} could not be resolved.`);
      report.failedItems += 1;
      report.items.push({
        itemUuid: entry.itemUuid,
        itemName: entry.itemName,
        status: "failed",
        reason: "item-not-found"
      });
      return;
    }

    try {
      await item.update({ "system.activities": MoreActivitiesMigrationService.#clone(entry.activities ?? {}) });
      report.restoredItems += 1;
      report.items.push({
        itemUuid: item.uuid,
        itemName: item.name ?? "",
        packId: entry.packId ?? null,
        status: "restored"
      });
      Logger.debug(`Restored "${item.name}" (${item.uuid}) from backup.`);
    } catch (error) {
      Logger.error(`Restore failed for "${item.name}" (${item.uuid}).`, error);
      report.failedItems += 1;
      report.items.push({
        itemUuid: item.uuid,
        itemName: item.name ?? "",
        packId: entry.packId ?? null,
        status: "failed",
        reason: error?.message ?? String(error)
      });
    }
  }

  listMoreActivitiesMigrationBackups() {
    MoreActivitiesMigrationService.#assertGm();
    return Object.freeze(MoreActivitiesMigrationBackupService.listBackups());
  }

  async exportMoreActivitiesMigrationReport(report = {}) {
    const payload = JSON.stringify(report, null, 2);
    const filename = `sc-more-activities-migration-${report?.id ?? "report"}.json`;
    if (typeof globalThis.saveDataToFile === "function") {
      globalThis.saveDataToFile(payload, "application/json", filename);
      return filename;
    }

    if (game?.clipboard?.copyPlainText) {
      await game.clipboard.copyPlainText(payload);
      return filename;
    }

    await navigator.clipboard.writeText(payload);
    return filename;
  }

  asPublicObject() {
    return Object.freeze({
      previewMoreActivitiesMigration: this.previewMoreActivitiesMigration.bind(this),
      migrateMoreActivities: this.migrateMoreActivities.bind(this),
      restoreMoreActivitiesMigrationBackup: this.restoreMoreActivitiesMigrationBackup.bind(this),
      listMoreActivitiesMigrationBackups: this.listMoreActivitiesMigrationBackups.bind(this),
      exportMoreActivitiesMigrationReport: this.exportMoreActivitiesMigrationReport.bind(this)
    });
  }

  async #buildConversionContext(activitySource, previewId) {
    const context = { previewId };
    if (String(activitySource?.type ?? "") === "advancement") {
      const sourceItemUuid = String(activitySource?.sourceItem ?? "").trim();
      if (sourceItemUuid && typeof globalThis.fromUuid === "function") {
        const sourceItem = await globalThis.fromUuid(sourceItemUuid).catch(() => null);
        context.sourceItemAdvancements = sourceItem?.system?.advancement ?? {};
      }
    }
    return context;
  }

  static #collectPackIds(entries = []) {
    return [...new Set(entries.map((entry) => entry?.packId).filter(Boolean))];
  }

  static async #unlockIfEnabled(packIds) {
    if (!packIds.length) {
      return [];
    }

    if (!ModuleSettings.isMigrationPackUnlockEnabled()) {
      Logger.debug("Automatic compendium unlocking is disabled; locked packs will be reported as failures.", { packIds });
      return [];
    }

    return MoreActivitiesMigrationPackScanner.unlockPacks(packIds);
  }

  static #lockedPackIdFor(entry) {
    const packId = entry?.packId;
    if (!packId) {
      return null;
    }
    return game?.packs?.get?.(packId)?.locked === true ? packId : null;
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

  static async #yieldToUi(index, interval = 25) {
    if (index % interval !== 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  static #assertGm() {
    if (!game?.user?.isGM) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Migration.Error.GmOnly",
        "Only a GM can preview, apply, or restore more-activities migrations."
      ));
    }
  }

  static #clone(value) {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }
}
