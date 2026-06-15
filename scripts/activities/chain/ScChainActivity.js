import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScChainActivityData } from "./ScChainActivityData.js";
import { ScChainActivityService } from "./ScChainActivityService.js";
import { ScChainActivitySheet } from "./ScChainActivitySheet.js";

export class ScChainActivity extends dnd5e.documents.activity.ActivityMixin(ScChainActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScChain"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.CHAIN,
      img: "modules/sc-more-activities/assets/icons/sc-chain.svg",
      title: "SCMOREACTIVITIES.Activities.ScChain.Title",
      hint: "SCMOREACTIVITIES.Activities.ScChain.Hint",
      sheetClass: ScChainActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScChainActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.CHAIN, "SCMOREACTIVITIES.Activities.ScChain.Title")) {
      return undefined;
    }

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    await ScChainActivityService.execute(this, { usage, dialog, message, results });
    return results;
  }
}
