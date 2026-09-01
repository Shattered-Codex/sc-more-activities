import { Constants } from "../constants/Constants.js";
import { HOOKS } from "../constants/Hooks.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";
import { ModuleSettings } from "./ModuleSettings.js";
import { ACTIVITY_GROUP_BY } from "./ActivityToggleList.js";
import { CommunityLinks } from "./CommunityLinks.js";
import { ModuleSettingsApp } from "./ModuleSettingsApp.js";
import { ModuleSettingsCatalog } from "./ModuleSettingsCatalog.js";
import { ActivityCatalogApp } from "../applications/ActivityCatalogApp.js";
import { MoreActivitiesMigrationApp } from "../applications/MoreActivitiesMigrationApp.js";
import { PreviewColorMenu } from "./PreviewColorMenu.js";

export class ModuleSettingsRegistrar {
  #registered = false;

  register() {
    if (this.#registered) {
      return;
    }
    this.#registered = true;

    this.#registerCatalogSettings();
    this.#registerActivityGroupBySetting();
    this.#registerDisabledActivityTypesSetting();
    this.#registerPreviewColorsSetting();
    this.#registerMigrationBackupsSetting();
    this.#registerModuleSettingsMenu();
    this.#registerActivityCatalogMenu();
    this.#registerMigrationMenu();
    this.#registerPreviewColorsMenu();

    Hooks.on("renderSettingsConfig", (_app, html) => {
      ModuleSettingsApp.bindSettingsButton(html);
      ActivityCatalogApp.bindSettingsButton(html);
      CommunityLinks.inject(html);
    });
  }

  /**
   * Registers every setting the module surfaces in its own window. They all
   * declare `config: false`, so Foundry's flat module list stays clean and the
   * window is the one place a GM configures the module.
   */
  #registerCatalogSettings() {
    for (const field of ModuleSettingsCatalog.fields()) {
      game.settings.register(Constants.MODULE_ID, field.key, ModuleSettingsCatalog.registration(field));
    }
  }

  #registerModuleSettingsMenu() {
    game.settings.registerMenu(Constants.MODULE_ID, SETTINGS_KEYS.MODULE_SETTINGS_MENU, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.Window.Name", "Module settings"),
      label: Constants.localize("SCMOREACTIVITIES.Settings.Window.Label", "Open settings"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.Window.Hint",
        "Open a dedicated window with every SC - More Activities option, grouped by area."
      ),
      icon: "fa-solid fa-sliders",
      type: ModuleSettingsApp,
      // Players still get the client-only section, so this is not GM-gated.
      restricted: false
    });
  }

  /**
   * How the Activities tab groups its rows. A per-user view preference, so it
   * is client scoped and lives outside the window's saveable fields: picking a
   * grouping is not an edit the GM has to confirm with Save.
   */
  #registerActivityGroupBySetting() {
    game.settings.register(Constants.MODULE_ID, SETTINGS_KEYS.ACTIVITY_GROUP_BY, {
      name: Constants.localize("SCMOREACTIVITIES.Settings.ActivityGroupBy.Name", "Activity grouping"),
      hint: Constants.localize(
        "SCMOREACTIVITIES.Settings.ActivityGroupBy.Hint",
        "Stores whether this user groups the Activities tab by category or by module."
      ),
      scope: "client",
      config: false,
      type: String,
      default: ACTIVITY_GROUP_BY.CATEGORY
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
}
