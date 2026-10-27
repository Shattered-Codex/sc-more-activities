import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScJournalActivityData } from "./ScJournalActivityData.js";
import { ScJournalActivityService } from "./ScJournalActivityService.js";
import { ScJournalActivitySheet } from "./ScJournalActivitySheet.js";

export class ScJournalActivity extends dnd5e.documents.activity.ActivityMixin(ScJournalActivityData) {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "SCMOREACTIVITIES.Activities.ScJournal"];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: ACTIVITY_TYPES.JOURNAL,
      img: "modules/sc-more-activities/assets/icons/game-icons-net/sc-journal.svg",
      title: "SCMOREACTIVITIES.Activities.ScJournal.Title",
      hint: "SCMOREACTIVITIES.Activities.ScJournal.Hint",
      sheetClass: ScJournalActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScJournalActivityData.defineSchema();
  }

  async use(usage = {}, dialog = {}, message = {}) {
    if (!ActivityAvailability.canUseType(ACTIVITY_TYPES.JOURNAL, "SCMOREACTIVITIES.Activities.ScJournal.Title")) {
      return undefined;
    }

    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    await ScJournalActivityService.open(this);
    return results;
  }
}
