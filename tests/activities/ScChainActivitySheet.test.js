import test from "node:test";
import assert from "node:assert/strict";

class BaseActivitySheet {
  static PARTS = {
    effect: {
      templates: []
    }
  };

  constructor(activity) {
    this.activity = activity;
    this.submitCalls = [];
  }

  async _prepareEffectContext(context) {
    return context;
  }

  async _onRender() {}

  async submit() {
    this.submitCalls.push(this.element.querySelector("[data-chain-activity-ids]").value);
  }
}

class FakeClassList {
  #classes = new Set();

  add(...classes) {
    for (const className of classes) {
      this.#classes.add(className);
    }
  }

  contains(className) {
    return this.#classes.has(className);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.value = "";
    this.disabled = false;
    this.dataset = {};
    this.children = [];
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  contains(element) {
    if (element === this) {
      return true;
    }
    return this.children.some((child) => child.contains(element));
  }

  closest(selector) {
    const action = selector.match(/^\[data-action='([^']+)'\]$/)?.[1];
    if (action && this.dataset.action === action) {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  dispatch(type) {
    const event = {
      currentTarget: this,
      target: this,
      propagationStopped: false,
      preventDefault() {},
      stopPropagation() {
        this.propagationStopped = true;
      }
    };
    this.listeners.get(type)?.(event);
    return event;
  }

}

globalThis.game = {
  i18n: {
    lang: "en",
    localize(key) {
      return key;
    },
    format(key, data) {
      return `${key}:${data.activity}`;
    }
  }
};

globalThis.document = {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
};

globalThis.dnd5e = {
  applications: {
    activity: {
      ActivitySheet: BaseActivitySheet
    }
  }
};

const { ScChainActivitySheet } = await import(
  "../../scripts/activities/chain/ScChainActivitySheet.js"
);

function makeActivity(activityIds = "") {
  const activities = new Map([
    ["chain", { id: "chain", name: "Chain", type: "sc-chain" }],
    ["zebra", { id: "zebra", name: "Zebra", type: "utility" }],
    ["alpha", { id: "alpha", name: "Alpha", type: "attack" }]
  ]);
  const activity = {
    id: "chain",
    chain: { activityIds },
    item: { system: { activities } }
  };
  activities.get("chain").item = activity.item;
  return activity;
}

function makeRenderElements(value = "") {
  const idsInput = new FakeElement("textarea");
  idsInput.value = value;
  const select = new FakeElement("select");
  const addButton = new FakeElement("button");
  const list = new FakeElement("ol");
  const elements = new Map([
    ["[data-chain-activity-ids]", idsInput],
    ["[data-chain-activity-select]", select],
    ["[data-action='sc-add-chain-activity']", addButton],
    ["[data-chain-activity-list]", list]
  ]);
  return {
    idsInput,
    select,
    addButton,
    list,
    root: {
      querySelector(selector) {
        return elements.get(selector) ?? null;
      }
    }
  };
}

test("prepares configured activities in order while preserving duplicates and missing ids", async() => {
  const sheet = new ScChainActivitySheet(makeActivity("zebra, missing; zebra\nalpha"));
  const context = await sheet._prepareEffectContext({}, {});

  assert.deepEqual(context.configuredActivities, [
    { id: "zebra", index: 0, name: "Zebra", type: "utility", missing: false },
    { id: "missing", index: 1, name: "missing", type: "", missing: true },
    { id: "zebra", index: 2, name: "Zebra", type: "utility", missing: false },
    { id: "alpha", index: 3, name: "Alpha", type: "attack", missing: false }
  ]);
});

test("sorts picker options by name and excludes the chain itself", async() => {
  const sheet = new ScChainActivitySheet(makeActivity());
  const context = await sheet._prepareEffectContext({}, {});

  assert.deepEqual(context.activityOptions, [
    { value: "alpha", label: "Alpha (attack)" },
    { value: "zebra", label: "Zebra (utility)" }
  ]);
  assert.ok(!context.activityOptions.some((option) => option.value === "chain"));
});

test("serializes additions and index-based removals through the hidden form field", async() => {
  const sheet = new ScChainActivitySheet(makeActivity("alpha"));
  const elements = makeRenderElements("alpha");
  sheet.element = elements.root;
  await sheet._onRender({}, {});

  assert.equal(elements.addButton.disabled, true);

  elements.select.value = "zebra";
  const pickerChange = elements.select.dispatch("change");
  assert.equal(pickerChange.propagationStopped, true);
  assert.deepEqual(sheet.submitCalls, []);
  assert.equal(elements.addButton.disabled, false);
  elements.addButton.dispatch("click");

  elements.select.value = "zebra";
  elements.select.dispatch("change");
  elements.addButton.dispatch("click");

  assert.equal(elements.idsInput.value, "alpha\nzebra\nzebra");
  assert.equal(elements.list.children.length, 3);
  assert.deepEqual(sheet.submitCalls, ["alpha\nzebra", "alpha\nzebra\nzebra"]);

  const firstZebraRemove = elements.list.children[1].children[1];
  elements.list.listeners.get("click")({
    target: firstZebraRemove,
    preventDefault() {}
  });

  assert.equal(elements.idsInput.value, "alpha\nzebra");
  assert.deepEqual(sheet.submitCalls, ["alpha\nzebra", "alpha\nzebra\nzebra", "alpha\nzebra"]);
  assert.deepEqual(
    elements.list.children.map((row) => row.children[1].dataset.index),
    ["0", "1"]
  );
});
