export class Constants {
  static MODULE_ID = "sc-more-activities";
  static MODULE_TITLE = "SC - More Activities";
  static LOCALIZATION_PREFIX = "SCMOREACTIVITIES";
  static MODULE_WIKI_URL = "https://wiki.shattered-codex.com/modules/sc-more-activities";
  static PATREON_URL = "https://www.patreon.com/c/shatteredcodex?utm_source=sc-more-activities&utm_medium=foundry_module&utm_campaign=support_button";

  static localize(key, fallback = key) {
    const i18n = game?.i18n;
    const localized = typeof i18n?.localize === "function" ? i18n.localize(key) : undefined;
    if (localized && localized !== key) {
      return localized;
    }
    return fallback ?? key;
  }

  static format(key, data = {}, fallback = key) {
    const i18n = game?.i18n;
    const formatted = typeof i18n?.format === "function" ? i18n.format(key, data) : undefined;
    if (formatted && formatted !== key) {
      return formatted;
    }
    return fallback ?? key;
  }

  static isDnd5eActive() {
    return game?.system?.id === "dnd5e" && Boolean(globalThis.dnd5e);
  }

  static isDnd5eSystem() {
    return game?.system?.id === "dnd5e";
  }
}
