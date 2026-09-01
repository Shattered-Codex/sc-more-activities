import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The service runs a step's activity whatever its condition type, so the
 * template-origin field has to be reachable on every step. It was once nested
 * inside the "always" branch, which silently limited it to one condition type;
 * this checks the markup itself rather than trusting that it stays put.
 */
const TEMPLATE = readFileSync(
  new URL("../../templates/activity-parts/sc-conditional-chain-effect.hbs", import.meta.url),
  "utf8"
);

/** The `{{#if}}` / `{{#each}}` blocks still open at a given line. */
function openBlocksAt(lines, targetIndex) {
  const stack = [];
  for (const line of lines.slice(0, targetIndex + 1)) {
    for (const match of line.matchAll(/\{\{#(?:if|each|unless)\s+([^}]*)\}\}/g)) {
      stack.push(match[1].trim());
    }
    for (const _ of line.matchAll(/\{\{\/(?:if|each|unless)\}\}/g)) {
      stack.pop();
    }
  }
  return stack;
}

test("the template origin field is not trapped in a condition-type branch", () => {
  const lines = TEMPLATE.split("\n");
  const index = lines.findIndex((line) => line.includes("TemplateOrigin.Label"));
  assert.ok(index > 0, "the field must exist in the template");

  const open = openBlocksAt(lines, index);
  const conditionBranches = [
    "node.isAlways",
    "node.isRollCheck",
    "node.isRollValue",
    "node.isRollBoolean",
    "node.isLastActivityResult",
    "node.isActorProperty",
    "node.isChoice"
  ];

  for (const branch of conditionBranches) {
    assert.ok(
      !open.includes(branch),
      `the field is inside {{#if ${branch}}}, so steps of other condition types cannot configure it`
    );
  }

  // It should still be gated on being useful at all, and on the node loop.
  assert.ok(open.some((block) => block.includes("nodes as |node|")), "it belongs to a step");
  assert.ok(open.includes("node.showsTemplateOrigin"), "it stays hidden where it cannot work");
});

test("the field writes the step id the flow normalizer reads back", () => {
  assert.match(TEMPLATE, /name="flow\.nodes\.\{\{ node\.index \}\}\.templateOrigin\.stepId"/);
});
