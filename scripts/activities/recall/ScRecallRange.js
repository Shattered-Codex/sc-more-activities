import { ScRangeShape } from "../canvas/ScRangeShape.js";

/**
 * Distance between two creatures the way D&D counts it: from the nearest edge
 * of one footprint to the nearest edge of the other, plus the square the
 * second one stands in. Two adjacent tokens are one square apart whatever
 * their size, so standing beside a huge dragon is within 5 feet of it, while a
 * center-to-center measure would put it at 10 feet or more.
 *
 * For two one-square tokens this matches the center-to-center distance the
 * canvas activities use.
 */
export class ScRecallRange {
  /** Distance in scene units; 0 when the footprints overlap. */
  static between(tokenA, tokenB, rangeShape, scene = globalThis.canvas?.scene) {
    const size = Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const units = Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? 5) || 5;
    const a = ScRecallRange.#rect(tokenA, size);
    const b = ScRecallRange.#rect(tokenB, size);

    const gapX = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
    const gapY = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
    const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    if (overlaps) {
      return 0;
    }

    const gap = ScRangeShape.isSquare(rangeShape) ? Math.max(gapX, gapY) : Math.hypot(gapX, gapY);
    return ((gap / size) + 1) * units;
  }

  static #rect(token, size) {
    const document = token?.document ?? token;
    return {
      x: Number(document?.x) || 0,
      y: Number(document?.y) || 0,
      w: (Number(document?.width) || 1) * size,
      h: (Number(document?.height) || 1) * size
    };
  }
}
