import test from "node:test";
import assert from "node:assert/strict";

import { MoreActivitiesMigrationConverter } from "../../scripts/migration/MoreActivitiesMigrationConverter.js";

test("converts legacy sound activity into sc-sound", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "abc123",
    type: "sound",
    name: "Legacy Sound",
    soundFile: "sounds/test.ogg",
    playForAll: true,
    volume: 0.4
  });

  assert.equal(result.ok, true);
  assert.equal(result.targetType, "sc-sound");
  assert.equal(result.convertedSource.type, "sc-sound");
  assert.deepEqual(result.convertedSource.audio, {
    source: "sounds/test.ogg",
    volume: 0.4
  });
  assert.deepEqual(result.convertedSource.playback, {
    audience: "everyone"
  });
});

test("blocks legacy hook activities", () => {
  const result = MoreActivitiesMigrationConverter.preview({
    _id: "hook1",
    type: "hook",
    name: "Legacy Hook"
  });

  assert.equal(result.ok, false);
  assert.equal(result.convertible, false);
  assert.equal(result.reason, "unsupported-legacy-hook");
});

test("blocks complex legacy grant activities", () => {
  const result = MoreActivitiesMigrationConverter.preview({
    _id: "grant1",
    type: "grant",
    grants: ["Compendium.test.Item.foo"],
    grantAll: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported-complex-grant");
});

test("preserves the runtime direction choice when migrating legacy movement", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "movement1",
    type: "movement",
    name: "Legacy Movement",
    movementType: "either",
    movementDistance: 10,
    targetRange: 30,
    maxTargets: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.targetType, "sc-movement");
  assert.deepEqual(result.convertedSource.movement, {
    targetSource: "targets",
    type: "either",
    distance: 10,
    maxRange: 30,
    maxTargets: 1,
    snapToGrid: true
  });
});

test("maps legacy advancement ids into sc-advancement selections", () => {
  const result = MoreActivitiesMigrationConverter.convert({
    _id: "adv1",
    type: "advancement",
    sourceItem: "Compendium.test.Item.bar",
    advancementIds: ["adv-a", "adv-b"]
  }, {
    sourceItemAdvancements: {
      "adv-a": { level: 3 },
      "adv-b": { levels: [7] }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.convertedSource.sourceItemUuid, "Compendium.test.Item.bar");
  assert.deepEqual(result.convertedSource.selections, [
    { advancementId: "adv-a", level: 3 },
    { advancementId: "adv-b", level: 7 }
  ]);
});
