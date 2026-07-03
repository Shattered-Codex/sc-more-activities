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
    { type: "item", uuid: "Compendium.test.Item.foo", quantity: "3" },
    { type: "item", uuid: "Item.abc123", quantity: "1" }
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
    quantity: "1d4 + @prof"
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
