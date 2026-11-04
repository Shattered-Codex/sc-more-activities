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
