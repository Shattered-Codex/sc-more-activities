import { Constants } from "../../constants/Constants.js";

/** Region behaviour subtype declared by this module in `module.json`. */
export const PORTAL_BEHAVIOR_TYPE = `${Constants.MODULE_ID}.scPortal`;

/** Flag key holding the portal descriptor on regions and art tiles. */
export const PORTAL_FLAG_KEY = "portal";

export const PORTAL_SIDES = Object.freeze({
  ENTRY: "entry",
  EXIT: "exit"
});
