import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScWallActivityData } from "./ScWallActivityData.js";
import { ScWallPlacementApp } from "./ScWallPlacementApp.js";
import { ScWallActivitySheet } from "./ScWallActivitySheet.js";

export class ScWallActivity extends dnd5e.documents.activity.ActivityMixin(ScWallActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScWall"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.WALL,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-wall.svg",
      title: "SCMOREACTIVITIES.Activities.ScWall.Title",
      hint: "SCMOREACTIVITIES.Activities.ScWall.Hint",
      sheetClass: ScWallActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScWallActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.WALL, "SCMOREACTIVITIES.Activities.ScWall.Title")) {
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

    new ScWallPlacementApp(this).render(true);
    return results;
  }
}
