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

test("movement range accepts diagonal corners only for square shape", (t) => {
  const origin = makeToken({ id: "origin-token", x: 0, y: 0 });
  const target = makeToken({ id: "target-token", x: 600, y: 600 });
  const scene = makeScene([origin, target]);
  installCanvasGlobals(t, scene);

  const previewFor = (rangeShape) => ScCanvasActivityService.getMovementPreviewData(
    makeActivity({
      targetSource: CANVAS_TARGET_SOURCES.TARGETS,
      maxRange: 30,
      rangeShape
    }),
    {
      originTokenId: origin.id,
      tokenIds: [target.id],
      useExplicitTokenIds: true
    }
  );

  assert.equal(previewFor("circle").targets[0].inRange, false);
  assert.equal(previewFor("square").targets[0].inRange, true);
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
    options: { animate: true }
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
    options: { animate: true }
  }]);
});

test("teleport execution remains instantaneous", async(t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const origin = makeToken({ id: "origin-token", x: 100, y: 100, actor });
  const target = makeToken({ id: "target-token", x: 300, y: 100 });
  // Core hands TokenDocuments back from getActiveTokens(_, true), not the
  // placeable wrappers: mocking the placeable shape hid a broken fallback.
  actor.getActiveTokens = () => [origin];
  const scene = makeScene([origin, target]);
  const updates = [];
  scene.updateEmbeddedDocuments = async(documentName, documents, options) => {
    updates.push({ documentName, documents, options });
    return documents;
  };
  installCanvasGlobals(t, scene);

  const activity = {
    uuid: "Activity.teleport",
    actor,
    teleport: {
      maxTargets: 1,
      teleportDistance: 0,
      snapToGrid: false
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

  const result = await ScCanvasActivityService.executeTeleportPlacement(activity, {
    destination: { x: 650, y: 150 },
    tokenIds: [target.id]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(updates, [{
    documentName: "Token",
    documents: [{ _id: target.id, x: 600, y: 100 }],
    // A displace waypoint: core neither stops it at a wall nor records it as
    // a walk in the combat movement history (whose ruler would linger).
    options: {
      animate: false,
      movement: {
        [target.id]: { waypoints: [{ x: 600, y: 100, action: "displace" }] }
      }
    }
  }]);
});

test("a deferred teleport is validated against the requester's view, not the executor's", async(t) => {
  const actor = { id: "actor-deferred", uuid: "Actor.actor-deferred" };
  const origin = makeToken({ id: "origin-deferred", x: 100, y: 100, actor });
  const target = makeToken({ id: "target-deferred", x: 300, y: 100 });
  // The player who asked never saw this one; the GM clicking the card does.
  const lurker = makeToken({ id: "lurker-deferred", x: 600, y: 100 });
  actor.getActiveTokens = () => [origin];
  const scene = makeScene([origin, target, lurker]);
  const updates = [];
  scene.updateEmbeddedDocuments = async(documentName, documents) => {
    updates.push(...documents);
    return documents;
  };
  installCanvasGlobals(t, scene);

  const activity = {
    uuid: "Activity.teleport-deferred",
    actor,
    teleport: { maxTargets: 1, teleportDistance: 0, snapToGrid: true }
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

  const blocked = await ScCanvasActivityService.executeTeleportPlacement(activity, {
    tokenIds: [target.id],
    destination: { x: 650, y: 150 },
    executionKey: "deferred-own-view"
  });
  assert.equal(blocked.ok, false, "the GM's own view sees the lurker");

  const result = await ScCanvasActivityService.executeTeleportPlacement(activity, {
    tokenIds: [target.id],
    destination: { x: 650, y: 150 },
    perceivedTokenIds: [origin.id, target.id],
    executionKey: "deferred-requester-view"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(updates.map((update) => update._id), [target.id]);
});

// Square-grid measurements as Foundry's grid reports them, in scene units for
// a 100px / 5ft grid: equidistant counts a diagonal as one square, 5/10/5
// counts every second diagonal as two. The 5/10/5 rule is SquareGrid's
// `_measurePath` for ALTERNATING_1, fractional squares included.
const GRID_RULES = {
  equidistant(from, to) {
    return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 100 * 5;
  },
  alternating(from, to) {
    let dx = Math.abs(to.x - from.x) / 100;
    let dy = Math.abs(to.y - from.y) / 100;
    if (dx < dy) {
      [dx, dy] = [dy, dx];
    }
    const fx = Math.floor(dx);
    const fy = Math.floor(dy);
    const a = fx + (0.5 * fy);
    const mx = dx - fx;
    const my = dy - fy;
    const squares = (Math.floor(a) * (1 - mx)) + (Math.floor(a + 1) * (mx - my)) + (Math.floor(a + 1.5) * my);
    return squares * 5;
  }
};

function useGridRule(scene, rule) {
  scene.grid.measurePath = ([from, to]) => ({ distance: GRID_RULES[rule](from, to) });
}

function selfMovementPreview(rule, { distance, direction, snapToGrid = true }) {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300 });
  const scene = makeScene([origin]);
  if (rule) {
    useGridRule(scene, rule);
  }
  const center = { x: 250, y: 350 };
  return {
    scene,
    center,
    origin,
    run: (t) => {
      installCanvasGlobals(t, scene);
      return ScCanvasActivityService.getMovementPreviewData(
        makeActivity({ targetSource: CANVAS_TARGET_SOURCES.SELF, distance, snapToGrid }),
        {
          originTokenId: origin.id,
          selfDirectionPoint: { x: center.x + direction.x, y: center.y + direction.y }
        }
      );
    }
  };
}

test("a snapped diagonal self move covers the chosen distance on an equidistant grid", (t) => {
  const setup = selfMovementPreview("equidistant", { distance: 30, direction: { x: 100, y: 100 } });
  const preview = setup.run(t);

  // Rounding the 30ft straight-line projection landed four squares away (20ft).
  assert.deepEqual(preview.updates, [{ id: setup.origin.id, x: 800, y: 900 }]);
  assert.equal(GRID_RULES.equidistant(setup.center, preview.targets[0].destinationCenter), 30);
});

test("a snapped diagonal self move never passes the chosen distance on a 5/10/5 grid", (t) => {
  const setup = selfMovementPreview("alternating", { distance: 25, direction: { x: 100, y: 100 } });
  const preview = setup.run(t);

  // Rounding the 25ft straight-line projection landed four diagonals away (30ft).
  assert.equal(preview.updates.length, 1);
  assert.equal(GRID_RULES.alternating(setup.center, preview.targets[0].destinationCenter), 25);
});

test("an oblique snapped self move lands on the square nearest the line at the chosen distance", (t) => {
  const angle = 33 * Math.PI / 180;
  const setup = selfMovementPreview("alternating", {
    distance: 15,
    direction: { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 }
  });
  const preview = setup.run(t);

  // Rounding each axis landed on (3, 2): 20ft on a 5/10/5 grid. Of the squares
  // 15ft away, (2, 2) sits closest to the chosen line.
  assert.deepEqual(preview.updates, [{ id: setup.origin.id, x: 400, y: 500 }]);
  assert.equal(GRID_RULES.alternating(setup.center, preview.targets[0].destinationCenter), 15);
});

test("a snapped self move stays within the distance without a grid measurement", (t) => {
  const setup = selfMovementPreview(null, {
    distance: 10,
    direction: { x: Math.cos(Math.PI / 6) * 100, y: Math.sin(Math.PI / 6) * 100 }
  });
  const preview = setup.run(t);

  // Rounding each axis landed on (2, 1): 11.2ft in a straight line.
  assert.deepEqual(preview.updates, [{ id: setup.origin.id, x: 400, y: 300 }]);
});

test("an unsnapped diagonal self move covers the chosen distance by the grid rule", (t) => {
  const setup = selfMovementPreview("equidistant", {
    distance: 30,
    direction: { x: 100, y: 100 },
    snapToGrid: false
  });
  const preview = setup.run(t);
  const [update] = preview.updates;

  assert.equal(Math.round(update.x), 800);
  assert.equal(Math.round(update.y), 900);
});

test("movement execution lands a snapped self move where the preview showed it", async(t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300, actor });
  const scene = makeScene([origin]);
  useGridRule(scene, "alternating");
  const updates = [];
  scene.updateEmbeddedDocuments = async(documentName, documents, options) => {
    updates.push({ documentName, documents, options });
    return documents;
  };
  installCanvasGlobals(t, scene);

  const activity = {
    uuid: "Activity.self-movement",
    actor,
    movement: {
      distanceMode: "range",
      minDistance: 5,
      distance: 30,
      maxRange: 0,
      maxTargets: 1,
      snapToGrid: true,
      targetSource: CANVAS_TARGET_SOURCES.SELF,
      type: MOVEMENT_TYPES.PUSH
    }
  };
  const request = {
    originTokenId: origin.id,
    selfDirectionPoint: { x: 250 + (Math.cos(Math.PI / 6) * 100), y: 350 + (Math.sin(Math.PI / 6) * 100) },
    distance: 15,
    tokenIds: [origin.id]
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

  const preview = ScCanvasActivityService.getMovementPreviewData(activity, request);
  const result = await ScCanvasActivityService.executeMovement(activity, request);

  assert.equal(result.ok, true);
  assert.deepEqual(preview.updates, [{ id: origin.id, x: 500, y: 400 }]);
  assert.deepEqual(updates[0].documents, [{ _id: origin.id, x: 500, y: 400 }]);
});

test("an unsnapped self move covers the chosen distance on a 5/10/5 grid", (t) => {
  const angle = 41.75 * Math.PI / 180;
  const setup = selfMovementPreview("alternating", {
    distance: 30,
    direction: { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 },
    snapToGrid: false
  });
  const preview = setup.run(t);

  // Scaling the straight-line length once fell short here (29.27ft). Whole
  // pixels leave it at most a pixel (0.05ft) short, never past.
  const moved = GRID_RULES.alternating(setup.center, preview.targets[0].destinationCenter);
  assert.ok(moved <= 30 + 1e-6 && moved > 29.9, `moved ${moved}ft`);
});

test("a snapped self move on a gridless scene moves the exact distance", (t) => {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 250, y: 350 });
  const scene = makeScene([origin]);
  scene.grid = { size: 100, distance: 10, type: 0 };
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ targetSource: CANVAS_TARGET_SOURCES.SELF, distance: 5, snapToGrid: true }),
    { originTokenId: origin.id, selfDirectionPoint: { x: 400, y: 500 } }
  );
  const [update] = preview.updates;

  // Snapping to 100px squares landed on (300, 400): 7.07ft away.
  const moved = Math.hypot(update.x - origin.x, update.y - origin.y);
  assert.ok(moved <= 50 && moved > 49, `moved ${moved}px`);
  assert.equal(update.x - origin.x, update.y - origin.y);
});

test("a snapped self move stays put when no square fits the distance", (t) => {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 230, y: 300 });
  const scene = makeScene([origin]);
  installCanvasGlobals(t, scene);

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ targetSource: CANVAS_TARGET_SOURCES.SELF, distance: 2, snapToGrid: true }),
    { originTokenId: origin.id, selfDirectionPoint: { x: 380, y: 350 } }
  );

  // The nearest square ahead is 3.5ft away and the one behind runs backwards.
  assert.deepEqual(preview.updates, [{ id: origin.id, x: 230, y: 300 }]);
});

test("an unsnapped landing is whole pixels that never pass the distance", (t) => {
  const origin = makeToken({ id: "origin-token", name: "Origin", x: 200, y: 300 });
  const scene = makeScene([origin]);
  scene.grid = { size: 100, distance: 5, type: 0 };
  installCanvasGlobals(t, scene);
  const angle = 31 * Math.PI / 180;

  const preview = ScCanvasActivityService.getMovementPreviewData(
    makeActivity({ targetSource: CANVAS_TARGET_SOURCES.SELF, distance: 25, snapToGrid: true }),
    {
      originTokenId: origin.id,
      selfDirectionPoint: { x: 250 + (Math.cos(angle) * 100), y: 350 + (Math.sin(angle) * 100) }
    }
  );
  const [update] = preview.updates;

  // Foundry stores whole pixels: rounding the exact landing measured 25.03ft.
  assert.ok(Number.isInteger(update.x) && Number.isInteger(update.y));
  const moved = Math.hypot(update.x - origin.x, update.y - origin.y) / 100 * 5;
  assert.ok(moved <= 25 && moved > 24.95, `moved ${moved}ft`);
});
