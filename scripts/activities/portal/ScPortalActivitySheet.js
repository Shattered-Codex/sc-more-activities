export class ScPortalActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--portal"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-portal-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.portal = {
      placementRange: this.activity?.portal?.placementRange ?? "30",
      linkRange: this.activity?.portal?.linkRange ?? "",
      shape: this.activity?.portal?.shape ?? "square",
      size: this.activity?.portal?.size ?? "1",
      snapToGrid: this.activity?.portal?.snapToGrid !== false,
      avoidOccupied: this.activity?.portal?.avoidOccupied !== false,
      oneWay: Boolean(this.activity?.portal?.oneWay),
      triggerOnEnter: this.activity?.portal?.triggerOnEnter !== false,
      triggerOnClick: this.activity?.portal?.triggerOnClick !== false,
      maxUses: this.activity?.portal?.maxUses ?? "",
      durationRounds: this.activity?.portal?.durationRounds ?? "10",
      visibility: this.activity?.portal?.visibility ?? "all",
      color: this.activity?.portal?.color ?? "#8a63d2",
      entryImage: this.activity?.portal?.entryImage ?? "",
      exitImage: this.activity?.portal?.exitImage ?? "",
      allowPlayerRequests: this.activity?.portal?.allowPlayerRequests !== false
    };
    context.shapeOptions = ScPortalActivitySheet.#shapeOptions();
    context.sizeOptions = ScPortalActivitySheet.#sizeOptions();
    context.visibilityOptions = ScPortalActivitySheet.#visibilityOptions();
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

  static #shapeOptions() {
    return [
      {
        value: "square",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScPortal.Fields.Shape.Choices.Square")
      },
      {
        value: "circle",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScPortal.Fields.Shape.Choices.Circle")
      }
    ];
  }

  /** Footprint choices in grid squares; the labels are language-neutral. */
  static #sizeOptions() {
    return [1, 2, 3, 4].map((squares) => ({
      value: String(squares),
      label: `${squares}×${squares}`
    }));
  }

  static #visibilityOptions() {
    return [
      {
        value: "all",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScPortal.Fields.Visibility.Choices.All")
      },
      {
        value: "gm",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScPortal.Fields.Visibility.Choices.Gm")
      },
      {
        value: "hidden",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScPortal.Fields.Visibility.Choices.Hidden")
      }
    ];
  }
}
