import test from "node:test";
import assert from "node:assert/strict";

/**
 * dnd5e finalizes a tracked usage from its `postUseActivity` hook, which fires
 * while `super.use()` resolves. A canvas activity must therefore declare that
 * it finishes later *before* calling `super.use()` — declaring it afterwards
 * finds a record that is already closed, and the chain runs the next step while
 * the placement window is still on screen.
 */
const hooks = {};
globalThis.Hooks = {
  on(name, fn) { (hooks[name] ??= []).push(fn); },
  callAll(name, ...args) { (hooks[name] ?? []).forEach((fn) => fn(...args)); }
};
globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } };
globalThis.foundry = {
  utils: {
    randomID: () => Math.random().toString(36).slice(2),
    mergeObject: (a, b) => ({ ...a, ...b }),
    deepClone: structuredClone
  }
};

const base = "../../scripts/activities/";
const { ScActivityResultTracker } = await import(base + "ScActivityResultTracker.js");
const { ScCanvasUsageSettlement } = await import(base + "canvas/ScCanvasUsageSettlement.js");
ScActivityResultTracker.registerHooks();

const activity = {
  id: "a1",
  type: "sc-teleport",
  name: "Teleport",
  uuid: "Activity.a1",
  item: { id: "i1", uuid: "Item.i1", actor: { uuid: "Actor.x" } }
};

/** `superUse` stands in for dnd5e's own use(), hook and all. */
function runUse({ declareBeforeSuperUse }) {
  const usage = ScActivityResultTracker.withTrackedUsage({}, activity);
  let settlement = null;

  if (declareBeforeSuperUse) {
    settlement = ScCanvasUsageSettlement.begin(usage);
  }
  Hooks.callAll("dnd5e.postUseActivity", activity, usage, { message: { id: "m1" } });
  if (!declareBeforeSuperUse) {
    settlement = ScCanvasUsageSettlement.begin(usage);
  }

  return { usage, settlement };
}

test("declaring after super.use() cannot hold the usage open", () => {
  const { settlement } = runUse({ declareBeforeSuperUse: false });

  // This is the shape of the bug: no settlement, so nothing delays the chain.
  assert.equal(settlement, null);
});

test("declaring before super.use() holds the usage open", () => {
  const { settlement } = runUse({ declareBeforeSuperUse: true });

  assert.ok(settlement);
  assert.equal(settlement.settled, false);
});

test("a chain waits for the window and then sees the cancellation", async() => {
  const { usage, settlement } = runUse({ declareBeforeSuperUse: true });

  let resolved = false;
  const waiting = ScActivityResultTracker
    .resolveUsageResult(activity, usage, { message: { id: "m1" } })
    .then((snapshot) => {
      resolved = true;
      return snapshot;
    });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(resolved, false, "the next step must not run while the window is open");

  settlement.cancel("teleport-canceled");
  const snapshot = await waiting;
  assert.equal(snapshot.canceled, true);
  assert.equal(snapshot.activity.reason, "teleport-canceled");
});

test("a completed placement resumes the chain with its result", async() => {
  const { usage, settlement } = runUse({ declareBeforeSuperUse: true });

  const waiting = ScActivityResultTracker.resolveUsageResult(activity, usage, { message: { id: "m1" } });
  settlement.complete({ canceled: false, activity: { canceled: false, movedCount: 2 } });

  const snapshot = await waiting;
  assert.equal(snapshot.canceled, false);
  assert.equal(snapshot.activity.movedCount, 2);
});
