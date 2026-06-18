import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
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

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    new ScMovementPreviewApp(this).render(true);
    return results;
  }
}
