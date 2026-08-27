import test from "node:test";
import assert from "node:assert/strict";

globalThis.canvas = null;
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {}
    }
  },
  utils: {}
};

const { ScPortalPlacementApp } = await import("../../scripts/activities/portal/ScPortalPlacementApp.js");

const SCENE = { id: "scene-1", grid: { size: 100, distance: 5, type: 1 } };
const ORIGIN = { x: 150, y: 150 };

function issue(overrides = {}) {
  return ScPortalPlacementApp.placementIssueFor({
    point: { x: 250, y: 150 },
    originCenter: ORIGIN,
    placementRange: 30,
    scene: SCENE,
    ...overrides
  });
}

test("a point inside the range is accepted", () => {
  assert.equal(issue(), null);
});

test("a point beyond the range is reported as out of range", () => {
  // 900px from the origin is 45 scene units on this grid, past the 30 allowed.
  assert.equal(issue({ point: { x: 1050, y: 150 } }), "range");
});

test("an unresolved origin is its own problem, not an out of range point", () => {
  // Reporting "must be placed within 30" for this sent the user looking for a
  // distance problem when the real one is a missing token on the scene.
  assert.equal(issue({ originCenter: null }), "origin");
});

test("an unlimited placement range needs no origin at all", () => {
  assert.equal(issue({ originCenter: null, placementRange: 0 }), null);
});

test("the exit is measured against the entry when a link range is set", () => {
  assert.equal(issue({ entryPoint: { x: 150, y: 150 }, linkRange: 10 }), null);
  assert.equal(issue({ entryPoint: { x: 150, y: 150 }, linkRange: 2 }), "linkRange");
});

test("an empty link range never restricts the exit", () => {
  assert.equal(issue({ entryPoint: { x: 150, y: 150 }, linkRange: "" }), null);
});

test("a missing point is rejected before anything else", () => {
  assert.equal(issue({ point: null, originCenter: null }), "invalid");
});
