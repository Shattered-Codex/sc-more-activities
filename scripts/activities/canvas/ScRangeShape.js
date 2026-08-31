export class ScRangeShape {
  static VALUES = Object.freeze({
    SYSTEM: "system",
    CIRCLE: "circle",
    SQUARE: "square",
    GRID: "grid"
  });

  static choices() {
    return Object.values(ScRangeShape.VALUES);
  }

  static field(fields, { includeGrid = false } = {}) {
    return new fields.StringField({
      required: false,
      initial: ScRangeShape.VALUES.CIRCLE,
      choices: includeGrid
        ? ScRangeShape.choices()
        : ScRangeShape.choices().filter((value) => value !== ScRangeShape.VALUES.GRID)
    });
  }

  static normalize(value) {
    return ScRangeShape.choices().includes(value) ? value : ScRangeShape.VALUES.CIRCLE;
  }

  static options({ includeGrid = false } = {}) {
    const options = [
      [ScRangeShape.VALUES.CIRCLE, "Circle"],
      [ScRangeShape.VALUES.SQUARE, "Square"],
      [ScRangeShape.VALUES.SYSTEM, "System"]
    ];
    if (includeGrid) {
      options.push([ScRangeShape.VALUES.GRID, "Grid"]);
    }
    return options.map(([value, key]) => ({
      value,
      label: globalThis.game?.i18n?.localize?.(
        `SCMOREACTIVITIES.Activities.Canvas.Fields.RangeShape.Choices.${key}`
      ) ?? key
    }));
  }

  static migrateLegacyGridRange(source, scope) {
    const config = source?.[scope];
    if (!source?._id || !config || Object.hasOwn(config, "rangeShape")) {
      return;
    }
    config.rangeShape = ScRangeShape.VALUES.GRID;
  }

  static isSquare(value) {
    const shape = ScRangeShape.normalize(value);
    if (shape === ScRangeShape.VALUES.SQUARE) {
      return true;
    }
    if (shape !== ScRangeShape.VALUES.SYSTEM) {
      return false;
    }
    try {
      return globalThis.game?.settings?.get?.("dnd5e", "gridAlignedSquareTemplates") === true;
    } catch {
      return false;
    }
  }

  static distance(pointA, pointB, value, scene = globalThis.canvas?.scene) {
    const dx = Math.abs(Number(pointB?.x) - Number(pointA?.x));
    const dy = Math.abs(Number(pointB?.y) - Number(pointA?.y));
    const pixelDistance = ScRangeShape.isSquare(value) ? Math.max(dx, dy) : Math.hypot(dx, dy);
    const gridSize = Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const gridDistance = Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? 5) || 5;
    return pixelDistance / gridSize * gridDistance;
  }

  static pixels(distance, scene = globalThis.canvas?.scene) {
    const gridSize = Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const gridDistance = Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? 5) || 5;
    return Number(distance) / gridDistance * gridSize;
  }

  static color(value, fallback) {
    const match = /^#?([0-9a-f]{6})$/iu.exec(String(value ?? ""));
    return match ? Number.parseInt(match[1], 16) : fallback;
  }

  static draw(graphics, center, radius, value) {
    if (!graphics || !center || !Number.isFinite(radius) || radius <= 0) {
      return;
    }
    if (ScRangeShape.isSquare(value)) {
      graphics.drawRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    } else {
      graphics.drawCircle(center.x, center.y, radius);
    }
  }

  static drawPreview(graphics, {
    center,
    distance,
    rangeShape,
    scene = globalThis.canvas?.scene,
    borderColor = "#ffffff",
    fillColor = "#ffffff",
    borderAlpha = 0.9,
    fillAlpha = 0.12
  }) {
    // Foundry grid measurement can use diagonal rules that have no honest
    // circle-or-square boundary. Legacy activities keep their validation, but
    // omit a potentially misleading geometric preview until a shape is chosen.
    if (ScRangeShape.normalize(rangeShape) === ScRangeShape.VALUES.GRID) {
      return;
    }
    const radius = ScRangeShape.pixels(distance, scene);
    if (!graphics || !center || !Number.isFinite(radius) || radius <= 0) {
      return;
    }
    graphics.lineStyle(2, ScRangeShape.color(borderColor, 0xffffff), borderAlpha);
    graphics.beginFill(ScRangeShape.color(fillColor, 0xffffff), fillAlpha);
    ScRangeShape.draw(graphics, center, radius, rangeShape);
    graphics.endFill();
  }
}
