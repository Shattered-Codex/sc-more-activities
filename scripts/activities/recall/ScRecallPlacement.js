/**
 * Finds free squares beside an anchor token (the NPC a character calls home)
 * for each arriving token, nearest first.
 *
 * It works from the scene's data alone: the destination scene is rarely the
 * one on screen, so there is no canvas to ask about collisions. A square is
 * free when it lies inside the scene, overlaps no other token, and the line
 * from the anchor's center to it neither crosses nor touches a wall that
 * blocks movement (open doors let it through).
 */
export class ScRecallPlacement {
  /** How many squares away from the anchor to look before giving up. */
  static MAX_RINGS = 4;

  /**
   * @param {Scene} scene
   * @param {TokenDocument} anchor
   * @param {TokenDocument[]} travellers
   * @param {object} [options]
   * @param {Set<string>} [options.ignoreIds]  Tokens that are leaving their place (the travellers on this scene).
   * @param {object[]} [options.obstacles]     Extra areas to keep clear, as `{ x, y, w, h }` in pixels.
   * @returns {Array<{x: number, y: number}|null>}  One spot per traveller, `null` where none was free.
   */
  static findSpots(scene, anchor, travellers, { ignoreIds = new Set(), obstacles = [] } = {}) {
    const size = Number(scene?.grid?.size) || 100;
    const anchorRect = ScRecallPlacement.#rect(anchor, size);
    const anchorCenter = { x: anchorRect.x + (anchorRect.w / 2), y: anchorRect.y + (anchorRect.h / 2) };
    const bounds = scene?.dimensions?.sceneRect ?? null;
    const walls = ScRecallPlacement.#blockingWalls(scene);
    const occupied = ScRecallPlacement.#tokens(scene)
      .filter((token) => !ignoreIds.has(token.id))
      .map((token) => ScRecallPlacement.#rect(token, size))
      .concat(obstacles);

    return travellers.map((traveller) => {
      const w = (Number(traveller?.width) || 1) * size;
      const h = (Number(traveller?.height) || 1) * size;
      const found = ScRecallPlacement.#candidates(anchorRect, anchorCenter, w, h, size).find((candidate) => {
        const rect = { x: candidate.x, y: candidate.y, w, h };
        return ScRecallPlacement.#inside(rect, bounds)
          && !occupied.some((other) => ScRecallPlacement.#overlaps(rect, other))
          && !ScRecallPlacement.#crossesWall(anchorCenter, { x: rect.x + (w / 2), y: rect.y + (h / 2) }, walls);
      });
      if (!found) {
        return null;
      }
      occupied.push({ x: found.x, y: found.y, w, h });
      return { x: found.x, y: found.y };
    });
  }

  /** Grid-aligned positions around the anchor, ring by ring, nearest first within a ring. */
  static #candidates(anchorRect, anchorCenter, w, h, size) {
    const reach = ScRecallPlacement.MAX_RINGS * size;
    const candidates = [];
    for (let x = anchorRect.x - w - reach + size; x <= anchorRect.x + anchorRect.w + reach - size; x += size) {
      for (let y = anchorRect.y - h - reach + size; y <= anchorRect.y + anchorRect.h + reach - size; y += size) {
        const gapX = Math.max(anchorRect.x - (x + w), x - (anchorRect.x + anchorRect.w), 0);
        const gapY = Math.max(anchorRect.y - (y + h), y - (anchorRect.y + anchorRect.h), 0);
        const overlapsAnchor = x < anchorRect.x + anchorRect.w && x + w > anchorRect.x
          && y < anchorRect.y + anchorRect.h && y + h > anchorRect.y;
        if (overlapsAnchor) {
          continue;
        }
        const ring = Math.round(Math.max(gapX, gapY) / size) + 1;
        const distance = Math.hypot(x + (w / 2) - anchorCenter.x, y + (h / 2) - anchorCenter.y);
        candidates.push({ x, y, ring, distance });
      }
    }
    return candidates.sort((left, right) => (left.ring - right.ring) || (left.distance - right.distance));
  }

  static #blockingWalls(scene) {
    const none = globalThis.CONST?.WALL_MOVEMENT_TYPES?.NONE ?? 0;
    const open = globalThis.CONST?.WALL_DOOR_STATES?.OPEN ?? 1;
    return ScRecallPlacement.#contents(scene?.walls)
      .filter((wall) => Number(wall?.move ?? 1) !== none)
      .filter((wall) => !(Number(wall?.door) > 0 && Number(wall?.ds) === open))
      .map((wall) => wall.c)
      .filter((c) => Array.isArray(c) && c.length === 4);
  }

  static #crossesWall(from, to, walls) {
    return walls.some(([x1, y1, x2, y2]) => ScRecallPlacement.#segmentsMeet(from, to, { x: x1, y: y1 }, { x: x2, y: y2 }));
  }

  /**
   * Whether segments ab and cd share any point. Touching counts: a line
   * through the corner where two walls meet slips between them otherwise.
   */
  static #segmentsMeet(a, b, c, d) {
    const side = (p, q, r) => ((q.x - p.x) * (r.y - p.y)) - ((q.y - p.y) * (r.x - p.x));
    const within = (p, q, r) => r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x)
      && r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y);
    const [abc, abd, cda, cdb] = [side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b)];
    if (Math.sign(abc) * Math.sign(abd) < 0 && Math.sign(cda) * Math.sign(cdb) < 0) {
      return true;
    }
    return (abc === 0 && within(a, b, c)) || (abd === 0 && within(a, b, d))
      || (cda === 0 && within(c, d, a)) || (cdb === 0 && within(c, d, b));
  }

  static #inside(rect, bounds) {
    if (!bounds) {
      return true;
    }
    return rect.x >= bounds.x && rect.y >= bounds.y
      && rect.x + rect.w <= bounds.x + bounds.width
      && rect.y + rect.h <= bounds.y + bounds.height;
  }

  static #overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  static #rect(token, size) {
    return {
      x: Number(token?.x) || 0,
      y: Number(token?.y) || 0,
      w: (Number(token?.width) || 1) * size,
      h: (Number(token?.height) || 1) * size
    };
  }

  static #tokens(scene) {
    return ScRecallPlacement.#contents(scene?.tokens);
  }

  static #contents(collection) {
    return collection?.contents ?? Array.from(collection?.values?.() ?? collection ?? []);
  }
}
