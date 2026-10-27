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
class ApplicationV2 {}
const appApi = { ApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {} };
globalThis.foundry = { applications: { api: appApi } };

const { ScChatRelay } = await import("../../scripts/support/ScChatRelay.js");
const { ScRecallService } = await import("../../scripts/activities/recall/ScRecallService.js");
const { ScRecallPortal } = await import("../../scripts/activities/recall/ScRecallPortal.js");
const { ScRecallPickerApp } = await import("../../scripts/activities/recall/ScRecallPickerApp.js");
const { ScRecallPortalPlacement } = await import("../../scripts/activities/recall/ScRecallPortalPlacement.js");
const { ScRecallTravel } = await import("../../scripts/activities/recall/ScRecallTravel.js");

/** Where the user clicks to open the near side; `null` cancels. Defaults to the hero's own square. */
const placement = { calls: [], point: { x: 550, y: 550 } };
ScRecallPortalPlacement.pick = async (options) => {
  placement.calls.push(options);
  return placement.point;
};

/** The confirmation window: confirms by default, or answers `picker.answer`. */
const picker = { calls: [], answer: { action: "travel", companions: [] } };
ScRecallPickerApp.wait = async (options) => {
  picker.calls.push(options);
  return picker.answer;
};

const MODULE = "sc-more-activities";
const player = { id: "player-1", isGM: false, active: true, viewedScene: "field" };
const ally = { id: "player-2", isGM: false, active: true, viewedScene: "field" };
const gm = { id: "gm-1", isGM: true, active: true, viewedScene: "field" };

let documents = new Map();
let nextId = 0;

function installHooks() {
  const listeners = new Map();
  let hookId = 0;
  globalThis.Hooks = {
    on(event, fn) {
      hookId += 1;
      if (!listeners.has(event)) listeners.set(event, new Map());
      listeners.get(event).set(hookId, fn);
      return hookId;
    },
    off(event, id) { listeners.get(event)?.delete(id); },
    async callAll(event, ...args) {
      await Promise.all([...(listeners.get(event)?.values() ?? [])].map((fn) => fn(...args)));
    }
  };
}

/** Applies `{ "flags.a.b": value }` style changes to a plain document. */
function applyChanges(document, changes) {
  for (const [key, value] of Object.entries(changes)) {
    const path = key.split(".");
    let target = document;
    for (const part of path.slice(0, -1)) target = target[part] ??= {};
    target[path.at(-1)] = structuredClone(value);
  }
}

function installChatMessages() {
  globalThis.ChatMessage = {
    created: [],
    getSpeaker: ({ actor }) => ({ actor: actor?.id }),
    async create(data, options = {}) {
      const message = {
        id: options.keepId && data._id ? data._id : `message-${this.created.length + 1}`,
        author: game.user,
        content: data.content,
        whisper: data.whisper ?? [],
        flags: structuredClone(data.flags ?? {}),
        async update(changes) {
          applyChanges(this, changes);
          await Hooks.callAll("updateChatMessage", this, changes, {}, game.user.id);
        }
      };
      this.created.push(message);
      const creator = game.user;
      game.user = gm;
      try {
        await Hooks.callAll("createChatMessage", message);
      } finally {
        game.user = creator;
      }
      return message;
    }
  };
}

function collection() {
  const map = new Map();
  Object.defineProperty(map, "contents", { get() { return [...map.values()]; } });
  return map;
}

function makeScene(id) {
  const scene = {
    documentName: "Scene",
    id,
    uuid: `Scene.${id}`,
    name: id,
    grid: { size: 100, distance: 5, type: 1 },
    dimensions: { sceneRect: { x: 0, y: 0, width: 3000, height: 3000 } },
    tokens: collection(),
    regions: collection(),
    tiles: collection(),
    walls: [],
    isView: false,
    view() {},
    async createEmbeddedDocuments(type, list) {
      return list.map((data) => (type === "Region" ? addRegion(this, data) : addTile(this, data)));
    },
    async deleteEmbeddedDocuments(type, ids) {
      const store = type === "Region" ? this.regions : this.tiles;
      for (const id of ids) {
        const document = store.get(id);
        if (!document) continue;
        store.delete(id);
        documents.delete(document.uuid);
        if (type === "Region") await Hooks.callAll("deleteRegion", document);
      }
    }
  };
  return scene;
}

function addRegion(scene, data) {
  const region = {
    documentName: "Region",
    id: data._id ?? `region-${++nextId}`,
    parent: scene,
    ...structuredClone(data),
    async update(changes) { applyChanges(this, changes); }
  };
  region.uuid = `Scene.${scene.id}.Region.${region.id}`;
  scene.regions.set(region.id, region);
  documents.set(region.uuid, region);
  return region;
}

function addTile(scene, data) {
  const tile = { id: `tile-${++nextId}`, ...structuredClone(data) };
  scene.tiles.set(tile.id, tile);
  return tile;
}

function addToken(scene, id, actor, column, row = 0, { disposition = 1, flags = {} } = {}) {
  const token = {
    documentName: "Token",
    id,
    name: id,
    x: column * 100,
    y: row * 100,
    width: 1,
    height: 1,
    disposition,
    hidden: false,
    flags,
    actor,
    parent: scene,
    get uuid() { return `Scene.${this.parent.id}.Token.${this.id}`; },
    get isOwner() { return actor.testUserPermission(game.user, "OWNER"); },
    testUserPermission(user, level) { return actor.testUserPermission(user, level); },
    toObject() { return { _id: this.id, name: this.name, x: this.x, y: this.y, width: 1, height: 1, disposition, flags, actor }; },
    async move({ x, y }) { this.x = x; this.y = y; },
    async delete() { removeToken(this); }
  };
  token.object = { document: token, actor, name: id, visible: true };
  scene.tokens.set(id, token);
  documents.set(token.uuid, token);
  return token;
}

function removeToken(token) {
  token.parent.tokens.delete(token.id);
  documents.delete(token.uuid);
}

function makeActor(id, { owners = [], type = "character" } = {}) {
  return {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type,
    flags: {},
    hasPlayerOwner: owners.length > 0,
    testUserPermission(user, level) { return level === "OWNER" && (user.isGM || owners.includes(user.id)); },
    async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = value; }
  };
}

function setup({ mode = "region", portal = {}, allyFilter = "friendly", user = player, worldTime = 0 } = {}) {
  notices.length = 0;
  picker.calls.length = 0;
  picker.answer = { action: "travel", companions: [] };
  placement.calls.length = 0;
  placement.point = { x: 550, y: 550 };
  documents = new Map();
  installHooks();
  installChatMessages();
  ScChatRelay.registerHooks();
  ScRecallPortal.registerHooks();

  const field = makeScene("field");
  const town = makeScene("town");
  const hero = makeActor("hero", { owners: [player.id] });
  const friend = makeActor("friend", { owners: [ally.id] });
  const goblin = makeActor("goblin", { owners: [player.id], type: "npc" });
  const innkeeper = makeActor("innkeeper", { type: "npc" });

  const heroToken = addToken(field, "hero", hero, 5, 5);
  const friendToken = addToken(field, "friend", friend, 6, 5);
  const goblinToken = addToken(field, "goblin", goblin, 5, 6, { disposition: -1 });
  const innkeeperToken = addToken(town, "innkeeper", innkeeper, 20, 20, { flags: { [MODULE]: { recallPoint: true } } });
  hero.flags[MODULE] = { recallHome: { tokenUuid: innkeeperToken.uuid, name: "innkeeper", sceneName: "town" } };

  // A 3x3 square plaza on the town scene, from (10,10) to (13,13).
  const plaza = addRegion(town, { _id: "plaza", name: "Plaza", shapes: [{ type: "rectangle", x: 1000, y: 1000, width: 300, height: 300 }] });

  const activity = {
    uuid: "Actor.hero.Item.scroll.Activity.recall",
    type: "sc-recall",
    name: "Town Portal",
    item: { name: "Scroll of Town Portal", testUserPermission: (u, level) => hero.testUserPermission(u, level) },
    actor: hero,
    recall: { mode, regionUuid: plaza.uuid, homeSource: "marked", bindRange: 10, allyRange: 0, allyFilter, rangeShape: "circle", delivery: "portal" },
    portal: { direction: "both", roundTrip: false, maxUses: "", durationRounds: "10", size: "1", shape: "circle", visibility: "all", color: "#ffb3a7", image: "", ...portal }
  };
  documents.set(activity.uuid, activity);
  hero.getActiveTokens = () => [heroToken];
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;
  globalThis.canvas = { scene: field, grid: field.grid, tokens: { controlled: [], get: (id) => field.tokens.get(id)?.object } };

  const emitted = [];
  const users = [player, ally, gm];
  globalThis.foundry = {
    applications: { api: appApi },
    utils: { randomID: () => `id${String(++nextId).padStart(14, "0")}` },
    documents: {
      TokenDocument: {
        implementation: {
          async create(data, { parent }) {
            const id = data._id ?? `token-${++nextId}`;
            const created = addToken(parent, id, data.actor, 0, 0, { disposition: data.disposition, flags: data.flags });
            created.x = data.x;
            created.y = data.y;
            return created;
          }
        }
      }
    }
  };
  globalThis.CONFIG = { time: { roundTime: 6 } };
  globalThis.game = {
    user,
    time: { worldTime },
    combat: null,
    combats: { get: () => null },
    scenes: [field, town],
    users: Object.assign(users, { activeGM: gm, get: (id) => users.find((entry) => entry.id === id) }),
    socket: { emit: (...args) => emitted.push(args) }
  };

  return { activity, field, town, hero, heroToken, friendToken, goblinToken, innkeeperToken, plaza, emitted };
}

const portalOf = (region) => region.flags[MODULE].recallPortal;
const sides = (scene) => scene.regions.contents.filter((region) => region.flags?.[MODULE]?.recallPortal);

async function openPortal(world) {
  const result = await ScRecallService.execute(world.activity);
  assert.equal(result.action, "portal");
  const [entry] = sides(world.field);
  const [exit] = sides(world.town);
  return { entry, exit };
}

test("using the scroll opens a pair of portals: one at the user, one in the destination region", async() => {
  const world = setup();

  const { entry, exit } = await openPortal(world);

  assert.deepEqual(portalOf(entry).center, { x: 550, y: 550 });
  assert.deepEqual(portalOf(exit).center, { x: 1150, y: 1150 });
  assert.equal(portalOf(entry).partnerUuid, exit.uuid);
  assert.equal(portalOf(exit).partnerUuid, entry.uuid);
  assert.equal(portalOf(entry).label, "Scroll of Town Portal");
  assert.equal(world.heroToken.parent, world.field, "opening a portal moves nobody");
  assert.equal(ChatMessage.created[0].flags[MODULE].relay.status, "opened");
});

test("a home stone portal opens its far side beside the home NPC", async() => {
  const world = setup({ mode: "home" });

  const { exit } = await openPortal(world);

  const { x, y } = portalOf(exit).center;
  assert.ok(Math.abs(x - 2050) <= 100 && Math.abs(y - 2050) <= 100, JSON.stringify({ x, y }));
  assert.notDeepEqual({ x, y }, { x: 2050, y: 2050 });
});

test("crossing takes the token to the other side, beside the portal, and brings its owner along", async() => {
  const world = setup({ portal: { maxUses: "3" } });
  const { entry, exit } = await openPortal(world);

  const result = await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  assert.equal(result.status, "crossed");
  const arrived = world.town.tokens.get("hero");
  assert.ok(arrived);
  assert.ok(Math.abs(arrived.x + 50 - 1150) <= 100 && Math.abs(arrived.y + 50 - 1150) <= 100);
  assert.notDeepEqual({ x: arrived.x, y: arrived.y }, { x: 1100, y: 1100 }, "lands beside the portal, not on it");
  assert.equal(portalOf(entry).usesLeft, 2);
  assert.equal(portalOf(exit).usesLeft, 2);
  assert.deepEqual(world.emitted, [["pullToScene", "town", player.id]]);
  assert.deepEqual(ChatMessage.created.at(-1).whisper, [gm.id]);
});

test("a both-ways portal lets the token come back", async() => {
  const world = setup();
  const { entry, exit } = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  const back = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: world.town.tokens.get("hero").uuid });

  assert.equal(back.status, "crossed");
  assert.ok(world.field.tokens.get("hero"));
});

test("a one-way portal refuses crossings from the destination side", async() => {
  const world = setup({ portal: { direction: "oneWay" } });
  const { entry, exit } = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  const back = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: world.town.tokens.get("hero").uuid });

  assert.deepEqual(back, { status: "refused", reason: "one-way" });
});

test("go and return once: each creature crosses out once and back once, and only after going", async() => {
  const world = setup({ portal: { roundTrip: true, closeOnReturn: false } });
  const { entry, exit } = await openPortal(world);

  assert.equal((await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid })).status, "crossed");
  assert.equal((await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: world.town.tokens.get("hero").uuid })).status, "crossed");
  const again = await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.field.tokens.get("hero").uuid });
  assert.deepEqual(again, { status: "refused", reason: "used" });

  // Someone already on the far side, who never went through, cannot use the way back.
  const stranger = addToken(world.town, "stranger", world.hero, 12, 11);
  const sneak = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: stranger.uuid });
  assert.deepEqual(sneak, { status: "refused", reason: "used" });
});

test("the last allowed crossing closes both sides and their art", async() => {
  const world = setup({ portal: { maxUses: "1", image: "portal.webm" } });
  await openPortal(world);
  assert.equal(world.field.tiles.size + world.town.tiles.size, 2);

  const [entry] = sides(world.field);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  assert.equal(sides(world.field).length + sides(world.town).length, 0);
  assert.equal(world.field.tiles.size + world.town.tiles.size, 0);
});

test("only the opener's allies may cross unless the activity lets anyone through", async() => {
  const world = setup();
  const { entry } = await openPortal(world);

  const enemy = await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.goblinToken.uuid });

  assert.deepEqual(enemy, { status: "refused", reason: "not-allowed" });
  assert.equal(world.goblinToken.parent, world.field);
});

test("a token that walked away from the portal cannot cross", async() => {
  const world = setup();
  const { entry } = await openPortal(world);
  world.heroToken.x = 1500;

  const result = await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  assert.deepEqual(result, { status: "refused", reason: "moved" });
});

test("a player cannot send another player's token through", async() => {
  const world = setup();
  const { entry } = await openPortal(world);

  const result = await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.friendToken.uuid });

  assert.deepEqual(result, { status: "refused", reason: "refused" });
  assert.equal(world.friendToken.parent, world.field);
});

test("an expired portal closes instead of letting anyone through", async() => {
  const world = setup();
  const { entry } = await openPortal(world);
  game.time.worldTime = 61;

  const result = await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  assert.deepEqual(result, { status: "refused", reason: "gone" });
  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("the GM sweeps expired portals from every scene", async() => {
  const world = setup({ user: gm });
  await openPortal(world);
  game.time.worldTime = 61;

  await ScRecallPortal.sweepExpired();

  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("deleting one side closes the other", async() => {
  const world = setup({ user: gm });
  const { entry } = await openPortal(world);

  await world.field.deleteEmbeddedDocuments("Region", [entry.id]);

  assert.equal(sides(world.town).length, 0);
});

test("the GM refuses to open a portal for a player who does not own the activity", async() => {
  const world = setup({ user: ally });

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.reason, "refused");
  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("the user confirms the destination before the portal opens", async() => {
  const world = setup();
  picker.answer = null;

  const result = await ScRecallService.execute(world.activity);

  assert.equal(picker.calls[0].portal, true);
  assert.equal(picker.calls[0].destination.label, "Plaza (town)");
  assert.equal(result.reason, "selection-canceled");
  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("the user picks where the near side opens, within the opening range", async() => {
  const world = setup({ portal: { placementRange: "15" } });
  placement.point = { x: 750, y: 550 };

  const { entry } = await openPortal(world);

  assert.equal(placement.calls[0].range, 15);
  assert.deepEqual(portalOf(entry).center, { x: 750, y: 550 });
});

test("canceling the placement opens nothing", async() => {
  const world = setup();
  placement.point = null;

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.reason, "placement-canceled");
  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("the GM refuses a near side placed out of range", async() => {
  const world = setup({ portal: { placementRange: "15" } });

  const result = await ScRecallPortal.open(world.activity, world.hero, world.heroToken.object, "", { x: 2950, y: 550 });

  assert.equal(result.status, "refused");
  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("each side names where it leads", async() => {
  const world = setup();

  const { entry, exit } = await openPortal(world);

  assert.equal(portalOf(entry).leadsTo, "Plaza (town)");
  assert.equal(portalOf(exit).leadsTo, "field");
  assert.equal(entry.name, "Scroll of Town Portal → Plaza (town)");
  assert.equal(exit.name, "Scroll of Town Portal → field");
});

test("a portal spot must be on the scene and within range", () => {
  const scene = { grid: { size: 100, distance: 5 }, dimensions: { sceneRect: { x: 0, y: 0, width: 1000, height: 1000 } } };
  const originCenter = { x: 550, y: 550 };
  const issue = (point, range = 15) => ScRecallPortalPlacement.issueFor({ point, originCenter, range, rangeShape: "circle", scene });

  assert.equal(issue({ x: 750, y: 550 }), null);
  assert.equal(issue({ x: 950, y: 550 }), "range");
  assert.equal(issue({ x: 950, y: 550 }, 0), null);
  assert.equal(issue({ x: 1050, y: 550 }, 0), "bounds");
  assert.equal(issue(null), "invalid");
});

test("each use opens its own pair: portals to the same region sit side by side, each leading to its own origin", async() => {
  const world = setup({ portal: { placementRange: "0" } });
  const first = await openPortal(world);
  placement.point = { x: 850, y: 550 };
  await ScRecallService.execute(world.activity);

  const exits = sides(world.town);
  assert.equal(exits.length, 2);
  const [a, b] = exits.map(portalOf);
  assert.notDeepEqual(a.center, b.center, "the second portal is not stacked on the first");
  for (const portal of [a, b]) {
    assert.ok(portal.center.x - 50 >= 1000 && portal.center.x + 50 <= 1300, "inside the plaza");
    assert.ok(portal.center.y - 50 >= 1000 && portal.center.y + 50 <= 1300, "inside the plaza");
  }

  const second = sides(world.field).find((entry) => entry !== first.entry);
  assert.equal(portalOf(first.exit).partnerUuid, first.entry.uuid);
  assert.equal(portalOf(exits.find((exit) => exit !== first.exit)).partnerUuid, second.uuid);
});

test("crossing back through each destination portal returns to the spot it was opened from", async() => {
  const world = setup({ portal: { placementRange: "0" } });
  const first = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: first.entry.uuid, tokenUuid: world.heroToken.uuid });
  const hero = world.town.tokens.get("hero");

  const back = await ScRecallPortal.cross({ regionUuid: first.exit.uuid, tokenUuid: hero.uuid });

  assert.equal(back.status, "crossed");
  const returned = world.field.tokens.get("hero");
  assert.ok(Math.abs(returned.x + 50 - 550) <= 100 && Math.abs(returned.y + 50 - 550) <= 100, "beside the first entry");
});

test("a second home stone portal beside the same NPC does not cover the first", async() => {
  const world = setup({ mode: "home" });
  await openPortal(world);
  placement.point = { x: 750, y: 550 };
  await ScRecallService.execute(world.activity);

  const [a, b] = sides(world.town).map(portalOf);
  assert.ok(Math.abs(a.center.x - b.center.x) >= 100 || Math.abs(a.center.y - b.center.y) >= 100);
});

test("the portal closes on both sides once the creature that opened it comes back", async() => {
  const world = setup();
  const { entry, exit } = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });
  assert.equal(sides(world.field).length + sides(world.town).length, 2, "going out leaves it open");

  const back = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: world.town.tokens.get("hero").uuid });

  assert.equal(back.status, "crossed");
  assert.ok(world.field.tokens.get("hero"), "the opener made it home first");
  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("companions may go and come back without closing the portal", async() => {
  const world = setup();
  const squire = addToken(world.field, "squire", makeActor("squire", { owners: [player.id] }), 6, 6);
  const { entry, exit } = await openPortal(world);

  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: squire.uuid });
  await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: world.town.tokens.get("squire").uuid });

  assert.ok(world.field.tokens.get("squire"));
  assert.equal(sides(world.field).length + sides(world.town).length, 2);
});

test("with the option off, the opener's return leaves the portal open", async() => {
  const world = setup({ portal: { closeOnReturn: false } });
  const { entry, exit } = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: world.town.tokens.get("hero").uuid });

  assert.equal(sides(world.field).length + sides(world.town).length, 2);
});

test("a one-way portal never waits for its opener", async() => {
  const world = setup({ portal: { direction: "oneWay" } });

  const { entry } = await openPortal(world);

  assert.equal(portalOf(entry).closeOnReturn, false);
});

test("crossings in opposite directions share one queue, so neither loses the other's use", async() => {
  const world = setup({ portal: { maxUses: "2", closeOnReturn: false } });
  const { entry, exit } = await openPortal(world);
  // Someone already standing at the far side, stepping in at the same moment as the hero.
  const scout = addToken(world.town, "scout", makeActor("scout", { owners: [player.id] }), 10, 11);
  assert.ok(Math.abs(portalOf(exit).center.x - 1150) <= 100);

  const results = await Promise.all([
    ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid }),
    ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: scout.uuid })
  ]);

  assert.deepEqual(results.map((result) => result.status), ["crossed", "crossed"]);
  assert.equal(sides(world.field).length + sides(world.town).length, 0, "both uses were counted, so the portal closed");
});

test("portals opened at the same moment to the same region do not stack", async() => {
  const world = setup({ user: gm, portal: { placementRange: "0" } });

  await Promise.all([
    ScRecallPortal.open(world.activity, world.hero, world.heroToken, "Plaza", { x: 550, y: 550 }),
    ScRecallPortal.open(world.activity, world.hero, world.heroToken, "Plaza", { x: 850, y: 550 })
  ]);

  const [a, b] = sides(world.town).map(portalOf);
  assert.ok(a && b, "both portals opened");
  assert.ok(Math.abs(a.center.x - b.center.x) >= 100 || Math.abs(a.center.y - b.center.y) >= 100);
});

test("the opener still closes the portal on return after taking a new id at the destination", async() => {
  const world = setup();
  // An unrelated token on the destination scene already holds the hero's id.
  addToken(world.town, "hero", makeActor("statue", { type: "npc" }), 25, 25);
  const { entry, exit } = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });
  const traveller = world.town.tokens.contents.find((token) => token.actor === world.hero);
  assert.notEqual(traveller.id, "hero", "the hero arrived under a new id");
  assert.equal(portalOf(exit).openerTokenUuid, traveller.uuid);

  const back = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: traveller.uuid });

  assert.equal(back.status, "crossed");
  assert.equal(sides(world.field).length + sides(world.town).length, 0);
});

test("the statue holding the opener's old id cannot close the portal", async() => {
  const world = setup({ portal: { closeOnReturn: true } });
  const statue = addToken(world.town, "hero", makeActor("statue", { owners: [player.id] }), 11, 12);
  const { entry, exit } = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });

  await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: statue.uuid });

  assert.equal(sides(world.field).length + sides(world.town).length, 2);
});

test("a token on the destination scene sharing the opener's id cannot close the portal before the opener crosses", async() => {
  const world = setup();
  const statue = addToken(world.town, "hero", makeActor("statue", { owners: [player.id] }), 11, 12);
  const { exit } = await openPortal(world);

  const back = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: statue.uuid });

  assert.equal(back.status, "crossed");
  assert.equal(world.heroToken.parent, world.field, "the opener never left");
  assert.equal(sides(world.field).length + sides(world.town).length, 2);
});

test("the same token sent through two portals at once crosses only one of them", async() => {
  const world = setup({ portal: { placementRange: "0" } });
  const first = await openPortal(world);
  placement.point = { x: 650, y: 550 };
  await ScRecallService.execute(world.activity);
  const second = sides(world.field).find((entry) => entry !== first.entry);

  const results = await Promise.all([
    ScRecallPortal.cross({ regionUuid: first.entry.uuid, tokenUuid: world.heroToken.uuid }),
    ScRecallPortal.cross({ regionUuid: second.uuid, tokenUuid: world.heroToken.uuid })
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ["crossed", "refused"]);
  assert.equal(results.find((result) => result.status === "refused").reason, "moved");
  const heroes = [world.field, world.town].flatMap((scene) => scene.tokens.contents.filter((token) => token.actor === world.hero));
  assert.equal(heroes.length, 1, "one hero, not a copy on each side");
});

test("after a round trip that changed the traveller's id, a stranger holding its old id cannot come back", async() => {
  const world = setup({ portal: { roundTrip: true, closeOnReturn: false } });
  const { entry, exit } = await openPortal(world);
  assert.equal((await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid })).status, "crossed");
  // While the hero is away, something else takes its id at home, so it comes back under a new one.
  addToken(world.field, "hero", makeActor("statue", { type: "npc" }), 25, 25);
  const away = world.town.tokens.get("hero");
  assert.equal((await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: away.uuid })).status, "crossed");
  const home = world.field.tokens.contents.find((token) => token.actor === world.hero);
  assert.notEqual(home.id, "hero");

  // A stranger now standing at the far side under the hero's old id never went through.
  const stranger = addToken(world.town, "hero", makeActor("stranger", { owners: [player.id] }), 12, 11);
  const sneak = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: stranger.uuid });

  assert.deepEqual(sneak, { status: "refused", reason: "used" });
  assert.deepEqual(portalOf(entry).crossings, [{ tokenUuid: home.uuid, actorId: "hero", out: true, back: true }],
    "one record, following the hero to where it landed");
});

test("a token holding a traveller's uuid with another actor does not inherit its crossing", async() => {
  const world = setup({ portal: { roundTrip: true, closeOnReturn: false } });
  const { entry, exit } = await openPortal(world);
  await ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid });
  // The hero leaves the far side some other way, and an unrelated token comes to hold its uuid.
  removeToken(world.town.tokens.get("hero"));
  const impostor = addToken(world.town, "hero", makeActor("impostor", { owners: [player.id] }), 12, 11);

  const sneak = await ScRecallPortal.cross({ regionUuid: exit.uuid, tokenUuid: impostor.uuid });

  assert.deepEqual(sneak, { status: "refused", reason: "used" });
});

test("a token recalled and sent through a portal at once goes only one way", async() => {
  const world = setup({ mode: "home" });
  const { entry } = await openPortal(world);
  const data = { activityUuid: world.activity.uuid, travellerUuids: [world.heroToken.uuid] };

  const [travel, crossing] = await Promise.all([
    ScRecallTravel.execute(gm, data),
    ScRecallPortal.cross({ regionUuid: entry.uuid, tokenUuid: world.heroToken.uuid })
  ]);

  assert.deepEqual([travel.status, crossing.status].sort(), ["refused", "travelled"]);
  const heroes = [world.field, world.town].flatMap((scene) => scene.tokens.contents.filter((token) => token.actor === world.hero));
  assert.equal(heroes.length, 1, "one hero, not a copy on each side");
});

/** Evaluates sums with `@scaling`, as a Roll on the item's roll data would. */
class ScalingRoll {
  constructor(formula, data) { this.formula = formula; this.data = data; }
  evaluateSync() {
    this.total = String(this.formula).split("+")
      .reduce((sum, part) => sum + (part.trim() === "@scaling" ? Number(this.data?.scaling ?? 0) : Number(part)), 0);
  }
}

/** The activity as dnd5e hands it to a use scaled by `scaling`: on a clone of its item carrying the flag. */
function scaledUse(activity, scaling) {
  activity.item.clone = (changes) => {
    const level = changes["flags.dnd5e.scaling"];
    const item = { ...activity.item, flags: { dnd5e: { scaling: level } }, getRollData: () => ({ scaling: level }) };
    const scaled = { ...activity, item };
    item.system = { activities: { get: () => scaled } };
    return item;
  };
  return activity.item.clone({ "flags.dnd5e.scaling": scaling }).system.activities.get(activity.id);
}

for (const user of [player, gm]) {
  test(`a portal opened by a scaled use keeps its scaled uses and duration (${user.isGM ? "GM" : "player"})`, async(t) => {
    globalThis.Roll = ScalingRoll;
    t.after(() => { delete globalThis.Roll; });
    const world = setup({ user, portal: { maxUses: "1 + @scaling", durationRounds: "10 + @scaling" } });

    const result = await ScRecallService.execute(scaledUse(world.activity, 2));

    assert.equal(result.action, "portal");
    const [entry] = sides(world.field);
    assert.equal(portalOf(entry).usesLeft, 3, "1 + 2, not the stored activity's 1");
    assert.equal(portalOf(entry).expiresAtWorldTime, 12 * 6);
  });
}
