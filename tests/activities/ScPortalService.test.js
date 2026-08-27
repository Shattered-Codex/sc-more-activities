import test from "node:test";
import assert from "node:assert/strict";

globalThis.canvas = null;

const { ScPortalService } = await import("../../scripts/activities/portal/ScPortalService.js");

const MODULE_ID = "sc-more-activities";

function makeToken({ id, x, y, width = 1, height = 1, owner = true }) {
  const token = {
    id,
    name: id,
    x,
    y,
    width,
    height,
    elevation: 0,
    moves: [],
    rendered: false,
    testUserPermission: () => owner
  };
  // Mirrors TokenDocument#move, which is how the service places a traveller.
  // The real one only settles after a server round trip, so this one yields
  // too: without it nothing else can run while a token is being moved, and a
  // race between two travellers could never show up here.
  token.move = async(waypoint) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    token.moves.push(waypoint);
    token.x = waypoint.x;
    token.y = waypoint.y;
    return token;
  };
  return token;
}

/** The waypoints a token was moved through, in the shape the service sends. */
function movesOf(scene, tokenId) {
  return scene.tokens.get(tokenId)?.moves ?? [];
}

function makeRegion(scene, { id, portalId, side, center, overrides = {} }) {
  return {
    id,
    parent: scene,
    flags: {
      [MODULE_ID]: {
        portal: {
          portalId,
          side,
          label: "Portal",
          center,
          shape: "square",
          radiusPixels: 50,
          oneWay: false,
          snapToGrid: true,
          avoidOccupied: true,
          triggerOnEnter: true,
          triggerOnClick: true,
          usesLeft: null,
          expiresAtRound: null,
          expiresAtWorldTime: null,
          combatId: null,
          activityUuid: "Activity.abc",
          createdBy: "gm",
          ...overrides
        }
      }
    }
  };
}

function makeScene({ tokens = [], portalOverrides = {} } = {}) {
  const scene = {
    id: "scene-1",
    grid: { size: 100, distance: 5, type: 1 },
    dimensions: { width: 2000, height: 2000 },
    tokenUpdates: [],
    deleted: [],
    created: []
  };

  const tokenCollection = new Map(tokens.map((token) => [token.id, token]));
  tokenCollection.contents = tokens;
  scene.tokens = tokenCollection;
  for (const token of tokens) {
    token.parent = scene;
  }

  const regions = [
    makeRegion(scene, { id: "region-entry", portalId: "p1", side: "entry", center: { x: 150, y: 150 }, overrides: portalOverrides }),
    makeRegion(scene, { id: "region-exit", portalId: "p1", side: "exit", center: { x: 950, y: 950 }, overrides: portalOverrides })
  ];
  const regionCollection = new Map(regions.map((region) => [region.id, region]));
  regionCollection.contents = regions;
  scene.regions = regionCollection;

  const tileCollection = new Map();
  tileCollection.contents = [];
  scene.tiles = tileCollection;

  scene.updateEmbeddedDocuments = async(type, updates) => {
    if (type === "Token") {
      scene.tokenUpdates.push(...updates);
    }
    if (type === "Region") {
      for (const update of updates) {
        const region = scene.regions.get(update._id);
        const value = update[`flags.${MODULE_ID}.portal.usesLeft`];
        if (region && value !== undefined) {
          region.flags[MODULE_ID].portal.usesLeft = value;
        }
      }
    }
    return updates;
  };
  scene.deleteEmbeddedDocuments = async(type, ids) => {
    scene.deleted.push([type, ids]);
    for (const id of ids) {
      if (type === "Region") {
        scene.regions.delete(id);
      }
    }
    scene.regions.contents = [...scene.regions.values()];
    return ids;
  };
  scene.createEmbeddedDocuments = async(type, data) => {
    scene.created.push([type, data]);
    return data;
  };
  return scene;
}

function installGlobals(t, scene, { worldTime = 0, combat = null } = {}) {
  globalThis.game = {
    i18n: { localize: (key) => key, format: (key) => key },
    user: { id: "gm", isGM: true },
    users: new Map([["gm", { id: "gm", isGM: true, active: true }]]),
    scenes: new Map([[scene.id, scene]]),
    combats: new Map(combat ? [[combat.id, combat]] : []),
    combat,
    time: { worldTime },
    documentTypes: { RegionBehavior: ["sc-more-activities.scPortal"] }
  };
  globalThis.game.users.players = [];
  globalThis.game.users.activeGM = { id: "gm", isGM: true, active: true };
  globalThis.canvas = null;
  globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
  globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 }, REGION_VISIBILITY: { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 } };
  globalThis.CONFIG = { time: { roundTime: 6 } };
  globalThis.ChatMessage = { create: async() => ({}), getSpeaker: () => ({}) };
  globalThis.foundry = { utils: { randomID: () => "portal-id", escapeHTML: (value) => value } };
  globalThis.fromUuid = async() => null;

  t.after(() => {
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.CONST;
    delete globalThis.CONFIG;
    delete globalThis.ChatMessage;
    delete globalThis.foundry;
    delete globalThis.fromUuid;
    globalThis.canvas = null;
  });
}

function travelRequest(scene, overrides = {}) {
  return {
    operation: "travel",
    sceneId: scene.id,
    requestUserId: "gm",
    portalId: "p1",
    side: "entry",
    tokenId: "hero",
    ...overrides
  };
}

test("travelling moves the token to the far side of the portal", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({ tokens: [hero] });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, true);
  assert.deepEqual(movesOf(scene, "hero"), [{ x: 900, y: 900, elevation: 0, action: "displace" }]);
});

test("a token already on the exit square is nudged to a free cell", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const squatter = makeToken({ id: "squatter", x: 900, y: 900 });
  const scene = makeScene({ tokens: [hero, squatter] });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, true);
  const [waypoint] = movesOf(scene, "hero");
  assert.notDeepEqual({ x: waypoint.x, y: waypoint.y }, { x: 900, y: 900 });
  assert.equal(Math.hypot(waypoint.x - 900, waypoint.y - 900), 100);
});

test("travel is refused when every space around the exit is taken", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const blockers = [];
  for (let column = -3; column <= 3; column += 1) {
    for (let row = -3; row <= 3; row += 1) {
      blockers.push(makeToken({ id: `blocker-${column}-${row}`, x: 900 + (column * 100), y: 900 + (row * 100) }));
    }
  }
  const scene = makeScene({ tokens: [hero, ...blockers] });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, false);
  assert.deepEqual(movesOf(scene, "hero"), []);
});

test("a token that walked away from the portal is not sent through", async(t) => {
  // The prompt stays open for minutes, so the token can be somewhere else by
  // the time the answer arrives.
  const hero = makeToken({ id: "hero", x: 1500, y: 1500 });
  const scene = makeScene({ tokens: [hero] });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, false);
  assert.deepEqual(movesOf(scene, "hero"), []);
});

test("two tokens entering together cannot both spend the last use", async(t) => {
  const first = makeToken({ id: "first", x: 100, y: 100 });
  const second = makeToken({ id: "second", x: 200, y: 100 });
  const scene = makeScene({ tokens: [first, second], portalOverrides: { usesLeft: 1 } });
  installGlobals(t, scene);

  const [one, two] = await Promise.all([
    ScPortalService.executeOperation(travelRequest(scene, { tokenId: "first" })),
    ScPortalService.executeOperation(travelRequest(scene, { tokenId: "second" }))
  ]);

  assert.deepEqual([one.ok, two.ok].sort(), [false, true]);
  assert.equal(movesOf(scene, "first").length + movesOf(scene, "second").length, 1);
});

test("simultaneous travellers do not land on the same square", async(t) => {
  const first = makeToken({ id: "first", x: 100, y: 100 });
  const second = makeToken({ id: "second", x: 200, y: 100 });
  const scene = makeScene({ tokens: [first, second] });
  installGlobals(t, scene);

  await Promise.all([
    ScPortalService.executeOperation(travelRequest(scene, { tokenId: "first" })),
    ScPortalService.executeOperation(travelRequest(scene, { tokenId: "second" }))
  ]);

  const [landedFirst] = movesOf(scene, "first");
  const [landedSecond] = movesOf(scene, "second");
  assert.notDeepEqual(
    { x: landedFirst.x, y: landedFirst.y },
    { x: landedSecond.x, y: landedSecond.y }
  );
});

test("a destination at the edge of the scene keeps searching inwards", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({ tokens: [hero] });
  installGlobals(t, scene);
  // The exit sits in the bottom right corner, so the centre cell and every
  // candidate beyond it hang off the map.
  for (const region of scene.regions.values()) {
    if (region.flags[MODULE_ID].portal.side === "exit") {
      region.flags[MODULE_ID].portal.center = { x: 1990, y: 1990 };
    }
  }

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, true);
  const [waypoint] = movesOf(scene, "hero");
  assert.ok(waypoint.x >= 0 && waypoint.x + 100 <= 2000, `x ${waypoint.x}`);
  assert.ok(waypoint.y >= 0 && waypoint.y + 100 <= 2000, `y ${waypoint.y}`);
});

test("a one way portal refuses travel from the exit side", async(t) => {
  const hero = makeToken({ id: "hero", x: 900, y: 900 });
  const scene = makeScene({ tokens: [hero], portalOverrides: { oneWay: true } });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation(travelRequest(scene, { side: "exit" }));

  assert.equal(result.ok, false);
  assert.deepEqual(movesOf(scene, "hero"), []);
});

test("the last crossing spends the final use and closes both sides", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({ tokens: [hero], portalOverrides: { usesLeft: 1 } });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, true);
  assert.equal(result.usesLeft, 0);
  assert.equal(result.closed, true);
  assert.deepEqual(scene.deleted, [["Region", ["region-entry", "region-exit"]]]);
});

test("a crossing with uses to spare decrements both sides", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({ tokens: [hero], portalOverrides: { usesLeft: 3 } });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.usesLeft, 2);
  assert.equal(scene.regions.get("region-entry").flags[MODULE_ID].portal.usesLeft, 2);
  assert.equal(scene.regions.get("region-exit").flags[MODULE_ID].portal.usesLeft, 2);
  assert.deepEqual(scene.deleted, []);
});

test("an expired portal closes instead of moving the token", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({ tokens: [hero], portalOverrides: { expiresAtWorldTime: 60 } });
  installGlobals(t, scene, { worldTime: 120 });

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, false);
  assert.deepEqual(movesOf(scene, "hero"), []);
  assert.deepEqual(scene.deleted, [["Region", ["region-entry", "region-exit"]]]);
});

test("a round deadline is read from the combat that opened the portal", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({
    tokens: [hero],
    portalOverrides: { expiresAtRound: 5, combatId: "combat-1", expiresAtWorldTime: 999999 }
  });
  const combat = { id: "combat-1", round: 5, started: true };
  installGlobals(t, scene, { combat });

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, false);
  assert.deepEqual(scene.deleted, [["Region", ["region-entry", "region-exit"]]]);
});

test("a portal whose combat is still short of the deadline stays open", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({
    tokens: [hero],
    portalOverrides: { expiresAtRound: 5, combatId: "combat-1", expiresAtWorldTime: 999999 }
  });
  const combat = { id: "combat-1", round: 3, started: true };
  installGlobals(t, scene, { combat });

  const result = await ScPortalService.executeOperation(travelRequest(scene));

  assert.equal(result.ok, true);
  assert.deepEqual(movesOf(scene, "hero"), [{ x: 900, y: 900, elevation: 0, action: "displace" }]);
});

test("closing a portal removes both sides", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);

  const result = await ScPortalService.executeOperation({
    operation: "close",
    sceneId: scene.id,
    requestUserId: "gm",
    portalId: "p1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.deepEqual(scene.deleted, [["Region", ["region-entry", "region-exit"]]]);
});

test("a player cannot close a portal", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);
  globalThis.game.users.set("player", { id: "player", isGM: false, active: true });

  const result = await ScPortalService.executeOperation({
    operation: "close",
    sceneId: scene.id,
    requestUserId: "player",
    portalId: "p1"
  });

  assert.equal(result.ok, false);
  assert.deepEqual(scene.deleted, []);
});

test("a player without ownership of the token cannot send it through", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100, owner: false });
  const scene = makeScene({ tokens: [hero] });
  installGlobals(t, scene);
  globalThis.game.users.set("player", { id: "player", isGM: false, active: true });

  const result = await ScPortalService.executeOperation(travelRequest(scene, { requestUserId: "player" }));

  assert.equal(result.ok, false);
  assert.deepEqual(movesOf(scene, "hero"), []);
});

test("portal lookup finds the side under a point and ignores everything else", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);

  assert.equal(ScPortalService.findPortalAtPoint(scene, { x: 160, y: 140 })?.side, "entry");
  assert.equal(ScPortalService.findPortalAtPoint(scene, { x: 940, y: 960 })?.side, "exit");
  assert.equal(ScPortalService.findPortalAtPoint(scene, { x: 500, y: 500 }), null);
});

function makeActivity({ owner = true, ...overrides } = {}) {
  return {
    uuid: "Activity.abc",
    name: "Open Portal",
    item: { name: "Ring of Gates", testUserPermission: () => owner },
    portal: {
      placementRange: "30",
      linkRange: "",
      shape: "square",
      size: "1",
      snapToGrid: true,
      avoidOccupied: true,
      oneWay: false,
      triggerOnEnter: true,
      triggerOnClick: true,
      maxUses: "2",
      durationRounds: "10",
      visibility: "all",
      color: "#8a63d2",
      entryImage: "",
      exitImage: "",
      allowPlayerRequests: false,
      ...overrides
    }
  };
}

function createRequest(scene, overrides = {}) {
  return {
    operation: "create",
    activityUuid: "Activity.abc",
    sceneId: scene.id,
    requestUserId: "gm",
    entry: { x: 150, y: 150 },
    exit: { x: 450, y: 450 },
    originTokenId: "caster",
    ...overrides
  };
}

test("creating a portal writes both sides with a shape and the configured limits", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity();

  const result = await ScPortalService.executeOperation(createRequest(scene));

  assert.equal(result.ok, true);
  const [[type, documents]] = scene.created;
  assert.equal(type, "Region");
  assert.equal(documents.length, 2);

  const [entry, exit] = documents.map((document) => document.flags[MODULE_ID].portal);
  assert.equal(entry.side, "entry");
  assert.equal(exit.side, "exit");
  assert.equal(entry.portalId, exit.portalId);
  assert.equal(entry.usesLeft, 2);
  assert.equal(entry.expiresAtWorldTime, 60);
  assert.equal(entry.expiresAtRound, null);
  assert.deepEqual(documents[0].shapes, [{
    type: "rectangle",
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0,
    hole: false
  }]);
});

test("a side placed beyond the placement range is refused", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity();

  const result = await ScPortalService.executeOperation(createRequest(scene, { exit: { x: 950, y: 950 } }));

  assert.equal(result.ok, false);
  assert.deepEqual(scene.created, []);
});

test("sides further apart than the link range are refused", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ linkRange: "10" });

  const result = await ScPortalService.executeOperation(createRequest(scene));

  assert.equal(result.ok, false);
  assert.deepEqual(scene.created, []);
});

test("an unlimited portal stores no use counter and no deadline", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ maxUses: "", durationRounds: "0" });

  const result = await ScPortalService.executeOperation(createRequest(scene));

  assert.equal(result.ok, true);
  const portal = scene.created[0][1][0].flags[MODULE_ID].portal;
  assert.equal(portal.usesLeft, null);
  assert.equal(portal.expiresAtWorldTime, null);
  assert.equal(ScPortalService.isExpired(portal), false);
});

test("a player cannot open a portal unless the activity allows it", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.game.users.set("player", { id: "player", isGM: false, active: true });
  globalThis.fromUuid = async() => makeActivity();

  const result = await ScPortalService.executeOperation(createRequest(scene, { requestUserId: "player" }));

  assert.equal(result.ok, false);
  assert.deepEqual(scene.created, []);
});

test("a player may open a portal when the activity allows it", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.game.users.set("player", { id: "player", isGM: false, active: true });
  globalThis.fromUuid = async() => makeActivity({ allowPlayerRequests: true });

  const result = await ScPortalService.executeOperation(createRequest(scene, { requestUserId: "player" }));

  assert.equal(result.ok, true);
  assert.equal(scene.created.length, 1);
});

test("a player cannot open somebody else's portal item", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.game.users.set("player", { id: "player", isGM: false, active: true });
  globalThis.fromUuid = async() => makeActivity({ allowPlayerRequests: true, owner: false });

  const result = await ScPortalService.executeOperation(createRequest(scene, { requestUserId: "player" }));

  assert.equal(result.ok, false);
  assert.deepEqual(scene.created, []);
});

test("a query claiming to be the GM is refused", async(t) => {
  // Foundry hands a query handler only the data and a timeout, so the sender id
  // in the payload is a claim. A GM never queries, because #dispatch runs the
  // operation locally for them, so a GM claim arriving here can only be forged.
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity();

  const result = await ScPortalService.handlePortalQuery(createRequest(scene, { requestUserId: "gm" }));

  assert.equal(result.ok, false);
  assert.deepEqual(scene.created, []);
});

test("a forged GM claim cannot move somebody else's token", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100, owner: false });
  const scene = makeScene({ tokens: [hero] });
  installGlobals(t, scene);

  const result = await ScPortalService.handlePortalQuery(travelRequest(scene, { requestUserId: "gm" }));

  assert.equal(result.ok, false);
  assert.deepEqual(movesOf(scene, "hero"), []);
});

test("a forged GM claim cannot close a portal", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);

  const result = await ScPortalService.handlePortalQuery({
    operation: "close",
    sceneId: scene.id,
    requestUserId: "gm",
    portalId: "p1"
  });

  assert.equal(result.ok, false);
  assert.deepEqual(scene.deleted, []);
});

test("a genuine player query is still served", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.game.users.set("player", { id: "player", isGM: false, active: true });
  globalThis.fromUuid = async() => makeActivity({ allowPlayerRequests: true });

  const result = await ScPortalService.handlePortalQuery(createRequest(scene, { requestUserId: "player" }));

  assert.equal(result.ok, true);
  assert.equal(scene.created.length, 1);
});

test("a GM operating on their own client is not treated as a forgery", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity();

  const result = await ScPortalService.executeOperation(createRequest(scene));

  assert.equal(result.ok, true);
});

test("a portal opened during combat carries the round deadline of that combat", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene, { combat: { id: "combat-1", round: 2, started: true } });
  globalThis.fromUuid = async() => makeActivity();

  const result = await ScPortalService.executeOperation(createRequest(scene));

  assert.equal(result.ok, true);
  const portal = scene.created[0][1][0].flags[MODULE_ID].portal;
  assert.equal(portal.combatId, "combat-1");
  assert.equal(portal.expiresAtRound, 12);
});

test("each portal side carries the behaviour Foundry needs to detect entry", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity();

  await ScPortalService.executeOperation(createRequest(scene));

  // Without an enabled behaviour subscribing to a TOKEN_MOVE_* event, Foundry
  // does not split the movement path at the region boundary, so a token never
  // produces an update while it stands on the portal.
  for (const document of scene.created[0][1]) {
    const [behavior] = document.behaviors;
    assert.equal(behavior.type, "sc-more-activities.scPortal");
    assert.equal(behavior.disabled, false);
    assert.equal(behavior.system.portalId, document.flags[MODULE_ID].portal.portalId);
    assert.equal(behavior.system.side, document.flags[MODULE_ID].portal.side);
  }
});

test("turning entry detection off disables the behaviour instead of dropping it", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ triggerOnEnter: false });

  await ScPortalService.executeOperation(createRequest(scene));

  const [behavior] = scene.created[0][1][0].behaviors;
  assert.equal(behavior.type, "sc-more-activities.scPortal");
  assert.equal(behavior.disabled, true);
});

test("a confirmed region entry sends the token to the other side", async(t) => {
  const walker = makeToken({ id: "walker", x: 100, y: 100 });
  const scene = makeScene({ tokens: [walker] });
  installGlobals(t, scene);
  globalThis.foundry.applications = { api: { DialogV2: { confirm: async() => true } } };

  await ScPortalService.handleRegionEntry({ token: walker, portalId: "p1", side: "entry" });

  assert.deepEqual(movesOf(scene, "walker"), [{ x: 900, y: 900, elevation: 0, action: "displace" }]);
});

test("a declined region entry leaves the token where it is", async(t) => {
  const stayer = makeToken({ id: "stayer", x: 100, y: 100 });
  const scene = makeScene({ tokens: [stayer] });
  installGlobals(t, scene);
  globalThis.foundry.applications = { api: { DialogV2: { confirm: async() => false } } };

  await ScPortalService.handleRegionEntry({ token: stayer, portalId: "p1", side: "entry" });

  assert.deepEqual(movesOf(scene, "stayer"), []);
});

test("a region entry is ignored while the token is suppressed after travelling", async(t) => {
  const returner = makeToken({ id: "returner", x: 900, y: 900 });
  const scene = makeScene({ tokens: [returner] });
  installGlobals(t, scene);
  globalThis.foundry.applications = { api: { DialogV2: { confirm: async() => true } } };

  ScPortalService.suppressToken(scene.id, returner.id);
  await ScPortalService.handleRegionEntry({ token: returner, portalId: "p1", side: "exit" });

  assert.deepEqual(movesOf(scene, "returner"), []);
});

test("a region entry on the exit of a one way portal is ignored", async(t) => {
  const backtracker = makeToken({ id: "backtracker", x: 900, y: 900 });
  const scene = makeScene({ tokens: [backtracker], portalOverrides: { oneWay: true } });
  installGlobals(t, scene);
  globalThis.foundry.applications = { api: { DialogV2: { confirm: async() => true } } };

  await ScPortalService.handleRegionEntry({ token: backtracker, portalId: "p1", side: "exit" });

  assert.deepEqual(movesOf(scene, "backtracker"), []);
});

test("an unregistered behaviour subtype still opens the portal, with a warning", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  // What a world looks like between installing the module and restarting
  // Foundry: the manifest subtype has not reached game.documentTypes yet.
  globalThis.game.documentTypes = { RegionBehavior: [] };
  globalThis.fromUuid = async() => makeActivity();

  const result = await ScPortalService.executeOperation(createRequest(scene));

  // A region carrying an unknown behaviour type fails validation outright, so
  // the portal has to be created without it rather than not at all.
  assert.equal(result.ok, true);
  assert.deepEqual(scene.created[0][1][0].behaviors, []);
  assert.match(result.warning ?? "", /Restart Foundry/);
});

test("the warning is skipped when entry detection was turned off anyway", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.game.documentTypes = { RegionBehavior: [] };
  globalThis.fromUuid = async() => makeActivity({ triggerOnEnter: false });

  const result = await ScPortalService.executeOperation(createRequest(scene));

  assert.equal(result.ok, true);
  assert.equal(result.warning, null);
});

test("the exit of a one way portal is created with its behaviour disabled", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ oneWay: true });

  await ScPortalService.executeOperation(createRequest(scene));

  const [entry, exit] = scene.created[0][1];
  // An enabled behaviour still splits the movement path, so the token would be
  // stopped on the exit waiting for a prompt that never comes.
  assert.equal(entry.behaviors[0].disabled, false);
  assert.equal(exit.behaviors[0].disabled, true);
});

test("both sides of a two way portal keep their behaviour enabled", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity();

  await ScPortalService.executeOperation(createRequest(scene));

  for (const region of scene.created[0][1]) {
    assert.equal(region.behaviors[0].disabled, false);
  }
});

test("only the sides that actually send a token accept entry", async(t) => {
  const scene = makeScene({ tokens: [], portalOverrides: { oneWay: true } });
  installGlobals(t, scene);

  assert.equal(ScPortalService.acceptsEntry(scene, "p1", "entry"), true);
  assert.equal(ScPortalService.acceptsEntry(scene, "p1", "exit"), false);
  assert.equal(ScPortalService.acceptsEntry(scene, "nope", "entry"), false);
});

test("entry detection turned off means no side accepts entry", async(t) => {
  const scene = makeScene({ tokens: [], portalOverrides: { triggerOnEnter: false } });
  installGlobals(t, scene);

  assert.equal(ScPortalService.acceptsEntry(scene, "p1", "entry"), false);
  assert.equal(ScPortalService.acceptsEntry(scene, "p1", "exit"), false);
});

test("a portal side missing its behaviour is repaired once the subtype exists", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);
  for (const region of scene.regions.values()) {
    region.name = "Portal";
    region.behaviors = [];
    region.createEmbeddedDocuments = async(type, data) => {
      region.behaviors.push(...data);
      return data;
    };
  }

  const repaired = await ScPortalService.repairMissingBehaviors(scene);

  assert.equal(repaired, 2);
  for (const region of scene.regions.values()) {
    const [behavior] = region.behaviors;
    assert.equal(behavior.type, "sc-more-activities.scPortal");
    assert.equal(behavior.system.side, region.flags[MODULE_ID].portal.side);
  }
});

test("repair disables the behaviour on the exit of a one way portal", async(t) => {
  // Portals opened before the exit learned to stay out of the way are still on
  // the scene, so the flag has to be corrected in place.
  const scene = makeScene({ tokens: [], portalOverrides: { oneWay: true } });
  installGlobals(t, scene);
  for (const region of scene.regions.values()) {
    region.behaviors = [{
      id: `behavior-${region.id}`,
      type: "sc-more-activities.scPortal",
      disabled: false
    }];
    region.updateEmbeddedDocuments = async(type, updates) => {
      for (const update of updates) {
        const behavior = region.behaviors.find((entry) => entry.id === update._id);
        Object.assign(behavior, update);
      }
      return updates;
    };
  }

  const repaired = await ScPortalService.repairMissingBehaviors(scene);

  assert.equal(repaired, 1);
  const disabledBySide = new Map([...scene.regions.values()]
    .map((region) => [region.flags[MODULE_ID].portal.side, region.behaviors[0].disabled]));
  assert.equal(disabledBySide.get("entry"), false);
  assert.equal(disabledBySide.get("exit"), true);
});

test("repair leaves correctly flagged behaviours untouched", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);
  for (const region of scene.regions.values()) {
    region.behaviors = [{ id: `behavior-${region.id}`, type: "sc-more-activities.scPortal", disabled: false }];
    region.updateEmbeddedDocuments = async() => {
      throw new Error("should not update");
    };
  }

  assert.equal(await ScPortalService.repairMissingBehaviors(scene), 0);
});

test("repair does nothing while the subtype is still unregistered", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);
  globalThis.game.documentTypes = { RegionBehavior: [] };
  for (const region of scene.regions.values()) {
    region.behaviors = [];
    region.createEmbeddedDocuments = async() => {
      throw new Error("must not be called");
    };
  }

  assert.equal(await ScPortalService.repairMissingBehaviors(scene), 0);
});

test("repair leaves a side that already carries its behaviour alone", async(t) => {
  const scene = makeScene({ tokens: [] });
  installGlobals(t, scene);
  for (const region of scene.regions.values()) {
    region.behaviors = [{ type: "sc-more-activities.scPortal" }];
    region.createEmbeddedDocuments = async() => {
      throw new Error("must not be called");
    };
  }

  assert.equal(await ScPortalService.repairMissingBehaviors(scene), 0);
});

/** A portal side as findTravellerForClick sees it. */
function portalSide(center = { x: 150, y: 150 }) {
  return { center, radiusPixels: 50, shape: "square", portalId: "p1", side: "entry" };
}

function installCanvas(controlled = [], character = null) {
  globalThis.canvas = { scene: null, tokens: { controlled } };
  globalThis.game.user.character = character;
}

test("a selected token in reach of the portal is the traveller", async(t) => {
  const chosen = makeToken({ id: "chosen", x: 100, y: 100 });
  const scene = makeScene({ tokens: [chosen] });
  installGlobals(t, scene);
  chosen.isOwner = true;
  installCanvas([chosen]);

  assert.equal(ScPortalService.findTravellerForClick(portalSide(), scene), chosen);
});

test("with nothing selected the user's own character is used", async(t) => {
  const hero = makeToken({ id: "hero", x: 100, y: 100 });
  const scene = makeScene({ tokens: [hero] });
  installGlobals(t, scene);
  hero.isOwner = true;
  installCanvas([], { getActiveTokens: () => [hero] });

  assert.equal(ScPortalService.findTravellerForClick(portalSide(), scene), hero);
});

test("with nothing selected a single owned token inside the portal is used", async(t) => {
  const goblin = makeToken({ id: "goblin", x: 100, y: 100 });
  const bystander = makeToken({ id: "bystander", x: 900, y: 900 });
  const scene = makeScene({ tokens: [goblin, bystander] });
  installGlobals(t, scene);
  goblin.isOwner = true;
  bystander.isOwner = true;
  installCanvas([]);

  assert.equal(ScPortalService.findTravellerForClick(portalSide(), scene), goblin);
});

test("two owned tokens inside the portal are ambiguous, so nobody travels", async(t) => {
  const first = makeToken({ id: "first", x: 100, y: 100 });
  const second = makeToken({ id: "second", x: 120, y: 120 });
  const scene = makeScene({ tokens: [first, second] });
  installGlobals(t, scene);
  first.isOwner = true;
  second.isOwner = true;
  installCanvas([]);

  assert.equal(ScPortalService.findTravellerForClick(portalSide(), scene), null);
});

test("a token the user does not own is never picked up by the fallback", async(t) => {
  const stranger = makeToken({ id: "stranger", x: 100, y: 100 });
  const scene = makeScene({ tokens: [stranger] });
  installGlobals(t, scene);
  stranger.isOwner = false;
  installCanvas([]);

  assert.equal(ScPortalService.findTravellerForClick(portalSide(), scene), null);
});

test("a far away token is not dragged through the portal by the fallback", async(t) => {
  const distant = makeToken({ id: "distant", x: 900, y: 900 });
  const scene = makeScene({ tokens: [distant] });
  installGlobals(t, scene);
  distant.isOwner = true;
  installCanvas([], { getActiveTokens: () => [distant] });

  assert.equal(ScPortalService.findTravellerForClick(portalSide(), scene), null);
});

test("a hidden portal draws nothing during play but keeps its behaviour", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ visibility: "hidden", entryImage: "art/portal.webm" });

  const result = await ScPortalService.executeOperation(createRequest(scene));

  assert.equal(result.ok, true);
  const [region] = scene.created[0][1];
  // LAYER: only drawn while the Regions layer is open. Visibility is render
  // only, so entry detection has to survive it.
  assert.equal(region.visibility, CONST.REGION_VISIBILITY.LAYER);
  assert.equal(region.behaviors[0].type, "sc-more-activities.scPortal");
  assert.equal(region.behaviors[0].disabled, false);
});

test("visibility choices map to the matching Foundry constants", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  // CONST only exists once installGlobals has run, so it is read inside the loop.
  for (const [visibility, constant] of [["all", "ALWAYS"], ["gm", "GAMEMASTER"], ["hidden", "LAYER"]]) {
    const scene = makeScene({ tokens: [caster] });
    installGlobals(t, scene);
    globalThis.fromUuid = async() => makeActivity({ visibility });

    await ScPortalService.executeOperation(createRequest(scene));
    assert.equal(scene.created[0][1][0].visibility, CONST.REGION_VISIBILITY[constant], visibility);
  }
});

test("a gamemaster only portal hides its art from the players too", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ visibility: "gm", entryImage: "art/portal.webm" });

  await ScPortalService.executeOperation(createRequest(scene));

  const [tile] = scene.created[1][1];
  assert.equal(tile.hidden, true);
});

test("art only portals keep their tiles visible", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ visibility: "hidden", entryImage: "art/portal.webm" });

  await ScPortalService.executeOperation(createRequest(scene));

  const [tile] = scene.created[1][1];
  assert.equal(tile.hidden, false);
});

test("a larger portal produces a larger region and art tile", async(t) => {
  const caster = makeToken({ id: "caster", x: 100, y: 100 });
  const scene = makeScene({ tokens: [caster] });
  installGlobals(t, scene);
  globalThis.fromUuid = async() => makeActivity({ size: "2", entryImage: "art/portal.webm" });

  await ScPortalService.executeOperation(createRequest(scene));

  const [shape] = scene.created[0][1][0].shapes;
  assert.equal(shape.width, 200);
  assert.equal(shape.height, 200);

  const [tile] = scene.created[1][1];
  assert.equal(tile.width, 200);
  assert.equal(tile.height, 200);
});
