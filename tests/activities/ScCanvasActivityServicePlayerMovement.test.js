import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const { MOVEMENT_TYPES, CANVAS_TARGET_SOURCES } = await import(
  "../../scripts/activities/canvas/ScCanvasActivityConstants.js"
);
const { SETTINGS_KEYS } = await import("../../scripts/constants/SettingsKeys.js");

const SETTING_KEY = `sc-more-activities.${SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT}`;

function makeToken({ id, x, y, ownedBy = null }) {
  return {
    id,
    name: id,
    x,
    y,
    width: 1,
    height: 1,
    actor: null,
    testUserPermission: (user) => user?.id === ownedBy
  };
}

function makeScene(tokens) {
  const collection = new Map(tokens.map((token) => [token.id, token]));
  collection.contents = tokens;

  const scene = {
    id: "scene-1",
    width: 4000,
    height: 4000,
    grid: { size: 100, distance: 5 },
    tokens: collection,
    moved: []
  };
  scene.updateEmbeddedDocuments = async(documentName, documents) => {
    scene.moved.push({ documentName, documents });
    return documents;
  };
  return scene;
}

/**
 * The GM client is the one that validates and executes, so the test runs as a
 * GM handling a query whose `requestUserId` names a player.
 */
function installGlobals(t, scene, { allowPlayerTokenMovement }) {
  const gm = { id: "gm", isGM: true, targets: new Set() };
  const player = { id: "player", isGM: false, active: true };

  globalThis.game = {
    i18n: { localize: (key) => `i18n:${key}`, format: (key) => `i18n:${key}` },
    user: gm,
    users: {
      get: (id) => (id === gm.id ? gm : (id === player.id ? player : null))
    },
    scenes: { get: (id) => (id === scene.id ? scene : null) },
    settings: {
      settings: { has: (key) => key === SETTING_KEY },
      get: (_moduleId, key) => (
        key === SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT ? allowPlayerTokenMovement : undefined
      )
    }
  };

  globalThis.canvas = {
    scene,
    grid: { size: 100 },
    tokens: { controlled: [], get: (id) => scene.tokens.get(id) }
  };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

  t.after(() => {
    delete globalThis.canvas;
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.fromUuid;
  });

  return { gm, player };
}

function makeActivity({ ownedBy = "player" } = {}) {
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    testUserPermission: (user) => user?.id === ownedBy
  };
  return {
    uuid: "Activity.push",
    actor,
    item: { actor, testUserPermission: (user) => user?.id === ownedBy },
    movement: {
      distance: 10,
      maxRange: 0,
      maxTargets: 1,
      snapToGrid: false,
      targetSource: CANVAS_TARGET_SOURCES.TARGETS,
      type: MOVEMENT_TYPES.PUSH
    }
  };
}

function pushRequest(scene, activity, { originId, targetId, executionKey }) {
  return {
    activityUuid: activity.uuid,
    executionKey,
    operation: "movement",
    originTokenId: originId,
    requestUserId: "player",
    sceneId: scene.id,
    tokenIds: [targetId]
  };
}

test("a player pushes a token they do not own while the world setting allows it", async(t) => {
  const origin = makeToken({ id: "hero", x: 100, y: 100, ownedBy: "player" });
  const enemy = makeToken({ id: "ogre", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([origin, enemy]);
  installGlobals(t, scene, { allowPlayerTokenMovement: true });

  const activity = makeActivity();
  origin.actor = activity.actor;
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  const result = await ScCanvasActivityService.handleCanvasQuery(
    pushRequest(scene, activity, { originId: origin.id, targetId: enemy.id, executionKey: "key-allowed" })
  );

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.deepEqual(scene.moved, [{
    documentName: "Token",
    documents: [{ _id: enemy.id, x: 500, y: 100 }]
  }]);
});

test("the same push is refused once the world setting is turned off", async(t) => {
  const origin = makeToken({ id: "hero", x: 100, y: 100, ownedBy: "player" });
  const enemy = makeToken({ id: "ogre", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([origin, enemy]);
  installGlobals(t, scene, { allowPlayerTokenMovement: false });

  const activity = makeActivity();
  origin.actor = activity.actor;
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  const result = await ScCanvasActivityService.handleCanvasQuery(
    pushRequest(scene, activity, { originId: origin.id, targetId: enemy.id, executionKey: "key-refused" })
  );

  assert.equal(result.ok, false);
  assert.equal(result.message, "i18n:SCMOREACTIVITIES.Activities.Canvas.Warning.TokenPermission");
  assert.deepEqual(scene.moved, []);
});

test("the setting does not let a player use an activity they do not own", async(t) => {
  const origin = makeToken({ id: "hero", x: 100, y: 100, ownedBy: "player" });
  const enemy = makeToken({ id: "ogre", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([origin, enemy]);
  installGlobals(t, scene, { allowPlayerTokenMovement: true });

  const activity = makeActivity({ ownedBy: "someone-else" });
  origin.actor = activity.actor;
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  const result = await ScCanvasActivityService.handleCanvasQuery(
    pushRequest(scene, activity, { originId: origin.id, targetId: enemy.id, executionKey: "key-foreign" })
  );

  assert.equal(result.ok, false);
  assert.equal(result.message, "i18n:SCMOREACTIVITIES.Activities.Canvas.Warning.ActivityPermission");
  assert.deepEqual(scene.moved, []);
});

test("the setting does not let a player drive an origin token from another actor", async(t) => {
  const origin = makeToken({ id: "hero", x: 100, y: 100, ownedBy: "player" });
  const enemy = makeToken({ id: "ogre", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([origin, enemy]);
  installGlobals(t, scene, { allowPlayerTokenMovement: true });

  const activity = makeActivity();
  // The origin token belongs to somebody else, so it cannot stand in for the
  // activity's actor no matter what the setting says.
  origin.actor = { id: "actor-2", uuid: "Actor.actor-2" };
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  const result = await ScCanvasActivityService.handleCanvasQuery(
    pushRequest(scene, activity, { originId: origin.id, targetId: enemy.id, executionKey: "key-foreign-origin" })
  );

  assert.equal(result.ok, false);
  assert.equal(result.message, "i18n:SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest");
  assert.deepEqual(scene.moved, []);
});

test("the target selectors follow the setting through canMoveToken", (t) => {
  const enemy = makeToken({ id: "ogre", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([enemy]);
  const { player } = installGlobals(t, scene, { allowPlayerTokenMovement: true });

  assert.equal(ScCanvasActivityService.canMoveToken(enemy, player), true);

  globalThis.game.settings.get = () => false;
  assert.equal(ScCanvasActivityService.canMoveToken(enemy, player), false);
});

test("the size rule blocks a target on the GM client, not just in the preview", async(t) => {
  const origin = makeToken({ id: "hero", x: 100, y: 100, ownedBy: "player" });
  const ogre = makeToken({ id: "ogre", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([origin, ogre]);
  installGlobals(t, scene, { allowPlayerTokenMovement: true });

  const activity = makeActivity();
  origin.actor = activity.actor;
  origin.actor.system = { traits: { size: "med" } };
  // A huge ogre is three steps up from a medium origin.
  ogre.actor = { system: { traits: { size: "huge" } } };
  activity.movement.targetSize = { mode: "relative", minOffset: -1, maxOffset: 1 };
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  const result = await ScCanvasActivityService.handleCanvasQuery(
    pushRequest(scene, activity, { originId: origin.id, targetId: ogre.id, executionKey: "key-size" })
  );

  assert.equal(result.ok, false, "no target survives the size rule");
  assert.deepEqual(scene.moved, [], "the ogre must not move");
});

test("a target inside the size rule still moves", async(t) => {
  const origin = makeToken({ id: "hero", x: 100, y: 100, ownedBy: "player" });
  const goblin = makeToken({ id: "goblin", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([origin, goblin]);
  installGlobals(t, scene, { allowPlayerTokenMovement: true });

  const activity = makeActivity();
  origin.actor = activity.actor;
  origin.actor.system = { traits: { size: "med" } };
  goblin.actor = { system: { traits: { size: "sm" } } };
  activity.movement.targetSize = { mode: "relative", minOffset: -1, maxOffset: 1 };
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  const result = await ScCanvasActivityService.handleCanvasQuery(
    pushRequest(scene, activity, { originId: origin.id, targetId: goblin.id, executionKey: "key-size-ok" })
  );

  assert.equal(result.ok, true);
  assert.deepEqual(scene.moved, [{ documentName: "Token", documents: [{ _id: goblin.id, x: 500, y: 100 }] }]);
});

test("an absolute size list is enforced server side too", async(t) => {
  const origin = makeToken({ id: "hero", x: 100, y: 100, ownedBy: "player" });
  const target = makeToken({ id: "target", x: 300, y: 100, ownedBy: "gm" });
  const scene = makeScene([origin, target]);
  installGlobals(t, scene, { allowPlayerTokenMovement: true });

  const activity = makeActivity();
  origin.actor = activity.actor;
  target.actor = { system: { traits: { size: "med" } } };
  activity.movement.targetSize = { mode: "absolute", sizes: ["tiny", "sm"] };
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  const result = await ScCanvasActivityService.handleCanvasQuery(
    pushRequest(scene, activity, { originId: origin.id, targetId: target.id, executionKey: "key-abs" })
  );

  assert.equal(result.ok, false);
  assert.deepEqual(scene.moved, []);
});
