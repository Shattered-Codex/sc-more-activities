import test from "node:test";
import assert from "node:assert/strict";

const { ScRecallArrivalCamera } = await import("../../scripts/activities/recall/ScRecallArrivalCamera.js");

const MODULE = "sc-more-activities";
const player = { id: "player-1", isGM: false };
const gm = { id: "gm-1", isGM: true };
let nextId = 0;

function setup({ user = player } = {}) {
  const listeners = new Map();
  globalThis.Hooks = {
    on(event, fn) { listeners.set(event, fn); },
    call(event, ...args) { listeners.get(event)?.(...args); }
  };
  globalThis.foundry = {
    utils: {
      randomID: () => `arrival-${++nextId}`,
      hasProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object) !== undefined
    }
  };
  const scene = { id: "town", grid: { size: 100 }, tokens: { contents: [] } };
  const pans = [];
  globalThis.canvas = { scene, grid: scene.grid, animatePan: (point) => pans.push({ x: point.x, y: point.y }) };
  globalThis.game = { user: { ...user, character: null } };
  ScRecallArrivalCamera.registerHooks();
  return { scene, pans };
}

function makeToken(scene, { owner = true, x = 300, y = 400, size = 1, actor = null } = {}) {
  const token = {
    parent: scene,
    x,
    y,
    width: size,
    height: size,
    actor,
    isOwner: owner,
    flags: {},
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        const path = key.split(".");
        let target = this;
        for (const part of path.slice(0, -1)) target = target[part] ??= {};
        target[path.at(-1)] = value;
      }
      Hooks.call("updateToken", this, { flags: { [MODULE]: { recallArrival: this.flags[MODULE].recallArrival } } });
    }
  };
  scene.tokens.contents.push(token);
  return token;
}

test("an owner looking at the scene follows their token as soon as it is marked", async() => {
  const { scene, pans } = setup();
  const token = makeToken(scene, { size: 2 });

  await ScRecallArrivalCamera.mark(token, player);

  assert.deepEqual(pans, [{ x: 400, y: 500 }]);
  assert.equal(token.flags[MODULE].recallArrival.by, player.id);
});

test("someone else's arriving token does not move the camera", async() => {
  const { scene, pans } = setup();

  await ScRecallArrivalCamera.mark(makeToken(scene, { owner: false }), { id: "player-2" });

  assert.deepEqual(pans, []);
});

test("a GM only follows the trips the GM took", async() => {
  const { scene, pans } = setup({ user: gm });

  await ScRecallArrivalCamera.mark(makeToken(scene), player);
  assert.deepEqual(pans, []);

  await ScRecallArrivalCamera.mark(makeToken(scene, { x: 900 }), gm);
  assert.deepEqual(pans, [{ x: 950, y: 450 }]);
});

test("a user pulled to the new scene is brought to their token once it loads, only once", () => {
  const { scene, pans } = setup();
  const character = { id: "hero" };
  game.user.character = character;
  const companion = makeToken(scene, { x: 100 });
  companion.flags[MODULE] = { recallArrival: { id: "a1", at: Date.now(), by: "player-2" } };
  const hero = makeToken(scene, { x: 600, actor: character });
  hero.flags[MODULE] = { recallArrival: { id: "a2", at: Date.now() - 1000, by: "player-2" } };

  Hooks.call("canvasReady");
  Hooks.call("canvasReady");

  assert.deepEqual(pans, [{ x: 650, y: 450 }], "the user's own character first, and not again on reload");
});

test("an old arrival mark does not move the camera", () => {
  const { scene, pans } = setup();
  const token = makeToken(scene);
  token.flags[MODULE] = { recallArrival: { id: "old", at: Date.now() - (ScRecallArrivalCamera.FRESH_MS + 1000), by: player.id } };

  Hooks.call("canvasReady");

  assert.deepEqual(pans, []);
});
