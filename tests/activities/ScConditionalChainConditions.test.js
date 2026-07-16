import test from "node:test";
import assert from "node:assert/strict";

import {
  FLOW_PROPERTY_OPERATORS,
  ScConditionalChainConditions
} from "../../scripts/activities/conditional-chain/ScConditionalChainConditions.js";

const actor = {
  system: {
    attributes: { hp: { value: 12, max: 20 } },
    traits: { languages: { value: ["common", "elvish"] } },
    details: { alignment: "Neutral Good" }
  }
};

const lastResult = {
  damage: {
    total: 14,
    types: ["fire", "radiant"]
  },
  rolls: [{ total: 17 }],
  metadata: {
    outcome: "success"
  }
};

test("reads nested properties through dotted paths", () => {
  assert.equal(ScConditionalChainConditions.getPropertyValue(actor, "system.attributes.hp.value"), 12);
  assert.equal(ScConditionalChainConditions.getPropertyValue(actor, "system.missing.path"), undefined);
  assert.equal(ScConditionalChainConditions.getPropertyValue(actor, ""), undefined);
});

test("reads nested properties from last activity results", () => {
  assert.equal(ScConditionalChainConditions.getPropertyValue(lastResult, "damage.total"), 14);
  assert.equal(ScConditionalChainConditions.getPropertyValue(lastResult, "rolls.0.total"), 17);
  assert.equal(ScConditionalChainConditions.getPropertyValue(lastResult, "metadata.outcome"), "success");
});

test("compares numbers with ordering operators", () => {
  assert.deepEqual(ScConditionalChainConditions.compare("gt", 12, 10), { valid: true, result: true });
  assert.deepEqual(ScConditionalChainConditions.compare("gte", 12, "12"), { valid: true, result: true });
  assert.deepEqual(ScConditionalChainConditions.compare("lt", 12, 10), { valid: true, result: false });
  assert.deepEqual(ScConditionalChainConditions.compare("lte", "9", 10), { valid: true, result: true });
});

test("rejects ordering comparisons on non-numeric values", () => {
  const result = ScConditionalChainConditions.compare("gt", "abc", 10);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "not-numeric");
});

test("compares inclusive numeric ranges and detects interval overlap", () => {
  assert.deepEqual(ScConditionalChainConditions.compare("between", 5, "5..10"), { valid: true, result: true });
  assert.deepEqual(ScConditionalChainConditions.compare("between", 10, "5,10"), { valid: true, result: true });
  assert.equal(ScConditionalChainConditions.compare("between", 11, "5..10").result, false);
  assert.equal(ScConditionalChainConditions.compare("between", 7, "10..5").valid, false);

  const belowFive = ScConditionalChainConditions.numericInterval("lt", "5");
  const fiveToTen = ScConditionalChainConditions.numericInterval("between", "5..10");
  const fourOrMore = ScConditionalChainConditions.numericInterval("gte", "4");
  assert.equal(ScConditionalChainConditions.intervalsOverlap(belowFive, fiveToTen), false);
  assert.equal(ScConditionalChainConditions.intervalsOverlap(belowFive, fourOrMore), true);
});

test("compares equality loosely between numbers and strings", () => {
  assert.equal(ScConditionalChainConditions.compare("eq", 12, "12").result, true);
  assert.equal(ScConditionalChainConditions.compare("eq", "Neutral Good", "Neutral Good").result, true);
  assert.equal(ScConditionalChainConditions.compare("ne", true, "1").result, false);
  assert.equal(ScConditionalChainConditions.compare("eq", "abc", "abd").result, false);
});

test("supports includes for arrays, sets and strings", () => {
  assert.equal(ScConditionalChainConditions.compare("includes", ["common", "elvish"], "elvish").result, true);
  assert.equal(ScConditionalChainConditions.compare("includes", new Set(["a"]), "a").result, true);
  assert.equal(ScConditionalChainConditions.compare("includes", "Neutral Good", "Good").result, true);
  assert.equal(ScConditionalChainConditions.compare("includes", 42, "4").valid, false);
});

test("rejects unknown operators", () => {
  assert.equal(ScConditionalChainConditions.compare("~=", 1, 1).valid, false);
  assert.equal(ScConditionalChainConditions.isOperator("eq"), true);
  assert.equal(ScConditionalChainConditions.isOperator("weird"), false);
  assert.deepEqual(Object.values(FLOW_PROPERTY_OPERATORS).sort(), ["between", "eq", "gt", "gte", "includes", "lt", "lte", "ne"]);
});

test("evaluates actor properties end to end", () => {
  const evaluation = ScConditionalChainConditions.evaluateActorProperty(
    { path: "system.attributes.hp.value", operator: "gt", value: "10" },
    actor
  );
  assert.deepEqual(evaluation, { valid: true, result: true, actual: 12, expected: "10" });
});

test("resolves expected values through the injected resolver", () => {
  const evaluation = ScConditionalChainConditions.evaluateActorProperty(
    { path: "system.attributes.hp.value", operator: "lt", value: "@attributes.hp.max" },
    actor,
    { resolveExpected: () => 20 }
  );
  assert.deepEqual(evaluation, { valid: true, result: true, actual: 12, expected: 20 });
});

test("evaluates last activity result sources end to end", () => {
  const numeric = ScConditionalChainConditions.evaluateActorProperty(
    { path: "damage.total", operator: "gte", value: "12" },
    lastResult
  );
  assert.deepEqual(numeric, { valid: true, result: true, actual: 14, expected: "12" });

  const includes = ScConditionalChainConditions.evaluateActorProperty(
    { path: "damage.types", operator: "includes", value: "radiant" },
    lastResult
  );
  assert.deepEqual(includes, {
    valid: true,
    result: true,
    actual: ["fire", "radiant"],
    expected: "radiant"
  });
});

test("fails safely on missing paths and invalid operators", () => {
  const missing = ScConditionalChainConditions.evaluateActorProperty(
    { path: "system.missing.path", operator: "eq", value: "1" },
    actor
  );
  assert.deepEqual(missing, { valid: false, reason: "missing-property" });

  const invalid = ScConditionalChainConditions.evaluateActorProperty(
    { path: "system.attributes.hp.value", operator: "weird", value: "1" },
    actor
  );
  assert.deepEqual(invalid, { valid: false, reason: "invalid-operator" });
});

test("rejects null values only when the caller opts into treatNullAsMissing", () => {
  const source = { success: null };

  const rejected = ScConditionalChainConditions.evaluateProperty(
    { path: "success", operator: "eq", value: "true" },
    source,
    { treatNullAsMissing: true }
  );
  assert.deepEqual(rejected, { valid: false, reason: "null-property" });

  const compared = ScConditionalChainConditions.evaluateProperty(
    { path: "success", operator: "eq", value: "true" },
    source
  );
  assert.equal(compared.valid, true);
  assert.equal(compared.result, false);
});
