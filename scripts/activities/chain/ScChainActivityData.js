export class ScChainActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      chain: new fields.SchemaField({
        activityIds: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        }),
        maxDepth: new fields.NumberField({
          required: false,
          initial: 5,
          min: 1,
          max: 20
        }),
        continueOnFailure: new fields.BooleanField({
          required: false,
          initial: false
        }),
        stopOnCancel: new fields.BooleanField({
          required: false,
          initial: true
        })
      })
    };
  }
}
