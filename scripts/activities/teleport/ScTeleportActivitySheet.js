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
    const maxTargets = this.activity?.teleport?.maxTargets ?? 1;
    const onlyTargetSelf = Boolean(this.activity?.teleport?.onlyTargetSelf);
    context.teleport = {
      maxTargets,
      targetSelf: Boolean(this.activity?.teleport?.targetSelf),
      onlyTargetSelf,
      targetRadius: this.activity?.teleport?.targetRadius ?? 15,
      teleportDistance: this.activity?.teleport?.teleportDistance ?? 30,
      keepArrangement: this.activity?.teleport?.keepArrangement !== false,
      clusterRadius: this.activity?.teleport?.clusterRadius ?? 5,
      snapToGrid: this.activity?.teleport?.snapToGrid !== false
    };
    // Multi-token placement options only matter when more than one token can be
    // teleported and the actor is not locked to teleporting only itself.
    context.teleportShowsArrangement = maxTargets > 1 && !onlyTargetSelf;
    context.teleportShowsTargeting = !onlyTargetSelf;
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
