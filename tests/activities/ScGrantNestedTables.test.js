import test from "node:test";
import assert from "node:assert/strict";

const notices = [];
globalThis.ui = {
  notifications: {
    info(message) { notices.push(["info", message]); },
    warn(message) { notices.push(["warn", message]); },
    error(message) { notices.push(["error", message]); }
  }
};
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} } },
  utils: { deepClone: (value) => structuredClone(value), mergeObject: (target, source) => ({ ...target, ...source }) }
};
globalThis.Hooks = { on() {} };
globalThis.CONFIG = { queries: {} };
globalThis.game = {};
// The warnings the draws log are asserted through the notifications.
console.warn = () => {};

const { ScGrantActivityService } = await import("../../scripts/activities/grant/ScGrantActivityService.js");
const { ScGrantTableResults } = await import("../../scripts/activities/grant/ScGrantTableResults.js");
const { ScGrantCard } = await import("../../scripts/activities/grant/ScGrantCard.js");

const item = (id, name) => ({ documentName: "Item", uuid: `Item.${id}`, name, img: `${id}.webp` });
const ruby = item("ruby", "Ruby");
const opal = item("opal", "Opal");
const sword = item("sword", "Sword");
const wolf = { documentName: "Actor", uuid: "Actor.wolf", name: "Wolf" };

/**
 * A table whose draws hand out `results` in turn, cycling, and that records
 * each draw. Its `results` collection is what the inspection reads.
 */
function makeTable(id, name, results, { replacement = true } = {}) {
  let next = 0;
  return {
    documentName: "RollTable",
    uuid: `RollTable.${id}`,
    name,
    img: `${id}.svg`,
    replacement,
    results,
    draws: [],
    async drawMany(count, options) {
      this.draws.push({ count, options });
      const drawn = [];
      for (let index = 0; index < count; index += 1) {
        drawn.push(results[next % results.length]);
        next += 1;
      }
      return { results: drawn };
    }
  };
}

const linkTo = (document, extra = {}) => ({ type: "document", name: document.name, documentUuid: document.uuid, ...extra });

function useDocuments(...documents) {
  const byUuid = new Map(documents.map((document) => [document.uuid, document]));
  globalThis.fromUuid = async (uuid) => byUuid.get(uuid) ?? null;
  notices.length = 0;
}

test("a table result that names another table draws from it, and the card shows where items came from", async() => {
  const gems = makeTable("gems", "Gems", [linkTo(ruby), linkTo(opal)]);
  const weapons = makeTable("weapons", "Weapons", [linkTo(sword)]);
  const reward = makeTable("reward", "Reward Kind", [linkTo(gems), linkTo(weapons), linkTo(gems)]);
  useDocuments(ruby, opal, sword, gems, weapons, reward);

  const plan = await ScGrantActivityService.planGrant([{ type: "table", uuid: reward.uuid, quantity: "3" }]);

  assert.deepEqual(
    plan.sources.map((source) => [source.uuid, source.quantity, source.tableUuid]),
    [[ruby.uuid, 1, reward.uuid], [opal.uuid, 1, reward.uuid], [sword.uuid, 1, reward.uuid]]
  );
  // Each inner table is drawn once, for every result that named it.
  assert.deepEqual(gems.draws.map((draw) => draw.count), [2]);
  assert.deepEqual(weapons.draws.map((draw) => draw.count), [1]);
  // Foundry is told not to recurse: the grant draws inner tables itself.
  assert.equal(reward.draws[0].options.recursive, false);
  assert.equal(notices.length, 0);

  const [line] = plan.lines;
  assert.deepEqual(line.items.map((row) => [row.kind, row.name, row.draws ?? row.quantity]), [
    ["table", "Gems", 2],
    ["table", "Weapons", 1]
  ]);
  assert.deepEqual(line.items[0].items.map((row) => row.name), ["Ruby", "Opal"]);

  const html = ScGrantCard.content({ lines: plan.lines, drawsText: (count) => `${count} draw(s)` });
  assert.match(html, /@UUID\[RollTable.gems\]\{Gems\}/);
  assert.match(html, /@UUID\[Item.ruby\]\{Ruby\}/);
});

test("text results can link inner tables too", async() => {
  const gems = makeTable("gems", "Gems", [linkTo(opal)]);
  const reward = makeTable("reward", "Reward", [
    { type: "text", name: "", description: `<p>A gem: @UUID[${gems.uuid}]{Gems}</p>` }
  ]);
  useDocuments(opal, gems, reward);

  const plan = await ScGrantActivityService.planGrant([{ type: "table", uuid: reward.uuid, quantity: "1" }]);

  assert.deepEqual(plan.sources.map((source) => source.uuid), [opal.uuid]);
});

test("tables nest up to three levels, and a deeper one is ignored with a warning", async() => {
  const level4 = makeTable("l4", "Level 4", [linkTo(sword)]);
  const level3 = makeTable("l3", "Level 3", [linkTo(ruby), linkTo(level4, { name: "Even deeper" })]);
  const level2 = makeTable("l2", "Level 2", [linkTo(level3)]);
  const level1 = makeTable("l1", "Level 1", [linkTo(level2)]);
  useDocuments(ruby, sword, level1, level2, level3, level4);

  const plan = await ScGrantActivityService.planGrant([{ type: "table", uuid: level1.uuid, quantity: "2" }]);

  assert.deepEqual(plan.sources.map((source) => source.uuid), [ruby.uuid]);
  assert.equal(level4.draws.length, 0);
  const warning = notices.find(([level, message]) => level === "warn" && /Level 3/.test(message));
  assert.ok(warning);
  assert.match(warning[1], /"Even deeper"/);
  assert.match(warning[1], /3 levels/);
});

test("a table that leads back to itself is not drawn again", async() => {
  const loop = makeTable("loop", "Loop", []);
  loop.results.push(linkTo(ruby), { type: "text", name: "Again", description: `@UUID[${loop.uuid}]{Loop}` });
  useDocuments(ruby, loop);

  const plan = await ScGrantActivityService.planGrant([{ type: "table", uuid: loop.uuid, quantity: "2" }]);

  assert.deepEqual(plan.sources.map((source) => [source.uuid, source.quantity]), [[ruby.uuid, 1]]);
  assert.equal(loop.draws.length, 1);
  assert.ok(notices.some(([level, message]) => level === "warn" && /"Again"/.test(message)));
});

test("results that grant nothing in an inner table are named with that table", async() => {
  const gems = makeTable("gems", "Gems", [linkTo(wolf)]);
  const reward = makeTable("reward", "Reward", [linkTo(gems)]);
  useDocuments(wolf, gems, reward);

  const plan = await ScGrantActivityService.planGrant([{ type: "table", uuid: reward.uuid, quantity: "1" }]);

  assert.equal(plan.sources.length, 0);
  const warning = notices.find(([level]) => level === "warn");
  assert.match(warning[1], /"Gems"/);
  assert.match(warning[1], /"Wolf"/);
});

test("the inspection accepts a table whose nested results all grant items", async() => {
  const gems = makeTable("gems", "Gems", [linkTo(ruby), linkTo(opal)]);
  const rare = makeTable("rare", "Rare", [linkTo(gems), linkTo(sword)]);
  const reward = makeTable("reward", "Reward", [linkTo(rare), linkTo(gems), {
    type: "text", name: "", description: `@UUID[${ruby.uuid}]{Ruby}`
  }]);
  useDocuments(ruby, opal, sword, gems, rare, reward);

  const report = await ScGrantTableResults.inspect(reward, { resolve: (uuid) => globalThis.fromUuid(uuid) });

  assert.equal(report.status, "valid");
  assert.deepEqual(report.issues, []);
  assert.equal(report.itemCount, 3);
  assert.equal(report.tableCount, 3);
  assert.equal(report.depth, 3);
});

test("the inspection explains every result that would grant nothing", async() => {
  const level4 = makeTable("l4", "Level 4", [linkTo(sword)]);
  const level3 = makeTable("l3", "Level 3", [linkTo(level4)]);
  const level2 = makeTable("l2", "Level 2", [linkTo(level3)]);
  const empty = makeTable("empty", "Empty", []);
  const reward = makeTable("reward", "Reward", [
    linkTo(level2),
    linkTo(wolf),
    { type: "text", name: "Gone", description: "@UUID[Item.deleted]{Old}" },
    { type: "text", name: "Flavor", description: "<p>Nothing here.</p>" },
    linkTo(empty)
  ]);
  reward.results.push({ type: "text", name: "Back", description: `@UUID[${reward.uuid}]{Reward}` });
  useDocuments(sword, wolf, level2, level3, level4, empty, reward);

  const report = await ScGrantTableResults.inspect(reward, { resolve: (uuid) => globalThis.fromUuid(uuid) });

  assert.equal(report.status, "invalid");
  const { EMPTY, NOT_ITEM, MISSING, TOO_DEEP, CYCLE } = ScGrantTableResults.CODES;
  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.table, issue.result ?? null, issue.inner ?? null]), [
    [TOO_DEEP, "Level 3", "Level 4", "Level 4"],
    [NOT_ITEM, "Reward", "Wolf", null],
    [MISSING, "Reward", "Gone", null],
    [NOT_ITEM, "Reward", "Flavor", null],
    [EMPTY, "Empty", null, null],
    [CYCLE, "Reward", "Back", "Reward"]
  ]);
});

test("a table drawn without replacement whose results are all drawn is only a warning", async() => {
  const table = makeTable("used", "Used", [linkTo(ruby, { drawn: true })], { replacement: false });
  useDocuments(ruby, table);

  const report = await ScGrantTableResults.inspect(table, { resolve: (uuid) => globalThis.fromUuid(uuid) });

  assert.equal(report.status, "warning");
  assert.deepEqual(report.issues.map((issue) => issue.code), [ScGrantTableResults.CODES.EXHAUSTED]);
});

test("the sheet's lookup reads compendium items from their index without loading them", async() => {
  let loads = 0;
  globalThis.fromUuid = async () => { loads += 1; return null; };
  globalThis.fromUuidSync = (uuid) => (uuid.startsWith("Compendium.") ? { uuid, name: "Indexed" } : null);
  globalThis.foundry.utils.parseUuid = (uuid) => ({ type: uuid.split(".").at(-2) });

  const indexed = await ScGrantTableResults.lookup("Compendium.world.gems.Item.ruby");
  assert.deepEqual(indexed, { documentName: "Item", uuid: "Compendium.world.gems.Item.ruby", name: "Indexed" });
  assert.equal(loads, 0);

  await ScGrantTableResults.lookup("Compendium.world.tables.RollTable.gems");
  assert.equal(loads, 1);

  delete globalThis.fromUuidSync;
  delete globalThis.foundry.utils.parseUuid;
});
