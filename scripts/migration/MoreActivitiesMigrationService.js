import { Constants } from "../constants/Constants.js";
import { MoreActivitiesMigrationAnalyzer } from "./MoreActivitiesMigrationAnalyzer.js";
import { MoreActivitiesMigrationBackupService } from "./MoreActivitiesMigrationBackupService.js";
import { MoreActivitiesMigrationConverter } from "./MoreActivitiesMigrationConverter.js";

export class MoreActivitiesMigrationService {
  #analyzer;

  constructor({ analyzer = new MoreActivitiesMigrationAnalyzer() } = {}) {
    this.#analyzer = analyzer;
  }

  async previewMoreActivitiesMigration() {
    MoreActivitiesMigrationService.#assertGm();
    const previewId = foundry.utils.randomID();
    return this.#analyzer.analyze({ previewId });
  }

  async migrateMoreActivities({ preview } = {}) {
    MoreActivitiesMigrationService.#assertGm();
    if (!preview?.previewId || !Array.isArray(preview?.entries)) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Migration.Error.PreviewRequired",
        "Run a migration preview before applying changes."
      ));
    }

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
      items: [],
      warnings: [...(preview.warnings ?? [])]
    };

    for (const entry of preview.entries) {
      const item = await fromUuid(entry.itemUuid).catch(() => null);
      if (!item) {
        report.failedItems += 1;
        report.items.push({
          itemUuid: entry.itemUuid,
          itemName: entry.itemName,
          status: "failed",
          reason: "item-not-found"
        });
        continue;
      }

      const activityMap = MoreActivitiesMigrationService.#clone(item.toObject()?.system?.activities ?? {});
      let changed = false;
      const itemReport = {
        itemUuid: item.uuid,
        itemName: item.name ?? "",
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

        const context = await this.#buildConversionContext(activitySource, preview.previewId);
        const conversion = MoreActivitiesMigrationConverter.convert(activitySource, {
          ...context,
          previewId: preview.previewId,
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
        report.items.push(itemReport);
        continue;
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
      } catch (error) {
        report.failedItems += 1;
        itemReport.status = "failed";
        itemReport.reason = error?.message ?? String(error);
        report.items.push(itemReport);
      }
    }

    return Object.freeze(report);
  }

  async restoreMoreActivitiesMigrationBackup({ backupId = null } = {}) {
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

    const report = {
      id: foundry.utils.randomID(),
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      restoredItems: 0,
      failedItems: 0,
      items: []
    };

    for (const entry of backup.items ?? []) {
      const item = await fromUuid(entry.itemUuid).catch(() => null);
      if (!item) {
        report.failedItems += 1;
        report.items.push({
          itemUuid: entry.itemUuid,
          itemName: entry.itemName,
          status: "failed",
          reason: "item-not-found"
        });
        continue;
      }

      try {
        await item.update({ "system.activities": MoreActivitiesMigrationService.#clone(entry.activities ?? {}) });
        report.restoredItems += 1;
        report.items.push({
          itemUuid: item.uuid,
          itemName: item.name ?? "",
          status: "restored"
        });
      } catch (error) {
        report.failedItems += 1;
        report.items.push({
          itemUuid: item.uuid,
          itemName: item.name ?? "",
          status: "failed",
          reason: error?.message ?? String(error)
        });
      }
    }

    return Object.freeze(report);
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
