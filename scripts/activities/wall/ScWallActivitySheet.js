export class ScWallActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--wall"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-wall-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.wall = {
      maxWalls: this.activity?.wall?.maxWalls ?? "1",
      wallType: this.activity?.wall?.wallType ?? "continuous",
      facing: this.activity?.wall?.facing ?? "both",
      panelSize: this.activity?.wall?.panelSize ?? "5",
      panelSpacing: this.activity?.wall?.panelSpacing ?? "0",
      maxPanels: this.activity?.wall?.maxPanels ?? "",
      referenceRange: this.activity?.wall?.referenceRange ?? "0",
      maxLength: this.activity?.wall?.maxLength ?? "60",
      blocksMovement: this.activity?.wall?.blocksMovement !== false,
      blocksSight: this.activity?.wall?.blocksSight !== false,
      blocksSound: Boolean(this.activity?.wall?.blocksSound),
      allowPlayerRequests: Boolean(this.activity?.wall?.allowPlayerRequests)
    };
    context.wallTypeOptions = ScWallActivitySheet.#wallTypeOptions();
    context.facingOptions = ScWallActivitySheet.#facingOptions();
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

  static #wallTypeOptions() {
    return [
      {
        value: "continuous",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.WallType.Choices.Continuous")
      },
      {
        value: "circular",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.WallType.Choices.Circular")
      },
      {
        value: "panels",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.WallType.Choices.Panels")
      }
    ];
  }

  static #facingOptions() {
    return [
      {
        value: "both",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.Facing.Choices.Both")
      },
      {
        value: "towards",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.Facing.Choices.Towards")
      },
      {
        value: "away",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.Facing.Choices.Away")
      },
      {
        value: "any",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.Facing.Choices.Any")
      }
    ];
  }
}
