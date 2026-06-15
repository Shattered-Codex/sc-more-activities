import { registerScChainActivity } from "./chain/registerScChainActivity.js";
import { registerScHookActivity } from "./hook/registerScHookActivity.js";
import { registerScMacroActivity } from "./macro/registerScMacroActivity.js";
import { registerScSoundActivity } from "./sound/registerScSoundActivity.js";

export function registerBuiltInActivities(activitiesApi) {
  return Object.freeze([
    registerScSoundActivity(activitiesApi),
    registerScMacroActivity(activitiesApi),
    registerScHookActivity(activitiesApi),
    registerScChainActivity(activitiesApi)
  ]);
}
