import { Constants } from "./constants/Constants.js";
import { HOOKS } from "./constants/Hooks.js";
import { ApiPublisher } from "./api/ApiPublisher.js";
import { PublicApiFactory } from "./api/PublicApiFactory.js";
import { RegistrationApi } from "./api/RegistrationApi.js";
import { Dnd5eActivityAdapter } from "./adapters/dnd5e/Dnd5eActivityAdapter.js";
import { ActivityRegistry } from "./registry/ActivityRegistry.js";
import { registerBuiltInActivities } from "./activities/registerBuiltInActivities.js";
import { ActivityCreateDialogTabs } from "./integrations/dnd5e/ActivityCreateDialogTabs.js";
import { ScCanvasActivityService } from "./activities/canvas/ScCanvasActivityService.js";
import { ScContestActivityService } from "./activities/contest/ScContestActivityService.js";
import { ModuleSettingsRegistrar } from "./settings/ModuleSettingsRegistrar.js";
import { MoreActivitiesMigrationService } from "./migration/MoreActivitiesMigrationService.js";
import { Logger } from "./support/Logger.js";
import { ScActivityResultTracker } from "./activities/ScActivityResultTracker.js";
import { ScConditionalChainCardCustomizer } from "./activities/conditional-chain/ScConditionalChainCardCustomizer.js";

const registry = new ActivityRegistry();
const registrationApi = new RegistrationApi({ registry });
const dnd5eActivityAdapter = new Dnd5eActivityAdapter();
const settingsRegistrar = new ModuleSettingsRegistrar();
const migrationService = new MoreActivitiesMigrationService();
let publicApi = null;

Hooks.once("init", () => {
  settingsRegistrar.register();
  Logger.debug(Constants.localize("SCMOREACTIVITIES.Diagnostics.Init", "Initializing module shell."));

  if (!Constants.isDnd5eSystem()) {
    return;
  }

  ScActivityResultTracker.registerHooks();
  ScConditionalChainCardCustomizer.registerHook();
  ScContestActivityService.registerQueries();
  ScCanvasActivityService.registerQueries();
  registry.beginCollection();
  publicApi = ApiPublisher.publish(PublicApiFactory.create({
    activities: registrationApi.asPublicObject(),
    migration: migrationService.asPublicObject(),
    moduleVersion: game.modules.get(Constants.MODULE_ID)?.version
  }));

  registerBuiltInActivities(publicApi.activities);
  Hooks.callAll(HOOKS.REGISTER_ACTIVITIES, publicApi.activities);
  const report = registry.flushWith(dnd5eActivityAdapter);
  Hooks.callAll(HOOKS.REGISTRY_LOCKED, report);
  ActivityCreateDialogTabs.activate(publicApi.activities);
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
