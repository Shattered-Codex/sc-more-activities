import test from "node:test";
import assert from "node:assert/strict";

// The behaviour class extends a Foundry base and reads CONST at evaluation
// time, so both have to exist before the module is imported.
globalThis.CONST = { REGION_EVENTS: { TOKEN_MOVE_IN: "tokenMoveIn" } };
globalThis.canvas = null;

class TypeDataModel {}

globalThis.foundry = {
  abstract: { TypeDataModel },
  data: {
    regionBehaviors: { RegionBehaviorType: TypeDataModel },
    fields: {
      StringField: class {
        constructor(options = {}) {
          Object.assign(this, options);
        }
      }
    }
  }
};

const { ScPortalRegionBehavior } = await import("../../scripts/activities/portal/ScPortalRegionBehavior.js");
const { PORTAL_BEHAVIOR_TYPE } = await import("../../scripts/activities/portal/ScPortalConstants.js");

test("the behaviour subscribes to tokenMoveIn", () => {
  // RegionBehavior#hasEvent reads this map, and TokenDocument#_splitMovementPath
  // only inserts a checkpoint at the region boundary when it does. Losing this
  // subscription silently stops portals from noticing tokens that enter them.
  assert.equal("tokenMoveIn" in ScPortalRegionBehavior.events, true);
  assert.equal(typeof ScPortalRegionBehavior.events.tokenMoveIn, "function");
});

test("the behaviour type is namespaced to the module", () => {
  // Must match the documentTypes entry in module.json or the document rejects it.
  assert.equal(PORTAL_BEHAVIOR_TYPE, "sc-more-activities.scPortal");
});

test("the schema links a side to its portal", () => {
  const schema = ScPortalRegionBehavior.defineSchema();
  assert.deepEqual(Object.keys(schema).sort(), ["portalId", "side"]);
  assert.deepEqual(schema.side.choices, ["entry", "exit"]);
});

/** Drives the tokenMoveIn handler with a portal side of the given shape. */
async function enterRegion({ oneWay = false, triggerOnEnter = true, side = "exit" } = {}) {
  const stopped = [];
  const region = {
    id: "region-1",
    flags: {
      "sc-more-activities": {
        portal: {
          portalId: "p1",
          side,
          center: { x: 150, y: 150 },
          radiusPixels: 50,
          oneWay,
          triggerOnEnter
        }
      }
    }
  };
  const regions = new Map([[region.id, region]]);
  regions.contents = [region];
  const scene = { id: "scene-1", regions };
  const token = {
    id: "hero",
    parent: scene,
    stopMovement: () => stopped.push("hero")
  };

  // A non GM client: the workflow past the stop belongs to the active GM, and
  // this test is only about whether the movement is interrupted.
  globalThis.game = { user: { id: "player", isGM: false }, users: { activeGM: { id: "gm" } } };

  await ScPortalRegionBehavior.events.tokenMoveIn.call({ portalId: "p1", side }, {
    data: { token, movement: { passed: { waypoints: [{ action: "move" }] } } },
    user: { isSelf: true }
  });
  delete globalThis.game;
  return stopped;
}

test("walking into the exit of a one way portal does not stop the token", async() => {
  // The service refuses that direction, so stopping first would strand the
  // token mid-move waiting for a prompt that never appears.
  assert.deepEqual(await enterRegion({ oneWay: true, side: "exit" }), []);
});

test("walking into a side that does travel still stops the token", async() => {
  assert.deepEqual(await enterRegion({ oneWay: true, side: "entry" }), ["hero"]);
  assert.deepEqual(await enterRegion({ oneWay: false, side: "exit" }), ["hero"]);
});

test("a side with entry detection off does not stop the token", async() => {
  assert.deepEqual(await enterRegion({ triggerOnEnter: false, side: "entry" }), []);
});

test("registering wires the subtype into the Foundry config", () => {
  globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {}, typeLabels: {} } };

  assert.equal(ScPortalRegionBehavior.register(), true);
  assert.equal(CONFIG.RegionBehavior.dataModels[PORTAL_BEHAVIOR_TYPE], ScPortalRegionBehavior);
  assert.equal(typeof CONFIG.RegionBehavior.typeIcons[PORTAL_BEHAVIOR_TYPE], "string");

  delete globalThis.CONFIG;
});
