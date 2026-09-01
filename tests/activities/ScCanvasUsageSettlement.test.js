import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasUsageSettlement } = await import("../../scripts/activities/canvas/ScCanvasUsageSettlement.js");
const { ScActivityResultTracker } = await import("../../scripts/activities/ScActivityResultTracker.js");

/**
 * Records what the settlement reported to the tracker, and whether the usage
 * was tracked at all, so the two paths a chain cares about can be told apart.
 */
function spyTracker(t, { tracked = true } = {}) {
  const calls = [];
  const original = {
    awaitAsyncResult: ScActivityResultTracker.awaitAsyncResult,
    completeAsyncResult: ScActivityResultTracker.completeAsyncResult,
    cancelUsage: ScActivityResultTracker.cancelUsage
  };

  ScActivityResultTracker.awaitAsyncResult = () => tracked;
  ScActivityResultTracker.completeAsyncResult = (usage, partial) => calls.push(["complete", partial]);
  ScActivityResultTracker.cancelUsage = (usage, reason) => calls.push(["cancel", reason]);

  t.after(() => Object.assign(ScActivityResultTracker, original));
  return calls;
}

test("an untracked usage produces no settlement, so a direct click is untouched", (t) => {
  spyTracker(t, { tracked: false });
  assert.equal(ScCanvasUsageSettlement.begin({}), null);
});

test("a tracked usage produces a settlement that starts unsettled", (t) => {
  spyTracker(t);
  const settlement = ScCanvasUsageSettlement.begin({});

  assert.ok(settlement);
  assert.equal(settlement.settled, false);
});

test("completing reports the result once", (t) => {
  const calls = spyTracker(t);
  const settlement = ScCanvasUsageSettlement.begin({});

  assert.equal(settlement.complete({ canceled: false }), true);
  assert.equal(settlement.settled, true);
  assert.deepEqual(calls, [["complete", { canceled: false }]]);

  // A second call must not report a second result.
  assert.equal(settlement.complete({ canceled: false }), false);
  assert.equal(calls.length, 1);
});

test("cancelling reports a cancellation once", (t) => {
  const calls = spyTracker(t);
  const settlement = ScCanvasUsageSettlement.begin({});

  assert.equal(settlement.cancel("teleport-canceled"), true);
  assert.deepEqual(calls, [["cancel", "teleport-canceled"]]);
  assert.equal(settlement.cancel("again"), false);
  assert.equal(calls.length, 1);
});

test("a completed settlement can no longer be cancelled", (t) => {
  const calls = spyTracker(t);
  const settlement = ScCanvasUsageSettlement.begin({});

  settlement.complete({ canceled: false });
  // This is the real ordering: the window completes, then closes.
  assert.equal(settlement.cancelIfPending(), false);
  assert.deepEqual(calls.map(([kind]) => kind), ["complete"]);
});

test("a transfer moves responsibility to the next window", (t) => {
  const calls = spyTracker(t);
  const first = ScCanvasUsageSettlement.begin({});
  const second = first.transfer();

  assert.ok(second);
  assert.equal(first.settled, true, "the handing-off window is done with it");
  assert.equal(second.settled, false);

  // The first window closing after the hand-off must not cancel the flow.
  assert.equal(first.cancelIfPending(), false);
  assert.deepEqual(calls, []);

  // The second window is the one that settles it.
  second.complete({ canceled: false });
  assert.deepEqual(calls, [["complete", { canceled: false }]]);
});

test("closing the second window without resolving cancels the flow", (t) => {
  const calls = spyTracker(t);
  const first = ScCanvasUsageSettlement.begin({});
  const second = first.transfer();

  first.cancelIfPending("teleport-canceled");
  second.cancelIfPending("teleport-canceled");

  assert.deepEqual(calls, [["cancel", "teleport-canceled"]], "exactly one cancellation");
});

test("a settled settlement cannot be transferred", (t) => {
  spyTracker(t);
  const settlement = ScCanvasUsageSettlement.begin({});

  settlement.cancel();
  assert.equal(settlement.transfer(), null);
});
