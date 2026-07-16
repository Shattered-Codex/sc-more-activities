import { FLOW_CONDITION_TYPES, FLOW_END, FLOW_ROLL_TYPES } from "./ScConditionalChainFlow.js";
import { FLOW_PROPERTY_OPERATORS } from "./ScConditionalChainConditions.js";

export class ScConditionalChainActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    const FormulaField = dnd5e.dataModels.fields.FormulaField;
    return {
      ...super.defineSchema(),
      flow: new fields.SchemaField({
        startNode: new fields.StringField({
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
        stopOnCancel: new fields.BooleanField({
          required: false,
          initial: true
        }),
        continueOnChildError: new fields.BooleanField({
          required: false,
          initial: false
        }),
        suppressChildMessages: new fields.BooleanField({
          required: false,
          initial: false
        }),
        compactChildCards: new fields.BooleanField({
          required: false,
          initial: false
        }),
        nodes: new fields.ArrayField(new fields.SchemaField({
          nodeId: new fields.StringField({
            required: true,
            blank: true,
            initial: ""
          }),
          label: new fields.StringField({
            required: false,
            blank: true,
            initial: ""
          }),
          activityId: new fields.StringField({
            required: false,
            blank: true,
            initial: ""
          }),
          conditionType: new fields.StringField({
            required: false,
            initial: FLOW_CONDITION_TYPES.ALWAYS,
            choices: Object.values(FLOW_CONDITION_TYPES)
          }),
          condition: new fields.SchemaField({
            path: new fields.StringField({
              required: false,
              blank: true,
              initial: ""
            }),
            operator: new fields.StringField({
              required: false,
              initial: FLOW_PROPERTY_OPERATORS.EQ,
              choices: Object.values(FLOW_PROPERTY_OPERATORS)
            }),
            value: new fields.StringField({
              required: false,
              blank: true,
              initial: ""
            }),
            rollType: new fields.StringField({
              required: false,
              initial: FLOW_ROLL_TYPES.ABILITY_CHECK,
              choices: Object.values(FLOW_ROLL_TYPES)
            }),
            ability: new fields.StringField({
              required: false,
              blank: true,
              initial: "str"
            }),
            skill: new fields.StringField({
              required: false,
              blank: true,
              initial: "ath"
            }),
            formula: new FormulaField({
              required: false,
              initial: ""
            }),
            dcFormula: new FormulaField({
              required: false,
              deterministic: true,
              initial: ""
            })
          }),
          routes: new fields.SchemaField({
            next: new fields.StringField({
              required: false,
              blank: true,
              initial: FLOW_END
            }),
            onTrue: new fields.StringField({
              required: false,
              blank: true,
              initial: FLOW_END
            }),
            onFalse: new fields.StringField({
              required: false,
              blank: true,
              initial: FLOW_END
            }),
            fallback: new fields.StringField({
              required: false,
              blank: true,
              initial: FLOW_END
            })
          }),
          valueBranches: new fields.ArrayField(new fields.SchemaField({
            key: new fields.StringField({ required: true, blank: true, initial: "" }),
            operator: new fields.StringField({
              required: false,
              initial: FLOW_PROPERTY_OPERATORS.EQ,
              choices: Object.values(FLOW_PROPERTY_OPERATORS)
            }),
            value: new fields.StringField({ required: false, blank: true, initial: "" }),
            next: new fields.StringField({ required: false, blank: true, initial: FLOW_END })
          }), { required: false, initial: [] }),
          choices: new fields.ArrayField(new fields.SchemaField({
            key: new fields.StringField({
              required: true,
              blank: true,
              initial: ""
            }),
            label: new fields.StringField({
              required: false,
              blank: true,
              initial: ""
            }),
            next: new fields.StringField({
              required: false,
              blank: true,
              initial: FLOW_END
            })
          }), {
            required: false,
            initial: []
          })
        }), {
          required: false,
          initial: []
        })
      })
    };
  }
}
