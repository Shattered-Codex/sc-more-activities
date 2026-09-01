import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScCanvasUsageSettlement } from "../canvas/ScCanvasUsageSettlement.js";
import { ScTeleportActivityData } from "./ScTeleportActivityData.js";
import { ScTeleportActivitySheet } from "./ScTeleportActivitySheet.js";
import { ScTeleportTargetApp } from "./ScTeleportTargetApp.js";

export class ScTeleportActivity extends dnd5e.documents.activity.ActivityMixin(ScTeleportActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScTeleport"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.TELEPORT,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-teleport.svg",
      title: "SCMOREACTIVITIES.Activities.ScTeleport.Title",
      hint: "SCMOREACTIVITIES.Activities.ScTeleport.Hint",
      sheetClass: ScTeleportActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScTeleportActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.TELEPORT, "SCMOREACTIVITIES.Activities.ScTeleport.Title")) {
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

    if (!ScCanvasActivityService.getOriginTokenObject(this)) {
      ui.notifications?.warn?.(game.i18n.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin"
      ));
      settlement?.cancel("missing-origin");
      return results;
    }

    new ScTeleportTargetApp(this, { settlement }).render(true);
    return results;
  }
}
