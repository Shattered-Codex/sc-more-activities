import test from "node:test";
import assert from "node:assert/strict";

class BaseActivityData {
  static defineSchema() {
    return {};
  }

  static migrateData(source) {
    return source;
  }
}

globalThis.dnd5e = { dataModels: { activity: { BaseActivityData } } };
globalThis.foundry = {
  data: {
    fields: {
      StringField: class {
        constructor(options = {}) {
          Object.assign(this, options);
        }
      },
      BooleanField: class {
        constructor(options = {}) {
          Object.assign(this, options);
        }
      },
      SchemaField: class {
        constructor(fields, options = {}) {
          this.fields = fields;
          Object.assign(this, options);
        }
      }
    }
  }
};

const { ScPortalActivityData } = await import("../../scripts/activities/portal/ScPortalActivityData.js");

function migrated(size) {
  const source = { portal: { size } };
  ScPortalActivityData.migrateData(source);
  return source.portal.size;
}

test("the old default of one 5 ft square becomes a 1x1 footprint", () => {
  // This exact value shipped as the initial size and made every existing item
  // fail to initialize once the field only accepted square counts.
  assert.equal(migrated("5"), "1");
  assert.equal(migrated(5), "1");
});

test("larger stored measurements convert to their square count", () => {
  assert.equal(migrated("10"), "2");
  assert.equal(migrated("15"), "3");
  assert.equal(migrated("20"), "4");
});

test("a measurement past the largest footprint is clamped, not dropped", () => {
  assert.equal(migrated("60"), "4");
});

test("a value already expressed in squares is left alone", () => {
  assert.equal(migrated("1"), "1");
  assert.equal(migrated("3"), "3");
});

test("a roll formula, which the old field accepted, falls back to 1x1", () => {
  assert.equal(migrated("@mod * 5"), "1");
  assert.equal(migrated("0"), "1");
});

test("an absent size is left for the field initial to fill in", () => {
  const source = { portal: {} };
  ScPortalActivityData.migrateData(source);
  assert.equal("size" in source.portal, false);
});

test("migration tolerates a source without portal data", () => {
  assert.doesNotThrow(() => ScPortalActivityData.migrateData({}));
  assert.doesNotThrow(() => ScPortalActivityData.migrateData(undefined));
});

test("the size field accepts any stored string so no value can break an item", () => {
  // Narrowing this field with a choices list is what made items unopenable.
  const schema = ScPortalActivityData.defineSchema();
  assert.equal(schema.portal.fields.size.choices, undefined);
});

test("new portal activities allow player use by default", () => {
  const schema = ScPortalActivityData.defineSchema();
  assert.equal(schema.portal.fields.allowPlayerRequests.initial, true);
});
