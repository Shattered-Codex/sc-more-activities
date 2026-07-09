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
  const viewListeners = new Map();

  globalThis.canvas = {
    stage: {
      on(eventName, handler) {
        stageHandlers.set(eventName, handler);
      },
      off(eventName, handler) {
        if (stageHandlers.get(eventName) === handler) {
          stageHandlers.delete(eventName);
        }
      }
    },
    app: {
      view: {
        addEventListener(eventName, handler, options) {
          viewListeners.set(eventName, { handler, options });
        },
        removeEventListener(eventName, handler) {
          if (viewListeners.get(eventName)?.handler === handler) {
            viewListeners.delete(eventName);
          }
        }
      }
    },
    canvasCoordinatesFromClient(event) {
      return { x: event.clientX + 10, y: event.clientY + 20 };
    }
  };

  return { stageHandlers, viewListeners };
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

test("places teleport destination from captured canvas pointerup without waiting for stage mouseup", async(t) => {
  const calls = [];
  patchCanvasService(t, calls);
  const { stageHandlers, viewListeners } = makeCanvas();
  const activity = {
    teleport: {
      snapToGrid: false,
      teleportDistance: 0
    }
  };
  const app = new ScTeleportDestinationApp(activity, [{ id: "target-token" }]);

  await app._onRender({}, {});

  assert.equal(viewListeners.get("pointerdown")?.options, true);
  assert.equal(viewListeners.get("pointerup")?.options, true);
  assert.equal(typeof stageHandlers.get("mouseup"), "function");

  const pointerDownEvent = {
    button: 0,
    clientX: 123,
    clientY: 456,
    preventDefaultCalled: false,
    stopPropagationCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
    stopPropagation() {
      this.stopPropagationCalled = true;
    }
  };
  const pointerUpEvent = {
    button: 0,
    clientX: 123,
    clientY: 456,
    preventDefaultCalled: false,
    stopPropagationCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
    stopPropagation() {
      this.stopPropagationCalled = true;
    }
  };
  viewListeners.get("pointerdown").handler(pointerDownEvent);
  viewListeners.get("pointerup").handler(pointerUpEvent);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [{
    activity,
    placement: {
      tokenIds: ["target-token"],
      destination: { x: 133, y: 476 }
    }
  }]);
  assert.equal(pointerDownEvent.preventDefaultCalled, true);
  assert.equal(pointerDownEvent.stopPropagationCalled, true);
  assert.equal(pointerUpEvent.preventDefaultCalled, true);
  assert.equal(pointerUpEvent.stopPropagationCalled, true);
  assert.equal(app.closed, true);
  assert.equal(stageHandlers.has("mouseup"), false);
  assert.equal(viewListeners.has("pointerdown"), false);
  assert.equal(viewListeners.has("pointerup"), false);
});
