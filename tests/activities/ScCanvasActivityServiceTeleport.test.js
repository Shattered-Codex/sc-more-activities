import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");

function makeToken({ id, name = id, x, y }) {
  return {
    id,
    name,
    x,
    y,
    width: 1,
    height: 1,
    actor: { testUserPermission: () => true }
  };
}

function makeScene(tokens) {
  const collection = new Map(tokens.map((token) => [token.id, token]));
  collection.contents = tokens;
  const updates = [];
  return {
    id: "scene-1",
    grid: { size: 100, distance: 5 },
    tokens: collection,
    updates,
    async updateEmbeddedDocuments(_type, tokenUpdates) {
      updates.push(...tokenUpdates);
      return tokenUpdates;
    }
  };
}

function installGlobals(t, { scene, activity }) {
  globalThis.game = {
    i18n: {
      localize: (key) => key,
      format: (key) => key
    },
    user: { id: "gm", isGM: true },
    users: new Map([["player", { id: "player", isGM: false, active: true }]]),
    scenes: new Map([[scene.id, scene]])
  };
  globalThis.canvas = {
    scene,
    grid: { size: 100 }
  };
  globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
  globalThis.fromUuid = async(uuid) => (uuid === "Activity.abc" ? activity : null);

  t.after(() => {
    delete globalThis.game;
    delete globalThis.canvas;
    delete globalThis.ui;
    delete globalThis.fromUuid;
  });
}

test("teleport execution re-validates the target radius and skips far targets", async(t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const near = makeToken({ id: "near", name: "Near", x: 100, y: 0 });
  const far = makeToken({ id: "far", name: "Far", x: 500, y: 0 });
  const scene = makeScene([origin, near, far]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: {
      maxTargets: 5,
      targetRadius: 10,
      teleportDistance: 0,
      keepArrangement: false,
      clusterRadius: 0,
      snapToGrid: false
    }
  };
  installGlobals(t, { scene, activity });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: "origin",
    tokenIds: ["near", "far"],
    destination: { x: 300, y: 300 }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.skipped, ["Far"]);
  assert.deepEqual(scene.updates.map((update) => update._id), ["near"]);
});

test("teleport execution fails when every target left the radius", async(t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const far = makeToken({ id: "far", name: "Far", x: 500, y: 0 });
  const scene = makeScene([origin, far]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: {
      maxTargets: 5,
      targetRadius: 10,
      teleportDistance: 0,
      snapToGrid: false
    }
  };
  installGlobals(t, { scene, activity });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: "origin",
    tokenIds: ["far"],
    destination: { x: 300, y: 300 }
  });

  assert.equal(result.ok, false);
  assert.deepEqual(scene.updates, []);
});

test("an execution key makes duplicate token operations impossible", async(t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const near = makeToken({ id: "near", name: "Near", x: 100, y: 0 });
  const scene = makeScene([origin, near]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: {
      maxTargets: 5,
      targetRadius: 0,
      teleportDistance: 0,
      snapToGrid: false
    }
  };
  installGlobals(t, { scene, activity });

  const payload = {
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: "origin",
    tokenIds: ["near"],
    destination: { x: 300, y: 300 },
    executionKey: "message-1"
  };

  const first = await ScCanvasActivityService.handleCanvasQuery(payload);
  assert.equal(first.ok, true);
  assert.equal(scene.updates.length, 1);

  const second = await ScCanvasActivityService.handleCanvasQuery(payload);
  assert.equal(second.ok, false);
  assert.equal(scene.updates.length, 1);
});

test("a zero target radius keeps every requested target eligible", async(t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const far = makeToken({ id: "far", name: "Far", x: 500, y: 0 });
  const scene = makeScene([origin, far]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: {
      maxTargets: 5,
      targetRadius: 0,
      teleportDistance: 0,
      snapToGrid: false
    }
  };
  installGlobals(t, { scene, activity });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: "origin",
    tokenIds: ["far"],
    destination: { x: 300, y: 300 }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(scene.updates.map((update) => update._id), ["far"]);
});
