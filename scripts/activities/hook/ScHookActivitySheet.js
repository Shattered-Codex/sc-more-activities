export class ScHookActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--hook"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-hook-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.dispatchMode = this.activity?.dispatch?.mode ?? "hook";
    context.isHookMode = context.dispatchMode === "hook";
    context.isCallbackMode = context.dispatchMode === "callback";
    context.hookName = this.activity?.hook?.name ?? "";
    context.callback = {
      moduleId: this.activity?.callback?.moduleId ?? "",
      id: this.activity?.callback?.id ?? ""
    };
    context.dispatchModeOptions = [
      {
        value: "hook",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScHook.Fields.DispatchMode.Choices.Hook")
      },
      {
        value: "callback",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScHook.Fields.DispatchMode.Choices.Callback")
      }
    ];
    return context;
  }
}
