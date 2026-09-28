import test from "node:test";
import assert from "node:assert/strict";

import { Dnd5eLegacyTeleportPreserver } from "../../scripts/adapters/dnd5e/Dnd5eLegacyTeleportPreserver.js";
import { Dnd5eDataAdapter } from "../../scripts/adapters/dnd5e/Dnd5eDataAdapter.js";

function makeNativeTeleport() {
  const calls = [];
  class TeleportActivity {
    static migrateData(source) {
      calls.push(source);
      return source;
    }
  }
  return { TeleportActivity, calls };
}

function prunedTeleport(stash) {
  return {
    _id: "teleport1",
    type: "teleport",
    name: "Legacy Teleport",
    teleport: { override: false, units: "ft", value: "" },
    flags: { "sc-more-activities": { legacyTeleportSource: stash } }
  };
}

test("stashes legacy teleport fields before the native migration runs", () => {
  const { TeleportActivity, calls } = makeNativeTeleport();
  const installed = Dnd5eLegacyTeleportPreserver.install({
    activityTypes: { teleport: { documentClass: TeleportActivity } },
    nativeTeleport: TeleportActivity
  });
  assert.equal(installed, true);

  const source = {
    _id: "teleport1",
    type: "teleport",
    teleportDistance: 90,
    maxTargets: 3,
    flags: { core: { sheetLock: true } }
  };
  TeleportActivity.migrateData(source);

  assert.equal(calls.length, 1);
  assert.deepEqual(source.flags["sc-more-activities"].legacyTeleportSource, { maxTargets: 3, teleportDistance: 90 });
  assert.deepEqual(source.flags.core, { sheetLock: true });
});

test("leaves native teleport sources and other types untouched", () => {
  const { TeleportActivity } = makeNativeTeleport();
  Dnd5eLegacyTeleportPreserver.install({
    activityTypes: { teleport: { documentClass: TeleportActivity } },
    nativeTeleport: TeleportActivity
  });

  const native = { _id: "native1", type: "teleport", teleport: { override: true, units: "ft", value: "30" } };
  TeleportActivity.migrateData(native);
  assert.equal(native.flags, undefined);

  const other = { _id: "save1", type: "save", teleportDistance: 90 };
  Dnd5eLegacyTeleportPreserver.stash(other);
  assert.equal(other.flags, undefined);
});

test("wraps the native teleport only once", () => {
  const { TeleportActivity, calls } = makeNativeTeleport();
  const options = {
    activityTypes: { teleport: { documentClass: TeleportActivity } },
    nativeTeleport: TeleportActivity
  };
  Dnd5eLegacyTeleportPreserver.install(options);
  Dnd5eLegacyTeleportPreserver.install(options);

  TeleportActivity.migrateData({ type: "teleport" });
  assert.equal(calls.length, 1);
});

test("does not wrap a teleport that replaced the native dnd5e class", () => {
  const { TeleportActivity } = makeNativeTeleport();
  const { TeleportActivity: OtherTeleport } = makeNativeTeleport();
  const originalMigrateData = OtherTeleport.migrateData;

  const installed = Dnd5eLegacyTeleportPreserver.install({
    activityTypes: { teleport: { documentClass: OtherTeleport } },
    nativeTeleport: TeleportActivity
  });

  assert.equal(installed, false);
  assert.equal(OtherTeleport.migrateData, originalMigrateData);
  assert.equal(Dnd5eLegacyTeleportPreserver.install({ activityTypes: {} }), false);
});

test("identifies legacy teleports by their fields once a teleport type is registered", () => {
  const nativeTypes = { teleport: {} };
  assert.equal(Dnd5eLegacyTeleportPreserver.isLegacySource({ type: "teleport", teleportDistance: 30 }, nativeTypes), true);
  assert.equal(Dnd5eLegacyTeleportPreserver.isLegacySource({ type: "teleport", teleport: {} }, nativeTypes), false);
  assert.equal(Dnd5eLegacyTeleportPreserver.isLegacySource({ type: "teleport" }, {}), true);
  assert.equal(Dnd5eLegacyTeleportPreserver.isLegacySource({ type: "macro" }, {}), false);
});

test("the data adapter restores stashed fields and keeps the stash", () => {
  const stash = { maxTargets: 3, teleportDistance: 90 };
  const item = {
    _source: {
      system: {
        activities: {
          teleport1: prunedTeleport(stash),
          save1: { _id: "save1", type: "save", name: "Save" }
        }
      }
    }
  };

  const map = Dnd5eDataAdapter.getRawActivityMap(item);
  assert.equal(map.teleport1.teleportDistance, 90);
  assert.equal(map.teleport1.maxTargets, 3);
  assert.deepEqual(map.teleport1.flags["sc-more-activities"].legacyTeleportSource, stash);
  assert.deepEqual(map.save1, { _id: "save1", type: "save", name: "Save" });

  const container = Dnd5eDataAdapter.getRawActivities(item);
  assert.equal(container.teleport1.teleportDistance, 90);
  // Reading must never write the restored fields back into the document.
  assert.equal(item._source.system.activities.teleport1.teleportDistance, undefined);
});
