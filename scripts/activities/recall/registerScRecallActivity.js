import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScRecallActivity } from "./ScRecallActivity.js";
import { ScRecallActivityData } from "./ScRecallActivityData.js";
import { ScRecallActivitySheet } from "./ScRecallActivitySheet.js";

export function registerScRecallActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.RECALL,
    label: "SCMOREACTIVITIES.Activities.ScRecall.Title",
    hint: "SCMOREACTIVITIES.Activities.ScRecall.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-recall.svg",
    documentClass: ScRecallActivity,
    dataModel: ScRecallActivityData,
    sheetClass: ScRecallActivitySheet,
    configurable: true,
    category: "canvas",
    ui: {
      scope: "shattered-codex",
      group: "canvas",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 215
    },
    tags: ["recall", "teleport", "scene", "canvas"],
    compatibility: {
      dnd5e: ">=5.0.0 <7.0.0",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-recall-effect.hbs"],
    ownership: {
      execute: "item-owner",
      broadcast: "gm"
    },
    source: "built-in"
  });
}
