import test from "node:test";
import assert from "node:assert/strict";

globalThis.canvas = null;

const { ScPortalConfig } = await import("../../scripts/activities/portal/ScPortalConfig.js");

function makeActivity(portal = {}) {
  return {
    item: { getRollData: () => ({ mod: 4 }) },
    portal
  };
}

test("an activity without portal data falls back to usable defaults", () => {
  const config = ScPortalConfig.fromActivity({});
  assert.equal(config.placementRange, 30);
  assert.equal(config.linkRange, "");
  assert.equal(config.rangeShape, "circle");
  assert.equal(config.shape, "square");
  assert.equal(config.squares, 1);
  assert.equal(config.snapToGrid, true);
  assert.equal(config.avoidOccupied, true);
  assert.equal(config.oneWay, false);
  assert.equal(config.maxUses, "");
  assert.equal(config.visibility, "all");
  assert.equal(config.allowPlayerRequests, true);
});

test("portal range shape is normalized independently from its footprint", () => {
  const config = ScPortalConfig.fromActivity(makeActivity({ rangeShape: "square", shape: "circle" }));
  assert.equal(config.rangeShape, "square");
  assert.equal(config.shape, "circle");
});

test("an explicitly disabled player-use option remains disabled", () => {
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ allowPlayerRequests: false })).allowPlayerRequests, false);
});

test("an empty or zero crossing limit both mean unlimited", () => {
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ maxUses: "" })).maxUses, "");
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ maxUses: "0" })).maxUses, "");
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ maxUses: "3" })).maxUses, 3);
});

test("a duration of zero keeps the portal open until it is closed", () => {
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ durationRounds: "0" })).durationRounds, 0);
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ durationRounds: "10" })).durationRounds, 10);
});

test("the portal footprint is clamped to the offered choices", () => {
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ size: "0" })).squares, 1);
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ size: "-5" })).squares, 1);
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ size: "9" })).squares, 4);
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ size: "3" })).squares, 3);
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ size: "nonsense" })).squares, 1);
});

test("an unknown shape or visibility falls back to the default", () => {
  const config = ScPortalConfig.fromActivity(makeActivity({ shape: "hexagon", visibility: "players" }));
  assert.equal(config.shape, "square");
  assert.equal(config.visibility, "all");
});

test("hidden is a real visibility choice, not a fallback to visible", () => {
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ visibility: "hidden" })).visibility, "hidden");
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ visibility: "gm" })).visibility, "gm");
});

test("an invalid color falls back to the default", () => {
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ color: "purple" })).color, "#8a63d2");
  assert.equal(ScPortalConfig.fromActivity(makeActivity({ color: "#112233" })).color, "#112233");
});

test("numeric fields accept a roll formula", (t) => {
  class FakeRoll {
    constructor(formula, data) {
      this.total = formula === "@mod * 5" ? data.mod * 5 : NaN;
    }

    evaluateSync() {}
  }
  globalThis.Roll = FakeRoll;
  t.after(() => {
    delete globalThis.Roll;
  });

  const config = ScPortalConfig.fromActivity(makeActivity({ placementRange: "@mod * 5" }));
  assert.equal(config.placementRange, 20);
});
