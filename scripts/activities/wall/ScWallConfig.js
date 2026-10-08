import { ScCanvasFormula } from "../canvas/ScCanvasFormula.js";
import { ScRangeShape } from "../canvas/ScRangeShape.js";

export class ScWallConfig {
  static fromActivity(activity) {
    const config = activity?.wall ?? {};
    const item = activity?.item ?? null;
    return {
      maxWalls: ScWallConfig.resolveInteger(config.maxWalls, item, 1, { min: 1 }),
      wallType: ["continuous", "circular", "panels"].includes(config.wallType) ? config.wallType : "continuous",
      facing: ["both", "towards", "away", "any"].includes(config.facing) ? config.facing : "both",
      snapMode: ["center", "grid", "free"].includes(config.snapMode) ? config.snapMode : "center",
      panelSize: ScWallConfig.resolveNumber(config.panelSize, item, 5, { min: 0 }),
      panelSpacing: ScWallConfig.resolveNumber(config.panelSpacing, item, 0, { min: 0 }),
      maxPanels: ScWallConfig.resolveLimit(config.maxPanels, item),
      referenceRange: ScWallConfig.resolveNumber(config.referenceRange, item, 0, { min: 0 }),
      rangeShape: ScRangeShape.normalize(config.rangeShape),
      maxLength: ScWallConfig.resolveNumber(config.maxLength, item, 60, { min: 0 }),
      blocksMovement: config.blocksMovement !== false,
      blocksSight: config.blocksSight !== false,
      blocksSound: Boolean(config.blocksSound),
      allowPlayerRequests: Boolean(config.allowPlayerRequests),
      lineVisibility: ["none", "all", "gm"].includes(config.lineVisibility) ? config.lineVisibility : "none",
      lineColor: /^#[0-9a-fA-F]{6}$/.test(String(config.lineColor ?? "").trim())
        ? String(config.lineColor).trim()
        : "#7fd4ff",
      lineWidth: ScWallConfig.resolveNumber(config.lineWidth, item, 6, { min: 1 }),
      tileImage: String(config.tileImage ?? "").trim(),
      tileThickness: ScWallConfig.resolveNumber(config.tileThickness, item, 5, { min: 0 }),
      tileExtension: ScWallConfig.resolveNumber(config.tileExtension, item, 0, { min: 0 })
    };
  }

  static resolveNumber(value, item, fallback = 0, options = {}) {
    return ScCanvasFormula.resolveNumber(value, item, fallback, options);
  }

  static resolveInteger(value, item, fallback = 0, options = {}) {
    return ScCanvasFormula.resolveInteger(value, item, fallback, options);
  }

  static resolveLimit(value, item) {
    return ScCanvasFormula.resolveLimit(value, item);
  }
}
