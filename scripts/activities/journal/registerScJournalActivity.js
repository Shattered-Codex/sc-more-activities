import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScJournalActivity } from "./ScJournalActivity.js";
import { ScJournalActivityData } from "./ScJournalActivityData.js";
import { ScJournalActivitySheet } from "./ScJournalActivitySheet.js";

export function registerScJournalActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.JOURNAL,
    label: "SCMOREACTIVITIES.Activities.ScJournal.Title",
    hint: "SCMOREACTIVITIES.Activities.ScJournal.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-journal.svg",
    documentClass: ScJournalActivity,
    dataModel: ScJournalActivityData,
    sheetClass: ScJournalActivitySheet,
    configurable: true,
    category: "support",
    ui: {
      scope: "shattered-codex",
      group: "media",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 105
    },
    tags: ["journal", "utility"],
    compatibility: {
      dnd5e: ">=5.0.0 <7.0.0",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-journal-effect.hbs"],
    ownership: {
      execute: "item-owner"
    },
    source: "built-in"
  });
}
