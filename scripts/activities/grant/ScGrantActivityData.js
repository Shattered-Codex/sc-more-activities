export class ScGrantActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      grants: new fields.ArrayField(new fields.SchemaField({
        uuid: new fields.StringField({
          required: true,
          blank: false,
          initial: ""
        }),
        quantity: new fields.NumberField({
          required: false,
          initial: 1,
          min: 1,
          integer: true
        })
      }), {
        required: false,
        initial: []
      })
    };
  }
}
