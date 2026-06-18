import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScContestActivity } from "./ScContestActivity.js";
import { ScContestActivityData } from "./ScContestActivityData.js";
import { ScContestActivitySheet } from "./ScContestActivitySheet.js";

export function registerScContestActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.CONTEST,
    label: "SCMOREACTIVITIES.Activities.ScContest.Title",
    hint: "SCMOREACTIVITIES.Activities.ScContest.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-contest.svg",
    documentClass: ScContestActivity,
    dataModel: ScContestActivityData,
    sheetClass: ScContestActivitySheet,
    configurable: true,
    category: "automation",
    ui: {
      scope: "shattered-codex",
      group: "automation",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 140
    },
    tags: ["contest", "roll", "automation"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: [
      "modules/sc-more-activities/templates/activity-parts/sc-contest-effect.hbs",
      "modules/sc-more-activities/templates/activity-parts/sc-contest-participant.hbs"
    ],
    ownership: {
      execute: "item-owner",
      targets: "single-target"
    },
    source: "built-in"
  });
}
