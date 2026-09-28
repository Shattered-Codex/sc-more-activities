import test from "node:test";
import assert from "node:assert/strict";

globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.canvas = {};
globalThis.ChatMessage = {
  implementation: { getSpeaker: () => ({}) },
  getSpeaker: () => ({})
};
globalThis.game = {
  user: { isGM: true, targets: new Set() },
  macros: { get: () => null }
};

const { ScMacroActivityService } = await import("../../scripts/activities/macro/ScMacroActivityService.js");

test("returns falsy and numeric world macro values without discarding them", async() => {
  for (const value of [0, false, 5]) {
    globalThis.fromUuidSync = () => ({
      documentName: "Macro",
      canExecute: true,
      async execute() { return value; }
    });
    const result = await ScMacroActivityService.execute({
      execution: { mode: "world" },
      world: { macroUuid: "Macro.test" }
    });
    assert.deepEqual(result, { executed: true, value });
  }
});

test("returns the explicit value from inline macro code", async() => {
  const result = await ScMacroActivityService.execute({
    execution: { mode: "inline" },
    inline: { code: "return 3;" }
  }, { usage: {}, dialog: {}, message: {} });
  assert.deepEqual(result, { executed: true, value: 3 });
});

test("distinguishes a macro with no return value", async() => {
  globalThis.fromUuidSync = () => ({
    documentName: "Macro",
    canExecute: true,
    async execute() {}
  });
  const result = await ScMacroActivityService.execute({
    execution: { mode: "world" },
    world: { macroUuid: "Macro.test" }
  });
  assert.equal(result.executed, true);
  assert.equal(result.value, undefined);
});

test("runs inline code for a player allowed to use script macros", async() => {
  const previousUser = globalThis.game.user;
  const warnings = [];
  globalThis.ui.notifications.warn = (message) => warnings.push(message);
  try {
    const activity = { execution: { mode: "inline" }, inline: { code: "return 7;" } };

    globalThis.game.user = { isGM: false, targets: new Set(), can: (permission) => permission === "MACRO_SCRIPT" };
    assert.deepEqual(await ScMacroActivityService.execute(activity), { executed: true, value: 7 });

    globalThis.game.user = { isGM: false, targets: new Set(), can: () => false };
    assert.deepEqual(await ScMacroActivityService.execute(activity), { executed: false });
    assert.equal(warnings.length, 1);
  } finally {
    globalThis.game.user = previousUser;
    globalThis.ui.notifications.warn = () => {};
  }
});
