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
const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {}
    }
  },
  utils: {
    deepClone: (value) => structuredClone(value),
    mergeObject: (target, source) => ({ ...target, ...source }),
    getProperty,
    setProperty: (object, path, value) => {
      const keys = path.split(".");
      const last = keys.pop();
      keys.reduce((target, key) => (target[key] ??= {}), object)[last] = value;
    },
    hasProperty: (object, path) => getProperty(object, path) !== undefined,
    randomID: () => Math.random().toString(36).slice(2, 18)
  }
};
globalThis.Hooks = { on() {} };
globalThis.CONFIG = { queries: {} };
globalThis.ChatMessage = {
  created: [],
  getSpeaker: ({ actor }) => ({ actor: actor?.id }),
  async create(data) { this.created.push(data); }
};

const { ScGrantActivityService } = await import("../../scripts/activities/grant/ScGrantActivityService.js");
const { ScGrantChoiceApp } = await import("../../scripts/activities/grant/ScGrantChoiceApp.js");
const { ScGrantBastionOrders } = await import("../../scripts/activities/grant/ScGrantBastionOrders.js");
ScGrantBastionOrders.CLAIM_SETTLE_MS = 0;
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
      const documents = data.map((entry, index) => ({
        ...entry,
        id: entry._id ?? `new-${this.items.length + index}`,
        uuid: `Actor.${id}.Item.new-${index}`
      }));
      // Like Foundry, created items join the inventory (stacks are only found
      // on items whose data has a numeric quantity).
      this.items.push(...documents.map((document) => ({ ...document, toObject: () => document })));
      return documents;
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

const candle = {
  documentName: "Item",
  uuid: "Compendium.world.items.Item.candle",
  name: "Candle",
  toObject: () => ({ _id: "candle", name: "Candle", type: "loot", system: { quantity: 1 }, flags: {} })
};

function setupChoice(options) {
  const context = setup(options);
  const { activity } = context;
  activity.grants = [
    { type: "item", uuid: sourceItem.uuid, quantity: "2" },
    { type: "item", uuid: candle.uuid, quantity: "10" }
  ];
  activity.selection = { mode: "choose", count: 1 };
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === candle.uuid ? candle : lookup(uuid));
  return context;
}

test("a choice grant only creates the source the user picked", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  let offered = null;
  ScGrantChoiceApp.wait = async(config) => {
    offered = config;
    return [1];
  };

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.canceled, false);
  assert.equal(offered.count, 1);
  assert.deepEqual(offered.options.map((option) => option.name), ["Potion", "Candle"]);
  assert.equal(caster.created.length, 1);
  assert.equal(caster.created[0].name, "Candle");
  assert.equal(caster.created[0].system.quantity, 10);
});

test("closing the choice picker grants nothing", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  ScGrantChoiceApp.wait = async() => null;

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.reason, "choice-canceled");
  assert.equal(caster.created.length, 0);
});

test("a relayed choice sends the picks and the GM grants only those", async(t) => {
  const { activity, ally } = setupChoice();
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  ScGrantChoiceApp.wait = async() => [0];

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.canceled, false);
  assert.deepEqual(gm.queries[0][1].picks, [0]);
  assert.equal(ally.created.length, 1);
  assert.equal(ally.created[0].name, "Potion");
});

test("the GM refuses a relayed choice that takes more than allowed", async() => {
  const { activity, ally } = setupChoice();
  game.user = gm;

  for (const picks of [undefined, [], [0, 1], [5]]) {
    const result = await CONFIG.queries[QUERY_ID](
      { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally", picks },
      { user: player }
    );
    assert.equal(result.ok, false);
  }
  assert.equal(ally.created.length, 0);
});

function makeFacility(activity, caster) {
  const facility = {
    type: "facility",
    uuid: "Actor.caster.Item.garden",
    name: "Garden",
    isOwner: true,
    actor: caster,
    flags: {},
    _source: { system: { progress: { value: 0, max: null, order: "" } } },
    system: { disabled: false, activities: new Map([[activity.id, activity]]) },
    updates: [],
    async update(changes) {
      this.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split(".");
        const last = keys.pop();
        const root = keys[0] === "system" ? this._source : this;
        const target = keys.reduce((object, key) => (object[key] ??= {}), root);
        target[last] = value;
      }
      this.system.progress = this._source.system.progress;
    }
  };
  facility.system.progress = facility._source.system.progress;
  activity.item = facility;
  activity.delivery = "bastion";
  activity.bastion = { order: "harvest", days: 7 };
  return facility;
}

test("a bastion grant issues a facility order instead of granting at once", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  const facility = makeFacility(activity, caster);
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  ScGrantChoiceApp.wait = async() => [1];

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.pending, true);
  assert.equal(caster.created.length, 0);
  assert.equal(gm.queries.length, 0);
  assert.deepEqual(facility._source.system.progress, { value: 0, max: 7, order: "harvest" });
  const pending = ScGrantBastionOrders.pendingOf(facility);
  assert.equal(pending.activityId, activity.id);
  assert.deepEqual(pending.entries.map((entry) => entry.uuid), [candle.uuid]);
});

test("using a bastion grant again changes its order and restarts the progress", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  const facility = makeFacility(activity, caster);
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  ScGrantChoiceApp.wait = async() => [1];
  await ScGrantActivityService.execute(activity);
  facility._source.system.progress.value = 5;

  ScGrantChoiceApp.wait = async() => [0];
  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.pending, true);
  assert.equal(facility._source.system.progress.value, 0);
  assert.deepEqual(ScGrantBastionOrders.pendingOf(facility).entries.map((entry) => entry.uuid), [sourceItem.uuid]);
});

test("a facility busy with a native order refuses a bastion grant", async() => {
  const { activity, caster } = setup({ recipient: "self" });
  const facility = makeFacility(activity, caster);
  facility._source.system.progress = { value: 2, max: 14, order: "craft" };

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.reason, "bastion-unavailable");
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

test("completing the facility order delivers the chosen items", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self", userIsGm: true });
  const facility = makeFacility(activity, caster);
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  ScGrantChoiceApp.wait = async() => [1];
  await ScGrantActivityService.execute(activity);
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === caster.uuid ? caster : lookup(uuid));

  // dnd5e completes an order by clearing its progress.
  const changes = await completeOrder(facility);

  assert.equal(changes.flags["sc-more-activities"].bastionGrant.state, "owed");
  assert.equal(caster.created.length, 1);
  assert.equal(caster.created[0].name, "Candle");
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);

  // A repeated completion cannot deliver twice.
  await ScGrantBastionOrders.onUpdateItem(facility, changes, {}, gm.id);
  assert.equal(caster.created.length, 1);
});

test("an order that advances does not deliver, and a native order replacing it drops the grant", async() => {
  const { activity, caster } = setup({ recipient: "self", userIsGm: true });
  const facility = makeFacility(activity, caster);
  await ScGrantActivityService.execute(activity);

  facility._source.system.progress.value = 7;
  await ScGrantBastionOrders.onUpdateItem(facility, { system: { progress: { value: 7 } } }, {}, gm.id);
  assert.equal(caster.created.length, 0);
  assert.ok(ScGrantBastionOrders.pendingOf(facility));

  facility._source.system.progress = { value: 0, max: 21, order: "change" };
  await ScGrantBastionOrders.onUpdateItem(facility, { system: { progress: { order: "change", max: 21 } } }, {}, gm.id);
  assert.equal(caster.created.length, 0);
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

test("a repair completion in dnd5e 5.x does not deliver the grant", async() => {
  const { activity, caster } = setup({ recipient: "self", userIsGm: true });
  const facility = makeFacility(activity, caster);
  await ScGrantActivityService.execute(activity);

  facility._source.system.progress = { value: 0, max: null, order: "" };
  await ScGrantBastionOrders.onUpdateItem(facility, {
    system: { disabled: false, progress: { value: 0, max: null, order: "" } }
  }, {}, gm.id);

  assert.equal(caster.created.length, 0);
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

test("a budget grant creates the units the user spent points on", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  activity.selection = { mode: "budget", budget: "10" };
  activity.grants[0].quantity = "1";
  activity.grants[1].quantity = "1";
  activity.grants[1].cost = 2;
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  let offered = null;
  ScGrantChoiceApp.wait = async(config) => {
    offered = config;
    return [4, 3];
  };

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.canceled, false);
  assert.equal(offered.mode, "budget");
  assert.equal(offered.budget, 10);
  assert.deepEqual(offered.options.map((option) => option.cost), [1, 2]);
  assert.deepEqual(caster.created.map((item) => [item.name, item.system.quantity]), [["Potion", 4], ["Candle", 3]]);
});

test("the GM refuses a relayed budget that overspends", async() => {
  const { activity, ally } = setupChoice();
  activity.selection = { mode: "budget", budget: "10" };
  activity.grants[1].cost = 2;
  game.user = gm;

  const over = await CONFIG.queries[QUERY_ID](
    { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally", picks: [2, 5] },
    { user: player }
  );
  assert.equal(over.ok, false);
  assert.equal(ally.created.length, 0);

  const fair = await CONFIG.queries[QUERY_ID](
    { activityUuid: activity.uuid, recipientUuid: "Scene.s1.Token.ally", picks: [2, 4] },
    { user: player }
  );
  assert.equal(fair.ok, true);
  assert.equal(ally.created.length, 2);
});

test("a budget that resolves to no points cancels the grant", async() => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  activity.selection = { mode: "budget", budget: "0" };

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.reason, "no-budget");
  assert.equal(caster.created.length, 0);
});

/**
 * dnd5e completing the facility's order, as Foundry runs it: preUpdateItem on
 * the writing client (which may add to the changes), the write, then
 * updateItem with the written changes.
 */
async function completeOrder(facility, orders = ScGrantBastionOrders) {
  const changes = { system: { progress: { value: 0, max: null, order: "" } } };
  orders.onPreUpdateItem(facility, changes);
  await writeChanges(facility, changes);
  await orders.onUpdateItem(facility, changes, {}, gm.id);
  return changes;
}

async function writeChanges(facility, changes) {
  if (changes.system?.progress) {
    facility._source.system.progress = { ...facility._source.system.progress, ...changes.system.progress };
  }
  const grant = changes.flags?.["sc-more-activities"]?.bastionGrant;
  if (grant) {
    await facility.update(Object.fromEntries(Object.entries(grant).map(([key, value]) => (
      [`flags.sc-more-activities.bastionGrant.${key}`, value]
    ))));
  }
}

test("a delivery that fails keeps the order pending until a retry delivers it", async() => {
  const { activity, caster } = setup({ recipient: "self", userIsGm: true });
  const facility = makeFacility(activity, caster);
  await ScGrantActivityService.execute(activity);
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === caster.uuid ? caster : lookup(uuid));
  const create = caster.createEmbeddedDocuments;
  caster.createEmbeddedDocuments = async() => { throw new Error("database offline"); };

  await completeOrder(facility);

  const pending = ScGrantBastionOrders.pendingOf(facility);
  assert.equal(pending.state, "failed");
  assert.equal(pending.failure, "grant-failed");
  assert.equal(pending.entries.length, 1);

  // Later facility updates (a new native order) do not drop what is owed.
  await ScGrantBastionOrders.onUpdateItem(facility, { system: { progress: { order: "craft", max: 14 } } }, {}, gm.id);
  assert.ok(ScGrantBastionOrders.pendingOf(facility));

  caster.createEmbeddedDocuments = create;
  const retried = await ScGrantBastionOrders.retry(facility);

  assert.equal(retried.ok, true);
  assert.equal(caster.created.length, 1);
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

test("a recipient that no longer exists keeps the order pending instead of redirecting it", async() => {
  const { activity, caster, ally } = setup({ userIsGm: true });
  const facility = makeFacility(activity, caster);
  await ScGrantActivityService.execute(activity);
  assert.equal(ScGrantBastionOrders.pendingOf(facility).recipientUuid, ally.uuid);

  // The targeted actor is gone: its UUID no longer resolves.
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === ally.uuid ? null : lookup(uuid));
  await completeOrder(facility);

  assert.equal(caster.created.length, 0);
  assert.equal(ally.created.length, 0);
  const pending = ScGrantBastionOrders.pendingOf(facility);
  assert.equal(pending.state, "failed");
  assert.equal(pending.failure, "recipient-missing");
});

test("a facility undelivered order blocks issuing a new one", async() => {
  const { activity, caster } = setup({ recipient: "self", userIsGm: true });
  const facility = makeFacility(activity, caster);
  await ScGrantActivityService.execute(activity);
  facility.flags["sc-more-activities"].bastionGrant.state = "failed";

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.reason, "bastion-unavailable");
});

test("a native order started while the picker is open is not overwritten", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  const facility = makeFacility(activity, caster);
  const originalWait = ScGrantChoiceApp.wait;
  t.after(() => { ScGrantChoiceApp.wait = originalWait; });
  ScGrantChoiceApp.wait = async() => {
    facility._source.system.progress = { value: 2, max: 21, order: "craft" };
    return [1];
  };

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.reason, "bastion-unavailable");
  assert.deepEqual(facility._source.system.progress, { value: 2, max: 21, order: "craft" });
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

/** Gives `actor` a potion stack that grants add to. */
function giveStack(actor, quantity) {
  const stack = {
    id: "stack",
    flags: { "sc-more-activities": { grantSourceUuid: sourceItem.uuid, grantActivityId: "grant" } },
    system: { quantity },
    toObject() { return { system: { quantity: this.system.quantity } }; }
  };
  actor.items.push(stack);
  actor.updateEmbeddedDocuments = async(_name, updates) => updates.map((update) => {
    stack.system.quantity = update["system.quantity"];
    const keys = update["flags.sc-more-activities.grantDeliveryKeys"];
    if (keys) {
      stack.flags["sc-more-activities"].grantDeliveryKeys = keys;
    }
    return stack;
  });
  return stack;
}

function setupBastionDelivery() {
  const context = setupChoice({ recipient: "self", userIsGm: true });
  const { activity, caster } = context;
  activity.selection = { mode: "all" };
  const facility = makeFacility(activity, caster);
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === caster.uuid ? caster : lookup(uuid));
  game.users.get = (id) => [player, gm].find((user) => user.id === id);
  return { ...context, facility };
}

test("a retry after a partial failure only delivers what is still missing", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  const stack = giveStack(caster, 5);
  await ScGrantActivityService.execute(activity);
  const create = caster.createEmbeddedDocuments;
  caster.createEmbeddedDocuments = async() => { throw new Error("database offline"); };

  await completeOrder(facility);

  // The potion stack was raised before the candles failed.
  assert.equal(stack.system.quantity, 7);
  const pending = ScGrantBastionOrders.pendingOf(facility);
  assert.equal(pending.state, "failed");

  caster.createEmbeddedDocuments = create;
  const retried = await ScGrantBastionOrders.retry(facility);

  assert.equal(retried.ok, true);
  assert.equal(stack.system.quantity, 7);
  assert.deepEqual(caster.created.map((item) => [item.name, item.system.quantity]), [["Candle", 10]]);

  // The same order delivered again adds nothing either.
  facility.flags["sc-more-activities"].bastionGrant = { ...pending, state: "failed" };
  assert.equal((await ScGrantBastionOrders.retry(facility)).ok, true);
  assert.equal(stack.system.quantity, 7);
  assert.equal(caster.created.length, 1);
});

test("a retry while a delivery is running does not deliver it twice", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  await ScGrantActivityService.execute(activity);
  const create = caster.createEmbeddedDocuments.bind(caster);
  caster.createEmbeddedDocuments = async() => { throw new Error("database offline"); };
  await completeOrder(facility);
  caster.createEmbeddedDocuments = create;

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  caster.createEmbeddedDocuments = async(name, data) => {
    await gate;
    return create(name, data);
  };
  const first = ScGrantBastionOrders.retry(facility);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ScGrantBastionOrders.canResolve(facility), false);
  const second = await ScGrantBastionOrders.retry(facility);
  assert.equal(second.ok, false);

  release();
  assert.equal((await first).ok, true);
  assert.equal(caster.created.length, 1);
});

test("another user's running delivery cannot be retried, but an abandoned or stale one can", async() => {
  const { facility } = setupBastionDelivery();
  const claim = { activityId: "grant", order: "harvest", state: "delivering", claimedBy: player.id, claimClient: "their-tab" };
  facility.flags["sc-more-activities"] = { bastionGrant: { ...claim, claimedAt: Date.now() } };

  // The player who claimed it is still online: their attempt is still running.
  assert.equal(ScGrantBastionOrders.canResolve(facility), false);

  player.active = false;
  try {
    assert.equal(ScGrantBastionOrders.canResolve(facility), true);
  } finally {
    player.active = true;
  }

  facility.flags["sc-more-activities"].bastionGrant.claimedAt = Date.now() - (3 * 60 * 1000);
  assert.equal(ScGrantBastionOrders.canResolve(facility), true);
});

test("a deleted grant activity neither blocks the delivery nor hides its recovery", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  await ScGrantActivityService.execute(activity);
  facility.system.activities.delete(activity.id);
  facility.getRollData = () => ({});

  await completeOrder(facility);
  assert.equal(caster.created.length, 2);
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

test("a failed delivery posts a GM card that can retry it from the facility", async() => {
  const { activity, facility } = setupBastionDelivery();
  activity.recipient = "target";
  game.user.targets = new Set([{ actor: { uuid: "Actor.gone", name: "Gone" }, document: null }]);
  await ScGrantActivityService.execute(activity);
  ChatMessage.created.length = 0;

  await completeOrder(facility);

  const card = ChatMessage.created.at(-1).content;
  assert.match(card, /data-sc-grant-facility="Actor.caster.Item.garden"/);
  assert.match(card, /data-sc-grant-action="retry"/);
  assert.match(card, /data-sc-grant-action="discard"/);
});

test("a delivery claimed by another tab of the same GM is not retried from this one", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  await ScGrantActivityService.execute(activity);
  // A second tab: the same module loaded again, with its own client id.
  const { ScGrantBastionOrders: OtherTab } = await import("../../scripts/activities/grant/ScGrantBastionOrders.js?tab=2");
  OtherTab.CLAIM_SETTLE_MS = 0;

  const create = caster.createEmbeddedDocuments.bind(caster);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  caster.createEmbeddedDocuments = async(name, data) => {
    await gate;
    return create(name, data);
  };

  // This tab completes the order and starts delivering it.
  const delivering = completeOrder(facility);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ScGrantBastionOrders.pendingOf(facility).state, "delivering");

  // The other tab, same user, sees a running delivery: no retry, no discard,
  // and the completion update does not make it deliver too.
  assert.equal(OtherTab.canResolve(facility), false);
  assert.equal((await OtherTab.retry(facility)).ok, false);
  assert.equal((await OtherTab.discard(facility)).ok, false);
  await OtherTab.onUpdateItem(facility, {
    system: { progress: { value: 0, max: null, order: "" } },
    flags: { "sc-more-activities": { bastionGrant: { state: "owed" } } }
  }, {}, gm.id);

  release();
  await delivering;
  assert.equal(caster.created.length, 1);
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

test("a failed claim after completion keeps the order owed and recoverable", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  await ScGrantActivityService.execute(activity);
  const update = facility.update;
  let failClaim = true;
  facility.update = async function(changes) {
    if (failClaim && changes["flags.sc-more-activities.bastionGrant.state"] === "delivering") {
      throw new Error("database offline");
    }
    return update.call(this, changes);
  };

  await completeOrder(facility);

  const pending = ScGrantBastionOrders.pendingOf(facility);
  assert.equal(pending.state, "owed");
  assert.equal(caster.created.length, 0);

  // An idle bastion turn afterwards does not drop what is owed.
  await ScGrantBastionOrders.onUpdateItem(facility, { system: { progress: { order: "" } } }, {}, gm.id);
  assert.ok(ScGrantBastionOrders.pendingOf(facility));

  // The client that completed it can resolve it once writes work again.
  assert.equal(ScGrantBastionOrders.canResolve(facility), true);
  failClaim = false;
  assert.equal((await ScGrantBastionOrders.retry(facility)).ok, true);
  assert.equal(caster.created.length, 1);
});

test("an order whose table resolves no item is refused when issued", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  const table = {
    documentName: "RollTable",
    uuid: "RollTable.empty",
    name: "Empty",
    async drawMany() { return { results: [] }; }
  };
  activity.grants = [{ type: "table", uuid: table.uuid, quantity: "1" }];
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === table.uuid ? table : lookup(uuid));

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.reason, "bastion-unavailable");
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
  assert.equal(facility._source.system.progress.max, null);
  assert.equal(caster.created.length, 0);
});

test("delivering an empty plan reports a failure", async() => {
  const { caster } = setupBastionDelivery();
  const result = await ScGrantActivityService.deliverPlan(caster, { sources: [], lines: [] }, { activityId: "grant", deliveryId: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-items");
});

/** Holds the first lookup of `uuid` until `release()` is called. */
function holdLookup(uuid) {
  const lookup = globalThis.fromUuid;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  globalThis.fromUuid = async (requested) => {
    if (requested === uuid && !held) {
      held = true;
      await gate;
    }
    return lookup(requested);
  };
  return { release: () => release(), reached: () => held };
}

test("a delivery that could not renew its claim stops before writing and stays recoverable here", async(t) => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  await ScGrantActivityService.execute(activity);
  const hold = holdLookup(candle.uuid);
  const timeout = ScGrantBastionOrders.CLAIM_TIMEOUT_MS;
  t.after(() => { ScGrantBastionOrders.CLAIM_TIMEOUT_MS = timeout; });

  const first = completeOrder(facility);
  while (!hold.reached()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  // Half the timeout has passed since the last renewal.
  ScGrantBastionOrders.CLAIM_TIMEOUT_MS = 0;
  hold.release();
  await first;
  ScGrantBastionOrders.CLAIM_TIMEOUT_MS = timeout;

  assert.equal(caster.created.length, 0);
  assert.equal(ScGrantBastionOrders.pendingOf(facility).state, "delivering");
  assert.equal(ScGrantBastionOrders.canResolve(facility), true);
  assert.equal((await ScGrantBastionOrders.retry(facility)).ok, true);
  assert.equal(caster.created.length, 1);
});

test("a delivery that loses its claim while loading a source does not touch the inventory", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: sourceItem.uuid, quantity: "2" }];
  const stack = giveStack(caster, 5);
  await ScGrantActivityService.execute(activity);
  const { ScGrantBastionOrders: OtherTab } = await import("../../scripts/activities/grant/ScGrantBastionOrders.js?tab=4");
  OtherTab.CLAIM_SETTLE_MS = 0;

  // This tab's delivery hangs loading the source to write it.
  const lookup = globalThis.fromUuid;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  let lookups = 0;
  globalThis.fromUuid = async (uuid) => {
    if (uuid === sourceItem.uuid && ++lookups === 1) {
      held = true;
      await gate;
    }
    return lookup(uuid);
  };

  const first = completeOrder(facility);
  while (!held) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Meanwhile its claim expires and the other tab delivers the order.
  facility.flags["sc-more-activities"].bastionGrant.claimedAt = Date.now() - (2 * ScGrantBastionOrders.CLAIM_TIMEOUT_MS);
  assert.equal((await OtherTab.retry(facility)).ok, true);
  assert.equal(stack.system.quantity, 7);

  // The first delivery resumes, finds its claim gone, and writes nothing.
  release();
  await first;
  assert.equal(stack.system.quantity, 7);
});

test("a source delivered before a partial failure is skipped even after its item is deleted", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [
    { type: "item", uuid: sourceItem.uuid, quantity: "2" },
    { type: "item", uuid: candle.uuid, quantity: "10" }
  ];
  const stack = giveStack(caster, 5);
  await ScGrantActivityService.execute(activity);
  const create = caster.createEmbeddedDocuments;
  caster.createEmbeddedDocuments = async() => { throw new Error("database offline"); };
  await completeOrder(facility);
  assert.equal(stack.system.quantity, 7);
  assert.equal(ScGrantBastionOrders.pendingOf(facility).state, "failed");

  // The potion's source item is deleted after it was delivered.
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === sourceItem.uuid ? null : lookup(uuid));
  caster.createEmbeddedDocuments = create;

  assert.equal((await ScGrantBastionOrders.retry(facility)).ok, true);
  assert.equal(stack.system.quantity, 7);
  assert.deepEqual(caster.created.map((item) => item.name), ["Candle"]);
});

test("a creation that lands after its claim was taken over does not duplicate the items", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  await ScGrantActivityService.execute(activity);
  const { ScGrantBastionOrders: OtherTab } = await import("../../scripts/activities/grant/ScGrantBastionOrders.js?tab=5");
  OtherTab.CLAIM_SETTLE_MS = 0;

  // Like the server: ids are kept, a duplicate id is refused when the write
  // lands. This tab's first creation stays in flight until released.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let inFlight = false;
  caster.createEmbeddedDocuments = async(_name, data, options) => {
    if (!inFlight) {
      inFlight = true;
      await gate;
    }
    assert.equal(options?.keepId, true);
    for (const entry of data) {
      if (caster.items.some((item) => item._id === entry._id)) {
        throw new Error(`An Item with _id ${entry._id} already exists`);
      }
    }
    caster.items.push(...data.map((entry) => ({ ...entry, id: entry._id, toObject: () => entry })));
    caster.created.push(...data);
    return data;
  };

  const first = completeOrder(facility);
  while (!inFlight) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Its heartbeat stopped: the claim expires and the other tab delivers.
  facility.flags["sc-more-activities"].bastionGrant.claimedAt = Date.now() - (2 * ScGrantBastionOrders.CLAIM_TIMEOUT_MS);
  assert.equal((await OtherTab.retry(facility)).ok, true);
  assert.equal(caster.created.length, 1);

  // The first creation lands late, with the same derived id: refused.
  release();
  await first;
  assert.equal(caster.created.length, 1);
  assert.equal(caster.items.filter((item) => item.name === "Candle").length, 1);
});

test("a creation a hook vetoes keeps the order pending instead of completing it", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  await ScGrantActivityService.execute(activity);
  // Foundry returns no document when a preCreate hook returns false.
  caster.createEmbeddedDocuments = async() => [];

  await completeOrder(facility);

  const pending = ScGrantBastionOrders.pendingOf(facility);
  assert.equal(pending.state, "failed");
  assert.equal(pending.failure, "grant-failed");
  assert.equal(caster.items.length, 0);
});

test("a vetoed stack update keeps the order pending too", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: sourceItem.uuid, quantity: "2" }];
  giveStack(caster, 5);
  caster.updateEmbeddedDocuments = async() => [];
  await ScGrantActivityService.execute(activity);

  await completeOrder(facility);

  assert.equal(ScGrantBastionOrders.pendingOf(facility).state, "failed");
});

test("an immediate grant whose creation is vetoed reports a failure", async() => {
  const { activity, caster } = setup({ recipient: "self" });
  caster.createEmbeddedDocuments = async() => [];

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.canceled, true);
  assert.ok(notices.some(([level]) => level === "error"));
});

const ring = {
  documentName: "Item",
  uuid: "Compendium.world.items.Item.ring",
  name: "Ring",
  // No numeric quantity: each unit is its own item.
  toObject: () => ({ _id: "ring", name: "Ring", type: "equipment", system: {}, flags: {} })
};

test("a creation a hook cut short is completed by the retry, copy by copy", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: ring.uuid, quantity: "3" }];
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === ring.uuid ? ring : lookup(uuid));
  await ScGrantActivityService.execute(activity);
  // A hook lets only one of the three copies through.
  const create = caster.createEmbeddedDocuments.bind(caster);
  caster.createEmbeddedDocuments = async(name, data, options) => create(name, data.slice(0, 1), options);

  await completeOrder(facility);
  assert.equal(caster.items.length, 1);
  assert.equal(ScGrantBastionOrders.pendingOf(facility).state, "failed");

  caster.createEmbeddedDocuments = create;
  assert.equal((await ScGrantBastionOrders.retry(facility)).ok, true);

  const ids = caster.items.map((item) => item.id);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.equal(ScGrantBastionOrders.pendingOf(facility), null);
});

test("an order's quantities are rolled when it is issued, and delivered as rolled", async(t) => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "1d4" }];
  const originalRoll = globalThis.Roll;
  t.after(() => { globalThis.Roll = originalRoll; });
  let total = 3;
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { this.total = total; return this; }
  };

  await ScGrantActivityService.execute(activity);
  assert.match(ChatMessage.created.at(-1).content, /&times;3/);

  // Later rolls do not change what the order delivers.
  total = 1;
  await completeOrder(facility);
  assert.deepEqual(caster.created.map((item) => item.system.quantity), [3]);
});

function drawingTable(results) {
  return {
    documentName: "RollTable",
    uuid: "RollTable.loot",
    name: "Loot",
    draws: [],
    async drawMany(count) {
      this.draws.push({ count, user: globalThis.game.user.id });
      return { results: results.slice(0, count).map((uuid) => ({ documentUuid: uuid })) };
    }
  };
}

test("an order's tables are drawn once, when it is issued, whatever the deliveries", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  const table = drawingTable([candle.uuid, sourceItem.uuid]);
  activity.grants = [{ type: "table", uuid: table.uuid, quantity: "2" }];
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === table.uuid ? table : lookup(uuid));
  await ScGrantActivityService.execute(activity);
  assert.equal(table.draws.length, 1);

  const create = caster.createEmbeddedDocuments;
  caster.createEmbeddedDocuments = async() => { throw new Error("database offline"); };
  await completeOrder(facility);
  caster.createEmbeddedDocuments = create;
  assert.equal((await ScGrantBastionOrders.retry(facility)).ok, true);

  assert.equal(table.draws.length, 1);
  assert.deepEqual(caster.created.map((item) => item.name).sort(), ["Candle", "Potion"]);
});

test("a player's order that draws a world table is issued by the GM", async(t) => {
  const { activity, caster } = setupChoice({ recipient: "self" });
  activity.selection = { mode: "all" };
  const facility = makeFacility(activity, caster);
  const table = drawingTable([candle.uuid]);
  activity.grants = [{ type: "table", uuid: table.uuid, quantity: "1" }];
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === table.uuid ? table : lookup(uuid));

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.pending, true);
  assert.equal(gm.queries.length, 1);
  assert.deepEqual(table.draws, [{ count: 1, user: gm.id }]);
  assert.deepEqual(ScGrantBastionOrders.pendingOf(facility).plan.sources.map((source) => source.uuid), [candle.uuid]);
  assert.equal(caster.created.length, 0);
});

test("granted copies carry the flags configured on the activity, and nothing else is added", async() => {
  const { activity, caster } = setup({ recipient: "self" });
  activity.itemFlags = [
    { key: "importer.isStandardDragDrop", value: "true" },
    { key: "world.note", value: "from the garden" },
    { key: "sc-more-activities.grantDeliveryKey", value: "\"spoofed\"" },
    { key: "__proto__.polluted", value: "true" },
    { key: "nodot", value: "1" }
  ];

  const result = await ScGrantActivityService.execute(activity);

  assert.equal(result.canceled, false);
  const flags = caster.created[0].flags;
  assert.equal(flags.importer.isStandardDragDrop, true);
  assert.equal(flags.world.note, "from the garden");
  assert.equal(flags["sc-more-activities"].grantDeliveryKey, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(flags.nodot, undefined);
});

test("a grant without configured flags creates its copies untouched", async() => {
  const { activity, caster } = setup({ recipient: "self" });

  await ScGrantActivityService.execute(activity);

  assert.deepEqual(Object.keys(caster.created[0].flags), ["sc-more-activities"]);
});

const TYPED_FLAGS = [
  { key: "world.object", value: "{\"a\":1}" },
  { key: "world.list", value: "[1,2]" },
  { key: "world.empty", value: "null" },
  { key: "world.text", value: "\"true\"" },
  { key: "world.flag", value: "true" }
];

function assertTypedFlags(flags) {
  assert.deepEqual(flags.world, { object: { a: 1 }, list: [1, 2], empty: null, text: "true", flag: true });
}

test("configured flag values keep their types on an immediate grant", async() => {
  const { activity, caster } = setup({ recipient: "self" });
  activity.itemFlags = TYPED_FLAGS;

  await ScGrantActivityService.execute(activity);

  assertTypedFlags(caster.created[0].flags);
});

test("configured flag values keep their types through a bastion order", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  activity.itemFlags = TYPED_FLAGS;
  await ScGrantActivityService.execute(activity);
  assert.deepEqual(ScGrantBastionOrders.pendingOf(facility).plan.itemFlags[0], { key: "world.object", value: { a: 1 } });

  await completeOrder(facility);

  assertTypedFlags(caster.created[0].flags);
});

test("non-stackable copies get their own copy of an object flag", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: ring.uuid, quantity: "2" }];
  activity.itemFlags = [{ key: "world.object", value: "{\"a\":1}" }];
  const lookup = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === ring.uuid ? ring : lookup(uuid));
  await ScGrantActivityService.execute(activity);

  await completeOrder(facility);

  const [first, second] = caster.created;
  assert.deepEqual(first.flags.world.object, { a: 1 });
  assert.notEqual(first.flags.world.object, second.flags.world.object);
});

test("a retry follows flags added to the activity after the order failed", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  await ScGrantActivityService.execute(activity);
  const create = caster.createEmbeddedDocuments;
  caster.createEmbeddedDocuments = async() => [];
  await completeOrder(facility);
  assert.equal(ScGrantBastionOrders.pendingOf(facility).state, "failed");

  // The GM adds the marker another module needs, then retries.
  activity.itemFlags = [{ key: "importer.isStandardDragDrop", value: "true" }];
  caster.createEmbeddedDocuments = create;
  assert.equal((await ScGrantBastionOrders.retry(facility)).ok, true);

  assert.equal(caster.created[0].flags.importer.isStandardDragDrop, true);
});

test("an order whose activity was deleted writes the flags stored when it was issued", async() => {
  const { activity, caster, facility } = setupBastionDelivery();
  activity.grants = [{ type: "item", uuid: candle.uuid, quantity: "10" }];
  activity.itemFlags = [{ key: "importer.isStandardDragDrop", value: "true" }];
  await ScGrantActivityService.execute(activity);
  facility.system.activities.delete(activity.id);
  facility.getRollData = () => ({});

  await completeOrder(facility);

  assert.equal(caster.created[0].flags.importer.isStandardDragDrop, true);
});
