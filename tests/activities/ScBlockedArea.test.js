import test from "node:test";
import assert from "node:assert/strict";

const { ScBlockedArea } = await import("../../scripts/activities/canvas/ScBlockedArea.js");

const SCENE = {
  id: "scene-blocked",
  grid: { size: 100, distance: 5 },
  dimensions: { sceneRect: { x: 0, y: 0, width: 1000, height: 1000 } }
};

function installCanvas(t, extra = {}) {
  globalThis.game = { settings: { get: () => false } };
  globalThis.canvas = { scene: SCENE, grid: { size: 100 }, ...extra };
  t.after(() => {
    delete globalThis.canvas;
    delete globalThis.game;
    delete globalThis.CONFIG;
  });
}

/** The centre of each blocked space, read back from its polygon. */
function centers(cells) {
  return cells.map((points) => `${(points[0] + points[2]) / 2},${(points[1] + points[5]) / 2}`).sort();
}

test("marks the spaces the origin cannot see and leaves the rest alone", (t) => {
  installCanvas(t);
  // A wall at x = 600: nothing to its right is in sight.
  const probe = { kind: "polygon", test: (point) => point.x < 600 };

  const cells = ScBlockedArea.blockedCells({
    originCenter: { x: 450, y: 450 },
    distance: 10,
    rangeShape: "square",
    scene: SCENE,
    probe
  });

  assert.deepEqual(centers(cells), ["650,250", "650,350", "650,450", "650,550", "650,650"]);
});

test("marks the spaces under another token", (t) => {
  installCanvas(t);
  const cells = ScBlockedArea.blockedCells({
    originCenter: { x: 450, y: 450 },
    distance: 10,
    rangeShape: "square",
    scene: SCENE,
    sight: false,
    occupied: [{ x: 500, y: 400, width: 200, height: 100 }]
  });

  assert.deepEqual(centers(cells), ["550,450", "650,450"]);
});

test("also marks the spaces this user cannot currently see", (t) => {
  installCanvas(t, {
    visibility: { testVisibility: (point) => point.y < 400 }
  });
  const cells = ScBlockedArea.blockedCells({
    originCenter: { x: 450, y: 350 },
    distance: 5,
    rangeShape: "square",
    scene: SCENE,
    probe: null,
    requireVisibility: true
  });

  assert.deepEqual(centers(cells), ["350,450", "450,450", "550,450"]);
});

test("keeps to the scene and reuses the cached spaces while nothing changed", (t) => {
  installCanvas(t);
  let tests = 0;
  const probe = { kind: "polygon", test: () => { tests += 1; return false; } };
  const cache = {};
  const options = { originCenter: { x: 50, y: 50 }, distance: 5, rangeShape: "square", scene: SCENE, probe, cache };

  const first = ScBlockedArea.blockedCells(options);
  // The origin sits in the scene corner: only the 2x2 spaces on the scene count.
  assert.equal(first.length, 4);
  const counted = tests;
  assert.equal(ScBlockedArea.blockedCells(options), first);
  assert.equal(tests, counted);

  ScBlockedArea.blockedCells({ ...options, originCenter: { x: 150, y: 150 } });
  assert.ok(tests > counted, "a moved origin recomputes the spaces");
});

test("tests sight just short of a point lying on a wall", (t) => {
  installCanvas(t);
  const seen = [];
  const probe = { kind: "polygon", test: (point) => { seen.push(point); return point.x < 300; } };

  assert.equal(ScBlockedArea.canSee({ x: 100, y: 100 }, { x: 300, y: 100 }, { probe }), true);
  assert.ok(seen[0].x < 300 && seen[0].x > 297);
  assert.equal(ScBlockedArea.canSee({ x: 100, y: 100 }, { x: 400, y: 100 }, { probe }), false);
});

test("never blocks anything without a sight backend", (t) => {
  installCanvas(t);
  assert.equal(ScBlockedArea.sightProbe({ x: 0, y: 0 }), null);
  assert.equal(ScBlockedArea.canSee({ x: 0, y: 0 }, { x: 500, y: 0 }), true);
  assert.deepEqual(ScBlockedArea.blockedCells({ originCenter: { x: 450, y: 450 }, distance: 10, scene: SCENE }), []);
});

test("a token next to a footprint does not occupy it", () => {
  const rect = { x: 100, y: 100, width: 100, height: 100 };
  assert.equal(ScBlockedArea.overlappingRect(rect, [{ x: 200, y: 100, width: 100, height: 100 }]), null);
  assert.ok(ScBlockedArea.overlappingRect(rect, [{ x: 150, y: 100, width: 100, height: 100 }]));
});

test("a movement path is blocked only by a movement wall across it", (t) => {
  installCanvas(t);
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        move: { testCollision: (from, to, options) => options.type === "move" && to.x > 300 }
      }
    }
  };
  assert.equal(ScBlockedArea.isPathBlocked({ x: 0, y: 0 }, { x: 200, y: 0 }), false);
  assert.equal(ScBlockedArea.isPathBlocked({ x: 0, y: 0 }, { x: 400, y: 0 }), true);
});

test("a scene without token vision never blocks a space for visibility", (t) => {
  // Core answers "GM only" here because no vision source is active.
  installCanvas(t, { visibility: { tokenVision: false, testVisibility: () => false } });
  assert.equal(ScBlockedArea.isVisibleToUser({ x: 100, y: 100 }), true);
  globalThis.canvas.visibility.tokenVision = true;
  assert.equal(ScBlockedArea.isVisibleToUser({ x: 100, y: 100 }), false);
});

test("the cached layer is repainted only when the spaces or the colour change", (t) => {
  installCanvas(t);
  class Graphics {
    constructor() { this.children = []; this.polygons = 0; this.clears = 0; this.parent = null; }
    addChild(child) { this.children.push(child); child.parent = this; return child; }
    clear() { this.clears += 1; this.polygons = 0; return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawPolygon() { this.polygons += 1; return this; }
    endFill() { return this; }
  }
  globalThis.PIXI = { Graphics };
  t.after(() => delete globalThis.PIXI);

  const parent = new Graphics();
  const cache = {};
  const options = {
    originCenter: { x: 450, y: 450 }, distance: 5, rangeShape: "square", scene: SCENE,
    probe: { kind: "polygon", test: (point) => point.x < 500 }, cache
  };
  ScBlockedArea.blockedCells(options);
  ScBlockedArea.drawCachedCells(parent, cache, "#ff0000");
  const [layer] = parent.children;
  assert.equal(layer.polygons, 3);

  ScBlockedArea.blockedCells(options);
  ScBlockedArea.drawCachedCells(parent, cache, "#ff0000");
  assert.equal(parent.children.length, 1);
  assert.equal(layer.clears, 1);

  ScBlockedArea.drawCachedCells(parent, cache, "#00ff00");
  assert.equal(layer.clears, 2);

  // The origin is gone: the layer empties instead of keeping the old spaces.
  ScBlockedArea.blockedCells({ ...options, originCenter: null });
  ScBlockedArea.drawCachedCells(parent, cache, "#00ff00");
  assert.equal(layer.polygons, 0);
});

test("opening a door invalidates the cached spaces and sight sweep", (t) => {
  installCanvas(t);
  const listeners = new Map();
  globalThis.Hooks = {
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    }
  };
  t.after(() => delete globalThis.Hooks);

  // The door at x = 600 is closed: sight stops there.
  let doorOpen = false;
  let sweeps = 0;
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        sight: {
          create() {
            sweeps += 1;
            const open = doorOpen;
            return {
              points: [0, 0, 1, 0, 1, 1],
              contains: (x) => open || x < 600
            };
          }
        }
      }
    }
  };

  const probeCache = {};
  const cellCache = {};
  const origin = { x: 450, y: 450 };
  const cells = () => ScBlockedArea.blockedCells({
    originCenter: origin,
    distance: 10,
    rangeShape: "square",
    scene: SCENE,
    probe: ScBlockedArea.cachedSightProbe(probeCache, origin),
    cache: cellCache
  });

  assert.equal(cells().length, 5);
  assert.equal(cells().length, 5);
  assert.equal(sweeps, 1);

  // The wall count does not change when a door opens; the hook does fire.
  doorOpen = true;
  for (const listener of listeners.get("updateWall") ?? []) {
    listener();
  }
  assert.equal(cells().length, 0);
  assert.equal(sweeps, 2);
});

test("draws a colour the pickers already converted to a number", () => {
  const fills = [];
  const graphics = {
    lineStyle() {},
    beginFill(color) { fills.push(color); },
    drawPolygon() {},
    endFill() {}
  };
  ScBlockedArea.drawCells(graphics, [[0, 0, 1, 0, 1, 1]], 0x00ff00);
  ScBlockedArea.drawCells(graphics, [[0, 0, 1, 0, 1, 1]], "#0000ff");
  assert.deepEqual(fills, [0x00ff00, 0x0000ff]);
});
