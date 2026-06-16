import {
  CANVAS_TARGET_SOURCES,
  MOVEMENT_TYPES
} from "../canvas/ScCanvasActivityConstants.js";

export class ScMovementActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      movement: new fields.SchemaField({
        targetSource: new fields.StringField({
          required: false,
          initial: CANVAS_TARGET_SOURCES.TARGETS,
          choices: Object.values(CANVAS_TARGET_SOURCES)
        }),
        type: new fields.StringField({
          required: false,
          initial: MOVEMENT_TYPES.PUSH,
          choices: Object.values(MOVEMENT_TYPES)
        }),
        distance: new fields.NumberField({
          required: false,
          initial: 10,
          min: 0
        }),
        maxRange: new fields.NumberField({
          required: false,
          initial: 0,
          min: 0
        }),
        maxTargets: new fields.NumberField({
          required: false,
          initial: 1,
          min: 1,
          integer: true
        }),
        snapToGrid: new fields.BooleanField({
          required: false,
          initial: true
        })
      })
    };
  }
}
