export class ScAdvancementActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      sourceItemUuid: new fields.StringField({
        required: false,
        blank: true,
        initial: ""
      }),
      selections: new fields.ArrayField(new fields.SchemaField({
        advancementId: new fields.StringField({
          required: true,
          blank: false,
          initial: ""
        }),
        level: new fields.NumberField({
          required: true,
          integer: true,
          min: 0,
          initial: 0
        })
      }), {
        required: false,
        initial: []
      })
    };
  }
}
