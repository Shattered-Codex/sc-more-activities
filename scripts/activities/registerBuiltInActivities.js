import { registerScAdvancementActivity } from "./advancement/registerScAdvancementActivity.js";
import { registerScChainActivity } from "./chain/registerScChainActivity.js";
import { registerScConditionalChainActivity } from "./conditional-chain/registerScConditionalChainActivity.js";
import { registerScContestActivity } from "./contest/registerScContestActivity.js";
import { registerScGrantActivity } from "./grant/registerScGrantActivity.js";
import { registerScHookActivity } from "./hook/registerScHookActivity.js";
import { registerScIdentifyActivity } from "./identify/registerScIdentifyActivity.js";
import { registerScMacroActivity } from "./macro/registerScMacroActivity.js";
import { registerScMovementActivity } from "./movement/registerScMovementActivity.js";
import { registerScPortalActivity } from "./portal/registerScPortalActivity.js";
import { registerScRecallActivity } from "./recall/registerScRecallActivity.js";
import { registerScSoundActivity } from "./sound/registerScSoundActivity.js";
import { registerScTeleportActivity } from "./teleport/registerScTeleportActivity.js";
import { registerScWallActivity } from "./wall/registerScWallActivity.js";

export function registerBuiltInActivities(activitiesApi) {
  return Object.freeze([
    registerScAdvancementActivity(activitiesApi),
    registerScSoundActivity(activitiesApi),
    registerScMacroActivity(activitiesApi),
    registerScHookActivity(activitiesApi),
    registerScChainActivity(activitiesApi),
    registerScConditionalChainActivity(activitiesApi),
    registerScContestActivity(activitiesApi),
    registerScGrantActivity(activitiesApi),
    registerScIdentifyActivity(activitiesApi),
    registerScTeleportActivity(activitiesApi),
    registerScMovementActivity(activitiesApi),
    registerScPortalActivity(activitiesApi),
    registerScRecallActivity(activitiesApi),
    registerScWallActivity(activitiesApi)
  ]);
}
