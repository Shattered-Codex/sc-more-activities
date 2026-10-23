import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ScActivityResultTracker } from "../ScActivityResultTracker.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScIdentifyActivityData } from "./ScIdentifyActivityData.js";
import { ScIdentifyActivityService } from "./ScIdentifyActivityService.js";
import { ScIdentifyActivitySheet } from "./ScIdentifyActivitySheet.js";

export class ScIdentifyActivity extends dnd5e.documents.activity.ActivityMixin(ScIdentifyActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScIdentify"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.IDENTIFY,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-identify.svg",
      title: "SCMOREACTIVITIES.Activities.ScIdentify.Title",
      hint: "SCMOREACTIVITIES.Activities.ScIdentify.Hint",
      sheetClass: ScIdentifyActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScIdentifyActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.IDENTIFY, "SCMOREACTIVITIES.Activities.ScIdentify.Title")) {
      return undefined;
    }

    return super.use(usage, dialog, message);
  }

  async _finalizeUsage(config, results) {
    await super._finalizeUsage(config, results);
    const result = await ScIdentifyActivityService.execute(this);
    const check = result?.check ?? null;
    ScActivityResultTracker.recordActivityResult(config, {
      kind: "identify",
      success: result?.identified === true,
      failure: result?.identified === false,
      total: check ? check.total : null,
      target: check ? check.dc : null,
      roll: check ? {
        kind: "identify-check",
        total: check.total,
        target: check.dc,
        success: result?.identified === true,
        failure: result?.identified === false
      } : undefined,
      activity: {
        canceled: result?.canceled === true,
        reason: String(result?.reason ?? "").trim(),
        identified: result?.identified === true,
        check: check ? { dc: check.dc, total: check.total } : null,
        itemUuid: String(result?.item?.uuid ?? "").trim(),
        actorUuid: String(result?.actor?.uuid ?? "").trim()
      }
    });
  }
}
