import test from "node:test";
import assert from "node:assert/strict";

const hooks = [];
globalThis.Hooks = { on: (name, handler) => hooks.push([name, handler]) };
globalThis.game = { modules: new Map(), settings: { get: () => false } };

const { ScAutomatedAnimationsIntegration } = await import(
  "../../scripts/integrations/autoanimations/ScAutomatedAnimationsIntegration.js"
);

const teleportPreset = { menu: "preset", presetType: "teleportation" };

test("stops Automated Animations' interactive teleport for activities that move the token", () => {
  for (const type of ["sc-teleport", "sc-movement", "sc-recall", "sc-portal"]) {
    const data = { activity: { type } };
    ScAutomatedAnimationsIntegration.onWorkflowStart(data, teleportPreset);
    assert.equal(data.stopWorkflow, true, type);
  }
});

test("leaves its other animations, and other activities, alone", () => {
  const cases = [
    [{ activity: { type: "sc-teleport" } }, { menu: "ontoken" }],
    [{ activity: { type: "sc-teleport" } }, { menu: "preset", presetType: "proToTemp" }],
    [{ activity: { type: "sc-grant" } }, teleportPreset],
    [{ activity: { type: "spell" } }, teleportPreset],
    [{}, teleportPreset]
  ];
  for (const [data, animationData] of cases) {
    ScAutomatedAnimationsIntegration.onWorkflowStart(data, animationData);
    assert.equal(data.stopWorkflow, undefined);
  }
});

test("only listens while Automated Animations is active", () => {
  assert.equal(ScAutomatedAnimationsIntegration.register(), false);
  assert.equal(hooks.length, 0);

  game.modules = new Map([["autoanimations", { active: true }]]);
  assert.equal(ScAutomatedAnimationsIntegration.register(), true);
  assert.equal(ScAutomatedAnimationsIntegration.register(), false);
  assert.deepEqual(hooks.map(([name]) => name), ["AutomatedAnimations-WorkflowStart"]);

  const data = { activity: { type: "sc-teleport" } };
  hooks[0][1](data, teleportPreset);
  assert.equal(data.stopWorkflow, true);
});
