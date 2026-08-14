import test from "node:test";
import assert from "node:assert/strict";

import { MoreActivitiesMigrationService } from "../../scripts/migration/MoreActivitiesMigrationService.js";
import { SETTINGS_KEYS } from "../../scripts/constants/SettingsKeys.js";

const BACKUPS_KEY = `sc-more-activities.${SETTINGS_KEYS.MIGRATION_BACKUPS}`;
const RETENTION_KEY = `sc-more-activities.${SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION}`;

function legacyMacroActivity() {
  return { _id: "act1", type: "macro", name: "Legacy Macro", macroCode: "console.log(1);" };
}

function blockedHookActivity() {
  return { _id: "act2", type: "hook", name: "Legacy Hook" };
}

function previewEntry({ packId = null, convertible = true, activityId = "act1", legacyType = "macro" } = {}) {
  return {
    itemUuid: packId ? `Compendium.${packId}.Item.item1` : "Item.item1",
    itemId: "item1",
    itemName: "Packed Blade",
    source: packId ? "compendium" : "world",
    packId,
    packLabel: packId,
    packLocked: true,
    activities: [{
      activityId,
      activityName: "Legacy",
      legacyType,
      targetType: "sc-macro",
      convertible,
      lossy: false,
      reason: convertible ? null : "unsupported-legacy-hook",
      warnings: []
    }]
  };
}

function makeItem({ uuid, activities }) {
  const stored = { ...activities };
  return {
    uuid,
    name: "Packed Blade",
    toObject: () => ({ system: { activities: stored } }),
    update: async(data) => {
      Object.assign(stored, data["system.activities"]);
      for (const key of Object.keys(stored)) {
        if (!(key in data["system.activities"])) {
          delete stored[key];
        }
      }
      return true;
    }
  };
}

/**
 * @param {object} options
 * @param {Map<string, object>} options.items - items resolvable by uuid
 * @param {Map<string, object>} options.packs - packs resolvable by collection id
 */
function installGlobals(t, { items = new Map(), packs = new Map() } = {}) {
  const silenced = { info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  console.error = () => {};

  const settings = new Map([
    [BACKUPS_KEY, []],
    [RETENTION_KEY, 3]
  ]);

  let idCounter = 0;
  globalThis.foundry = { utils: { randomID: () => `id-${idCounter += 1}` } };
  globalThis.fromUuid = async(uuid) => items.get(uuid) ?? null;
  globalThis.game = {
    i18n: { localize: (key) => key, format: (key) => key },
    user: { isGM: true },
    world: { id: "test-world" },
    modules: { get: () => null },
    packs: { get: (id) => packs.get(id) ?? null },
    settings: {
      get: (module, key) => settings.get(`${module}.${key}`),
      set: async(module, key, value) => settings.set(`${module}.${key}`, value)
    }
  };

  t.after(() => {
    Object.assign(console, silenced);
    delete globalThis.game;
    delete globalThis.foundry;
    delete globalThis.fromUuid;
  });

  return { settings };
}

test("refuses to apply a preview whose compendium scan failed", async(t) => {
  installGlobals(t);

  const service = new MoreActivitiesMigrationService();
  await assert.rejects(
    () => service.migrateMoreActivities({
      preview: {
        previewId: "p1",
        entries: [],
        failedPacks: [{ id: "world.broken", label: "Broken Gear", reason: "boom" }]
      }
    }),
    /IncompleteScope/
  );
});

test("stores a backup honouring the configured retention", async(t) => {
  const item = makeItem({
    uuid: "Item.item1",
    activities: { act1: legacyMacroActivity() }
  });
  const { settings } = installGlobals(t, { items: new Map([[item.uuid, item]]) });
  settings.set(RETENTION_KEY, 2);
  settings.set(BACKUPS_KEY, [{ id: "old-1" }, { id: "old-2" }]);

  const service = new MoreActivitiesMigrationService();
  const report = await service.migrateMoreActivities({
    preview: { previewId: "p0", entries: [previewEntry()] }
  });

  const stored = settings.get(BACKUPS_KEY);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].id, report.backupId);
  assert.equal(stored[0].items[0].activities.act1.type, "macro");
  // The oldest backup is dropped by the retention setting.
  assert.deepEqual(stored.map((entry) => entry.id), [report.backupId, "old-1"]);
});

test("applies an incomplete preview once the caller acknowledges the scope", async(t) => {
  const item = makeItem({
    uuid: "Compendium.world.gear.Item.item1",
    activities: { act1: legacyMacroActivity() }
  });
  installGlobals(t, {
    items: new Map([[item.uuid, item]]),
    packs: new Map([["world.gear", { collection: "world.gear", title: "Gear", locked: false }]])
  });

  const service = new MoreActivitiesMigrationService();
  const report = await service.migrateMoreActivities({
    preview: {
      previewId: "p2",
      entries: [previewEntry({ packId: "world.gear" })],
      failedPacks: [{ id: "world.broken", label: "Broken Gear", reason: "boom" }]
    },
    allowIncompleteScope: true
  });

  assert.equal(report.updatedItems, 1);
  assert.equal(report.incompleteScope, true);
  assert.equal(report.failedPacks.length, 1);
});

test("reports compendiums that stayed unlocked after the migration", async(t) => {
  const item = makeItem({
    uuid: "Compendium.world.gear.Item.item1",
    activities: { act1: legacyMacroActivity() }
  });
  const pack = {
    collection: "world.gear",
    title: "World Gear",
    locked: true,
    configure: async({ locked }) => {
      if (locked === true) {
        throw new Error("relock refused");
      }
      pack.locked = false;
    }
  };
  installGlobals(t, {
    items: new Map([[item.uuid, item]]),
    packs: new Map([["world.gear", pack]])
  });

  const service = new MoreActivitiesMigrationService();
  const report = await service.migrateMoreActivities({
    preview: { previewId: "p3", entries: [previewEntry({ packId: "world.gear" })] }
  });

  assert.equal(report.updatedItems, 1);
  assert.equal(report.failedRelocks.length, 1);
  assert.equal(report.failedRelocks[0].packId, "world.gear");
  assert.equal(report.failedRelocks[0].label, "World Gear");
  assert.equal(pack.locked, false);
});

test("leaves a locked pack alone when none of its entries are convertible", async(t) => {
  const item = makeItem({
    uuid: "Compendium.world.gear.Item.item1",
    activities: { act2: blockedHookActivity() }
  });
  const configureCalls = [];
  const pack = {
    collection: "world.gear",
    title: "World Gear",
    locked: true,
    configure: async(options) => {
      configureCalls.push(options);
      pack.locked = options.locked === true;
    }
  };
  installGlobals(t, {
    items: new Map([[item.uuid, item]]),
    packs: new Map([["world.gear", pack]])
  });

  const service = new MoreActivitiesMigrationService();
  const report = await service.migrateMoreActivities({
    preview: {
      previewId: "p4",
      entries: [previewEntry({ packId: "world.gear", convertible: false, activityId: "act2", legacyType: "hook" })]
    }
  });

  assert.deepEqual(configureCalls, []);
  assert.equal(pack.locked, true);
  assert.equal(report.failedItems, 0);
  assert.equal(report.skippedActivities, 1);
  assert.equal(report.items[0].status, "skipped");
});
