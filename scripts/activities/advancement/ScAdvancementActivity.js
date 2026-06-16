import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScAdvancementActivityData } from "./ScAdvancementActivityData.js";
import { ScAdvancementActivityService } from "./ScAdvancementActivityService.js";
import { ScAdvancementActivitySheet } from "./ScAdvancementActivitySheet.js";

export class ScAdvancementActivity extends dnd5e.documents.activity.ActivityMixin(ScAdvancementActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScAdvancement"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.ADVANCEMENT,
      img: "modules/sc-more-activities/assets/icons/sc-advancement.svg",
      title: "SCMOREACTIVITIES.Activities.ScAdvancement.Title",
      hint: "SCMOREACTIVITIES.Activities.ScAdvancement.Hint",
      sheetClass: ScAdvancementActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScAdvancementActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.ADVANCEMENT, "SCMOREACTIVITIES.Activities.ScAdvancement.Title")) {
      return undefined;
    }

    return super.use(usage, dialog, message);
  }

  async _finalizeUsage(config, results) {
    await super._finalizeUsage(config, results);
    await ScAdvancementActivityService.execute(this, results);
  }
}
