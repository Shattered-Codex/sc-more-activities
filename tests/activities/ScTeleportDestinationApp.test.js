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
    warn() {}
  }
};

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const { ScTeleportDestinationApp } = await import("../../scripts/activities/teleport/ScTeleportDestinationApp.js");

function makeCanvas() {
  const stageHandlers = new Map();
  const stageChildren = [];

  globalThis.canvas = {
    dimensions: {
      distancePixels: 10
    },
    stage: {
      on(eventName, handler) {
        stageHandlers.set(eventName, handler);
      },
      off(eventName, handler) {
        if (stageHandlers.get(eventName) === handler) {
          stageHandlers.delete(eventName);
        }
      },
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
      return { x: event.x + 10, y: event.y + 20 };
    }
  };

  return { stageHandlers, stageChildren };
}

function patchCanvasService(t, calls) {
  const originals = {
    getOriginTokenObject: ScCanvasActivityService.getOriginTokenObject,
    getTokenCenter: ScCanvasActivityService.getTokenCenter,
    snapCenterPoint: ScCanvasActivityService.snapCenterPoint,
    sceneDistanceBetweenPoints: ScCanvasActivityService.sceneDistanceBetweenPoints,
    executeTeleportPlacement: ScCanvasActivityService.executeTeleportPlacement,
    removePreviewTemplate: ScCanvasActivityService.removePreviewTemplate
  };

  ScCanvasActivityService.getOriginTokenObject = () => ({ id: "origin-token" });
  ScCanvasActivityService.getTokenCenter = () => ({ x: 0, y: 0 });
  ScCanvasActivityService.snapCenterPoint = (point) => point;
  ScCanvasActivityService.sceneDistanceBetweenPoints = () => 0;
  ScCanvasActivityService.executeTeleportPlacement = async(activity, placement) => {
    calls.push({ activity, placement });
    return { ok: true };
  };
  ScCanvasActivityService.removePreviewTemplate = async() => {};

  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      ScCanvasActivityService[key] = value;
    }
    delete globalThis.canvas;
  });
}

test("places teleport destination from the PIXI canvas click event", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  const { stageHandlers } = makeCanvas();
  const activity = {
    teleport: {
      snapToGrid: false,
      teleportDistance: 0
    }
  };
  const app = new ScTeleportDestinationApp(activity, [{ id: "target-token" }]);

  await app._onRender({}, {});

  assert.equal(typeof stageHandlers.get("click"), "function");

  const clickEvent = {
    data: {
      originalEvent: { button: 0 },
      getLocalPosition() {
        return { x: 123, y: 456 };
      }
    }
  };
  stageHandlers.get("click")(clickEvent);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [{
    activity,
    placement: {
      tokenIds: ["target-token"],
      destination: { x: 123, y: 456 }
    }
  }]);
  assert.equal(app.closed, true);
  assert.equal(stageHandlers.has("click"), false);
});

test("converts PointerEvent client coordinates for the Foundry canvas fallback", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  const { stageHandlers } = makeCanvas();
  const activity = {
    teleport: {
      snapToGrid: false,
      teleportDistance: 0
    }
  };
  const app = new ScTeleportDestinationApp(activity, [{ id: "target-token" }]);

  await app._onRender({}, {});
  stageHandlers.get("click")({
    data: {
      originalEvent: { button: 0, clientX: 123, clientY: 456 }
    }
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls[0]?.placement.destination, { x: 133, y: 476 });
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
    ["lineStyle", 3, 0x24b86a, 0.95],
    ["beginFill", 0x39f08c, 0.2],
    ["drawCircle", 0, 0, 300],
    ["endFill"]
  ]);

  await app.close();

  assert.equal(stageChildren.length, 0);
  assert.equal(ring.destroyed, true);
});
