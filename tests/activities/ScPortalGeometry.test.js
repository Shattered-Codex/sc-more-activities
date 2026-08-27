import test from "node:test";
import assert from "node:assert/strict";

// The module reads the Foundry `canvas` global directly, as the other canvas
// helpers do. Node has no such global, so the tests declare it as absent and
// the helpers fall back to plain grid arithmetic.
globalThis.canvas = null;

const { ScPortalGeometry } = await import("../../scripts/activities/portal/ScPortalGeometry.js");

const SQUARE_GRID = { id: "scene-1", grid: { size: 100, distance: 5, type: 1 } };
const GRIDLESS = { id: "scene-2", grid: { size: 100, distance: 5, type: 0 } };

function makeToken({ id, x, y, width = 1, height = 1 }) {
  return { id, x, y, width, height };
}

function makeScene(base, tokens = []) {
  const collection = new Map(tokens.map((token) => [token.id, token]));
  collection.contents = tokens;
  return { ...base, tokens: collection };
}

test("snapping centres a point on its grid cell", () => {
  const snapped = ScPortalGeometry.snapCenter({ x: 237, y: 118 }, { snapToGrid: true, scene: SQUARE_GRID });
  assert.deepEqual(snapped, { x: 250, y: 150 });
});

test("a gridless scene keeps the exact clicked point even with snapping on", () => {
  const snapped = ScPortalGeometry.snapCenter({ x: 237, y: 118 }, { snapToGrid: true, scene: GRIDLESS });
  assert.deepEqual(snapped, { x: 237, y: 118 });
});

test("square and circle portals hit test their own shape", () => {
  const square = { center: { x: 100, y: 100 }, radiusPixels: 50, shape: "square" };
  const circle = { center: { x: 100, y: 100 }, radiusPixels: 50, shape: "circle" };
  const corner = { x: 145, y: 145 };

  assert.equal(ScPortalGeometry.containsPoint(square, corner), true);
  // The same corner sits outside the inscribed circle.
  assert.equal(ScPortalGeometry.containsPoint(circle, corner), false);
  assert.equal(ScPortalGeometry.containsPoint(circle, { x: 130, y: 100 }), true);
});

test("portal reach uses persisted token coordinates while Foundry animates prepared values", () => {
  const portal = { center: { x: 150, y: 150 }, radiusPixels: 50, shape: "square" };
  const token = makeToken({ id: "traveller", x: 1500, y: 1500 });
  token._source = { x: 100, y: 100, width: 1, height: 1 };

  assert.deepEqual(ScPortalGeometry.tokenCenter(token, SQUARE_GRID), { x: 150, y: 150 });
  assert.equal(ScPortalGeometry.tokenReachesPortal(portal, token, SQUARE_GRID), true);
});

test("prepared animation coordinates cannot make a distant token reach a portal", () => {
  const portal = { center: { x: 150, y: 150 }, radiusPixels: 50, shape: "square" };
  const token = makeToken({ id: "traveller", x: 100, y: 100 });
  token._source = { x: 1500, y: 1500, width: 1, height: 1 };

  assert.equal(ScPortalGeometry.tokenReachesPortal(portal, token, SQUARE_GRID), false);
});

test("a blocked destination falls back to the nearest free cell", () => {
  const traveller = makeToken({ id: "traveller", x: 0, y: 0 });
  const blocker = makeToken({ id: "blocker", x: 200, y: 200 });
  const scene = makeScene(SQUARE_GRID, [traveller, blocker]);

  const free = ScPortalGeometry.findFreeCenter(scene, { x: 250, y: 250 }, traveller, {
    avoidOccupied: true,
    snapToGrid: true
  });
  assert.notDeepEqual(free, { x: 250, y: 250 });
  assert.equal(Math.hypot(free.x - 250, free.y - 250), 100);
});

test("the destination is kept as is when occupancy is not avoided", () => {
  const traveller = makeToken({ id: "traveller", x: 0, y: 0 });
  const blocker = makeToken({ id: "blocker", x: 200, y: 200 });
  const scene = makeScene(SQUARE_GRID, [traveller, blocker]);

  const free = ScPortalGeometry.findFreeCenter(scene, { x: 250, y: 250 }, traveller, {
    avoidOccupied: false,
    snapToGrid: true
  });
  assert.deepEqual(free, { x: 250, y: 250 });
});

test("a fully blocked search returns null instead of stacking tokens", () => {
  const traveller = makeToken({ id: "traveller", x: 0, y: 0 });
  const blocker = makeToken({ id: "blocker", x: 200, y: 200 });
  const scene = makeScene(SQUARE_GRID, [traveller, blocker]);

  const free = ScPortalGeometry.findFreeCenter(scene, { x: 250, y: 250 }, traveller, {
    avoidOccupied: true,
    snapToGrid: true,
    maxRings: 0
  });
  assert.equal(free, null);
});

test("the token itself never blocks its own landing spot", () => {
  const traveller = makeToken({ id: "traveller", x: 200, y: 200 });
  const scene = makeScene(SQUARE_GRID, [traveller]);

  const free = ScPortalGeometry.findFreeCenter(scene, { x: 250, y: 250 }, traveller, {
    avoidOccupied: true,
    snapToGrid: true,
    maxRings: 0
  });
  assert.deepEqual(free, { x: 250, y: 250 });
});

test("a large token is centred on the point it lands on", () => {
  const traveller = makeToken({ id: "traveller", x: 0, y: 0, width: 2, height: 2 });
  const topLeft = ScPortalGeometry.topLeftForCenter({ x: 300, y: 300 }, traveller, {
    snapToGrid: true,
    scene: SQUARE_GRID
  });
  assert.deepEqual(topLeft, { x: 200, y: 200 });
});

test("the footprint is measured in whole grid squares", () => {
  assert.equal(ScPortalGeometry.radiusPixels(1, SQUARE_GRID), 50);
  assert.equal(ScPortalGeometry.radiusPixels(2, SQUARE_GRID), 100);
  assert.equal(ScPortalGeometry.radiusPixels(4, SQUARE_GRID), 200);
});

test("an out of range footprint is clamped to the offered choices", () => {
  assert.equal(ScPortalGeometry.squareCount(0), 1);
  assert.equal(ScPortalGeometry.squareCount(99), 4);
  assert.equal(ScPortalGeometry.squareCount("3"), 3);
  assert.equal(ScPortalGeometry.squareCount(undefined), 1);
});

test("an even footprint snaps to a grid corner instead of a cell centre", () => {
  // Centred on a cell centre, a 2x2 portal would cover half of eight cells
  // around it rather than four whole ones.
  const snapped = ScPortalGeometry.snapCenter({ x: 237, y: 118 }, {
    snapToGrid: true,
    scene: SQUARE_GRID,
    squares: 2
  });
  assert.deepEqual(snapped, { x: 200, y: 100 });
});

test("an even footprint centred on a corner covers whole cells", () => {
  const center = ScPortalGeometry.snapCenter({ x: 237, y: 118 }, {
    snapToGrid: true,
    scene: SQUARE_GRID,
    squares: 2
  });
  const shape = ScPortalGeometry.regionShape(center, {
    shape: "square",
    radiusPixels: ScPortalGeometry.radiusPixels(2, SQUARE_GRID)
  });
  assert.deepEqual(shape, {
    type: "rectangle",
    x: 100,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    hole: false
  });
});

test("an odd footprint still snaps to the cell centre", () => {
  const snapped = ScPortalGeometry.snapCenter({ x: 237, y: 118 }, {
    snapToGrid: true,
    scene: SQUARE_GRID,
    squares: 3
  });
  assert.deepEqual(snapped, { x: 250, y: 150 });
});

test("a gridless scene ignores the footprint when snapping", () => {
  const snapped = ScPortalGeometry.snapCenter({ x: 237, y: 118 }, {
    snapToGrid: true,
    scene: GRIDLESS,
    squares: 2
  });
  assert.deepEqual(snapped, { x: 237, y: 118 });
});
