import { registerScMacroActivity } from "./macro/registerScMacroActivity.js";
import { registerScSoundActivity } from "./sound/registerScSoundActivity.js";

export function registerBuiltInActivities(activitiesApi) {
  return Object.freeze([
    registerScSoundActivity(activitiesApi),
    registerScMacroActivity(activitiesApi)
  ]);
}
