export class ScTeleportActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    if (schema.target?.fields?.prompt?.options) {
      schema.target.fields.prompt.options.initial = false;
    }

    return {
      ...schema,
      teleport: new fields.SchemaField({
        maxTargets: new fields.NumberField({
          required: false,
          initial: 1,
          min: 1,
          integer: true
        }),
        targetSelf: new fields.BooleanField({
          required: false,
          initial: false
        }),
        onlyTargetSelf: new fields.BooleanField({
          required: false,
          initial: false
        }),
        targetRadius: new fields.NumberField({
          required: false,
          initial: 15,
          min: 0
        }),
        teleportDistance: new fields.NumberField({
          required: false,
          initial: 30,
          min: 0
        }),
        keepArrangement: new fields.BooleanField({
          required: false,
          initial: true
        }),
        clusterRadius: new fields.NumberField({
          required: false,
          initial: 5,
          min: 0
        }),
        snapToGrid: new fields.BooleanField({
          required: false,
          initial: true
        })
      })
    };
  }
}
