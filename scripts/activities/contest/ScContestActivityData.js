import {
  CONTEST_ROLL_TYPES,
  CONTEST_TARGET_SOURCES,
  CONTEST_TIE_POLICIES
} from "./ScContestConstants.js";

export class ScContestActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      contest: new fields.SchemaField({
        targetSource: new fields.StringField({
          required: false,
          initial: CONTEST_TARGET_SOURCES.TARGET,
          choices: Object.values(CONTEST_TARGET_SOURCES)
        }),
        tiePolicy: new fields.StringField({
          required: false,
          initial: CONTEST_TIE_POLICIES.TIE,
          choices: Object.values(CONTEST_TIE_POLICIES)
        }),
        initiator: ScContestActivityData.#participantSchema(fields, {
          rollType: CONTEST_ROLL_TYPES.ABILITY_CHECK,
          ability: "str",
          skill: "ath",
          formula: "1d20 + @abilities.str.mod"
        }),
        defender: ScContestActivityData.#participantSchema(fields, {
          rollType: CONTEST_ROLL_TYPES.ABILITY_CHECK,
          ability: "str",
          skill: "ath",
          formula: "1d20 + @abilities.str.mod"
        })
      })
    };
  }

  static #participantSchema(fields, defaults) {
    return new fields.SchemaField({
      rollType: new fields.StringField({
        required: false,
        initial: defaults.rollType,
        choices: Object.values(CONTEST_ROLL_TYPES)
      }),
      ability: new fields.StringField({
        required: false,
        initial: defaults.ability,
        choices: ["str", "dex", "con", "int", "wis", "cha"]
      }),
      skill: new fields.StringField({
        required: false,
        initial: defaults.skill,
        choices: [
          "acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv",
          "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"
        ]
      }),
      formula: new fields.StringField({
        required: false,
        blank: true,
        initial: defaults.formula
      })
    });
  }
}
