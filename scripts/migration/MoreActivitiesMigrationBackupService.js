import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";

export class MoreActivitiesMigrationBackupService {
  static async createBackup(preview = {}) {
    const backup = {
      id: foundry.utils.randomID(),
      createdAt: new Date().toISOString(),
      worldId: game?.world?.id ?? null,
      moduleVersion: game?.modules?.get?.(Constants.MODULE_ID)?.version ?? "0.0.0",
      moreActivitiesVersion: game?.modules?.get?.("more-activities")?.version ?? null,
      previewId: preview?.previewId ?? null,
      items: []
    };

    for (const entry of preview?.entries ?? []) {
      const item = await fromUuid(entry.itemUuid).catch(() => null);
      if (!item) {
        continue;
      }
      backup.items.push({
        itemUuid: item.uuid,
        itemName: item.name ?? "",
        actorUuid: entry.actorUuid ?? item.actor?.uuid ?? null,
        actorName: entry.actorName ?? item.actor?.name ?? null,
        source: entry.source ?? (item.actor ? "actor" : "world"),
        activities: MoreActivitiesMigrationBackupService.#clone(item.toObject()?.system?.activities ?? {})
      });
    }

    const allBackups = MoreActivitiesMigrationBackupService.listBackups();
    const retention = MoreActivitiesMigrationBackupService.getRetention();
    const nextBackups = [backup, ...allBackups].slice(0, retention);
    await game.settings.set(Constants.MODULE_ID, SETTINGS_KEYS.MIGRATION_BACKUPS, nextBackups);
    return Object.freeze(backup);
  }

  static listBackups() {
    const stored = game?.settings?.get?.(Constants.MODULE_ID, SETTINGS_KEYS.MIGRATION_BACKUPS) ?? [];
    return Array.isArray(stored) ? stored.map((entry) => MoreActivitiesMigrationBackupService.#clone(entry)) : [];
  }

  static getBackup(backupId) {
    return MoreActivitiesMigrationBackupService.listBackups().find((entry) => entry.id === backupId) ?? null;
  }

  static getLatestBackup() {
    return MoreActivitiesMigrationBackupService.listBackups()[0] ?? null;
  }

  static getRetention() {
    const raw = Number(game?.settings?.get?.(Constants.MODULE_ID, SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION) ?? 3);
    if (!Number.isFinite(raw)) {
      return 3;
    }
    return Math.min(10, Math.max(1, Math.trunc(raw)));
  }

  static #clone(value) {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }
}

