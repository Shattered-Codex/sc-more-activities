import test from "node:test";
import assert from "node:assert/strict";

import { MoreActivitiesMigrationConverter } from "../../scripts/migration/MoreActivitiesMigrationConverter.js";
import {
  FLOW_CONDITION_TYPES,
  FLOW_END,
  ScConditionalChainFlow
} from "../../scripts/activities/conditional-chain/ScConditionalChainFlow.js";

/**
 * Walks a normalized flow the same way ScConditionalChainActivityService does and
 * returns the activity ids that would actually run. `choices` answers each choice
 * step in order, by choice label.
 */
function runFlow(flow, choices = []) {
  const nodeMap = ScConditionalChainFlow.buildNodeMap(flow.nodes);
  const answers = [...choices];
  const executed = [];
  const visited = new Set();
  let currentId = flow.startNode;

  while (currentId && currentId !== FLOW_END) {
    const node = nodeMap.get(currentId);
    assert.ok(node, `flow routed to a missing step: ${currentId}`);
    assert.ok(!visited.has(currentId), `flow looped on ${currentId}`);
    visited.add(currentId);

    if (node.activityId) {
      executed.push(node.activityId);
    }

    let outcome = { kind: "always" };
    if (node.conditionType === FLOW_CONDITION_TYPES.CHOICE) {
      const label = answers.shift();
      const choice = node.choices.find((entry) => entry.label === label);
      assert.ok(choice, `no choice labelled "${label}" on ${currentId}`);
      outcome = { kind: "choice", key: choice.key };
    }

    const next = ScConditionalChainFlow.resolveNextNode(node, outcome);
    assert.ok(next, `step ${currentId} has no configured route`);
    currentId = next;
  }

  return executed;
}

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

test("warns that a linear chain now runs steps the legacy runtime never reached", () => {
  const result = MoreActivitiesMigrationConverter.convert(linearChain());

  assert.equal(result.lossy, true);
  assert.ok(result.warnings.some((warning) => warning.includes("only ever executed the first step")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.unexecutedLegacySteps, ["a2", "a3"]);
});

test("does not warn about extra steps on a single-step legacy chain", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain10",
    type: "chain",
    name: "Single Step",
    chainedActivityIds: ["a1"],
    chainTriggers: [[]],
    chainListeners: [[]]
  });

  assert.equal(result.lossy, false);
  assert.deepEqual([...result.warnings], []);
  assert.equal(result.convertedSource.chain.activityIds, "a1");
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

  // The legacy runtime stopped after the resumed step, so neither branch may
  // fall through into the other one.
  assert.equal(onHit.conditionType, FLOW_CONDITION_TYPES.ALWAYS);
  assert.equal(onHit.activityId, "a2");
  assert.equal(onHit.routes.next, FLOW_END);
  assert.equal(onMiss.routes.next, FLOW_END);
});

test("running a migrated branch executes only that branch", () => {
  const result = MoreActivitiesMigrationConverter.convert(branchingChain());
  const flow = ScConditionalChainFlow.normalizeFlow(result.convertedSource.flow);

  assert.deepEqual(runFlow(flow, ["Hit"]), ["a1", "a2"]);
  assert.deepEqual(runFlow(flow, ["Miss"]), ["a1", "a3"]);
});

test("running a migrated chain stops on a step that had no triggers", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain8",
    type: "chain",
    name: "Stops Early",
    chainedActivityIds: ["a1", "a2", "a3"],
    chainTriggers: [["Go"], [], []],
    chainListeners: [[], ["0:0"], ["0:0"]]
  });
  const flow = ScConditionalChainFlow.normalizeFlow(result.convertedSource.flow);

  assert.deepEqual(runFlow(flow, ["Go"]), ["a1", "a2"]);
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

test("never turns the last step into a choice the legacy runtime skipped", () => {
  // Legacy posted trigger buttons only while index < chainedActivityIds.length - 1,
  // so "Again" on the last step never appeared.
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain11",
    type: "chain",
    name: "Trailing Triggers",
    chainedActivityIds: ["a1", "a2"],
    chainTriggers: [["Go"], ["Again"]],
    chainListeners: [[], ["0:0"]]
  });

  const flow = ScConditionalChainFlow.normalizeFlow(result.convertedSource.flow);
  const last = flow.nodes[1];

  assert.equal(last.conditionType, FLOW_CONDITION_TYPES.ALWAYS);
  assert.deepEqual(last.choices, []);
  assert.equal(last.routes.next, FLOW_END);
  assert.ok(result.warnings.some((warning) => warning.includes("sit on the last step")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.ignoredLastStepTriggers, { "node-1": ["Again"] });

  // Running it asks exactly one question and stops after the last activity.
  assert.deepEqual(runFlow(flow, ["Go"]), ["a1", "a2"]);
  assert.deepEqual(ScConditionalChainFlow.validateFlow(flow, [
    { id: "a1", type: "attack" },
    { id: "a2", type: "damage" }
  ]), []);
});

test("keeps a chain whose only triggers sit on the last step on sc-chain", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain12",
    type: "chain",
    name: "Dead Triggers",
    chainedActivityIds: ["a1", "a2"],
    chainTriggers: [[], ["Again"]],
    chainListeners: [[], []]
  });

  assert.equal(result.targetType, "sc-chain");
  assert.equal(result.convertedSource.flow, undefined);
  assert.equal(result.convertedSource.chain.activityIds, "a1\na2");
  assert.ok(result.warnings.some((warning) => warning.includes("past the end of the chain")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.chainTriggers, [[], ["Again"]]);
});

test("reports legacy steps that no branch can reach", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain9",
    type: "chain",
    name: "Orphan Step",
    chainedActivityIds: ["a1", "a2", "a3"],
    chainTriggers: [["Go"], [], []],
    chainListeners: [[], ["0:0"], []]
  });

  assert.ok(result.warnings.some((warning) => warning.includes("cannot be reached")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.unreachableSteps, ["node-2"]);
});

test("blocks legacy chains that declare no chained activities", () => {
  // A chain with no activity has nothing to run and nothing to branch on,
  // whatever the trigger matrix says, so every shape of it is blocked.
  for (const [name, chainedActivityIds, chainTriggers] of [
    ["blank ids with a trigger", ["", ""], [["Go"], []]],
    ["no ids with a trigger", [], [["Go"]]],
    ["one blank id with a trigger", [""], [["Go"]]],
    ["no ids at all", [], []]
  ]) {
    const result = MoreActivitiesMigrationConverter.preview({
      _id: "chain6",
      type: "chain",
      name,
      chainedActivityIds,
      chainTriggers,
      chainListeners: []
    });

    assert.equal(result.convertible, false, name);
    assert.equal(result.reason, "empty-legacy-chain", name);
    assert.equal(result.targetType, "sc-chain", name);
  }
});

test("does not let a trigger on an empty step reach steps the legacy runtime could not", () => {
  // Legacy bailed out of executeChainedActivity(0) because "" resolves to no
  // activity, so "Go" was never offered and a2 was unreachable.
  const source = {
    _id: "chain13",
    type: "chain",
    name: "Empty First Step",
    chainedActivityIds: ["", "a2"],
    chainTriggers: [["Go"], []],
    chainListeners: [[], ["0:0"]]
  };

  const result = MoreActivitiesMigrationConverter.convert(source);

  // No effective trigger, so it stays a plain chain instead of becoming a
  // conditional chain that offers "Go".
  assert.equal(result.targetType, "sc-chain");
  assert.equal(result.convertedSource.flow, undefined);
  assert.ok(result.warnings.some((warning) => warning.includes("executed nothing at all")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.unexecutedLegacySteps, ["a2"]);
});

test("keeps an empty step with triggers out of the choice steps in a branching chain", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain14",
    type: "chain",
    name: "Empty Middle Step",
    chainedActivityIds: ["a1", "", "a3"],
    chainTriggers: [["Go"], ["Ghost"], []],
    chainListeners: [[], ["0:0"], ["1:0"]]
  });

  const flow = ScConditionalChainFlow.normalizeFlow(result.convertedSource.flow);
  const [, empty] = flow.nodes;

  assert.equal(empty.activityId, "");
  assert.equal(empty.conditionType, FLOW_CONDITION_TYPES.ALWAYS);
  assert.deepEqual(empty.choices, []);
  assert.equal(empty.routes.next, FLOW_END);

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.ignoredEmptyStepTriggers, { "node-1": ["Ghost"] });

  // "Go" still routes to the empty step, which stops there exactly like legacy.
  assert.deepEqual(runFlow(flow, ["Go"]), ["a1"]);
});

test("never routes a branch to a step the chain does not declare", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain15",
    type: "chain",
    name: "Listener Past The End",
    chainedActivityIds: ["a1", "a2"],
    chainTriggers: [["Go"], []],
    chainListeners: [[], [], ["0:0"]]
  });

  const flow = ScConditionalChainFlow.normalizeFlow(result.convertedSource.flow);

  assert.equal(flow.nodes.length, 2);
  assert.equal(flow.nodes[0].choices[0].next, FLOW_END);
  assert.ok(result.warnings.some((warning) => warning.includes("past the end of the chain")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.outOfRangeListeners, { "0:0": [2] });

  // The runtime accepts the flow instead of refusing it with unknown-route.
  assert.deepEqual(ScConditionalChainFlow.validateFlow(flow, [
    { id: "a1", type: "attack" },
    { id: "a2", type: "damage" }
  ]), []);
});

test("preserves legacy triggers stored past the end of a branching chain", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain16",
    type: "chain",
    name: "Trailing Trigger Row",
    chainedActivityIds: ["a1", "a2"],
    chainTriggers: [["Go"], [], ["Ghost"]],
    chainListeners: [[], ["0:0"]]
  });

  assert.equal(result.targetType, "sc-conditional-chain");
  assert.equal(result.convertedSource.flow.nodes.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes("past the end of the chain")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.trailingTriggers, { 2: ["Ghost"] });
});

test("never turns a repeated trigger label into a second reachable branch", () => {
  // continueChainFrom resolved a clicked button with sourceTriggers.indexOf(label),
  // so both "Go" buttons always resumed "0:0" and a3 was unreachable.
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain17",
    type: "chain",
    name: "Repeated Trigger",
    chainedActivityIds: ["a1", "a2", "a3"],
    chainTriggers: [["Go", "Go"], [], []],
    chainListeners: [[], ["0:0"], ["0:1"]]
  });

  const flow = ScConditionalChainFlow.normalizeFlow(result.convertedSource.flow);

  assert.deepEqual(flow.nodes[0].choices, [{ key: "0:0", label: "Go", next: "node-1" }]);
  assert.ok(result.warnings.some((warning) => warning.includes("is repeated on this step")));
  assert.ok(result.warnings.some((warning) => warning.includes("cannot be reached")));

  const migration = result.convertedSource.flags["sc-more-activities"].migration;
  assert.deepEqual(migration.unmapped.duplicateTriggers, { "0:1": { label: "Go", resolvedKey: "0:0" } });
  assert.deepEqual(migration.unmapped.unconsumedListeners, { 2: ["0:1"] });
  assert.deepEqual(migration.unmapped.unreachableSteps, ["node-2"]);

  // a3 stays out of reach exactly like it was in the legacy module.
  assert.deepEqual(runFlow(flow, ["Go"]), ["a1", "a2"]);
});

test("preserves listeners keyed to triggers no choice offers", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "chain18",
    type: "chain",
    name: "Orphan Branch Listeners",
    chainedActivityIds: ["a1", "", "a3", "a4"],
    // "Ghost" sits on a step with no activity id and "Again" on the last step,
    // so neither ever became a choice; "0:7" names a trigger that never existed.
    chainTriggers: [["Go"], ["Ghost"], [], ["Again"]],
    chainListeners: [[], ["0:0"], ["1:0", "0:7"], ["3:0"]]
  });

  const migration = result.convertedSource.flags["sc-more-activities"].migration;

  assert.deepEqual(migration.unmapped.unconsumedListeners, { 2: ["1:0", "0:7"], 3: ["3:0"] });
  assert.ok(result.warnings.some((warning) => warning.includes("never became a choice")));
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
