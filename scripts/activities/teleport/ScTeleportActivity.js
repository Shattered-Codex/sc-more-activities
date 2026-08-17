import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
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

    const results = await super.use({
      ...usage,
      create: {
        ...usage.create,
        measuredTemplate: false
      }
    }, dialog, message);
    if (results === undefined) {
      return results;
    }

    if (!ScCanvasActivityService.getOriginTokenObject(this)) {
      ui.notifications?.warn?.(game.i18n.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin"
      ));
      return results;
    }

    new ScTeleportTargetApp(this).render(true);
    return results;
  }
}
