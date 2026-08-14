import test from "node:test";
import assert from "node:assert/strict";

class ApplicationV2 {
  constructor() {
    this.element = { querySelector: () => null };
    this.closed = false;
  }

  async _onRender() {}

  async close() {
    this.closed = true;
  }
}

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2,
      HandlebarsApplicationMixin: (Base) => Base
    }
  }
};

globalThis.game = {
  i18n: {
    localize(key) {
      return key;
    }
  },
  user: { id: "user-1" }
};

globalThis.ui = {
  notifications: {
    warn() {},
    info() {}
  }
};

globalThis.window = {
  handlers: new Map(),
  addEventListener(name, handler) {
    this.handlers.set(name, handler);
  },
  removeEventListener(name, handler) {
    if (this.handlers.get(name) === handler) {
      this.handlers.delete(name);
    }
  }
};

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const { ScTeleportDestinationApp } = await import("../../scripts/activities/teleport/ScTeleportDestinationApp.js");

// The canvas element used as the pointer-event target for the app's guard.
const CANVAS_VIEW = { id: "canvas-view" };

function handler(name) {
  return globalThis.window.handlers.get(name);
}

function canvasEvent(props = {}) {
  return {
    target: CANVAS_VIEW,
    preventDefault() {},
    stopPropagation() {},
    ...props
  };
}

function makeCanvas() {
  const stageChildren = [];

  globalThis.canvas = {
    dimensions: {
      distancePixels: 10
    },
    scene: {
      grid: { size: 100 }
    },
    app: {
      view: CANVAS_VIEW
    },
    stage: {
      addChild(child) {
        stageChildren.push(child);
        child.parent = this;
        return child;
      },
      removeChild(child) {
        const index = stageChildren.indexOf(child);
        if (index >= 0) {
          stageChildren.splice(index, 1);
        }
        child.parent = null;
      }
    },
    canvasCoordinatesFromClient(event) {
      return { x: event.clientX, y: event.clientY };
    }
  };

  return { stageChildren };
}

function patchCanvasService(t, calls, { distance = 0 } = {}) {
  const originals = {
    getOriginTokenObject: ScCanvasActivityService.getOriginTokenObject,
    getTokenCenter: ScCanvasActivityService.getTokenCenter,
    snapCenterPoint: ScCanvasActivityService.snapCenterPoint,
    euclideanSceneDistance: ScCanvasActivityService.euclideanSceneDistance,
    executeTeleportPlacement: ScCanvasActivityService.executeTeleportPlacement,
    getTeleportPlacementPreview: ScCanvasActivityService.getTeleportPlacementPreview
  };

  ScCanvasActivityService.getOriginTokenObject = () => ({ id: "origin-token" });
  ScCanvasActivityService.getTokenCenter = () => ({ x: 0, y: 0 });
  ScCanvasActivityService.snapCenterPoint = (point) => point;
  ScCanvasActivityService.euclideanSceneDistance = () => distance;
  ScCanvasActivityService.executeTeleportPlacement = async(activity, placement) => {
    calls.push({ activity, placement });
    return { ok: true };
  };
  ScCanvasActivityService.getTeleportPlacementPreview = () => null;

  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      ScCanvasActivityService[key] = value;
    }
    delete globalThis.canvas;
    globalThis.window.handlers.clear();
  });
}

test("places the teleport destination from a canvas pointer-up event", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();
  const activity = {
    teleport: {
      snapToGrid: false,
      teleportDistance: 0
    }
  };
  const app = new ScTeleportDestinationApp(activity, [{ id: "target-token" }]);

  await app._onRender({}, {});

  assert.equal(typeof handler("pointerup"), "function");

  await handler("pointerup")(canvasEvent({ button: 0, clientX: 123, clientY: 456 }));

  assert.deepEqual(calls, [{
    activity,
    placement: {
      tokenIds: ["target-token"],
      destination: { x: 123, y: 456 }
    }
  }]);
  assert.equal(app.closed, true);
  assert.equal(globalThis.window.handlers.has("pointerup"), false);
});

test("ignores events that are not on the canvas view", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();
  const app = new ScTeleportDestinationApp({ teleport: { snapToGrid: false } }, [{ id: "target-token" }]);

  await app._onRender({}, {});

  // A pointer-up whose target is not the canvas (e.g. the banner button) is
  // left untouched so the rest of the UI keeps working.
  await handler("pointerup")({
    target: { id: "some-button" },
    button: 0,
    clientX: 1,
    clientY: 1,
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(calls.length, 0);
  assert.equal(app.closed, false);
});

test("ignores non-primary buttons and out-of-range destinations", async(t) => {
  const calls = [];
  patchCanvasService(t, calls, { distance: 90 });
  makeCanvas();
  const activity = {
    teleport: {
      snapToGrid: false,
      teleportDistance: 30
    }
  };
  const app = new ScTeleportDestinationApp(activity, [{ id: "target-token" }]);

  await app._onRender({}, {});

  await handler("pointerup")(canvasEvent({ button: 2, clientX: 10, clientY: 10 }));
  assert.equal(calls.length, 0);

  await handler("pointerup")(canvasEvent({ button: 0, clientX: 10, clientY: 10 }));
  assert.equal(calls.length, 0);
  assert.equal(app.closed, false);
  assert.equal(typeof handler("pointerup"), "function");
});

test("minimizes open sheets while picking and restores them on close", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();

  class DocumentSheetV2 {}
  class FakeWindow {
    constructor() {
      this.minimized = false;
      this.rendered = true;
    }

    minimize() {
      this.minimized = true;
    }

    maximize() {
      this.minimized = false;
    }
  }
  class FakeSheet extends DocumentSheetV2 {
    constructor() {
      super();
      this.minimized = false;
      this.rendered = true;
    }

    minimize() {
      this.minimized = true;
    }

    maximize() {
      this.minimized = false;
    }
  }

  const legacy = new FakeWindow();
  const sheet = new FakeSheet();
  const coreUi = new FakeWindow();

  const previous = {
    windows: globalThis.ui.windows,
    documentSheet: foundry.applications.api.DocumentSheetV2,
    instances: foundry.applications.instances
  };
  globalThis.ui.windows = { 1: legacy };
  foundry.applications.api.DocumentSheetV2 = DocumentSheetV2;
  foundry.applications.instances = new Map([["sheet", sheet], ["core", coreUi]]);

  t.after(() => {
    globalThis.ui.windows = previous.windows;
    foundry.applications.api.DocumentSheetV2 = previous.documentSheet;
    foundry.applications.instances = previous.instances;
  });

  const app = new ScTeleportDestinationApp({ teleport: {} }, [{ id: "target-token" }]);
  await app._onRender({}, {});

  assert.equal(legacy.minimized, true);
  assert.equal(sheet.minimized, true);
  // Core UI (not a document sheet) is left alone.
  assert.equal(coreUi.minimized, false);

  await app.close();

  assert.equal(legacy.minimized, false);
  assert.equal(sheet.minimized, false);
  assert.equal(coreUi.minimized, false);
});

test("marks only blocking in-range walls and never reveals secret doors", async(t) => {
  class Graphics {
    constructor() {
      this.commands = [];
      this.parent = null;
    }

    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo(x, y) {
      this.commands.push(["lineTo", x, y]);
      return this;
    }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };

  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  globalThis.canvas.walls = {
    placeables: [
      { document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 20 } },    // blocking, in range → drawn
      { document: { c: [5000, 0, 5000, 200], door: 0, ds: 0, move: 20 } },  // out of range → skipped
      { document: { c: [100, 0, 100, 200], door: 2, ds: 0, move: 20 } },    // secret door → skipped
      { document: { c: [100, 0, 100, 200], door: 1, ds: 1, move: 20 } },    // open door → skipped
      { document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 0 } }      // does not block movement → skipped
    ]
  };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
  });

  const app = new ScTeleportDestinationApp({ teleport: { teleportDistance: 30, snapToGrid: false } }, [{ id: "target-token" }]);
  await app._onRender({}, {});

  const [graphics] = stageChildren;
  const drawnWalls = graphics.commands.filter((command) => command[0] === "lineTo");
  assert.deepEqual(drawnWalls, [["lineTo", 100, 200]]);
});

test("marks only the wall stretches the origin token can see", async(t) => {
  class Graphics {
    constructor() {
      this.commands = [];
      this.parent = null;
    }

    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo(x, y) {
      this.commands.push(["moveTo", x, y]);
      return this;
    }
    lineTo(x, y) {
      this.commands.push(["lineTo", x, y]);
      return this;
    }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };

  // Sight is blocked past x = 150, so the wall at x = 200 is hidden behind it
  // and the near wall's stretch below y = 100 is out of sight as well.
  const collisionTests = [];
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        sight: {
          testCollision(origin, target, options) {
            collisionTests.push({ origin, target, options });
            return target.x > 150 || target.y > 100;
          }
        }
      }
    }
  };

  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  globalThis.canvas.walls = {
    placeables: [
      { document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 20 } },
      { document: { c: [200, 0, 200, 200], door: 0, ds: 0, move: 20 } }
    ]
  };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
  });

  const app = new ScTeleportDestinationApp(
    { teleport: { teleportDistance: 30, snapToGrid: false } },
    [{ id: "target-token" }]
  );
  await app._onRender({}, {});

  const [graphics] = stageChildren;
  assert.deepEqual(graphics.commands, [
    ["moveTo", 100, 0],
    ["lineTo", 100, 100]
  ]);

  // The sight ray stops just short of the wall instead of ending on it.
  assert.ok(collisionTests.length > 0);
  assert.ok(collisionTests.every((entry) => entry.options.type === "sight" && entry.options.mode === "any"));
  assert.ok(collisionTests.every((entry) => entry.target.x < 100 || entry.target.y < 200));

  // Hovering redraws from the memoized stretches instead of re-running sight.
  const tested = collisionTests.length;
  handler("pointermove")(canvasEvent({ clientX: 10, clientY: 10 }));
  assert.equal(collisionTests.length, tested);
});

test("caps the sight tests when a rangeless teleport spans the whole scene", async(t) => {
  class Graphics {
    constructor() { this.parent = null; }
    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };

  let collisions = 0;
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        sight: {
          testCollision() {
            collisions += 1;
            return false;
          }
        }
      }
    }
  };

  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();
  // 400 walls five squares long: sampling every half square would be 4000
  // sweeps before the marker ever appears.
  globalThis.canvas.walls = {
    placeables: Array.from({ length: 400 }, (_, index) => ({
      document: { c: [index * 600, 0, index * 600, 500], door: 0, ds: 0, move: 20 }
    }))
  };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
  });

  // No range limit, so every wall on the scene is a candidate.
  const app = new ScTeleportDestinationApp({ teleport: { teleportDistance: 0, snapToGrid: false } }, []);
  await app._onRender({}, {});

  assert.ok(collisions <= 1500, `expected the budget to hold, got ${collisions} sight tests`);
  // The budget spreads over the candidates — 3 samples each here instead of the
  // 10 a half-square resolution would ask for — and no wall goes unchecked.
  assert.equal(collisions, 1200);
});

test("sweeps once and answers every sample from the sight polygon", async(t) => {
  class Graphics {
    constructor() { this.parent = null; }
    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };

  let sweeps = 0;
  let containsCalls = 0;
  let collisionCalls = 0;
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        sight: {
          create() {
            sweeps += 1;
            return {
              points: [0, 0, 100, 0, 100, 100, 0, 100],
              contains() {
                containsCalls += 1;
                return true;
              }
            };
          },
          testCollision() {
            collisionCalls += 1;
            return false;
          }
        }
      }
    }
  };

  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();
  globalThis.canvas.walls = {
    placeables: Array.from({ length: 20 }, (_, index) => ({
      document: { c: [index * 10, 0, index * 10, 500], door: 0, ds: 0, move: 20 }
    }))
  };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
  });

  const app = new ScTeleportDestinationApp({ teleport: { teleportDistance: 0, snapToGrid: false } }, []);
  await app._onRender({}, {});

  // The costly part runs once, however many samples the walls need.
  assert.equal(sweeps, 1);
  assert.equal(collisionCalls, 0);
  assert.ok(containsCalls >= 20, `expected a probe per wall at least, got ${containsCalls}`);
});

test("falls back to per-sample collisions when the sweep is degenerate", async(t) => {
  class Graphics {
    constructor() { this.parent = null; }
    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };

  let collisionCalls = 0;
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        sight: {
          // An empty sweep would report every wall as hidden.
          create: () => ({ points: [], contains: () => false }),
          testCollision() {
            collisionCalls += 1;
            return false;
          }
        }
      }
    }
  };

  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();
  globalThis.canvas.walls = {
    placeables: [{ document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 20 } }]
  };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
  });

  const app = new ScTeleportDestinationApp({ teleport: { teleportDistance: 30, snapToGrid: false } }, []);
  await app._onRender({}, {});

  assert.ok(collisionCalls > 0, "expected the collision fallback to take over");
});

test("drops the marks rather than sweeping per wall on a huge scene without a polygon", async(t) => {
  class Graphics {
    constructor() {
      this.commands = [];
      this.parent = null;
    }

    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo(x, y) {
      this.commands.push(["lineTo", x, y]);
      return this;
    }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };

  let collisionCalls = 0;
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        sight: {
          testCollision() {
            collisionCalls += 1;
            return false;
          }
        }
      }
    }
  };

  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  globalThis.canvas.walls = {
    placeables: Array.from({ length: 1501 }, (_, index) => ({
      document: { c: [index * 10, 0, index * 10, 200], door: 0, ds: 0, move: 20 }
    }))
  };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
  });

  const app = new ScTeleportDestinationApp({ teleport: { teleportDistance: 0, snapToGrid: false } }, []);
  await app._onRender({}, {});

  // Neither a stall nor a leak: no sweeps attempted and nothing marked.
  assert.equal(collisionCalls, 0);
  const [staticLayer] = stageChildren;
  assert.deepEqual(staticLayer.commands, []);
});

test("coalesces a burst of wall updates into a single repaint", async(t) => {
  class Graphics {
    constructor() {
      this.clears = 0;
      this.parent = null;
    }

    clear() {
      this.clears += 1;
      return this;
    }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };

  let sweeps = 0;
  globalThis.CONFIG = {
    Canvas: {
      polygonBackends: {
        sight: {
          create() {
            sweeps += 1;
            return { points: [0, 0, 1000, 0, 1000, 1000], contains: () => true };
          }
        }
      }
    }
  };

  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.cancelAnimationFrame = () => {};

  const hooks = new Map();
  globalThis.Hooks = {
    on(event, fn) {
      hooks.set(event, fn);
      return event;
    },
    off(event) {
      hooks.delete(event);
    }
  };

  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  globalThis.canvas.walls = {
    placeables: [{ document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 20 } }]
  };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
    delete globalThis.Hooks;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });

  const app = new ScTeleportDestinationApp(
    { teleport: { teleportDistance: 30, snapToGrid: false } },
    []
  );
  await app._onRender({}, {});

  const sweepsAfterOpen = sweeps;
  const [staticLayer] = stageChildren;
  const clearsAfterOpen = staticLayer.clears;

  // A map import updating fifty walls fires the hook fifty times.
  for (let update = 0; update < 50; update += 1) {
    hooks.get("updateWall")({});
  }

  // Nothing recomputed yet, and only one frame was booked for all fifty.
  assert.equal(sweeps, sweepsAfterOpen);
  assert.equal(frames.length, 1);

  frames.pop()();

  assert.equal(sweeps, sweepsAfterOpen + 1);
  assert.equal(staticLayer.clears, clearsAfterOpen + 1);
});

test("hides wall stretches the player cannot see even when they are in line of sight", async(t) => {
  class Graphics {
    constructor() {
      this.commands = [];
      this.parent = null;
    }

    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo(x, y) {
      this.commands.push(["lineTo", x, y]);
      return this;
    }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };
  globalThis.CONFIG = {
    Canvas: { polygonBackends: { sight: { testCollision: () => false } } }
  };

  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  globalThis.canvas.walls = {
    placeables: [{ document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 20 } }]
  };
  // Nothing on the wall has been lit or explored yet.
  globalThis.canvas.visibility = { testVisibility: () => false };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
  });

  const app = new ScTeleportDestinationApp(
    { teleport: { teleportDistance: 30, snapToGrid: false } },
    [{ id: "target-token" }]
  );
  await app._onRender({}, {});

  const [graphics] = stageChildren;
  assert.deepEqual(graphics.commands, []);
});

test("labels the destination footprint with the travelled distance", async(t) => {
  class Graphics {
    constructor() {
      this.parent = null;
    }

    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    destroy() {}
  }
  class Container {
    constructor() {
      this.children = [];
      this.parent = null;
    }

    addChild(child) {
      this.children.push(child);
      return child;
    }

    removeChildren() {
      const removed = this.children;
      this.children = [];
      return removed;
    }

    destroy() {}
  }
  class Text {
    constructor(text, style) {
      this.text = text;
      this.style = style;
      this.anchor = { set() {} };
    }

    destroy() {}
  }
  class TextStyle {
    constructor(options) {
      Object.assign(this, options);
    }
  }

  globalThis.PIXI = { Graphics, Container, Text, TextStyle };
  const calls = [];
  patchCanvasService(t, calls, { distance: 15 });
  const { stageChildren } = makeCanvas();
  ScCanvasActivityService.getTeleportPlacementPreview = () => ({
    inRange: true,
    destination: { x: 200, y: 200 },
    landings: [{ center: { x: 200, y: 200 }, size: { width: 100, height: 100 } }]
  });

  t.after(() => {
    delete globalThis.PIXI;
  });

  const app = new ScTeleportDestinationApp(
    { teleport: { snapToGrid: false, teleportDistance: 30 } },
    [{ id: "target-token" }]
  );
  await app._onRender({}, {});
  handler("pointermove")(canvasEvent({ clientX: 200, clientY: 200 }));

  const labels = stageChildren.find((child) => child instanceof Container);
  assert.equal(labels.children.length, 1);
  const [label] = labels.children;
  assert.equal(label.text, "15 / 30 ft");
  assert.equal(label.x, 200);
  // Sits above the landing footprint (top edge 150) with a small gap.
  assert.equal(label.y, 140);

  // Redrawing replaces the label instead of stacking new ones.
  handler("pointermove")(canvasEvent({ clientX: 210, clientY: 210 }));
  assert.equal(labels.children.length, 1);
});

test("cancels the selection on right-click over the canvas", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();
  const app = new ScTeleportDestinationApp({ teleport: {} }, [{ id: "target-token" }]);

  await app._onRender({}, {});
  handler("contextmenu")(canvasEvent());

  assert.equal(app.closed, true);
  assert.equal(calls.length, 0);
  assert.equal(globalThis.window.handlers.has("pointerup"), false);
});

test("cancels the selection with the Escape key", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  makeCanvas();
  const app = new ScTeleportDestinationApp({ teleport: {} }, [{ id: "target-token" }]);

  await app._onRender({}, {});
  handler("keydown")({ key: "Escape", preventDefault() {}, stopPropagation() {} });

  assert.equal(app.closed, true);
});

test("draws a non-interactive teleport range ring and removes it on close", async(t) => {
  class Graphics {
    constructor() {
      this.eventMode = null;
      this.interactive = true;
      this.commands = [];
      this.destroyed = false;
      this.parent = null;
    }

    clear() {
      this.commands.push(["clear"]);
      return this;
    }

    lineStyle(width, color, alpha) {
      this.commands.push(["lineStyle", width, color, alpha]);
      return this;
    }

    beginFill(color, alpha) {
      this.commands.push(["beginFill", color, alpha]);
      return this;
    }

    drawCircle(x, y, radius) {
      this.commands.push(["drawCircle", x, y, radius]);
      return this;
    }

    drawRoundedRect(x, y, width, height, radius) {
      this.commands.push(["drawRoundedRect", x, y, width, height, radius]);
      return this;
    }

    endFill() {
      this.commands.push(["endFill"]);
      return this;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  globalThis.PIXI = { Graphics };
  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  const activity = {
    teleport: {
      snapToGrid: false,
      teleportDistance: 30
    }
  };
  const app = new ScTeleportDestinationApp(activity, [{ id: "target-token" }]);

  t.after(() => {
    delete globalThis.PIXI;
  });

  await app._onRender({}, {});

  // The ring lives in the static layer, the destination marker in its own.
  assert.equal(stageChildren.length, 2);
  const [ring, marker] = stageChildren;
  assert.equal(ring.eventMode, "none");
  assert.equal(ring.interactive, false);
  assert.deepEqual(ring.commands, [
    ["clear"],
    ["lineStyle", 2, 0x24b86a, 0.9],
    ["beginFill", 0x39f08c, 0.12],
    ["drawCircle", 0, 0, 300],
    ["endFill"]
  ]);

  await app.close();

  assert.equal(stageChildren.length, 0);
  assert.equal(ring.destroyed, true);
  assert.equal(marker.destroyed, true);
});

test("leaves the ring and wall marks alone while the pointer moves", async(t) => {
  class Graphics {
    constructor() {
      this.commands = [];
      this.parent = null;
    }

    clear() {
      this.commands.push(["clear"]);
      return this;
    }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() {
      this.commands.push(["drawCircle"]);
      return this;
    }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo(x, y) {
      this.commands.push(["lineTo", x, y]);
      return this;
    }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };
  globalThis.CONFIG = {
    Canvas: { polygonBackends: { sight: { testCollision: () => false } } }
  };

  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  globalThis.canvas.walls = {
    placeables: [{ document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 20 } }]
  };
  ScCanvasActivityService.getTeleportPlacementPreview = () => ({
    inRange: true,
    destination: { x: 50, y: 50 },
    landings: []
  });

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
  });

  const app = new ScTeleportDestinationApp(
    { teleport: { teleportDistance: 30, snapToGrid: false } },
    [{ id: "target-token" }]
  );
  await app._onRender({}, {});

  const [staticLayer] = stageChildren;
  const afterOpen = [...staticLayer.commands];
  assert.ok(afterOpen.some((command) => command[0] === "lineTo"));

  for (let move = 0; move < 20; move += 1) {
    handler("pointermove")(canvasEvent({ clientX: move, clientY: move }));
  }

  // Twenty pointer moves and the wall geometry was never re-emitted.
  assert.deepEqual(staticLayer.commands, afterOpen);
});

test("redraws the wall marks when a wall changes mid-selection", async(t) => {
  class Graphics {
    constructor() {
      this.commands = [];
      this.parent = null;
    }

    clear() {
      this.commands.push(["clear"]);
      return this;
    }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo(x, y) {
      this.commands.push(["lineTo", x, y]);
      return this;
    }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  globalThis.CONST = {
    WALL_DOOR_TYPES: { NONE: 0, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1 },
    WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 20 }
  };
  globalThis.CONFIG = {
    Canvas: { polygonBackends: { sight: { testCollision: () => false } } }
  };

  const hooks = new Map();
  globalThis.Hooks = {
    on(event, fn) {
      hooks.set(event, fn);
      return event;
    },
    off(event) {
      hooks.delete(event);
    }
  };

  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  const wall = { document: { c: [100, 0, 100, 200], door: 0, ds: 0, move: 20 } };
  globalThis.canvas.walls = { placeables: [wall] };

  t.after(() => {
    delete globalThis.PIXI;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
    delete globalThis.Hooks;
  });

  const app = new ScTeleportDestinationApp(
    { teleport: { teleportDistance: 30, snapToGrid: false } },
    [{ id: "target-token" }]
  );
  await app._onRender({}, {});

  const [staticLayer] = stageChildren;
  assert.ok(staticLayer.commands.some((command) => command[0] === "lineTo"));

  // The wall becomes a secret door. The placeable count is unchanged, so only
  // the hook can tell the cache its answer is stale.
  wall.document.door = 2;
  hooks.get("updateWall")(wall.document);

  const lastClear = staticLayer.commands.map((command) => command[0]).lastIndexOf("clear");
  const afterUpdate = staticLayer.commands.slice(lastClear + 1);
  assert.ok(lastClear >= 0, "expected the static layer to be redrawn");
  assert.equal(afterUpdate.filter((command) => command[0] === "lineTo").length, 0);

  await app.close();
  assert.equal(hooks.size, 0);
});

test("draws landing footprints from the placement preview on hover", async(t) => {
  class Graphics {
    constructor() {
      this.commands = [];
      this.parent = null;
    }

    clear() { return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    drawRoundedRect(x, y, width, height) {
      this.commands.push(["rect", x, y, width, height]);
      return this;
    }
    endFill() { return this; }
    destroy() {}
  }

  globalThis.PIXI = { Graphics };
  const calls = [];
  patchCanvasService(t, calls);
  const { stageChildren } = makeCanvas();
  ScCanvasActivityService.getTeleportPlacementPreview = () => ({
    inRange: true,
    destination: { x: 200, y: 200 },
    landings: [{ center: { x: 200, y: 200 }, size: { width: 100, height: 100 } }]
  });

  t.after(() => {
    delete globalThis.PIXI;
  });

  const app = new ScTeleportDestinationApp({ teleport: { snapToGrid: false } }, [{ id: "target-token" }]);
  await app._onRender({}, {});

  handler("pointermove")(canvasEvent({ clientX: 200, clientY: 200 }));

  // Footprints are hover state, so they belong to the dynamic layer.
  const [, graphics] = stageChildren;
  assert.deepEqual(app.hoverPoint, { x: 200, y: 200 });
  assert.deepEqual(graphics.commands, [
    ["rect", 150, 150, 100, 100]
  ]);
});
