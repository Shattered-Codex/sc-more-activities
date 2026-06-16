import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScGrantActivity } from "./ScGrantActivity.js";
import { ScGrantActivityData } from "./ScGrantActivityData.js";
import { ScGrantActivitySheet } from "./ScGrantActivitySheet.js";

export function registerScGrantActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.GRANT,
    label: "SCMOREACTIVITIES.Activities.ScGrant.Title",
    hint: "SCMOREACTIVITIES.Activities.ScGrant.Hint",
    icon: "modules/sc-more-activities/assets/icons/sc-grant.svg",
    documentClass: ScGrantActivity,
    dataModel: ScGrantActivityData,
    sheetClass: ScGrantActivitySheet,
    configurable: true,
    category: "support",
    ui: {
      scope: "shattered-codex",
      group: "inventory",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 120
    },
    tags: ["grant", "inventory", "item"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-grant-effect.hbs"],
    ownership: {
      execute: "item-owner",
      broadcast: "gm"
    },
    source: "built-in"
  });
}
