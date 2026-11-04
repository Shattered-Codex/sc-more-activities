import { ScRangeShape } from "./ScRangeShape.js";

/**
 * Answers "can this spot be used?" for the canvas pickers, and finds the grid
 * spaces inside a range overlay that cannot, so the overlay can paint them in
 * the blocked colour instead of letting them look like valid destinations.
 *
 * A spot is blocked for sight when a sight-blocking wall stands between the
 * origin and it, or (on the user's client) when the user cannot currently see
 * it at all. It is blocked for occupancy when another token stands on it.
 */
export class ScBlockedArea {
  static REASONS = Object.freeze({
    SIGHT: "sight",
    OCCUPIED: "occupied",
    PATH: "path"
  });

  /** Pixels to stop short of a point so a wall drawn right on it does not hide it. */
  static #SIGHT_EPSILON = 2;

  /** Pixels a footprint has to overlap a token by before the space counts as occupied. */
  static #OVERLAP_EPSILON = 1;

  /** Upper bound on grid spaces a single overlay will classify. */
  static #MAX_CELLS = 6400;

  /** Bumped by every change that can move a blocked space; see `revision()`. */
  static #revision = 0;
  static #watching = false;

  /** Core hooks after which a cached sight sweep or set of spaces is stale. */
  static #INVALIDATING_HOOKS = Object.freeze([
    "createWall", "updateWall", "deleteWall",
    "createToken", "updateToken", "deleteToken",
    "sightRefresh", "canvasReady"
  ]);

  /**
   * A counter that changes whenever walls, tokens, or vision do. Opening a
   * door leaves the wall count untouched, so caches key on this instead. The
   * hooks are registered once, on first use.
   */
  static revision() {
    if (!ScBlockedArea.#watching && typeof globalThis.Hooks?.on === "function") {
      ScBlockedArea.#watching = true;
      for (const hook of ScBlockedArea.#INVALIDATING_HOOKS) {
        globalThis.Hooks.on(hook, () => {
          ScBlockedArea.#revision += 1;
        });
      }
    }
    return ScBlockedArea.#revision;
  }

  /**
   * The sight probe from `originCenter`, reused from `cache` until the origin
   * moves or a wall, token, or vision change makes the sweep stale.
   */
  static cachedSightProbe(cache, originCenter) {
    if (!cache) {
      return ScBlockedArea.sightProbe(originCenter);
    }
    const signature = `${originCenter?.x}:${originCenter?.y}:${ScBlockedArea.revision()}`;
    if (cache.signature !== signature) {
      cache.signature = signature;
      cache.probe = ScBlockedArea.sightProbe(originCenter);
    }
    return cache.probe;
  }

  /**
   * Answers "can the origin see this point?" as cheaply as core allows.
   *
   * The sight polygon already is the region the origin can see, so one sweep
   * up front turns every later test into a containment check. Asking
   * testCollision per point instead means a sweep per point.
   *
   * Returns `{ kind, test(point) }`, or `null` when core offers no sight
   * backend (headless runs), in which case nothing is ever blocked for sight.
   */
  static sightProbe(originCenter) {
    const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.sight;
    if (!backend || !ScBlockedArea.#isPoint(originCenter)) {
      return null;
    }

    if (typeof backend.create === "function") {
      try {
        const polygon = backend.create(originCenter, { type: "sight" });
        // A degenerate sweep would report everything as hidden, so it has to
        // be a real polygon before it is trusted.
        if (typeof polygon?.contains === "function" && Number(polygon.points?.length) >= 6) {
          return { kind: "polygon", test: (point) => polygon.contains(point.x, point.y) };
        }
      } catch {
        // Fall through to the per-point form.
      }
    }
    if (typeof backend.testCollision === "function") {
      return {
        kind: "collision",
        test: (point) => !backend.testCollision(originCenter, point, { type: "sight", mode: "any" })
      };
    }
    return null;
  }

  /**
   * Whether the origin has line of sight to `point`. With `requireVisibility`
   * the point must also be visible to this user right now, so a space in the
   * dark or in unexplored fog is never offered as a destination either.
   */
  static canSee(originCenter, point, { probe = undefined, requireVisibility = false } = {}) {
    if (!ScBlockedArea.#isPoint(originCenter) || !ScBlockedArea.#isPoint(point)) {
      return true;
    }

    // The point may sit right on a wall (a grid vertex along a corridor), which
    // is the boundary of what can be seen, so step just short of it first.
    const distance = Math.hypot(point.x - originCenter.x, point.y - originCenter.y);
    const target = distance <= ScBlockedArea.#SIGHT_EPSILON
      ? { x: originCenter.x, y: originCenter.y }
      : ScBlockedArea.#lerp(originCenter, point, (distance - ScBlockedArea.#SIGHT_EPSILON) / distance);

    const sight = probe === undefined ? ScBlockedArea.sightProbe(originCenter) : probe;
    if (sight) {
      try {
        if (!sight.test(target)) {
          return false;
        }
      } catch {
        // A failing backend never blocks the user.
      }
    }

    if (!requireVisibility) {
      return true;
    }
    return ScBlockedArea.isVisibleToUser(target);
  }

  /** Whether this user can currently see `point`; true when vision is not in play. */
  static isVisibleToUser(point) {
    const visibility = globalThis.canvas?.visibility;
    if (typeof visibility?.testVisibility !== "function") {
      return true;
    }
    // A scene without token vision shows everything to everyone, yet core's
    // test answers "GM only" when no vision source is active, which would
    // block the whole range for a player.
    if (visibility.tokenVision === false) {
      return true;
    }
    try {
      return visibility.testVisibility(point, { tolerance: 1 }) !== false;
    } catch {
      return true;
    }
  }

  /** Whether a movement-blocking wall stands on the straight path from `from` to `to`. */
  static isPathBlocked(from, to) {
    const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.move;
    if (typeof backend?.testCollision !== "function"
      || !ScBlockedArea.#isPoint(from) || !ScBlockedArea.#isPoint(to)) {
      return false;
    }
    try {
      return Boolean(backend.testCollision(from, to, { type: "move", mode: "any" }));
    } catch {
      return false;
    }
  }

  /** The first rectangle in `rects` that a footprint overlaps, or `null`. */
  static overlappingRect(rect, rects = []) {
    const epsilon = ScBlockedArea.#OVERLAP_EPSILON;
    return rects.find((other) => (
      rect.x < other.x + other.width - epsilon
      && rect.x + rect.width > other.x + epsilon
      && rect.y < other.y + other.height - epsilon
      && rect.y + rect.height > other.y + epsilon
    )) ?? null;
  }

  /** Whether `point` lies inside one of `rects`. */
  static pointInRects(point, rects = []) {
    return rects.some((rect) => (
      point.x > rect.x && point.x < rect.x + rect.width
      && point.y > rect.y && point.y < rect.y + rect.height
    ));
  }

  /**
   * The grid spaces inside the range whose centre is blocked, as flat polygon
   * point arrays ready for `Graphics#drawPolygon`.
   *
   * @param {object} options
   * @param {Point} options.originCenter
   * @param {number} options.distance        Range in scene units; 0 means the whole scene.
   * @param {string} options.rangeShape
   * @param {boolean} [options.sight]        Block spaces the origin cannot see.
   * @param {boolean} [options.requireVisibility]  Also block spaces this user cannot see.
   * @param {object[]} [options.occupied]    Token rectangles that block the spaces under them.
   * @param {object|null} [options.probe]    A sight probe already swept from this origin.
   * @param {object} [options.cache]         A caller-owned object; while nothing the result depends
   *                                          on changes, the spaces stored on it are returned as is.
   */
  static blockedCells({
    originCenter,
    distance = 0,
    rangeShape = ScRangeShape.VALUES.CIRCLE,
    scene = globalThis.canvas?.scene,
    sight = true,
    requireVisibility = false,
    occupied = [],
    probe = undefined,
    cache = null
  } = {}) {
    if (!ScBlockedArea.#isPoint(originCenter) || (!sight && !occupied.length)) {
      if (cache) {
        // Leave nothing behind for drawCachedCells to keep painting.
        cache.signature = "none";
        cache.cells = [];
      }
      return [];
    }

    // Pickers redraw on every pointer move; the spaces only change when the
    // origin, the range, the walls (a door opening included), the tokens, or
    // the user's vision do.
    const signature = cache ? [
      scene?.id, originCenter.x, originCenter.y, distance, ScRangeShape.isSquare(rangeShape),
      sight, requireVisibility, ScBlockedArea.revision(),
      occupied.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`).join(";")
    ].join(":") : null;
    if (cache && cache.signature === signature) {
      return cache.cells;
    }
    const cells = ScBlockedArea.#classifyCells({
      originCenter, distance, rangeShape, scene, sight, requireVisibility, occupied, probe
    });
    if (cache) {
      cache.signature = signature;
      cache.cells = cells;
    }
    return cells;
  }

  static #classifyCells({ originCenter, distance, rangeShape, scene, sight, requireVisibility, occupied, probe }) {
    if (sight && probe === undefined) {
      probe = ScBlockedArea.sightProbe(originCenter);
    }
    // Without a sight backend and without anything to occupy, nothing can be
    // blocked, so skip walking the grid.
    if (!probe && !requireVisibility && !occupied.length) {
      return [];
    }

    const blocked = [];
    for (const cell of ScBlockedArea.#cellsInRange(originCenter, distance, rangeShape, scene)) {
      const occupiedCell = occupied.length > 0 && ScBlockedArea.pointInRects(cell.center, occupied);
      const hidden = sight && !occupiedCell
        && !ScBlockedArea.canSee(originCenter, cell.center, { probe, requireVisibility });
      if (occupiedCell || hidden) {
        blocked.push(cell.points);
      }
    }
    return blocked;
  }

  /** Paints the blocked spaces in one colour. */
  static drawCells(graphics, cells, color, { fillAlpha = 0.35, borderAlpha = 0.75 } = {}) {
    if (!graphics || !cells?.length) {
      return;
    }
    const tint = ScRangeShape.color(color, 0xd32f2f);
    graphics.lineStyle(1, tint, borderAlpha);
    for (const points of cells) {
      graphics.beginFill(tint, fillAlpha);
      graphics.drawPolygon(points);
      graphics.endFill();
    }
  }

  /**
   * Paints the spaces from a `blockedCells` cache into a child layer of
   * `graphics` that survives `Graphics#clear`, so a picker that redraws on
   * every pointer move only repaints them when they or their colour change.
   * The layer goes away with its parent.
   */
  static drawCachedCells(graphics, cache, color) {
    const cells = cache?.cells ?? [];
    if (!graphics || !cache || typeof graphics.addChild !== "function" || !globalThis.PIXI?.Graphics) {
      ScBlockedArea.drawCells(graphics, cells, color);
      return;
    }

    if (!cache.layer || cache.layer.destroyed || cache.layer.parent !== graphics) {
      cache.layer = new PIXI.Graphics();
      cache.layer.eventMode = "none";
      graphics.addChild(cache.layer);
      cache.layerKey = null;
    }
    const key = `${cache.signature}|${color}`;
    if (cache.layerKey === key) {
      return;
    }
    cache.layer.clear();
    ScBlockedArea.drawCells(cache.layer, cells, color);
    cache.layerKey = key;
  }

  /**
   * Every grid space whose centre lies inside the range and on the scene. A
   * gridless scene is walked in grid-sized squares so it still gets guidance.
   */
  static #cellsInRange(originCenter, distance, rangeShape, scene) {
    const grid = globalThis.canvas?.grid;
    const size = Number(scene?.grid?.size ?? grid?.size ?? 100) || 100;
    const limited = Number(distance) > 0;
    const radius = limited ? ScRangeShape.pixels(distance, scene) : Infinity;
    const sceneRect = ScBlockedArea.#sceneRect(scene);

    let minX = originCenter.x - radius;
    let minY = originCenter.y - radius;
    let maxX = originCenter.x + radius;
    let maxY = originCenter.y + radius;
    if (sceneRect) {
      minX = Math.max(minX, sceneRect.x);
      minY = Math.max(minY, sceneRect.y);
      maxX = Math.min(maxX, sceneRect.x + sceneRect.width);
      maxY = Math.min(maxY, sceneRect.y + sceneRect.height);
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
      return [];
    }

    // An unlimited range on a huge scene would classify thousands of spaces
    // nobody is looking at; keep to a window around the origin instead.
    const columns = (maxX - minX) / size;
    const rows = (maxY - minY) / size;
    if (columns * rows > ScBlockedArea.#MAX_CELLS) {
      const half = Math.floor(Math.sqrt(ScBlockedArea.#MAX_CELLS) / 2) * size;
      minX = Math.max(minX, originCenter.x - half);
      minY = Math.max(minY, originCenter.y - half);
      maxX = Math.min(maxX, originCenter.x + half);
      maxY = Math.min(maxY, originCenter.y + half);
    }

    const inside = (center) => {
      if (sceneRect && (center.x < sceneRect.x || center.y < sceneRect.y
        || center.x > sceneRect.x + sceneRect.width || center.y > sceneRect.y + sceneRect.height)) {
        return false;
      }
      return !limited || ScRangeShape.distance(originCenter, center, rangeShape, scene) <= distance + 1e-6;
    };

    return ScBlockedArea.#usesGridCells(grid)
      ? ScBlockedArea.#gridCells(grid, { minX, minY, maxX, maxY }, inside)
      : ScBlockedArea.#squareCells(size, { minX, minY, maxX, maxY }, inside);
  }

  static #usesGridCells(grid) {
    return Boolean(grid) && grid.isGridless !== true
      && typeof grid.getOffset === "function"
      && typeof grid.getCenterPoint === "function"
      && typeof grid.getVertices === "function";
  }

  static #gridCells(grid, { minX, minY, maxX, maxY }, inside) {
    const first = grid.getOffset({ x: minX, y: minY });
    const last = grid.getOffset({ x: maxX, y: maxY });
    const cells = [];
    // One space of slack on every side: hex rows are staggered, so the corner
    // offsets do not always bound the spaces whose centres fall inside.
    for (let i = Math.min(first.i, last.i) - 1; i <= Math.max(first.i, last.i) + 1; i += 1) {
      for (let j = Math.min(first.j, last.j) - 1; j <= Math.max(first.j, last.j) + 1; j += 1) {
        const offset = { i, j };
        const center = grid.getCenterPoint(offset);
        if (!ScBlockedArea.#isPoint(center) || !inside(center)) {
          continue;
        }
        const vertices = grid.getVertices(offset) ?? [];
        if (vertices.length < 3) {
          continue;
        }
        cells.push({ center, points: vertices.flatMap((vertex) => [vertex.x, vertex.y]) });
      }
    }
    return cells;
  }

  static #squareCells(size, { minX, minY, maxX, maxY }, inside) {
    const cells = [];
    for (let x = Math.floor(minX / size) * size; x < maxX; x += size) {
      for (let y = Math.floor(minY / size) * size; y < maxY; y += size) {
        const center = { x: x + (size / 2), y: y + (size / 2) };
        if (!inside(center)) {
          continue;
        }
        cells.push({ center, points: [x, y, x + size, y, x + size, y + size, x, y + size] });
      }
    }
    return cells;
  }

  static #sceneRect(scene) {
    const rect = scene?.dimensions?.sceneRect ?? globalThis.canvas?.dimensions?.sceneRect;
    if (rect && [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(Number(value)))) {
      return { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) };
    }
    return null;
  }

  static #isPoint(point) {
    return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
  }

  static #lerp(a, b, ratio) {
    return {
      x: a.x + ((b.x - a.x) * ratio),
      y: a.y + ((b.y - a.y) * ratio)
    };
  }
}
