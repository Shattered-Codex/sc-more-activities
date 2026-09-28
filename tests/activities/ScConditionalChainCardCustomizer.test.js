import test from "node:test";
import assert from "node:assert/strict";

const hooks = new Map();
globalThis.Hooks = {
  on(name, callback) {
    hooks.set(name, callback);
  }
};
globalThis.game = {
  i18n: {
    format: (_key, { activity }) => `Activity: ${activity}`
  }
};

const { ScConditionalChainCardCustomizer } = await import(
  "../../scripts/activities/conditional-chain/ScConditionalChainCardCustomizer.js"
);
ScConditionalChainCardCustomizer.registerHook();

function makeCard({ header = null } = {}) {
  const details = { removed: false, remove() { this.removed = true; } };
  const stackedName = {
    subtitle: null,
    querySelector(selector) {
      return selector === ".subtitle" ? this.subtitle : null;
    },
    append(element) {
      this.subtitle = element;
    },
    closest(selector) {
      return selector === ".card-header" ? header : null;
    }
  };
  return {
    details,
    stackedName,
    querySelector(selector) {
      if (selector === ".card-header.description .details, .card-description") return details;
      if (selector === ".card-header .name-stacked") return stackedName;
      return null;
    }
  };
}

function installDocument(card) {
  globalThis.document = {
    createElement(tag) {
      if (tag === "template") {
        return {
          innerHTML: "",
          content: { querySelector: () => card }
        };
      }
      return {
        classList: { add: () => {} },
        textContent: ""
      };
    }
  };
}

function compactFlags(activityName) {
  return {
    "sc-more-activities": {
      conditionalChainCard: { compact: true, activityName }
    }
  };
}

function messageElement(card, classes = new Set()) {
  return {
    matches: (selector) => selector === ".message",
    querySelector: (selector) => selector === ".chat-card" ? card : null,
    classList: { add: (name) => classes.add(name) }
  };
}

test("compacts legacy v5 content immediately and keeps v6 markers for the render hook", () => {
  const preCreate = hooks.get("dnd5e.preCreateUsageMessage");
  const render = hooks.get("dnd5e.renderChatMessage");
  assert.equal(typeof preCreate, "function");
  assert.equal(typeof render, "function");

  const legacyCard = makeCard();
  installDocument(legacyCard);
  const legacyConfig = {
    data: {
      content: "<div class=\"chat-card activation-card\"></div>",
      flags: compactFlags("Legacy Step")
    }
  };
  preCreate(null, legacyConfig);
  assert.equal(legacyCard.details.removed, true);
  assert.equal(legacyCard.stackedName.subtitle.textContent, "Activity: Legacy Step");
  assert.equal(legacyConfig.data.flags["sc-more-activities"].conditionalChainCard, undefined);

  const v6Config = { data: { flags: compactFlags("Data Step") } };
  preCreate(null, v6Config);
  assert.deepEqual(v6Config.data.flags["sc-more-activities"].conditionalChainCard, {
    compact: true,
    activityName: "Data Step"
  });

  const v6Card = makeCard();
  installDocument(v6Card);
  const classes = new Set();
  render({ flags: v6Config.data.flags }, messageElement(v6Card, classes));
  assert.equal(v6Card.details.removed, true);
  assert.equal(v6Card.stackedName.subtitle.textContent, "Activity: Data Step");
  assert.equal(classes.has("compact"), true);

  delete globalThis.document;
});

test("drops the dnd5e 6 description toggle along with the description", () => {
  const render = hooks.get("dnd5e.renderChatMessage");
  const chevron = { removed: false, remove() { this.removed = true; } };
  const headerClasses = new Set();
  const header = {
    dataset: { action: "toggleDescription" },
    classList: { add: (name) => headerClasses.add(name) },
    querySelector: (selector) => selector === ".chevron" ? chevron : null
  };
  const card = makeCard({ header });
  installDocument(card);

  render({ flags: compactFlags("Step") }, messageElement(card));

  assert.equal(chevron.removed, true);
  assert.equal(header.dataset.action, undefined);
  assert.equal(headerClasses.has("no-description"), true);

  delete globalThis.document;
});

test("leaves the card untouched when it has no stacked name to relabel", () => {
  const render = hooks.get("dnd5e.renderChatMessage");
  const details = { removed: false, remove() { this.removed = true; } };
  const card = {
    querySelector: (selector) => selector === ".card-header.description .details, .card-description" ? details : null
  };
  installDocument(card);
  const classes = new Set();

  render({ flags: compactFlags("Step") }, messageElement(card, classes));

  assert.equal(details.removed, false);
  assert.equal(classes.has("compact"), false);

  delete globalThis.document;
});
