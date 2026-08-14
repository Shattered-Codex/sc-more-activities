import test from "node:test";
import assert from "node:assert/strict";

import { MoreActivitiesMigrationConverter } from "../../scripts/migration/MoreActivitiesMigrationConverter.js";
import {
  FLOW_CONDITION_TYPES,
  FLOW_END,
  ScConditionalChainFlow
} from "../../scripts/activities/conditional-chain/ScConditionalChainFlow.js";

function linearChain() {
  return {
    _id: "chain1",
    type: "chain",
    name: "Linear Chain",
    chainedActivityIds: ["a1", "a2", "a3"],
    chainedActivityNames: ["Step 1", "Step 2", "Step 3"],
    chainTriggers: [[], [], []],
    chainListeners: [[], [], []]
  };
}

function branchingChain() {
  // Step 0 runs, then offers "Hit" / "Miss". Step 1 listens to "0:0", step 2 to "0:1".
  return {
    _id: "chain2",
    type: "chain",
    name: "Branching Chain",
    chainedActivityIds: ["a1", "a2", "a3"],
    chainedActivityNames: ["Attack", "On hit", "On miss"],
    chainTriggers: [["Hit", "Miss"], [], []],
    chainListeners: [[], ["0:0"], ["0:1"]]
  };
}

test("keeps linear legacy chains on sc-chain", () => {
  const result = MoreActivitiesMigrationConverter.convert(linearChain());

  assert.equal(result.ok, true);
  assert.equal(result.targetType, "sc-chain");
  assert.equal(result.convertedSource.type, "sc-chain");
  assert.equal(result.convertedSource.chain.activityIds, "a1\na2\na3");
  assert.equal(result.convertedSource.flow, undefined);
});

test("preview reports sc-chain for linear legacy chains", () => {
  const preview = MoreActivitiesMigrationConverter.preview(linearChain());

  assert.equal(preview.convertible, true);
  assert.equal(preview.targetType, "sc-chain");
});

test("routes branching legacy chains to sc-conditional-chain", () => {
  const result = MoreActivitiesMigrationConverter.convert(branchingChain());

  assert.equal(result.ok, true);
  assert.equal(result.targetType, "sc-conditional-chain");
  assert.equal(result.convertedSource.type, "sc-conditional-chain");
  assert.equal(result.convertedSource.chain, undefined);

  const flow = result.convertedSource.flow;
  assert.equal(flow.startNode, "node-0");
  assert.equal(flow.nodes.length, 3);

  const [attack, onHit, onMiss] = flow.nodes;
  assert.equal(attack.activityId, "a1");
  assert.equal(attack.label, "Attack");
  assert.equal(attack.conditionType, FLOW_CONDITION_TYPES.CHOICE);
  assert.deepEqual(attack.choices, [
    { key: "0:0", label: "Hit", next: "node-1" },
    { key: "0:1", label: "Miss", next: "node-2" }
  ]);

  assert.equal(onHit.conditionType, FLOW_CONDITION_TYPES.ALWAYS);
  assert.equal(onHit.activityId, "a2");
  assert.equal(onHit.routes.next, "node-2");
  assert.equal(onMiss.routes.next, FLOW_END);
});

test("preview reports sc-conditional-chain for branching legacy chains", () => {
  const preview = MoreActivitiesMigrationConverter.preview(branchingChain());

  assert.equal(preview.convertible, true);
  assert.equal(preview.targetType, "sc-conditional-chain");
  assert.equal(preview.lossy, true);
});

test("keeps trigger indexes aligned when a chained id is blank", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain3",
    type: "chain",
    name: "Gapped Chain",
    chainedActivityIds: ["a1", "", "a3"],
    chainTriggers: [["Go"], [], []],
    chainListeners: [[], [], ["0:0"]]
  });

  const flow = result.convertedSource.flow;
  assert.equal(flow.nodes.length, 3);
  assert.equal(flow.nodes[1].activityId, "");
  assert.deepEqual(flow.nodes[0].choices, [{ key: "0:0", label: "Go", next: "node-2" }]);
  assert.equal(flow.nodes[2].activityId, "a3");
});

test("warns and keeps the first branch when a trigger resumed several steps", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain4",
    type: "chain",
    name: "Picker Chain",
    chainedActivityIds: ["a1", "a2", "a3"],
    chainTriggers: [["Pick"], [], []],
    chainListeners: [[], ["0:0"], ["0:0"]]
  });

  assert.equal(result.convertedSource.flow.nodes[0].choices[0].next, "node-1");
  assert.ok(result.warnings.some((warning) => warning.includes("branch picker")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.droppedBranches, { "0:0": ["node-2"] });
});

test("ends the flow when a trigger has no listening step", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain5",
    type: "chain",
    name: "Dangling Chain",
    chainedActivityIds: ["a1", "a2"],
    chainTriggers: [["Nowhere"], []],
    chainListeners: [[], []]
  });

  assert.equal(result.convertedSource.flow.nodes[0].choices[0].next, FLOW_END);
  assert.ok(result.warnings.some((warning) => warning.includes("no listening step")));
});

test("blocks branching chains that declare no chained activities", () => {
  const result = MoreActivitiesMigrationConverter.preview({
    _id: "chain6",
    type: "chain",
    name: "Empty Chain",
    chainedActivityIds: ["", ""],
    chainTriggers: [["Go"], []],
    chainListeners: [[], []]
  });

  assert.equal(result.convertible, false);
  assert.equal(result.reason, "empty-legacy-chain");
  assert.equal(result.targetType, "sc-conditional-chain");
});

test("produces a flow the conditional chain runtime accepts without issues", () => {
  const result = MoreActivitiesMigrationConverter.convert(branchingChain());
  const flow = ScConditionalChainFlow.normalizeFlow(result.convertedSource.flow);
  const issues = ScConditionalChainFlow.validateFlow(flow, [
    { id: "a1", type: "attack" },
    { id: "a2", type: "damage" },
    { id: "a3", type: "utility" }
  ]);

  assert.deepEqual(issues, []);
  assert.equal(flow.startNode, "node-0");
});

test("flags legacy listeners that can never fire on a linear chain", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain7",
    type: "chain",
    name: "Orphan Listeners",
    chainedActivityIds: ["a1", "a2"],
    chainTriggers: [[], []],
    chainListeners: [[], ["0:0"]]
  });

  assert.equal(result.targetType, "sc-chain");
  assert.ok(result.warnings.some((warning) => warning.includes("can never fire")));
});
