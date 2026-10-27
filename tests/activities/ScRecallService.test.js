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
const { ScRecallTravel } = await import("../../scripts/activities/recall/ScRecallTravel.js");
const { ScRecallPickerApp } = await import("../../scripts/activities/recall/ScRecallPickerApp.js");

const MODULE = "sc-more-activities";
const player = { id: "player-1", isGM: false, active: true, viewedScene: "field" };
const ally = { id: "player-2", isGM: false, active: true, viewedScene: "field" };
const gm = { id: "gm-1", isGM: true, active: true, viewedScene: "field" };

/** The picker answers with `picker.answer(options)`; by default, travel with whoever starts selected. */
const picker = { calls: [], answer: null };
ScRecallPickerApp.wait = async (options) => {
  picker.calls.push(options);
  return picker.answer
    ? picker.answer(options)
    : { action: "travel", companions: options.companions.filter((entry) => entry.selected).map((entry) => entry.token) };
};

function installHooks() {
  const listeners = new Map();
  let nextId = 0;
  globalThis.Hooks = {
    on(event, fn) {
      nextId += 1;
      if (!listeners.has(event)) listeners.set(event, new Map());
      listeners.get(event).set(nextId, fn);
      return nextId;
    },
    off(event, id) { listeners.get(event)?.delete(id); },
    async callAll(event, ...args) {
      await Promise.all([...(listeners.get(event)?.values() ?? [])].map((fn) => fn(...args)));
    }
  };
}

/** Chat messages whose author is set by the "server"; the GM handles creation hooks. */
function installChatMessages() {
  globalThis.ChatMessage = {
    created: [],
    getSpeaker: ({ actor }) => ({ actor: actor?.id }),
    async create(data, options = {}) {
      const message = {
        id: options.keepId && data._id ? data._id : `message-${this.created.length + 1}`,
        author: game.user,
        content: data.content,
        flags: structuredClone(data.flags ?? {}),
        async update(changes) {
          for (const [key, value] of Object.entries(changes)) {
            if (key === "content") {
              this.content = value;
              continue;
            }
            const path = key.split(".").slice(1);
            let target = this.flags;
            for (const part of path.slice(0, -1)) target = target[part] ??= {};
            target[path.at(-1)] = value;
          }
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

function makeScene(id) {
  const scene = {
    documentName: "Scene",
    id,
    uuid: `Scene.${id}`,
    name: id,
    grid: { size: 100, distance: 5 },
    dimensions: { sceneRect: { x: 0, y: 0, width: 2000, height: 2000 } },
    tokens: new Map(),
    regions: new Map(),
    walls: [],
    isView: false,
    viewed: 0,
    view() { this.viewed += 1; }
  };
  scene.tokens.contents = [];
  return scene;
}

function addToken(scene, id, actor, column, { disposition = 1, hidden = false, flags = {} } = {}) {
  const token = {
    documentName: "Token",
    id,
    name: id,
    x: column * 100,
    y: 0,
    width: 1,
    height: 1,
    disposition,
    hidden,
    flags,
    actor,
    parent: scene,
    get uuid() { return `Scene.${this.parent.id}.Token.${this.id}`; },
    get isOwner() { return actor.testUserPermission(game.user, "OWNER"); },
    toObject() { return { _id: this.id, name: this.name, x: this.x, y: this.y, width: 1, height: 1, disposition, flags, actor }; },
    async move({ x, y }) { this.x = x; this.y = y; this.moved = true; },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        const path = key.split(".");
        let target = this;
        for (const part of path.slice(0, -1)) target = target[part] ??= {};
        target[path.at(-1)] = value;
      }
    },
    async delete(options) { this.deletedWith = options; removeToken(this); }
  };
  token.object = { document: token, actor, name: id, visible: !hidden };
  scene.tokens.set(id, token);
  scene.tokens.contents.push(token);
  documents.set(token.uuid, token);
  return token;
}

function removeToken(token) {
  token.parent.tokens.delete(token.id);
  token.parent.tokens.contents = token.parent.tokens.contents.filter((entry) => entry !== token);
  documents.delete(token.uuid);
}

function makeActor(id, { owners = [], type = "character" } = {}) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type,
    flags: {},
    hasPlayerOwner: owners.length > 0,
    testUserPermission(user, level) { return level === "OWNER" && (user.isGM || owners.includes(user.id)); },
    async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = value; }
  };
  return actor;
}

let documents = new Map();

function setup({ mode = "region", allyRange = 0, allyFilter = "friendly", homeSource = "marked", gmActive = true, user = player } = {}) {
  notices.length = 0;
  picker.calls.length = 0;
  picker.answer = null;
  documents = new Map();
  installHooks();
  installChatMessages();
  ScChatRelay.registerHooks();
  ScRecallTravel.registerHandler();

  const field = makeScene("field");
  const town = makeScene("town");
  const hero = makeActor("hero", { owners: [player.id] });
  const friend = makeActor("friend", { owners: [ally.id] });
  const hireling = makeActor("hireling", { type: "npc" });
  const goblin = makeActor("goblin", { type: "npc" });
  const innkeeper = makeActor("innkeeper", { type: "npc" });

  const heroToken = addToken(field, "hero", hero, 0);
  const friendToken = addToken(field, "friend", friend, 2);
  const hirelingToken = addToken(field, "hireling", hireling, 1);
  const goblinToken = addToken(field, "goblin", goblin, 3, { disposition: -1 });
  const farToken = addToken(field, "far", makeActor("far", { owners: [ally.id] }), 15);
  const innkeeperToken = addToken(town, "innkeeper", innkeeper, 5, { flags: { [MODULE]: { recallPoint: true } } });
  const barkeep = addToken(field, "barkeep", makeActor("barkeep", { type: "npc" }), 1, { disposition: 0 });
  barkeep.y = 100;

  const fieldRegion = { documentName: "Region", id: "glade", uuid: "Scene.field.Region.glade", name: "Glade", parent: field };
  const townRegion = { documentName: "Region", id: "square", uuid: "Scene.town.Region.square", name: "Town Square", parent: town };
  for (const region of [fieldRegion, townRegion]) {
    region.teleported = [];
    region.teleportToken = async (token) => {
      region.teleported.push(token.id);
      if (token.parent === region.parent) {
        return token;
      }
      removeToken(token);
      token.parent = region.parent;
      region.parent.tokens.set(token.id, token);
      region.parent.tokens.contents.push(token);
      return token;
    };
    documents.set(region.uuid, region);
  }

  const activity = {
    uuid: "Actor.hero.Item.scroll.Activity.recall",
    type: "sc-recall",
    actor: hero,
    item: { testUserPermission: (u, level) => hero.testUserPermission(u, level) },
    recall: { mode, regionUuid: townRegion.uuid, homeSource, bindRange: 10, allyRange, allyFilter, rangeShape: "circle" }
  };
  documents.set(activity.uuid, activity);
  hero.getActiveTokens = () => [heroToken];
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  globalThis.canvas = {
    scene: field,
    grid: field.grid,
    tokens: { controlled: [], get: (id) => field.tokens.get(id)?.object }
  };
  field.isView = true;

  const emitted = [];
  let nextId = 0;
  const users = [player, ally, ...(gmActive ? [gm] : [])];
  globalThis.foundry = {
    applications: { api: appApi },
    utils: { randomID: () => `random-${++nextId}` },
    documents: {
      TokenDocument: {
        implementation: {
          async create(data, { parent }) {
            const created = addToken(parent, data._id ?? `copy-${++nextId}`, data.actor, 0, { disposition: data.disposition, flags: data.flags });
            created.x = data.x;
            created.y = data.y;
            return created;
          }
        }
      }
    }
  };
  globalThis.game = {
    user,
    users: Object.assign(users, {
      activeGM: gmActive ? gm : null,
      get: (id) => users.find((entry) => entry.id === id)
    }),
    socket: { emit: (...args) => emitted.push(args) }
  };

  return {
    activity, field, town, hero, heroToken, friendToken, hirelingToken, goblinToken, farToken,
    innkeeperToken, barkeep, fieldRegion, townRegion, emitted
  };
}

const relayOf = (message) => message.flags[MODULE]?.relay;

test("a scroll to a region on the same scene runs on the player's own client", async() => {
  const world = setup();
  world.activity.recall.regionUuid = world.fieldRegion.uuid;

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.action, "travel");
  assert.equal(result.travelled, 1);
  assert.deepEqual(world.fieldRegion.teleported, ["hero"]);
  assert.equal(relayOf(ChatMessage.created[0]), undefined);
  assert.equal(picker.calls[0].destination.label, "Glade (field)");
});

test("travel always asks for confirmation first, and nobody moves if the user cancels", async() => {
  const world = setup();
  picker.answer = () => null;

  const result = await ScRecallService.execute(world.activity);

  assert.equal(picker.calls.length, 1);
  assert.equal(picker.calls[0].destination.label, "Town Square (town)");
  assert.deepEqual(picker.calls[0].companions, []);
  assert.equal(result.reason, "selection-canceled");
  assert.equal(world.heroToken.parent, world.field);
  assert.equal(ChatMessage.created.length, 0);
});

test("a scroll to another scene asks the GM, who moves the token and brings its owner along", async() => {
  const world = setup();

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.travelled, 1);
  assert.equal(result.sceneUuid, "Scene.town");
  assert.deepEqual(world.townRegion.teleported, ["hero"]);
  assert.equal(world.heroToken.parent, world.town);
  assert.equal(ChatMessage.created[0].author, player);
  assert.equal(relayOf(ChatMessage.created[0]).status, "travelled");
  assert.deepEqual(world.emitted, [["pullToScene", "town", player.id]]);
});

test("travel to another scene needs a GM online", async() => {
  const world = setup({ gmActive: false });

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.reason, "no-active-gm");
  assert.equal(world.heroToken.parent, world.field);
});

test("companions within range on the user's side are offered, player characters selected", async() => {
  const world = setup({ allyRange: 10 });

  await ScRecallService.execute(world.activity);

  const offered = picker.calls[0].companions.map((entry) => [entry.token.name, entry.selected]);
  assert.deepEqual(offered, [["hireling", false], ["friend", true]]);
  assert.deepEqual(world.townRegion.teleported, ["hero", "friend"]);
  assert.deepEqual(world.emitted.map(([, , userId]) => userId).sort(), [player.id, ally.id].sort());
});

test("any creature can come along when the activity allows it", async() => {
  const world = setup({ allyRange: 15, allyFilter: "any" });

  await ScRecallService.execute(world.activity);

  assert.deepEqual(picker.calls[0].companions.map((entry) => entry.token.name), ["hireling", "barkeep", "friend", "goblin"]);
});

test("the GM refuses a companion outside the range", async() => {
  const world = setup({ allyRange: 10 });

  const answer = await ScRecallTravel.request({
    actor: world.hero,
    destinationLabel: "",
    data: { activityUuid: world.activity.uuid, travellerUuids: [world.heroToken.uuid, world.farToken.uuid] }
  });

  assert.equal(answer.status, "refused");
  assert.equal(world.farToken.parent, world.field);
});

test("the GM refuses an enemy when only allies may come", async() => {
  const world = setup({ allyRange: 20 });

  const answer = await ScRecallTravel.request({
    actor: world.hero,
    destinationLabel: "",
    data: { activityUuid: world.activity.uuid, travellerUuids: [world.heroToken.uuid, world.goblinToken.uuid] }
  });

  assert.equal(answer.status, "refused");
  assert.deepEqual(world.townRegion.teleported, []);
});

test("the GM refuses a request that does not start with the activity's own token", async() => {
  const world = setup();

  const answer = await ScRecallTravel.request({
    actor: world.hero,
    destinationLabel: "",
    data: { activityUuid: world.activity.uuid, travellerUuids: [world.friendToken.uuid] }
  });

  assert.equal(answer.status, "refused");
  assert.equal(world.friendToken.parent, world.field);
});

test("the GM refuses a player who does not own the activity", async() => {
  const world = setup();
  game.user = ally;

  const answer = await ScRecallTravel.request({
    actor: world.hero,
    destinationLabel: "",
    data: { activityUuid: world.activity.uuid, travellerUuids: [world.heroToken.uuid] }
  });

  assert.equal(answer.status, "refused");
  assert.equal(world.heroToken.parent, world.field);
});

test("a hearthstone without a home and away from any recall point says how to set one", async() => {
  const world = setup({ mode: "home" });

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.reason, "no-home");
  assert.equal(picker.calls.length, 0);
  assert.ok(notices.some(([level]) => level === "warn"));
});

test("next to a recall point the player can bind it as home without a GM", async() => {
  const world = setup({ mode: "home", homeSource: "any", gmActive: false });
  picker.answer = (options) => ({ action: "bind", token: options.bindables.find((entry) => entry.token.name === "barkeep").token });

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.action, "bind");
  assert.deepEqual(picker.calls[0].bindables.map((entry) => entry.token.name), ["hireling", "barkeep"]);
  assert.equal(world.hero.flags[MODULE].recallHome.tokenUuid, world.barkeep.uuid);
});

test("only NPCs the GM marked are recall points unless the activity takes any NPC", async() => {
  const world = setup({ mode: "home" });

  assert.equal(ScRecallTravel.isRecallPoint(world.barkeep, world.activity), false);
  assert.equal(ScRecallTravel.isRecallPoint(world.innkeeperToken, world.activity), true);
  world.activity.recall.homeSource = "any";
  assert.equal(ScRecallTravel.isRecallPoint(world.barkeep, world.activity), true);
  assert.equal(ScRecallTravel.isRecallPoint(world.friendToken, world.activity), false);
});

test("the hearthstone brings the character beside their home NPC on another scene", async() => {
  const world = setup({ mode: "home" });
  world.hero.flags[MODULE] = { recallHome: { tokenUuid: world.innkeeperToken.uuid, name: "innkeeper", sceneName: "town" } };

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.travelled, 1);
  const arrived = world.town.tokens.get("hero");
  assert.ok(arrived, "the hero token was created on the town scene");
  assert.ok(Math.abs(arrived.x - world.innkeeperToken.x) <= 100 && Math.abs(arrived.y - world.innkeeperToken.y) <= 100);
  assert.equal(world.field.tokens.has("hero"), false);
  assert.deepEqual(world.heroToken.deletedWith, { replacements: { hero: arrived.uuid } });
  assert.equal(arrived.flags[MODULE].recallArrival.by, player.id, "marked so the owner's camera follows it");
  assert.deepEqual(world.emitted, [["pullToScene", "town", player.id]]);
});

test("the GM refuses a home that is no longer a recall point", async() => {
  const world = setup({ mode: "home" });
  world.hero.flags[MODULE] = { recallHome: { tokenUuid: world.barkeep.uuid, name: "barkeep", sceneName: "field" } };

  const answer = await ScRecallTravel.request({
    actor: world.hero,
    destinationLabel: "",
    data: { activityUuid: world.activity.uuid, travellerUuids: [world.heroToken.uuid] }
  });

  assert.equal(answer.status, "refused");
  assert.equal(world.heroToken.parent, world.field);
});

test("a GM using the activity travels directly and follows to the new scene", async() => {
  const world = setup({ user: gm });

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.travelled, 1);
  assert.equal(world.town.viewed, 1);
  assert.equal(relayOf(ChatMessage.created[0]), undefined);
  assert.deepEqual(world.emitted, [["pullToScene", "town", player.id]]);
});

test("with a home set, standing beside another recall point offers to bind it, even a huge one", async() => {
  const world = setup({ mode: "home" });
  world.hero.flags[MODULE] = { recallHome: { tokenUuid: world.innkeeperToken.uuid, name: "innkeeper", sceneName: "town" } };
  // A 3x3 dragon touching the hero's corner: its center is about 14 feet away, its edge 5.
  const dragon = addToken(world.field, "dragon", makeActor("dragon", { type: "npc" }), 1, { flags: { [MODULE]: { recallPoint: true } } });
  dragon.y = 100;
  dragon.width = 3;
  dragon.height = 3;
  picker.answer = (options) => ({ action: "bind", token: options.bindables.find((entry) => entry.token.name === "dragon").token });

  const result = await ScRecallService.execute(world.activity);

  assert.equal(picker.calls.length, 1, "the picker opened instead of travelling home");
  assert.ok(picker.calls[0].bindables.some((entry) => entry.token.name === "dragon"));
  assert.equal(result.action, "bind");
  assert.equal(world.hero.flags[MODULE].recallHome.tokenUuid, dragon.uuid);
});

test("only the owners of tokens that arrived are taken to the new scene", async() => {
  const world = setup({ allyRange: 10 });
  const teleport = world.townRegion.teleportToken;
  world.townRegion.teleportToken = async (token) => {
    if (token.id === "friend") {
      throw new Error("No room for the friend.");
    }
    return teleport(token);
  };

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.travelled, 1);
  assert.equal(world.friendToken.parent, world.field, "the friend stayed behind");
  assert.deepEqual(world.emitted, [["pullToScene", "town", player.id]], "the friend's owner is not pulled away");
});

test("the user whose own token could not travel stays where it is", async() => {
  const world = setup({ allyRange: 10 });
  const teleport = world.townRegion.teleportToken;
  world.townRegion.teleportToken = async (token) => {
    if (token.id === "hero") {
      throw new Error("No room for the hero.");
    }
    return teleport(token);
  };

  await ScRecallService.execute(world.activity);

  assert.deepEqual(world.emitted, [["pullToScene", "town", ally.id]]);
});

test("a GM stays on the scene when their own token could not travel, even if a companion did", async() => {
  const world = setup({ user: gm, allyRange: 10 });
  const teleport = world.townRegion.teleportToken;
  world.townRegion.teleportToken = async (token) => {
    if (token.id === "hero") {
      throw new Error("No room for the hero.");
    }
    return teleport(token);
  };

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.travelled, 1);
  assert.equal(world.heroToken.parent, world.field);
  assert.equal(world.town.viewed, 0, "the GM's view did not leave with the companion");
});

test("the GM deletes a spent scroll before the token travels, so an unlinked token cannot carry it across", async() => {
  const world = setup();
  const items = new Map([["scroll", { id: "scroll", flags: { [MODULE]: { spentByUse: true } } }]]);
  world.hero.items = items;
  world.hero.deleteEmbeddedDocuments = async (_type, ids) => ids.forEach((id) => items.delete(id));
  world.activity.item = { ...world.activity.item, id: "scroll", actor: world.hero };
  const teleport = world.townRegion.teleportToken;
  const carried = [];
  world.townRegion.teleportToken = async (token) => {
    carried.push(items.has("scroll"));
    return teleport(token);
  };

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.travelled, 1);
  assert.deepEqual(carried, [false]);
});

test("two recalls of the same token at once move it only once: the later finds it gone", async() => {
  const world = setup({ mode: "home" });
  world.hero.flags[MODULE] = { recallHome: { tokenUuid: world.innkeeperToken.uuid, name: "innkeeper", sceneName: "town" } };
  const data = { activityUuid: world.activity.uuid, travellerUuids: [world.heroToken.uuid] };

  const results = await Promise.all([ScRecallTravel.execute(gm, data), ScRecallTravel.execute(gm, data)]);

  assert.deepEqual(results.map((result) => result.status), ["travelled", "refused"]);
  const heroes = [world.field, world.town].flatMap((scene) => scene.tokens.contents.filter((token) => token.actor === world.hero));
  assert.equal(heroes.length, 1, "one hero, not a copy for each recall");
});

test("a recall that fails does not hold up the next one", async() => {
  const world = setup({ mode: "home" });
  world.hero.flags[MODULE] = { recallHome: { tokenUuid: world.innkeeperToken.uuid, name: "innkeeper", sceneName: "town" } };
  const data = { activityUuid: world.activity.uuid, travellerUuids: [world.heroToken.uuid] };
  const resolve = globalThis.fromUuid;
  globalThis.fromUuid = async () => { throw new Error("lookup failed"); };
  const failed = await ScRecallTravel.execute(gm, data);
  globalThis.fromUuid = resolve;

  assert.equal(failed.status, "refused");
  assert.equal((await ScRecallTravel.execute(gm, data)).status, "travelled");
});

test("binding checks the recall point again once chosen: one that walked out of range is not bound", async() => {
  const world = setup({ mode: "home", homeSource: "any", gmActive: false });
  picker.answer = (options) => {
    const { token } = options.bindables.find((entry) => entry.token.name === "barkeep");
    world.barkeep.x = 2000;
    return { action: "bind", token };
  };

  const result = await ScRecallService.execute(world.activity);

  assert.deepEqual(result, { canceled: true, reason: "bind-out-of-reach" });
  assert.equal(world.hero.flags[MODULE]?.recallHome, undefined);
  assert.ok(notices.some(([level]) => level === "warn"));
});

test("binding refuses a recall point removed, or no longer one, while the window was open", async() => {
  for (const change of [
    (world) => removeToken(world.barkeep),
    (world) => { world.barkeep.actor.hasPlayerOwner = true; }
  ]) {
    const world = setup({ mode: "home", homeSource: "any", gmActive: false });
    picker.answer = (options) => {
      const { token } = options.bindables.find((entry) => entry.token.name === "barkeep");
      change(world);
      return { action: "bind", token };
    };

    const result = await ScRecallService.execute(world.activity);

    assert.equal(result.reason, "bind-out-of-reach");
    assert.equal(world.hero.flags[MODULE]?.recallHome, undefined);
  }
});

test("binding refuses once the user's own token has left the scene", async() => {
  const world = setup({ mode: "home", homeSource: "any", gmActive: false });
  picker.answer = (options) => {
    const { token } = options.bindables.find((entry) => entry.token.name === "barkeep");
    removeToken(world.heroToken);
    return { action: "bind", token };
  };

  const result = await ScRecallService.execute(world.activity);

  assert.equal(result.reason, "bind-out-of-reach");
  assert.equal(world.hero.flags[MODULE]?.recallHome, undefined);
});
