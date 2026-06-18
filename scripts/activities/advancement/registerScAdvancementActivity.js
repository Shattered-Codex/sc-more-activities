import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScAdvancementActivity } from "./ScAdvancementActivity.js";
import { ScAdvancementActivityData } from "./ScAdvancementActivityData.js";
import { ScAdvancementActivitySheet } from "./ScAdvancementActivitySheet.js";

export function registerScAdvancementActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.ADVANCEMENT,
    label: "SCMOREACTIVITIES.Activities.ScAdvancement.Title",
    hint: "SCMOREACTIVITIES.Activities.ScAdvancement.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-advancement.svg",
    documentClass: ScAdvancementActivity,
    dataModel: ScAdvancementActivityData,
    sheetClass: ScAdvancementActivitySheet,
    configurable: true,
    category: "support",
    ui: {
      scope: "shattered-codex",
      group: "progression",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 130
    },
    tags: ["advancement", "progression", "item"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-advancement-effect.hbs"],
    ownership: {
      execute: "item-owner",
      broadcast: "gm"
    },
    source: "built-in"
  });
}
