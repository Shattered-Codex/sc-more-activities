import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScHookActivityData } from "./ScHookActivityData.js";
import { ScHookActivityService } from "./ScHookActivityService.js";
import { ScHookActivitySheet } from "./ScHookActivitySheet.js";

export class ScHookActivity extends dnd5e.documents.activity.ActivityMixin(ScHookActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScHook"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.HOOK,
      img: "modules/sc-more-activities/assets/icons/sc-hook.svg",
      title: "SCMOREACTIVITIES.Activities.ScHook.Title",
      hint: "SCMOREACTIVITIES.Activities.ScHook.Hint",
      sheetClass: ScHookActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScHookActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.HOOK, "SCMOREACTIVITIES.Activities.ScHook.Title")) {
      return undefined;
    }

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    await ScHookActivityService.dispatch(this, { usage, dialog, message, results });
    return results;
  }
}
