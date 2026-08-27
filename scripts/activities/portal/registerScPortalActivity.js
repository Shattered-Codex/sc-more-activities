import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScPortalActivity } from "./ScPortalActivity.js";
import { ScPortalActivityData } from "./ScPortalActivityData.js";
import { ScPortalActivitySheet } from "./ScPortalActivitySheet.js";

export function registerScPortalActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.PORTAL,
    label: "SCMOREACTIVITIES.Activities.ScPortal.Title",
    hint: "SCMOREACTIVITIES.Activities.ScPortal.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-portal.svg",
    documentClass: ScPortalActivity,
    dataModel: ScPortalActivityData,
    sheetClass: ScPortalActivitySheet,
    configurable: true,
    category: "canvas",
    ui: {
      scope: "shattered-codex",
      group: "canvas",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 210
    },
    tags: ["portal", "teleport", "canvas", "scene"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-portal-effect.hbs"],
    ownership: {
      execute: "item-owner",
      sceneUpdates: "gm-mediated"
    },
    source: "built-in"
  });
}
