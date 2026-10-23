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
// The picker window only needs these to load; the tests replace its `wait`.
class ApplicationV2 {}
globalThis.foundry = {
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {} } }
};

const { ScIdentifyActivityService } = await import("../../scripts/activities/identify/ScIdentifyActivityService.js");
const { ScIdentifyPickerApp } = await import("../../scripts/activities/identify/ScIdentifyPickerApp.js");
const { ScIdentifyRelay } = await import("../../scripts/activities/identify/ScIdentifyRelay.js");

const FLAG_SCOPE = "sc-more-activities";
const player = { id: "player-1", isGM: false, active: true };
const gm = { id: "gm-1", isGM: true, active: true };

/** Picks `itemId` from the candidate named `actorId` (the first one by default). */
const picker = { calls: [], actorId: null, itemId: null };
ScIdentifyPickerApp.wait = async (options) => {
  picker.calls.push(options);
  if (!picker.itemId) {
    return null;
  }
  const candidate = options.candidates.find((entry) => !picker.actorId || entry.actor.id === picker.actorId);
  const item = candidate?.items.find((entry) => entry.id === picker.itemId);
  return item ? { candidate, item } : null;
};

/** Hooks with only what the relay uses. */
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

/**
 * Chat messages as the server creates them: the author is always the user
 * who created it. Creating one runs the GM's `createChatMessage` listeners on
 * the GM's client before the creator gets the message back.
 */
function installChatMessages() {
  const messages = new Map();
  globalThis.ChatMessage = {
    created: [],
    getSpeaker: ({ actor }) => ({ actor: actor?.id }),
    async create(data, options = {}) {
      const message = {
        id: options.keepId && data._id ? data._id : `message-${messages.size + 1}`,
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
      messages.set(message.id, message);
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
  return messages;
}

function makeItem(actorId, id, { identified = false, rarity = "", rarities } = {}) {
  return {
    id,
    uuid: `Actor.${actorId}.Item.${id}`,
    name: id,
    img: "",
    system: { identified, rarity, ...(rarities ? { rarities: new Set(rarities) } : {}) },
    async update(changes) {
      this.system.identified = changes["system.identified"];
    }
  };
}

function makeActor(id, { ownedBy = [], rollTotal = 20, rolls = [] } = {}) {
  return {
    id,
    uuid: `Actor.${id}`,
    name: id,
    items: [
      makeItem(id, "ring", { rarity: "rare" }),
      makeItem(id, "relic", { rarity: "mythic" }),
      makeItem(id, "rope"),
      makeItem(id, "sword", { identified: true, rarity: "uncommon" })
    ],
    get isOwner() { return globalThis.game.user.isGM || ownedBy.includes(globalThis.game.user.id); },
    testUserPermission(user, level) { return level === "OWNER" && (user.isGM || ownedBy.includes(user.id)); },
    async rollSkill(config, dialog) {
      rolls.push({ ...config, dialog, by: globalThis.game.user.id });
      return [{ total: rollTotal }];
    },
    async rollAbilityCheck(config, dialog) {
      rolls.push({ ...config, dialog, by: globalThis.game.user.id });
      return [{ total: rollTotal }];
    }
  };
}

/** A token at grid column `column`; one 100px square is 5 feet. */
function makeToken(scene, id, actor, column, { hidden = false } = {}) {
  const document = {
    documentName: "Token",
    id,
    uuid: `Scene.s1.Token.${id}`,
    name: id,
    x: column * 100,
    y: 0,
    width: 1,
    height: 1,
    hidden,
    parent: scene,
    actor
  };
  document.object = { document, actor, name: id, visible: !hidden };
  return document;
}

function setup({
  recipient = "self",
  check = { ability: "int", skill: "arc" },
  rollTotal = 20,
  itemId = "ring",
  actorId = null,
  range = 30,
  gmActive = true
} = {}) {
  notices.length = 0;
  picker.calls.length = 0;
  picker.itemId = itemId;
  picker.actorId = actorId;
  // Other test files replace `foundry` in the shared process.
  let nextId = 0;
  globalThis.foundry = {
    applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {} } },
    utils: { randomID: () => `random-${++nextId}` }
  };
  installHooks();
  const messages = installChatMessages();
  ScIdentifyRelay.registerHooks();

  const rolls = [];
  const actor = makeActor("hero", { ownedBy: [player.id], rollTotal, rolls });
  const ally = makeActor("ally", { ownedBy: ["player-2"] });
  const far = makeActor("far", { ownedBy: ["player-2"] });
  const lurker = makeActor("lurker");

  const scene = { id: "s1", grid: { size: 100, distance: 5 } };
  const heroToken = makeToken(scene, "hero", actor, 0);
  const allyToken = makeToken(scene, "ally", ally, 2);
  const farToken = makeToken(scene, "far", far, 10);
  const lurkerToken = makeToken(scene, "lurker", lurker, 1, { hidden: true });
  const tokens = [heroToken, allyToken, farToken, lurkerToken];
  scene.tokens = new Map(tokens.map((token) => [token.id, token]));
  scene.tokens.contents = tokens;
  actor.getActiveTokens = () => [heroToken];
  globalThis.canvas = { scene, grid: scene.grid, tokens: { controlled: [], get: (id) => scene.tokens.get(id)?.object } };

  const activity = {
    uuid: "Actor.hero.Item.wand.Activity.identify",
    type: "sc-identify",
    recipient,
    actor,
    item: { testUserPermission: (user, level) => actor.testUserPermission(user, level) },
    check,
    identify: {
      range,
      rangeShape: "circle",
      dcMode: "rarity",
      dcFormula: "",
      defaultDc: 10,
      rarityDcs: { common: 10, uncommon: 13, rare: 16, veryRare: 19, legendary: 22, artifact: 25, mythic: 28 }
    }
  };
  const documents = new Map([[activity.uuid, activity], ...tokens.map((token) => [token.uuid, token]), [ally.uuid, ally]]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const users = [player, { id: "player-2", isGM: false }, ...(gmActive ? [gm] : [])];
  globalThis.game = {
    user: player,
    messages,
    users: {
      activeGM: gmActive ? gm : null,
      get: (id) => users.find((user) => user.id === id),
      find: (predicate) => users.find(predicate)
    }
  };
  player.targets = new Set(recipient === "target" ? [allyToken.object] : []);

  return { actor, ally, far, activity, rolls, heroToken, allyToken, farToken };
}

/** Posts a request as `author` would, bypassing the user's own client checks. */
async function postRequest(request, author = player) {
  game.user = author;
  try {
    return await ChatMessage.create({
      content: "",
      flags: { [FLAG_SCOPE]: { identifyRequest: { status: "pending", ...request } } }
    });
  } finally {
    game.user = player;
  }
}

const statusOf = (message) => message.flags[FLAG_SCOPE].identifyRequest.status;
const item = (actor, id) => actor.items.find((entry) => entry.id === id);
const identifiedIds = (actor) => actor.items.filter((entry) => entry.system.identified).map((entry) => entry.id);
const pickerNames = () => picker.calls[0].candidates.map((candidate) => candidate.actor.id);

test("the DC comes from the item's rarity, including custom rarities", () => {
  const { activity } = setup();

  assert.equal(ScIdentifyActivityService.dcForItem(activity, makeItem("a", "a", { rarity: "rare" })), 16);
  assert.equal(ScIdentifyActivityService.dcForItem(activity, makeItem("a", "b", { rarity: "mythic" })), 28);
});

test("items without a rarity, or with a rarity left blank, use the default DC", () => {
  const { activity } = setup();
  activity.identify.defaultDc = 12;
  activity.identify.rarityDcs.legendary = null;

  assert.equal(ScIdentifyActivityService.dcForItem(activity, makeItem("a", "a")), 12);
  assert.equal(ScIdentifyActivityService.dcForItem(activity, makeItem("a", "b", { rarity: "legendary" })), 12);
  assert.equal(ScIdentifyActivityService.dcForItem(activity, makeItem("a", "c", { rarity: "unknown" })), 12);
});

test("an item with several rarities uses the hardest DC", () => {
  const { activity } = setup();

  const varies = makeItem("a", "a", { rarity: "uncommon", rarities: ["uncommon", "veryRare"] });

  assert.equal(ScIdentifyActivityService.dcForItem(activity, varies), 19);
});

test("a custom formula sets the same DC for every item and falls back to the default DC", () => {
  const { activity } = setup();
  activity.identify.dcMode = "formula";
  activity.identify.dcFormula = "14";

  assert.equal(ScIdentifyActivityService.dcForItem(activity, makeItem("a", "a", { rarity: "mythic" })), 14);

  activity.identify.dcFormula = "";
  activity.identify.defaultDc = 11;
  assert.equal(ScIdentifyActivityService.dcForItem(activity, makeItem("a", "b", { rarity: "rare" })), 11);
});

test("the picker receives only the actor's unidentified items", async() => {
  const { activity } = setup({ itemId: null });

  await ScIdentifyActivityService.execute(activity);

  assert.deepEqual(pickerNames(), ["hero"]);
  assert.deepEqual(picker.calls[0].candidates[0].items.map((entry) => entry.id), ["ring", "relic", "rope"]);
  assert.match(picker.calls[0].checkLabel, /arc/);
});

test("a passed check identifies the chosen item against its rarity DC", async() => {
  const { actor, activity, rolls } = setup({ rollTotal: 16 });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.identified, true);
  assert.deepEqual(result.check, { dc: 16, total: 16 });
  assert.equal(rolls[0].skill, "arc");
  assert.equal(rolls[0].target, 16);
  assert.equal(rolls[0].by, player.id);
  assert.deepEqual(identifiedIds(actor), ["ring", "sword"]);
  assert.equal(ChatMessage.created.length, 1);
});

test("a failed check leaves the item unidentified", async() => {
  const { actor, activity } = setup({ rollTotal: 15 });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.canceled, false);
  assert.equal(result.identified, false);
  assert.equal(item(actor, "ring").system.identified, false);
  assert.equal(ChatMessage.created.length, 0);
  assert.ok(notices.some(([level]) => level === "info"));
});

test("an ability check is rolled when no skill is configured", async() => {
  const { activity, rolls } = setup({ check: { ability: "wis", skill: "" }, itemId: "rope" });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.identified, true);
  assert.equal(rolls[0].ability, "wis");
  assert.equal(rolls[0].target, 10);
});

test("without a check the chosen item is identified directly", async() => {
  const { actor, activity, rolls } = setup({ check: { ability: "", skill: "" }, itemId: "relic" });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.identified, true);
  assert.equal(result.check, null);
  assert.equal(rolls.length, 0);
  assert.equal(item(actor, "relic").system.identified, true);
});

test("closing the picker cancels without rolling", async() => {
  const { actor, activity, rolls } = setup({ itemId: null });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.reason, "selection-canceled");
  assert.equal(rolls.length, 0);
  assert.deepEqual(identifiedIds(actor), ["sword"]);
});

test("an actor without unidentified items gets a notice and no picker", async() => {
  const { actor, activity } = setup();
  actor.items = actor.items.filter((entry) => entry.system.identified);

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.reason, "no-items");
  assert.equal(picker.calls.length, 0);
  assert.ok(notices.some(([level]) => level === "info"));
});

test("a target lists the ally's items", async() => {
  const { ally, activity } = setup({ recipient: "target", itemId: null });

  await ScIdentifyActivityService.execute(activity);

  assert.deepEqual(pickerNames(), ["ally"]);
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("a player identifies another player's item: the GM rolls the check without a dialog", async() => {
  const { ally, activity, rolls } = setup({ recipient: "target", rollTotal: 17 });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.identified, true);
  assert.equal(result.actor, ally);
  assert.deepEqual(result.check, { dc: 16, total: 17 });
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].by, gm.id);
  assert.deepEqual(rolls[0].dialog, { configure: false });
  assert.deepEqual(identifiedIds(ally), ["ring", "sword"]);
});

test("the request message is the chat card the GM updates with the outcome", async() => {
  const { activity } = setup({ recipient: "target", rollTotal: 17 });

  await ScIdentifyActivityService.execute(activity);

  const [message] = ChatMessage.created;
  assert.equal(ChatMessage.created.length, 1);
  assert.equal(message.author, player);
  assert.equal(statusOf(message), "identified");
  assert.equal(message.flags[FLAG_SCOPE].identifyRequest.originUuid, "Scene.s1.Token.hero");
  assert.match(message.content, /@UUID\[Actor\.ally\.Item\.ring\]/);
});

test("an answer the player writes into their own request is not taken as the GM's", async(t) => {
  const { ally, activity } = setup({ recipient: "target", rollTotal: 17 });
  // The GM is online but never answers; the player edits the request instead.
  game.users.activeGM = { id: "gm-2", isGM: true, active: true };
  Hooks.on("createChatMessage", async(message) => {
    game.user = player;
    await message.update({
      [`flags.${FLAG_SCOPE}.identifyRequest`]: { status: "identified", check: { dc: 16, total: 999 } }
    });
  });
  const timeout = ScIdentifyRelay.TIMEOUT_MS;
  ScIdentifyRelay.TIMEOUT_MS = 20;
  t.after(() => { ScIdentifyRelay.TIMEOUT_MS = timeout; });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.identified, undefined);
  assert.equal(result.reason, "gm-timeout");
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("the answer is bound to its own request message", async() => {
  const { activity } = setup({ recipient: "target", rollTotal: 17 });

  await ScIdentifyActivityService.execute(activity);

  assert.equal(ChatMessage.created[0].id, "random-1");
});

test("a check the GM rolls below the DC leaves the ally's item unidentified", async() => {
  const { ally, activity } = setup({ recipient: "target", rollTotal: 15 });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.identified, false);
  assert.deepEqual(result.check, { dc: 16, total: 15 });
  assert.equal(statusOf(ChatMessage.created[0]), "failed");
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("a target outside the range is refused before the picker opens", async() => {
  const { activity, farToken } = setup({ recipient: "target" });
  player.targets = new Set([farToken.object]);

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.reason, "missing-recipient");
  assert.equal(picker.calls.length, 0);
  assert.ok(notices.some(([level]) => level === "warn"));
});

test("a target with no range limit can be anywhere on the scene", async() => {
  const { activity, farToken } = setup({ recipient: "target", range: 0, itemId: null });
  player.targets = new Set([farToken.object]);

  await ScIdentifyActivityService.execute(activity);

  assert.deepEqual(pickerNames(), ["far"]);
});

test("a target requires exactly one targeted token", async() => {
  const { activity } = setup({ recipient: "target" });
  player.targets = new Set();

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.reason, "missing-recipient");
  assert.equal(picker.calls.length, 0);
});

test("a player is told a GM is needed before choosing when none is online", async() => {
  const { ally, activity } = setup({ recipient: "target", gmActive: false });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.reason, "no-active-gm");
  assert.equal(picker.calls.length, 0);
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("choose offers yourself and visible creatures within range, nearest first", async() => {
  const { activity } = setup({ recipient: "choose", itemId: null });

  await ScIdentifyActivityService.execute(activity);

  assert.deepEqual(pickerNames(), ["hero", "ally"]);
  assert.equal(picker.calls[0].candidates[0].isSelf, true);
  assert.equal(picker.calls[0].candidates[1].distance, 10);
});

test("choose with no range limit reaches the whole scene", async() => {
  const { activity } = setup({ recipient: "choose", itemId: null, range: 0 });

  await ScIdentifyActivityService.execute(activity);

  assert.deepEqual(pickerNames(), ["hero", "ally", "far"]);
});

test("choose leaves out other players' creatures when no GM is online", async() => {
  const { activity } = setup({ recipient: "choose", itemId: null, gmActive: false });

  await ScIdentifyActivityService.execute(activity);

  assert.deepEqual(pickerNames(), ["hero"]);
});

test("choose identifies a nearby ally's item through the GM", async() => {
  const { ally, activity } = setup({ recipient: "choose", actorId: "ally", rollTotal: 18 });

  const result = await ScIdentifyActivityService.execute(activity);

  assert.equal(result.identified, true);
  assert.equal(ChatMessage.created[0].flags[FLAG_SCOPE].identifyRequest.recipientUuid, "Scene.s1.Token.ally");
  assert.deepEqual(identifiedIds(ally), ["ring", "sword"]);
});

test("the GM ignores a check total written into the request and rolls its own", async() => {
  const { ally, activity, rolls } = setup({ recipient: "target", rollTotal: 3 });

  const message = await postRequest({
    activityUuid: activity.uuid,
    recipientUuid: "Scene.s1.Token.ally",
    originUuid: "Scene.s1.Token.hero",
    itemId: "ring",
    check: { dc: 16, total: 999 }
  });

  assert.equal(statusOf(message), "failed");
  assert.deepEqual(message.flags[FLAG_SCOPE].identifyRequest.check, { dc: 16, total: 3 });
  assert.equal(rolls[0].by, gm.id);
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("the GM refuses a request from a player who does not own the activity", async() => {
  const { ally, activity } = setup({ recipient: "target", check: { ability: "", skill: "" } });

  const message = await postRequest(
    { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally", originUuid: "Scene.s1.Token.hero", itemId: "rope" },
    { id: "player-3", isGM: false, active: true }
  );

  assert.equal(statusOf(message), "refused");
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("the GM does not act on a request authored by a GM", async() => {
  const { ally, activity } = setup({ recipient: "target", check: { ability: "", skill: "" } });

  const message = await postRequest(
    { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally", originUuid: "Scene.s1.Token.hero", itemId: "rope" },
    gm
  );

  assert.equal(statusOf(message), "refused");
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("the GM refuses a target outside the range", async() => {
  const { far, activity } = setup({ recipient: "target", check: { ability: "", skill: "" } });

  const message = await postRequest({
    activityUuid: activity.uuid,
    recipientUuid: "Scene.s1.Token.far",
    originUuid: "Scene.s1.Token.hero",
    itemId: "rope"
  });

  assert.equal(statusOf(message), "refused");
  assert.deepEqual(identifiedIds(far), ["sword"]);
});

test("the GM refuses a range measured from someone else's token", async() => {
  const { ally, activity } = setup({ recipient: "choose", check: { ability: "", skill: "" } });

  const message = await postRequest({
    activityUuid: activity.uuid,
    recipientUuid: "Scene.s1.Token.ally",
    originUuid: "Scene.s1.Token.ally",
    itemId: "rope"
  });

  assert.equal(statusOf(message), "refused");
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});

test("the GM refuses an item that is already identified", async() => {
  const { activity } = setup({ recipient: "target", check: { ability: "", skill: "" } });

  const message = await postRequest({
    activityUuid: activity.uuid,
    recipientUuid: "Scene.s1.Token.ally",
    originUuid: "Scene.s1.Token.hero",
    itemId: "sword"
  });

  assert.equal(statusOf(message), "refused");
});

test("the GM only accepts placed tokens as targets", async() => {
  const { ally, activity } = setup({ recipient: "target", check: { ability: "", skill: "" } });

  const message = await postRequest({
    activityUuid: activity.uuid,
    recipientUuid: ally.uuid,
    originUuid: "Scene.s1.Token.hero",
    itemId: "rope"
  });

  assert.equal(statusOf(message), "refused");
  assert.deepEqual(identifiedIds(ally), ["sword"]);
});
