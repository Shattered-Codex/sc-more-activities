export class ScMacroActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      execution: new fields.SchemaField({
        mode: new fields.StringField({
          required: false,
          initial: "world",
          choices: ["world", "inline"]
        })
      }),
      world: new fields.SchemaField({
        macroUuid: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        })
      }),
      inline: new fields.SchemaField({
        code: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        })
      })
    };
  }
}
