import test from "node:test";
import assert from "node:assert/strict";

import { ScChainExecutionContext } from "../../scripts/activities/chain/ScChainExecutionContext.js";

function fakeActivity(uuid) {
  return { uuid };
}

test("starts a fresh context at depth zero with the current activity in the path", () => {
  const context = ScChainExecutionContext.fromUsage({}, fakeActivity("Item.a.Activity.chain"), 5);
  assert.equal(context.depth, 0);
  assert.equal(context.maxDepth, 5);
  assert.equal(context.root, "Item.a.Activity.chain");
  assert.deepEqual(context.path, ["Item.a.Activity.chain"]);
  assert.equal(ScChainExecutionContext.isDepthExceeded(context), false);
});

test("clamps configured depth into the supported range", () => {
  assert.equal(ScChainExecutionContext.clampDepth(undefined), 5);
  assert.equal(ScChainExecutionContext.clampDepth("nope"), 5);
  assert.equal(ScChainExecutionContext.clampDepth(0), 1);
  assert.equal(ScChainExecutionContext.clampDepth(99), 20);
  assert.equal(ScChainExecutionContext.clampDepth(3.9), 3);
});

test("builds child usage that carries depth, root and path forward", () => {
  const parent = ScChainExecutionContext.fromUsage({}, fakeActivity("A"), 2);
  const usage = ScChainExecutionContext.childUsage({ some: "flag" }, parent, "B");

  assert.equal(usage.some, "flag");
  const payload = usage[ScChainExecutionContext.USAGE_KEY];
  assert.deepEqual(payload, { root: "A", depth: 1, maxDepth: 2, path: ["A", "B"] });
});

test("shares depth protection across chained executions (sc-chain <-> sc-conditional-chain)", () => {
  const first = ScChainExecutionContext.fromUsage({}, fakeActivity("A"), 2);
  const usageForB = ScChainExecutionContext.childUsage({}, first, "B");

  const second = ScChainExecutionContext.fromUsage(usageForB, fakeActivity("B"));
  assert.equal(second.depth, 1);
  assert.equal(second.maxDepth, 2);
  assert.equal(ScChainExecutionContext.isDepthExceeded(second), false);

  const usageForC = ScChainExecutionContext.childUsage({}, second, "C");
  const third = ScChainExecutionContext.fromUsage(usageForC, fakeActivity("C"));
  assert.equal(third.depth, 2);
  assert.equal(ScChainExecutionContext.isDepthExceeded(third), true);
});

test("detects loops through the shared path regardless of which chain type visits first", () => {
  const first = ScChainExecutionContext.fromUsage({}, fakeActivity("A"), 5);
  const usageForB = ScChainExecutionContext.childUsage({}, first, "B");
  const second = ScChainExecutionContext.fromUsage(usageForB, fakeActivity("B"));

  assert.equal(ScChainExecutionContext.hasVisited(second, "A"), true);
  assert.equal(ScChainExecutionContext.hasVisited(second, "B"), true);
  assert.equal(ScChainExecutionContext.hasVisited(second, "C"), false);
});

test("a configured max depth on the child overrides the inherited limit", () => {
  const first = ScChainExecutionContext.fromUsage({}, fakeActivity("A"), 5);
  const usageForB = ScChainExecutionContext.childUsage({}, first, "B");
  const second = ScChainExecutionContext.fromUsage(usageForB, fakeActivity("B"), 1);
  assert.equal(second.maxDepth, 1);
  assert.equal(ScChainExecutionContext.isDepthExceeded(second), true);
});
