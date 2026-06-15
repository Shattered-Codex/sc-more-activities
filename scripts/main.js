import { Constants } from "./constants/Constants.js";
import { HOOKS } from "./constants/Hooks.js";
import { ApiPublisher } from "./api/ApiPublisher.js";
import { PublicApiFactory } from "./api/PublicApiFactory.js";
import { RegistrationApi } from "./api/RegistrationApi.js";
import { Dnd5eActivityAdapter } from "./adapters/dnd5e/Dnd5eActivityAdapter.js";
import { ActivityRegistry } from "./registry/ActivityRegistry.js";
import { ModuleSettingsRegistrar } from "./settings/ModuleSettingsRegistrar.js";
import { Logger } from "./support/Logger.js";

const registry = new ActivityRegistry();
const registrationApi = new RegistrationApi({ registry });
const dnd5eActivityAdapter = new Dnd5eActivityAdapter();
const settingsRegistrar = new ModuleSettingsRegistrar();
let publicApi = null;

Hooks.once("init", () => {
  settingsRegistrar.register();
  Logger.debug(Constants.localize("SCMOREACTIVITIES.Diagnostics.Init", "Initializing module shell."));

  if (!Constants.isDnd5eSystem()) {
    return;
  }

  registry.beginCollection();
  publicApi = ApiPublisher.publish(PublicApiFactory.create({
    activities: registrationApi.asPublicObject(),
    moduleVersion: game.modules.get(Constants.MODULE_ID)?.version
  }));

  Hooks.callAll(HOOKS.REGISTER_ACTIVITIES, publicApi.activities);
  const report = registry.flushWith(dnd5eActivityAdapter);
  Hooks.callAll(HOOKS.REGISTRY_LOCKED, report);
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
  if (publicApi) {
    Hooks.callAll(HOOKS.API_READY, publicApi);
  }
});
