import test from "node:test";
import assert from "node:assert/strict";

const plays = [];
const warnings = [];
globalThis.ui = { notifications: { warn(message) { warnings.push(message); }, error() {} } };
globalThis.foundry = { audio: { AudioHelper: { async play(data, broadcast) { plays.push({ data, broadcast }); } } } };
globalThis.game = { user: { isGM: false } };

const { ScSoundActivityService } = await import("../../scripts/activities/sound/ScSoundActivityService.js");

test("a player broadcasts a sound configured for everyone", async() => {
  await ScSoundActivityService.play({
    audio: { source: "sounds/lock.wav", volume: 0.5 },
    playback: { audience: "everyone" }
  });

  assert.deepEqual(plays.at(-1), { data: { src: "sounds/lock.wav", volume: 0.5, loop: false }, broadcast: true });
  assert.equal(warnings.length, 0);
});

test("a sound for the user alone is not broadcast", async() => {
  await ScSoundActivityService.play({ audio: { source: "sounds/lock.wav" }, playback: { audience: "self" } });

  assert.equal(plays.at(-1).broadcast, false);
});
