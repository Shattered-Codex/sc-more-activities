import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScMacroActivityData } from "./ScMacroActivityData.js";
import { ScMacroActivityService } from "./ScMacroActivityService.js";
import { ScMacroActivitySheet } from "./ScMacroActivitySheet.js";

export class ScMacroActivity extends dnd5e.documents.activity.ActivityMixin(ScMacroActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScMacro"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.MACRO,
      img: "modules/sc-more-activities/assets/icons/sc-macro.svg",
      title: "SCMOREACTIVITIES.Activities.ScMacro.Title",
      hint: "SCMOREACTIVITIES.Activities.ScMacro.Hint",
      sheetClass: ScMacroActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScMacroActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    await ScMacroActivityService.execute(this, { usage, dialog, message, results });
    return results;
  }
}
