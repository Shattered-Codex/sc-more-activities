import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScWallActivity } from "./ScWallActivity.js";
import { ScWallActivityData } from "./ScWallActivityData.js";
import { ScWallActivitySheet } from "./ScWallActivitySheet.js";

export function registerScWallActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.WALL,
    label: "SCMOREACTIVITIES.Activities.ScWall.Title",
    hint: "SCMOREACTIVITIES.Activities.ScWall.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-wall.svg",
    documentClass: ScWallActivity,
    dataModel: ScWallActivityData,
    sheetClass: ScWallActivitySheet,
    configurable: true,
    category: "canvas",
    ui: {
      scope: "shattered-codex",
      group: "canvas",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 200
    },
    tags: ["wall", "canvas", "scene"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-wall-effect.hbs"],
    ownership: {
      execute: "item-owner",
      sceneUpdates: "gm-mediated"
    },
    source: "built-in"
  });
}
