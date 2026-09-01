import test from "node:test";
import assert from "node:assert/strict";

const { ScTemplateOrigin } = await import("../../scripts/activities/conditional-chain/ScTemplateOrigin.js");

function results(entries) {
  return new Map(Object.entries(entries));
}

test("no chosen step means the system places the template as usual", () => {
  for (const config of [undefined, {}, { stepId: "" }, { stepId: "   " }]) {
    assert.equal(ScTemplateOrigin.isOverridden(config), false);
    assert.equal(ScTemplateOrigin.resolvePoint(config, results({})), null);
  }
});

test("the mode follows the chosen step, so the two cannot disagree", () => {
  assert.deepEqual(ScTemplateOrigin.normalize({ stepId: "n1" }), { mode: "step", stepId: "n1" });
  assert.deepEqual(ScTemplateOrigin.normalize({ stepId: "" }), { mode: "default", stepId: "" });
  // A stored mode is ignored: only the step id decides.
  assert.deepEqual(ScTemplateOrigin.normalize({ mode: "step", stepId: "" }), { mode: "default", stepId: "" });
});

test("a chosen step resolves to that step's destination", () => {
  const point = ScTemplateOrigin.resolvePoint({ stepId: "teleport" }, results({
    teleport: { activity: { destination: { x: 1450, y: 900 } } }
  }));

  assert.deepEqual(point, { x: 1450, y: 900 });
});

test("any earlier step can be referenced, not only the previous one", () => {
  const history = results({
    first: { activity: { destination: { x: 100, y: 200 } } },
    second: { activity: { movedCount: 1 } },
    third: { activity: { destination: { x: 700, y: 800 } } }
  });

  assert.deepEqual(ScTemplateOrigin.resolvePoint({ stepId: "first" }, history), { x: 100, y: 200 });
  assert.deepEqual(ScTemplateOrigin.resolvePoint({ stepId: "third" }, history), { x: 700, y: 800 });
});

test("a step that produced no point falls back to the usual placement", () => {
  const history = results({
    damage: { activity: { movedCount: 0 } },
    canceled: { canceled: true, activity: { canceled: true } }
  });

  assert.equal(ScTemplateOrigin.resolvePoint({ stepId: "damage" }, history), null);
  assert.equal(ScTemplateOrigin.resolvePoint({ stepId: "canceled" }, history), null);
  assert.equal(ScTemplateOrigin.resolvePoint({ stepId: "never-ran" }, history), null);
});

test("a malformed destination is not treated as a point", () => {
  for (const destination of [null, {}, { x: 1 }, { x: "a", y: 2 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }]) {
    assert.equal(
      ScTemplateOrigin.resolvePoint({ stepId: "s" }, results({ s: { activity: { destination } } })),
      null,
      `${JSON.stringify(destination)} must not resolve`
    );
  }
  // Zero is a real coordinate and must survive.
  assert.deepEqual(
    ScTemplateOrigin.resolvePoint({ stepId: "s" }, results({ s: { activity: { destination: { x: 0, y: 0 } } } })),
    { x: 0, y: 0 }
  );
});

test("resolving copes with no history at all", () => {
  assert.equal(ScTemplateOrigin.resolvePoint({ stepId: "s" }, undefined), null);
  assert.equal(ScTemplateOrigin.resolvePoint({ stepId: "s" }, null), null);
});

test("the picker offers every other step, labelled, and never the step itself", () => {
  const nodes = [
    { nodeId: "n1", label: "Teleport" },
    { nodeId: "n2", label: "" },
    { nodeId: "n3", label: "Damage" },
    { nodeId: "", label: "unsaved" }
  ];

  assert.deepEqual(ScTemplateOrigin.stepOptions(nodes, "n3"), [
    { value: "n1", label: "Teleport" },
    { value: "n2", label: "n2" }
  ]);
  assert.deepEqual(ScTemplateOrigin.stepOptions([], "n1"), []);
});

test("only steps whose activity supplies a point are offered", () => {
  const nodes = [
    { nodeId: "n1", label: "Teleport", activityId: "a1" },
    { nodeId: "n2", label: "Damage", activityId: "a2" },
    { nodeId: "n3", label: "Save", activityId: "a3" }
  ];
  const index = new Map([
    ["a1", { id: "a1", type: "sc-teleport" }],
    ["a2", { id: "a2", type: "damage" }],
    ["a3", { id: "a3", type: "save" }]
  ]);

  assert.deepEqual(ScTemplateOrigin.stepOptions(nodes, "n3", index), [
    { value: "n1", label: "Teleport" }
  ]);
});

test("without an index every other step is offered, as before", () => {
  const nodes = [{ nodeId: "n1", label: "A" }, { nodeId: "n2", label: "B" }];
  assert.equal(ScTemplateOrigin.stepOptions(nodes, "n2").length, 1);
});

test("the provider list is what decides, and it is one place to extend", () => {
  assert.equal(ScTemplateOrigin.provides("sc-teleport"), true);
  assert.equal(ScTemplateOrigin.provides("sc-movement"), false);
  assert.equal(ScTemplateOrigin.provides("damage"), false);
  assert.equal(ScTemplateOrigin.provides(null), false);
  assert.deepEqual(ScTemplateOrigin.PROVIDER_TYPES, ["sc-teleport"]);
});

test("only steps declared before this one are offered", () => {
  const nodes = [
    { nodeId: "n1", label: "Teleport A", activityId: "a1" },
    { nodeId: "n2", label: "Save", activityId: "a2" },
    { nodeId: "n3", label: "Teleport B", activityId: "a3" }
  ];
  const index = new Map([
    ["a1", { type: "sc-teleport" }],
    ["a2", { type: "save" }],
    ["a3", { type: "sc-teleport" }]
  ]);

  // A later teleport cannot have run yet, so offering it would only ever
  // fall back to the interactive placement.
  assert.deepEqual(ScTemplateOrigin.stepOptions(nodes, "n2", index), [
    { value: "n1", label: "Teleport A" }
  ]);
  // The last step can reach both earlier ones.
  assert.deepEqual(ScTemplateOrigin.stepOptions(nodes, "n3", index).map((o) => o.value), ["n1"]);
  // The first step has nothing before it.
  assert.deepEqual(ScTemplateOrigin.stepOptions(nodes, "n1", index), []);
});

test("an unknown current step falls back to offering every provider", () => {
  const nodes = [{ nodeId: "n1", label: "Teleport", activityId: "a1" }];
  const index = new Map([["a1", { type: "sc-teleport" }]]);

  assert.deepEqual(ScTemplateOrigin.stepOptions(nodes, "missing", index).map((o) => o.value), ["n1"]);
});
