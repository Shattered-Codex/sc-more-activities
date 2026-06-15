export class ScSoundActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      audio: new fields.SchemaField({
        source: new fields.FilePathField({
          required: false,
          blank: true,
          initial: "",
          categories: ["AUDIO"]
        }),
        volume: new fields.NumberField({
          required: false,
          initial: 0.8,
          min: 0,
          max: 1
        })
      }),
      playback: new fields.SchemaField({
        audience: new fields.StringField({
          required: false,
          initial: "self",
          choices: ["self", "everyone"]
        })
      })
    };
  }
}
