import test from "node:test";
import assert from "node:assert/strict";

const { ScTokenSize } = await import("../../scripts/activities/canvas/ScTokenSize.js");

globalThis.game = { i18n: { localize: (key) => key } };

function token(size) {
  return size === null ? { actor: null } : { actor: { system: { traits: { size } } } };
}

test("sizes are ordered smallest to largest", () => {
  assert.deepEqual(ScTokenSize.ORDER, ["tiny", "sm", "med", "lg", "huge", "grg"]);
  assert.equal(ScTokenSize.indexOf(token("tiny")), 0);
  assert.equal(ScTokenSize.indexOf(token("med")), 2);
  assert.equal(ScTokenSize.indexOf(token("grg")), 5);
});

test("a token with no actor or an unknown size has no index", () => {
  assert.equal(ScTokenSize.indexOf(token(null)), null);
  assert.equal(ScTokenSize.indexOf(token("colossal")), null);
  assert.equal(ScTokenSize.indexOf(null), null);
  assert.equal(ScTokenSize.indexOf({}), null);
});

test("the size is read through a token document too", () => {
  const document = { actor: { system: { traits: { size: "lg" } } } };
  assert.equal(ScTokenSize.indexOf({ document }), 3);
});

test("mode any never restricts", () => {
  const config = { mode: "any" };
  assert.equal(ScTokenSize.isRestricted(config), false);
  for (const size of ScTokenSize.ORDER) {
    assert.equal(ScTokenSize.matchesTokens(config, token("med"), token(size)), true);
  }
});

test("absolute mode allows only the picked sizes", () => {
  const config = { mode: "absolute", sizes: ["lg", "huge"] };

  assert.equal(ScTokenSize.isRestricted(config), true);
  assert.equal(ScTokenSize.matchesTokens(config, token("med"), token("lg")), true);
  assert.equal(ScTokenSize.matchesTokens(config, token("med"), token("huge")), true);
  assert.equal(ScTokenSize.matchesTokens(config, token("med"), token("med")), false);
  assert.equal(ScTokenSize.matchesTokens(config, token("med"), token("grg")), false);
});

test("absolute mode with nothing picked is treated as unconfigured, not as a ban", () => {
  const config = { mode: "absolute", sizes: [] };

  assert.equal(ScTokenSize.isRestricted(config), false);
  assert.equal(ScTokenSize.matchesTokens(config, token("med"), token("grg")), true);
});

test("relative mode compares against the origin", () => {
  // Within one step of a medium origin: small, medium, large.
  const config = { mode: "relative", minOffset: -1, maxOffset: 1 };
  const origin = token("med");

  assert.equal(ScTokenSize.matchesTokens(config, origin, token("sm")), true);
  assert.equal(ScTokenSize.matchesTokens(config, origin, token("med")), true);
  assert.equal(ScTokenSize.matchesTokens(config, origin, token("lg")), true);
  assert.equal(ScTokenSize.matchesTokens(config, origin, token("tiny")), false);
  assert.equal(ScTokenSize.matchesTokens(config, origin, token("huge")), false);
});

test("relative mode follows the origin's own size", () => {
  const config = { mode: "relative", minOffset: 0, maxOffset: 1 };

  // A huge origin reaches huge and gargantuan.
  assert.equal(ScTokenSize.matchesTokens(config, token("huge"), token("huge")), true);
  assert.equal(ScTokenSize.matchesTokens(config, token("huge"), token("grg")), true);
  assert.equal(ScTokenSize.matchesTokens(config, token("huge"), token("lg")), false);
  // The same activity on a tiny origin reaches tiny and small.
  assert.equal(ScTokenSize.matchesTokens(config, token("tiny"), token("sm")), true);
  assert.equal(ScTokenSize.matchesTokens(config, token("tiny"), token("med")), false);
});

test("relative mode can allow only smaller targets", () => {
  const config = { mode: "relative", minOffset: -5, maxOffset: -1 };
  const origin = token("lg");

  assert.equal(ScTokenSize.matchesTokens(config, origin, token("med")), true);
  assert.equal(ScTokenSize.matchesTokens(config, origin, token("tiny")), true);
  assert.equal(ScTokenSize.matchesTokens(config, origin, token("lg")), false);
  assert.equal(ScTokenSize.matchesTokens(config, origin, token("huge")), false);
});

test("a reversed span is read as the span between its two values", () => {
  const reversed = ScTokenSize.normalize({ mode: "relative", minOffset: 2, maxOffset: -2 });
  assert.equal(reversed.minOffset, -2);
  assert.equal(reversed.maxOffset, 2);
});

test("an unknown target size passes rather than being refused on missing data", () => {
  const absolute = { mode: "absolute", sizes: ["lg"] };
  const relative = { mode: "relative", minOffset: 0, maxOffset: 0 };

  assert.equal(ScTokenSize.matchesTokens(absolute, token("med"), token(null)), true);
  assert.equal(ScTokenSize.matchesTokens(relative, token("med"), token(null)), true);
});

test("relative mode with an unknown origin cannot compare, so it passes", () => {
  const config = { mode: "relative", minOffset: 0, maxOffset: 0 };
  assert.equal(ScTokenSize.matchesTokens(config, token(null), token("grg")), true);
});

test("a full-width relative span is not a restriction", () => {
  const config = { mode: "relative", minOffset: -5, maxOffset: 5 };
  assert.equal(ScTokenSize.isRestricted(config), false);
});

test("normalize drops junk and clamps offsets", () => {
  const config = ScTokenSize.normalize({
    mode: "nonsense",
    sizes: ["lg", "colossal", "", null, "tiny"],
    minOffset: -99,
    maxOffset: "3"
  });

  assert.equal(config.mode, "any");
  assert.deepEqual(config.sizes, ["lg", "tiny"]);
  assert.equal(config.minOffset, -5);
  assert.equal(config.maxOffset, 3);
});

test("normalize copes with no argument at all", () => {
  const config = ScTokenSize.normalize();
  assert.equal(config.mode, "any");
  assert.deepEqual(config.sizes, []);
  assert.equal(config.minOffset, -1);
  assert.equal(config.maxOffset, 1);
});

test("the sheet options cover every size and every mode", () => {
  const sizes = ScTokenSize.sizeOptions(["lg"]);
  assert.equal(sizes.length, 6);
  assert.equal(sizes.find((option) => option.value === "lg").selected, true);
  assert.equal(sizes.find((option) => option.value === "med").selected, false);

  assert.deepEqual(ScTokenSize.modeOptions().map((option) => option.value), ["any", "absolute", "relative"]);

  const offsets = ScTokenSize.offsetOptions();
  assert.equal(offsets.length, 11, "-5 through +5");
  assert.equal(offsets.find((option) => option.value === 2).label, "+2");
  assert.equal(offsets.find((option) => option.value === -2).label, "-2");
});
