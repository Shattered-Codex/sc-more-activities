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
const { ScSaveRequestCard } = await import("../../scripts/activities/canvas/ScSaveRequestCard.js");
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

test("sends the distance picked in the window with the movement", async(t) => {
  installGlobals(t, { targetsSelf: false });

  const previewDistances = [];
  ScCanvasActivityService.getMovementPreviewData = (_activity, options) => {
    previewDistances.push(options?.distance ?? null);
    return previewData({ targetsSelf: false });
  };
  let sent = null;
  ScCanvasActivityService.executeMovement = async(_activity, options) => {
    sent = options;
    return { ok: false };
  };

  const app = new ScMovementPreviewApp(makeActivity({ distanceMode: "range", minDistance: 5, distance: 15 }));
  let chipHandler = null;
  const chip = {
    dataset: { movementDistance: "10" },
    addEventListener: (name, handler) => {
      if (name === "click") {
        chipHandler = handler;
      }
    }
  };
  app.element.querySelectorAll = (selector) => (selector === "[data-movement-distance]" ? [chip] : []);
  await app._onRender({}, {});

  chipHandler({ currentTarget: chip });
  assert.equal(app.movementDistance, 10);
  // The mocked render does not rebuild the context, so the preview is asked directly.
  const context = await app._prepareContext();
  assert.equal(previewDistances.at(-1), 10);
  assert.equal(context.hasDistanceChoice, true);

  await app.buttonHandlers.get(".sc-ma-movement-confirm:click")();
  assert.equal(sent.distance, 10);
});

test("ignores a distance outside the activity's range", async(t) => {
  installGlobals(t, { targetsSelf: false });
  let sent = null;
  ScCanvasActivityService.executeMovement = async(_activity, options) => {
    sent = options;
    return { ok: false };
  };

  const app = new ScMovementPreviewApp(makeActivity({ distanceMode: "range", minDistance: 5, distance: 15 }));
  let chipHandler = null;
  const chip = {
    dataset: { movementDistance: "40" },
    addEventListener: (_name, handler) => {
      chipHandler = handler;
    }
  };
  app.element.querySelectorAll = (selector) => (selector === "[data-movement-distance]" ? [chip] : []);
  await app._onRender({}, {});

  chipHandler({ currentTarget: chip });
  assert.equal(app.movementDistance, null);

  // Nothing picked moves the maximum.
  await app.buttonHandlers.get(".sc-ma-movement-confirm:click")();
  assert.equal(sent.distance, 15);
});

test("the save gate posts the selected distance for deferred movement", async(t) => {
  installGlobals(t, { targetsSelf: false });
  let request = null;
  t.mock.method(ScSaveRequestCard, "postMovementRequest", async(_activity, options) => {
    request = options;
    return { posted: true };
  });
  const execute = t.mock.method(ScCanvasActivityService, "executeMovement");
  const app = new ScMovementPreviewApp(makeActivity({
    distanceMode: "range", minDistance: 5, distance: 30,
    save: { enabled: true, ability: "str", dc: "14" }
  }));
  app.movementDistance = 15;
  await app._onRender({}, {});
  await app.buttonHandlers.get(".sc-ma-movement-confirm:click")();

  assert.equal(request.distance, 15);
  assert.equal(execute.mock.callCount(), 0);
  assert.equal(app.closed, true);
});

test("canceling after choosing a distance settles the usage without moving tokens", async(t) => {
  installGlobals(t, { targetsSelf: false });
  const execute = t.mock.method(ScCanvasActivityService, "executeMovement");
  const canceled = [];
  const app = new ScMovementPreviewApp(
    makeActivity({ distanceMode: "range", minDistance: 5, distance: 30 }),
    { settlement: { cancelIfPending: (reason) => canceled.push(reason) } }
  );
  app.movementDistance = 15;
  await app._onRender({}, {});
  await app.buttonHandlers.get(".sc-ma-movement-cancel:click")();

  assert.equal(execute.mock.callCount(), 0);
  assert.equal(app.closed, true);
  assert.deepEqual(canceled, ["movement-canceled"]);
});

/** Wires the slider and its −/+ buttons the way the rendered template would. */
function sliderElements(app) {
  const handlers = new Map();
  const readout = { textContent: "" };
  const distanceStat = { textContent: "60" };
  const slider = {
    value: "0",
    attributes: new Map([["aria-valuetext", "60 ft"]]),
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener: (name, handler) => handlers.set(`slider:${name}`, handler)
  };
  const stepButton = (step) => ({
    dataset: { movementDistanceStep: String(step) },
    addEventListener: (name, handler) => handlers.set(`step${step}:${name}`, handler)
  });
  const steps = [stepButton(-1), stepButton(1)];
  const baseQuery = app.element.querySelector;
  app.element.querySelector = (selector) => {
    if (selector === "input[data-movement-distance-slider]") {
      return slider;
    }
    if (selector === "[data-movement-distance-label]") {
      return readout;
    }
    if (selector === "[data-movement-distance-value]") {
      return distanceStat;
    }
    return baseQuery(selector);
  };
  app.element.querySelectorAll = (selector) => (selector === "[data-movement-distance-step]" ? steps : []);
  return { handlers, readout, distanceStat, slider, steps };
}

function rangedPreview() {
  return { ...previewData({ targetsSelf: false }), scene: { id: "scene-1", grid: { distance: 5, units: "ft" } } };
}

test("a short range shows buttons and a long one a slider", async(t) => {
  installGlobals(t, { targetsSelf: false });
  ScCanvasActivityService.getMovementPreviewData = () => rangedPreview();

  const short = new ScMovementPreviewApp(makeActivity({ distanceMode: "range", minDistance: 5, distance: 20 }));
  const shortContext = await short._prepareContext();
  assert.equal(shortContext.distanceUsesSlider, false);
  assert.deepEqual(shortContext.distanceChoices.map((choice) => choice.label), ["5 ft", "10 ft", "15 ft", "20 ft"]);

  const long = new ScMovementPreviewApp(makeActivity({ distanceMode: "range", minDistance: 5, distance: 60 }));
  const longContext = await long._prepareContext();
  assert.equal(longContext.distanceUsesSlider, true);
  assert.deepEqual(longContext.distanceChoices, []);
  // Grid steps are kept: 5 through 60 is twelve positions, the maximum preselected.
  assert.equal(longContext.distanceMaxIndex, 11);
  assert.equal(longContext.distanceIndex, 11);
  assert.equal(longContext.distanceLabel, "60 ft");
  assert.equal(longContext.canIncreaseDistance, false);
  assert.equal(longContext.canDecreaseDistance, true);
});

test("a grid change keeps a valid chosen distance in sync with the picker", async(t) => {
  installGlobals(t, { targetsSelf: false });
  ScCanvasActivityService.getMovementPreviewData = () => ({
    ...rangedPreview(), scene: { id: "scene-1", grid: { distance: 10, units: "ft" } }
  });
  const app = new ScMovementPreviewApp(makeActivity({ distanceMode: "range", minDistance: 5, distance: 60 }));
  app.movementDistance = 15;

  const context = await app._prepareContext();

  assert.equal(context.distanceLabel, "15 ft");
  assert.equal(app.distanceValues[context.distanceIndex], 15);
});

test("dragging the slider and the −/+ buttons pick a distance from the range", async(t) => {
  installGlobals(t, { targetsSelf: false });
  ScCanvasActivityService.getMovementPreviewData = () => rangedPreview();
  let sent = null;
  ScCanvasActivityService.executeMovement = async(_activity, options) => {
    sent = options;
    return { ok: false };
  };

  const app = new ScMovementPreviewApp(makeActivity({ distanceMode: "range", minDistance: 5, distance: 60 }));
  await app._prepareContext();
  const { handlers, readout, distanceStat, slider } = sliderElements(app);
  await app._onRender({}, {});

  // Index 2 of 5, 10, 15, … is 15 ft; the readout follows without a render.
  const rendersBefore = app.renders;
  slider.value = "2";
  handlers.get("slider:input")({ currentTarget: slider });
  assert.equal(app.movementDistance, 15);
  assert.equal(readout.textContent, "15 ft");
  assert.equal(distanceStat.textContent, "15");
  assert.equal(slider.attributes.get("aria-valuetext"), "15 ft");
  assert.equal(app.renders, rendersBefore);

  handlers.get("step1:click")({ currentTarget: { dataset: { movementDistanceStep: "1" } } });
  assert.equal(app.movementDistance, 20);
  handlers.get("step-1:click")({ currentTarget: { dataset: { movementDistanceStep: "-1" } } });
  handlers.get("step-1:click")({ currentTarget: { dataset: { movementDistanceStep: "-1" } } });
  assert.equal(app.movementDistance, 10);

  await app.buttonHandlers.get(".sc-ma-movement-confirm:click")();
  assert.equal(sent.distance, 10);
});
