import test from "node:test";
import assert from "node:assert/strict";

const notices = [];
globalThis.ui = {
  notifications: {
    warn(message) { notices.push(["warn", message]); },
    error(message) { notices.push(["error", message]); }
  }
};
const shown = [];
let showFails = false;
globalThis.foundry = {
  documents: {
    collections: {
      Journal: {
        async _showEntry(uuid, force) {
          if (showFails) throw new Error("render failed");
          shown.push({ uuid, force });
        }
      }
    }
  }
};
const disabled = {};
globalThis.game = { settings: { get: () => disabled } };

const { ScJournalActivityService } = await import("../../scripts/activities/journal/ScJournalActivityService.js");
const { ScJournalItemDrop } = await import("../../scripts/activities/journal/ScJournalItemDrop.js");

function collection(entries) {
  const map = new Map(entries.map((entry) => [entry.id, entry]));
  Object.defineProperty(map, "contents", { get() { return [...map.values()]; } });
  return map;
}

/** A world with a secret journal of three pages, which the player owns none of. */
function setup() {
  notices.length = 0;
  shown.length = 0;
  showFails = false;
  for (const key of Object.keys(disabled)) delete disabled[key];

  const entry = { documentName: "JournalEntry", id: "lore", uuid: "JournalEntry.lore", name: "Ancient Lore", ownership: { default: 0 } };
  const pages = [
    { id: "ending", name: "The Ending", sort: 300 },
    { id: "prologue", name: "Prologue", sort: 100 },
    { id: "map", name: "Map", sort: 200 }
  ].map((page) => ({ documentName: "JournalEntryPage", ...page, uuid: `JournalEntry.lore.JournalEntryPage.${page.id}`, parent: entry }));
  entry.pages = collection(pages);
  const actor = { documentName: "Actor", id: "hero", uuid: "Actor.hero", name: "Hero" };
  const documents = new Map([[entry.uuid, entry], [actor.uuid, actor], ...pages.map((page) => [page.uuid, page])]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;
  return { entry, page: entry.pages.get("map"), actor };
}

const activityFor = (journal) => ({ journal: { uuid: "", pageId: "", ...journal } });

test("using the activity opens the whole journal, forced, for a user who has no permission on it", async() => {
  const { entry } = setup();

  const result = await ScJournalActivityService.open(activityFor({ uuid: entry.uuid }));

  assert.equal(result.opened, true);
  assert.deepEqual(shown, [{ uuid: entry.uuid, force: true }]);
  assert.equal(notices.length, 0);
});

test("with a page chosen, the journal opens at that page", async() => {
  const { entry, page } = setup();

  const result = await ScJournalActivityService.open(activityFor({ uuid: entry.uuid, pageId: page.id }));

  assert.equal(result.page, page);
  assert.deepEqual(shown, [{ uuid: page.uuid, force: true }]);
});

test("a page that is gone opens the whole journal and says so", async() => {
  const { entry } = setup();

  const result = await ScJournalActivityService.open(activityFor({ uuid: entry.uuid, pageId: "torn-out" }));

  assert.equal(result.opened, true);
  assert.deepEqual(shown, [{ uuid: entry.uuid, force: true }]);
  assert.deepEqual(notices.map(([level]) => level), ["warn"]);
});

test("nothing opens without a journal, or when it no longer exists, or names something else", async() => {
  setup();

  for (const [journal, reason] of [
    [{}, "missing-journal"],
    [{ uuid: "JournalEntry.burned" }, "journal-not-found"],
    [{ uuid: "Actor.hero" }, "journal-not-found"]
  ]) {
    assert.deepEqual(await ScJournalActivityService.open(activityFor(journal)), { opened: false, reason });
  }
  assert.equal(shown.length, 0);
  assert.equal(notices.length, 3);
});

test("a journal that fails to render is reported, not thrown", async() => {
  const { entry } = setup();
  showFails = true;

  const result = await ScJournalActivityService.open(activityFor({ uuid: entry.uuid }));

  assert.deepEqual(result, { opened: false, reason: "open-failed" });
  assert.equal(notices.at(-1)[0], "error");
});

test("a dropped page is stored as its journal plus the page; anything else is not a target", async() => {
  const { entry, page, actor } = setup();

  assert.deepEqual(await ScJournalActivityService.targetFromUuid(page.uuid), { uuid: entry.uuid, pageId: "map", name: "Map" });
  assert.deepEqual(await ScJournalActivityService.targetFromUuid(entry.uuid), { uuid: entry.uuid, pageId: "", name: "Ancient Lore" });
  assert.equal(await ScJournalActivityService.targetFromUuid(actor.uuid), null);
  assert.equal(await ScJournalActivityService.targetFromUuid(""), null);
});

test("a pasted page uuid splits into the journal and the page, compendium ones too", () => {
  assert.deepEqual(ScJournalActivityService.splitUuid(" JournalEntry.lore.JournalEntryPage.map "), { uuid: "JournalEntry.lore", pageId: "map" });
  assert.deepEqual(ScJournalActivityService.splitUuid("Compendium.world.lore.JournalEntry.a.JournalEntryPage.b"),
    { uuid: "Compendium.world.lore.JournalEntry.a", pageId: "b" });
  assert.deepEqual(ScJournalActivityService.splitUuid("JournalEntry.lore"), { uuid: "JournalEntry.lore", pageId: null });
});

test("pages are offered in the journal's own order", () => {
  const { entry } = setup();

  assert.deepEqual(ScJournalActivityService.pageOptions(entry).map((option) => option.label), ["Prologue", "Map", "The Ending"]);
  assert.deepEqual(ScJournalActivityService.pageOptions(null), []);
});

function makeItem() {
  const item = {
    created: [],
    system: { activities: new Map() },
    async createActivity(type, data) { this.created.push({ type, data }); }
  };
  return item;
}

const activitiesTab = { tabGroups: { primary: "activities" }, isEditable: true };

test("dropping a page on the item's Activities tab creates an Open Journal activity for it", async() => {
  const { entry, page } = setup();
  const item = makeItem();

  assert.equal(ScJournalItemDrop.onDrop(item, activitiesTab, { type: "JournalEntryPage", uuid: page.uuid }), false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(item.created, [{
    type: "sc-journal",
    data: { name: "Map", journal: { uuid: entry.uuid, pageId: "map" } }
  }]);
});

test("a journal dropped anywhere but an editable Activities tab is left to the sheet", async() => {
  const { entry } = setup();
  const item = makeItem();
  const drop = { type: "JournalEntry", uuid: entry.uuid };

  assert.equal(ScJournalItemDrop.onDrop(item, { tabGroups: { primary: "description" }, isEditable: true }, drop), undefined);
  assert.equal(ScJournalItemDrop.onDrop(item, { ...activitiesTab, isEditable: false }, drop), undefined);
  assert.equal(ScJournalItemDrop.onDrop(item, activitiesTab, { type: "Item", uuid: "Item.sword" }), undefined);
  assert.equal(ScJournalItemDrop.onDrop({ system: {} }, activitiesTab, drop), undefined);
  disabled["sc-journal"] = true;
  assert.equal(ScJournalItemDrop.onDrop(item, activitiesTab, drop), undefined);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(item.created.length, 0);
});

test("an activity that cannot be created is reported", async() => {
  const { entry } = setup();
  const item = makeItem();
  item.createActivity = async() => { throw new Error("not registered"); };

  assert.equal(await ScJournalItemDrop.create(item, entry.uuid), null);
  assert.equal(notices.at(-1)[0], "error");
});
