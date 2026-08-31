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

function installGlobals(t, { scene, activity, squareTemplates = false }) {
  globalThis.game = {
    i18n: {
      localize: (key) => key,
      format: (key) => key
    },
    user: { id: "gm", isGM: true },
    settings: {
      get(namespace, key) {
        return namespace === "dnd5e" && key === "gridAlignedSquareTemplates" && squareTemplates;
      }
    },
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

test("square teleport range counts a diagonal as one space", () => {
  const scene = { grid: { size: 100, distance: 5 } };
  const origin = { x: 0, y: 0 };
  const diagonal = { x: 600, y: 600 };

  globalThis.game = { settings: { get: () => false } };
  assert.ok(ScCanvasActivityService.rangeSceneDistance(origin, diagonal, "system", scene) > 30);
  globalThis.game.settings.get = () => true;
  assert.ok(ScCanvasActivityService.rangeSceneDistance(origin, diagonal, undefined, scene) > 30);
  assert.equal(
    ScCanvasActivityService.rangeSceneDistance(origin, diagonal, "system", scene),
    30
  );
  globalThis.game.settings.get = () => false;
  assert.equal(
    ScCanvasActivityService.rangeSceneDistance(origin, diagonal, "square", scene),
    30
  );
  assert.ok(
    ScCanvasActivityService.rangeSceneDistance(origin, diagonal, "circle", scene) > 30
  );
  delete globalThis.game;
});

test("circle target range stays circular even when the grid measures diagonals as squares", (t) => {
  const scene = { grid: { size: 100, distance: 5 } };
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const diagonal = makeToken({ id: "diagonal", x: 600, y: 600 });
  globalThis.canvas = {
    scene,
    grid: {
      size: 100,
      measurePath: () => ({ distance: 30 })
    }
  };
  t.after(() => delete globalThis.canvas);

  assert.ok(ScCanvasActivityService.rangeDistanceBetweenTokens(origin, diagonal, "circle", scene) > 30);
  assert.equal(ScCanvasActivityService.rangeDistanceBetweenTokens(origin, diagonal, "square", scene), 30);
});

test("legacy grid range delegates to Foundry scene measurement", (t) => {
  const scene = { grid: { size: 100, distance: 5 } };
  globalThis.canvas = {
    scene,
    grid: {
      size: 100,
      measurePath: () => ({ distance: 17 })
    }
  };
  t.after(() => delete globalThis.canvas);

  assert.equal(
    ScCanvasActivityService.rangeSceneDistance({ x: 0, y: 0 }, { x: 600, y: 600 }, "grid", scene),
    17
  );
});

test("server validation accepts a destination in a square range corner", async(t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const target = makeToken({ id: "target", x: 100, y: 0 });
  const scene = makeScene([origin, target]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: {
      maxTargets: 1,
      targetRadius: 0,
      teleportDistance: 30,
      rangeShape: "square",
      snapToGrid: false
    }
  };
  installGlobals(t, { scene, activity, squareTemplates: false });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: "origin",
    tokenIds: ["target"],
    destination: { x: 650, y: 650 }
  });

  assert.equal(result.ok, true);
  assert.equal(scene.updates.length, 1);
});

test("teleport target range accepts a diagonal corner only for square shape", async(t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const target = makeToken({ id: "target", x: 600, y: 600 });
  const scene = makeScene([origin, target]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: {
      maxTargets: 1,
      targetRadius: 30,
      teleportDistance: 0,
      rangeShape: "circle",
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
    tokenIds: ["target"],
    destination: { x: 300, y: 300 }
  };

  const circular = await ScCanvasActivityService.handleCanvasQuery(payload);
  assert.equal(circular.ok, false);

  activity.teleport.rangeShape = "square";
  const square = await ScCanvasActivityService.handleCanvasQuery(payload);
  assert.equal(square.ok, true);
});

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
