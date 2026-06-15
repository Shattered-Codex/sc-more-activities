import { Constants } from "./Constants.js";

export const HOOKS = Object.freeze({
  REGISTER_ACTIVITIES: `${Constants.MODULE_ID}.registerActivities`,
  REGISTRY_LOCKED: `${Constants.MODULE_ID}.registryLocked`,
  API_READY: `${Constants.MODULE_ID}.apiReady`,
  ACTIVITY_REGISTERED: `${Constants.MODULE_ID}.activityRegistered`,
  ACTIVITY_USE_START: `${Constants.MODULE_ID}.activityUseStart`,
  ACTIVITY_USE_COMPLETE: `${Constants.MODULE_ID}.activityUseComplete`,
  ACTIVITY_USE_ERROR: `${Constants.MODULE_ID}.activityUseError`
});
