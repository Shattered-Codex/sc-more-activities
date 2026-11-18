import {
  CANVAS_TARGET_SOURCES,
  MOVEMENT_TYPES
} from "../canvas/ScCanvasActivityConstants.js";
import { ScMovementDistance } from "../canvas/ScMovementDistance.js";
import { ScTargetSaveService } from "../canvas/ScTargetSaveService.js";
import { ScRangeShape } from "../canvas/ScRangeShape.js";
import { ScTokenSize } from "../canvas/ScTokenSize.js";

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

  /** Collapsible panels (`data-sc-panel`) open in this sheet, kept across the re-render each change causes. */
  #openPanels = new Set();

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.openPanels = Object.fromEntries([...this.#openPanels].map((name) => [name, true]));
    context.movement = {
      targetSource: this.activity?.movement?.targetSource ?? CANVAS_TARGET_SOURCES.TARGETS,
      type: this.activity?.movement?.type ?? MOVEMENT_TYPES.PUSH,
      distance: this.activity?.movement?.distance ?? ScMovementDistance.DEFAULT_DISTANCE,
      distanceMode: ScMovementDistance.normalizeMode(this.activity?.movement?.distanceMode),
      minDistance: this.activity?.movement?.minDistance ?? 0,
      maxRange: this.activity?.movement?.maxRange ?? 0,
      rangeShape: ScRangeShape.normalize(this.activity?.movement?.rangeShape),
      targetSize: ScTokenSize.normalize(this.activity?.movement?.targetSize),
      maxTargets: this.activity?.movement?.maxTargets ?? 1,
      snapToGrid: this.activity?.movement?.snapToGrid !== false,
      save: {
        enabled: this.activity?.movement?.save?.enabled === true,
        ability: this.activity?.movement?.save?.ability ?? "str",
        dc: this.activity?.movement?.save?.dc ?? ""
      }
    };
    context.targetSourceOptions = ScMovementActivitySheet.#targetSourceOptions();
    context.movementTypeChoices = ScMovementActivitySheet.#movementTypeChoices(context.movement.type);
    context.distanceModeOptions = ScMovementActivitySheet.#distanceModeOptions();
    context.distanceIsRange = context.movement.distanceMode === ScMovementDistance.MODES.RANGE;
    // A range whose minimum reaches its maximum offers nothing to pick: say so
    // instead of leaving the user to wonder why no choice appears on use.
    const bounds = ScMovementDistance.bounds(this.activity?.movement);
    context.distanceCollapsedNotice = context.distanceIsRange && !bounds.isRange
      ? game.i18n.format("SCMOREACTIVITIES.Activities.ScMovement.Fields.Distance.Collapsed", { distance: bounds.max })
      : "";
    context.rangeShapeOptions = ScRangeShape.options();
    context.targetSizeModeOptions = ScTokenSize.modeOptions();
    context.targetSizeOptions = ScTokenSize.sizeOptions(context.movement.targetSize.sizes);
    context.targetSizeOffsetOptions = ScTokenSize.offsetOptions();
    context.targetSizeIsAbsolute = context.movement.targetSize.mode === ScTokenSize.MODES.ABSOLUTE;
    context.targetSizeIsRelative = context.movement.targetSize.mode === ScTokenSize.MODES.RELATIVE;
    // The save gate only applies to external targets, so the section is tied
    // to the targeted-tokens source; self and controlled keep the direct flow.
    context.movementShowsSave = context.movement.targetSource === CANVAS_TARGET_SOURCES.TARGETS;
    context.saveAbilityOptions = ScTargetSaveService.abilityOptions();
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

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelectorAll("details[data-sc-panel]").forEach((panel) => {
      panel.addEventListener("toggle", () => {
        if (panel.open) {
          this.#openPanels.add(panel.dataset.scPanel);
        } else {
          this.#openPanels.delete(panel.dataset.scPanel);
        }
      });
    });
  }

  static #movementTypeChoices(selected) {
    const prefix = "SCMOREACTIVITIES.Activities.ScMovement.Fields.Type.Cards";
    return [
      { value: MOVEMENT_TYPES.PUSH, key: "Push", icon: "fa-solid fa-arrow-right" },
      { value: MOVEMENT_TYPES.PULL, key: "Pull", icon: "fa-solid fa-arrow-left" },
      { value: MOVEMENT_TYPES.EITHER, key: "Either", icon: "fa-solid fa-arrows-left-right" }
    ].map(({ value, key, icon }) => ({
      value,
      icon,
      label: game.i18n.localize(`${prefix}.${key}.Label`),
      description: game.i18n.localize(`${prefix}.${key}.Description`),
      checked: value === selected
    }));
  }

  static #distanceModeOptions() {
    return [
      {
        value: ScMovementDistance.MODES.FIXED,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.DistanceMode.Choices.Fixed")
      },
      {
        value: ScMovementDistance.MODES.RANGE,
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.DistanceMode.Choices.Range")
      }
    ];
  }
}
