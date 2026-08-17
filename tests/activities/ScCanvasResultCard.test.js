import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasResultCard } = await import("../../scripts/activities/canvas/ScCanvasResultCard.js");

function installGlobals(t) {
  const created = [];
  globalThis.game = {
    i18n: {
      localize: (key) => key,
      format: (key) => key
    }
  };
  globalThis.ChatMessage = {
    getSpeaker: (data) => data,
    async create(data) {
      created.push(data);
      return data;
    }
  };

  t.after(() => {
    delete globalThis.game;
    delete globalThis.ChatMessage;
  });

  return created;
}

const activity = {
  id: "activity-1",
  name: "Shove",
  item: { name: "Gust Staff" }
};

test("the movement card lists moved and resisted targets with images", async(t) => {
  const created = installGlobals(t);

  const card = await ScCanvasResultCard.createMovementCard(activity, {
    affected: [
      { name: "Goblin A", img: "tokens/goblin-a.webp" },
      { name: "Goblin C", img: "tokens/goblin-c.webp" }
    ],
    resisted: [{ name: "Goblin B", img: "tokens/goblin-b.webp" }]
  });
  assert.ok(card);
  assert.equal(created.length, 1);
  const content = created[0].content;
  assert.match(content, /chat-card sc-ma-canvas-card/);
  assert.match(content, /Gust Staff/);
  assert.match(content, /Shove — Movement Result/);
  assert.match(content, /Moved/);
  assert.match(content, /Goblin A/);
  assert.match(content, /tokens\/goblin-a\.webp/);
  assert.match(content, /Resisted/);
  assert.match(content, /tokens\/goblin-b\.webp/);
  assert.match(content, /class="gold-icon"/);
  assert.equal(created[0].flags["sc-more-activities"].activityType, "sc-movement");
});

test("plain string entries render without an image", async(t) => {
  const created = installGlobals(t);

  await ScCanvasResultCard.createMovementCard(activity, {
    affected: [{ name: "Goblin", img: "tokens/goblin.webp" }],
    skipped: ["Orc"]
  });
  const content = created[0].content;
  assert.match(content, /Out of range/);
  assert.match(content, /Orc/);
});

test("an all-resisted card shows the none-affected note and no moved row", async(t) => {
  const created = installGlobals(t);

  await ScCanvasResultCard.createTeleportCard(activity, {
    affected: [],
    resisted: [{ name: "Guard", img: "" }]
  });
  const content = created[0].content;
  assert.match(content, /Every target resisted/);
  assert.doesNotMatch(content, /Card\.Teleported/);
  assert.match(content, /Teleport Result/);
});

test("out-of-range or unfinished targets never claim that everyone resisted", async(t) => {
  const created = installGlobals(t);

  await ScCanvasResultCard.createMovementCard(activity, {
    affected: [],
    skipped: ["Orc"],
    unresolved: [{ name: "Guard" }]
  });
  const content = created[0].content;
  assert.doesNotMatch(content, /Every target resisted/);
  assert.match(content, /Orc/);
  assert.match(content, /Guard/);
});

test("a card with no rows is not created", async(t) => {
  const created = installGlobals(t);

  const card = await ScCanvasResultCard.createMovementCard(activity, {});
  assert.equal(card, null);
  assert.equal(created.length, 0);
});

test("token names and images are HTML-escaped", async(t) => {
  const created = installGlobals(t);

  await ScCanvasResultCard.createMovementCard(activity, {
    affected: [{ name: "<img src=x onerror=alert(1)>", img: "\" onerror=\"alert(1)" }]
  });
  const content = created[0].content;
  assert.doesNotMatch(content, /<img src=x/);
  assert.match(content, /&lt;img/);
  assert.doesNotMatch(content, /onerror="alert/);
});

test("affectedEntries removes each skipped name once", () => {
  const moved = ScCanvasResultCard.affectedEntries(
    [{ name: "Goblin" }, { name: "Goblin" }, { name: "Orc" }],
    ["Goblin"]
  );
  assert.deepEqual(moved.map((entry) => entry.name), ["Goblin", "Orc"]);
});

test("tokenEntry follows the token texture and actor image chain", () => {
  const fromTexture = ScCanvasResultCard.tokenEntry({
    id: "t1",
    name: "Goblin",
    texture: { src: "tokens/goblin.webp" },
    actor: { id: "a1", img: "actors/goblin.webp" }
  });
  assert.equal(fromTexture.img, "tokens/goblin.webp");
  assert.equal(fromTexture.actorId, "a1");

  const fromActor = ScCanvasResultCard.tokenEntry({
    id: "t2",
    name: "Orc",
    actor: { img: "actors/orc.webp" }
  });
  assert.equal(fromActor.img, "actors/orc.webp");
});

test("no card is created when the module setting disables result cards", async(t) => {
  const created = installGlobals(t);
  globalThis.game.settings = {
    settings: new Map([["sc-more-activities.canvasResultCards", {}]]),
    get: () => false
  };

  const card = await ScCanvasResultCard.createMovementCard(activity, {
    affected: [{ name: "Goblin" }]
  });
  assert.equal(card, null);
  assert.equal(created.length, 0);
});

test("card creation failures never throw", async(t) => {
  installGlobals(t);
  globalThis.ChatMessage = {
    getSpeaker: (data) => data,
    async create() {
      throw new Error("no permission");
    }
  };

  const card = await ScCanvasResultCard.createMovementCard(activity, {
    affected: [{ name: "Goblin" }]
  });
  assert.equal(card, null);
});
