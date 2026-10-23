import test from "node:test";
import assert from "node:assert/strict";
import { ScRecallRegionSearch } from "../../scripts/activities/recall/ScRecallRegionSearch.js";

globalThis.game = { i18n: { lang: "pt-BR" } };

const scenes = [
  { name: "São Paulo", regions: { contents: [
    { uuid: "Scene.a.Region.a", name: "Praça" },
    { uuid: "Scene.a.Region.b", name: "Portão" }
  ] } },
  { name: "Floresta", regions: { contents: [
    { uuid: "Scene.b.Region.a", name: "Praça" }
  ] } },
  { name: "Empty" }
];

test("search matches scene and region words regardless of order, case, or accents", () => {
  const entries = ScRecallRegionSearch.entries(scenes);
  const { results, hasMore } = ScRecallRegionSearch.find(entries, "  PRACA sao  ");
  assert.deepEqual(results.map(({ uuid, label }) => ({ uuid, label })), [
    { uuid: "Scene.a.Region.a", label: "São Paulo → Praça" }
  ]);
  assert.equal(hasMore, false);
  assert.equal(ScRecallRegionSearch.find(entries, "praça").results.length, 2);
  assert.equal(ScRecallRegionSearch.find(entries, "missing").results.length, 0);
});

test("large worlds return at most 20 rows and remain searchable beyond the initial results", () => {
  const entries = ScRecallRegionSearch.entries([{ name: "World", regions: { contents:
    Array.from({ length: 5000 }, (_, i) => ({ uuid: `Region.${i}`, name: `Region ${i}` }))
  } }]);
  const first = ScRecallRegionSearch.find(entries, "");
  assert.equal(first.results.length, 20);
  assert.equal(first.hasMore, true);
  assert.deepEqual(ScRecallRegionSearch.find(entries, "4999").results.map((entry) => entry.uuid), ["Region.4999"]);
  assert.equal(ScRecallRegionSearch.find(entries.slice(0, 20), "").hasMore, false);
});

test("empty scenes and missing names are handled without losing UUIDs", () => {
  assert.deepEqual(ScRecallRegionSearch.entries(undefined), []);
  assert.deepEqual(ScRecallRegionSearch.find([], ""), { results: [], hasMore: false });
  const entries = ScRecallRegionSearch.entries([{ id: "scene", regions: { contents: [
    { id: "region", uuid: "Scene.scene.Region.region" }
  ] } }]);
  assert.equal(entries[0].label, "scene → region");
  assert.equal(entries[0].uuid, "Scene.scene.Region.region");
});

test("sheet preserves saved destinations, including unavailable UUIDs", async () => {
  globalThis.dnd5e = { applications: { activity: { ActivitySheet: class {
    static PARTS = { effect: { templates: [] } };
    async _prepareEffectContext(context) { return context; }
  } } } };
  game.scenes = { contents: scenes };
  game.i18n.localize = (key) => key;
  const { ScRecallActivitySheet } = await import("../../scripts/activities/recall/ScRecallActivitySheet.js");
  const sheet = new ScRecallActivitySheet();
  sheet.activity = { recall: { regionUuid: "Scene.a.Region.b" } };
  let context = await sheet._prepareEffectContext({}, {});
  assert.equal(context.selectedRegionLabel, "São Paulo → Portão");
  assert.equal(context.recall.regionUuid, "Scene.a.Region.b");
  sheet.activity.recall.regionUuid = "Scene.deleted.Region.deleted";
  context = await sheet._prepareEffectContext({}, {});
  assert.equal(context.recall.regionUuid, "Scene.deleted.Region.deleted");
  assert.equal(context.selectedRegionLabel, "SCMOREACTIVITIES.Activities.ScRecall.Fields.Region.Missing");
});
