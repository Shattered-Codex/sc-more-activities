export class ScChainActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--chain"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-chain-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const configuredIds = this.#configuredIds();
    context.chain = {
      activityIds: this.activity?.chain?.activityIds ?? "",
      maxDepth: this.activity?.chain?.maxDepth ?? 5,
      continueOnFailure: this.activity?.chain?.continueOnFailure === true,
      stopOnCancel: this.activity?.chain?.stopOnCancel !== false,
      suppressChildMessages: this.activity?.chain?.suppressChildMessages === true
    };
    context.availableActivities = this.#getAvailableActivities(configuredIds);
    return context;
  }

  #configuredIds() {
    return new Set(String(this.activity?.chain?.activityIds ?? "")
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean));
  }

  #getAvailableActivities(configuredIds) {
    const activities = this.activity?.item?.system?.activities;
    const values = typeof activities?.values === "function" ? activities.values() : activities;
    return Array.from(values ?? [])
      .filter((activity) => activity.id !== this.activity?.id)
      .map((activity) => ({
        id: activity.id,
        name: activity.name,
        type: activity.type,
        selected: configuredIds.has(activity.id)
      }))
      .sort((left, right) => left.name.localeCompare(right.name, game?.i18n?.lang ?? undefined));
  }
}
