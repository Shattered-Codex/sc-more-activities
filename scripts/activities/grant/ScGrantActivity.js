import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScGrantActivityData } from "./ScGrantActivityData.js";
import { ScGrantActivityService } from "./ScGrantActivityService.js";
import { ScGrantActivitySheet } from "./ScGrantActivitySheet.js";

export class ScGrantActivity extends dnd5e.documents.activity.ActivityMixin(ScGrantActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScGrant"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.GRANT,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-grant.svg",
      title: "SCMOREACTIVITIES.Activities.ScGrant.Title",
      hint: "SCMOREACTIVITIES.Activities.ScGrant.Hint",
      sheetClass: ScGrantActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScGrantActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.GRANT, "SCMOREACTIVITIES.Activities.ScGrant.Title")) {
      return undefined;
    }

    return super.use(usage, dialog, message);
  }

  async _finalizeUsage(config, results) {
    await super._finalizeUsage(config, results);
    await ScGrantActivityService.execute(this);
  }
}
