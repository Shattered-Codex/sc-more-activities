import test from "node:test";
import assert from "node:assert/strict";

import { MoreActivitiesMigrationAnalyzer } from "../../scripts/migration/MoreActivitiesMigrationAnalyzer.js";
import { MoreActivitiesMigrationPackScanner } from "../../scripts/migration/MoreActivitiesMigrationPackScanner.js";

function makeItem({ id, name, activities = {}, actor = null }) {
  return {
    id,
    name,
    type: "weapon",
    uuid: `Compendium.world.gear.Item.${id}`,
    actor,
    toObject: () => ({ system: { activities } })
  };
}

function makeWorldItem({ id, name, activities = {} }) {
  return {
    id,
    name,
    type: "weapon",
    uuid: `Item.${id}`,
    actor: null,
    toObject: () => ({ system: { activities } })
  };
}

function makePack({
  collection,
  label = collection,
  documentName = "Item",
  packageType = "world",
  locked = false,
  documents = []
}) {
  return {
    collection,
    title: label,
    documentName,
    locked,
    metadata: { packageType, label },
    getDocuments: async() => documents
  };
}

function legacyMacroActivity(name = "Legacy Macro") {
  return {
    _id: "act1",
    type: "macro",
    name,
    macroUuid: "Macro.abc"
  };
}

function installGlobals(t, { items = [], actors = [], packs = [] } = {}) {
  const silencedInfo = console.info;
  const silencedDebug = console.debug;
  console.info = () => {};
  console.debug = () => {};

  globalThis.game = {
    i18n: {
      localize: (key) => key,
      format: (key) => key
    },
    world: { id: "test-world" },
    modules: { get: () => null },
    items: { contents: items },
    actors: { contents: actors },
    packs
  };

  t.after(() => {
    console.info = silencedInfo;
    console.debug = silencedDebug;
    delete globalThis.game;
  });
}

test("finds legacy activities inside world compendium item packs", async(t) => {
  const packItem = makeItem({
    id: "item1",
    name: "Compendium Blade",
    activities: { act1: legacyMacroActivity() }
  });
  installGlobals(t, {
    packs: [makePack({ collection: "world.gear", label: "World Gear", documents: [packItem] })]
  });

  const report = await new MoreActivitiesMigrationAnalyzer().analyze({ previewId: "p1" });

  assert.equal(report.compendiumItems, 1);
  assert.equal(report.scannedPacks, 1);
  assert.equal(report.scannedCompendiumItems, 1);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].source, "compendium");
  assert.equal(report.entries[0].packId, "world.gear");
  assert.equal(report.entries[0].packLabel, "World Gear");
  assert.equal(report.entries[0].activities[0].legacyType, "macro");
  assert.equal(report.entries[0].activities[0].targetType, "sc-macro");
  assert.equal(report.activitiesByType.macro, 1);
});

test("finds legacy activities on actors stored inside compendium actor packs", async(t) => {
  const actor = { name: "Packed NPC", uuid: "Compendium.world.npcs.Actor.a1" };
  const embeddedItem = makeItem({
    id: "item2",
    name: "NPC Blade",
    activities: { act1: legacyMacroActivity() },
    actor
  });
  actor.items = { contents: [embeddedItem] };

  installGlobals(t, {
    packs: [makePack({
      collection: "world.npcs",
      label: "World NPCs",
      documentName: "Actor",
      documents: [actor]
    })]
  });

  const report = await new MoreActivitiesMigrationAnalyzer().analyze({ previewId: "p2" });

  assert.equal(report.compendiumItems, 1);
  assert.equal(report.entries[0].actorName, "Packed NPC");
  assert.equal(report.entries[0].packId, "world.npcs");
});

test("skips system and module packs unless explicitly enabled", async(t) => {
  const packItem = makeItem({
    id: "item3",
    name: "Module Blade",
    activities: { act1: legacyMacroActivity() }
  });
  const modulePack = makePack({
    collection: "some-module.gear",
    label: "Module Gear",
    packageType: "module",
    documents: [packItem]
  });
  installGlobals(t, { packs: [modulePack] });

  const skipped = await new MoreActivitiesMigrationAnalyzer().analyze({ previewId: "p3" });
  assert.equal(skipped.compendiumItems, 0);
  assert.equal(skipped.scannedPacks, 0);
  assert.equal(skipped.skippedExternalPacks.length, 1);
  assert.ok(skipped.warnings.some((warning) => warning.includes("system/module")));

  const included = await new MoreActivitiesMigrationAnalyzer().analyze({
    previewId: "p4",
    includeExternalPacks: true
  });
  assert.equal(included.compendiumItems, 1);
  assert.equal(included.scannedPacks, 1);
});

test("reports locked packs that hold convertible entries", async(t) => {
  const packItem = makeItem({
    id: "item4",
    name: "Locked Blade",
    activities: { act1: legacyMacroActivity() }
  });
  installGlobals(t, {
    packs: [makePack({
      collection: "world.locked",
      label: "Locked Gear",
      locked: true,
      documents: [packItem]
    })]
  });

  const report = await new MoreActivitiesMigrationAnalyzer().analyze({ previewId: "p5" });

  assert.equal(report.lockedPacks.length, 1);
  assert.equal(report.lockedPacks[0].id, "world.locked");
  assert.equal(report.entries[0].packLocked, true);
});

test("skips compendium scanning when disabled", async(t) => {
  const packItem = makeItem({
    id: "item5",
    name: "Ignored Blade",
    activities: { act1: legacyMacroActivity() }
  });
  installGlobals(t, {
    packs: [makePack({ collection: "world.gear", documents: [packItem] })]
  });

  const report = await new MoreActivitiesMigrationAnalyzer().analyze({
    previewId: "p6",
    includeCompendiums: false
  });

  assert.equal(report.compendiumItems, 0);
  assert.equal(report.scannedPacks, 0);
  assert.equal(report.entries.length, 0);
});

test("still scans world items and reports progress phases", async(t) => {
  const worldItem = makeWorldItem({
    id: "w1",
    name: "World Blade",
    activities: { act1: legacyMacroActivity() }
  });
  const packItem = makeItem({
    id: "item6",
    name: "Pack Blade",
    activities: { act1: legacyMacroActivity() }
  });
  installGlobals(t, {
    items: [worldItem],
    packs: [makePack({ collection: "world.gear", documents: [packItem] })]
  });

  const phases = [];
  const report = await new MoreActivitiesMigrationAnalyzer().analyze({
    previewId: "p7",
    onProgress: (payload) => phases.push(payload.phase)
  });

  assert.equal(report.worldItems, 1);
  assert.equal(report.compendiumItems, 1);
  assert.equal(report.entries.length, 2);
  assert.ok(phases.includes("world-items"));
  assert.ok(phases.includes("compendiums"));
  assert.ok(phases.includes("done"));
});

test("ignores packs that hold neither items nor actors", async(t) => {
  installGlobals(t, {
    packs: [makePack({ collection: "world.journals", documentName: "JournalEntry", documents: [] })]
  });

  const report = await new MoreActivitiesMigrationAnalyzer().analyze({ previewId: "p8" });

  assert.equal(report.scannedPacks, 0);
  assert.equal(report.skippedExternalPacks.length, 0);
});

test("treats packs without packageType metadata as world packs by collection prefix", () => {
  assert.equal(MoreActivitiesMigrationPackScanner.isWorldPack({ collection: "world.gear", metadata: {} }), true);
  assert.equal(MoreActivitiesMigrationPackScanner.isWorldPack({ collection: "dnd5e.items", metadata: {} }), false);
});
