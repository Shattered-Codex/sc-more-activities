import test from "node:test";
import assert from "node:assert/strict";

class ApplicationV2 {
  constructor() {
    this.element = {
      querySelector: () => null,
      querySelectorAll: () => []
    };
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
