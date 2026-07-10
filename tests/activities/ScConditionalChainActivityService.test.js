import test from "node:test";
import assert from "node:assert/strict";

globalThis.ui = {
  notifications: {
    warn() {},
    error() {},
    info() {}
  }
};

globalThis.dnd5e = {
  utils: {
    simplifyBonus(formula, data) {
      const key = String(formula).trim().replace(/^@/, "");
      const value = key.split(".").reduce((current, part) => current?.[part], data);
      return Number(value);
    }
  }
};

const { ScActivityResultTracker } = await import("../../scripts/activities/ScActivityResultTracker.js");
const {
  FLOW_CONDITION_TYPES,
  FLOW_END,
  ScConditionalChainFlow
} = await import("../../scripts/activities/conditional-chain/ScConditionalChainFlow.js");
const {
  ScConditionalChainActivityService
} = await import("../../scripts/activities/conditional-chain/ScConditionalChainActivityService.js");

function makeChildActivity({ id, type = "utility", onUse }) {
  const activity = {
    id,
    name: id,
    type,
    uuid: `Item.item-1.Activity.${id}`,
    item: null,
    actor: null,
    async use(usage, dialog, message) {
      return onUse(usage, dialog, message);
    }
  };
  return activity;
}

function makeRootActivity(flow, activities) {
  const item = {
    id: "item-1",
    uuid: "Item.item-1",
    system: {
      activities
    }
  };
  const actor = { uuid: "Actor.actor-1" };
  const root = {
    id: "conditional-chain",
    name: "conditional-chain",
    type: "sc-conditional-chain",
    uuid: "Item.item-1.Activity.conditional-chain",
    item,
    actor,
    flow
  };

  for (const activity of activities.values()) {
    activity.item = item;
    activity.actor = actor;
  }

  return root;
}

function makeUseResults(id) {
  return {
    message: { id: `message-${id}` },
    updates: [],
    effects: [],
    templates: []
  };
}

test("routes to the true branch from a child activity last result", async() => {
  const calls = [];
  const attack = makeChildActivity({
    id: "attack",
    type: "attack",
    onUse(usage) {
      ScActivityResultTracker.recordActivityResult(usage, {
        kind: "attack",
        success: true,
        attack: { hit: true, miss: false }
      });
      calls.push("attack");
      return makeUseResults("attack");
    }
  });
  const onHit = makeChildActivity({
    id: "grant-hit",
    type: "sc-grant",
    onUse() {
      calls.push("grant-hit");
      return makeUseResults("grant-hit");
    }
  });
  const onMiss = makeChildActivity({
    id: "grant-miss",
    type: "sc-grant",
    onUse() {
      calls.push("grant-miss");
      return makeUseResults("grant-miss");
    }
  });

  const activities = new Map([
    ["attack", attack],
    ["grant-hit", onHit],
    ["grant-miss", onMiss]
  ]);
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "attack-step",
    nodes: [
      {
        nodeId: "attack-step",
        activityId: "attack",
        conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
        condition: { path: "attack.hit", operator: "eq", value: "true" },
        routes: { onTrue: "on-hit", onFalse: "on-miss" }
      },
      {
        nodeId: "on-hit",
        activityId: "grant-hit",
        conditionType: FLOW_CONDITION_TYPES.ALWAYS,
        routes: { next: FLOW_END }
      },
      {
        nodeId: "on-miss",
        activityId: "grant-miss",
        conditionType: FLOW_CONDITION_TYPES.ALWAYS,
        routes: { next: FLOW_END }
      }
    ]
  });

  await ScConditionalChainActivityService.execute(makeRootActivity(flow, activities), {
    usage: {},
    dialog: {},
    message: {}
  });

  assert.deepEqual(calls, ["attack", "grant-hit"]);
});

test("resolves @scLast references in the expected value field", async() => {
  const calls = [];
  const damage = makeChildActivity({
    id: "damage",
    type: "damage",
    onUse(usage) {
      ScActivityResultTracker.recordActivityResult(usage, {
        kind: "damage",
        roll: { sum: 14 }
      });
      calls.push("damage");
      return makeUseResults("damage");
    }
  });
  const heal = makeChildActivity({
    id: "heal",
    type: "heal",
    onUse() {
      calls.push("heal");
      return makeUseResults("heal");
    }
  });
  const skip = makeChildActivity({
    id: "skip",
    type: "utility",
    onUse() {
      calls.push("skip");
      return makeUseResults("skip");
    }
  });

  const activities = new Map([
    ["damage", damage],
    ["heal", heal],
    ["skip", skip]
  ]);
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "damage-step",
    nodes: [
      {
        nodeId: "damage-step",
        activityId: "damage",
        conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
        condition: { path: "roll.sum", operator: "gte", value: "@scLast.roll.sum" },
        routes: { onTrue: "heal-step", onFalse: "skip-step" }
      },
      {
        nodeId: "heal-step",
        activityId: "heal",
        conditionType: FLOW_CONDITION_TYPES.ALWAYS,
        routes: { next: FLOW_END }
      },
      {
        nodeId: "skip-step",
        activityId: "skip",
        conditionType: FLOW_CONDITION_TYPES.ALWAYS,
        routes: { next: FLOW_END }
      }
    ]
  });

  await ScConditionalChainActivityService.execute(makeRootActivity(flow, activities), {
    usage: {},
    dialog: {},
    message: {}
  });

  assert.deepEqual(calls, ["damage", "heal"]);
});

test("can evaluate an inherited last result before the first node executes a child activity", async() => {
  const calls = [];
  const onHit = makeChildActivity({
    id: "grant-hit",
    type: "sc-grant",
    onUse() {
      calls.push("grant-hit");
      return makeUseResults("grant-hit");
    }
  });
  const onMiss = makeChildActivity({
    id: "grant-miss",
    type: "sc-grant",
    onUse() {
      calls.push("grant-miss");
      return makeUseResults("grant-miss");
    }
  });

  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "decision",
    nodes: [
      {
        nodeId: "decision",
        conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
        condition: { path: "attack.hit", operator: "eq", value: "true" },
        routes: { onTrue: "on-hit", onFalse: "on-miss" }
      },
      {
        nodeId: "on-hit",
        activityId: "grant-hit",
        conditionType: FLOW_CONDITION_TYPES.ALWAYS,
        routes: { next: FLOW_END }
      },
      {
        nodeId: "on-miss",
        activityId: "grant-miss",
        conditionType: FLOW_CONDITION_TYPES.ALWAYS,
        routes: { next: FLOW_END }
      }
    ]
  });

  const activities = new Map([
    ["grant-hit", onHit],
    ["grant-miss", onMiss]
  ]);

  await ScConditionalChainActivityService.execute(makeRootActivity(flow, activities), {
    usage: ScActivityResultTracker.withLastResult({}, {
      kind: "attack",
      success: true,
      attack: { hit: true, miss: false }
    }),
    dialog: {},
    message: {}
  });

  assert.deepEqual(calls, ["grant-hit"]);
});

for (const [total, expected] of [[4, "low"], [5, "middle"], [10, "middle"], [11, "high"]]) {
  test(`routes roll total ${total} through the matching ordered value path`, async() => {
    const calls = [];
    const activities = new Map(["low", "middle", "high"].map((id) => [id, makeChildActivity({
      id,
      onUse() {
        calls.push(id);
        return makeUseResults(id);
      }
    })]));
    const flow = ScConditionalChainFlow.normalizeFlow({
      startNode: "decision",
      nodes: [{
        nodeId: "decision",
        conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE,
        condition: { path: "roll.sum" },
        routes: { fallback: FLOW_END },
        valueBranches: [
          { key: "low", operator: "lt", value: "5", next: "low-step" },
          { key: "middle", operator: "between", value: "5..10", next: "middle-step" },
          { key: "high", operator: "gt", value: "10", next: "high-step" }
        ]
      }, ...["low", "middle", "high"].map((id) => ({
        nodeId: `${id}-step`, activityId: id, routes: { next: FLOW_END }
      }))]
    });

    await ScConditionalChainActivityService.execute(makeRootActivity(flow, activities), {
      usage: ScActivityResultTracker.withLastResult({}, { kind: "damage", roll: { sum: total } })
    });
    assert.deepEqual(calls, [expected]);
  });
}

test("uses the first matching value path and falls back when none match", async() => {
  const node = ScConditionalChainFlow.normalizeNode({
    nodeId: "decision",
    conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE,
    condition: { path: "value" },
    routes: { fallback: "fallback" },
    valueBranches: [
      { key: "first", operator: "lte", value: "10", next: "a" },
      { key: "second", operator: "gte", value: "5", next: "b" }
    ]
  });
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "value-branch", key: "first" }), "a");
  assert.equal(ScConditionalChainFlow.resolveNextNode(node, { kind: "value-fallback" }), "fallback");
});

test("suppresses child usage cards when the flow policy is enabled", async() => {
  let receivedMessage;
  const child = makeChildActivity({
    id: "child",
    onUse(_usage, _dialog, message) {
      receivedMessage = message;
      return makeUseResults("child");
    }
  });
  const activities = new Map([["child", child]]);
  const flow = ScConditionalChainFlow.normalizeFlow({
    startNode: "child-step",
    suppressChildMessages: true,
    nodes: [{
      nodeId: "child-step",
      activityId: "child",
      conditionType: FLOW_CONDITION_TYPES.ALWAYS,
      routes: { next: FLOW_END }
    }]
  });

  await ScConditionalChainActivityService.execute(makeRootActivity(flow, activities), {
    usage: {},
    dialog: {},
    message: { data: { flavor: "parent" } }
  });

  assert.equal(receivedMessage.create, false);
  assert.deepEqual(receivedMessage.data, { flavor: "parent" });
});
