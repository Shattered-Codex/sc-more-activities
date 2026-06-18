import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScMovementActivity } from "./ScMovementActivity.js";
import { ScMovementActivityData } from "./ScMovementActivityData.js";
import { ScMovementActivitySheet } from "./ScMovementActivitySheet.js";

export function registerScMovementActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.MOVEMENT,
    label: "SCMOREACTIVITIES.Activities.ScMovement.Title",
    hint: "SCMOREACTIVITIES.Activities.ScMovement.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-movement.svg",
    documentClass: ScMovementActivity,
    dataModel: ScMovementActivityData,
    sheetClass: ScMovementActivitySheet,
    configurable: true,
    category: "canvas",
    ui: {
      scope: "shattered-codex",
      group: "canvas",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 190
    },
    tags: ["movement", "push", "pull", "canvas"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-movement-effect.hbs"],
    ownership: {
      execute: "item-owner",
      sceneUpdates: "gm-mediated"
    },
    source: "built-in"
  });
}
