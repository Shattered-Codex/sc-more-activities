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
