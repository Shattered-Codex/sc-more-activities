import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScCanvasUsageSettlement } from "../canvas/ScCanvasUsageSettlement.js";
import { ScMovementActivityData } from "./ScMovementActivityData.js";
import { ScMovementPreviewApp } from "./ScMovementPreviewApp.js";
import { ScMovementActivitySheet } from "./ScMovementActivitySheet.js";

export class ScMovementActivity extends dnd5e.documents.activity.ActivityMixin(ScMovementActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScMovement"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.MOVEMENT,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-movement.svg",
      title: "SCMOREACTIVITIES.Activities.ScMovement.Title",
      hint: "SCMOREACTIVITIES.Activities.ScMovement.Hint",
      sheetClass: ScMovementActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScMovementActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.MOVEMENT, "SCMOREACTIVITIES.Activities.ScMovement.Title")) {
      return undefined;
    }

    // Declared before super.use(): dnd5e finalizes the tracked record from its
    // postUseActivity hook, and a record already finalized can no longer be
    // held open — the chain would move on while the window is still up.
    const settlement = ScCanvasUsageSettlement.begin(usage);

    const results = await super.use(usage, dialog, message);
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

    new ScMovementPreviewApp(this, { settlement }).render(true);
    return results;
  }
}
