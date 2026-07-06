import { Constants } from "../../constants/Constants.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScConditionalChainActivity } from "./ScConditionalChainActivity.js";
import { ScConditionalChainActivityData } from "./ScConditionalChainActivityData.js";
import { ScConditionalChainActivitySheet } from "./ScConditionalChainActivitySheet.js";

export function registerScConditionalChainActivity(activitiesApi) {
  return activitiesApi.registerType({
    moduleId: Constants.MODULE_ID,
    type: ACTIVITY_TYPES.CONDITIONAL_CHAIN,
    label: "SCMOREACTIVITIES.Activities.ScConditionalChain.Title",
    hint: "SCMOREACTIVITIES.Activities.ScConditionalChain.Hint",
    icon: "modules/sc-more-activities/assets/icons/game-icons-net/sc-conditional-chain.svg",
    documentClass: ScConditionalChainActivity,
    dataModel: ScConditionalChainActivityData,
    sheetClass: ScConditionalChainActivitySheet,
    configurable: true,
    category: "automation",
    ui: {
      scope: "shattered-codex",
      group: "automation",
      groupId: "shattered-codex",
      groupLabel: "SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex",
      groupIcon: "fa-solid fa-book-sparkles",
      groupOrder: 100,
      order: 131
    },
    tags: ["chain", "conditional", "flow", "branching", "automation"],
    compatibility: {
      dnd5e: "5.x",
      conditionalActivities: true
    },
    templates: ["modules/sc-more-activities/templates/activity-parts/sc-conditional-chain-effect.hbs"],
    ownership: {
      execute: "item-owner",
      targets: "same-item-activities"
    },
    source: "built-in"
  });
}
