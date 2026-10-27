import test from "node:test";
import assert from "node:assert/strict";

const { ScRecallRange } = await import("../../scripts/activities/recall/ScRecallRange.js");

/** A 100px grid of 5-foot squares. */
const scene = { grid: { size: 100, distance: 5 } };
const token = (column, row, size = 1) => ({ x: column * 100, y: row * 100, width: size, height: size });

test("adjacent tokens are 5 feet apart whatever their size", () => {
  assert.equal(ScRecallRange.between(token(0, 0), token(1, 0), "square", scene), 5);
  assert.equal(ScRecallRange.between(token(0, 0), token(1, 0, 3), "square", scene), 5);
  assert.equal(ScRecallRange.between(token(0, 3), token(1, 0, 3), "circle", scene), 5);
});

test("each empty square between the edges adds 5 feet", () => {
  assert.equal(ScRecallRange.between(token(0, 0), token(3, 0), "square", scene), 15);
  assert.equal(ScRecallRange.between(token(0, 0), token(3, 0, 3), "square", scene), 15);
});

test("a square shape counts diagonals like straight lines; a circle measures them", () => {
  assert.equal(ScRecallRange.between(token(0, 0), token(2, 2), "square", scene), 10);
  assert.ok(Math.abs(ScRecallRange.between(token(0, 0), token(2, 2), "circle", scene) - 12.07) < 0.01);
});

test("overlapping tokens are 0 apart", () => {
  assert.equal(ScRecallRange.between(token(1, 1), token(0, 0, 3), "square", scene), 0);
});

test("placeables are measured through their document", () => {
  assert.equal(ScRecallRange.between({ document: token(0, 0) }, { document: token(2, 0) }, "square", scene), 10);
});
