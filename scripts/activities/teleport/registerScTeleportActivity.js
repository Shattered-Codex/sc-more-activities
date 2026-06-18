import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScTeleportActivity } from "./ScTeleportActivity.js";
import { ScTeleportActivityData } from "./ScTeleportActivityData.js";
import { ScTeleportActivitySheet } from "./ScTeleportActivitySheet.js";

export function registerScTeleportActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.TELEPORT,
    label: "SCMOREACTIVITIES.Activities.ScTeleport.Title",
    hint: "SCMOREACTIVITIES.Activities.ScTeleport.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-teleport.svg",
    documentClass: ScTeleportActivity,
    dataModel: ScTeleportActivityData,
    sheetClass: ScTeleportActivitySheet,
    configurable: true,
    category: "canvas",
    ui: {
      scope: "shattered-codex",
      group: "canvas",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 180
    },
    tags: ["teleport", "token", "canvas"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-teleport-effect.hbs"],
    ownership: {
      execute: "item-owner",
      sceneUpdates: "gm-mediated"
    },
    source: "built-in"
  });
}
