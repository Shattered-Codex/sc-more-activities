import { Logger } from "../../support/Logger.js";

/**
 * Resolves the free-text numeric fields shared by the canvas activities. Every
 * field accepts a plain number or a roll formula evaluated against the item's
 * roll data, so an activity can scale a range or a limit with the actor.
 */
export class ScCanvasFormula {
  static resolveNumber(value, item, fallback = 0, { min = 0 } = {}) {
    const resolved = ScCanvasFormula.#resolveFormula(value, item, fallback);
    const number = Number.isFinite(resolved) ? resolved : fallback;
    return Math.max(min, Math.floor(number));
  }

  static resolveInteger(value, item, fallback = 0, { min = 0 } = {}) {
    return Math.max(min, Math.floor(ScCanvasFormula.resolveNumber(value, item, fallback, { min })));
  }

  /** Returns "" for an unlimited field, so callers can tell it from a real zero. */
  static resolveLimit(value, item) {
    if (value === "" || value === null || value === undefined || value === "unlimited") {
      return "";
    }
    return ScCanvasFormula.resolveInteger(value, item, 0, { min: 0 });
  }

  static #resolveFormula(value, item, fallback) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : fallback;
    }

    const formula = String(value ?? "").trim();
    if (!formula) {
      return fallback;
    }

    const numeric = Number(formula);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    try {
      const roll = new Roll(formula, item?.getRollData?.() ?? {});
      roll.evaluateSync();
      return Number.isFinite(Number(roll.total)) ? Number(roll.total) : fallback;
    } catch (error) {
      Logger.warn(`Could not resolve canvas formula "${formula}".`, error);
      return fallback;
    }
  }
}
