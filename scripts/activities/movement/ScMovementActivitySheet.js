import {
  CANVAS_TARGET_SOURCES,
  MOVEMENT_TYPES
} from "../canvas/ScCanvasActivityConstants.js";

export class ScMovementActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--movement"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-movement-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.movement = {
      targetSource: this.activity?.movement?.targetSource ?? CANVAS_TARGET_SOURCES.TARGETS,
      type: this.activity?.movement?.type ?? MOVEMENT_TYPES.PUSH,
      distance: this.activity?.movement?.distance ?? 10,
      maxRange: this.activity?.movement?.maxRange ?? 0,
      maxTargets: this.activity?.movement?.maxTargets ?? 1,
      snapToGrid: this.activity?.movement?.snapToGrid !== false
    };
    context.targetSourceOptions = ScMovementActivitySheet.#targetSourceOptions();
    context.movementTypeOptions = ScMovementActivitySheet.#movementTypeOptions();
    return context;
  }

  static #targetSourceOptions() {
    return [
      {
        value: CANVAS_TARGET_SOURCES.TARGETS,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.Canvas.Fields.TargetSource.Choices.Targets")
      },
      {
        value: CANVAS_TARGET_SOURCES.CONTROLLED,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.Canvas.Fields.TargetSource.Choices.Controlled")
      },
      {
        value: CANVAS_TARGET_SOURCES.SELF,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.Canvas.Fields.TargetSource.Choices.Self")
      }
    ];
  }

  static #movementTypeOptions() {
    return [
      {
        value: MOVEMENT_TYPES.PUSH,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.Type.Choices.Push")
      },
      {
        value: MOVEMENT_TYPES.PULL,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.Type.Choices.Pull")
      },
      {
        value: MOVEMENT_TYPES.EITHER,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.Type.Choices.Either")
      }
    ];
  }
}
