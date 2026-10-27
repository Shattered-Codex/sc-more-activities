import test from "node:test";
import assert from "node:assert/strict";

const { ScRecallPlacement } = await import("../../scripts/activities/recall/ScRecallPlacement.js");

/** A 100px grid; the innkeeper stands on square (5, 5). */
function makeScene({ tokens = [], walls = [], bounds = { x: 0, y: 0, width: 1000, height: 1000 } } = {}) {
  const innkeeper = { id: "innkeeper", x: 500, y: 500, width: 1, height: 1 };
  return {
    innkeeper,
    scene: {
      grid: { size: 100 },
      dimensions: { sceneRect: bounds },
      tokens: [innkeeper, ...tokens],
      walls
    }
  };
}

const traveller = (id, size = 1) => ({ id, width: size, height: size });
const at = (column, row) => ({ x: column * 100, y: row * 100 });

test("lands on a square right beside the anchor", () => {
  const { scene, innkeeper } = makeScene();

  const [spot] = ScRecallPlacement.findSpots(scene, innkeeper, [traveller("hero")]);

  assert.ok(Math.abs(spot.x - 500) <= 100 && Math.abs(spot.y - 500) <= 100);
  assert.notDeepEqual(spot, at(5, 5));
});

test("prefers the squares that share a side with the anchor over the corners", () => {
  const { scene, innkeeper } = makeScene();

  const spots = ScRecallPlacement.findSpots(scene, innkeeper, [1, 2, 3, 4].map((n) => traveller(`t${n}`)));

  for (const spot of spots) {
    assert.ok(spot.x === 500 || spot.y === 500, JSON.stringify(spot));
  }
});

test("gives each traveller its own square and skips squares other tokens hold", () => {
  const blockers = [at(4, 5), at(6, 5), at(5, 4)].map((point, index) => ({ id: `b${index}`, ...point, width: 1, height: 1 }));
  const { scene, innkeeper } = makeScene({ tokens: blockers });

  const spots = ScRecallPlacement.findSpots(scene, innkeeper, [traveller("a"), traveller("b")]);

  assert.deepEqual(spots[0], at(5, 6));
  assert.notDeepEqual(spots[1], spots[0]);
  for (const blocker of blockers) {
    assert.ok(spots.every((spot) => spot.x !== blocker.x || spot.y !== blocker.y));
  }
});

test("a token that is leaving does not block its own square", () => {
  const hero = { id: "hero", ...at(5, 6), width: 1, height: 1 };
  const { scene, innkeeper } = makeScene({ tokens: [hero] });
  scene.tokens.push(...[at(4, 5), at(6, 5), at(5, 4)].map((point, index) => ({ id: `b${index}`, ...point, width: 1, height: 1 })));

  const [spot] = ScRecallPlacement.findSpots(scene, innkeeper, [hero], { ignoreIds: new Set(["hero"]) });

  assert.deepEqual(spot, at(5, 6));
});

test("never lands behind a wall that blocks movement, but an open door lets it through", () => {
  // A wall just below the innkeeper, across the whole row.
  const wall = { c: [0, 600, 1000, 600], move: 20, door: 0, ds: 0 };
  const blockers = [at(4, 5), at(6, 5), at(5, 4), at(4, 4), at(6, 4)].map((point, index) => ({ id: `b${index}`, ...point, width: 1, height: 1 }));
  const { scene, innkeeper } = makeScene({ tokens: blockers, walls: [wall] });

  const [spot] = ScRecallPlacement.findSpots(scene, innkeeper, [traveller("hero")]);
  assert.ok(spot.y < 600, JSON.stringify(spot));

  wall.door = 1;
  wall.ds = 1;
  const [throughDoor] = ScRecallPlacement.findSpots(scene, innkeeper, [traveller("hero")]);
  assert.deepEqual(throughDoor, at(5, 6));
});

test("stays inside the scene", () => {
  const { scene, innkeeper } = makeScene({ bounds: { x: 500, y: 500, width: 200, height: 100 } });

  const [spot] = ScRecallPlacement.findSpots(scene, innkeeper, [traveller("hero")]);

  assert.deepEqual(spot, at(6, 5));
});

test("a large traveller fits beside the anchor without overlapping it", () => {
  const { scene, innkeeper } = makeScene();

  const [spot] = ScRecallPlacement.findSpots(scene, innkeeper, [traveller("ogre", 2)]);

  const overlaps = spot.x < 600 && spot.x + 200 > 500 && spot.y < 600 && spot.y + 200 > 500;
  assert.equal(overlaps, false);
});

test("returns null for a traveller with no free square in reach", (t) => {
  const rings = ScRecallPlacement.MAX_RINGS;
  ScRecallPlacement.MAX_RINGS = 1;
  t.after(() => { ScRecallPlacement.MAX_RINGS = rings; });
  const around = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx || dy) around.push({ id: `b${dx}${dy}`, ...at(5 + dx, 5 + dy), width: 1, height: 1 });
    }
  }
  const { scene, innkeeper } = makeScene({ tokens: around });

  assert.deepEqual(ScRecallPlacement.findSpots(scene, innkeeper, [traveller("hero")]), [null]);
});

test("an anchor closed in on every side gets no spot, not even past the corners where its walls meet", () => {
  // Four walls along the edges of the innkeeper's square, meeting at its corners.
  const walls = [
    [500, 500, 600, 500],
    [600, 500, 600, 600],
    [600, 600, 500, 600],
    [500, 600, 500, 500]
  ].map((c) => ({ c, move: 20, door: 0, ds: 0 }));
  const { scene, innkeeper } = makeScene({ walls });

  assert.deepEqual(ScRecallPlacement.findSpots(scene, innkeeper, [traveller("hero")]), [null]);
});
