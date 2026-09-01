import test from "node:test";
import assert from "node:assert/strict";

const { CommunityLinks } = await import("../../scripts/settings/CommunityLinks.js");
const { Constants } = await import("../../scripts/constants/Constants.js");

// `Constants.localize` reads the bare `game` global. Each test file runs in its
// own process, so this cannot leak into another suite.
globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } };

test("the strip renders wiki, Patreon, and Discord, in that order", () => {
  assert.deepEqual(CommunityLinks.links().map((link) => link.id), ["wiki", "patreon", "discord"]);
});

test("every link points at the module's declared URL over https", () => {
  const urls = Object.fromEntries(CommunityLinks.links().map((link) => [link.id, link.url]));

  assert.equal(urls.wiki, Constants.MODULE_WIKI_URL);
  assert.equal(urls.patreon, Constants.PATREON_URL);
  assert.equal(urls.discord, Constants.DISCORD_URL);
  for (const [id, url] of Object.entries(urls)) {
    assert.match(url, /^https:\/\//, `${id} is not an https URL`);
  }
});

test("the Discord link is the invite the GM asked for", () => {
  assert.equal(Constants.DISCORD_URL, "https://discord.gg/nZJVbbkMTk");
});

test("every link carries an icon and a resolvable label", () => {
  for (const link of CommunityLinks.links()) {
    assert.match(link.icon, /^fa[sb] fa-/, `${link.id} has no Font Awesome icon`);
    assert.ok(link.label.length > 0, `${link.id} has no label`);
    assert.ok(link.tooltip.length > 0, `${link.id} has no tooltip`);
  }
});

test("opening a link returns its URL and hands it to the browser once", () => {
  const opened = [];
  globalThis.window = { open: (...args) => opened.push(args) };

  assert.equal(CommunityLinks.open("discord"), Constants.DISCORD_URL);
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0], [Constants.DISCORD_URL, "_blank", "noopener"]);

  delete globalThis.window;
});

test("an unknown link id opens nothing instead of throwing", () => {
  const opened = [];
  globalThis.window = { open: (...args) => opened.push(args) };

  assert.equal(CommunityLinks.open("myspace"), null);
  assert.equal(opened.length, 0);

  delete globalThis.window;
});

test("injecting without a settings root is a no-op", () => {
  assert.equal(CommunityLinks.inject(null), null);
  assert.equal(CommunityLinks.inject(undefined), null);
  assert.equal(CommunityLinks.inject({}), null);
});
