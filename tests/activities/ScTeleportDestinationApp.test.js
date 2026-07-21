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
    sceneDistanceBetweenPoints: ScCanvasActivityService.sceneDistanceBetweenPoints,
    executeTeleportPlacement: ScCanvasActivityService.executeTeleportPlacement,
    getTeleportPlacementPreview: ScCanvasActivityService.getTeleportPlacementPreview
  };

  ScCanvasActivityService.getOriginTokenObject = () => ({ id: "origin-token" });
  ScCanvasActivityService.getTokenCenter = () => ({ x: 0, y: 0 });
  ScCanvasActivityService.snapCenterPoint = (point) => point;
  ScCanvasActivityService.sceneDistanceBetweenPoints = () => distance;
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

  assert.equal(stageChildren.length, 1);
  const [ring] = stageChildren;
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

  const [graphics] = stageChildren;
  assert.deepEqual(app.hoverPoint, { x: 200, y: 200 });
  assert.deepEqual(graphics.commands, [
    ["rect", 150, 150, 100, 100]
  ]);
});
