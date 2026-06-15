import {
  CONTEST_ROLL_TYPES,
  CONTEST_TARGET_SOURCES,
  CONTEST_TIE_POLICIES
} from "./ScContestConstants.js";

const ABILITIES = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
const SKILLS = Object.freeze([
  "acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv",
  "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"
]);

export class ScContestActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--contest"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-contest-effect.hbs",
      templates: [
        ...super.PARTS.effect.templates,
        "modules/sc-more-activities/templates/activity-parts/sc-contest-participant.hbs"
      ]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const contest = this.activity?.contest ?? {};
    context.contest = {
      targetSource: contest.targetSource ?? CONTEST_TARGET_SOURCES.TARGET,
      tiePolicy: contest.tiePolicy ?? CONTEST_TIE_POLICIES.TIE,
      initiator: ScContestActivitySheet.#participantContext(contest.initiator),
      defender: ScContestActivitySheet.#participantContext(contest.defender)
    };
    context.rollTypeOptions = ScContestActivitySheet.#rollTypeOptions();
    context.abilityOptions = ScContestActivitySheet.#abilityOptions();
    context.skillOptions = ScContestActivitySheet.#skillOptions();
    context.targetSourceOptions = ScContestActivitySheet.#targetSourceOptions();
    context.tiePolicyOptions = ScContestActivitySheet.#tiePolicyOptions();
    return context;
  }

  static #participantContext(participant = {}) {
    const rollType = participant?.rollType ?? CONTEST_ROLL_TYPES.ABILITY_CHECK;
    return {
      rollType,
      ability: participant?.ability ?? "str",
      skill: participant?.skill ?? "ath",
      formula: participant?.formula ?? "",
      usesAbility: rollType === CONTEST_ROLL_TYPES.ABILITY_CHECK || rollType === CONTEST_ROLL_TYPES.SAVING_THROW,
      usesSkill: rollType === CONTEST_ROLL_TYPES.SKILL,
      usesFormula: rollType === CONTEST_ROLL_TYPES.CUSTOM
    };
  }

  static #rollTypeOptions() {
    return [
      ["AbilityCheck", CONTEST_ROLL_TYPES.ABILITY_CHECK],
      ["SavingThrow", CONTEST_ROLL_TYPES.SAVING_THROW],
      ["Skill", CONTEST_ROLL_TYPES.SKILL],
      ["Custom", CONTEST_ROLL_TYPES.CUSTOM]
    ].map(([label, value]) => ({
      value,
      label: game.i18n.localize(`SCMOREACTIVITIES.Activities.ScContest.Fields.RollType.Choices.${label}`)
    }));
  }

  static #abilityOptions() {
    return ABILITIES.map((value) => ({
      value,
      label: ScContestActivitySheet.#configLabel(CONFIG.DND5E.abilities?.[value]?.label, value.toUpperCase())
    }));
  }

  static #skillOptions() {
    return SKILLS.map((value) => ({
      value,
      label: ScContestActivitySheet.#configLabel(CONFIG.DND5E.skills?.[value]?.label, value.toUpperCase())
    }));
  }

  static #targetSourceOptions() {
    return [
      ["Target", CONTEST_TARGET_SOURCES.TARGET],
      ["Self", CONTEST_TARGET_SOURCES.SELF]
    ].map(([label, value]) => ({
      value,
      label: game.i18n.localize(`SCMOREACTIVITIES.Activities.ScContest.Fields.TargetSource.Choices.${label}`)
    }));
  }

  static #tiePolicyOptions() {
    return [
      ["Tie", CONTEST_TIE_POLICIES.TIE],
      ["Initiator", CONTEST_TIE_POLICIES.INITIATOR],
      ["Defender", CONTEST_TIE_POLICIES.DEFENDER],
      ["Reroll", CONTEST_TIE_POLICIES.REROLL]
    ].map(([label, value]) => ({
      value,
      label: game.i18n.localize(`SCMOREACTIVITIES.Activities.ScContest.Fields.TiePolicy.Choices.${label}`)
    }));
  }

  static #configLabel(label, fallback) {
    return label ? game.i18n.localize(label) : fallback;
  }
}
