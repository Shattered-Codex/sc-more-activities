import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");

function makeToken({ id, x, y, hidden = false, visible = true, ownedBy = "gm", size = null }) {
  const document = {
    id,
    name: id,
    x,
    y,
    width: 1,
    height: 1,
    hidden,
    actor: size ? { system: { traits: { size } } } : null,
    testUserPermission: (user) => user?.id === ownedBy
  };
  document.object = { document, visible };
  return document;
}

function makeScene(tokens) {
  const collection = new Map(tokens.map((token) => [token.id, token]));
  collection.contents = tokens;
  return { id: "scene-1", grid: { size: 100, distance: 5 }, tokens: collection };
}

/**
 * A 100px grid square is 5 feet, so a token 200px away sits at 10 feet.
 */
function install(t, scene, { isGM = true, allowPlayerTokenMovement = true } = {}) {
  const user = { id: isGM ? "gm" : "player", isGM };
  globalThis.game = {
    i18n: { localize: (key) => key, format: (key) => key },
    user,
    settings: {
      settings: { has: () => true },
      get: () => allowPlayerTokenMovement
    }
  };
  globalThis.canvas = {
    scene,
    grid: { size: 100 },
    tokens: { controlled: [], get: (id) => scene.tokens.get(id) }
  };
  t.after(() => {
    delete globalThis.canvas;
    delete globalThis.game;
  });
  return user;
}

test("counts every token inside the range, including the origin itself", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const near = makeToken({ id: "near", x: 200, y: 0 });
  const far = makeToken({ id: "far", x: 2000, y: 0 });
  const scene = makeScene([origin, near, far]);
  install(t, scene);

  // 200px = 10ft, 2000px = 100ft.
  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }), 2);
  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 5 }), 1, "only the origin");
});

test("a range of zero means unlimited, so every token counts", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const far = makeToken({ id: "far", x: 9000, y: 9000 });
  const scene = makeScene([origin, far]);
  install(t, scene);

  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 0 }), 2);
});

test("the count includes tokens whether or not they are already selected", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const other = makeToken({ id: "other", x: 100, y: 0 });
  const scene = makeScene([origin, other]);
  install(t, scene);

  // Selection is not an input: the number answers "how many could I pick".
  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }), 2);
});

test("a hidden token is never counted for a player", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0, ownedBy: "player" });
  const lurker = makeToken({ id: "lurker", x: 100, y: 0, hidden: true });
  const scene = makeScene([origin, lurker]);
  install(t, scene, { isGM: false });

  assert.equal(
    ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }),
    1,
    "the count must not betray a hidden token"
  );
});

test("a token outside the player's vision is not counted", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0, ownedBy: "player" });
  const unseen = makeToken({ id: "unseen", x: 100, y: 0, visible: false });
  const scene = makeScene([origin, unseen]);
  install(t, scene, { isGM: false });

  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }), 1);
});

test("a GM counts hidden tokens, since a GM can see them", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const lurker = makeToken({ id: "lurker", x: 100, y: 0, hidden: true });
  const scene = makeScene([origin, lurker]);
  install(t, scene);

  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }), 2);
});

test("with the world setting off, a player counts only tokens they own", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0, ownedBy: "player" });
  const enemy = makeToken({ id: "enemy", x: 100, y: 0, ownedBy: "gm" });
  const scene = makeScene([origin, enemy]);
  install(t, scene, { isGM: false, allowPlayerTokenMovement: false });

  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }), 1);
});

test("with the world setting on, a player counts tokens they do not own", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0, ownedBy: "player" });
  const enemy = makeToken({ id: "enemy", x: 100, y: 0, ownedBy: "gm" });
  const scene = makeScene([origin, enemy]);
  install(t, scene, { isGM: false, allowPlayerTokenMovement: true });

  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }), 2);
});

test("no origin counts nothing instead of throwing", (t) => {
  const scene = makeScene([makeToken({ id: "a", x: 0, y: 0 })]);
  install(t, scene);

  assert.equal(ScCanvasActivityService.countTokensInRange(null, { scene, maxRange: 40 }), 0);
  assert.equal(ScCanvasActivityService.countTokensInRange(undefined, { scene }), 0);
});

test("an empty scene counts nothing", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0 });
  const scene = makeScene([]);
  install(t, scene);

  assert.equal(ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40 }), 0);
});

test("the count leaves out targets the size rule refuses", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0, size: "med" });
  const goblin = makeToken({ id: "goblin", x: 100, y: 0, size: "sm" });
  const ogre = makeToken({ id: "ogre", x: 200, y: 0, size: "huge" });
  const scene = makeScene([origin, goblin, ogre]);
  install(t, scene);

  const options = { scene, maxRange: 40 };
  assert.equal(
    ScCanvasActivityService.countTokensInRange(origin, options),
    3,
    "with no rule every token in range counts"
  );

  // Within one size step of a medium origin: small, medium, large.
  assert.equal(
    ScCanvasActivityService.countTokensInRange(origin, {
      ...options,
      targetSize: { mode: "relative", minOffset: -1, maxOffset: 1 }
    }),
    2,
    "the huge ogre is refused, so it must not be counted"
  );

  assert.equal(
    ScCanvasActivityService.countTokensInRange(origin, {
      ...options,
      targetSize: { mode: "absolute", sizes: ["huge"] }
    }),
    1,
    "only the ogre passes an absolute huge-only rule"
  );
});

test("an unconfigured size rule does not shrink the count", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0, size: "med" });
  const other = makeToken({ id: "other", x: 100, y: 0, size: "grg" });
  const scene = makeScene([origin, other]);
  install(t, scene);

  for (const targetSize of [null, undefined, { mode: "any" }, { mode: "absolute", sizes: [] }]) {
    assert.equal(
      ScCanvasActivityService.countTokensInRange(origin, { scene, maxRange: 40, targetSize }),
      2,
      `an unset rule (${JSON.stringify(targetSize)}) must not filter`
    );
  }
});

test("the size rule and the range both narrow the count", (t) => {
  const origin = makeToken({ id: "origin", x: 0, y: 0, size: "med" });
  const nearOgre = makeToken({ id: "near-ogre", x: 100, y: 0, size: "huge" });
  const farGoblin = makeToken({ id: "far-goblin", x: 4000, y: 0, size: "sm" });
  const scene = makeScene([origin, nearOgre, farGoblin]);
  install(t, scene);

  // The ogre is close but too big; the goblin fits but is far away.
  assert.equal(
    ScCanvasActivityService.countTokensInRange(origin, {
      scene,
      maxRange: 40,
      targetSize: { mode: "relative", minOffset: -1, maxOffset: 1 }
    }),
    1,
    "only the origin itself survives both filters"
  );
});
