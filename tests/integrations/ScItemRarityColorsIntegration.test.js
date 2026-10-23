import test from "node:test";
import assert from "node:assert/strict";

const { ScItemRarityColorsIntegration } = await import(
  "../../scripts/integrations/sc-item-rarity-colors/ScItemRarityColorsIntegration.js"
);

function install(module) {
  const calls = [];
  if (module?.api?.styleItemRow === true) {
    module.api.styleItemRow = (...args) => calls.push(args);
  }
  globalThis.game = { modules: new Map(module ? [["sc-item-rarity-colors", module]] : []) };
  return calls;
}

const row = { id: "row" };
const item = { id: "item" };

test("styles the row through an active module's API", () => {
  const calls = install({ active: true, api: { version: 1, styleItemRow: true } });

  ScItemRarityColorsIntegration.styleItemRow(row, item, { imageSelector: ".icon > img" });

  assert.deepEqual(calls, [[row, item, { imageSelector: ".icon > img" }]]);
});

test("does nothing when the module is missing, inactive, or too old", () => {
  for (const module of [null, { active: false, api: { version: 1, styleItemRow: true } }, { active: true, api: { version: 0, styleItemRow: true } }]) {
    const calls = install(module);
    ScItemRarityColorsIntegration.styleItemRow(row, item);
    assert.equal(calls.length, 0);
  }
});

test("a failing API never breaks the caller", () => {
  install({ active: true, api: { version: 1, styleItemRow: () => { throw new Error("boom"); } } });

  assert.doesNotThrow(() => ScItemRarityColorsIntegration.styleItemRow(row, item));
});
