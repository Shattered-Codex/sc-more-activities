import { Constants } from "../constants/Constants.js";
import { HOOKS } from "../constants/Hooks.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";
import { ModuleSettings } from "./ModuleSettings.js";
import { ActivityCatalogApp } from "../applications/ActivityCatalogApp.js";
import { MoreActivitiesMigrationApp } from "../applications/MoreActivitiesMigrationApp.js";
import { DocumentationMenu } from "./DocumentationMenu.js";
import { PreviewColorMenu } from "./PreviewColorMenu.js";
import { SupportMenu } from "./SupportMenu.js";

export class ModuleSettingsRegistrar {
  #registered = false;

  register() {
    if (this.#registered) {
      return;
    }
    this.#registered = true;

    this.#registerDebugLoggingSetting();
    this.#registerDisabledActivityTypesSetting();
    this.#registerPreviewColorsSetting();
    this.#registerMigrationBackupsSetting();
    this.#registerMigrationBackupRetentionSetting();
    this.#registerSupportMenu();
    this.#registerDocumentationMenu();
    this.#registerActivityCatalogMenu();
    this.#registerMigrationMenu();
    this.#registerPreviewColorsMenu();

    Hooks.on("renderSettingsConfig", (_app, html) => {
      ActivityCatalogApp.bindSettingsButton(html);
      SupportMenu.bindSettingsButton(html);
      DocumentationMenu.bindSettingsButton(html);
      ModuleSettingsRegistrar.#prioritizeSpecialMenus(html);
    });
  }

  #registerDebugLoggingSetting() {
    game.settings.register(Constants.MODULE_ID, SETTINGS_KEYS.DEBUG_LOGGING, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.DebugLogging.Name", "Debug logging"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.DebugLogging.Hint",
        "Log SC - More Activities lifecycle and diagnostic messages to the browser console."
      ),
      scope: "client",
      config: true,
      type: Boolean,
      default: false
    });
  }

  #registerDisabledActivityTypesSetting() {
    game.settings.register(Constants.MODULE_ID, SETTINGS_KEYS.DISABLED_ACTIVITY_TYPES, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.DisabledActivityTypes.Name", "Disabled activity types"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.DisabledActivityTypes.Hint",
        "Stores activity types disabled from creation and use by the GM."
      ),
      scope: "world",
      config: false,
      type: Object,
      default: {},
      onChange: (value) => {
        const disabledTypes = Object.entries(value && typeof value === "object" ? value : {})
          .filter(([_type, disabled]) => disabled === true)
          .map(([type]) => type)
          .sort();
        Hooks.callAll(HOOKS.ACTIVITY_AVAILABILITY_CHANGED, Object.freeze({ disabledTypes }));
      }
    });
  }

  #registerPreviewColorsSetting() {
    game.settings.register(Constants.MODULE_ID, SETTINGS_KEYS.PREVIEW_COLORS, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.PreviewColors.Name", "Preview colors"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.PreviewColors.Hint",
        "Stores this user's preview colors for teleport, movement, and wall overlays."
      ),
      scope: "client",
      config: false,
      type: Object,
      default: ModuleSettings.DEFAULT_PREVIEW_COLORS
    });
  }

  #registerMigrationBackupsSetting() {
    game.settings.register(Constants.MODULE_ID, SETTINGS_KEYS.MIGRATION_BACKUPS, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.MigrationBackups.Name", "Migration backups"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.MigrationBackups.Hint",
        "Stores more-activities migration backups for restore."
      ),
      scope: "world",
      config: false,
      type: Object,
      default: []
    });
  }

  #registerMigrationBackupRetentionSetting() {
    game.settings.register(Constants.MODULE_ID, SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.MigrationBackupRetention.Name", "Migration backup retention"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.MigrationBackupRetention.Hint",
        "How many more-activities migration backups to keep in world settings."
      ),
      scope: "world",
      config: true,
      restricted: true,
      type: Number,
      default: 3,
      range: {
        min: 1,
        max: 10,
        step: 1
      }
    });
  }

  #registerActivityCatalogMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, SETTINGS_KEYS.ACTIVITY_CATALOG_MENU, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.ActivityCatalogMenu.Name", "Activity catalog"),
      label: Constants.localize("SCMOREACTIVITIES.Settings.ActivityCatalogMenu.Label", "Open catalog"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.ActivityCatalogMenu.Hint",
        "Open the registered activity catalog and diagnostics."
      ),
      icon: "fa-solid fa-rectangle-list",
      type: ActivityCatalogApp,
      restricted: true
    });
  }

  #registerMigrationMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, SETTINGS_KEYS.MIGRATION_MENU, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.MigrationMenu.Name", "More Activities migration"),
      label: Constants.localize("SCMOREACTIVITIES.Settings.MigrationMenu.Label", "Open migration tools"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.MigrationMenu.Hint",
        "Preview, apply, export, and restore explicit migrations from the legacy more-activities module."
      ),
      icon: "fa-solid fa-arrows-rotate",
      type: MoreActivitiesMigrationApp,
      restricted: true
    });
  }

  #registerPreviewColorsMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, SETTINGS_KEYS.PREVIEW_COLORS_MENU, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.PreviewColorsMenu.Name", "Preview colors"),
      label: Constants.localize("SCMOREACTIVITIES.Settings.PreviewColorsMenu.Label", "Configure colors"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.PreviewColorsMenu.Hint",
        "Choose the colors used by teleport, movement, and wall previews for this user."
      ),
      icon: "fas fa-palette",
      type: PreviewColorMenu,
      restricted: false
    });
  }

  #registerSupportMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, SETTINGS_KEYS.SUPPORT_MENU, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.SupportMenu.Name", "Support the developer"),
      label: Constants.localize("SCMOREACTIVITIES.Settings.SupportMenu.Label", "Patreon support"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.SupportMenu.Hint",
        "Support Shattered Codex development on Patreon."
      ),
      icon: "fas fa-heart",
      type: SupportMenu,
      restricted: true
    });
  }

  #registerDocumentationMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, SETTINGS_KEYS.DOCUMENTATION_MENU, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.DocumentationMenu.Name", "Documentation"),
      label: Constants.localize("SCMOREACTIVITIES.Settings.DocumentationMenu.Label", "Open wiki"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.DocumentationMenu.Hint",
        "Open the SC - More Activities documentation wiki."
      ),
      icon: "fas fa-hat-wizard",
      type: DocumentationMenu,
      restricted: true
    });
  }

  static #prioritizeSpecialMenus(html) {
    const root = ModuleSettingsRegistrar.#resolveRoot(html);
    if (!root) {
      return;
    }

    const supportKey = `${Constants.MODULE_ID}.${SETTINGS_KEYS.SUPPORT_MENU}`;
    const docsKey = `${Constants.MODULE_ID}.${SETTINGS_KEYS.DOCUMENTATION_MENU}`;
    const supportRow = ModuleSettingsRegistrar.#findSettingsRow(root, supportKey);
    const docsRow = ModuleSettingsRegistrar.#findSettingsRow(root, docsKey);
    const anchor = supportRow ?? docsRow;
    const parent = anchor?.parentElement ?? null;
    if (!parent) {
      return;
    }

    if (docsRow && docsRow.parentElement === parent) {
      parent.prepend(docsRow);
    }
    if (supportRow && supportRow.parentElement === parent) {
      parent.prepend(supportRow);
    }
  }

  static #findSettingsRow(root, key) {
    return root.querySelector([
      `[data-setting-id="${key}"]`,
      `[data-menu-id="${key}"]`,
      `[data-key="${key}"]`,
      `[data-setting="${key}"]`
    ].join(",")) ?? null;
  }

  static #resolveRoot(html) {
    if (!html) {
      return null;
    }
    if (html.jquery || typeof html.get === "function") {
      return html[0] ?? html.get(0) ?? null;
    }
    if (html instanceof Element || html?.querySelector) {
      return html;
    }
    return null;
  }
}
