import test from "node:test";
import assert from "node:assert/strict";

const { ScSaveRequestCard } = await import("../../scripts/activities/canvas/ScSaveRequestCard.js");

function makeToken({ id, name = id, actor = { id: `actor-${id}` } }) {
  return { id, name, actor };
}

function makeScene(tokens) {
  const collection = new Map(tokens.map((token) => [token.id, token]));
  return { id: "scene-1", tokens: collection };
}

function installGlobals(t, { scene } = {}) {
  const created = [];
  const warnings = [];
  globalThis.game = {
    i18n: {
      localize: (key) => key,
      format: (key) => key
    },
    user: { id: "user-1", isGM: true }
  };
  globalThis.canvas = { scene };
  globalThis.ui = {
    notifications: {
      info: () => {},
      warn: (message) => warnings.push(message),
      error: () => {}
    }
  };
  globalThis.ChatMessage = {
    getSpeaker: (data) => data,
    async create(data) {
      created.push(data);
      return data;
    }
  };

  t.after(() => {
    delete globalThis.game;
    delete globalThis.canvas;
    delete globalThis.ui;
    delete globalThis.ChatMessage;
  });

  return { created, warnings };
}

const activity = {
  uuid: "Activity.abc",
  name: "Shove",
  item: { name: "Gust Staff" },
  movement: { save: { enabled: true, ability: "dex", dc: "14" } },
  teleport: { save: { enabled: true, ability: "wis", dc: "12" } }
};

test("the movement request posts the native save link, targets, and execution flags", async(t) => {
  const origin = makeToken({ id: "origin" });
  const goblin = makeToken({ id: "t1", name: "Goblin" });
  const { created } = installGlobals(t, { scene: makeScene([origin, goblin]) });

  const request = await ScSaveRequestCard.postMovementRequest(activity, {
    originTokenId: "origin",
    movementType: "push",
    selfDirectionPoint: { x: 1, y: 2 },
    tokenIds: ["origin", "t1"]
  });
  assert.deepEqual(request, { posted: true, skipped: false, reason: null });
  assert.equal(created.length, 1);

  const content = created[0].content;
  assert.doesNotMatch(content, /data-action="rollRequest"/);
  assert.match(content, /<span class="visible-dc">DC 14 DEX<\/span>/);
  assert.match(content, /<span class="hidden-dc">DEX<\/span>/);
  assert.match(content, /Goblin/);
  assert.match(content, /chat-card sc-ma-canvas-card/);
  assert.match(content, /data-action="sc-ma-execute-canvas"/);
  assert.match(content, /li class="flexrow" data-token-id="t1"/);
  assert.match(content, /data-action="sc-ma-roll-save"/);
  assert.match(content, /class="gold-button"/);

  const flags = created[0].flags["sc-more-activities"].saveRequest;
  assert.equal(typeof flags.id, "string");
  assert.ok(flags.id.length > 0);
  assert.equal(flags.group, "movement");
  assert.equal(flags.activityUuid, "Activity.abc");
  assert.equal(flags.sceneId, "scene-1");
  assert.equal(flags.ability, "dex");
  assert.equal(flags.dc, 14);
  assert.deepEqual(flags.selfIds, ["origin"]);
  assert.deepEqual(flags.externalTargets.map((entry) => entry.id), ["t1"]);
  assert.equal(flags.execution.movementType, "push");
  assert.deepEqual(flags.execution.selfDirectionPoint, { x: 1, y: 2 });
  assert.equal(flags.executed, false);
});

test("the teleport request stores the destination for later execution", async(t) => {
  const goblin = makeToken({ id: "t1", name: "Goblin" });
  const { created } = installGlobals(t, { scene: makeScene([goblin]) });

  const request = await ScSaveRequestCard.postTeleportRequest(activity, {
    originTokenId: null,
    destination: { x: 300, y: 400 },
    tokenIds: ["t1"]
  });
  assert.equal(request.posted, true);

  const flags = created[0].flags["sc-more-activities"].saveRequest;
  assert.equal(flags.group, "teleport");
  assert.equal(flags.ability, "wis");
  assert.equal(flags.dc, 12);
  assert.deepEqual(flags.execution.destination, { x: 300, y: 400 });
  assert.match(created[0].content, /DC 12 WIS/);
});

test("an invalid DC skips the request with a warning", async(t) => {
  const goblin = makeToken({ id: "t1" });
  const { created, warnings } = installGlobals(t, { scene: makeScene([goblin]) });

  const request = await ScSaveRequestCard.postMovementRequest(
    { ...activity, movement: { save: { enabled: true, ability: "dex", dc: "8 + @prof" } } },
    { tokenIds: ["t1"] }
  );
  assert.deepEqual(request, { posted: false, skipped: true, reason: "invalid-dc" });
  assert.equal(created.length, 0);
  assert.equal(warnings.length, 1);
});

test("a request with no rollable external targets is skipped", async(t) => {
  const origin = makeToken({ id: "origin" });
  const crate = makeToken({ id: "crate", actor: null });
  const { created } = installGlobals(t, { scene: makeScene([origin, crate]) });

  const request = await ScSaveRequestCard.postMovementRequest(activity, {
    originTokenId: "origin",
    tokenIds: ["origin", "crate"]
  });
  assert.deepEqual(request, { posted: false, skipped: true, reason: "no-targets" });
  assert.equal(created.length, 0);
});

test("posting failures report an error without throwing", async(t) => {
  const goblin = makeToken({ id: "t1" });
  installGlobals(t, { scene: makeScene([goblin]) });
  globalThis.ChatMessage = {
    getSpeaker: (data) => data,
    async create() {
      throw new Error("no permission");
    }
  };

  const request = await ScSaveRequestCard.postMovementRequest(activity, { tokenIds: ["t1"] });
  assert.deepEqual(request, { posted: false, skipped: false, reason: "failed" });
});

test("the save ability embedded in the button dataset is sanitized", async(t) => {
  const goblin = makeToken({ id: "t1" });
  const { created } = installGlobals(t, { scene: makeScene([goblin]) });

  await ScSaveRequestCard.postMovementRequest(
    { ...activity, movement: { save: { enabled: true, ability: "dex\"]]<script>", dc: "10" } } },
    { tokenIds: ["t1"] }
  );
  const content = created[0].content;
  assert.match(content, /DC 10 DEXSCRIPT/);
  assert.doesNotMatch(content, /<script>/);
});

test("the native dnd5e roll label is used when available", async(t) => {
  const goblin = makeToken({ id: "t1" });
  const { created } = installGlobals(t, { scene: makeScene([goblin]) });
  globalThis.dnd5e = {
    enrichers: {
      createRollLabel: ({ hideDC }) => hideDC
        ? "<i></i>Dexterity saving throw"
        : "<i></i>DC 14 Dexterity saving throw"
    }
  };
  t.after(() => {
    delete globalThis.dnd5e;
  });

  await ScSaveRequestCard.postMovementRequest(activity, { tokenIds: ["t1"] });
  const content = created[0].content;
  assert.match(content, /<span class="visible-dc"><i><\/i>DC 14 Dexterity saving throw<\/span>/);
  assert.match(content, /<span class="hidden-dc"><i><\/i>Dexterity saving throw<\/span>/);
});
