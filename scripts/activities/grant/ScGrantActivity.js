import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ScActivityResultTracker } from "../ScActivityResultTracker.js";
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
    const grantResult = await ScGrantActivityService.execute(this);
    ScActivityResultTracker.recordActivityResult(config, {
      kind: "grant",
      success: grantResult?.checkPassed === true ? true : (grantResult?.canceled ? false : null),
      failure: grantResult?.checkPassed === false ? true : (grantResult?.canceled ? false : null),
      total: grantResult?.check ? Number(grantResult.check.total) || 0 : null,
      target: grantResult?.check ? Number(grantResult.check.dc) || 0 : null,
      roll: grantResult?.check ? {
        kind: "grant-check",
        total: Number(grantResult.check.total) || 0,
        target: Number(grantResult.check.dc) || 0,
        success: grantResult?.checkPassed === true,
        failure: grantResult?.checkPassed === false
      } : undefined,
      activity: {
        canceled: grantResult?.canceled === true,
        reason: String(grantResult?.reason ?? "").trim(),
        checkPassed: grantResult?.checkPassed === true,
        check: grantResult?.check ? {
          dc: Number(grantResult.check.dc) || 0,
          total: Number(grantResult.check.total) || 0
        } : null,
        createdCount: Array.isArray(grantResult?.created) ? grantResult.created.length : 0,
        updatedCount: Array.isArray(grantResult?.updated) ? grantResult.updated.length : 0,
        actorUuid: String(grantResult?.actor?.uuid ?? "").trim()
      }
    });
  }
}
