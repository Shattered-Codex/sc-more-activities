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
    this.canvasPointerDownHandler = null;
    this.canvasPointerUpHandler = null;
    this.pendingPointerEvent = null;
    this.ignoreNextMouseUp = false;
    this.isResolvingDestination = false;
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
    this.canvasPointerDownHandler = this.#onCanvasPointerDown.bind(this);
    this.canvasPointerUpHandler = this.#onCanvasPointerUp.bind(this);
    canvas?.stage?.on?.("mouseup", this.canvasClickHandler);
    canvas?.app?.view?.addEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
    canvas?.app?.view?.addEventListener?.("pointerup", this.canvasPointerUpHandler, true);
  }

  #stopDestinationSelection() {
    if (!this.canvasClickHandler) {
      this.pendingPointerEvent = null;
    } else {
      canvas?.stage?.off?.("mouseup", this.canvasClickHandler);
      this.canvasClickHandler = null;
    }

    if (this.canvasPointerDownHandler) {
      canvas?.app?.view?.removeEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
      this.canvasPointerDownHandler = null;
    }
    if (this.canvasPointerUpHandler) {
      canvas?.app?.view?.removeEventListener?.("pointerup", this.canvasPointerUpHandler, true);
      this.canvasPointerUpHandler = null;
    }

    this.pendingPointerEvent = null;
    this.ignoreNextMouseUp = false;
  }

  #onCanvasPointerDown(event) {
    if (Number(event?.button ?? 0) !== 0) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();

    this.pendingPointerEvent = event;
  }

  #onCanvasPointerUp(event) {
    if (Number(event?.button ?? 0) !== 0) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (this.#eventCanvasPosition(event, event)) {
      this.ignoreNextMouseUp = true;
      void this.#resolveDestination(event, event);
    }
  }

  async #onCanvasClick(event) {
    if (this.ignoreNextMouseUp) {
      this.ignoreNextMouseUp = false;
      return;
    }

    await this.#resolveDestination(event, this.pendingPointerEvent);
  }

  async #resolveDestination(event, pointerEvent = null) {
    if (this.isResolvingDestination) {
      return;
    }

    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    if (!origin) {
      return;
    }

    const rawPosition = this.#eventCanvasPosition(event, pointerEvent);
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

  #eventCanvasPosition(event, pointerEvent = null) {
    const button = pointerEvent?.button ?? event?.button ?? event?.data?.originalEvent?.button;
    if (button !== undefined && button !== 0) {
      return null;
    }

    const localPosition = event?.data?.getLocalPosition?.(canvas?.stage);
    if (Number.isFinite(localPosition?.x) && Number.isFinite(localPosition?.y)) {
      return localPosition;
    }

    const originalEvent = pointerEvent ?? event?.data?.originalEvent ?? event;
    const clientPosition = canvas?.canvasCoordinatesFromClient?.(originalEvent);
    if (Number.isFinite(clientPosition?.x) && Number.isFinite(clientPosition?.y)) {
      return clientPosition;
    }

    return null;
  }
}
