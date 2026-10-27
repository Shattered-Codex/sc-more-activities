import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScIdentifyActivity } from "./ScIdentifyActivity.js";
import { ScIdentifyActivityData } from "./ScIdentifyActivityData.js";
import { ScIdentifyActivitySheet } from "./ScIdentifyActivitySheet.js";

export function registerScIdentifyActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.IDENTIFY,
    label: "SCMOREACTIVITIES.Activities.ScIdentify.Title",
    hint: "SCMOREACTIVITIES.Activities.ScIdentify.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-identify.svg",
    documentClass: ScIdentifyActivity,
    dataModel: ScIdentifyActivityData,
    sheetClass: ScIdentifyActivitySheet,
    configurable: true,
    category: "support",
    ui: {
      scope: "shattered-codex",
      group: "inventory",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 125
    },
    tags: ["identify", "inventory", "item"],
    compatibility: {
      dnd5e: ">=5.0.0 <7.0.0",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-identify-effect.hbs"],
    ownership: {
      execute: "item-owner",
      broadcast: "gm"
    },
    source: "built-in"
  });
}
