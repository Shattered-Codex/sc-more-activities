import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScSoundActivity } from "./ScSoundActivity.js";
import { ScSoundActivityData } from "./ScSoundActivityData.js";
import { ScSoundActivitySheet } from "./ScSoundActivitySheet.js";

export function registerScSoundActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.SOUND,
    label: "SCMOREACTIVITIES.Activities.ScSound.Title",
    hint: "SCMOREACTIVITIES.Activities.ScSound.Hint",
    icon: "modules/sc-more-activities/assets/icons/sc-sound.svg",
    documentClass: ScSoundActivity,
    dataModel: ScSoundActivityData,
    sheetClass: ScSoundActivitySheet,
    configurable: true,
    category: "support",
    ui: {
      scope: "shattered-codex",
      group: "media",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 100
    },
    tags: ["audio", "utility"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-sound-effect.hbs"],
    ownership: {
      execute: "item-owner",
      broadcast: "gm"
    },
    source: "built-in"
  });
}
