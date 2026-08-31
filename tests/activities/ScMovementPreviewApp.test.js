import test from "node:test";
import assert from "node:assert/strict";

const BUTTONS = [
  ".sc-ma-movement-choose-self-direction",
  ".sc-ma-movement-confirm",
  ".sc-ma-movement-cancel"
];

class ApplicationV2 {
  constructor() {
    this.buttonHandlers = new Map();
    this.renders = 0;
    this.closed = false;
    this.element = {
      querySelector: (selector) => (BUTTONS.includes(selector) ? this.#button(selector) : null),
      querySelectorAll: () => []
    };
  }

  #button(selector) {
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
    },
    format(key) {
      return key;
    }
  },
  user: { id: "user-1", targets: new Set() }
};

globalThis.ui = {
  notifications: {
    warn() {},
    info() {}
  },
  windows: {}
};

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");
const { ScMovementPreviewApp } = await import("../../scripts/activities/movement/ScMovementPreviewApp.js");
const { ScCanvasResultCard } = await import("../../scripts/activities/canvas/ScCanvasResultCard.js");
const { MOVEMENT_TYPES } = await import("../../scripts/activities/canvas/ScCanvasActivityConstants.js");

const ORIGIN = { id: "origin-token", name: "Origin" };
const CANVAS_VIEW = { id: "canvas-view" };

function canvasEvent(props = {}) {
  return {
    button: 0,
    preventDefault() {},
    stopPropagation() {},
    ...props
  };
}

/**
 * The direction picker only arms when the origin token is one of the targets,
 * which is what "self direction" means: the actor is pushing or pulling itself.
 */
function previewData({ targetsSelf = true } = {}) {
  const targets = targetsSelf
    ? [{ token: ORIGIN, distance: 0, inRange: true }]
    : [{ token: { id: "target-token", name: "Target" }, distance: 5, inRange: true }];

  return {
    scene: { id: "scene-1" },
    origin: ORIGIN,
    config: { maxRange: 0, maxTargets: 5 },
    targets
  };
}

function installGlobals(t, { targetsSelf = true } = {}) {
  const handlers = new Map();
  globalThis.canvas = {
    scene: { id: "scene-1", grid: { size: 100 } },
    app: {
      view: {
        addEventListener(name, handler) {
          handlers.set(name, handler);
        },
        removeEventListener(name, handler) {
          if (handlers.get(name) === handler) {
            handlers.delete(name);
          }
        }
      }
    },
    canvasCoordinatesFromClient: (event) => ({ x: event.clientX, y: event.clientY })
  };

  const originals = {
    getMovementPreviewData: ScCanvasActivityService.getMovementPreviewData,
    getOriginTokenDocument: ScCanvasActivityService.getOriginTokenDocument,
    getOriginTokenObject: ScCanvasActivityService.getOriginTokenObject,
    getTokenCenter: ScCanvasActivityService.getTokenCenter,
    executeMovement: ScCanvasActivityService.executeMovement
  };

  ScCanvasActivityService.getMovementPreviewData = () => previewData({ targetsSelf });
  ScCanvasActivityService.getOriginTokenDocument = () => ORIGIN;
  ScCanvasActivityService.getOriginTokenObject = () => ORIGIN;
  ScCanvasActivityService.getTokenCenter = () => ({ x: 100, y: 100 });
  ScCanvasActivityService.executeMovement = async() => ({ ok: false });

  const warnings = [];
  const previousWarn = globalThis.ui.notifications.warn;
  globalThis.ui.notifications.warn = (message) => warnings.push(message);

  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      ScCanvasActivityService[key] = value;
    }
    globalThis.ui.notifications.warn = previousWarn;
    delete globalThis.canvas;
  });

  return { handlers, warnings };
}

function makeActivity(overrides = {}) {
  return {
    movement: {
      type: MOVEMENT_TYPES.PUSH,
      ...overrides
    }
  };
}

async function armDirectionPicker(app) {
  await app._onRender({}, {});
  app.buttonHandlers.get(".sc-ma-movement-choose-self-direction:click")();
  assert.equal(app.isChoosingSelfDirection, true);
}

test("hands the canvas back when the origin is gone mid-pick", async(t) => {
  const { handlers, warnings } = installGlobals(t);
  const app = new ScMovementPreviewApp(makeActivity());
  await armDirectionPicker(app);

  // The token is released after the picker armed — switching canvas layers does
  // exactly that — so the direction can no longer be measured.
  ScCanvasActivityService.getOriginTokenObject = () => null;

  handlers.get("pointerup")(canvasEvent({ clientX: 300, clientY: 300 }));

  assert.deepEqual(warnings, ["Select or place the activity actor token on the scene first."]);
  assert.equal(app.selfDirectionPoint, null);
  // The consumed clicks have to stop, or the canvas stays unresponsive with
  // nothing on screen explaining why.
  assert.equal(app.isChoosingSelfDirection, false);
  assert.equal(handlers.has("pointerup"), false);
  assert.equal(handlers.has("pointerdown"), false);
});

test("warns instead of swallowing a click that maps to no canvas position", async(t) => {
  const { handlers, warnings } = installGlobals(t);
  const app = new ScMovementPreviewApp(makeActivity());
  await armDirectionPicker(app);

  globalThis.canvas.canvasCoordinatesFromClient = () => ({ x: NaN, y: NaN });
  handlers.get("pointerup")(canvasEvent({ clientX: 300, clientY: 300 }));

  assert.deepEqual(warnings, ["The requested canvas position is invalid."]);
  assert.equal(app.selfDirectionPoint, null);
  assert.equal(app.isChoosingSelfDirection, true);
});

test("warns when the click lands on the origin and gives no direction", async(t) => {
  const { handlers, warnings } = installGlobals(t);
  const app = new ScMovementPreviewApp(makeActivity());
  await armDirectionPicker(app);

  handlers.get("pointerup")(canvasEvent({ clientX: 100, clientY: 100 }));

  assert.deepEqual(warnings, ["Choose a movement direction for the self target."]);
  assert.equal(app.selfDirectionPoint, null);
  assert.equal(app.isChoosingSelfDirection, true);
});

test("records the direction and releases the canvas on a usable click", async(t) => {
  const { handlers, warnings } = installGlobals(t);
  const app = new ScMovementPreviewApp(makeActivity());
  await armDirectionPicker(app);

  handlers.get("pointerup")(canvasEvent({ clientX: 300, clientY: 220 }));

  assert.deepEqual(warnings, []);
  assert.deepEqual(app.selfDirectionPoint, { x: 300, y: 220 });
  assert.equal(app.isChoosingSelfDirection, false);
  assert.equal(handlers.has("pointerup"), false);
});

test("unlocks the window when the movement throws", async(t) => {
  installGlobals(t, { targetsSelf: false });
  ScCanvasActivityService.executeMovement = async() => {
    throw new Error("movement failed");
  };

  const app = new ScMovementPreviewApp(makeActivity());
  await app._onRender({}, {});

  const confirm = app.buttonHandlers.get(".sc-ma-movement-confirm:click");
  await assert.rejects(() => confirm());

  // Leaving the flag set locks the confirm button for good, with the window
  // still open and no way to retry.
  assert.equal(app.isSubmitting, false);
  assert.equal(app.closed, false);
});

test("unlocks the window when the movement is rejected", async(t) => {
  installGlobals(t, { targetsSelf: false });
  const app = new ScMovementPreviewApp(makeActivity());
  await app._onRender({}, {});

  await app.buttonHandlers.get(".sc-ma-movement-confirm:click")();

  assert.equal(app.isSubmitting, false);
  assert.equal(app.closed, false);
});

test("keeps a finished movement finished when the result card fails", async(t) => {
  installGlobals(t, { targetsSelf: false });

  let moves = 0;
  ScCanvasActivityService.executeMovement = async() => {
    moves += 1;
    return { ok: true };
  };

  const previousCard = ScCanvasResultCard.createMovementCard;
  const previousError = console.error;
  ScCanvasResultCard.createMovementCard = async() => {
    throw new Error("chat message rejected");
  };
  console.error = () => {};
  t.after(() => {
    ScCanvasResultCard.createMovementCard = previousCard;
    console.error = previousError;
  });

  const app = new ScMovementPreviewApp(makeActivity());
  await app._onRender({}, {});
  const confirm = app.buttonHandlers.get(".sc-ma-movement-confirm:click");

  await confirm();

  // The card is reporting: losing it must not lose the window close, and it
  // must not undo the movement either.
  assert.equal(moves, 1);
  assert.equal(app.closed, true);

  // The tokens already moved, so the button cannot come back and repeat it.
  await confirm();
  assert.equal(moves, 1);
});
