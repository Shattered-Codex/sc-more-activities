import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScHookActivity } from "./ScHookActivity.js";
import { ScHookActivityData } from "./ScHookActivityData.js";
import { ScHookActivitySheet } from "./ScHookActivitySheet.js";

export function registerScHookActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.HOOK,
    label: "SCMOREACTIVITIES.Activities.ScHook.Title",
    hint: "SCMOREACTIVITIES.Activities.ScHook.Hint",
    icon: "modules/sc-more-activities/assets/icons/sc-hook.svg",
    documentClass: ScHookActivity,
    dataModel: ScHookActivityData,
    sheetClass: ScHookActivitySheet,
    configurable: true,
    category: "automation",
    ui: {
      scope: "shattered-codex",
      group: "automation",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 120
    },
    tags: ["hook", "developer", "automation"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-hook-effect.hbs"],
    ownership: {
      execute: "item-owner",
      callbackWhitelist: "module-api"
    },
    source: "built-in"
  });
}
