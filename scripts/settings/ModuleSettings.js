import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";

export class ModuleSettings {
  static DEBUG_LOGGING = SETTINGS_KEYS.DEBUG_LOGGING;
  static PREVIEW_COLORS = SETTINGS_KEYS.PREVIEW_COLORS;
  static PREVIEW_COLORS_MENU = SETTINGS_KEYS.PREVIEW_COLORS_MENU;
  static SUPPORT_MENU = SETTINGS_KEYS.SUPPORT_MENU;
  static DOCUMENTATION_MENU = SETTINGS_KEYS.DOCUMENTATION_MENU;
  static DEFAULT_PREVIEW_COLORS = Object.freeze({
    teleportRangeBorder: "#24b86a",
    teleportRangeFill: "#39f08c",
    movementRangeBorder: "#4da3ff",
    movementRangeFill: "#8fd3ff",
    wallRangeBorder: "#d32f2f",
    wallRangeFill: "#fff4a8"
  });

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

  static getTeleportRangeColors() {
    const colors = ModuleSettings.getPreviewColors();
    return {
      borderColor: colors.teleportRangeBorder,
      fillColor: colors.teleportRangeFill
    };
  }

  static getWallRangeColors() {
    const colors = ModuleSettings.getPreviewColors();
    return {
      borderColor: colors.wallRangeBorder,
      fillColor: colors.wallRangeFill
    };
  }

  static getMovementRangeColors() {
    const colors = ModuleSettings.getPreviewColors();
    return {
      borderColor: colors.movementRangeBorder,
      fillColor: colors.movementRangeFill
    };
  }

  static #normalizePreviewColors(value = {}) {
    const defaults = ModuleSettings.DEFAULT_PREVIEW_COLORS;
    return {
      teleportRangeBorder: ModuleSettings.#sanitizeHexColor(value?.teleportRangeBorder, defaults.teleportRangeBorder),
      teleportRangeFill: ModuleSettings.#sanitizeHexColor(value?.teleportRangeFill, defaults.teleportRangeFill),
      movementRangeBorder: ModuleSettings.#sanitizeHexColor(value?.movementRangeBorder, defaults.movementRangeBorder),
      movementRangeFill: ModuleSettings.#sanitizeHexColor(value?.movementRangeFill, defaults.movementRangeFill),
      wallRangeBorder: ModuleSettings.#sanitizeHexColor(value?.wallRangeBorder, defaults.wallRangeBorder),
      wallRangeFill: ModuleSettings.#sanitizeHexColor(value?.wallRangeFill, defaults.wallRangeFill)
    };
  }

  static #sanitizeHexColor(value, fallback) {
    const normalized = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
  }
}
