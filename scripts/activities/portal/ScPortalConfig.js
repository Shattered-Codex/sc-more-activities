import { ScCanvasFormula } from "../canvas/ScCanvasFormula.js";

export class ScPortalConfig {
  static fromActivity(activity) {
    const config = activity?.portal ?? {};
    const item = activity?.item ?? null;
    return {
      placementRange: ScCanvasFormula.resolveNumber(config.placementRange, item, 30, { min: 0 }),
      linkRange: ScCanvasFormula.resolveLimit(config.linkRange, item),
      shape: config.shape === "circle" ? "circle" : "square",
      squares: ScPortalConfig.#squares(config.size),
      snapToGrid: config.snapToGrid !== false,
      avoidOccupied: config.avoidOccupied !== false,
      oneWay: Boolean(config.oneWay),
      triggerOnEnter: config.triggerOnEnter !== false,
      triggerOnClick: config.triggerOnClick !== false,
      maxUses: ScPortalConfig.#positiveLimit(config.maxUses, item),
      durationRounds: ScCanvasFormula.resolveNumber(config.durationRounds, item, 0, { min: 0 }),
      visibility: ["gm", "hidden"].includes(config.visibility) ? config.visibility : "all",
      color: ScPortalConfig.#hexColor(config.color, "#8a63d2"),
      entryImage: String(config.entryImage ?? "").trim(),
      exitImage: String(config.exitImage ?? "").trim(),
      allowPlayerRequests: config.allowPlayerRequests !== false
    };
  }

  /** Portal footprint in grid squares, clamped to the choices the sheet offers. */
  static #squares(value) {
    const squares = Math.floor(Number(String(value ?? "").trim()));
    return Number.isFinite(squares) ? Math.min(4, Math.max(1, squares)) : 1;
  }

  /**
   * A use limit of zero would create a portal nobody can ever cross, so it is
   * read the same way as an empty field: unlimited.
   */
  static #positiveLimit(value, item) {
    const limit = ScCanvasFormula.resolveLimit(value, item);
    return limit === "" || limit <= 0 ? "" : limit;
  }

  static #hexColor(value, fallback) {
    const normalized = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
  }
}
