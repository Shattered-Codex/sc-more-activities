import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScConditionalChainActivityData } from "./ScConditionalChainActivityData.js";
import { ScConditionalChainActivityService } from "./ScConditionalChainActivityService.js";
import { ScConditionalChainActivitySheet } from "./ScConditionalChainActivitySheet.js";

export class ScConditionalChainActivity extends dnd5e.documents.activity.ActivityMixin(ScConditionalChainActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScConditionalChain"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.CONDITIONAL_CHAIN,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-conditional-chain.svg",
      title: "SCMOREACTIVITIES.Activities.ScConditionalChain.Title",
      hint: "SCMOREACTIVITIES.Activities.ScConditionalChain.Hint",
      sheetClass: ScConditionalChainActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScConditionalChainActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(
      ACTIVITY_TYPES.CONDITIONAL_CHAIN,
      "SCMOREACTIVITIES.Activities.ScConditionalChain.Title"
    )) {
      return undefined;
    }

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    await ScConditionalChainActivityService.execute(this, { usage, dialog, message, results });
    return results;
  }
}
