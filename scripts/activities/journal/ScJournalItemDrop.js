import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScJournalActivityService } from "./ScJournalActivityService.js";

const DROP_TYPES = new Set(["JournalEntry", "JournalEntryPage"]);

/**
 * Dropping a journal entry or page on an item sheet's Activities tab creates
 * an Open Journal activity for it. Only that tab: the same drop on the
 * description belongs to its editor, which makes a link of it.
 */
export class ScJournalItemDrop {
  static registerHooks() {
    Hooks.on("dnd5e.dropItemSheetData", (item, sheet, data) => ScJournalItemDrop.onDrop(item, sheet, data));
  }

  /** The hook handler: `false` when the drop is taken here, so dnd5e does nothing more with it. */
  static onDrop(item, sheet, data) {
    const uuid = String(data?.uuid ?? "").trim();
    if (!DROP_TYPES.has(data?.type) || !uuid
      || sheet?.tabGroups?.primary !== "activities"
      || sheet.isEditable === false
      || !item?.system?.activities
      || !ActivityAvailability.isTypeEnabled(ACTIVITY_TYPES.JOURNAL)) {
      return undefined;
    }
    ScJournalItemDrop.create(item, uuid);
    return false;
  }

  /** Creates the activity on `item`, named after the journal or page, and opens its sheet. */
  static async create(item, uuid) {
    const target = await ScJournalActivityService.targetFromUuid(uuid);
    if (!target) {
      return null;
    }
    try {
      return await item.createActivity(ACTIVITY_TYPES.JOURNAL, {
        name: target.name,
        journal: { uuid: target.uuid, pageId: target.pageId }
      });
    } catch (error) {
      Logger.error("Could not create an sc-journal activity from the dropped journal.", error);
      ui.notifications?.error?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScJournal.Error.CreateFailed",
        { error: error?.message ?? String(error) },
        `Could not create the activity: ${error?.message ?? String(error)}`
      ));
      return null;
    }
  }
}
