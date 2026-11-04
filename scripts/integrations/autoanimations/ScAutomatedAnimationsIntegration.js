import { ACTIVITY_TYPES } from "../../activities/ActivityTypes.js";
import { Logger } from "../../support/Logger.js";

const MODULE_ID = "autoanimations";

/** Activities that move tokens themselves: an Automated Animations teleport would move them again. */
const MOVING_ACTIVITY_TYPES = new Set([
  ACTIVITY_TYPES.TELEPORT,
  ACTIVITY_TYPES.MOVEMENT,
  ACTIVITY_TYPES.RECALL,
  ACTIVITY_TYPES.PORTAL
]);

/**
 * Optional coordination with Automated Animations. Its teleportation preset is
 * interactive: it draws a pulsing range ring on the token (a persistent
 * Sequencer effect named "teleportation") and waits for a click on the canvas
 * to move the token itself, ending the ring only then. When an item whose
 * name matches such an autorec (e.g. "Misty Step") uses one of this module's
 * moving activities, the activity already chose the destination and moved the
 * token, so the ring was left behind and a later click could move the token
 * again. That workflow is stopped through the hook Automated Animations
 * provides for it; its other animations still play.
 */
export class ScAutomatedAnimationsIntegration {
  static #registered = false;

  static register() {
    if (ScAutomatedAnimationsIntegration.#registered || !globalThis.game?.modules?.get?.(MODULE_ID)?.active) {
      return false;
    }
    ScAutomatedAnimationsIntegration.#registered = true;
    Hooks.on("AutomatedAnimations-WorkflowStart", (data, animationData) => {
      ScAutomatedAnimationsIntegration.onWorkflowStart(data, animationData);
    });
    return true;
  }

  static onWorkflowStart(data, animationData) {
    if (!data || !ScAutomatedAnimationsIntegration.#isTeleportPreset(animationData)) {
      return;
    }
    if (!MOVING_ACTIVITY_TYPES.has(String(data.activity?.type ?? ""))) {
      return;
    }
    data.stopWorkflow = true;
    Logger.debug(`Stopped an Automated Animations teleport for the ${data.activity.type} activity, which moves the token itself.`);
  }

  static #isTeleportPreset(animationData) {
    return animationData?.menu === "preset" && animationData?.presetType === "teleportation";
  }
}
