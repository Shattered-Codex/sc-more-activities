import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";

export class ModuleSettings {
  static DEBUG_LOGGING = SETTINGS_KEYS.DEBUG_LOGGING;
  static SUPPORT_MENU = SETTINGS_KEYS.SUPPORT_MENU;
  static DOCUMENTATION_MENU = SETTINGS_KEYS.DOCUMENTATION_MENU;

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
}
