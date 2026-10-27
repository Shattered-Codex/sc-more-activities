import { ScRangeShape } from "../canvas/ScRangeShape.js";

export class ScIdentifyActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static DEFAULT_RARITY_DCS = Object.freeze({
    common: 10,
    uncommon: 13,
    rare: 16,
    veryRare: 19,
    legendary: 22,
    artifact: 25
  });

  static defineSchema() {
    const fields = foundry.data.fields;
    const FormulaField = dnd5e.dataModels.fields.FormulaField;
    const dcField = (options = {}) => new fields.NumberField({
      required: false,
      nullable: true,
      integer: true,
      min: 0,
      ...options
    });
    return {
      ...super.defineSchema(),
      // Whose inventory is listed: the activity's own actor, one targeted
      // token, or a creature the user picks within range (themselves included).
      recipient: new fields.StringField({
        required: false,
        initial: "self",
        choices: ["self", "target", "choose"]
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
        })
      }),
      identify: new fields.SchemaField({
        // Reach of the "choose" mode in scene units; 0 means the whole scene.
        range: new fields.NumberField({
          required: false,
          initial: 30,
          min: 0
        }),
        rangeShape: ScRangeShape.field(fields),
        dcMode: new fields.StringField({
          required: false,
          initial: "rarity",
          choices: ["rarity", "formula"]
        }),
        dcFormula: new FormulaField({
          required: false,
          deterministic: true,
          initial: ""
        }),
        // Used for items without a rarity, for rarities whose DC is left blank,
        // and when a custom formula does not resolve.
        defaultDc: dcField({ nullable: false, initial: 10 }),
        // Keyed by CONFIG.DND5E.itemRarity, which also holds rarities added by other modules.
        rarityDcs: new fields.TypedObjectField(dcField(), {
          required: false,
          initial: () => ({ ...ScIdentifyActivityData.DEFAULT_RARITY_DCS })
        })
      })
    };
  }
}
