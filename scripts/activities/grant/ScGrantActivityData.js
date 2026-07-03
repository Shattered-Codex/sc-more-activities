import { ScGrantEntryHelpers } from "./ScGrantEntryHelpers.js";

export class ScGrantActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    const FormulaField = dnd5e.dataModels.fields.FormulaField;
    const recipientChoices = ["self", "target"];
    return {
      ...super.defineSchema(),
      recipient: new fields.StringField({
        required: false,
        initial: "self",
        choices: recipientChoices
      }),
      grants: new fields.ArrayField(new fields.SchemaField({
        type: new fields.StringField({
          required: false,
          initial: ScGrantEntryHelpers.SOURCE_TYPES.ITEM,
          choices: Object.values(ScGrantEntryHelpers.SOURCE_TYPES)
        }),
        uuid: new fields.StringField({
          required: true,
          blank: true,
          initial: ""
        }),
        quantity: new FormulaField({
          required: false,
          initial: "1"
        })
      }), {
        required: false,
        initial: []
      }),
      check: new fields.SchemaField({
        ability: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        }),
        skill: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        }),
        dc: new fields.SchemaField({
          calculation: new fields.StringField({
            required: false,
            blank: true,
            initial: ""
          }),
          formula: new FormulaField({
            required: false,
            deterministic: true,
            initial: ""
          })
        })
      })
    };
  }
}
