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

function regionActivity(type, template = {}) {
  return {
    name: "Area",
    uuid: "Actor.a1.Item.i1.Activity.act1",
    item: { name: "Fireball", uuid: "Actor.a1.Item.i1" },
    target: { template: { type, size: 20, units: "ft", ...template } },
    getRollData: () => ({ item: { level: 3 } }),
    getUsageToken: () => ({ uuid: "Scene.s1.Token.t1" })
  };
}

/** Installs the dnd5e 6 globals: region placement, unit conversion and hooks. */
function installRegionSystem(t, { hooks = {} } = {}) {
  const calls = [];
  const scene = {
    grid: { size: 100, distance: 5, units: "ft" },
    createEmbeddedDocuments: async(name, data) => {
      calls.push(["create", name, data]);
      return data.map((entry, index) => ({ id: `region-${index}`, ...entry }));
    }
  };
  const originalUser = globalThis.game.user;

  globalThis.dnd5e.canvas = { TemplatePlacement: {} };
  globalThis.dnd5e.utils = { convertLength: (value) => value };
  globalThis.Hooks = {
    call: (name, ...args) => {
      calls.push([name, ...args]);
      return hooks[name]?.(...args);
    },
    callAll: (name, ...args) => calls.push([name, ...args])
  };
  globalThis.CONST = { REGION_VISIBILITY: { ALWAYS: 2 } };
  globalThis.canvas = { scene, level: { id: "level-1" } };
  globalThis.game.user = { name: "GM", color: "#ff0000" };

  t.after(() => {
    delete globalThis.dnd5e.canvas;
    delete globalThis.dnd5e.utils;
    delete globalThis.Hooks;
    delete globalThis.CONST;
    delete globalThis.canvas;
    globalThis.game.user = originalUser;
  });
  return { calls, scene };
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

test("a dnd5e 6 emanation stays with the system placement while a ring can use a point", (t) => {
  const types = globalThis.dnd5e.config.areaTargetTypes;
  types.radius = { template: "emanation" };
  types.ring = { template: "ring" };
  t.after(() => {
    delete types.radius;
    delete types.ring;
  });

  // The system attaches an emanation to the usage token while placing it.
  assert.equal(ScTemplatePlacement.supportsPoint(activity("radius")), false);
  assert.equal(ScTemplatePlacement.supportsPoint(activity("ring")), true);
});

test("an activity with no area supports nothing", () => {
  assert.equal(ScTemplatePlacement.hasTemplate(activity(null)), false);
  assert.equal(ScTemplatePlacement.supportsPoint(activity(null)), false);
  assert.equal(ScTemplatePlacement.shapeFor(activity(null)), null);
  assert.equal(ScTemplatePlacement.shapeFor(activity("unknown-type")), null);
});

test("on dnd5e 5.3 placing creates measured templates at the rounded point", async(t) => {
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

test("on dnd5e 6 a circle becomes a region at the point with the system's data and hooks", async(t) => {
  const { calls, scene } = installRegionSystem(t);

  const docs = await ScTemplatePlacement.place(regionActivity("sphere"), { x: 1450.7, y: 900.2 }, { scene });

  assert.equal(docs.length, 1);
  const [, documentName, [region]] = calls.find(([name]) => name === "create");
  assert.equal(documentName, "Region");
  // 20 ft on a 100 px / 5 ft grid.
  assert.deepEqual(region.shapes, [{ x: 1451, y: 900, rotation: 0, type: "circle", radius: 400 }]);
  assert.equal(region.name, "Fireball [GM]");
  assert.equal(region.color, "#ff0000");
  assert.deepEqual(region.levels, ["level-1"]);
  assert.deepEqual(region.restriction, { enabled: true, type: "move" });
  assert.equal(region.visibility, 2);
  assert.equal(region.highlightMode, "coverage");
  assert.deepEqual(region.flags.dnd5e, {
    activity: "Actor.a1.Item.i1.Activity.act1",
    dimensions: { size: 20, width: undefined, height: undefined, units: "ft" },
    item: "Actor.a1.Item.i1",
    origin: "Scene.s1.Token.t1",
    spellLevel: 3
  });
  assert.deepEqual(
    calls.map(([name]) => name),
    ["dnd5e.preCreateMeasuredTemplate", "dnd5e.createMeasuredTemplate", "create", "dnd5e.postCreateMeasuredTemplate"]
  );
});

test("on dnd5e 6 a cube and a ring keep their sizes at the point", async(t) => {
  const { calls, scene } = installRegionSystem(t);
  const types = globalThis.dnd5e.config.areaTargetTypes;
  types.ring = { template: "ring" };
  t.after(() => { delete types.ring; });

  await ScTemplatePlacement.place(regionActivity("cube"), { x: 100, y: 200 }, { scene });
  await ScTemplatePlacement.place(regionActivity("ring", { width: 10 }), { x: 100, y: 200 }, { scene });

  const [cube, ring] = calls.filter(([name]) => name === "create").map(([, , [region]]) => region.shapes[0]);
  assert.deepEqual(cube, { x: 100, y: 200, rotation: 0, type: "rectangle", width: 400, height: 400 });
  assert.deepEqual(ring, { x: 100, y: 200, rotation: 0, type: "ring", radius: 400, outerWidth: 200, innerWidth: 0 });
});

test("on dnd5e 6 the system's template hooks can still cancel the region", async(t) => {
  const { calls, scene } = installRegionSystem(t, {
    hooks: { "dnd5e.createMeasuredTemplate": () => false }
  });

  const docs = await ScTemplatePlacement.place(regionActivity("sphere"), { x: 1, y: 1 }, { scene });

  assert.deepEqual(docs, []);
  assert.equal(calls.some(([name]) => name === "create"), false);
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
  assert.deepEqual(await ScTemplatePlacement.place(activity("circle"), { x: 1, y: 1 }, { scene: {} }), []);
});

test("a failed placement is announced, since the preview was already suppressed", (t) => {
  const warnings = [];
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
  t.after(() => { delete globalThis.ui; });

  ScTemplatePlacement.warnPlacementFailed({ name: "Fireball" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Fireball/);
});
