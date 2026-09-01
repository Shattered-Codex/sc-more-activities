import test from "node:test";
import assert from "node:assert/strict";

const { ActivityToggleList, ACTIVITY_GROUP_BY } = await import("../../scripts/settings/ActivityToggleList.js");

globalThis.game = { i18n: { localize: (key) => key, format: (key) => key, lang: "en" } };

function fixture({ isGM = true } = {}) {
  return ActivityToggleList.groups({
    isGM,
    types: [
      { type: "scTeleport", label: "Teleport", category: "canvas", moduleId: "sc-more-activities", icon: "fa-solid fa-bolt" },
      { type: "scMovement", label: "Movement", category: "canvas", moduleId: "sc-more-activities", icon: "fa-solid fa-arrows-up-down-left-right" },
      { type: "scGrant", label: "Grant", category: "items", moduleId: "sc-more-activities", icon: "fa-solid fa-gift" },
      { type: "scNeverFlushed", label: "Half Registered", category: "items", moduleId: "sc-more-activities" },
      { type: "scBroken", label: "Broken", category: "items", moduleId: "other-module" }
    ],
    availability: [
      { type: "scTeleport", enabled: true },
      { type: "scMovement", enabled: false },
      { type: "scGrant", enabled: true },
      { type: "scBroken", unavailable: true }
    ],
    // scNeverFlushed registered but never reached dnd5e.
    flushed: [{ type: "scTeleport" }, { type: "scMovement" }, { type: "scGrant" }, { type: "scBroken" }]
  });
}

test("rows are grouped by category and sorted inside each group", () => {
  const groups = fixture();

  assert.deepEqual(groups.map((group) => group.category), ["canvas", "items"]);
  assert.deepEqual(groups[0].rows.map((row) => row.label), ["Movement", "Teleport"]);
  assert.deepEqual(groups[1].rows.map((row) => row.label), ["Broken", "Grant", "Half Registered"]);
});

test("each group counts how many of its types are on", () => {
  const groups = fixture();

  assert.equal(groups[0].total, 2);
  assert.equal(groups[0].enabledCount, 1, "Movement is disabled, Teleport is not");
  assert.equal(groups[1].enabledCount, 1, "only Grant is active among the item types");
});

test("availability drives the enabled state and the badge", () => {
  const rows = Object.fromEntries(ActivityToggleList.rows(fixture()).map((row) => [row.type, row]));

  assert.equal(rows.scTeleport.enabled, true);
  assert.equal(rows.scTeleport.state, "active");
  assert.equal(rows.scMovement.enabled, false);
  assert.equal(rows.scMovement.state, "disabled");
  assert.equal(rows.scBroken.state, "unavailable");
  assert.equal(rows.scNeverFlushed.state, "unavailable", "a type that never flushed cannot be active");
});

test("only a GM may switch a flushed, available type", () => {
  const rows = Object.fromEntries(ActivityToggleList.rows(fixture()).map((row) => [row.type, row]));

  assert.equal(rows.scTeleport.canToggle, true);
  assert.equal(rows.scMovement.canToggle, true, "a disabled type can still be switched back on");
  assert.equal(rows.scBroken.canToggle, false, "an unavailable type is read-only");
  assert.equal(rows.scNeverFlushed.canToggle, false, "a type that never flushed is read-only");

  const playerRows = ActivityToggleList.rows(fixture({ isGM: false }));
  assert.ok(playerRows.every((row) => row.canToggle === false), "a player may switch nothing");
});

test("a row falls back to a puzzle icon and detects image paths", () => {
  const groups = ActivityToggleList.groups({
    isGM: true,
    types: [
      { type: "a", label: "A", category: "x" },
      { type: "b", label: "B", category: "x", icon: "icons/svg/dice-target.svg" }
    ],
    availability: [],
    flushed: []
  });
  const [a, b] = groups[0].rows;

  assert.equal(a.icon, "fa-solid fa-puzzle-piece");
  assert.equal(a.iconIsPath, false);
  assert.equal(b.iconIsPath, true);
});

test("the disabled map keeps types that have no row on screen", () => {
  const groups = fixture();
  const stored = { scMovement: true, typeFromAnUninstalledModule: true };

  const next = ActivityToggleList.mergeDisabledMap(stored, groups, {
    scTeleport: true,
    scMovement: true,
    scGrant: true
  });

  assert.equal(next.scMovement, undefined, "switching Movement back on clears its entry");
  assert.equal(
    next.typeFromAnUninstalledModule,
    true,
    "a stored preference with no row must survive the save"
  );
});

test("switching a type off writes it into the disabled map", () => {
  const groups = fixture();

  const next = ActivityToggleList.mergeDisabledMap({}, groups, {
    scTeleport: false,
    scMovement: true,
    scGrant: true
  });

  assert.deepEqual(next, { scTeleport: true });
});

test("a read-only row is never written, whatever the form claims", () => {
  const groups = fixture();

  const next = ActivityToggleList.mergeDisabledMap({}, groups, {
    scBroken: false,
    scNeverFlushed: false,
    scTeleport: true,
    scMovement: true,
    scGrant: true
  });

  assert.deepEqual(next, {}, "unavailable types must not reach the setting");
});

test("a missing control keeps the row's current state", () => {
  const groups = fixture();

  // Nothing submitted at all: the stored states must be reproduced as-is.
  const next = ActivityToggleList.mergeDisabledMap({}, groups, {});
  assert.deepEqual(next, { scMovement: true });
});

test("the snapshot changes only when a toggle changes", () => {
  const groups = fixture();
  const baseline = ActivityToggleList.snapshot(groups, {});

  assert.equal(ActivityToggleList.snapshot(groups, { scTeleport: true }), baseline, "same value is not dirty");
  assert.notEqual(ActivityToggleList.snapshot(groups, { scTeleport: false }), baseline);
});

test("the snapshot is order independent", () => {
  const groups = fixture();
  const reversed = ActivityToggleList.groups({
    isGM: true,
    types: [
      { type: "scGrant", label: "Grant", category: "items" },
      { type: "scTeleport", label: "Teleport", category: "canvas" }
    ],
    availability: [{ type: "scGrant", enabled: true }, { type: "scTeleport", enabled: true }],
    flushed: [{ type: "scGrant" }, { type: "scTeleport" }]
  });

  const values = { scGrant: true, scTeleport: true };
  assert.equal(
    ActivityToggleList.snapshot(reversed, values),
    JSON.stringify([["scGrant", true], ["scTeleport", true]])
  );
  assert.ok(ActivityToggleList.snapshot(groups, values).length > 0);
});

test("an empty registry produces no groups instead of throwing", () => {
  assert.deepEqual(ActivityToggleList.groups(), []);
  assert.deepEqual(ActivityToggleList.groups({ types: [], availability: [], flushed: [] }), []);
  assert.deepEqual(ActivityToggleList.rows([]), []);
  assert.deepEqual(ActivityToggleList.mergeDisabledMap(null, [], {}), {});
});

test("a type without an id is skipped", () => {
  const groups = ActivityToggleList.groups({
    isGM: true,
    types: [{ label: "Nameless", category: "x" }, { type: "ok", label: "Ok", category: "x" }],
    availability: [],
    flushed: [{ type: "ok" }]
  });

  assert.deepEqual(ActivityToggleList.rows(groups).map((row) => row.type), ["ok"]);
});


function grouped(groupBy, extra = {}) {
  return ActivityToggleList.groups({
    isGM: true,
    groupBy,
    moduleTitle: (id) => ({ "sc-more-activities": "SC - More Activities", "sc-token-activities": "SC - Token Activities" })[id] ?? id,
    ownModuleId: "sc-more-activities",
    types: [
      { type: "scTeleport", label: "Teleport", category: "canvas", moduleId: "sc-more-activities" },
      { type: "scGrant", label: "Grant", category: "items", moduleId: "sc-more-activities" },
      { type: "scTokenSize", label: "Token Size", category: "legacy", moduleId: "sc-token-activities" },
      { type: "tokenAppearance", label: "Token Appearance", category: "misc", moduleId: "sc-token-activities" },
      { type: "orphan", label: "Orphan", category: "misc", moduleId: "" }
    ],
    availability: [
      { type: "scTeleport", enabled: true }, { type: "scGrant", enabled: true },
      { type: "scTokenSize", enabled: true }, { type: "tokenAppearance", enabled: true },
      { type: "orphan", enabled: true }
    ],
    flushed: [
      { type: "scTeleport" }, { type: "scGrant" }, { type: "scTokenSize" },
      { type: "tokenAppearance" }, { type: "orphan" }
    ],
    ...extra
  });
}

test("grouping by module uses module titles and leads with this module", () => {
  const groups = grouped(ACTIVITY_GROUP_BY.MODULE);

  assert.equal(groups[0].categoryLabel, "SC - More Activities", "own module leads");
  assert.equal(groups[0].isOwnModule, true);
  assert.deepEqual(groups[0].rows.map((row) => row.type), ["scGrant", "scTeleport"]);
  assert.deepEqual(
    groups.slice(1).map((group) => group.categoryLabel),
    ["SC - Token Activities", "Unknown module"]
  );
  // The third-party group holds its non-legacy type only.
  assert.deepEqual(groups[1].rows.map((row) => row.type), ["tokenAppearance"]);
});

test("grouping by category ignores the module entirely", () => {
  const labels = grouped(ACTIVITY_GROUP_BY.CATEGORY).map((group) => group.categoryLabel);
  assert.deepEqual(labels, ["Canvas", "Items", "Misc"]);
});

test("an unknown grouping falls back to category", () => {
  assert.equal(ActivityToggleList.normalizeGroupBy("module"), "module");
  assert.equal(ActivityToggleList.normalizeGroupBy("nope"), "category");
  assert.equal(ActivityToggleList.normalizeGroupBy(undefined), "category");
  assert.deepEqual(
    grouped("nope").map((group) => group.categoryLabel),
    grouped(ACTIVITY_GROUP_BY.CATEGORY).map((group) => group.categoryLabel)
  );
});

test("unsaved edits survive a regroup through overrides", () => {
  const before = ActivityToggleList.rows(grouped(ACTIVITY_GROUP_BY.CATEGORY))
    .find((row) => row.type === "scTeleport");
  assert.equal(before.enabled, true);

  const after = ActivityToggleList.rows(grouped(ACTIVITY_GROUP_BY.MODULE, { overrides: { scTeleport: false } }))
    .find((row) => row.type === "scTeleport");
  assert.equal(after.enabled, false, "the pending switch-off must carry over");
  assert.equal(after.state, "active", "the stored state itself is untouched");
});

test("a row carries a lower-cased search haystack", () => {
  const row = ActivityToggleList.rows(grouped(ACTIVITY_GROUP_BY.CATEGORY))
    .find((entry) => entry.type === "tokenAppearance");

  assert.ok(row.searchText.includes("token appearance"));
  assert.ok(row.searchText.includes("sc-token-activities"));
  assert.ok(row.searchText.includes("misc"));
  assert.equal(row.searchText, row.searchText.toLowerCase());
});

test("warnings are counted per type", () => {
  const groups = ActivityToggleList.groups({
    isGM: true,
    types: [{ type: "a", label: "A", category: "x" }, { type: "b", label: "B", category: "x" }],
    availability: [{ type: "a", enabled: true }, { type: "b", enabled: true }],
    flushed: [{ type: "a" }, { type: "b" }],
    warnings: [{ type: "a" }, { type: "a" }, { type: "zzz" }]
  });
  const rows = Object.fromEntries(ActivityToggleList.rows(groups).map((row) => [row.type, row]));

  assert.equal(rows.a.warningCount, 2);
  assert.equal(rows.a.hasWarnings, true);
  assert.equal(rows.b.warningCount, 0);
  assert.equal(rows.b.hasWarnings, false);
});

test("issues summarize warnings and rejections for the tab banner", () => {
  assert.deepEqual(
    ActivityToggleList.issues({ warnings: [{}, {}], rejected: [{}] }),
    { warningCount: 2, rejectedCount: 1, hasIssues: true }
  );
  assert.deepEqual(
    ActivityToggleList.issues(),
    { warningCount: 0, rejectedCount: 0, hasIssues: false }
  );
});

test("legacy types are left out of the list entirely", () => {
  const groups = grouped(ACTIVITY_GROUP_BY.CATEGORY);
  const labels = groups.map((group) => group.categoryLabel);
  const types = ActivityToggleList.rows(groups).map((row) => row.type);

  assert.ok(!labels.includes("Legacy"), "the legacy group must not be rendered");
  assert.ok(!types.includes("scTokenSize"), "a legacy type must not get a row");
  assert.deepEqual(labels, ["Canvas", "Items", "Misc"]);
});

test("legacy types are hidden when grouping by module too", () => {
  const labels = grouped(ACTIVITY_GROUP_BY.MODULE).map((group) => group.categoryLabel);
  assert.ok(labels.includes("SC - Token Activities"), "the module keeps its non-legacy types");
  const types = ActivityToggleList.rows(grouped(ACTIVITY_GROUP_BY.MODULE)).map((row) => row.type);
  assert.ok(!types.includes("scTokenSize"), "its legacy type is still left out");
});

test("the hidden count reports what the list left out", () => {
  const types = [
    { type: "a", label: "A", category: "canvas" },
    { type: "b", label: "B", category: "legacy" },
    { type: "c", label: "C", category: "legacy" },
    { label: "no id", category: "legacy" }
  ];

  assert.equal(ActivityToggleList.hiddenCount(types), 2, "only real types count");
  assert.equal(ActivityToggleList.hiddenCount([]), 0);
  assert.deepEqual(ActivityToggleList.hiddenCategories(), ["legacy"]);
});

test("hiding is by category, and the caller can widen it", () => {
  const types = [
    { type: "a", label: "A", category: "canvas" },
    { type: "b", label: "B", category: "legacy" }
  ];
  const kept = ActivityToggleList.groups({
    isGM: true, types, availability: [], flushed: [],
    hiddenCategories: []
  });

  assert.equal(ActivityToggleList.rows(kept).length, 2, "an empty hidden list keeps everything");
  assert.equal(ActivityToggleList.isHidden({ category: "legacy" }), true);
  assert.equal(ActivityToggleList.isHidden({ category: "canvas" }), false);
  assert.equal(ActivityToggleList.isHidden({}), false);
});

test("a hidden legacy type keeps its stored state through a save", () => {
  const groups = grouped(ACTIVITY_GROUP_BY.CATEGORY);
  const stored = { scTokenSize: true };

  // The legacy type has no row, so the form cannot speak for it either way.
  const next = ActivityToggleList.mergeDisabledMap(stored, groups, { scTokenSize: false, scTeleport: true });
  assert.equal(next.scTokenSize, true, "hidden must not mean silently re-enabled");
});
