import test from "node:test";
import assert from "node:assert/strict";

class BaseActivityData {
  static migrateData(source) {
    return source;
  }

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
    assert.deepEqual(field.choices, ["system", "circle", "square", "grid"]);
  }
});

test("saved movement and wall activities retain legacy grid measurement", () => {
  const movement = { _id: "movement-1", movement: { maxRange: 30 } };
  const wall = { _id: "wall-1", wall: { referenceRange: "30" } };
  assert.equal(ScMovementActivityData.migrateData(movement).movement.rangeShape, "grid");
  assert.equal(ScWallActivityData.migrateData(wall).wall.rangeShape, "grid");
});

test("new and explicitly configured activities are not treated as legacy", () => {
  const fresh = { movement: { maxRange: 30 } };
  const explicit = { _id: "wall-1", wall: { referenceRange: "30", rangeShape: "square" } };
  assert.equal(ScMovementActivityData.migrateData(fresh).movement.rangeShape, undefined);
  assert.equal(ScWallActivityData.migrateData(explicit).wall.rangeShape, "square");
});
