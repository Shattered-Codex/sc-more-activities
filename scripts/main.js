import { Constants } from "./constants/Constants.js";
import { ModuleSettingsRegistrar } from "./settings/ModuleSettingsRegistrar.js";
import { Logger } from "./support/Logger.js";

const settingsRegistrar = new ModuleSettingsRegistrar();

Hooks.once("init", () => {
  settingsRegistrar.register();
  Logger.debug(Constants.localize("SCMOREACTIVITIES.Diagnostics.Init", "Initializing module shell."));
});

Hooks.once("setup", () => {
  if (!Constants.isDnd5eActive()) {
    Logger.warn(Constants.localize(
      "SCMOREACTIVITIES.Warning.UnsupportedSystem",
      "SC - More Activities only supports the dnd5e system."
    ));
    return;
  }

  Logger.debug(Constants.localize("SCMOREACTIVITIES.Diagnostics.Setup", "Setup complete."));
});

Hooks.once("ready", () => {
  if (!Constants.isDnd5eActive()) {
    return;
  }

  Logger.debug(Constants.localize("SCMOREACTIVITIES.Diagnostics.Ready", "Ready."));
});
