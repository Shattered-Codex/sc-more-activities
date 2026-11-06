import test from "node:test";
import assert from "node:assert/strict";

const { ScGrantCard } = await import("../../scripts/activities/grant/ScGrantCard.js");

test("shows each granted item with its art, link, and quantity", () => {
  const html = ScGrantCard.content({
    banner: { img: "icons/harvest.svg", title: "Garden", subtitle: "Harvest order completed" },
    intro: "Beiro received:",
    lines: [{ kind: "item", uuid: "Compendium.x.Item.a", name: "Flawed Mana Crystal", img: "crystal.webp", quantity: 3 }],
    notes: [{ icon: "fa-dice-d20", text: "Check passed (DC 12, rolled 15)." }]
  });

  assert.match(html, /<img class="sc-ma-grant-card-banner-art" src="icons\/harvest.svg"/);
  assert.match(html, /Harvest order completed/);
  assert.match(html, /data-item-uuid="Compendium.x.Item.a"/);
  assert.match(html, /<img src="crystal.webp"/);
  assert.match(html, /@UUID\[Compendium.x.Item.a\]\{Flawed Mana Crystal\}/);
  assert.match(html, /&times;3/);
  assert.match(html, /sc-ma-grant-card-footer/);
});

test("escapes names and shows a table's draws, roll, and empty result", () => {
  const html = ScGrantCard.content({
    banner: { title: "<b>Bag</b>" },
    lines: [{ kind: "table", uuid: "RollTable.t", name: "Loot", draws: 2, formula: "1d2", total: 2, items: [] }],
    emptyText: "No items drawn.",
    drawsText: (count) => `${count} draw(s)`
  });

  assert.match(html, /&lt;b&gt;Bag&lt;\/b&gt;/);
  assert.match(html, /fa-gift/);
  assert.match(html, /2 draw\(s\) · 1d2 = 2/);
  assert.match(html, /No items drawn\./);
  assert.doesNotMatch(html, /sc-ma-grant-card-footer/);
});

test("nested tables are listed as flat groups headed by the path that reached them", () => {
  const amethyst = { kind: "item", uuid: "Item.amethyst", name: "Chipped Amethyst", img: "a.webp", quantity: 1 };
  const html = ScGrantCard.content({
    lines: [{
      kind: "table", uuid: "RollTable.test", name: "test", draws: 1,
      items: [{ kind: "table", uuid: "RollTable.test1", name: "test1", draws: 1, items: [amethyst] }]
    }],
    drawsText: (count) => `${count} draw(s)`
  });

  // The outer table drew only an inner table, once: it has no group of its own.
  const groups = html.match(/<li class="sc-ma-grant-card-table[^"]*"/g);
  assert.deepEqual(groups, ['<li class="sc-ma-grant-card-table is-nested"']);
  assert.match(html, /@UUID\[RollTable.test\]\{test\}<\/span><span class="sc-ma-grant-card-crumb-sep"[^>]*>›<\/span><span class="sc-ma-grant-card-crumb">@UUID\[RollTable.test1\]\{test1\}/);
  assert.match(html, /@UUID\[Item.amethyst\]\{Chipped Amethyst\}/);
  // A single draw without a formula says nothing worth a badge.
  assert.doesNotMatch(html, /draw\(s\)/);
});

test("a table keeps its own group when its draw count was rolled, and lists its own items before inner ones", () => {
  const html = ScGrantCard.content({
    lines: [{
      kind: "table", uuid: "RollTable.loot", name: "Loot", draws: 3, formula: "1d4", total: 3,
      items: [
        { kind: "table", uuid: "RollTable.gems", name: "Gems", draws: 2, items: [] },
        { kind: "item", uuid: "Item.sword", name: "Sword", img: "s.webp", quantity: 1 }
      ]
    }],
    emptyText: "No items drawn.",
    drawsText: (count) => `${count} draw(s)`
  });

  assert.match(html, /3 draw\(s\) · 1d4 = 3/);
  assert.match(html, /2 draw\(s\)/);
  assert.ok(html.indexOf("Item.sword") < html.indexOf("RollTable.gems\]{Gems}</span></span>"));
  assert.match(html, /No items drawn\./);
});
