import test from "node:test";
import assert from "node:assert/strict";

const { ScIdentifyCard } = await import("../../scripts/activities/identify/ScIdentifyCard.js");

function setup() {
  const listeners = new Map();
  globalThis.Hooks = { on: (event, fn) => listeners.set(event, fn), call: (event, ...args) => listeners.get(event)?.(...args) };
  globalThis.CONFIG = {
    DND5E: { itemRarity: { rare: "Rare" } },
    Item: { typeLabels: { equipment: "Equipment" } }
  };
  globalThis.game = { modules: new Map() };
  return listeners;
}

const hero = { uuid: "Actor.hero", name: "Randal" };
const ally = { uuid: "Actor.ally", name: "Aoth" };
const ring = {
  uuid: "Actor.hero.Item.ring",
  name: "Ring of Free Action",
  img: "icons/ring.webp",
  type: "equipment",
  system: { rarity: "rare", type: { label: "Ring" }, attunement: "required" }
};

test("the revealed item shows its art, true name, rarity, type, and attunement", () => {
  setup();

  const html = ScIdentifyCard.content({ status: "identified", identifier: hero, owner: hero, item: ring });

  assert.match(html, /data-rarity="rare"/);
  assert.match(html, /<img src="icons\/ring\.webp"/);
  assert.match(html, /@UUID\[Actor\.hero\.Item\.ring\]\{Ring of Free Action\}/);
  assert.match(html, /sc-ma-identify-card-rarity">Rare</);
  assert.match(html, /Ring · Requires attunement/);
  assert.match(html, /data-item-uuid="Actor\.hero\.Item\.ring"/);
});

test("it tells the name the item went by, who identified it, and the check", () => {
  setup();

  const html = ScIdentifyCard.content({
    status: "identified",
    identifier: hero,
    owner: ally,
    item: ring,
    formerName: "Unidentified Ring",
    check: { dc: 16, total: 17 },
    checkName: "Arcana"
  });

  assert.match(html, /Once known as Unidentified Ring/);
  assert.match(html, /Randal · Aoth&#039;s item/);
  assert.match(html, /Arcana 17 · DC 16/);
});

test("no former-name line when the item kept its name", () => {
  setup();

  const html = ScIdentifyCard.content({ status: "identified", identifier: hero, owner: hero, item: ring, formerName: ring.name });

  assert.doesNotMatch(html, /Once known as/);
});

test("pending, failed, and refused requests get a short note", () => {
  setup();

  assert.match(ScIdentifyCard.content({ status: "pending", identifier: hero, owner: ally }), /Randal is trying to identify an item of Aoth/);
  assert.match(ScIdentifyCard.content({ status: "failed", identifier: hero, item: { name: "Odd Ring" } }), /Randal could not identify Odd Ring/);
  assert.match(ScIdentifyCard.content({ status: "refused" }), /was refused/);
});

test("a rendered card gets SC Item Rarity Colors' styling for its item when the module is active", () => {
  const listeners = setup();
  const calls = [];
  game.modules.set("sc-item-rarity-colors", { active: true, api: { version: 1, styleItemRow: (...args) => calls.push(args) } });
  globalThis.fromUuidSync = (uuid) => (uuid === ring.uuid ? ring : null);
  ScIdentifyCard.registerHooks();
  const row = { dataset: { itemUuid: ring.uuid } };
  const html = { querySelector: (selector) => (selector.includes("data-item-uuid") ? row : null) };

  listeners.get("renderChatMessageHTML")({}, [html]);

  assert.deepEqual(calls, [[row, ring, { imageSelector: ".sc-ma-identify-card-art > img" }]]);
});
