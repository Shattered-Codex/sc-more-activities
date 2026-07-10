import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScMacroActivityData } from "./ScMacroActivityData.js";
import { ScMacroActivityService } from "./ScMacroActivityService.js";
import { ScMacroActivitySheet } from "./ScMacroActivitySheet.js";
import { ScActivityResultTracker } from "../ScActivityResultTracker.js";

export class ScMacroActivity extends dnd5e.documents.activity.ActivityMixin(ScMacroActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScMacro"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.MACRO,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-macro.svg",
      title: "SCMOREACTIVITIES.Activities.ScMacro.Title",
      hint: "SCMOREACTIVITIES.Activities.ScMacro.Hint",
      sheetClass: ScMacroActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScMacroActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.MACRO, "SCMOREACTIVITIES.Activities.ScMacro.Title")) {
      return undefined;
    }

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    const execution = await ScMacroActivityService.execute(this, { usage, dialog, message, results });
    if (execution?.executed) {
      ScActivityResultTracker.recordActivityResult(usage, {
        kind: "macro",
        value: execution.value ?? null,
        macro: {
          returned: execution.value !== undefined,
          value: execution.value ?? null
        }
      });
    }
    return results;
  }
}
