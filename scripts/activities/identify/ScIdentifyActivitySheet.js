import { ScRangeShape } from "../canvas/ScRangeShape.js";

export class ScIdentifyActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--identify"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-identify-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const localize = (key) => game.i18n.localize(`SCMOREACTIVITIES.Activities.ScIdentify.Fields.${key}`);
    const check = this.activity?.check ?? {};
    const identify = this.activity?.identify ?? {};

    context.recipient = this.activity?.recipient ?? "self";
    context.recipientOptions = ["Self", "Target", "Choose"].map((key) => ({
      value: key.toLowerCase(),
      label: localize(`Recipient.Choices.${key}`)
    }));
    context.showRange = context.recipient !== "self";
    context.range = identify.range ?? 30;
    context.rangeShape = ScRangeShape.normalize(identify.rangeShape);
    context.rangeShapeOptions = ScRangeShape.options();

    context.checkSelection = check.skill ? `skill:${check.skill}` : (check.ability ? `ability:${check.ability}` : "");
    context.checkEnabled = Boolean(context.checkSelection);
    const abilityLabel = (key) => CONFIG.DND5E?.abilities?.[key]?.label ?? key;
    const abilityGroup = localize("Check.GroupAbilities");
    const skillGroup = localize("Check.GroupSkills");
    context.checkOptions = [
      { value: "", label: localize("Check.None") },
      ...Object.keys(CONFIG.DND5E?.abilities ?? {}).map((key) => ({
        value: `ability:${key}`,
        label: abilityLabel(key),
        group: abilityGroup
      })),
      ...Object.entries(CONFIG.DND5E?.skills ?? {}).map(([key, config]) => ({
        value: `skill:${key}`,
        label: `${config?.label ?? key} (${abilityLabel(config?.ability)})`,
        group: skillGroup
      }))
    ];

    context.dcMode = identify.dcMode ?? "rarity";
    context.dcModeOptions = [
      { value: "rarity", label: localize("DcMode.Choices.Rarity") },
      { value: "formula", label: localize("DcMode.Choices.Formula") }
    ];
    context.dcByRarity = context.dcMode === "rarity";
    context.dcFormula = identify.dcFormula ?? "";
    context.defaultDc = identify.defaultDc ?? 10;
    // CONFIG.DND5E.itemRarity already includes rarities added by modules such
    // as SC Item Rarity Colors, so every rarity in the world gets a row.
    const rarityDcs = identify.rarityDcs ?? {};
    context.rarities = Object.entries(CONFIG.DND5E?.itemRarity ?? {}).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      dc: rarityDcs[key] ?? ""
    }));
    return context;
  }

  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    const selection = foundry.utils.getProperty(submitData, "checkSelection");
    if (selection !== undefined) {
      delete submitData.checkSelection;
      const value = String(selection);
      const skill = value.startsWith("skill:") ? value.slice("skill:".length) : "";
      const ability = value.startsWith("ability:")
        ? value.slice("ability:".length)
        : (CONFIG.DND5E?.skills?.[skill]?.ability ?? "");
      foundry.utils.setProperty(submitData, "check.ability", ability);
      foundry.utils.setProperty(submitData, "check.skill", skill);
    }
    return submitData;
  }
}
