import test from "node:test";
import assert from "node:assert/strict";

const { ScRangeShape } = await import("../../scripts/activities/canvas/ScRangeShape.js");

const SCENE = { grid: { size: 100, distance: 5 } };

test("range shapes default to circle and expose the three supported choices", () => {
  assert.equal(ScRangeShape.normalize(undefined), "circle");
  assert.equal(ScRangeShape.normalize("unknown"), "circle");
  assert.deepEqual(ScRangeShape.choices(), ["system", "circle", "square", "grid"]);
});

test("system shape follows the D&D square-template setting", (t) => {
  globalThis.game = { settings: { get: () => true } };
  t.after(() => delete globalThis.game);

  assert.equal(ScRangeShape.isSquare("system"), true);
  globalThis.game.settings.get = () => false;
  assert.equal(ScRangeShape.isSquare("system"), false);
  assert.equal(ScRangeShape.isSquare("square"), true);
  assert.equal(ScRangeShape.isSquare("circle"), false);
  assert.equal(ScRangeShape.isSquare("grid"), false);
});

test("circle and square use matching Euclidean and diagonal distances", () => {
  const origin = { x: 0, y: 0 };
  const diagonal = { x: 600, y: 600 };
  assert.ok(ScRangeShape.distance(origin, diagonal, "circle", SCENE) > 30);
  assert.equal(ScRangeShape.distance(origin, diagonal, "square", SCENE), 30);
});

test("the shared drawer renders a centered circle or square", () => {
  const calls = [];
  const graphics = {
    drawCircle: (...args) => calls.push(["circle", ...args]),
    drawRect: (...args) => calls.push(["square", ...args])
  };

  ScRangeShape.draw(graphics, { x: 100, y: 200 }, 50, "circle");
  ScRangeShape.draw(graphics, { x: 100, y: 200 }, 50, "square");
  assert.deepEqual(calls, [
    ["circle", 100, 200, 50],
    ["square", 50, 150, 100, 100]
  ]);
});

test("the shared preview converts scene units and applies its style", () => {
  const calls = [];
  const graphics = {
    lineStyle: (...args) => calls.push(["lineStyle", ...args]),
    beginFill: (...args) => calls.push(["beginFill", ...args]),
    drawRect: (...args) => calls.push(["square", ...args]),
    endFill: () => calls.push(["endFill"])
  };

  ScRangeShape.drawPreview(graphics, {
    center: { x: 500, y: 400 },
    distance: 30,
    rangeShape: "square",
    scene: SCENE,
    borderColor: "#123456",
    fillColor: "#abcdef"
  });

  assert.deepEqual(calls, [
    ["lineStyle", 2, 0x123456, 0.9],
    ["beginFill", 0xabcdef, 0.12],
    ["square", -100, -200, 1200, 1200],
    ["endFill"]
  ]);
});

test("legacy grid measurement does not draw a misleading geometric boundary", () => {
  const calls = [];
  const graphics = {
    lineStyle: (...args) => calls.push(["lineStyle", ...args]),
    beginFill: (...args) => calls.push(["beginFill", ...args]),
    drawCircle: (...args) => calls.push(["circle", ...args]),
    drawRect: (...args) => calls.push(["square", ...args]),
    endFill: () => calls.push(["endFill"])
  };

  ScRangeShape.drawPreview(graphics, {
    center: { x: 100, y: 100 },
    distance: 30,
    rangeShape: "grid",
    scene: SCENE
  });

  assert.deepEqual(calls, []);
});
