import { registerScChainActivity } from "./chain/registerScChainActivity.js";
import { registerScContestActivity } from "./contest/registerScContestActivity.js";
import { registerScHookActivity } from "./hook/registerScHookActivity.js";
import { registerScMacroActivity } from "./macro/registerScMacroActivity.js";
import { registerScMovementActivity } from "./movement/registerScMovementActivity.js";
import { registerScSoundActivity } from "./sound/registerScSoundActivity.js";
import { registerScTeleportActivity } from "./teleport/registerScTeleportActivity.js";
import { registerScWallActivity } from "./wall/registerScWallActivity.js";

export function registerBuiltInActivities(activitiesApi) {
  return Object.freeze([
    registerScSoundActivity(activitiesApi),
    registerScMacroActivity(activitiesApi),
    registerScHookActivity(activitiesApi),
    registerScChainActivity(activitiesApi),
    registerScContestActivity(activitiesApi),
    registerScTeleportActivity(activitiesApi),
    registerScMovementActivity(activitiesApi),
    registerScWallActivity(activitiesApi)
  ]);
}
