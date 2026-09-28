import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

/**
 * Places an activity's area at a chosen point, without the system's
 * interactive preview.
 *
 * dnd5e 6 represents areas as scene Regions built by `TemplatePlacement`, which
 * only places interactively, so the region is assembled here from the same
 * sizes, data, flags and hooks the system uses. dnd5e 5.3 still builds a
 * measured template through `AbilityTemplate.fromActivity`, which owns every
 * rule about cones, cubes and rays; there this only supplies the centre.
 *
 * Only shapes with no orientation qualify. A cone or a ray is aimed by the
 * player while placing it, and skipping the preview would leave it pointing
 * wherever the default direction happens to be, so those keep the system's
 * own placement.
 */
export class ScTemplatePlacement {
  /** Foundry template shapes whose orientation the player chooses. */
  static DIRECTIONAL_SHAPES = Object.freeze(["cone", "ray"]);

  /**
   * dnd5e 6 shapes the system attaches to the usage token while placing them.
   * Dropping one on a point would detach it from the token it should follow.
   */
  static TOKEN_ATTACHED_SHAPES = Object.freeze(["emanation"]);

  static #abilityTemplate() {
    return globalThis.dnd5e?.canvas?.AbilityTemplate ?? null;
  }

  static #usesRegions() {
    return Boolean(globalThis.dnd5e?.canvas?.TemplatePlacement);
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
   * orientation or the token attachment away from the player.
   */
  static supportsPoint(activity) {
    const shape = ScTemplatePlacement.shapeFor(activity);
    if (!shape || ScTemplatePlacement.TOKEN_ATTACHED_SHAPES.includes(shape)) {
      return false;
    }
    return !ScTemplatePlacement.isDirectional(shape, {
      gridAlignedSquares: ScTemplatePlacement.#gridAlignedSquares()
    });
  }

  /**
   * @returns {Promise<object[]>} the created region or template documents. An
   *   empty array means nothing was placed, which the caller must surface: the
   *   interactive placement was already suppressed, so silence would leave the
   *   step with no area and no explanation.
   */
  static async place(activity, point, { scene = globalThis.canvas?.scene } = {}) {
    if (!scene || !point) {
      return [];
    }

    const origin = {
      x: Math.round(Number(point.x) || 0),
      y: Math.round(Number(point.y) || 0)
    };
    try {
      return ScTemplatePlacement.#usesRegions()
        ? await ScTemplatePlacement.#placeRegion(activity, origin, scene)
        : await ScTemplatePlacement.#placeMeasuredTemplate(activity, origin, scene);
    } catch (error) {
      Logger.error("Could not place a chain step's area.", error);
      return [];
    }
  }

  static async #placeMeasuredTemplate(activity, origin, scene) {
    const AbilityTemplate = ScTemplatePlacement.#abilityTemplate();
    if (!AbilityTemplate?.fromActivity) {
      return [];
    }

    const templates = AbilityTemplate.fromActivity(activity, origin);
    const data = Array.from(templates ?? [])
      .map((template) => template?.document?.toObject?.())
      .filter(Boolean);
    if (!data.length) {
      return [];
    }
    return await scene.createEmbeddedDocuments("MeasuredTemplate", data) ?? [];
  }

  /**
   * Mirrors `TemplatePlacement.fromActivity` for a known point. The dnd5e
   * flags matter beyond bookkeeping: the system attaches the activity's region
   * behaviors when a region carrying them is created.
   */
  static async #placeRegion(activity, origin, scene) {
    const type = ScTemplatePlacement.shapeFor(activity);
    if (!type) {
      return [];
    }

    const template = activity?.target?.template ?? {};
    const grid = scene.grid ?? {};
    const sizes = {
      size: ScTemplatePlacement.#toSceneUnits(template.size, template.units, grid.units),
      width: ScTemplatePlacement.#toSceneUnits(template.width, template.units, grid.units),
      height: ScTemplatePlacement.#toSceneUnits(template.height, template.units, grid.units)
    };
    const config = {
      color: globalThis.game?.user?.color,
      shapes: Array.from({ length: Math.max(1, Number(template.count) || 1) }, () => ({ type, ...sizes }))
    };
    if (globalThis.Hooks?.call?.("dnd5e.preCreateMeasuredTemplate", activity, config) === false) {
      return [];
    }

    // Every shape lands on the same point; the interactive placement is what
    // would have spread several of them out.
    const shapes = config.shapes
      .map((shape) => ScTemplatePlacement.#shapeData(shape, origin, grid))
      .filter(Boolean);
    if (!shapes.length) {
      return [];
    }

    const levelId = globalThis.canvas?.scene === scene ? globalThis.canvas?.level?.id : null;
    const regionData = {
      name: `${activity?.item?.name ?? activity?.name ?? ""} [${globalThis.game?.user?.name ?? ""}]`,
      color: globalThis.game?.user?.color,
      shapes,
      ...(levelId ? { levels: [levelId] } : {}),
      restriction: { enabled: true, type: "move" },
      visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS,
      highlightMode: "coverage",
      flags: {
        dnd5e: {
          activity: activity?.uuid,
          dimensions: { ...sizes, units: grid.units },
          item: activity?.item?.uuid,
          origin: activity?.getUsageToken?.()?.uuid,
          spellLevel: activity?.getRollData?.()?.item?.level
        }
      }
    };
    // Same array for the hook and the creation, so listeners can edit, add or drop entries.
    const regions = [regionData];
    if (globalThis.Hooks?.call?.("dnd5e.createMeasuredTemplate", activity, regions) === false) {
      return [];
    }

    const created = await scene.createEmbeddedDocuments("Region", regions) ?? [];
    globalThis.Hooks?.callAll?.("dnd5e.postCreateMeasuredTemplate", activity, created);
    return created;
  }

  static #toSceneUnits(value, from, to) {
    const number = Number(value);
    if (!value || !Number.isFinite(number)) {
      return undefined;
    }
    const convert = globalThis.dnd5e?.utils?.convertLength;
    return typeof convert === "function" ? convert(number, from, to, { strict: false }) : number;
  }

  /** Shape data for the orientation-free areas, positioned at `origin`. */
  static #shapeData({ type, size, width }, origin, grid) {
    const pixelsPerUnit = Number(grid.size) / Number(grid.distance);
    const data = { ...origin, rotation: 0, type };
    switch (type) {
      case "circle":
        return { ...data, radius: size * pixelsPerUnit };
      case "rect":
      case "rectangle":
        return { ...data, width: size * pixelsPerUnit, height: size * pixelsPerUnit, type: "rectangle" };
      case "ring":
        return { ...data, radius: size * pixelsPerUnit, outerWidth: width * pixelsPerUnit, innerWidth: 0 };
      default:
        return null;
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
