import { Constants } from "../../constants/Constants.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ScTeleportDestinationApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-teleport-destination-app"],
    tag: "form",
    position: {
      width: 320,
      height: "auto"
    }
  };

  static PARTS = {
    form: {
      template: "modules/sc-more-activities/templates/applications/sc-teleport-destination.hbs"
    }
  };

  constructor(activity, selectedTargets, options = {}) {
    super({
      window: {
        title: Constants.localize("SCMOREACTIVITIES.Activities.ScTeleport.App.Destination.Title", "Teleport Destination")
      },
      ...options
    });
    this.activity = activity;
    this.selectedTargets = selectedTargets;
    this.canvasClickHandler = null;
    this.previewTemplate = null;
  }

  async _prepareContext() {
    const config = this.#config();
    return {
      targetCount: this.selectedTargets.length,
      teleportDistance: config.teleportDistance
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector(".sc-ma-teleport-cancel")?.addEventListener("click", () => {
      this.close();
    });
    await this.#startDestinationSelection();
  }

  async close(options = {}) {
    await super.close(options);
    this.#stopDestinationSelection();
    await ScCanvasActivityService.removePreviewTemplate(this.previewTemplate);
    this.previewTemplate = null;
  }

  async #startDestinationSelection() {
    if (this.canvasClickHandler) {
      return;
    }

    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    if (!origin) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      this.close();
      return;
    }

    const originCenter = ScCanvasActivityService.getTokenCenter(origin);
    const config = this.#config();
    if (config.teleportDistance > 0) {
      const previewColors = ModuleSettings.getTeleportRangeColors();
      this.previewTemplate = await ScCanvasActivityService.createPreviewTemplate({
        type: "circle",
        x: originCenter.x,
        y: originCenter.y,
        distance: config.teleportDistance,
        fillColor: previewColors.fillColor,
        borderColor: previewColors.borderColor
      });
    }

    this.canvasClickHandler = this.#onCanvasClick.bind(this);
    canvas?.stage?.on?.("mouseup", this.canvasClickHandler);
  }

  #stopDestinationSelection() {
    if (!this.canvasClickHandler) {
      return;
    }

    canvas?.stage?.off?.("mouseup", this.canvasClickHandler);
    this.canvasClickHandler = null;
  }

  async #onCanvasClick(event) {
    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    if (!origin) {
      return;
    }

    const rawPosition = this.#eventCanvasPosition(event);
    const destination = this.#config().snapToGrid
      ? ScCanvasActivityService.snapCenterPoint(rawPosition)
      : rawPosition;
    if (!destination) {
      return;
    }

    const config = this.#config();
    const originCenter = ScCanvasActivityService.getTokenCenter(origin);
    const distance = ScCanvasActivityService.sceneDistanceBetweenPoints(originCenter, destination);
    if (config.teleportDistance > 0 && distance > config.teleportDistance) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScTeleport.Warning.DestinationOutOfRange",
        "Destination is outside the teleport range."
      ));
      return;
    }

    this.#stopDestinationSelection();
    const result = await ScCanvasActivityService.executeTeleportPlacement(this.activity, {
      tokenIds: this.selectedTargets.map((target) => target.id),
      destination
    });
    if (result?.ok) {
      await this.close();
      return;
    }

    await this.#startDestinationSelection();
  }

  #config() {
    const config = this.activity?.teleport ?? {};
    return {
      teleportDistance: Math.max(0, Number(config.teleportDistance ?? 30) || 0),
      snapToGrid: config.snapToGrid !== false
    };
  }

  #eventCanvasPosition(event) {
    const button = event?.button ?? event?.data?.originalEvent?.button;
    if (button !== undefined && button !== 0) {
      return null;
    }

    const localPosition = event?.data?.getLocalPosition?.(canvas?.stage);
    if (Number.isFinite(localPosition?.x) && Number.isFinite(localPosition?.y)) {
      return localPosition;
    }

    const originalEvent = event?.data?.originalEvent ?? event;
    const clientPosition = canvas?.canvasCoordinatesFromClient?.(originalEvent);
    if (Number.isFinite(clientPosition?.x) && Number.isFinite(clientPosition?.y)) {
      return clientPosition;
    }

    return null;
  }
}
