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
        }),
        // Points one unit of this source costs in the budget selection mode.
        cost: new fields.NumberField({
          required: false,
          integer: true,
          min: 1,
          initial: 1
        })
      }), {
        required: false,
        initial: []
      }),
      // "all" grants every source, as grants always did; "choose" asks the
      // user to pick `count` of them when the activity is used; "budget" lets
      // them spend up to `budget` points on units of the sources.
      selection: new fields.SchemaField({
        mode: new fields.StringField({
          required: false,
          initial: ScGrantEntryHelpers.SELECTION_MODES.ALL,
          choices: Object.values(ScGrantEntryHelpers.SELECTION_MODES)
        }),
        count: new fields.NumberField({
          required: false,
          integer: true,
          min: 1,
          initial: 1
        }),
        budget: new FormulaField({
          required: false,
          deterministic: true,
          initial: ScGrantEntryHelpers.DEFAULT_BUDGET
        })
      }),
      // "bastion" only applies on facility items: the grant becomes a facility
      // order and the items arrive when a bastion turn completes it.
      delivery: new fields.StringField({
        required: false,
        initial: ScGrantEntryHelpers.DELIVERY_MODES.INSTANT,
        choices: Object.values(ScGrantEntryHelpers.DELIVERY_MODES)
      }),
      bastion: new fields.SchemaField({
        order: new fields.StringField({
          required: false,
          initial: ScGrantEntryHelpers.BASTION_ORDERS[0],
          choices: [...ScGrantEntryHelpers.BASTION_ORDERS]
        }),
        days: new fields.NumberField({
          required: false,
          integer: true,
          min: 1,
          initial: ScGrantEntryHelpers.DEFAULT_BASTION_DAYS
        })
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
