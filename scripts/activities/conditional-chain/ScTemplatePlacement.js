import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

/**
 * Places an activity's measured template at a chosen point, without the
 * system's interactive preview.
 *
 * The shape is still built by `AbilityTemplate.fromActivity`, which accepts
 * overrides and owns every rule about cones, cubes and rays — this only
 * supplies the centre and creates the document the preview would have created.
 *
 * Only shapes with no orientation qualify. A cone or a ray is aimed by the
 * player while placing it, and skipping the preview would leave it pointing
 * wherever the default direction happens to be, so those keep the system's
 * own placement.
 */
export class ScTemplatePlacement {
  /** Foundry template shapes whose orientation the player chooses. */
  static DIRECTIONAL_SHAPES = Object.freeze(["cone", "ray"]);

  static #abilityTemplate() {
    return globalThis.dnd5e?.canvas?.AbilityTemplate ?? null;
  }

  /** The Foundry shape an activity's area maps to, or null when it has none. */
  static shapeFor(activity) {
    const type = activity?.target?.template?.type;
    if (!type) {
      return null;
    }
    return globalThis.dnd5e?.config?.areaTargetTypes?.[type]?.template ?? null;
  }

  /**
   * dnd5e renders a cube as a rotatable ray unless square templates are grid
   * aligned, in which case the direction is pinned at 45° and the shape has no
   * orientation left to choose.
   */
  static #gridAlignedSquares() {
    try {
      return globalThis.game?.settings?.get?.("dnd5e", "gridAlignedSquareTemplates") === true;
    } catch {
      return false;
    }
  }

  static isDirectional(shape, { gridAlignedSquares = false } = {}) {
    if (shape === "rect") {
      return !gridAlignedSquares;
    }
    return ScTemplatePlacement.DIRECTIONAL_SHAPES.includes(shape);
  }

  /** Whether the activity defines an area at all. */
  static hasTemplate(activity) {
    return Boolean(activity?.target?.template?.type);
  }

  /**
   * Whether this activity's area can be dropped on a point without taking the
   * orientation away from the player.
   */
  static supportsPoint(activity) {
    const shape = ScTemplatePlacement.shapeFor(activity);
    if (!shape) {
      return false;
    }
    return !ScTemplatePlacement.isDirectional(shape, {
      gridAlignedSquares: ScTemplatePlacement.#gridAlignedSquares()
    });
  }

  /**
   * @returns {Promise<object[]>} the created template documents. An empty array
   *   means nothing was placed, which the caller must surface: the interactive
   *   placement was already suppressed, so silence would leave the step with no
   *   area and no explanation.
   */
  static async place(activity, point, { scene = globalThis.canvas?.scene } = {}) {
    const AbilityTemplate = ScTemplatePlacement.#abilityTemplate();
    if (!AbilityTemplate?.fromActivity || !scene || !point) {
      return [];
    }

    try {
      const templates = AbilityTemplate.fromActivity(activity, {
        x: Math.round(Number(point.x) || 0),
        y: Math.round(Number(point.y) || 0)
      });
      const data = Array.from(templates ?? [])
        .map((template) => template?.document?.toObject?.())
        .filter(Boolean);
      if (!data.length) {
        return [];
      }
      return await scene.createEmbeddedDocuments("MeasuredTemplate", data) ?? [];
    } catch (error) {
      Logger.error("Could not place a chain step's measured template.", error);
      return [];
    }
  }

  /** Tells the user the area never landed, rather than leaving them guessing. */
  static warnPlacementFailed(activity) {
    ui?.notifications?.warn?.(Constants.format(
      "SCMOREACTIVITIES.Activities.ScConditionalChain.Warning.TemplateNotPlaced",
      { activity: activity?.name ?? "" },
      `Could not place the area for ${activity?.name ?? "this step"}. Place it manually.`
    ));
  }
}
