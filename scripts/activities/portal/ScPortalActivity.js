import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScCanvasUsageSettlement } from "../canvas/ScCanvasUsageSettlement.js";
import { ScPortalActivityData } from "./ScPortalActivityData.js";
import { ScPortalActivitySheet } from "./ScPortalActivitySheet.js";
import { ScPortalConfig } from "./ScPortalConfig.js";
import { ScPortalPlacementApp } from "./ScPortalPlacementApp.js";

export class ScPortalActivity extends dnd5e.documents.activity.ActivityMixin(ScPortalActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScPortal"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.PORTAL,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-portal.svg",
      title: "SCMOREACTIVITIES.Activities.ScPortal.Title",
      hint: "SCMOREACTIVITIES.Activities.ScPortal.Hint",
      sheetClass: ScPortalActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScPortalActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.PORTAL, "SCMOREACTIVITIES.Activities.ScPortal.Title")) {
      return undefined;
    }

    // Declared before super.use(): dnd5e finalizes the tracked record from its
    // postUseActivity hook, and a record already finalized can no longer be
    // held open — the chain would move on while the window is still up.
    const settlement = ScCanvasUsageSettlement.begin(usage);

    const results = await super.use({
      ...usage,
      create: {
        ...usage.create,
        measuredTemplate: false
      }
    }, dialog, message);
    if (results === undefined) {
      settlement?.cancel("usage-canceled");
      return results;
    }

    // The origin token only matters when the placement is range limited; an
    // unlimited portal can be dropped anywhere on the scene.
    const requiresOrigin = ScPortalConfig.fromActivity(this).placementRange > 0;
    if (requiresOrigin && !ScCanvasActivityService.getOriginTokenObject(this)) {
      ui.notifications?.warn?.(game.i18n.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin"
      ));
      settlement?.cancel("missing-origin");
      return results;
    }

    new ScPortalPlacementApp(this, { settlement }).render(true);
    return results;
  }
}
