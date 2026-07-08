import test from "node:test";
import assert from "node:assert/strict";

function mergeObject(target, source, { inplace = true } = {}) {
  const output = inplace ? target : structuredClone(target ?? {});
  for (const [key, value] of Object.entries(source ?? {})) {
    const current = output[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      output[key] = mergeObject(current, value, { inplace: false });
    } else {
      output[key] = value;
    }
  }
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class BaseActivitySheet {
  static PARTS = {
    effect: {
      templates: []
    }
  };

  constructor(activity) {
    this.activity = activity;
  }

  async _prepareEffectContext(context) {
    return context;
  }
}

globalThis.game = {
  i18n: {
    lang: "en",
    localize(key) {
      return key;
    },
    format(key) {
      return key;
    }
  }
};

globalThis.CONFIG = {
  DND5E: {
    abilities: {
      str: { label: "Strength" }
    },
    skills: {
      ath: { label: "Athletics" }
    }
  }
};

globalThis.foundry = {
  utils: {
    mergeObject,
    randomID(length = 16) {
      return "x".repeat(length);
    }
  }
};

globalThis.dnd5e = {
  applications: {
    activity: {
      ActivitySheet: BaseActivitySheet
    }
  }
};

const {
  FLOW_CONDITION_TYPES,
  FLOW_END,
  ScConditionalChainFlow
} = await import("../../scripts/activities/conditional-chain/ScConditionalChainFlow.js");
const {
  ScConditionalChainActivitySheet
} = await import("../../scripts/activities/conditional-chain/ScConditionalChainActivitySheet.js");

function makeActivity({ id, name, type }) {
  return { id, name, type };
}

function makeSheet(flow) {
  const activities = new Map([
    ["conditional-chain", makeActivity({ id: "conditional-chain", name: "Conditional Chain", type: "sc-conditional-chain" })],
    ["attack", makeActivity({ id: "attack", name: "Attack", type: "attack" })],
    ["contest", makeActivity({ id: "contest", name: "Contest", type: "sc-contest" })],
    ["grant", makeActivity({ id: "grant", name: "Grant", type: "sc-grant" })]
  ]);
  const activity = {
    id: "conditional-chain",
    flow,
    item: {
      system: {
        activities
      }
    }
  };
  return new ScConditionalChainActivitySheet(activity);
}

function suggestionValues(groups = []) {
  return groups.flatMap((group) => group.paths.map((entry) => entry.value));
}

async function prepareNode(flow) {
  const sheet = makeSheet(flow);
  const context = await sheet._prepareEffectContext({}, {});
  return context.nodes[0];
}

test("filters last-result path suggestions by the selected activity id when possible", async() => {
  const node = await prepareNode(ScConditionalChainFlow.normalizeFlow({
    startNode: "decision",
    nodes: [{
      nodeId: "decision",
      activityId: "attack",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
      condition: { path: "attack.hit", operator: "eq", value: "true" },
      routes: { onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  }));

  const suggestions = suggestionValues(node.pathSuggestionGroups);
  assert.ok(Array.isArray(node.pathSuggestionGroups));
  assert.ok(suggestions.includes("sourceActivity.type"));
  assert.ok(suggestions.includes("roll.total"));
  assert.ok(suggestions.includes("roll.sum"));
  assert.ok(suggestions.includes("roll.dice.max"));
  assert.ok(suggestions.includes("attack.hit"));
  assert.ok(!suggestions.includes("contest.winner"));
  assert.equal(node.pathIsCustom, false);
  const selected = node.pathSuggestionGroups
    .flatMap((group) => group.paths)
    .filter((entry) => entry.selected)
    .map((entry) => entry.value);
  assert.deepEqual(selected, ["attack.hit"]);
});

test("falls back to combined last-result suggestions when the node cannot filter by activity id", async() => {
  const node = await prepareNode(ScConditionalChainFlow.normalizeFlow({
    startNode: "decision",
    nodes: [{
      nodeId: "decision",
      activityId: "",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
      condition: { path: "", operator: "eq", value: "true" },
      routes: { onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  }));

  const suggestions = suggestionValues(node.pathSuggestionGroups);
  assert.ok(Array.isArray(node.pathSuggestionGroups));
  assert.ok(suggestions.includes("attack.hit"));
  assert.ok(suggestions.includes("contest.winner"));
  assert.ok(suggestions.includes("activity.checkPassed"));
});

test("preserves a manual last-result path while still exposing suggestions", async() => {
  const manualPath = "flags.scCustom.manualChoice";
  const node = await prepareNode(ScConditionalChainFlow.normalizeFlow({
    startNode: "decision",
    nodes: [{
      nodeId: "decision",
      activityId: "attack",
      conditionType: FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
      condition: { path: manualPath, operator: "eq", value: "true" },
      routes: { onTrue: FLOW_END, onFalse: FLOW_END }
    }]
  }));

  assert.equal(node.condition.path, manualPath);
  assert.ok(Array.isArray(node.pathSuggestionGroups));
  assert.ok(suggestionValues(node.pathSuggestionGroups).includes("attack.hit"));
  assert.equal(node.pathIsCustom, true);
});
