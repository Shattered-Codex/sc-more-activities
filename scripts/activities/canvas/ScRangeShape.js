export class ScRangeShape {
  static VALUES = Object.freeze({
    SYSTEM: "system",
    CIRCLE: "circle",
    SQUARE: "square"
  });

  static choices() {
    return Object.values(ScRangeShape.VALUES);
  }

  static field(fields) {
    return new fields.StringField({
      required: false,
      initial: ScRangeShape.VALUES.CIRCLE,
      choices: ScRangeShape.choices()
    });
  }

  static normalize(value) {
    return ScRangeShape.choices().includes(value) ? value : ScRangeShape.VALUES.CIRCLE;
  }

  static options() {
    return [
      [ScRangeShape.VALUES.CIRCLE, "Circle"],
      [ScRangeShape.VALUES.SQUARE, "Square"],
      [ScRangeShape.VALUES.SYSTEM, "System"]
    ].map(([value, key]) => ({
      value,
      label: globalThis.game?.i18n?.localize?.(
        `SCMOREACTIVITIES.Activities.Canvas.Fields.RangeShape.Choices.${key}`
      ) ?? key
    }));
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
