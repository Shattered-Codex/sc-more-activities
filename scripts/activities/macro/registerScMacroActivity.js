import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScMacroActivity } from "./ScMacroActivity.js";
import { ScMacroActivityData } from "./ScMacroActivityData.js";
import { ScMacroActivitySheet } from "./ScMacroActivitySheet.js";

export function registerScMacroActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.MACRO,
    label: "SCMOREACTIVITIES.Activities.ScMacro.Title",
    hint: "SCMOREACTIVITIES.Activities.ScMacro.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-macro.svg",
    documentClass: ScMacroActivity,
    dataModel: ScMacroActivityData,
    sheetClass: ScMacroActivitySheet,
    configurable: true,
    category: "automation",
    ui: {
      scope: "shattered-codex",
      group: "automation",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 110
    },
    tags: ["macro", "automation"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-macro-effect.hbs"],
    ownership: {
      execute: "item-owner",
      inlineCode: "activity"
    },
    source: "built-in"
  });
}
