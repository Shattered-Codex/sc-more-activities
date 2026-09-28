import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../..", import.meta.url);
const moduleManifest = JSON.parse(readFileSync(new URL("module.json", root), "utf8"));
const effectTemplates = readdirSync(new URL("templates/activity-parts", root))
  .filter((name) => /^sc-.*-effect\.hbs$/.test(name));
const registrationPaths = [
  "advancement", "chain", "conditional-chain", "contest", "grant", "hook",
  "macro", "movement", "portal", "sound", "teleport", "wall"
].map((type) => new URL(`scripts/activities/${type}/registerSc${type.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("")}Activity.js`, root));

test("declares dual D&D 5e 5.0 and 6.0 compatibility", () => {
  const dnd5e = moduleManifest.relationships.systems.find((relationship) => relationship.id === "dnd5e");
  assert.deepEqual(dnd5e.compatibility, { minimum: "5.0.0", verified: "6.0.0" });

  for (const path of registrationPaths) {
    assert.match(readFileSync(path, "utf8"), /dnd5e: ">=5\.0\.0 <7\.0\.0"/);
  }
});

test("always renders the D&D effect controls so an effect can be added", () => {
  assert.equal(effectTemplates.length, 12);
  for (const template of effectTemplates) {
    const contents = readFileSync(new URL(`templates/activity-parts/${template}`, root), "utf8");
    assert.match(contents, /\{\{> "systems\/dnd5e\/templates\/activity\/parts\/activity-effects\.hbs" \}\}/);
    assert.doesNotMatch(contents, /\{\{#if appliedEffects\}\}/);
  }
});
