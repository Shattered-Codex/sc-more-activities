import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";

export class ModuleSettings {
  static DEBUG_LOGGING = SETTINGS_KEYS.DEBUG_LOGGING;
  static ALLOW_PLAYER_TOKEN_MOVEMENT = SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT;
  static PREVIEW_COLORS = SETTINGS_KEYS.PREVIEW_COLORS;
  static PREVIEW_COLORS_MENU = SETTINGS_KEYS.PREVIEW_COLORS_MENU;
  static MIGRATION_BACKUPS = SETTINGS_KEYS.MIGRATION_BACKUPS;
  static MIGRATION_BACKUP_RETENTION = SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION;
  static MIGRATION_INCLUDE_COMPENDIUMS = SETTINGS_KEYS.MIGRATION_INCLUDE_COMPENDIUMS;
  static MIGRATION_INCLUDE_EXTERNAL_PACKS = SETTINGS_KEYS.MIGRATION_INCLUDE_EXTERNAL_PACKS;
  static MIGRATION_UNLOCK_PACKS = SETTINGS_KEYS.MIGRATION_UNLOCK_PACKS;
  static MIGRATION_MENU = SETTINGS_KEYS.MIGRATION_MENU;
  static DEFAULT_PREVIEW_COLORS = Object.freeze({
    teleportRangeBorder: "#24b86a",
    teleportRangeFill: "#39f08c",
    teleportRangeBlocked: "#e5484d",
    movementRangeBorder: "#4da3ff",
    movementRangeFill: "#8fd3ff",
    movementRangeBlocked: "#e5484d",
    wallRangeBorder: "#d32f2f",
    wallRangeFill: "#fff4a8",
    wallRangeBlocked: "#5b6170",
    portalRangeBorder: "#8a63d2",
    portalRangeFill: "#c9b3f0",
    portalRangeBlocked: "#e5484d"
  });

  /** The overlays that have their own colours, in the order the picker lists them. */
  static PREVIEW_SCOPES = Object.freeze(["teleport", "movement", "wall", "portal"]);

  /** The colours every overlay has. */
  static PREVIEW_COLOR_PARTS = Object.freeze(["Fill", "Border", "Blocked"]);

  static isDebugLoggingEnabled() {
    if (ModuleSettings.#isDevModeDebugEnabled()) {
      return true;
    }

    try {
      const key = `${Constants.MODULE_ID}.${SETTINGS_KEYS.DEBUG_LOGGING}`;
      if (!game?.settings?.settings?.has?.(key)) {
        return false;
      }
      return Boolean(game.settings.get(Constants.MODULE_ID, SETTINGS_KEYS.DEBUG_LOGGING));
    } catch {
      return false;
    }
  }

  static isCanvasResultCardsEnabled() {
    return ModuleSettings.#getBoolean(SETTINGS_KEYS.CANVAS_RESULT_CARDS, true);
  }

  /**
   * Whether a player may move a token they do not own through a module
   * movement or teleport activity. The activity's own range, distance, and
   * target limits are re-validated on the GM client either way; this only
   * lifts the ownership requirement on the moved token.
   */
  static isPlayerTokenMovementAllowed() {
    return ModuleSettings.#getBoolean(SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT, true);
  }

  static isMigrationCompendiumScanEnabled() {
    return ModuleSettings.#getBoolean(SETTINGS_KEYS.MIGRATION_INCLUDE_COMPENDIUMS, true);
  }

  static isMigrationExternalPackScanEnabled() {
    return ModuleSettings.#getBoolean(SETTINGS_KEYS.MIGRATION_INCLUDE_EXTERNAL_PACKS, false);
  }

  static isMigrationPackUnlockEnabled() {
    return ModuleSettings.#getBoolean(SETTINGS_KEYS.MIGRATION_UNLOCK_PACKS, true);
  }

  static #getBoolean(settingKey, fallback) {
    try {
      const key = `${Constants.MODULE_ID}.${settingKey}`;
      if (!game?.settings?.settings?.has?.(key)) {
        return fallback;
      }
      return Boolean(game.settings.get(Constants.MODULE_ID, settingKey));
    } catch {
      return fallback;
    }
  }

  static #isDevModeDebugEnabled() {
    try {
      return Boolean(
        game?.modules?.get?.("_dev-mode")?.api?.getPackageDebugValue?.(Constants.MODULE_ID)
      );
    } catch {
      return false;
    }
  }

  static getPreviewColors() {
    try {
      const key = `${Constants.MODULE_ID}.${SETTINGS_KEYS.PREVIEW_COLORS}`;
      if (!game?.settings?.settings?.has?.(key)) {
        return ModuleSettings.DEFAULT_PREVIEW_COLORS;
      }

      return ModuleSettings.#normalizePreviewColors(
        game.settings.get(Constants.MODULE_ID, SETTINGS_KEYS.PREVIEW_COLORS)
      );
    } catch {
      return ModuleSettings.DEFAULT_PREVIEW_COLORS;
    }
  }

  /**
   * The colours one overlay draws with: its range fill and border, and the
   * colour of the spaces inside it that cannot be used.
   */
  static getRangeColors(scope) {
    const colors = ModuleSettings.getPreviewColors();
    return {
      borderColor: colors[`${scope}RangeBorder`],
      fillColor: colors[`${scope}RangeFill`],
      blockedColor: colors[`${scope}RangeBlocked`]
    };
  }

  static getTeleportRangeColors() {
    return ModuleSettings.getRangeColors("teleport");
  }

  static getWallRangeColors() {
    return ModuleSettings.getRangeColors("wall");
  }

  static getPortalRangeColors() {
    return ModuleSettings.getRangeColors("portal");
  }

  static getMovementRangeColors() {
    return ModuleSettings.getRangeColors("movement");
  }

  static #normalizePreviewColors(value = {}) {
    // Built from the defaults, so a colour added in a later release (the
    // blocked colour, say) falls back to its default for a stored older value.
    const defaults = ModuleSettings.DEFAULT_PREVIEW_COLORS;
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
      key,
      ModuleSettings.#sanitizeHexColor(value?.[key], fallback)
    ]));
  }

  static #sanitizeHexColor(value, fallback) {
    const normalized = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
  }
}
