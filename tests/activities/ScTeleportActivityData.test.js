import test from "node:test";
import assert from "node:assert/strict";

class BaseActivityData {
  static defineSchema() {
    return {};
  }
}

class Field {
  constructor(options = {}) {
    Object.assign(this, options);
  }
}

class SchemaField extends Field {
  constructor(fields, options = {}) {
    super(options);
    this.fields = fields;
  }
}

globalThis.dnd5e = { dataModels: { activity: { BaseActivityData } } };
globalThis.foundry = {
  data: {
    fields: {
      NumberField: Field,
      BooleanField: Field,
      StringField: Field,
      SchemaField
    }
  }
};

const { ScTeleportActivityData } = await import("../../scripts/activities/teleport/ScTeleportActivityData.js");

test("existing teleports keep their circular range by default", () => {
  const schema = ScTeleportActivityData.defineSchema();
  const field = schema.teleport.fields.rangeShape;
  assert.equal(field.initial, "circle");
  assert.deepEqual(field.choices, ["system", "circle", "square"]);
});
