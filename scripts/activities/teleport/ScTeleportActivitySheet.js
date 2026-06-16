export class ScTeleportActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--teleport"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-teleport-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.teleport = {
      maxTargets: this.activity?.teleport?.maxTargets ?? 1,
      targetSelf: Boolean(this.activity?.teleport?.targetSelf),
      onlyTargetSelf: Boolean(this.activity?.teleport?.onlyTargetSelf),
      targetRadius: this.activity?.teleport?.targetRadius ?? 15,
      teleportDistance: this.activity?.teleport?.teleportDistance ?? 30,
      keepArrangement: this.activity?.teleport?.keepArrangement !== false,
      clusterRadius: this.activity?.teleport?.clusterRadius ?? 5,
      snapToGrid: this.activity?.teleport?.snapToGrid !== false
    };
    return context;
  }

  async _prepareIdentityContext(context, options) {
    context = await super._prepareIdentityContext(context, options);
    context.behaviorFields = [];
    return context;
  }

  _getTabs() {
    const tabs = super._getTabs();
    if (tabs.activation?.tabs) {
      delete tabs.activation.tabs.targeting;
    }
    return tabs;
  }
}
