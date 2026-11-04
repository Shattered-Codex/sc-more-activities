import test from "node:test";
import assert from "node:assert/strict";

import { ScGrantEntryHelpers } from "../../scripts/activities/grant/ScGrantEntryHelpers.js";

test("normalizes legacy grant entries with numeric quantities", () => {
  const entries = ScGrantEntryHelpers.normalizeEntries([
    { uuid: "Compendium.test.Item.foo", quantity: 3 },
    { uuid: "  Item.abc123  " },
    { uuid: "", quantity: 5 },
    null
  ]);

  assert.deepEqual(entries, [
    { type: "item", uuid: "Compendium.test.Item.foo", quantity: "3", cost: 1 },
    { type: "item", uuid: "Item.abc123", quantity: "1", cost: 1 }
  ]);
});

test("preserves table source type and formula quantity on new entries", () => {
  const entry = ScGrantEntryHelpers.normalizeEntry({
    type: "table",
    uuid: "RollTable.xyz",
    quantity: " 1d4 + @prof "
  });

  assert.deepEqual(entry, {
    type: "table",
    uuid: "RollTable.xyz",
    quantity: "1d4 + @prof",
    cost: 1
  });
});

test("falls back unknown source types to item", () => {
  const entry = ScGrantEntryHelpers.normalizeEntry({ type: "weird", uuid: "Item.a" });
  assert.equal(entry.type, "item");
});

test("evaluates plain integer quantities without a Roll evaluator", async() => {
  assert.equal(await ScGrantEntryHelpers.evaluateQuantity("3", {}), 3);
  assert.equal(await ScGrantEntryHelpers.evaluateQuantity(2, {}), 2);
  assert.equal(await ScGrantEntryHelpers.evaluateQuantity("", {}), 1);
  assert.equal(await ScGrantEntryHelpers.evaluateQuantity(undefined, {}), 1);
});

test("evaluates formula quantities through the injected evaluator with clamping", async() => {
  const seen = [];
  const evaluator = async(formula, rollData) => {
    seen.push({ formula, rollData });
    return rollData.prof + 2.9;
  };

  const quantity = await ScGrantEntryHelpers.evaluateQuantity("@prof + 2", { prof: 2 }, { evaluator });
  assert.equal(quantity, 4);
  assert.deepEqual(seen, [{ formula: "@prof + 2", rollData: { prof: 2 } }]);
});

test("clamps and recovers when the quantity evaluation fails or is invalid", async() => {
  const failing = async() => {
    throw new Error("bad formula");
  };
  assert.equal(await ScGrantEntryHelpers.evaluateQuantity("@nope +", {}, { evaluator: failing }), 1);

  const negative = async() => -5;
  assert.equal(await ScGrantEntryHelpers.evaluateQuantity("@x", {}, { evaluator: negative }), 1);

  const nonNumeric = async() => Number.NaN;
  assert.equal(await ScGrantEntryHelpers.evaluateQuantity("@x", {}, { evaluator: nonNumeric }), 1);
});

test("normalizes check configuration and detects when the check gate is enabled", () => {
  assert.equal(ScGrantEntryHelpers.isCheckEnabled(undefined), false);
  assert.equal(ScGrantEntryHelpers.isCheckEnabled({ ability: "" }), false);
  assert.equal(ScGrantEntryHelpers.isCheckEnabled({ ability: "str" }), true);
  assert.equal(ScGrantEntryHelpers.isCheckEnabled({ ability: "", skill: "prc" }), true);

  const check = ScGrantEntryHelpers.normalizeCheck({
    ability: " dex ",
    skill: "acr",
    dc: { calculation: "spellcasting", formula: " 8 + @prof " }
  });
  assert.deepEqual(check, {
    ability: "dex",
    skill: "acr",
    dc: { calculation: "spellcasting", formula: "8 + @prof" }
  });

  assert.deepEqual(ScGrantEntryHelpers.normalizeCheck(null), {
    ability: "",
    skill: "",
    dc: { calculation: "", formula: "" }
  });
});

test("defaults legacy activities to granting every source immediately", () => {
  assert.deepEqual(ScGrantEntryHelpers.normalizeSelection(undefined), { mode: "all", count: 1, budget: "10" });
  assert.equal(ScGrantEntryHelpers.normalizeDelivery(undefined), "instant");
  assert.deepEqual(ScGrantEntryHelpers.normalizeBastion(undefined), { order: "harvest", days: 7 });
  assert.deepEqual(ScGrantEntryHelpers.normalizeBastion({ order: "build", days: 0 }), { order: "harvest", days: 7 });
});

test("only asks for a choice when it leaves some sources out", () => {
  assert.equal(ScGrantEntryHelpers.choiceCount({ mode: "all", count: 1 }, 3), 0);
  assert.equal(ScGrantEntryHelpers.choiceCount({ mode: "choose", count: 1 }, 3), 1);
  assert.equal(ScGrantEntryHelpers.choiceCount({ mode: "choose", count: 2 }, 3), 2);
  assert.equal(ScGrantEntryHelpers.choiceCount({ mode: "choose", count: 3 }, 3), 0);
});

test("accepts exactly the required number of distinct, valid picks", () => {
  const entries = ["a", "b", "c"].map((uuid) => ({ type: "item", uuid, quantity: "10" }));
  const selection = { mode: "choose", count: 2 };

  assert.deepEqual(ScGrantEntryHelpers.applyPicks(entries, selection, [2, 0]).map((entry) => entry.uuid), ["a", "c"]);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [1]), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [1, 1]), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [0, 3]), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, undefined), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, { mode: "all" }, undefined), entries);
});

test("a budget spends up to its points on weighted units and multiplies each pack", () => {
  const entries = [
    { type: "item", uuid: "bouquet", quantity: "1", cost: 1 },
    { type: "item", uuid: "perfume", quantity: "1", cost: 1 },
    { type: "item", uuid: "candle", quantity: "1", cost: 2 },
    { type: "table", uuid: "loot", quantity: "1d2", cost: 1 }
  ];
  const selection = { mode: "budget", budget: "10" };

  const chosen = ScGrantEntryHelpers.applyPicks(entries, selection, [3, 3, 2, 0], { budget: 10 });
  assert.deepEqual(chosen.map(({ uuid, quantity }) => [uuid, quantity]), [
    ["bouquet", "3"], ["perfume", "3"], ["candle", "2"]
  ]);

  // Up to the budget: spending less is allowed, more or nothing is not.
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [1, 0, 0, 0], { budget: 10 }).length, 1);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [3, 3, 3, 0], { budget: 10 }), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [0, 0, 0, 0], { budget: 10 }), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [1, 0, 0], { budget: 10 }), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [-1, 2, 0, 0], { budget: 10 }), null);
  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [1.5, 0, 0, 0], { budget: 10 }), null);

  assert.equal(ScGrantEntryHelpers.applyPicks(entries, selection, [0, 0, 0, 2], { budget: 10 })[0].quantity, "2 * (1d2)");
});

test("multiplies a pack quantity and defaults invalid weights to 1", () => {
  assert.equal(ScGrantEntryHelpers.multiplyQuantity("5", 2), "10");
  assert.equal(ScGrantEntryHelpers.multiplyQuantity("1d4", 1), "1d4");
  assert.equal(ScGrantEntryHelpers.normalizeCost(0), 1);
  assert.equal(ScGrantEntryHelpers.normalizeCost("3"), 3);
  assert.equal(ScGrantEntryHelpers.isBudget({ mode: "budget" }), true);
});

test("reads configured item flags: valid scope.key paths outside this module, values as JSON when possible", () => {
  assert.deepEqual(ScGrantEntryHelpers.normalizeItemFlags([
    { key: " importer.isStandardDragDrop ", value: "true" },
    { key: "world.count", value: "3" },
    { key: "world.label", value: "plain text" },
    { key: "world.nested.path", value: "{\"a\":1}" },
    { key: "sc-more-activities.grantDeliveryKey", value: "x" },
    { key: "world.__proto__.x", value: "1" },
    { key: "nodot", value: "1" },
    { key: "", value: "1" },
    null
  ]), [
    { key: "importer.isStandardDragDrop", value: true },
    { key: "world.count", value: 3 },
    { key: "world.label", value: "plain text" },
    { key: "world.nested.path", value: { a: 1 } }
  ]);
  assert.deepEqual(ScGrantEntryHelpers.normalizeItemFlags(undefined), []);
});
