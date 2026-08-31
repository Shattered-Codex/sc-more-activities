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

const { ScMovementActivityData } = await import("../../scripts/activities/movement/ScMovementActivityData.js");
const { ScWallActivityData } = await import("../../scripts/activities/wall/ScWallActivityData.js");

test("movement and wall ranges remain circular by default", () => {
  const movement = ScMovementActivityData.defineSchema().movement.fields.rangeShape;
  const wall = ScWallActivityData.defineSchema().wall.fields.rangeShape;
  for (const field of [movement, wall]) {
    assert.equal(field.initial, "circle");
    assert.deepEqual(field.choices, ["system", "circle", "square"]);
  }
});
