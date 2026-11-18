import test from "node:test";
import assert from "node:assert/strict";

const { ScMovementDistance } = await import("../../scripts/activities/canvas/ScMovementDistance.js");
const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const {
  CANVAS_TARGET_SOURCES,
  MOVEMENT_TYPES
} = await import("../../scripts/activities/canvas/ScCanvasActivityConstants.js");

const RANGE = ScMovementDistance.MODES.RANGE;

test("an activity saved before distance ranges existed keeps its fixed distance", () => {
  const legacy = { distance: 15 };

  assert.deepEqual(ScMovementDistance.bounds(legacy), { isRange: false, min: 15, max: 15 });
  assert.equal(ScMovementDistance.resolve(legacy), 15);
  // A fixed activity never takes a distance from the request.
  assert.equal(ScMovementDistance.resolve(legacy, 5), 15);
  assert.equal(ScMovementDistance.accepts(legacy, 999), true);
  assert.deepEqual(ScMovementDistance.choices(legacy), [15]);
});

test("a ranged activity moves the picked distance and the maximum when none was picked", () => {
  const config = { distanceMode: RANGE, minDistance: 5, distance: 15 };

  assert.deepEqual(ScMovementDistance.bounds(config), { isRange: true, min: 5, max: 15 });
  assert.equal(ScMovementDistance.resolve(config), 15);
  assert.equal(ScMovementDistance.resolve(config, 10), 10);
  assert.equal(ScMovementDistance.resolve(config, 40), 15);
  assert.equal(ScMovementDistance.resolve(config, 0), 5);
});

test("a ranged activity only accepts distances inside its bounds", () => {
  const config = { distanceMode: RANGE, minDistance: 5, distance: 15 };

  assert.equal(ScMovementDistance.accepts(config, null), true);
  assert.equal(ScMovementDistance.accepts(config, 5), true);
  assert.equal(ScMovementDistance.accepts(config, 15), true);
  assert.equal(ScMovementDistance.accepts(config, 20), false);
  assert.equal(ScMovementDistance.accepts(config, 0), false);
  assert.equal(ScMovementDistance.accepts(config, "far"), false);
});

test("a range whose minimum reaches the maximum behaves as fixed", () => {
  const config = { distanceMode: RANGE, minDistance: 20, distance: 10 };

  assert.deepEqual(ScMovementDistance.bounds(config), { isRange: false, min: 10, max: 10 });
  assert.deepEqual(ScMovementDistance.choices(config), [10]);
});

test("the choices step by the grid and always include both ends", () => {
  assert.deepEqual(
    ScMovementDistance.choices({ distanceMode: RANGE, minDistance: 5, distance: 20 }, 5),
    [5, 10, 15, 20]
  );
  assert.deepEqual(
    ScMovementDistance.choices({ distanceMode: RANGE, minDistance: 3, distance: 12 }, 5),
    [3, 5, 10, 12]
  );
  // A wide range keeps the grid step; the preview shows it as a slider.
  const wide = ScMovementDistance.choices({ distanceMode: RANGE, minDistance: 0, distance: 120 }, 5);
  assert.equal(wide.length, 25);
  assert.equal(wide[3], 15);
  assert.equal(wide.at(-1), 120);

  // Only an absurd range takes bigger steps, keeping both ends.
  const absurd = ScMovementDistance.choices({ distanceMode: RANGE, minDistance: 0, distance: 10000 }, 1);
  assert.ok(absurd.length <= ScMovementDistance.MAX_CHOICES + 1);
  assert.equal(absurd[0], 0);
  assert.equal(absurd.at(-1), 10000);
});

test("fractional grid choices stay distinct and inside the configured range", () => {
  const config = { distanceMode: RANGE, minDistance: 0.0001, distance: 0.0005 };
  const choices = ScMovementDistance.choices(config, 0.0001);

  assert.deepEqual(choices, [0.0001, 0.0002, 0.0003, 0.0004, 0.0005]);
  assert.ok(choices.every((distance) => ScMovementDistance.accepts(config, distance)));
  assert.deepEqual(
    ScMovementDistance.choices({ distanceMode: RANGE, minDistance: 0.1, distance: 0.5 }, 0.1),
    [0.1, 0.2, 0.3, 0.4, 0.5]
  );
});

function makeToken({ id, x, y, actor = null }) {
  return { id, name: id, x, y, width: 1, height: 1, actor };
}

function makeScene(tokens) {
  const collection = new Map(tokens.map((token) => [token.id, token]));
  collection.contents = tokens;
  const scene = {
    id: "scene-distance",
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

function installGmGlobals(t, scene, activity) {
  const gm = { id: "gm", isGM: true, targets: new Set() };
  globalThis.game = {
    i18n: { localize: (key) => `i18n:${key}`, format: (key) => `i18n:${key}` },
    user: gm,
    users: { get: (id) => (id === gm.id ? gm : null) },
    scenes: { get: (id) => (id === scene.id ? scene : null) }
  };
  globalThis.canvas = {
    scene,
    grid: { size: 100 },
    tokens: { controlled: [], get: (id) => scene.tokens.get(id) }
  };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.fromUuid = async(uuid) => (uuid === activity.uuid ? activity : null);

  t.after(() => {
    delete globalThis.canvas;
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.fromUuid;
  });
}

function makeActivity(uuid, movement = {}) {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  return {
    uuid,
    actor,
    movement: {
      distance: 15,
      maxRange: 0,
      maxTargets: 1,
      snapToGrid: false,
      targetSource: CANVAS_TARGET_SOURCES.TARGETS,
      type: MOVEMENT_TYPES.PUSH,
      ...movement
    }
  };
}

function gmRequest(scene, activity, { originId, targetId, executionKey, distance }) {
  const request = {
    activityUuid: activity.uuid,
    executionKey,
    operation: "movement",
    originTokenId: originId,
    requestUserId: "gm",
    sceneId: scene.id,
    tokenIds: [targetId]
  };
  if (distance !== undefined) {
    request.distance = distance;
  }
  return request;
}

test("the preview projects the picked distance of a ranged activity", (t) => {
  const activity = makeActivity("Activity.range-preview", { distanceMode: RANGE, minDistance: 5 });
  const origin = makeToken({ id: "range-preview-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "range-preview-target", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);

  const previewFor = (distance) => ScCanvasActivityService.getMovementPreviewData(activity, {
    originTokenId: origin.id,
    tokenIds: [target.id],
    useExplicitTokenIds: true,
    distance
  });

  assert.equal(previewFor(null).config.distance, 15);
  assert.deepEqual(previewFor(null).updates, [{ id: target.id, x: 600, y: 100 }]);
  assert.equal(previewFor(5).config.distance, 5);
  assert.deepEqual(previewFor(5).updates, [{ id: target.id, x: 400, y: 100 }]);
});

test("the GM moves a ranged activity's targets by the requested distance", async(t) => {
  const activity = makeActivity("Activity.range-gm", { distanceMode: RANGE, minDistance: 5 });
  const origin = makeToken({ id: "range-gm-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "range-gm-target", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);

  const result = await ScCanvasActivityService.handleCanvasQuery(gmRequest(scene, activity, {
    originId: origin.id,
    targetId: target.id,
    executionKey: "range-gm-ok",
    distance: 10
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(scene.moved, [{ documentName: "Token", documents: [{ _id: target.id, x: 500, y: 100 }] }]);
});

test("the GM refuses a distance outside the activity's range", async(t) => {
  const activity = makeActivity("Activity.range-forged", { distanceMode: RANGE, minDistance: 5 });
  const origin = makeToken({ id: "range-forged-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "range-forged-target", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);

  const result = await ScCanvasActivityService.handleCanvasQuery(gmRequest(scene, activity, {
    originId: origin.id,
    targetId: target.id,
    executionKey: "range-forged",
    distance: 60
  }));

  assert.equal(result.ok, false);
  assert.equal(result.message, "i18n:SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest");
  assert.deepEqual(scene.moved, []);
});

test("a request without a distance moves the maximum of a ranged activity", async(t) => {
  // Save request cards posted before ranges existed carry no distance.
  const activity = makeActivity("Activity.range-legacy-card", { distanceMode: RANGE, minDistance: 5 });
  const origin = makeToken({ id: "range-legacy-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "range-legacy-target", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);

  const result = await ScCanvasActivityService.handleCanvasQuery(gmRequest(scene, activity, {
    originId: origin.id,
    targetId: target.id,
    executionKey: "range-legacy-card"
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(scene.moved, [{ documentName: "Token", documents: [{ _id: target.id, x: 600, y: 100 }] }]);
});

test("a fixed activity ignores any distance in the request", async(t) => {
  const activity = makeActivity("Activity.fixed-ignores", {});
  const origin = makeToken({ id: "fixed-ignores-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "fixed-ignores-target", x: 300, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);

  const result = await ScCanvasActivityService.handleCanvasQuery(gmRequest(scene, activity, {
    originId: origin.id,
    targetId: target.id,
    executionKey: "fixed-ignores",
    distance: 60
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(scene.moved, [{ documentName: "Token", documents: [{ _id: target.id, x: 600, y: 100 }] }]);
});

test("execution rejects invalid distances from callers and save cards before building the request", async(t) => {
  t.mock.method(console, "error", () => {});
  const activity = makeActivity("Activity.range-invalid-caller", { distanceMode: RANGE, minDistance: 5, distance: 30 });
  const origin = makeToken({ id: "caller-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "caller-target", x: 800, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);

  for (const distance of [0, 31, "far", "", Infinity, NaN]) {
    const result = await ScCanvasActivityService.executeMovement(activity, {
      originTokenId: origin.id,
      tokenIds: [target.id],
      distance
    });
    assert.equal(result.ok, false, `must reject ${String(distance)}`);
  }
  assert.deepEqual(scene.moved, []);
});

test("the GM rejects a choice that became invalid after the requesting client read the activity", async(t) => {
  const activity = makeActivity("Activity.range-stale", { distanceMode: RANGE, minDistance: 5, distance: 30 });
  const origin = makeToken({ id: "stale-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "stale-target", x: 800, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);
  globalThis.fromUuid = async() => ({ ...activity, movement: { ...activity.movement, distance: 15 } });

  const result = await ScCanvasActivityService.executeMovement(activity, {
    originTokenId: origin.id, tokenIds: [target.id], distance: 30
  });

  assert.equal(result.ok, false);
  assert.deepEqual(scene.moved, []);
});

test("the GM rejects malformed distance values instead of coercing them to numbers", async(t) => {
  const activity = makeActivity("Activity.range-invalid-types", { distanceMode: RANGE, minDistance: 0, distance: 30 });
  const origin = makeToken({ id: "types-origin", x: 100, y: 100, actor: activity.actor });
  const target = makeToken({ id: "types-target", x: 800, y: 100 });
  const scene = makeScene([origin, target]);
  installGmGlobals(t, scene, activity);

  for (const distance of [true, false, [], [10], {}, " "]) {
    const result = await ScCanvasActivityService.handleCanvasQuery(gmRequest(scene, activity, {
      originId: origin.id,
      targetId: target.id,
      distance
    }));
    assert.equal(result.ok, false, `must reject ${JSON.stringify(distance)}`);
  }
  assert.deepEqual(scene.moved, []);
});

for (const distance of [5, 15, 30]) {
  for (const type of [MOVEMENT_TYPES.PUSH, MOVEMENT_TYPES.PULL]) {
    test(`the preview and GM execution agree at ${distance} feet for ${type}`, async(t) => {
      const activity = makeActivity(`Activity.range-${type}-${distance}`, {
        distanceMode: RANGE, minDistance: 5, distance: 30, maxRange: 40, type
      });
      const origin = makeToken({ id: "origin", x: 100, y: 100, actor: activity.actor });
      const target = makeToken({ id: "target", x: 800, y: 100 });
      const scene = makeScene([origin, target]);
      installGmGlobals(t, scene, activity);

      const options = { originTokenId: origin.id, tokenIds: [target.id], distance };
      const preview = ScCanvasActivityService.getMovementPreviewData(activity, {
        ...options, useExplicitTokenIds: true
      });
      const result = await ScCanvasActivityService.executeMovement(activity, options);
      const x = target.x + (type === MOVEMENT_TYPES.PULL ? -1 : 1) * distance * 20;

      assert.equal(result.ok, true);
      assert.equal(preview.config.maxRange, 40, "targeting range stays independent of the movement distance");
      assert.deepEqual(preview.updates, [{ id: target.id, x, y: 100 }]);
      assert.deepEqual(scene.moved, [{ documentName: "Token", documents: [{ _id: target.id, x, y: 100 }] }]);
    });
  }
}
