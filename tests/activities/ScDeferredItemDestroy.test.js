import test from "node:test";
import assert from "node:assert/strict";

const listeners = new Map();
globalThis.Hooks = {
  on(event, fn) { (listeners.get(event) ?? listeners.set(event, []).get(event)).push(fn); },
  call(event, ...args) { return (listeners.get(event) ?? []).every((fn) => fn(...args) !== false); }
};

const { ScDeferredItemDestroy } = await import("../../scripts/activities/ScDeferredItemDestroy.js");
ScDeferredItemDestroy.registerHooks();

const MODULE = "sc-more-activities";

/** An actor whose item deletions go through `preDeleteItem`, as Foundry's do. */
function makeActor(uuid = "Actor.hero") {
  const items = new Map();
  return {
    uuid,
    items,
    async createEmbeddedDocuments(_type, list) {
      for (const data of list) items.set(data._id, { ...structuredClone({ ...data, parent: undefined }), parent: this });
    },
    async updateEmbeddedDocuments(_type, list) {
      for (const { _id, ...changes } of list) {
        const item = items.get(_id);
        for (const [key, value] of Object.entries(changes)) {
          const path = key.split(".");
          let target = item;
          for (const part of path.slice(0, -1)) target = target[part] ??= {};
          target[path.at(-1)] = value;
        }
      }
    },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) {
        if (items.has(id) && Hooks.call("preDeleteItem", items.get(id))) items.delete(id);
      }
    }
  };
}

function setup({ quantity = 1, uuid } = {}) {
  const actor = makeActor(uuid);
  const scroll = { _id: "scroll", id: "scroll", parent: actor, system: { quantity, uses: { max: 1, spent: 0 } }, flags: {} };
  actor.items.set("scroll", scroll);
  // dnd5e works on a clone of the item: same id, same actor, not the stored document.
  const activity = { item: { id: "scroll", actor } };
  return { actor, activity };
}

/** dnd5e's consume for a last auto-destroyed scroll: the deletion is recorded, then applied. */
function spendLastScroll(actor, { stopAfter = false } = {}) {
  return async () => {
    const { parent, ...data } = actor.items.get("scroll");
    const deltas = { deleted: [structuredClone(data)] };
    await actor.deleteEmbeddedDocuments("Item", ["scroll"]);
    return stopAfter ? false : { delete: ["scroll"], deltas };
  };
}

test("the last scroll stays, spent, until the use is done, then goes", async() => {
  const { actor, activity } = setup();
  const config = ScDeferredItemDestroy.usage();

  await ScDeferredItemDestroy.consume(activity, config, spendLastScroll(actor));

  const kept = actor.items.get("scroll");
  assert.ok(kept, "still there while the GM checks the request");
  assert.equal(kept.system.quantity, 0);
  assert.equal(kept.system.uses.spent, 1);
  assert.equal(kept.flags[MODULE].spentByUse, true);

  await ScDeferredItemDestroy.release(config);

  assert.equal(actor.items.has("scroll"), false);
});

test("dnd5e consumes with a clone of the usage, and releasing the options given to use still frees the scroll", async() => {
  const { actor, activity } = setup();
  const usage = ScDeferredItemDestroy.usage();

  await ScDeferredItemDestroy.consume(activity, structuredClone(usage), spendLastScroll(actor));
  assert.ok(actor.items.has("scroll"));
  // The use threw before `_finalizeUsage` (say, creating its chat message): `use` releases what it passed in.
  await ScDeferredItemDestroy.release(usage);

  assert.equal(actor.items.has("scroll"), false);
});

test("each use is held apart: releasing one leaves another actor's held scroll alone", async() => {
  const first = setup({ uuid: "Actor.first" });
  const second = setup({ uuid: "Actor.second" });
  const firstUsage = ScDeferredItemDestroy.usage();
  const secondUsage = ScDeferredItemDestroy.usage();
  await ScDeferredItemDestroy.consume(first.activity, firstUsage, spendLastScroll(first.actor));
  await ScDeferredItemDestroy.consume(second.activity, secondUsage, spendLastScroll(second.actor));

  await ScDeferredItemDestroy.release(firstUsage);

  assert.equal(first.actor.items.has("scroll"), false);
  assert.ok(second.actor.items.has("scroll"));
  await ScDeferredItemDestroy.release(secondUsage);
  assert.equal(second.actor.items.has("scroll"), false);
});

test("dnd5e records the deletion as usual, so a refund brings the scroll back as it was", async() => {
  const { actor, activity } = setup();
  const config = ScDeferredItemDestroy.usage();

  const { deltas } = await ScDeferredItemDestroy.consume(activity, config, spendLastScroll(actor));
  await ScDeferredItemDestroy.release(config);
  // dnd5e's refund recreates what `deltas.deleted` holds.
  await actor.createEmbeddedDocuments("Item", deltas.deleted);

  assert.equal(actor.items.get("scroll").system.quantity, 1);
  assert.equal(actor.items.get("scroll").system.uses.spent, 0);
});

/**
 * dnd5e's refund from the chat card, after the activity's own `refund` makes
 * way: it recreates what was deleted, but skips an id that is still taken.
 */
async function refundFromCard(actor, deltas) {
  await ScDeferredItemDestroy.prepareRefund(actor, deltas);
  await actor.createEmbeddedDocuments("Item", deltas.deleted.filter((data) => !actor.items.has(data._id)));
}

test("a refund while the use is still going brings the scroll back, and the end of the use leaves it", async() => {
  const { actor, activity } = setup();
  const config = ScDeferredItemDestroy.usage();
  const { deltas } = await ScDeferredItemDestroy.consume(activity, config, spendLastScroll(actor));

  // Clicked on the chat card while the user still has the window open, on any client.
  await refundFromCard(actor, deltas);
  await ScDeferredItemDestroy.release(config);

  const scroll = actor.items.get("scroll");
  assert.ok(scroll, "the refunded scroll is not taken by the end of the use");
  assert.equal(scroll.system.quantity, 1);
  assert.equal(scroll.system.uses.spent, 0);
  assert.equal(scroll.flags[MODULE], undefined);
});

test("making way for a refund deletes only a held, spent item", async() => {
  const { actor } = setup({ quantity: 2 });

  await ScDeferredItemDestroy.prepareRefund(actor, { deleted: [{ _id: "scroll" }, { _id: "gone" }] });
  await ScDeferredItemDestroy.prepareRefund(actor, null);

  assert.equal(actor.items.get("scroll").system.quantity, 2);
});

test("a scroll that cannot be marked spent is deleted at once, rather than kept looking unspent", async() => {
  const { actor, activity } = setup();
  actor.updateEmbeddedDocuments = async() => { throw new Error("update refused"); };
  const config = ScDeferredItemDestroy.usage();

  await ScDeferredItemDestroy.consume(activity, config, spendLastScroll(actor));

  assert.equal(actor.items.has("scroll"), false);
  await ScDeferredItemDestroy.release(config);
});

test("consuming from the chat card, which never finalizes, is left to dnd5e", async() => {
  const { actor, activity } = setup();

  await ScDeferredItemDestroy.consume(activity, { consume: true }, spendLastScroll(actor));

  assert.equal(actor.items.has("scroll"), false);
});

test("a use stopped after consuming deletes the scroll at once, since nothing will release it", async() => {
  const { actor, activity } = setup();

  const updates = await ScDeferredItemDestroy.consume(activity, ScDeferredItemDestroy.usage(), spendLastScroll(actor, { stopAfter: true }));

  assert.equal(updates, false);
  assert.equal(actor.items.has("scroll"), false);
});

test("a consumption failing after the held-back deletion still deletes the scroll, then rethrows", async() => {
  const { actor, activity } = setup();
  const config = ScDeferredItemDestroy.usage();
  const failure = new Error("consume failed");

  await assert.rejects(
    ScDeferredItemDestroy.consume(activity, config, async() => {
      await spendLastScroll(actor)();
      throw failure;
    }),
    failure
  );

  assert.equal(actor.items.has("scroll"), false);
  await ScDeferredItemDestroy.release(config);
  assert.equal(actor.items.has("scroll"), false);
});

test("a consumption failing before any deletion leaves the scroll alone and rethrows", async() => {
  const { actor, activity } = setup();
  const failure = new Error("consume failed");

  await assert.rejects(
    ScDeferredItemDestroy.consume(activity, ScDeferredItemDestroy.usage(), async() => { throw failure; }),
    failure
  );

  assert.equal(actor.items.get("scroll").system.quantity, 1);
  await actor.deleteEmbeddedDocuments("Item", ["scroll"]);
  assert.equal(actor.items.has("scroll"), false, "the hold ended with the failed consumption");
});

test("a scroll left in the stack is not held", async() => {
  const { actor, activity } = setup({ quantity: 2 });
  const config = ScDeferredItemDestroy.usage();

  await ScDeferredItemDestroy.consume(activity, config, async() => ({ delete: [] }));
  await ScDeferredItemDestroy.release(config);

  assert.equal(actor.items.get("scroll").system.quantity, 2);
  assert.equal(actor.items.get("scroll").flags[MODULE], undefined);
});

test("the hold ends with the consumption: deleting the item later is not blocked", async() => {
  const { actor, activity } = setup({ quantity: 2 });

  await ScDeferredItemDestroy.consume(activity, ScDeferredItemDestroy.usage(), async() => ({ delete: [] }));
  await actor.deleteEmbeddedDocuments("Item", ["scroll"]);

  assert.equal(actor.items.has("scroll"), false);
});

test("whoever runs the effect discards a spent scroll before moving tokens, and only a spent one", async() => {
  const { actor, activity } = setup();

  await ScDeferredItemDestroy.discardSpent(activity);
  assert.ok(actor.items.has("scroll"), "an unspent scroll stays");

  const config = ScDeferredItemDestroy.usage();
  await ScDeferredItemDestroy.consume(activity, config, spendLastScroll(actor));
  await ScDeferredItemDestroy.discardSpent(activity);
  assert.equal(actor.items.has("scroll"), false);

  await ScDeferredItemDestroy.release(config);
});

test("two actors spending scrolls with the same id at once each keep and lose their own", async() => {
  const first = setup({ uuid: "Scene.a.Token.copy1.Actor.hero" });
  const second = setup({ uuid: "Scene.a.Token.copy2.Actor.hero" });
  const firstConfig = ScDeferredItemDestroy.usage();
  const secondConfig = ScDeferredItemDestroy.usage();
  let letFirstFinish;
  const firstWaits = new Promise((resolve) => { letFirstFinish = resolve; });

  const firstUse = ScDeferredItemDestroy.consume(first.activity, firstConfig, async() => {
    await firstWaits;
    return spendLastScroll(first.actor)();
  });
  await ScDeferredItemDestroy.consume(second.activity, secondConfig, spendLastScroll(second.actor));
  letFirstFinish();
  await firstUse;

  for (const { actor } of [first, second]) {
    assert.equal(actor.items.get("scroll").system.quantity, 0, "held and spent");
  }
  await ScDeferredItemDestroy.release(firstConfig);
  await ScDeferredItemDestroy.release(secondConfig);
  assert.equal(first.actor.items.has("scroll"), false);
  assert.equal(second.actor.items.has("scroll"), false);
});

test("an unlinked token's scroll is matched through the ActorDelta it is deleted from", async() => {
  const { actor, activity } = setup({ uuid: "Scene.a.Token.goblin.Actor.goblin" });
  const delta = { documentName: "ActorDelta", syntheticActor: actor };
  actor.items.get("scroll").parent = delta;
  const config = ScDeferredItemDestroy.usage();

  await ScDeferredItemDestroy.consume(activity, config, spendLastScroll(actor));

  assert.ok(actor.items.has("scroll"));
  await ScDeferredItemDestroy.release(config);
  assert.equal(actor.items.has("scroll"), false);
});
