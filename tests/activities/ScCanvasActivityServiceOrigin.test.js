import test from "node:test";
import assert from "node:assert/strict";

const { ScCanvasActivityService } = await import("../../scripts/activities/canvas/ScCanvasActivityService.js");

/**
 * The two shapes core hands back for the same token: `canvas.tokens.controlled`
 * holds Token placeables that expose `.document`, while
 * `Actor#getActiveTokens(_, true)` hands back the TokenDocuments themselves.
 */
function makeTokenPair({ id, actor }) {
  const document = { id, name: id, actor };
  const placeable = { id, name: id, actor, document };
  document.object = placeable;
  return { document, placeable };
}

function installCanvas(t, { documents = [], controlled = [] } = {}) {
  const collection = new Map(documents.map((document) => [document.id, document]));
  collection.contents = documents;

  globalThis.canvas = {
    scene: { id: "scene-1", tokens: collection },
    tokens: {
      controlled,
      get: (id) => collection.get(id)?.object ?? null
    }
  };

  t.after(() => {
    delete globalThis.canvas;
  });
}

test("resolves the origin from the actor token once the selection is released", (t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const origin = makeTokenPair({ id: "origin-token", actor });
  actor.getActiveTokens = (_linked, asDocument) => (asDocument ? [origin.document] : [origin.placeable]);
  // Placing a measured template activates another canvas layer, and switching
  // layers releases every controlled token. The fallback is all that stands
  // between that and an activity that reports a missing origin token which is
  // sitting right there on the scene.
  installCanvas(t, { documents: [origin.document], controlled: [] });

  const activity = { actor };
  assert.equal(ScCanvasActivityService.getOriginTokenDocument(activity), origin.document);
  assert.equal(ScCanvasActivityService.getOriginTokenObject(activity), origin.placeable);
});

test("prefers the controlled token over the actor's first active token", (t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const first = makeTokenPair({ id: "first-token", actor });
  const second = makeTokenPair({ id: "second-token", actor });
  actor.getActiveTokens = () => [first.document];
  installCanvas(t, { documents: [first.document, second.document], controlled: [second.placeable] });

  assert.equal(ScCanvasActivityService.getOriginTokenDocument({ actor }), second.document);
});

test("an explicit origin token id wins over the selection", (t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const controlled = makeTokenPair({ id: "controlled-token", actor });
  const requested = makeTokenPair({ id: "requested-token", actor });
  actor.getActiveTokens = () => [controlled.document];
  installCanvas(t, {
    documents: [controlled.document, requested.document],
    controlled: [controlled.placeable]
  });

  const origin = ScCanvasActivityService.getOriginTokenDocument({ actor }, { originTokenId: "requested-token" });
  assert.equal(origin, requested.document);
});

test("resolves the origin through the item actor", (t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1" };
  const origin = makeTokenPair({ id: "origin-token", actor });
  actor.getActiveTokens = () => [origin.document];
  installCanvas(t, { documents: [origin.document], controlled: [] });

  assert.equal(ScCanvasActivityService.getOriginTokenDocument({ item: { actor } }), origin.document);
});

test("reports no origin when the actor has no token on the scene", (t) => {
  const actor = { id: "actor-1", uuid: "Actor.actor-1", getActiveTokens: () => [] };
  installCanvas(t, { documents: [], controlled: [] });

  assert.equal(ScCanvasActivityService.getOriginTokenDocument({ actor }), null);
  assert.equal(ScCanvasActivityService.getOriginTokenObject({ actor }), null);
});
