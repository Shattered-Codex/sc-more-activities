import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ScActivityResultTracker } from "../ScActivityResultTracker.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScRecallActivityData } from "./ScRecallActivityData.js";
import { ScRecallActivitySheet } from "./ScRecallActivitySheet.js";
import { ScRecallService } from "./ScRecallService.js";

export class ScRecallActivity extends dnd5e.documents.activity.ActivityMixin(ScRecallActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScRecall"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.RECALL,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-recall.svg",
      title: "SCMOREACTIVITIES.Activities.ScRecall.Title",
      hint: "SCMOREACTIVITIES.Activities.ScRecall.Hint",
      sheetClass: ScRecallActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScRecallActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.RECALL, "SCMOREACTIVITIES.Activities.ScRecall.Title")) {
      return undefined;
    }

    return super.use(usage, dialog, message);
  }

  async _finalizeUsage(config, results) {
    await super._finalizeUsage(config, results);
    const result = await ScRecallService.execute(this);
    const travelled = Number(result?.travelled) || 0;
    const portalOpened = result?.action === "portal" && !result.reason;
    ScActivityResultTracker.recordActivityResult(config, {
      kind: "recall",
      success: result?.canceled ? false : (result?.action === "bind" || portalOpened || travelled > 0),
      failure: result?.canceled ? false : (result?.action !== "bind" && !portalOpened && travelled === 0),
      total: result?.action === "travel" ? travelled : null,
      activity: {
        canceled: result?.canceled === true,
        reason: String(result?.reason ?? "").trim(),
        action: String(result?.action ?? "").trim(),
        travelledCount: travelled,
        sceneUuid: String(result?.sceneUuid ?? "").trim()
      }
    });
  }
}
