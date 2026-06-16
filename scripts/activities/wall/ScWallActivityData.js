export class ScWallActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    if (schema.target?.fields?.prompt?.options) {
      schema.target.fields.prompt.options.initial = false;
    }

    return {
      ...schema,
      wall: new fields.SchemaField({
        maxWalls: new fields.StringField({
          required: false,
          initial: "1"
        }),
        wallType: new fields.StringField({
          required: false,
          initial: "continuous",
          choices: ["continuous", "circular", "panels"]
        }),
        facing: new fields.StringField({
          required: false,
          initial: "both",
          choices: ["both", "towards", "away", "any"]
        }),
        panelSize: new fields.StringField({
          required: false,
          initial: "5"
        }),
        panelSpacing: new fields.StringField({
          required: false,
          initial: "0"
        }),
        maxPanels: new fields.StringField({
          required: false,
          initial: ""
        }),
        referenceRange: new fields.StringField({
          required: false,
          initial: "0"
        }),
        maxLength: new fields.StringField({
          required: false,
          initial: "60"
        }),
        blocksMovement: new fields.BooleanField({
          required: false,
          initial: true
        }),
        blocksSight: new fields.BooleanField({
          required: false,
          initial: true
        }),
        blocksSound: new fields.BooleanField({
          required: false,
          initial: false
        }),
        allowPlayerRequests: new fields.BooleanField({
          required: false,
          initial: false
        })
      })
    };
  }
}
