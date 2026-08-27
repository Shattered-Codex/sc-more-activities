import { Logger } from "../../support/Logger.js";
import { PORTAL_BEHAVIOR_TYPE } from "./ScPortalConstants.js";
import { ScPortalService } from "./ScPortalService.js";

const TOKEN_MOVE_IN = globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn";

// Foundry only exposes the region behaviour base once its data models are up.
// Falling back to the plain type model keeps the import harmless on a build
// that predates it; registration checks for the real base before wiring.
const RegionBehaviorTypeBase = foundry.data?.regionBehaviors?.RegionBehaviorType
  ?? foundry.abstract?.TypeDataModel;

/**
 * The region behaviour that makes a portal side notice a token entering it.
 *
 * This has to be a real behaviour rather than a hand-rolled `updateToken`
 * check: `TokenDocument#_splitMovementPath` only inserts a movement checkpoint
 * at a region boundary when some enabled behaviour of that region subscribes to
 * a `TOKEN_MOVE_*` or `TOKEN_ENTER` event. Without one, a token crossing the
 * portal never produces a document update while it is standing on it.
 */
export class ScPortalRegionBehavior extends RegionBehaviorTypeBase {
  static LOCALIZATION_PREFIXES = ["SCMOREACTIVITIES.Activities.ScPortal.Behavior"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      portalId: new fields.StringField({
        required: true,
        blank: false
      }),
      side: new fields.StringField({
        required: true,
        blank: false,
        choices: ["entry", "exit"]
      })
    };
  }

  /**
   * Region events are dispatched on every client. The moving client stops the
   * rest of the movement so the token does not walk on while the question is
   * open; the workflow itself is driven by the active GM alone.
   */
  static async #onTokenMoveIn(event) {
    try {
      const token = event?.data?.token;
      if (!token) {
        return;
      }

      // A displace waypoint is how the portal moves the token itself. Reacting
      // to it would send the token straight back through the far side.
      if (ScPortalRegionBehavior.#isDisplacement(event?.data?.movement)) {
        return;
      }

      // Stopping first and asking later strands the token: the exit of a one way
      // portal answers no, and the movement is already interrupted for a prompt
      // that never appears. This also covers portals whose behaviour was left
      // enabled on that side before it was created disabled.
      if (!ScPortalService.acceptsEntry(token.parent, this.portalId, this.side)) {
        return;
      }

      if (event?.user?.isSelf) {
        token.stopMovement?.();
      }

      await ScPortalService.handleRegionEntry({
        token,
        portalId: this.portalId,
        side: this.side
      });
    } catch (error) {
      Logger.warn("Could not handle the portal region entry.", error);
    }
  }

  static #isDisplacement(movement) {
    const waypoints = movement?.passed?.waypoints;
    const last = Array.isArray(waypoints) ? waypoints[waypoints.length - 1] : null;
    return last?.action === "displace";
  }

  static events = {
    [TOKEN_MOVE_IN]: ScPortalRegionBehavior.#onTokenMoveIn
  };

  /**
   * Declares the subtype with Foundry. The matching `documentTypes` entry in
   * `module.json` is what makes the type string acceptable to the document.
   */
  static register() {
    if (!foundry.data?.regionBehaviors?.RegionBehaviorType || !globalThis.CONFIG?.RegionBehavior) {
      Logger.warn("Region behaviours are unavailable; portal entry detection is disabled.");
      return false;
    }

    CONFIG.RegionBehavior.dataModels[PORTAL_BEHAVIOR_TYPE] = ScPortalRegionBehavior;
    CONFIG.RegionBehavior.typeIcons[PORTAL_BEHAVIOR_TYPE] = "fa-solid fa-dungeon";
    CONFIG.RegionBehavior.typeLabels[PORTAL_BEHAVIOR_TYPE] = "SCMOREACTIVITIES.Activities.ScPortal.Behavior.Label";
    return true;
  }
}
