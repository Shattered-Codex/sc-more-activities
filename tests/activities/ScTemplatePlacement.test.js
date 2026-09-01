import test from "node:test";
import assert from "node:assert/strict";

const { ScTemplatePlacement } = await import("../../scripts/activities/conditional-chain/ScTemplatePlacement.js");

globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } };
globalThis.dnd5e = {
  config: {
    areaTargetTypes: {
      circle: { template: "circle" },
      cylinder: { template: "circle" },
      sphere: { template: "circle" },
      cone: { template: "cone" },
      line: { template: "ray" },
      cube: { template: "rect" }
    }
  }
};

function activity(type) {
  return { name: "Area", target: type ? { template: { type } } : {} };
}

test("a cone and a line are directional, so the player keeps aiming them", () => {
  assert.equal(ScTemplatePlacement.isDirectional("cone"), true);
  assert.equal(ScTemplatePlacement.isDirectional("ray"), true);
  assert.equal(ScTemplatePlacement.supportsPoint(activity("cone")), false);
  assert.equal(ScTemplatePlacement.supportsPoint(activity("line")), false);
});

test("a circle has no orientation, so it can be dropped on a point", () => {
  assert.equal(ScTemplatePlacement.isDirectional("circle"), false);
  for (const type of ["circle", "cylinder", "sphere"]) {
    assert.equal(ScTemplatePlacement.supportsPoint(activity(type)), true, type);
  }
});

test("a cube is directional only while the system renders it as a rotatable ray", () => {
  // dnd5e turns a cube into a ray unless square templates are grid aligned.
  assert.equal(ScTemplatePlacement.isDirectional("rect", { gridAlignedSquares: false }), true);
  assert.equal(ScTemplatePlacement.isDirectional("rect", { gridAlignedSquares: true }), false);
});

test("the grid-aligned setting decides for a cube", (t) => {
  const original = globalThis.game.settings;
  t.after(() => { globalThis.game.settings = original; });

  globalThis.game.settings = { get: () => false };
  assert.equal(ScTemplatePlacement.supportsPoint(activity("cube")), false);

  globalThis.game.settings = { get: () => true };
  assert.equal(ScTemplatePlacement.supportsPoint(activity("cube")), true);
});

test("an unreadable setting is treated as not grid aligned, the safer reading", (t) => {
  const original = globalThis.game.settings;
  t.after(() => { globalThis.game.settings = original; });

  globalThis.game.settings = { get: () => { throw new Error("not registered"); } };
  // Falling back to "directional" keeps the interactive placement rather than
  // silently pinning a cube's rotation.
  assert.equal(ScTemplatePlacement.supportsPoint(activity("cube")), false);
});

test("an activity with no area supports nothing", () => {
  assert.equal(ScTemplatePlacement.hasTemplate(activity(null)), false);
  assert.equal(ScTemplatePlacement.supportsPoint(activity(null)), false);
  assert.equal(ScTemplatePlacement.shapeFor(activity(null)), null);
  assert.equal(ScTemplatePlacement.shapeFor(activity("unknown-type")), null);
});

test("placing returns the created documents and rounds the point", async(t) => {
  const calls = [];
  const created = [];
  globalThis.dnd5e.canvas = {
    AbilityTemplate: {
      fromActivity(_activity, options) {
        calls.push(options);
        return [{ document: { toObject: () => ({ t: "circle", ...options }) } }];
      }
    }
  };
  const scene = { createEmbeddedDocuments: async(name, data) => { created.push([name, data]); return data; } };
  t.after(() => { delete globalThis.dnd5e.canvas; });

  const docs = await ScTemplatePlacement.place(activity("circle"), { x: 1450.7, y: 900.2 }, { scene });

  assert.deepEqual(calls[0], { x: 1451, y: 900 });
  assert.equal(created[0][0], "MeasuredTemplate");
  assert.equal(docs.length, 1);
});

test("a failure returns empty rather than throwing into the chain", async(t) => {
  globalThis.dnd5e.canvas = {
    AbilityTemplate: { fromActivity() { throw new Error("boom"); } }
  };
  t.after(() => { delete globalThis.dnd5e.canvas; });

  const scene = { createEmbeddedDocuments: async() => [] };
  assert.deepEqual(await ScTemplatePlacement.place(activity("circle"), { x: 1, y: 1 }, { scene }), []);
});

test("no point, no scene and no system all place nothing", async() => {
  assert.deepEqual(await ScTemplatePlacement.place(activity("circle"), null, { scene: {} }), []);
  assert.deepEqual(await ScTemplatePlacement.place(activity("circle"), { x: 1, y: 1 }, { scene: null }), []);
});

test("a failed placement is announced, since the preview was already suppressed", (t) => {
  const warnings = [];
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
  t.after(() => { delete globalThis.ui; });

  ScTemplatePlacement.warnPlacementFailed({ name: "Fireball" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Fireball/);
});
