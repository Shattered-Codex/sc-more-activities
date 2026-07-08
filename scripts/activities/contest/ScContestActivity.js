import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ScActivityResultTracker } from "../ScActivityResultTracker.js";
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
    if (contestResult && !contestResult.canceled) {
      ScActivityResultTracker.recordActivityResult(usage, {
        kind: "contest",
        success: contestResult?.outcome?.winner === "initiator",
        failure: contestResult?.outcome?.winner === "defender",
        activity: {
          canceled: false,
          winner: String(contestResult?.outcome?.winner ?? ""),
          tied: contestResult?.outcome?.tied === true,
          attempt: Number(contestResult?.attempt) || 0
        },
        contest: {
          winner: String(contestResult?.outcome?.winner ?? ""),
          tied: contestResult?.outcome?.tied === true,
          initiator: {
            total: Number(contestResult?.initiator?.roll?.total) || 0,
            actorUuid: String(contestResult?.initiator?.actor?.uuid ?? ""),
            tokenUuid: String(contestResult?.initiator?.token?.document?.uuid ?? contestResult?.initiator?.token?.uuid ?? "")
          },
          defender: {
            total: Number(contestResult?.defender?.roll?.total) || 0,
            actorUuid: String(contestResult?.defender?.actor?.uuid ?? ""),
            tokenUuid: String(contestResult?.defender?.token?.document?.uuid ?? contestResult?.defender?.token?.uuid ?? "")
          }
        }
      });
    }
    return contestResult?.canceled ? undefined : results;
  }
}
