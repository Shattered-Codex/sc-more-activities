import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";

export class ActivityAvailability {
  static getDisabledMap() {
    try {
      const value = game?.settings?.get?.(Constants.MODULE_ID, SETTINGS_KEYS.DISABLED_ACTIVITY_TYPES);
      return ActivityAvailability.#normalizeDisabledMap(value);
    } catch (_error) {
      return {};
    }
  }

  static isTypeEnabled(type) {
    const normalizedType = ActivityAvailability.#normalizeType(type);
    if (!normalizedType) {
      return true;
    }
    return ActivityAvailability.getDisabledMap()[normalizedType] !== true;
  }

  static async setTypeEnabled(type, enabled) {
    const normalizedType = ActivityAvailability.#normalizeType(type);
    if (!normalizedType) {
      return ActivityAvailability.#failure(type, "invalid-type", "Activity type is required.");
    }

    if (game?.user?.isGM !== true) {
      return ActivityAvailability.#failure(normalizedType, "permission-denied", "Only a GM can change activity availability.");
    }

    if (typeof game?.settings?.set !== "function") {
      return ActivityAvailability.#failure(normalizedType, "settings-unavailable", "Foundry settings are not available.");
    }

    const nextDisabled = ActivityAvailability.getDisabledMap();
    if (enabled) {
      delete nextDisabled[normalizedType];
    } else {
      nextDisabled[normalizedType] = true;
    }

    await game.settings.set(Constants.MODULE_ID, SETTINGS_KEYS.DISABLED_ACTIVITY_TYPES, nextDisabled);
    return Object.freeze({
      ok: true,
      type: normalizedType,
      status: enabled ? "enabled" : "disabled",
      enabled: Boolean(enabled),
      disabled: !enabled
    });
  }

  static canUseType(type, labelKey = type) {
    if (ActivityAvailability.isTypeEnabled(type)) {
      return true;
    }

    const label = Constants.localize(labelKey, type);
    ui?.notifications?.warn?.(Constants.format(
      "SCMOREACTIVITIES.Warning.ActivityTypeDisabled",
      { type: label },
      `${label} is disabled by the GM.`
    ));
    return false;
  }

  static #normalizeDisabledMap(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(
      Object.entries(source)
        .filter(([type, disabled]) => ActivityAvailability.#normalizeType(type) && disabled === true)
        .map(([type]) => [ActivityAvailability.#normalizeType(type), true])
    );
  }

  static #normalizeType(type) {
    return String(type ?? "").trim();
  }

  static #failure(type, reason, message) {
    return Object.freeze({
      ok: false,
      type: type ?? null,
      status: "failed",
      reason,
      message
    });
  }
}
