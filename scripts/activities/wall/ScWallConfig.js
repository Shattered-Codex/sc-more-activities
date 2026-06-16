import { Logger } from "../../support/Logger.js";

export class ScWallConfig {
  static fromActivity(activity) {
    const config = activity?.wall ?? {};
    const item = activity?.item ?? null;
    return {
      maxWalls: ScWallConfig.resolveInteger(config.maxWalls, item, 1, { min: 1 }),
      wallType: ["continuous", "circular", "panels"].includes(config.wallType) ? config.wallType : "continuous",
      facing: ["both", "towards", "away", "any"].includes(config.facing) ? config.facing : "both",
      panelSize: ScWallConfig.resolveNumber(config.panelSize, item, 5, { min: 0 }),
      panelSpacing: ScWallConfig.resolveNumber(config.panelSpacing, item, 0, { min: 0 }),
      maxPanels: ScWallConfig.resolveLimit(config.maxPanels, item),
      referenceRange: ScWallConfig.resolveNumber(config.referenceRange, item, 0, { min: 0 }),
      maxLength: ScWallConfig.resolveNumber(config.maxLength, item, 60, { min: 0 }),
      blocksMovement: config.blocksMovement !== false,
      blocksSight: config.blocksSight !== false,
      blocksSound: Boolean(config.blocksSound),
      allowPlayerRequests: Boolean(config.allowPlayerRequests)
    };
  }

  static resolveNumber(value, item, fallback = 0, { min = 0 } = {}) {
    const resolved = ScWallConfig.#resolveFormula(value, item, fallback);
    const number = Number.isFinite(resolved) ? resolved : fallback;
    return Math.max(min, Math.floor(number));
  }

  static resolveInteger(value, item, fallback = 0, { min = 0 } = {}) {
    return Math.max(min, Math.floor(ScWallConfig.resolveNumber(value, item, fallback, { min })));
  }

  static resolveLimit(value, item) {
    if (value === "" || value === null || value === undefined || value === "unlimited") {
      return "";
    }
    return ScWallConfig.resolveInteger(value, item, 0, { min: 0 });
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
      Logger.warn(`Could not resolve wall formula "${formula}".`, error);
      return fallback;
    }
  }
}
