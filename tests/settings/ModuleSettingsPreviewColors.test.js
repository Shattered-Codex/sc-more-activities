import test from "node:test";
import assert from "node:assert/strict";

const { ModuleSettings } = await import("../../scripts/settings/ModuleSettings.js");

const SCOPES = ["teleport", "movement", "wall", "portal"];

test("every preview scope ships a border and a fill default", () => {
  for (const scope of SCOPES) {
    for (const suffix of ["RangeBorder", "RangeFill"]) {
      const value = ModuleSettings.DEFAULT_PREVIEW_COLORS[`${scope}${suffix}`];
      assert.match(value ?? "", /^#[0-9a-f]{6}$/i, `${scope}${suffix} is missing or not a hex color`);
    }
  }
});

test("the portal accessor maps the portal keys, not another scope's", () => {
  // Without a Foundry game global the getters fall back to the defaults, which
  // is enough to prove the accessor reads the right pair of keys.
  const colors = ModuleSettings.getPortalRangeColors();
  assert.equal(colors.borderColor, ModuleSettings.DEFAULT_PREVIEW_COLORS.portalRangeBorder);
  assert.equal(colors.fillColor, ModuleSettings.DEFAULT_PREVIEW_COLORS.portalRangeFill);
  assert.notEqual(colors.borderColor, ModuleSettings.DEFAULT_PREVIEW_COLORS.teleportRangeBorder);
});

test("each scope accessor returns its own colors", () => {
  const accessors = {
    teleport: ModuleSettings.getTeleportRangeColors(),
    movement: ModuleSettings.getMovementRangeColors(),
    wall: ModuleSettings.getWallRangeColors(),
    portal: ModuleSettings.getPortalRangeColors()
  };

  for (const [scope, colors] of Object.entries(accessors)) {
    assert.equal(colors.borderColor, ModuleSettings.DEFAULT_PREVIEW_COLORS[`${scope}RangeBorder`]);
    assert.equal(colors.fillColor, ModuleSettings.DEFAULT_PREVIEW_COLORS[`${scope}RangeFill`]);
  }
});

test("every preview scope ships a blocked color and exposes it", () => {
  for (const scope of SCOPES) {
    const value = ModuleSettings.DEFAULT_PREVIEW_COLORS[`${scope}RangeBlocked`];
    assert.match(value ?? "", /^#[0-9a-f]{6}$/i, `${scope}RangeBlocked is missing or not a hex color`);
    assert.equal(ModuleSettings.getRangeColors(scope).blockedColor, value);
  }
});

test("colors saved before the blocked color existed fall back to its default", (t) => {
  const stored = { teleportRangeBorder: "#112233", teleportRangeFill: "#445566" };
  globalThis.game = {
    settings: {
      settings: { has: () => true },
      get: () => stored
    }
  };
  t.after(() => delete globalThis.game);

  const colors = ModuleSettings.getTeleportRangeColors();
  assert.equal(colors.borderColor, "#112233");
  assert.equal(colors.fillColor, "#445566");
  assert.equal(colors.blockedColor, ModuleSettings.DEFAULT_PREVIEW_COLORS.teleportRangeBlocked);
});
