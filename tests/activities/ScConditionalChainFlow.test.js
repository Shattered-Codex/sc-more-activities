import test from "node:test";
import assert from "node:assert/strict";

import {
  FLOW_CONDITION_TYPES,
  FLOW_END,
  ScConditionalChainFlow
} from "../../scripts/activities/conditional-chain/ScConditionalChainFlow.js";

function makeNode(overrides = {}) {
  return ScConditionalChainFlow.normalizeNode({
    nodeId: "a",
    conditionType: FLOW_CONDITION_TYPES.ALWAYS,
    routes: { next: FLOW_END },
    ...overrides
  });
}

function makeFlow(overrides = {}) {
  return ScConditionalChainFlow.normalizeFlow({
    startNode: "a",
    nodes: [{ nodeId: "a", routes: { next: FLOW_END } }],
    ...overrides
  });
}

function codes(issues) {
  return issues.map((issue) => issue.code).sort();
}

test("normalizes a raw flow with defaults and trimming", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: " a ",
    maxDepth: "99",
    stopOnCancel: undefined,
    continueOnChildError: "yes-ish",
    nodes: [{
      nodeId: " a ",
      label: "  Step ",
      activityId: " act1 ",
      conditionType: "weird",
      condition: { operator: "", value: " 10 " },
      routes: { next: " b " },
      choices: [{ key: " k1 ", label: " Attack ", next: "" }]
    }]
  });

  assert.equal(flow.startNode, "a");
  assert.equal(flow.maxDepth, 20);
  assert.equal(flow.stopOnCancel, true);
  assert.equal(flow.continueOnChildError, false);

  const node = flow.nodes[0];
  assert.equal(node.nodeId, "a");
  assert.equal(node.label, "Step");
  assert.equal(node.activityId, "act1");
  assert.equal(node.conditionType, "always");
  assert.equal(node.condition.operator, "eq");
  assert.equal(node.condition.value, "10");
  assert.equal(node.routes.next, "b");
  assert.deepEqual(node.choices, [{ key: "k1", label: "Attack", next: "" }]);
});

test("normalizes missing flow data into an empty flow", () => {
  const flow = ScConditionalChainFlow.normalizeFlow(undefined);
  assert.equal(flow.startNode, "");
  assert.equal(flow.maxDepth, 5);
  assert.deepEqual(flow.nodes, []);
});

test("validates an empty flow", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({});
  assert.deepEqual(codes(ScConditionalChainFlow.validateFlow(flow, [])), ["no-nodes"]);
});

test("accepts a valid linear flow", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "a",
    nodes: [
      { nodeId: "a", activityId: "act1", routes: { next: "b" } },
      { nodeId: "b", activityId: "act2", routes: { next: FLOW_END } }
    ]
  });
  assert.deepEqual(ScConditionalChainFlow.validateFlow(flow, ["act1", "act2"]), []);
});

test("detects duplicated and empty node ids", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "a",
    nodes: [
      { nodeId: "a", routes: { next: FLOW_END } },
      { nodeId: "a", routes: { next: FLOW_END } },
      { nodeId: "", routes: { next: FLOW_END } }
    ]
  });
  const issues = codes(ScConditionalChainFlow.validateFlow(flow, []));
  assert.ok(issues.includes("duplicate-node-id"));
  assert.ok(issues.includes("empty-node-id"));
});

test("detects missing and unknown start node", () => {
  const missing = makeFlow({ startNode: "" });
  assert.ok(codes(ScConditionalChainFlow.validateFlow(missing, [])).includes("missing-start"));

  const unknown = makeFlow({ startNode: "ghost" });
  assert.ok(codes(ScConditionalChainFlow.validateFlow(unknown, [])).includes("unknown-start"));
});

test("detects references to missing activities", () => {
  const flow = makeFlow({
    nodes: [{ nodeId: "a", activityId: "deleted", routes: { next: FLOW_END } }]
  });
  const issues = ScConditionalChainFlow.validateFlow(flow, ["other"]);
  assert.deepEqual(codes(issues), ["unknown-activity"]);
  assert.equal(issues[0].ref, "deleted");
});

test("detects unset, unknown and self routes", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "a",
    nodes: [
      { nodeId: "a", routes: { next: "" } },
      { nodeId: "b", routes: { next: "ghost" } },
      { nodeId: "c", routes: { next: "c" } }
    ]
  });
  const issues = codes(ScConditionalChainFlow.validateFlow(flow, []));
  assert.ok(issues.includes("missing-route"));
  assert.ok(issues.includes("unknown-route"));
  assert.ok(issues.includes("self-route"));
});

test("validates only the routes relevant to the condition type", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "a",
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.ACTOR_PROPERTY,
      condition: { path: "system.attributes.hp.value", operator: "gt", value: "0" },
      routes: { next: "", onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  });
  assert.deepEqual(ScConditionalChainFlow.validateFlow(flow, []), []);
});

test("validates actor-property configuration", () => {
  const flow = makeFlow({
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.ACTOR_PROPERTY,
      condition: { path: "", operator: "eq" },
      routes: { onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  });
  assert.deepEqual(codes(ScConditionalChainFlow.validateFlow(flow, [])), ["missing-path"]);
});

test("normalizes and validates last-activity-result conditions", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "a",
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
      condition: { path: "damage.total", operator: "gte", value: "10" },
      routes: { next: "", onTrue: "b", onFalse: FLOW_END }
    }, {
      nodeId: "b",
      routes: { next: FLOW_END }
    }]
  });

  assert.equal(flow.nodes[0].conditionType, FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT);
  assert.deepEqual(ScConditionalChainFlow.validateFlow(flow, []), []);
});

test("validates last-activity-result configuration like actor-property conditions", () => {
  const missingPath = makeFlow({
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
      condition: { path: "", operator: "eq", value: "success" },
      routes: { onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  });
  assert.deepEqual(codes(ScConditionalChainFlow.validateFlow(missingPath, [])), ["missing-path"]);

  const invalidOperator = makeFlow({
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
      condition: { path: "damage.type", operator: "weird", value: "fire" },
      routes: { onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  });
  assert.deepEqual(codes(ScConditionalChainFlow.validateFlow(invalidOperator, [])), ["invalid-operator"]);
});

test("validates roll-check configuration", () => {
  const flow = makeFlow({
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.ROLL_CHECK,
      condition: { rollType: "custom", formula: "", dcFormula: "" },
      routes: { onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  });
  assert.deepEqual(codes(ScConditionalChainFlow.validateFlow(flow, [])), ["missing-dc", "missing-formula"]);
});

test("validates choice configuration", () => {
  const empty = makeFlow({
    nodes: [{ nodeId: "a", conditionType: FLOW_CONDITION_TYPES.CHOICE, choices: [] }]
  });
  assert.deepEqual(codes(ScConditionalChainFlow.validateFlow(empty, [])), ["missing-choices"]);

  const duplicated = makeFlow({
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.CHOICE,
      choices: [
        { key: "k1", label: "Attack", next: FLOW_END },
        { key: "k1", label: "Retreat", next: FLOW_END },
        { key: "", label: "Heal", next: FLOW_END }
      ]
    }]
  });
  const issues = codes(ScConditionalChainFlow.validateFlow(duplicated, []));
  assert.ok(issues.includes("duplicate-choice-key"));
  assert.ok(issues.includes("empty-choice-key"));
});

test("resolves the next node for always outcomes", () => {
  const node = makeNode({ routes: { next: "b" } });
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "always" }), "b");
});

test("resolves boolean outcomes to the true/false routes", () => {
  const node = makeNode({
    conditionType: FLOW_CONDITION_TYPES.ACTOR_PROPERTY,
    routes: { onTrue: "yes", onFalse: "no" }
  });
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "boolean", value: true }), "yes");
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "boolean", value: false }), "no");
});

test("resolves choice outcomes by option key", () => {
  const node = makeNode({
    conditionType: FLOW_CONDITION_TYPES.CHOICE,
    choices: [
      { key: "attack", label: "Attack", next: "b" },
      { key: "retreat", label: "Retreat", next: FLOW_END }
    ]
  });
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "choice", key: "attack" }), "b");
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "choice", key: "retreat" }), FLOW_END);
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "choice", key: "ghost" }), null);
});

test("normalizes and validates ordered last-value paths without changing binary conditions", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "decision",
    nodes: [{
      nodeId: "decision",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE,
      condition: { path: " roll.sum " },
      routes: { fallback: FLOW_END },
      valueBranches: [
        { key: " low ", operator: "lt", value: " 5 ", next: "low-step" },
        { key: " middle ", operator: "between", value: " 5..10 ", next: "middle-step" },
        { key: " high ", operator: "gt", value: " 10 ", next: "high-step" }
      ]
    },
    { nodeId: "low-step", routes: { next: FLOW_END } },
    { nodeId: "middle-step", routes: { next: FLOW_END } },
    { nodeId: "high-step", routes: { next: FLOW_END } }]
  });

  assert.equal(flow.nodes[0].condition.path, "roll.sum");
  assert.deepEqual(flow.nodes[0].valueBranches[1], {
    key: "middle", operator: "between", value: "5..10", next: "middle-step"
  });
  assert.deepEqual(ScConditionalChainFlow.validateFlow(flow, []), []);
});

test("validates last-value paths and resolves branch and fallback outcomes", () => {
  const node = makeNode({
    conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE,
    condition: { path: "value" },
    routes: { fallback: "fallback" },
    valueBranches: [{ key: "one", operator: "eq", value: "1", next: "first" }]
  });
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "value-branch", key: "one" }), "first");
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "value-fallback" }), "fallback");

  const invalid = makeFlow({
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE,
      condition: { path: "" },
      routes: { fallback: FLOW_END },
      valueBranches: []
    }]
  });
  assert.deepEqual(codes(ScConditionalChainFlow.validateFlow(invalid, [])), ["missing-path", "missing-value-branches"]);
});

test("rejects conflicting numeric value paths with a user-facing issue", () => {
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "a",
    nodes: [{
      nodeId: "a",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE,
      condition: { path: "roll.sum" },
      routes: { fallback: FLOW_END },
      valueBranches: [
        { key: "low", operator: "lte", value: "5", next: FLOW_END },
        { key: "high", operator: "gte", value: "4", next: FLOW_END }
      ]
    }]
  });
  const issues = ScConditionalChainFlow.validateFlow(flow, []);
  const conflict = issues.find((issue) => issue.code === "conflicting-value-branches");
  assert.ok(conflict);
  assert.match(conflict.ref, /#1 \(lte 5\).*#2 \(gte 4\)/);
});

test("returns null for unset routes and invalid outcomes", () => {
  const node = makeNode({ routes: { next: "" } });
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "always" }), null);
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "weird" }), null);
  assert.equal(ScConditionalChainFlow.resolveNextNode(null, { kind: "always" }), null);
});

test("builds a node map keyed by first occurrence of each id", () => {
  const nodes = [
    makeNode({ nodeId: "a", label: "first" }),
    makeNode({ nodeId: "a", label: "second" }),
    makeNode({ nodeId: "b" })
  ];
  const map = ScConditionalChainFlow.buildNodeMap(nodes);
  assert.equal(map.size, 2);
  assert.equal(map.get("a").label, "first");
});
