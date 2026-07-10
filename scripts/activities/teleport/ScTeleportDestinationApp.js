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
    this.isResolvingDestination = false;
    this.previewGraphics = null;
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
    this.#destroyPreviewGraphics();
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
      this.#drawRangePreview(originCenter, config.teleportDistance);
    }

    this.canvasClickHandler = this.#onCanvasClick.bind(this);
    canvas?.stage?.on?.("click", this.canvasClickHandler);
  }

  #stopDestinationSelection() {
    if (!this.canvasClickHandler) {
      return;
    }
    canvas?.stage?.off?.("click", this.canvasClickHandler);
    this.canvasClickHandler = null;
  }

  #drawRangePreview(originCenter, distance) {
    if (!globalThis.PIXI?.Graphics || this.previewGraphics || !originCenter) {
      return;
    }

    const distancePixels = Number(canvas?.dimensions?.distancePixels ?? 0);
    const radius = Number(distance) * distancePixels;
    if (!Number.isFinite(radius) || radius <= 0) {
      return;
    }

    const previewColors = ModuleSettings.getTeleportRangeColors();
    const borderColor = Number.parseInt(String(previewColors.borderColor ?? "#24b86a").slice(1), 16);
    const fillColor = Number.parseInt(String(previewColors.fillColor ?? "#39f08c").slice(1), 16);

    this.previewGraphics = new PIXI.Graphics();
    this.previewGraphics.eventMode = "none";
    this.previewGraphics.interactive = false;
    this.previewGraphics.lineStyle(3, borderColor, 0.95);
    this.previewGraphics.beginFill(fillColor, 0.2);
    this.previewGraphics.drawCircle(originCenter.x, originCenter.y, radius);
    this.previewGraphics.endFill();
    canvas?.stage?.addChild?.(this.previewGraphics);
  }

  #destroyPreviewGraphics() {
    if (!this.previewGraphics) {
      return;
    }

    this.previewGraphics.parent?.removeChild?.(this.previewGraphics);
    this.previewGraphics.destroy();
    this.previewGraphics = null;
  }

  async #onCanvasClick(event) {
    await this.#resolveDestination(event);
  }

  async #resolveDestination(event) {
    if (this.isResolvingDestination) {
      return;
    }

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

    this.isResolvingDestination = true;
    this.#stopDestinationSelection();
    try {
      const result = await ScCanvasActivityService.executeTeleportPlacement(this.activity, {
        tokenIds: this.selectedTargets.map((target) => target.id),
        destination
      });
      if (result?.ok) {
        await this.close();
        return;
      }
    } finally {
      this.isResolvingDestination = false;
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
    const button = event?.data?.originalEvent?.button ?? event?.button;
    if (button !== undefined && button !== 0) {
      return null;
    }

    const localPosition = event?.data?.getLocalPosition?.(canvas?.tokens ?? canvas?.stage);
    if (Number.isFinite(localPosition?.x) && Number.isFinite(localPosition?.y)) {
      return localPosition;
    }

    const originalEvent = event?.data?.originalEvent ?? event;
    const clientPosition = canvas?.canvasCoordinatesFromClient?.({
      x: originalEvent?.x ?? originalEvent?.clientX,
      y: originalEvent?.y ?? originalEvent?.clientY
    });
    if (Number.isFinite(clientPosition?.x) && Number.isFinite(clientPosition?.y)) {
      return clientPosition;
    }

    return null;
  }
}
