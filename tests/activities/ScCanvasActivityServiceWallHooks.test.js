import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const { WALL_TARGET_SOURCES } = await import("../../scripts/activities/canvas/ScCanvasActivityConstants.js");
const { HOOKS } = await import("../../scripts/constants/Hooks.js");

function makeToken({ id, x, y, actor = null }) {
  return {
    id,
    name: id,
    x,
    y,
    width: 1,
    height: 1,
    actor
  };
}

function installWallGlobals(t) {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const origin = makeToken({ id: "origin-token", x: 100, y: 100, actor });
  const target = makeToken({ id: "target-token", x: 300, y: 100 });
  actor.getActiveTokens = () => [{ document: origin }];
  const tokens = new Map([[origin.id, origin], [target.id, target]]);
  tokens.contents = [origin, target];

  const created = [];
  const scene = {
    id: "scene-1",
    dimensions: { width: 2000, height: 2000 },
    grid: { size: 100, distance: 5 },
    tokens,
    async createEmbeddedDocuments(documentName, documents, options) {
      created.push({ documentName, documents, options });
      return documents;
    }
  };
  const user = {
    id: "user-1",
    isGM: true,
    targets: new Set([{ document: target }])
  };
  const activity = {
    uuid: "Activity.wall",
    actor,
    wall: {
      allowPlayerRequests: false,
      blocksMovement: true,
      blocksSight: true,
      blocksSound: false,
      maxLength: 60,
      maxWalls: 2,
      referenceRange: 0,
      targetSource: WALL_TARGET_SOURCES.TARGETS,
      wallType: "continuous"
    }
  };
  const hookCalls = [];

  globalThis.game = {
    i18n: { localize: (key) => key, format: (key) => key },
    scenes: { get: (id) => id === scene.id ? scene : null },
    user,
    users: { get: (id) => id === user.id ? user : null }
  };
  globalThis.canvas = {
    scene,
    grid: { size: 100 },
    tokens: { controlled: [], get: (id) => tokens.get(id) }
  };
  globalThis.Hooks = {
    callAll(name, payload) {
      hookCalls.push({ name, payload });
      for (const wall of payload.walls) {
        wall.flags["test-integration"] = { decorated: true };
      }
    }
  };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.fromUuid = async(uuid) => uuid === activity.uuid ? activity : null;

  t.after(() => {
    delete globalThis.canvas;
    delete globalThis.fromUuid;
    delete globalThis.game;
    delete globalThis.Hooks;
    delete globalThis.ui;
  });

  return { activity, created, hookCalls, origin, scene, user };
}

function assertDecoratedCreation(fixture) {
  assert.equal(fixture.hookCalls.length, 1);
  assert.equal(fixture.hookCalls[0].name, HOOKS.PREPARE_WALL_DOCUMENTS);
  assert.equal(fixture.hookCalls[0].payload.activity, fixture.activity);
  assert.equal(fixture.hookCalls[0].payload.scene, fixture.scene);
  assert.equal(fixture.hookCalls[0].payload.user, fixture.user);
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.created[0].documentName, "Wall");
  assert.equal(fixture.created[0].documents, fixture.hookCalls[0].payload.walls);
  assert.deepEqual(fixture.created[0].documents[0].flags["test-integration"], { decorated: true });
  assert.deepEqual(fixture.created[0].documents[0].flags["sc-more-activities"], {
    activityUuid: fixture.activity.uuid,
    source: "sc-wall"
  });
  assert.deepEqual(fixture.created[0].options, { isUndo: true });
}

test("target-based wall creation exposes mutable Wall data before document creation", async(t) => {
  const fixture = installWallGlobals(t);

  const result = await ScCanvasActivityService.executeWall(fixture.activity);

  assert.equal(result.ok, true);
  assertDecoratedCreation(fixture);
});

test("wall placement denied by player request settings emits no hook and creates no documents", async(t) => {
  const fixture = installWallGlobals(t);
  t.mock.method(console, "error", () => {});
  fixture.user.isGM = false;

  const result = await ScCanvasActivityService.executeWallPlacement(fixture.activity, {
    originTokenId: fixture.origin.id,
    walls: [{ points: [{ x: 150, y: 150 }, { x: 350, y: 150 }] }]
  });

  assert.equal(result.ok, false);
  assert.equal(fixture.hookCalls.length, 0);
  assert.equal(fixture.created.length, 0);
});

test("placed wall creation exposes mutable Wall data before document creation", async(t) => {
  const fixture = installWallGlobals(t);

  const result = await ScCanvasActivityService.executeWallPlacement(fixture.activity, {
    originTokenId: fixture.origin.id,
    walls: [{ points: [{ x: 150, y: 150 }, { x: 350, y: 150 }] }]
  });

  assert.equal(result.ok, true);
  assertDecoratedCreation(fixture);
});
