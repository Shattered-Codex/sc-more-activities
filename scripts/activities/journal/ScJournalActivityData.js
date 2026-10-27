export class ScJournalActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      journal: new fields.SchemaField({
        uuid: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        }),
        pageId: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        })
      })
    };
  }
}
