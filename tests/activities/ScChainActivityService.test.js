import test from "node:test";
import assert from "node:assert/strict";

globalThis.ui = {
  notifications: {
    warn() {},
    error() {}
  }
};

const { ScChainActivityService } = await import("../../scripts/activities/chain/ScChainActivityService.js");

function makeActivity({ suppressChildMessages = false, onUse }) {
  const child = {
    id: "child",
    name: "Child",
    type: "utility",
    uuid: "Item.item-1.Activity.child",
    async use(usage, dialog, message) {
      return onUse(usage, dialog, message);
    }
  };
  const item = {
    id: "item-1",
    uuid: "Item.item-1",
    system: { activities: new Map([["child", child]]) }
  };
  child.item = item;
  return {
    id: "chain",
    name: "Chain",
    type: "sc-chain",
    uuid: "Item.item-1.Activity.chain",
    item,
    chain: {
      activityIds: "child",
      suppressChildMessages
    }
  };
}

test("suppresses child usage cards when the chain option is enabled", async() => {
  let receivedMessage;
  const activity = makeActivity({
    suppressChildMessages: true,
    onUse(_usage, _dialog, message) {
      receivedMessage = message;
      return { message: { id: "child-message" }, updates: [], effects: [], templates: [] };
    }
  });

  await ScChainActivityService.execute(activity, {
    usage: {},
    dialog: {},
    message: { data: { flavor: "parent" } }
  });

  assert.equal(receivedMessage.create, false);
  assert.deepEqual(receivedMessage.data, { flavor: "parent" });
});

test("preserves the child message configuration when suppression is disabled", async() => {
  const parentMessage = { data: { flavor: "parent" } };
  let receivedMessage;
  const activity = makeActivity({
    onUse(_usage, _dialog, message) {
      receivedMessage = message;
      return { message: { id: "child-message" }, updates: [], effects: [], templates: [] };
    }
  });

  await ScChainActivityService.execute(activity, { usage: {}, dialog: {}, message: parentMessage });

  assert.equal(receivedMessage, parentMessage);
  assert.equal(receivedMessage.create, undefined);
});
