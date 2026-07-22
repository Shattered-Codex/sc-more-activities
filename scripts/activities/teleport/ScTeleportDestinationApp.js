import { Constants } from "../../constants/Constants.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ScTeleportDestinationApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-teleport-destination-app"],
    tag: "div",
    window: {
      frame: false,
      positioned: false
    },
    position: {
      width: "auto",
      height: "auto"
    }
  };

  static PARTS = {
    form: {
      template: "modules/sc-more-activities/templates/applications/sc-teleport-destination.hbs"
    }
  };

  constructor(activity, selectedTargets, options = {}) {
    super({ ...options });
    this.activity = activity;
    this.selectedTargets = selectedTargets;
    this.isResolvingDestination = false;
    this.previewGraphics = null;
    this.previewLabels = null;
    this.hoverPoint = null;
    this.canvasPointerDownHandler = null;
    this.canvasPointerUpHandler = null;
    this.canvasPointerMoveHandler = null;
    this.canvasContextMenuHandler = null;
    this.keydownHandler = null;
    this.minimizedWindows = null;
  }

  async _prepareContext() {
    const config = this.#config();
    return {
      targetCount: this.selectedTargets.length,
      teleportDistance: config.teleportDistance,
      rangeUnits: ScTeleportDestinationApp.#gridUnits(),
      hasRangeLimit: config.teleportDistance > 0
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector(".sc-ma-teleport-cancel")?.addEventListener("click", () => {
      this.close();
    });
    if (this.minimizedWindows === null) {
      this.#minimizeOpenWindows();
    }
    this.#startDestinationSelection();
  }

  async close(options = {}) {
    this.#stopDestinationSelection();
    this.#destroyPreviewGraphics();
    this.#restoreMinimizedWindows();
    await super.close(options);
  }

  #minimizeOpenWindows() {
    const restore = [];
    const consider = (app) => {
      if (!app || app === this || app.minimized || app.rendered === false) {
        return;
      }
      if (typeof app.minimize !== "function") {
        return;
      }
      restore.push(app);
    };

    // Legacy (ApplicationV1) popout windows: dialogs and older sheets.
    for (const app of Object.values(globalThis.ui?.windows ?? {})) {
      consider(app);
    }

    // ApplicationV2 document sheets (actor/item/journal sheets). Restricting to
    // document sheets keeps core UI (sidebar, scene controls, hotbar) untouched.
    const DocumentSheetV2 = foundry.applications?.api?.DocumentSheetV2;
    const instances = foundry.applications?.instances;
    if (DocumentSheetV2 && instances?.values) {
      for (const app of instances.values()) {
        if (app instanceof DocumentSheetV2) {
          consider(app);
        }
      }
    }

    this.minimizedWindows = restore;
    for (const app of restore) {
      try {
        app.minimize?.();
      } catch (error) {
        // Ignore windows that refuse to minimize.
      }
    }
  }

  #restoreMinimizedWindows() {
    const windows = this.minimizedWindows ?? [];
    this.minimizedWindows = null;
    for (const app of windows) {
      try {
        app.maximize?.();
      } catch (error) {
        // Ignore windows that refuse to restore.
      }
    }
  }

  #startDestinationSelection() {
    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    if (!origin) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      this.close();
      return;
    }

    if (this.canvasPointerUpHandler) {
      return;
    }

    this.canvasPointerDownHandler = this.#onCanvasPointerDown.bind(this);
    this.canvasPointerUpHandler = this.#onCanvasPointerUp.bind(this);
    this.canvasPointerMoveHandler = this.#onCanvasPointerMove.bind(this);
    this.canvasContextMenuHandler = this.#onCanvasContextMenu.bind(this);
    this.keydownHandler = this.#onKeyDown.bind(this);

    // Listen at the window level during the capture phase. This runs before the
    // canvas element's own listeners, so consuming the event here keeps the
    // click from reaching the canvas interaction layer (and any module hooked
    // into it, such as Automated Animations) while we place the destination.
    const target = globalThis.window;
    target?.addEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
    target?.addEventListener?.("pointerup", this.canvasPointerUpHandler, true);
    target?.addEventListener?.("pointermove", this.canvasPointerMoveHandler, true);
    target?.addEventListener?.("contextmenu", this.canvasContextMenuHandler, true);
    target?.addEventListener?.("keydown", this.keydownHandler, true);

    this.#drawPreview();
  }

  #stopDestinationSelection() {
    const target = globalThis.window;
    if (this.canvasPointerDownHandler) {
      target?.removeEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
      this.canvasPointerDownHandler = null;
    }
    if (this.canvasPointerUpHandler) {
      target?.removeEventListener?.("pointerup", this.canvasPointerUpHandler, true);
      this.canvasPointerUpHandler = null;
    }
    if (this.canvasPointerMoveHandler) {
      target?.removeEventListener?.("pointermove", this.canvasPointerMoveHandler, true);
      this.canvasPointerMoveHandler = null;
    }
    if (this.canvasContextMenuHandler) {
      target?.removeEventListener?.("contextmenu", this.canvasContextMenuHandler, true);
      this.canvasContextMenuHandler = null;
    }
    if (this.keydownHandler) {
      target?.removeEventListener?.("keydown", this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  #isCanvasEvent(event) {
    const view = canvas?.app?.view ?? null;
    return Boolean(view) && event?.target === view;
  }

  #onCanvasPointerDown(event) {
    if (!this.#isCanvasEvent(event) || Number(event?.button ?? 0) !== 0) {
      return;
    }
    // Consume the press so the canvas does not pan and other modules do not
    // react to it while the destination is being picked.
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }

  async #onCanvasPointerUp(event) {
    if (!this.#isCanvasEvent(event) || Number(event?.button ?? 0) !== 0) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    await this.#resolveDestination(event);
  }

  #onCanvasPointerMove(event) {
    if (!this.#isCanvasEvent(event)) {
      return;
    }
    const point = this.#destinationFromEvent(event);
    if (!point) {
      return;
    }
    this.hoverPoint = point;
    this.#drawPreview();
  }

  #onCanvasContextMenu(event) {
    if (!this.#isCanvasEvent(event)) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    this.close();
  }

  #onKeyDown(event) {
    if (event?.key === "Escape") {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.close();
    }
  }

  #ensurePreviewGraphics() {
    if (!globalThis.PIXI?.Graphics) {
      return;
    }
    if (!this.previewGraphics) {
      this.previewGraphics = new PIXI.Graphics();
      this.previewGraphics.eventMode = "none";
      this.previewGraphics.interactive = false;
      canvas?.stage?.addChild?.(this.previewGraphics);
    }
    // Labels live in their own container so a Graphics#clear does not drop
    // them; they are rebuilt on every redraw.
    if (!this.previewLabels && PIXI.Container && PIXI.Text && PIXI.TextStyle) {
      this.previewLabels = new PIXI.Container();
      this.previewLabels.eventMode = "none";
      this.previewLabels.interactive = false;
      canvas?.stage?.addChild?.(this.previewLabels);
    }
  }

  #destroyPreviewGraphics() {
    if (this.previewLabels) {
      this.previewLabels.parent?.removeChild?.(this.previewLabels);
      this.previewLabels.destroy({ children: true });
      this.previewLabels = null;
    }
    if (!this.previewGraphics) {
      return;
    }
    this.previewGraphics.parent?.removeChild?.(this.previewGraphics);
    this.previewGraphics.destroy();
    this.previewGraphics = null;
  }

  #drawPreview() {
    this.#ensurePreviewGraphics();
    if (!this.previewGraphics) {
      return;
    }

    this.previewGraphics.clear();
    this.#clearLabels();

    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    if (!origin) {
      return;
    }

    const config = this.#config();
    const colors = ModuleSettings.getTeleportRangeColors();
    const borderColor = ScTeleportDestinationApp.#hexToNumber(colors.borderColor, 0x24b86a);
    const fillColor = ScTeleportDestinationApp.#hexToNumber(colors.fillColor, 0x39f08c);
    const outOfRangeColor = 0xd32f2f;
    const outOfRangeFill = 0xff6b6b;

    const originCenter = ScCanvasActivityService.getTokenCenter(origin);
    const distancePixels = Number(canvas?.dimensions?.distancePixels ?? 0);
    const rangePixels = config.teleportDistance > 0 ? config.teleportDistance * distancePixels : Infinity;
    if (config.teleportDistance > 0 && originCenter) {
      if (Number.isFinite(rangePixels) && rangePixels > 0) {
        this.previewGraphics.lineStyle(2, borderColor, 0.9);
        this.previewGraphics.beginFill(fillColor, 0.12);
        this.previewGraphics.drawCircle(originCenter.x, originCenter.y, rangePixels);
        this.previewGraphics.endFill();
      }
    }

    this.#drawWalls(originCenter, rangePixels);

    if (!this.hoverPoint) {
      return;
    }

    const preview = ScCanvasActivityService.getTeleportPlacementPreview(this.activity, {
      tokenIds: this.selectedTargets.map((target) => target.id),
      destination: this.hoverPoint
    });
    if (!preview) {
      return;
    }

    const strokeColor = preview.inRange ? borderColor : outOfRangeColor;
    const areaColor = preview.inRange ? fillColor : outOfRangeFill;

    for (const landing of preview.landings) {
      const x = landing.center.x - (landing.size.width / 2);
      const y = landing.center.y - (landing.size.height / 2);
      this.previewGraphics.lineStyle(2, strokeColor, 0.95);
      this.previewGraphics.beginFill(areaColor, 0.25);
      this.previewGraphics.drawRoundedRect(x, y, landing.size.width, landing.size.height, 6);
      this.previewGraphics.endFill();
    }

    const markerRadius = ScTeleportDestinationApp.#markerRadius();
    this.previewGraphics.lineStyle(2, strokeColor, 0.95);
    this.previewGraphics.beginFill(areaColor, 0.55);
    this.previewGraphics.drawCircle(preview.destination.x, preview.destination.y, markerRadius);
    this.previewGraphics.endFill();

    this.#drawDistanceLabel(preview, originCenter, config.teleportDistance, markerRadius);
  }

  /**
   * Label the destination marker with the distance travelled, so the player can
   * read the cost of the jump without measuring it by hand.
   */
  #drawDistanceLabel(preview, originCenter, teleportDistance, markerRadius) {
    if (!this.previewLabels || !originCenter) {
      return;
    }

    const distance = ScCanvasActivityService.euclideanSceneDistance(originCenter, preview.destination);
    if (!Number.isFinite(distance)) {
      return;
    }

    const units = ScTeleportDestinationApp.#gridUnits();
    const rounded = Math.round(distance);
    const text = teleportDistance > 0
      ? `${rounded} / ${teleportDistance} ${units}`
      : `${rounded} ${units}`;

    const gridSize = Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    const label = new PIXI.Text(text, new PIXI.TextStyle({
      fontFamily: "Signika, sans-serif",
      fontSize: Math.max(Math.round(gridSize * 0.22), 14),
      fill: preview.inRange ? 0xffffff : 0xff6b6b,
      stroke: 0x000000,
      strokeThickness: 4,
      align: "center"
    }));
    label.eventMode = "none";
    label.interactive = false;
    label.anchor?.set?.(0.5, 1);

    // Sit just above the highest landing footprint, falling back to the
    // destination marker when the preview reports no landings.
    let top = preview.destination.y - markerRadius;
    for (const landing of preview.landings ?? []) {
      top = Math.min(top, landing.center.y - (landing.size.height / 2));
    }
    label.x = preview.destination.x;
    label.y = top - Math.round(gridSize * 0.1);
    this.previewLabels.addChild?.(label);
  }

  #clearLabels() {
    this.previewLabels?.removeChildren?.().forEach((child) => child.destroy?.());
  }

  static #gridUnits() {
    const units = String(canvas?.scene?.grid?.units ?? canvas?.grid?.units ?? "").trim();
    return units || "ft";
  }

  async #resolveDestination(event) {
    if (this.isResolvingDestination) {
      return;
    }

    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    if (!origin) {
      return;
    }

    const destination = this.#destinationFromEvent(event);
    if (!destination) {
      return;
    }

    const config = this.#config();
    const originCenter = ScCanvasActivityService.getTokenCenter(origin);
    const distance = ScCanvasActivityService.euclideanSceneDistance(originCenter, destination);
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

    this.#startDestinationSelection();
  }

  #destinationFromEvent(event) {
    const rawPosition = canvas?.canvasCoordinatesFromClient?.(event);
    if (!Number.isFinite(rawPosition?.x) || !Number.isFinite(rawPosition?.y)) {
      return null;
    }
    return this.#config().snapToGrid
      ? ScCanvasActivityService.snapCenterPoint(rawPosition)
      : rawPosition;
  }

  #config() {
    const config = this.activity?.teleport ?? {};
    return {
      teleportDistance: Math.max(0, Number(config.teleportDistance ?? 30) || 0),
      snapToGrid: config.snapToGrid !== false
    };
  }

  #drawWalls(originCenter, rangePixels) {
    const walls = canvas?.walls?.placeables ?? [];
    if (!walls.length || !originCenter) {
      return;
    }

    const CONST = globalThis.CONST;
    const secretDoor = CONST?.WALL_DOOR_TYPES?.SECRET;
    const openState = CONST?.WALL_DOOR_STATES?.OPEN;
    const blockingMove = CONST?.WALL_MOVEMENT_TYPES?.NORMAL;

    const segments = [];
    for (const wall of walls) {
      const document = wall?.document ?? wall;
      const coordinates = document?.c ?? wall?.c;
      if (!Array.isArray(coordinates) || coordinates.length < 4) {
        continue;
      }
      // Never reveal secret doors, and skip passages that are currently open or
      // do not block movement — only mark actual obstacles.
      if (secretDoor !== undefined && document?.door === secretDoor) {
        continue;
      }
      if (openState !== undefined && document?.ds === openState) {
        continue;
      }
      if (blockingMove !== undefined && document?.move !== blockingMove) {
        continue;
      }

      const a = { x: Number(coordinates[0]), y: Number(coordinates[1]) };
      const b = { x: Number(coordinates[2]), y: Number(coordinates[3]) };
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) {
        continue;
      }
      if (Number.isFinite(rangePixels)
        && ScTeleportDestinationApp.#segmentDistanceToPoint(a, b, originCenter) > rangePixels) {
        continue;
      }
      segments.push([a, b]);
    }

    if (!segments.length) {
      return;
    }

    this.previewGraphics.lineStyle(4, 0xff7a45, 0.85);
    for (const [a, b] of segments) {
      this.previewGraphics.moveTo(a.x, a.y);
      this.previewGraphics.lineTo(b.x, b.y);
    }
  }

  static #segmentDistanceToPoint(a, b, point) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared <= 0) {
      return Math.hypot(point.x - a.x, point.y - a.y);
    }

    let t = (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const closest = { x: a.x + (t * dx), y: a.y + (t * dy) };
    return Math.hypot(point.x - closest.x, point.y - closest.y);
  }

  static #markerRadius() {
    const gridSize = Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    return Math.max(Math.round(gridSize * 0.08), 6);
  }

  static #hexToNumber(value, fallback) {
    const parsed = Number.parseInt(String(value ?? "").replace(/^#/, ""), 16);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
