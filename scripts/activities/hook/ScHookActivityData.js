export class ScHookActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      dispatch: new fields.SchemaField({
        mode: new fields.StringField({
          required: false,
          initial: "hook",
          choices: ["hook", "callback"]
        })
      }),
      hook: new fields.SchemaField({
        name: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        })
      }),
      callback: new fields.SchemaField({
        moduleId: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        }),
        id: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        })
      })
    };
  }
}
