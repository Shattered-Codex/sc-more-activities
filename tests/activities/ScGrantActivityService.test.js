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
  utils: {
    deepClone: (value) => structuredClone(value),
    mergeObject: (target, source) => ({ ...target, ...source })
  }
};
globalThis.CONFIG = { queries: {} };
globalThis.ChatMessage = {
  created: [],
  getSpeaker: ({ actor }) => ({ actor: actor?.id }),
  async create(data) { this.created.push(data); }
};

const { ScGrantActivityService } = await import("../../scripts/activities/grant/ScGrantActivityService.js");
ScGrantActivityService.registerQueries();

const QUERY_ID = "sc-more-activities.grantItems";
const player = { id: "player-1", isGM: false, active: true };
const gm = { id: "gm-1", isGM: true, active: true, queries: [] };

const sourceItem = {
  documentName: "Item",
  uuid: "Compendium.world.items.Item.potion",
  name: "Potion",
  toObject: () => ({ _id: "potion", name: "Potion", type: "consumable", system: { quantity: 1 }, flags: {} })
};

function makeActor(id, { ownedBy = [] } = {}) {
  return {
    id,
    uuid: `Actor.${id}`,
    name: id,
    items: [],
    created: [],
    get isOwner() { return globalThis.game.user.isGM || ownedBy.includes(globalThis.game.user.id); },
    testUserPermission(user, level) { return level === "OWNER" && (user.isGM || ownedBy.includes(user.id)); },
    async createEmbeddedDocuments(name, data) {
      this.created.push(...data);
      return data.map((entry, index) => ({ ...entry, uuid: `Actor.${id}.Item.new-${index}` }));
    },
    async updateEmbeddedDocuments() { return []; },
    getRollData: () => ({})
  };
}

function setup({ userIsGm = false, gmActive = true, recipient = "target" } = {}) {
  notices.length = 0;
  ChatMessage.created.length = 0;
  gm.queries.length = 0;

  const caster = makeActor("caster", { ownedBy: [player.id] });
  const ally = makeActor("ally", { ownedBy: ["player-2"] });
  const allyToken = { documentName: "Token", uuid: "Scene.s1.Token.ally", actor: ally };
  const item = {
    uuid: "Actor.caster.Item.wand",
    actor: caster,
    testUserPermission: (user, level) => caster.testUserPermission(user, level)
  };
  const activity = {
    id: "grant",
    uuid: "Actor.caster.Item.wand.Activity.grant",
    type: "sc-grant",
    recipient,
    grants: [{ type: "item", uuid: sourceItem.uuid, quantity: "2" }],
    check: {},
    item,
    actor: caster,
    getRollData: () => ({})
  };
  const documents = new Map([
    [activity.uuid, activity],
    [allyToken.uuid, allyToken],
    [ally.uuid, ally],
    [sourceItem.uuid, sourceItem]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  gm.query = async (queryId, payload) => {
    gm.queries.push([queryId, payload]);
    const previousUser = globalThis.game.user;
    globalThis.game.user = gm;
    try {
      return await CONFIG.queries[queryId](payload, { user: player });
    } finally {
      globalThis.game.user = previousUser;
    }
  };

  const users = [player, ...(gmActive ? [gm] : [])];
  globalThis.game = {
    user: userIsGm ? gm : player,
    users: {
      activeGM: gmActive ? gm : null,
      get: (id) => users.find((user) => user.id === id),
      find: (predicate) => users.find(predicate)
    }
  };
  game.user.targets = new Set(recipient === "target" ? [{ actor: ally, document: allyToken }] : []);

  return { activity, caster, ally, allyToken };
}

test("a player grants to another player's actor through the active GM", async() => {
  const { activity, ally } = setup();

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.canceled, false);
  assert.equal(gm.queries.length, 1);
  assert.equal(gm.queries[0][0], QUERY_ID);
  assert.equal(gm.queries[0][1].recipientUuid, "Scene.s1.Token.ally");
  assert.equal(ally.created.length, 1);
  assert.equal(ally.created[0].system.quantity, 2);
  assert.deepEqual(result.created, ["Actor.ally.Item.new-0"]);
  assert.equal(result.actor, ally);
  assert.equal(ChatMessage.created.length, 1);
  assert.ok(notices.some(([level]) => level === "info"));
});

test("a player who cannot write to the recipient is told a GM is needed when none is online", async() => {
  const { activity, ally } = setup({ gmActive: false });

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.reason, "no-active-gm");
  assert.equal(ally.created.length, 0);
});

test("a player granting to their own actor still creates the items locally", async() => {
  const { activity, caster } = setup({ recipient: "self" });

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.canceled, false);
  assert.equal(gm.queries.length, 0);
  assert.equal(caster.created.length, 1);
});

test("the GM refuses a relayed grant from a user who does not own the activity", async() => {
  const { activity, ally } = setup();
  game.user = gm;

  const result = await CONFIG.queries[QUERY_ID](
    { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally" },
    { user: { id: "player-3", isGM: false } }
  );

  assert.equal(result.ok, false);
  assert.equal(ally.created.length, 0);
});

test("the GM only accepts placed tokens as relayed grant targets", async() => {
  const { activity, ally } = setup();
  game.user = gm;

  const result = await CONFIG.queries[QUERY_ID](
    { activityUuid: activity.uuid, recipientUuid: ally.uuid },
    { user: player }
  );

  assert.equal(result.ok, false);
  assert.equal(ally.created.length, 0);
});

test("the GM keeps a self grant on the activity's own actor", async() => {
  const { activity, caster, ally } = setup({ recipient: "self" });
  game.user = gm;

  const result = await CONFIG.queries[QUERY_ID](
    { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally" },
    { user: player }
  );

  assert.equal(result.ok, true);
  assert.equal(caster.created.length, 1);
  assert.equal(ally.created.length, 0);
});

test("the GM refuses an unauthenticated claim of GM rights", async() => {
  const { activity, ally } = setup();
  game.user = gm;

  const result = await CONFIG.queries[QUERY_ID]({
    activityUuid: activity.uuid,
    recipientUuid: "Scene.s1.Token.ally",
    requestUserId: gm.id
  });

  assert.equal(result.ok, false);
  assert.equal(ally.created.length, 0);
});

test("the GM refuses a relayed grant whose check did not reach the DC", async() => {
  const { activity, ally } = setup();
  activity.check = { skill: "per", dc: { formula: "15" } };
  game.user = gm;

  const result = await CONFIG.queries[QUERY_ID](
    { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally", check: { dc: 5, total: 12 } },
    { user: player }
  );

  assert.equal(result.ok, false);
  assert.equal(ally.created.length, 0);
});

function makeSpell(activity) {
  const item = activity.item;
  item.flags = {};
  item.system = { level: 1, activities: new Map([[activity.id, activity]]) };
  activity.getRollData = () => ({ item: { level: 1 } });
  item.clone = (changes, options) => {
    assert.equal(options.keepId, true);
    const scaling = changes["flags.dnd5e.scaling"];
    const clone = { ...item, flags: { dnd5e: { scaling } } };
    const scaledActivity = {
      ...activity,
      item: clone,
      getRollData: () => ({ item: { level: 1 + scaling } })
    };
    clone.system = { ...item.system, activities: new Map([[activity.id, scaledActivity]]) };
    return clone;
  };
  return item;
}

test("a relayed upcast grants the same quantity as local use without changing the stored item", async(t) => {
  const { activity, ally, caster } = setup();
  activity.grants[0].quantity = "@item.level";
  const item = makeSpell(activity);
  const usageActivity = item.clone({ "flags.dnd5e.scaling": 2 }, { keepId: true })
    .system.activities.get(activity.id);
  const originalRoll = globalThis.Roll;
  t.after(() => { globalThis.Roll = originalRoll; });
  globalThis.Roll = class {
    constructor(formula, data) {
      assert.equal(formula, "@item.level");
      this.formula = formula;
      this.total = data.item.level;
    }
    async evaluate() { return this; }
  };

  const relayed = await ScGrantActivityService.execute(usageActivity);
  assert.equal(relayed.canceled, false);
  assert.equal(gm.queries[0][1].scaling, 2);
  assert.equal(ally.created[0].system.quantity, 3);

  usageActivity.recipient = "self";
  const local = await ScGrantActivityService.execute(usageActivity);
  assert.equal(local.canceled, false);
  assert.equal(caster.created[0].system.quantity, ally.created[0].system.quantity);
  assert.deepEqual(item.flags, {});
  assert.equal(activity.getRollData().item.level, 1);
});

test("the GM checks the scaled DC rather than the stored base DC", async(t) => {
  const { activity, ally } = setup();
  makeSpell(activity);
  activity.check = { skill: "per", dc: { formula: "@item.level" } };
  const originalDnd5e = globalThis.dnd5e;
  t.after(() => { globalThis.dnd5e = originalDnd5e; });
  globalThis.dnd5e = { utils: { simplifyBonus: (_formula, data) => data.item.level } };
  game.user = gm;

  const result = await CONFIG.queries[QUERY_ID]({
    activityUuid: activity.uuid,
    recipientUuid: "Scene.s1.Token.ally",
    scaling: 2,
    check: { dc: 1, total: 2 }
  }, { user: player });

  assert.equal(result.ok, false);
  assert.equal(ally.created.length, 0);
});

test("the GM rejects invalid usage scaling before creating items", async() => {
  const { activity, ally } = setup();
  game.user = gm;
  for (const scaling of [-1, 1.5, "2", {}, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await CONFIG.queries[QUERY_ID]({
      activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally", scaling
    }, { user: player });
    assert.equal(result.ok, false);
  }
  assert.equal(ally.created.length, 0);
});
