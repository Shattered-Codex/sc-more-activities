import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScContestActivityData } from "./ScContestActivityData.js";
import { ScContestActivityService } from "./ScContestActivityService.js";
import { ScContestActivitySheet } from "./ScContestActivitySheet.js";

export class ScContestActivity extends dnd5e.documents.activity.ActivityMixin(ScContestActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScContest"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.CONTEST,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-contest.svg",
      title: "SCMOREACTIVITIES.Activities.ScContest.Title",
      hint: "SCMOREACTIVITIES.Activities.ScContest.Hint",
      sheetClass: ScContestActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScContestActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.CONTEST, "SCMOREACTIVITIES.Activities.ScContest.Title")) {
      return undefined;
    }

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    const contestResult = await ScContestActivityService.execute(this, { usage, dialog, message, results });
    return contestResult?.canceled ? undefined : results;
  }
}
