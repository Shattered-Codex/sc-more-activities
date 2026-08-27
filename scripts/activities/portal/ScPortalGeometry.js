/**
 * Grid maths for the portal activity: shape building, hit testing, and the
 * search for a free landing spot. Every helper takes an explicit scene so the
 * GM can resolve a travel request for a scene that is not the one currently
 * rendered on their canvas.
 */
export class ScPortalGeometry {
  /** Rings of grid cells searched around a blocked destination before giving up. */
  static MAX_FREE_SPACE_RINGS = 3;

  static isGridless(scene = canvas?.scene) {
    const gridlessType = globalThis.CONST?.GRID_TYPES?.GRIDLESS ?? 0;
    const type = Number(scene?.grid?.type ?? canvas?.grid?.type);
    return !Number.isFinite(type) || type === gridlessType;
  }

  static gridSize(scene = canvas?.scene) {
    return Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
  }

  /** Half the portal footprint, in pixels, from its width in grid squares. */
  static radiusPixels(squares, scene = canvas?.scene) {
    return Math.max(1, (ScPortalGeometry.squareCount(squares) * ScPortalGeometry.gridSize(scene)) / 2);
  }

  static squareCount(squares) {
    const count = Math.floor(Number(squares));
    return Number.isFinite(count) ? Math.min(4, Math.max(1, count)) : 1;
  }

  /**
   * Snapping is silently skipped on a gridless scene: there is no cell to snap
   * to, and rounding to an imaginary grid would move the portal away from the
   * spot the user clicked.
   */
  static snapCenter(point, { snapToGrid = true, scene = canvas?.scene, squares = 1 } = {}) {
    const raw = ScPortalGeometry.validPoint(point);
    if (!raw) {
      return null;
    }
    if (!snapToGrid || ScPortalGeometry.isGridless(scene)) {
      return { x: Math.round(raw.x), y: Math.round(raw.y) };
    }

    const gridSize = ScPortalGeometry.gridSize(scene);

    // An even footprint spans whole cells only when it is centred on a grid
    // corner. Snapping it to a cell centre like an odd one would leave the
    // portal straddling half a cell on every side.
    if (ScPortalGeometry.squareCount(squares) % 2 === 0) {
      return {
        x: Math.round(Math.round(raw.x / gridSize) * gridSize),
        y: Math.round(Math.round(raw.y / gridSize) * gridSize)
      };
    }

    if (ScPortalGeometry.#sceneIsActive(scene) && typeof canvas?.grid?.getCenterPoint === "function") {
      const snapped = canvas.grid.getCenterPoint(raw);
      return { x: Math.round(Number(snapped.x)), y: Math.round(Number(snapped.y)) };
    }

    return {
      x: Math.round((Math.floor(raw.x / gridSize) * gridSize) + (gridSize / 2)),
      y: Math.round((Math.floor(raw.y / gridSize) * gridSize) + (gridSize / 2))
    };
  }

  /** Region shape data for one portal side, centred on the placed point. */
  static regionShape(center, { shape = "square", radiusPixels = 50 } = {}) {
    const point = ScPortalGeometry.validPoint(center);
    if (!point) {
      return null;
    }

    const radius = Math.max(1, Number(radiusPixels) || 1);
    if (shape === "circle") {
      return {
        type: "circle",
        x: Math.round(point.x),
        y: Math.round(point.y),
        radius: Math.round(radius),
        hole: false
      };
    }

    return {
      type: "rectangle",
      x: Math.round(point.x - radius),
      y: Math.round(point.y - radius),
      width: Math.round(radius * 2),
      height: Math.round(radius * 2),
      rotation: 0,
      hole: false
    };
  }

  static containsPoint(portal, point) {
    const center = ScPortalGeometry.validPoint(portal?.center);
    const target = ScPortalGeometry.validPoint(point);
    const radius = Number(portal?.radiusPixels);
    if (!center || !target || !Number.isFinite(radius) || radius <= 0) {
      return false;
    }

    const dx = target.x - center.x;
    const dy = target.y - center.y;
    if (portal?.shape === "circle") {
      return Math.hypot(dx, dy) <= radius;
    }
    return Math.abs(dx) <= radius && Math.abs(dy) <= radius;
  }

  /** True when the token overlaps the portal area or sits within one cell of it. */
  static tokenReachesPortal(portal, tokenDocument, scene = canvas?.scene) {
    const center = ScPortalGeometry.tokenCenter(tokenDocument, scene);
    if (!center) {
      return false;
    }
    if (ScPortalGeometry.containsPoint(portal, center)) {
      return true;
    }

    const size = ScPortalGeometry.tokenPixelSize(tokenDocument, scene);
    const reach = (Math.max(size.width, size.height) / 2) + ScPortalGeometry.gridSize(scene);
    return ScPortalGeometry.containsPoint({
      ...portal,
      radiusPixels: Number(portal?.radiusPixels ?? 0) + reach
    }, center);
  }

  static tokenPixelSize(tokenDocument, scene = canvas?.scene) {
    const gridSize = ScPortalGeometry.gridSize(scene);
    const documentWidth = Number(ScPortalGeometry.#sourceValue(tokenDocument, "width"));
    const documentHeight = Number(ScPortalGeometry.#sourceValue(tokenDocument, "height"));
    return {
      width: Number.isFinite(documentWidth) && documentWidth > 0 ? documentWidth * gridSize : gridSize,
      height: Number.isFinite(documentHeight) && documentHeight > 0 ? documentHeight * gridSize : gridSize
    };
  }

  static tokenCenter(tokenDocument, scene = canvas?.scene) {
    // Foundry animates prepared TokenDocument position fields while a movement
    // is in progress. Region membership is defined against the persisted source
    // values instead; using the prepared coordinates here can make a token that
    // just stopped at a portal look as though it already moved beyond it.
    const x = Number(ScPortalGeometry.#sourceValue(tokenDocument, "x"));
    const y = Number(ScPortalGeometry.#sourceValue(tokenDocument, "y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    const size = ScPortalGeometry.tokenPixelSize(tokenDocument, scene);
    return {
      x: x + (size.width / 2),
      y: y + (size.height / 2)
    };
  }

  static topLeftForCenter(center, tokenDocument, { snapToGrid = true, scene = canvas?.scene } = {}) {
    const point = ScPortalGeometry.validPoint(center);
    if (!point) {
      return null;
    }

    const size = ScPortalGeometry.tokenPixelSize(tokenDocument, scene);
    const topLeft = {
      x: point.x - (size.width / 2),
      y: point.y - (size.height / 2)
    };
    if (!snapToGrid || ScPortalGeometry.isGridless(scene)) {
      return { x: Math.round(topLeft.x), y: Math.round(topLeft.y) };
    }

    if (ScPortalGeometry.#sceneIsActive(scene) && typeof canvas?.grid?.getTopLeftPoint === "function") {
      const snapped = canvas.grid.getTopLeftPoint(topLeft);
      return { x: Math.round(Number(snapped.x)), y: Math.round(Number(snapped.y)) };
    }

    const gridSize = ScPortalGeometry.gridSize(scene);
    return {
      x: Math.round(Math.round(topLeft.x / gridSize) * gridSize),
      y: Math.round(Math.round(topLeft.y / gridSize) * gridSize)
    };
  }

  /**
   * Walks outwards from the destination centre until the token fits inside the
   * scene without overlapping another token. Returns null when every candidate
   * is taken, so the caller can refuse the travel instead of stacking tokens.
   */
  static findFreeCenter(scene, center, tokenDocument, {
    avoidOccupied = true,
    snapToGrid = true,
    maxRings = ScPortalGeometry.MAX_FREE_SPACE_RINGS
  } = {}) {
    const target = ScPortalGeometry.validPoint(center);
    if (!target) {
      return null;
    }
    if (!avoidOccupied) {
      return target;
    }

    const step = ScPortalGeometry.#searchStep(tokenDocument, scene);
    const others = ScPortalGeometry.#otherTokens(scene, tokenDocument);
    for (let ring = 0; ring <= Math.max(0, maxRings); ring += 1) {
      for (const candidate of ScPortalGeometry.#ringCandidates(target, ring, step)) {
        if (ScPortalGeometry.#isFree(candidate, tokenDocument, others, { snapToGrid, scene })) {
          return candidate;
        }
      }
    }
    return null;
  }

  static validPoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  /**
   * True when a token placed at this top left corner fits inside the scene.
   * A scene without usable dimensions is treated as unbounded, which is what
   * happens in the middle of a scene switch.
   */
  static isWithinScene(scene, topLeft, tokenDocument) {
    const point = ScPortalGeometry.validPoint(topLeft);
    if (!point) {
      return false;
    }

    const width = Number(scene?.dimensions?.width ?? scene?.width ?? 0);
    const height = Number(scene?.dimensions?.height ?? scene?.height ?? 0);
    const size = ScPortalGeometry.tokenPixelSize(tokenDocument, scene);
    if (width > 0 && (point.x < 0 || point.x + size.width > width)) {
      return false;
    }
    if (height > 0 && (point.y < 0 || point.y + size.height > height)) {
      return false;
    }
    return true;
  }

  static rectsOverlap(a, b) {
    return a.x < b.x + b.width
      && a.x + a.width > b.x
      && a.y < b.y + b.height
      && a.y + a.height > b.y;
  }

  /**
   * On a grid the search moves a cell at a time. Without a grid there are no
   * cells, so it steps by the token's own footprint, which is the smallest
   * offset that can actually clear an overlap.
   */
  static #searchStep(tokenDocument, scene) {
    if (!ScPortalGeometry.isGridless(scene)) {
      return ScPortalGeometry.gridSize(scene);
    }
    const size = ScPortalGeometry.tokenPixelSize(tokenDocument, scene);
    return Math.max(1, Math.max(size.width, size.height));
  }

  static #ringCandidates(center, ring, step) {
    if (ring <= 0) {
      return [{ ...center }];
    }

    const candidates = [];
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
          continue;
        }
        candidates.push({
          x: center.x + (dx * step),
          y: center.y + (dy * step)
        });
      }
    }
    // Nearest first, so a blocked centre lands on the closest free cell rather
    // than an arbitrary corner of the ring.
    return candidates.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y)
      - Math.hypot(b.x - center.x, b.y - center.y));
  }

  static #isFree(candidate, tokenDocument, others, { snapToGrid, scene }) {
    const topLeft = ScPortalGeometry.topLeftForCenter(candidate, tokenDocument, { snapToGrid, scene });
    if (!topLeft) {
      return false;
    }

    // A candidate hanging off the edge of the scene is rejected by the caller
    // anyway, so it has to be skipped here or the search stops at the first
    // empty spot outside the map instead of trying the cells further in.
    if (!ScPortalGeometry.isWithinScene(scene, topLeft, tokenDocument)) {
      return false;
    }

    const size = ScPortalGeometry.tokenPixelSize(tokenDocument, scene);
    const rect = { x: topLeft.x, y: topLeft.y, width: size.width, height: size.height };
    return !others.some((other) => ScPortalGeometry.rectsOverlap(rect, other));
  }

  static #otherTokens(scene, tokenDocument) {
    const documents = scene?.tokens?.contents ?? Array.from(scene?.tokens ?? []);
    return documents
      .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
      .filter((document) => document && document.id !== tokenDocument?.id)
      .map((document) => {
        const size = ScPortalGeometry.tokenPixelSize(document, scene);
        return {
          x: Number(ScPortalGeometry.#sourceValue(document, "x")) || 0,
          y: Number(ScPortalGeometry.#sourceValue(document, "y")) || 0,
          width: size.width,
          height: size.height
        };
      });
  }

  /** Read the non-animated document source when Foundry exposes one. */
  static #sourceValue(document, field) {
    return document?._source?.[field] ?? document?.[field];
  }

  static #sceneIsActive(scene) {
    return Boolean(scene?.id) && scene.id === canvas?.scene?.id;
  }
}
