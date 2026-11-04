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

test("teleport execution refuses a destination another token stands on", async(t) => {
  const origin = makeToken({ id: "origin-occupied", x: 0, y: 0 });
  const target = makeToken({ id: "target-occupied", x: 100, y: 0 });
  const bystander = makeToken({ id: "bystander-occupied", x: 300, y: 300 });
  const scene = makeScene([origin, target, bystander]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: { maxTargets: 1, targetRadius: 0, teleportDistance: 0, snapToGrid: true }
  };
  installGlobals(t, { scene, activity });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: origin.id,
    tokenIds: [target.id],
    destination: { x: 350, y: 350 }
  });

  assert.equal(result.ok, false);
  assert.equal(scene.updates.length, 0);
});

test("a hidden token does not block a teleport the player could not know about", async(t) => {
  const origin = makeToken({ id: "origin-hidden", x: 0, y: 0 });
  const target = makeToken({ id: "target-hidden", x: 100, y: 0 });
  const lurker = { ...makeToken({ id: "lurker-hidden", x: 300, y: 300 }), hidden: true };
  const scene = makeScene([origin, target, lurker]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: { maxTargets: 1, targetRadius: 0, teleportDistance: 0, snapToGrid: true }
  };
  installGlobals(t, { scene, activity });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: origin.id,
    tokenIds: [target.id],
    destination: { x: 350, y: 350 }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(scene.updates, [{ _id: target.id, x: 300, y: 300 }]);
});

test("a group teleport leaves behind only the member whose landing is occupied", async(t) => {
  const origin = makeToken({ id: "origin-group", x: 0, y: 0 });
  const left = makeToken({ id: "left-group", name: "Left", x: 100, y: 0 });
  const right = makeToken({ id: "right-group", name: "Right", x: 200, y: 0 });
  // Keeping the arrangement puts Left on 300,300 and Right on 400,300.
  const bystander = makeToken({ id: "bystander-group", x: 400, y: 300 });
  const scene = makeScene([origin, left, right, bystander]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: { maxTargets: 2, targetRadius: 0, teleportDistance: 0, keepArrangement: true, snapToGrid: true }
  };
  installGlobals(t, { scene, activity });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: origin.id,
    tokenIds: [left.id, right.id],
    destination: { x: 400, y: 350 }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.skipped, ["Right"]);
  assert.deepEqual(scene.updates.map((update) => update._id), [left.id]);
});

test("the placement preview flags an occupied landing and a landing out of sight", (t) => {
  const origin = makeToken({ id: "origin-preview", x: 0, y: 0 });
  const target = makeToken({ id: "target-preview", x: 100, y: 0 });
  const bystander = makeToken({ id: "bystander-preview", x: 300, y: 0 });
  const scene = makeScene([origin, target, bystander]);
  const activity = {
    actor: { testUserPermission: () => true, getActiveTokens: () => [origin] },
    teleport: { maxTargets: 1, teleportDistance: 0, snapToGrid: true }
  };
  installGlobals(t, { scene, activity });
  globalThis.canvas.tokens = { controlled: [origin], get: (id) => scene.tokens.get(id) };

  const preview = (destination, sightProbe = null) => ScCanvasActivityService.getTeleportPlacementPreview(activity, {
    tokenIds: [target.id],
    destination,
    sightProbe
  });

  assert.equal(preview({ x: 350, y: 50 })?.blocked, "occupied");
  assert.equal(preview({ x: 550, y: 50 })?.blocked, null);
  // Sight stops at x = 450: the landing at 550 is behind a wall.
  const probe = { kind: "polygon", test: (point) => point.x < 450 };
  assert.equal(preview({ x: 550, y: 50 }, probe)?.blocked, "sight");
});

test("the GM only counts the occupants the requesting player reported perceiving", async(t) => {
  const origin = makeToken({ id: "origin-perceive", x: 0, y: 0 });
  const target = makeToken({ id: "target-perceive", x: 100, y: 0 });
  // Not hidden, but invisible to the player: their client never saw it.
  const unseen = makeToken({ id: "unseen-perceive", x: 300, y: 300 });
  const scene = makeScene([origin, target, unseen]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: { maxTargets: 1, targetRadius: 0, teleportDistance: 0, snapToGrid: true }
  };
  installGlobals(t, { scene, activity });
  const payload = {
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: origin.id,
    tokenIds: [target.id],
    destination: { x: 350, y: 350 }
  };

  const unseenResult = await ScCanvasActivityService.handleCanvasQuery({
    ...payload,
    perceivedTokenIds: [origin.id, target.id],
    executionKey: "perceive-1"
  });
  assert.equal(unseenResult.ok, true);

  target.x = 100;
  target.y = 0;
  scene.updates.length = 0;
  const seenResult = await ScCanvasActivityService.handleCanvasQuery({
    ...payload,
    perceivedTokenIds: [origin.id, target.id, unseen.id],
    executionKey: "perceive-2"
  });
  assert.equal(seenResult.ok, false);
  assert.equal(scene.updates.length, 0);
});

test("a stranded group member blocks the teammate that would land on it", async(t) => {
  const origin = makeToken({ id: "origin-strand", x: 0, y: 500 });
  const first = makeToken({ id: "first-strand", name: "First", x: 100, y: 0 });
  const second = makeToken({ id: "second-strand", name: "Second", x: 200, y: 0 });
  // Keeping the arrangement sends First to 200,0 (Second's space) and Second
  // to 300,0, where the bystander stands. Second stays put, so First cannot go.
  const bystander = makeToken({ id: "bystander-strand", x: 300, y: 0 });
  const scene = makeScene([origin, first, second, bystander]);
  const activity = {
    actor: { testUserPermission: () => true },
    teleport: { maxTargets: 2, targetRadius: 0, teleportDistance: 0, keepArrangement: true, snapToGrid: true }
  };
  installGlobals(t, { scene, activity });

  const result = await ScCanvasActivityService.handleCanvasQuery({
    operation: "teleport",
    activityUuid: "Activity.abc",
    sceneId: "scene-1",
    requestUserId: "player",
    originTokenId: origin.id,
    tokenIds: [first.id, second.id],
    destination: { x: 300, y: 50 }
  });

  assert.equal(result.ok, false);
  assert.equal(scene.updates.length, 0);
});
