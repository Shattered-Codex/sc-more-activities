import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScSoundActivityData } from "./ScSoundActivityData.js";
import { ScSoundActivityService } from "./ScSoundActivityService.js";
import { ScSoundActivitySheet } from "./ScSoundActivitySheet.js";

export class ScSoundActivity extends dnd5e.documents.activity.ActivityMixin(ScSoundActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScSound"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.SOUND,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-sound.svg",
      title: "SCMOREACTIVITIES.Activities.ScSound.Title",
      hint: "SCMOREACTIVITIES.Activities.ScSound.Hint",
      sheetClass: ScSoundActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScSoundActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.SOUND, "SCMOREACTIVITIES.Activities.ScSound.Title")) {
      return undefined;
    }

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    await ScSoundActivityService.play(this);
    return results;
  }
}
