export class ScSoundActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--sound"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-sound-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.audio = {
      source: this.activity?.audio?.source ?? "",
      volume: this.activity?.audio?.volume ?? 0.8
    };
    context.playback = {
      audience: this.activity?.playback?.audience ?? "self"
    };
    context.audienceOptions = [
      {
        value: "self",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScSound.Fields.Audience.Choices.Self")
      },
      {
        value: "everyone",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScSound.Fields.Audience.Choices.Everyone")
      }
    ];
    return context;
  }
}
