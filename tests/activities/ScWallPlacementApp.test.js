import test from "node:test";
import assert from "node:assert/strict";

const BUTTONS = [
  ".sc-ma-wall-place",
  ".sc-ma-wall-facing",
  ".sc-ma-wall-next",
  ".sc-ma-wall-finish",
  ".sc-ma-wall-clear",
  ".sc-ma-wall-cancel"
];

class ApplicationV2 {
  constructor() {
    this.buttonHandlers = new Map();
    this.renders = 0;
    this.closed = false;
    this.element = {
      querySelector: (selector) => (BUTTONS.includes(selector) ? this.#control(selector) : null),
      querySelectorAll: () => []
    };
  }

  #control(selector) {
    return {
      addEventListener: (name, handler) => {
        this.buttonHandlers.set(`${selector}:${name}`, handler);
      }
    };
  }

  async _onRender() {}

  render() {
    this.renders += 1;
    return this;
  }

  async close() {
    this.closed = true;
  }
}

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2,
      HandlebarsApplicationMixin: (Base) => Base
    },
    instances: new Map()
  }
};

globalThis.game = {
  i18n: {
    localize(key) {
      return key;
    }
  }
};

globalThis.ui = {
  notifications: {
    warn() {},
    info() {}
  },
  windows: {}
};

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const { ScWallPlacementApp } = await import("../../scripts/activities/wall/ScWallPlacementApp.js");

test("minimizes open document windows during wall placement and restores them on close", async(t) => {
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
  const origin = { id: "origin-token" };
  const scene = { id: "scene-1", grid: { size: 100, distance: 5 } };
  const originals = {
    documentSheet: foundry.applications.api.DocumentSheetV2,
    instances: foundry.applications.instances,
    windows: ui.windows,
    getOriginTokenDocument: ScCanvasActivityService.getOriginTokenDocument,
    getOriginTokenObject: ScCanvasActivityService.getOriginTokenObject
  };

  foundry.applications.api.DocumentSheetV2 = DocumentSheetV2;
  foundry.applications.instances = new Map([["sheet", sheet], ["core", coreUi]]);
  ui.windows = { legacy };
  globalThis.canvas = { scene };
  ScCanvasActivityService.getOriginTokenDocument = () => origin;
  ScCanvasActivityService.getOriginTokenObject = () => origin;

  t.after(() => {
    foundry.applications.api.DocumentSheetV2 = originals.documentSheet;
    foundry.applications.instances = originals.instances;
    ui.windows = originals.windows;
    ScCanvasActivityService.getOriginTokenDocument = originals.getOriginTokenDocument;
    ScCanvasActivityService.getOriginTokenObject = originals.getOriginTokenObject;
    delete globalThis.canvas;
  });

  const app = new ScWallPlacementApp({
    wall: {
      maxWalls: "1",
      wallType: "continuous",
      facing: "both",
      panelSize: "5",
      panelSpacing: "0",
      maxPanels: "",
      referenceRange: "0",
      maxLength: "60"
    }
  });

  await app._onRender({}, {});

  assert.equal(legacy.minimized, true);
  assert.equal(sheet.minimized, true);
  assert.equal(coreUi.minimized, false);

  await app.close();

  assert.equal(legacy.minimized, false);
  assert.equal(sheet.minimized, false);
  assert.equal(coreUi.minimized, false);
  assert.equal(app.closed, true);
});

const WALL_CONFIG = {
  maxWalls: "1",
  wallType: "continuous",
  facing: "both",
  panelSize: "5",
  panelSpacing: "0",
  maxPanels: "",
  referenceRange: "0",
  maxLength: "60"
};

function installPlacementGlobals(t) {
  const stageHandlers = new Map();
  const viewHandlers = new Map();

  globalThis.canvas = {
    scene: { id: "scene-1", grid: { size: 100, distance: 5 } },
    grid: { size: 100, getCenterPoint: (point) => point },
    stage: {
      on(name, handler) {
        stageHandlers.set(name, handler);
      },
      off(name, handler) {
        if (stageHandlers.get(name) === handler) {
          stageHandlers.delete(name);
        }
      }
    },
    app: {
      view: {
        addEventListener(name, handler) {
          viewHandlers.set(name, handler);
        },
        removeEventListener(name, handler) {
          if (viewHandlers.get(name) === handler) {
            viewHandlers.delete(name);
          }
        }
      }
    },
    canvasCoordinatesFromClient: (event) => ({ x: event.clientX, y: event.clientY })
  };

  const origin = { id: "origin-token", name: "Origin" };
  const originals = {
    getOriginTokenDocument: ScCanvasActivityService.getOriginTokenDocument,
    getOriginTokenObject: ScCanvasActivityService.getOriginTokenObject,
    getTokenCenter: ScCanvasActivityService.getTokenCenter,
    executeWallPlacement: ScCanvasActivityService.executeWallPlacement,
    removePreviewTemplate: ScCanvasActivityService.removePreviewTemplate
  };

  ScCanvasActivityService.getOriginTokenDocument = () => origin;
  ScCanvasActivityService.getOriginTokenObject = () => origin;
  ScCanvasActivityService.getTokenCenter = () => ({ x: 0, y: 0 });
  ScCanvasActivityService.executeWallPlacement = async() => ({ ok: false });
  ScCanvasActivityService.removePreviewTemplate = async() => {};

  const warnings = [];
  const previousWarn = ui.notifications.warn;
  ui.notifications.warn = (message) => warnings.push(message);

  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      ScCanvasActivityService[key] = value;
    }
    ui.notifications.warn = previousWarn;
    delete globalThis.canvas;
  });

  return { stageHandlers, viewHandlers, warnings };
}

function stageClick({ x, y }) {
  return {
    data: {
      originalEvent: {
        button: 0,
        clientX: x,
        clientY: y,
        preventDefault() {},
        stopPropagation() {}
      }
    }
  };
}

async function placeTwoPointWall(app, stageHandlers) {
  await app._onRender({}, {});
  await app.buttonHandlers.get(".sc-ma-wall-place:click")();
  await stageHandlers.get("mouseup")(stageClick({ x: 0, y: 0 }));
  await stageHandlers.get("mouseup")(stageClick({ x: 100, y: 0 }));
  assert.equal(app.placementPoints.length, 2);
}

test("unlocks the window when the wall placement throws", async(t) => {
  const { stageHandlers } = installPlacementGlobals(t);
  ScCanvasActivityService.executeWallPlacement = async() => {
    throw new Error("wall creation failed");
  };

  const app = new ScWallPlacementApp({ wall: { ...WALL_CONFIG } });
  await placeTwoPointWall(app, stageHandlers);

  await assert.rejects(() => app.buttonHandlers.get(".sc-ma-wall-finish:click")());

  // Leaving the flag set disables every button on a window that is still open,
  // with no way to retry or place another wall.
  assert.equal(app.isSubmitting, false);
  assert.equal(app.closed, false);
});

test("unlocks the window when the wall placement is refused", async(t) => {
  const { stageHandlers } = installPlacementGlobals(t);
  const app = new ScWallPlacementApp({ wall: { ...WALL_CONFIG } });
  await placeTwoPointWall(app, stageHandlers);

  await app.buttonHandlers.get(".sc-ma-wall-finish:click")();

  assert.equal(app.isSubmitting, false);
  assert.equal(app.closed, false);
});

test("warns instead of swallowing a placement click that maps to no position", async(t) => {
  const { stageHandlers, warnings } = installPlacementGlobals(t);
  const app = new ScWallPlacementApp({ wall: { ...WALL_CONFIG } });
  await app._onRender({}, {});
  await app.buttonHandlers.get(".sc-ma-wall-place:click")();

  globalThis.canvas.canvasCoordinatesFromClient = () => ({ x: NaN, y: NaN });
  await stageHandlers.get("mouseup")(stageClick({ x: 10, y: 10 }));

  assert.deepEqual(warnings, ["The requested canvas position is invalid."]);
  assert.deepEqual(app.placementPoints, []);
  // Placement stays armed so the next click can still land.
  assert.equal(app.isPlacing, true);
});
