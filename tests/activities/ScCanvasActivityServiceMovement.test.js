import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const {
  CANVAS_TARGET_SOURCES,
  MOVEMENT_TYPES
} = await import("../../scripts/activities/canvas/ScCanvasActivityConstants.js");

function makeToken({ id, name = id, x, y, actor = null }) {
  return {
    id,
    name,
    x,
    y,
    width: 1,
    height: 1,
    actor
  };
}

function makeScene(tokens) {
  const tokenCollection = new Map(tokens.map((token) => [token.id, token]));
  tokenCollection.contents = tokens;

  return {
    id: "scene-1",
    grid: {
      size: 100,
      distance: 5
    },
    tokens: tokenCollection
  };
}

function installCanvasGlobals(t, scene) {
  globalThis.game = {
    i18n: {
      localize(key) {
        return key;
      },
      format(key) {
        return key;
      }
    },
    user: {
      id: "user-1",
      targets: new Set()
    }
  };

  globalThis.canvas = {
    scene,
    grid: {
      size: 100
    },
    tokens: {
      controlled: [],
      get(id) {
        return scene.tokens.get(id);
      }
    }
  };

  t.after(() => {
    delete globalThis.canvas;
    delete globalThis.game;
  });
}

function makeActivity(movement = {}) {
  return {
    movement: {
      distance: 10,
      maxRange: 0,
      maxTargets: 1,
      snapToGrid: false,
      type: MOVEMENT_TYPES.PUSH,
      ...movement
    }
  };
}

test("movement preview does not project a configured self target with a zero-length vector", (t) => {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300 });
  const scene = makeScene([origin]);
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ targetSource: CANVAS_TARGET_SOURCES.SELF }),
    { originTokenId: origin.id }
  );

  assert.equal(preview.targets.length, 1);
  assert.equal(preview.targets[0].token.id, origin.id);
  assert.equal(preview.targets[0].destinationPoint, null);
  assert.equal(preview.targets[0].destinationCenter, null);
  assert.deepEqual(preview.updates, []);
});

test("movement preview does not project an explicitly selected origin target with a zero-length vector", (t) => {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300 });
  const scene = makeScene([origin]);
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ targetSource: CANVAS_TARGET_SOURCES.TARGETS }),
    {
      originTokenId: origin.id,
      tokenIds: [origin.id],
      useExplicitTokenIds: true
    }
  );

  assert.equal(preview.targets.length, 1);
  assert.equal(preview.targets[0].token.id, origin.id);
  assert.equal(preview.targets[0].destinationPoint, null);
  assert.equal(preview.targets[0].destinationCenter, null);
  assert.deepEqual(preview.updates, []);
});

test("movement preview projects a configured self target using an explicit direction point", (t) => {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300 });
  const scene = makeScene([origin]);
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ targetSource: CANVAS_TARGET_SOURCES.SELF }),
    {
      originTokenId: origin.id,
      selfDirectionPoint: { x: 250, y: 450 }
    }
  );

  assert.equal(preview.targets.length, 1);
  assert.deepEqual(preview.targets[0].destinationPoint, { x: 200, y: 500 });
  assert.deepEqual(preview.targets[0].destinationCenter, { x: 250, y: 550 });
  assert.deepEqual(preview.updates, [{ id: origin.id, x: 200, y: 500 }]);
});

test("movement preview projects an explicitly selected origin target using an explicit direction point", (t) => {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300 });
  const scene = makeScene([origin]);
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ targetSource: CANVAS_TARGET_SOURCES.TARGETS }),
    {
      originTokenId: origin.id,
      selfDirectionPoint: { x: 150, y: 350 },
      tokenIds: [origin.id],
      useExplicitTokenIds: true
    }
  );

  assert.equal(preview.targets.length, 1);
  assert.deepEqual(preview.targets[0].destinationPoint, { x: 0, y: 300 });
  assert.deepEqual(preview.targets[0].destinationCenter, { x: 50, y: 350 });
  assert.deepEqual(preview.updates, [{ id: origin.id, x: 0, y: 300 }]);
});

test("movement preview applies either choice as push away from the origin", (t) => {
  const origin = makeToken({ id: "origin-token", x: 100, y: 100 });
  const target = makeToken({ id: "target-token", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ type: MOVEMENT_TYPES.EITHER }),
    {
      movementType: MOVEMENT_TYPES.PUSH,
      originTokenId: origin.id,
      tokenIds: [target.id],
      useExplicitTokenIds: true
    }
  );

  assert.equal(preview.config.type, MOVEMENT_TYPES.PUSH);
  assert.deepEqual(preview.updates, [{ id: target.id, x: 500, y: 100 }]);
});

test("movement preview applies either choice as pull toward the origin", (t) => {
  const origin = makeToken({ id: "origin-token", x: 100, y: 100 });
  const target = makeToken({ id: "target-token", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ type: MOVEMENT_TYPES.EITHER }),
    {
      movementType: MOVEMENT_TYPES.PULL,
      originTokenId: origin.id,
      tokenIds: [target.id],
      useExplicitTokenIds: true
    }
  );

  assert.equal(preview.config.type, MOVEMENT_TYPES.PULL);
  assert.deepEqual(preview.updates, [{ id: target.id, x: 100, y: 100 }]);
});

test("movement execution sends explicit self direction through the validated canvas request", async(t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300, actor });
  const scene = makeScene([origin]);
  const updates = [];
  scene.updateEmbeddedDocuments = async(documentName, documents, options) => {
    updates.push({ documentName, documents, options });
    return documents;
  };
  installCanvasGlobals(t, scene);

  const activity = {
    uuid: "Activity.movement",
    actor,
    movement: {
      distance: 10,
      maxRange: 0,
      maxTargets: 1,
      snapToGrid: false,
      targetSource: CANVAS_TARGET_SOURCES.SELF,
      type: MOVEMENT_TYPES.PUSH
    }
  };

  globalThis.game.user.isGM = true;
  globalThis.game.scenes = {
    get(id) {
      return id === scene.id ? scene : null;
    }
  };
  globalThis.game.users = {
    get(id) {
      return id === globalThis.game.user.id ? globalThis.game.user : null;
    }
  };
  globalThis.ui = {
    notifications: {
      info() {},
      warn() {},
      error() {}
    }
  };
  globalThis.fromUuid = async(uuid) => uuid === activity.uuid ? activity : null;

  t.after(() => {
    delete globalThis.fromUuid;
    delete globalThis.ui;
  });

  const result = await ScCanvasActivityService.executeMovement(activity, {
    originTokenId: origin.id,
    selfDirectionPoint: { x: 250, y: 450 },
    tokenIds: [origin.id]
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.deepEqual(updates, [{
    documentName: "Token",
    documents: [{ _id: origin.id, x: 200, y: 500 }],
    options: { animate: false }
  }]);
});

test("movement execution validates and applies the push choice for either movement", async(t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const origin = makeToken({ id: "origin-token", x: 100, y: 100, actor });
  const target = makeToken({ id: "target-token", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  const updates = [];
  scene.updateEmbeddedDocuments = async(documentName, documents, options) => {
    updates.push({ documentName, documents, options });
    return documents;
  };
  installCanvasGlobals(t, scene);

  const activity = {
    uuid: "Activity.either-movement",
    actor,
    movement: {
      distance: 10,
      maxRange: 0,
      maxTargets: 1,
      snapToGrid: false,
      targetSource: CANVAS_TARGET_SOURCES.TARGETS,
      type: MOVEMENT_TYPES.EITHER
    }
  };

  globalThis.game.user.isGM = true;
  globalThis.game.scenes = { get: (id) => id === scene.id ? scene : null };
  globalThis.game.users = { get: (id) => id === globalThis.game.user.id ? globalThis.game.user : null };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.fromUuid = async(uuid) => uuid === activity.uuid ? activity : null;

  t.after(() => {
    delete globalThis.fromUuid;
    delete globalThis.ui;
  });

  const result = await ScCanvasActivityService.executeMovement(activity, {
    movementType: MOVEMENT_TYPES.PUSH,
    originTokenId: origin.id,
    tokenIds: [target.id]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(updates, [{
    documentName: "Token",
    documents: [{ _id: target.id, x: 500, y: 100 }],
    options: { animate: false }
  }]);
});
