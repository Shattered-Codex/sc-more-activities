import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScChainActivity } from "./ScChainActivity.js";
import { ScChainActivityData } from "./ScChainActivityData.js";
import { ScChainActivitySheet } from "./ScChainActivitySheet.js";

export function registerScChainActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.CHAIN,
    label: "SCMOREACTIVITIES.Activities.ScChain.Title",
    hint: "SCMOREACTIVITIES.Activities.ScChain.Hint",
    icon: "modules/sc-more-activities/assets/icons/sc-chain.svg",
    documentClass: ScChainActivity,
    dataModel: ScChainActivityData,
    sheetClass: ScChainActivitySheet,
    configurable: true,
    category: "automation",
    ui: {
      scope: "shattered-codex",
      group: "automation",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 130
    },
    tags: ["chain", "flow", "automation"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-chain-effect.hbs"],
    ownership: {
      execute: "item-owner",
      targets: "same-item-activities"
    },
    source: "built-in"
  });
}
