import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { ScActivityResultPathCatalog } = await import("../../scripts/activities/ScActivityResultPathCatalog.js");

globalThis.game = { i18n: { localize: (key) => key, lang: "en" } };

function pathsFor(type) {
  return ScActivityResultPathCatalog.groupsForActivityType(type)
    .flatMap((group) => group.paths);
}

/**
 * The suggestions are only useful if the activity really reports them, so these
 * read what each preview app writes rather than trusting the catalog alone.
 */
function publishedKeys(file) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const block = source.slice(source.indexOf("settlement?.complete("));
  return {
    movedCount: block.includes("movedCount"),
    skipped: block.includes("skipped"),
    destination: block.slice(0, block.indexOf("});")).includes("destination")
  };
}

test("teleport reports a landing point, so it may suggest one", () => {
  const published = publishedKeys("../../scripts/activities/teleport/ScTeleportDestinationApp.js");
  assert.equal(published.destination, true, "the teleport must publish a destination");

  const paths = pathsFor("sc-teleport");
  assert.ok(paths.includes("activity.destination.x"));
  assert.ok(paths.includes("activity.destination.y"));
});

test("movement reports no landing point, so it must not suggest one", () => {
  const published = publishedKeys("../../scripts/activities/movement/ScMovementPreviewApp.js");
  assert.equal(
    published.destination,
    false,
    "movement sends each token somewhere different; if this changes, the catalog must too"
  );

  const paths = pathsFor("sc-movement");
  assert.ok(!paths.includes("activity.destination.x"), "a suggestion here always reads as missing");
  assert.ok(!paths.includes("activity.destination.y"));
});

test("both canvas activities suggest what they do report", () => {
  for (const [type, file] of [
    ["sc-teleport", "../../scripts/activities/teleport/ScTeleportDestinationApp.js"],
    ["sc-movement", "../../scripts/activities/movement/ScMovementPreviewApp.js"]
  ]) {
    const published = publishedKeys(file);
    const paths = pathsFor(type);

    assert.equal(published.movedCount, true, `${type} publishes movedCount`);
    assert.equal(published.skipped, true, `${type} publishes skipped`);
    assert.ok(paths.includes("activity.movedCount"), `${type} suggests movedCount`);
    assert.ok(paths.includes("activity.skipped"), `${type} suggests skipped`);
    assert.ok(paths.includes("activity.canceled"), `${type} suggests canceled`);
  }
});

test("every suggested group has a label to render", () => {
  const groups = ScActivityResultPathCatalog.groupDefinitions();
  const ids = groups.map((group) => group.id);

  assert.ok(ids.includes("canvas"));
  assert.ok(ids.includes("canvasDestination"));
  // Labels live in the lang files under this prefix; a missing one renders the
  // raw id, which is how "canvas" first shipped.
  const en = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"));
  for (const id of ids) {
    assert.ok(
      en[`SCMOREACTIVITIES.Activities.ScConditionalChain.ResultPathGroups.${id}`],
      `group "${id}" has no label`
    );
  }
});
