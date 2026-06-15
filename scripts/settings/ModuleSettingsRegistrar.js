import { Constants } from "../constants/Constants.js";
import { HOOKS } from "../constants/Hooks.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";
import { ActivityCatalogApp } from "../applications/ActivityCatalogApp.js";
import { DocumentationMenu } from "./DocumentationMenu.js";
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
    this.#registerActivityCatalogMenu();
    this.#registerSupportMenu();
    this.#registerDocumentationMenu();

    Hooks.on("renderSettingsConfig", (_app, html) => {
      ActivityCatalogApp.bindSettingsButton(html);
      SupportMenu.bindSettingsButton(html);
      DocumentationMenu.bindSettingsButton(html);
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
      icon: "fas fa-book-open",
      type: DocumentationMenu,
      restricted: true
    });
  }
}
