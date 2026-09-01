import { Constants } from "../../constants/Constants.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { ScDocumentWindowMinimizer } from "../../applications/ScDocumentWindowMinimizer.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScRangeShape } from "../canvas/ScRangeShape.js";
import { ScPortalConfig } from "./ScPortalConfig.js";
import { ScPortalGeometry } from "./ScPortalGeometry.js";
import { ScPortalService } from "./ScPortalService.js";
import { Logger } from "../../support/Logger.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SIDE_COLORS = {
  entry: { border: 0x24b86a, fill: 0x39f08c },
  exit: { border: 0x3d7bd6, fill: 0x8fd3ff }
};
const INVALID_COLORS = { border: 0xd32f2f, fill: 0xffb3b3 };
const LINK_COLOR = 0x8a63d2;

export class ScPortalPlacementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-portal-placement-app"],
    tag: "form",
    position: {
      width: 420,
      height: "auto"
    }
  };

  static PARTS = {
    form: {
      template: "modules/sc-more-activities/templates/applications/sc-portal-placement.hbs"
    }
  };

  constructor(activity, options = {}) {
    const { settlement = null, ...applicationOptions } = options;
    super({
      window: {
        title: Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.App.Title", "Portal Placement")
      },
      ...applicationOptions
    });
    this.activity = activity;
    this.settlement = settlement;
    this.config = ScPortalConfig.fromActivity(activity);
    this.points = [];
    this.hoverPoint = null;
    this.isPlacing = false;
    this.isSubmitting = false;
    this.isClosing = false;
    this.canvasClickHandler = null;
    this.canvasPointerDownHandler = null;
    this.canvasMoveHandler = null;
    this.canvasContextMenuHandler = null;
    this.previewGraphics = null;
    this.previewLabels = null;
    this.minimizedWindows = null;
    this.hasPannedToOrigin = false;
    this.sceneId = canvas?.scene?.id ?? null;
    this.originTokenId = ScCanvasActivityService.getOriginTokenDocument(activity)?.id ?? null;
    // Snapping is meaningless without a grid; the flag is resolved once here so
    // the preview, the created region and the later travel all agree.
    this.gridless = ScPortalGeometry.isGridless(canvas?.scene);
    this.snapToGrid = this.config.snapToGrid && !this.gridless;
  }

  async _prepareContext() {
    const [entry, exit] = this.points;
    return {
      isPlacing: this.isPlacing,
      isSubmitting: this.isSubmitting,
      hasEntry: Boolean(entry),
      hasExit: Boolean(exit),
      canConfirm: Boolean(entry && exit) && !this.isSubmitting,
      canClear: this.points.length > 0 && !this.isSubmitting,
      placementRange: this.config.placementRange,
      hasPlacementRange: this.config.placementRange > 0,
      linkRange: this.config.linkRange === "" ? null : this.config.linkRange,
      hasLinkRange: this.config.linkRange !== "" && this.config.linkRange > 0,
      linkDistance: entry && exit
        ? Math.round(ScCanvasActivityService.rangeSceneDistance(
          entry,
          exit,
          this.config.rangeShape,
          canvas?.scene
        ))
        : 0,
      rangeUnits: ScPortalPlacementApp.#gridUnits(),
      originName: this.#originTokenObject()?.name
        ?? this.#originTokenObject()?.document?.name
        ?? "",
      hasOriginName: Boolean(this.#originTokenObject()),
      size: ScPortalPlacementApp.#squareLabel(this.config.squares),
      shapeLabel: this.#shapeLabel(),
      oneWay: this.config.oneWay,
      maxUses: this.config.maxUses === ""
        ? Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.App.Unlimited", "Unlimited")
        : this.config.maxUses,
      durationRounds: this.config.durationRounds,
      hasDuration: this.config.durationRounds > 0,
      snapToGrid: this.snapToGrid,
      snapDisabledByGrid: this.config.snapToGrid && this.gridless
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    if (!this.#placementSceneIsActive()) {
      // Not awaited: render holds the ApplicationV2 semaphore and close() waits
      // for it, so awaiting here deadlocks and leaves the window stuck open.
      this.close();
      return;
    }

    if (this.config.placementRange > 0 && !this.#originTokenObject()) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      this.close();
      return;
    }

    if (this.minimizedWindows === null) {
      this.minimizedWindows = ScDocumentWindowMinimizer.minimizeOpenWindows(this);
      if (this.config.snapToGrid && this.gridless) {
        ui.notifications?.info?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScPortal.Warning.GridlessScene",
          "This scene has no grid, so the portal is placed exactly where you click."
        ));
      }
    }

    this.element.querySelector(".sc-ma-portal-place")?.addEventListener("click", () => this.#togglePlacement());
    this.element.querySelector(".sc-ma-portal-clear")?.addEventListener("click", () => this.#clearPoints());
    this.element.querySelector(".sc-ma-portal-confirm")?.addEventListener("click", () => this.#confirm());
    this.element.querySelector(".sc-ma-portal-cancel")?.addEventListener("click", () => this.close());

    this.#panToOrigin();
    this.#drawPreviewState();
  }

  /**
   * The range is measured from the activity's actor token, which needs no
   * selection to resolve and may therefore be nowhere near what the user is
   * looking at. Bringing it into view is what makes that legible; without it
   * the range circle is off screen and every click just reads as rejected.
   */
  #panToOrigin() {
    if (this.hasPannedToOrigin || this.config.placementRange <= 0) {
      return;
    }
    this.hasPannedToOrigin = true;

    const originCenter = this.#originCenter();
    if (!originCenter || this.#pointIsOnScreen(originCenter)) {
      return;
    }

    try {
      canvas?.animatePan?.({ x: originCenter.x, y: originCenter.y, duration: 250 });
    } catch (error) {
      Logger.debug("Could not pan to the portal origin token.", error);
    }
  }

  #pointIsOnScreen(point) {
    const screenPoint = canvas?.stage?.toGlobal?.(point);
    if (!screenPoint) {
      // Without a stage there is nothing to pan, so treat it as already visible.
      return true;
    }

    const width = globalThis.window?.innerWidth ?? 0;
    const height = globalThis.window?.innerHeight ?? 0;
    const margin = 120;
    return screenPoint.x >= margin && screenPoint.x <= width - margin
      && screenPoint.y >= margin && screenPoint.y <= height - margin;
  }

  async close(options = {}) {
    // Backing out of the placement must stop a chain waiting on it.
    this.settlement?.cancelIfPending("portal-canceled");
    // Flagged before the first await so a submission still in flight knows not
    // to re-render a window that is already going away.
    this.isClosing = true;
    this.#stopCanvasListener();
    this.#destroyPreviewGraphics();
    ScDocumentWindowMinimizer.restoreWindows(this.minimizedWindows ?? []);
    this.minimizedWindows = null;
    await super.close(options);
  }

  async #togglePlacement() {
    if (!this.#placementSceneIsActive() || this.isSubmitting) {
      return;
    }

    if (this.isPlacing) {
      this.#stopCanvasListener();
      this.#drawPreviewState();
      this.render();
      this.#expandWindow();
      return;
    }

    if (this.points.length >= 2) {
      return;
    }

    this.canvasClickHandler = this.#onCanvasClick.bind(this);
    this.canvasPointerDownHandler = this.#onCanvasPointerDown.bind(this);
    this.canvasMoveHandler = this.#onCanvasMove.bind(this);
    this.canvasContextMenuHandler = this.#onCanvasContextMenu.bind(this);
    canvas?.stage?.on?.("mouseup", this.canvasClickHandler);
    canvas?.stage?.on?.("mousemove", this.canvasMoveHandler);
    canvas?.app?.view?.addEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
    canvas?.app?.view?.addEventListener?.("contextmenu", this.canvasContextMenuHandler);
    this.isPlacing = true;
    this.#ensurePreviewGraphics();
    await this.render();
    this.#collapseWindow();
  }

  /**
   * The window sits over the very canvas the user is about to click, so it
   * gets out of the way while placing and comes back once both sides are down
   * or placing stops, which is when the Open portal button matters again.
   */
  #collapseWindow() {
    if (!this.isPlacing || this.isClosing || this.minimized) {
      return;
    }
    Promise.resolve(this.minimize?.()).catch((error) => {
      Logger.debug("Could not minimize the portal placement window.", error);
    });
  }

  #expandWindow() {
    if (this.isClosing || !this.minimized) {
      return;
    }
    Promise.resolve(this.maximize?.()).catch((error) => {
      Logger.debug("Could not restore the portal placement window.", error);
    });
  }

  #stopCanvasListener() {
    if (this.canvasClickHandler) {
      canvas?.stage?.off?.("mouseup", this.canvasClickHandler);
      this.canvasClickHandler = null;
    }
    if (this.canvasPointerDownHandler) {
      canvas?.app?.view?.removeEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
      this.canvasPointerDownHandler = null;
    }
    if (this.canvasMoveHandler) {
      canvas?.stage?.off?.("mousemove", this.canvasMoveHandler);
      this.canvasMoveHandler = null;
    }
    if (this.canvasContextMenuHandler) {
      canvas?.app?.view?.removeEventListener?.("contextmenu", this.canvasContextMenuHandler);
      this.canvasContextMenuHandler = null;
    }
    this.hoverPoint = null;
    this.isPlacing = false;
  }

  /**
   * Consumes the press itself so the click never reaches the token layer, and
   * so the module's own portal click handler stays quiet while placing.
   */
  #onCanvasPointerDown(event) {
    if (!this.isPlacing || this.isSubmitting || !this.#placementSceneIsActive()) {
      return;
    }
    if (Number(event?.button ?? 0) !== 0) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
  }

  #onCanvasClick(event) {
    if (!this.isPlacing || this.isSubmitting || !this.#placementSceneIsActive()) {
      return;
    }

    const originalEvent = event?.data?.originalEvent ?? event;
    if (Number(originalEvent?.button ?? 0) !== 0) {
      return;
    }

    originalEvent?.preventDefault?.();
    originalEvent?.stopPropagation?.();

    const point = this.#eventPoint(event);
    if (!point) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidPosition",
        "The requested canvas position is invalid."
      ));
      return;
    }

    this.#placePoint(point);
  }

  #onCanvasContextMenu(event) {
    if (!this.isPlacing) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
    this.#stopCanvasListener();
    this.#drawPreviewState();
    this.render();
    this.#expandWindow();
  }

  #onCanvasMove(event) {
    if (!this.isPlacing || this.isSubmitting || !this.#placementSceneIsActive()) {
      return;
    }

    const point = this.#eventPoint(event);
    if (!point) {
      return;
    }

    this.hoverPoint = point;
    this.#drawPreviewState();
  }

  #placePoint(point) {
    const issue = this.#placementIssue(point);
    if (issue) {
      this.#warnPlacementIssue(issue);
      return;
    }

    this.points.push(point);
    this.hoverPoint = point;
    if (this.points.length >= 2) {
      this.#stopCanvasListener();
      this.#expandWindow();
    }
    this.#drawPreviewState();
    this.render();
  }

  #clearPoints() {
    if (this.isSubmitting) {
      return;
    }

    this.points = [];
    this.hoverPoint = null;
    this.#drawPreviewState();
    this.render();
  }

  async #confirm() {
    if (this.isSubmitting || this.points.length < 2 || !this.#placementSceneIsActive()) {
      return;
    }

    this.isSubmitting = true;
    this.#stopCanvasListener();
    this.render();

    try {
      const [entry, exit] = this.points;
      const result = await ScPortalService.createPortal(this.activity, {
        entry,
        exit,
        originTokenId: this.originTokenId
      });
      if (result?.ok) {
        // Settled before the close, so a chain resumes on the operation
        // itself rather than on the reporting that follows it.
        this.settlement?.complete({
          canceled: false,
          activity: { canceled: false, portalCount: result.count ?? 0, skipped: result.skipped ?? [] }
        });
        ui.notifications?.info?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScPortal.Info.Created",
          "The portal is open."
        ));
        await this.close();
        return;
      }
      if (result?.message) {
        ui.notifications?.warn?.(result.message);
      }
    } finally {
      // A refused placement or a throw from the service both leave the window
      // open, so it has to become usable again instead of staying locked
      // behind the submitting flag with every button disabled.
      if (!this.isClosing) {
        this.isSubmitting = false;
        this.render();
      }
    }
  }

  #eventPoint(event) {
    const originalEvent = event?.data?.originalEvent ?? event;
    const rawPosition = canvas?.canvasCoordinatesFromClient?.(originalEvent);
    return ScPortalGeometry.snapCenter(rawPosition, {
      snapToGrid: this.snapToGrid,
      scene: canvas?.scene,
      squares: this.config.squares
    });
  }

  #placementIssue(point) {
    return ScPortalPlacementApp.placementIssueFor({
      point,
      originCenter: this.#originCenter(),
      placementRange: this.config.placementRange,
      entryPoint: this.points.length === 1 ? this.points[0] : null,
      linkRange: this.config.linkRange,
      rangeShape: this.config.rangeShape,
      scene: canvas?.scene
    });
  }

  /**
   * Classifies a candidate point. Kept static and free of instance state so the
   * rules can be exercised without standing up an application.
   */
  static placementIssueFor({
    point = null,
    originCenter = null,
    placementRange = 0,
    entryPoint = null,
    linkRange = "",
    rangeShape = "circle",
    scene = null
  } = {}) {
    if (!point) {
      return "invalid";
    }

    if (placementRange > 0) {
      if (!originCenter) {
        return "origin";
      }
      if (ScCanvasActivityService.rangeSceneDistance(originCenter, point, rangeShape, scene) > placementRange) {
        return "range";
      }
    }

    if (entryPoint && linkRange !== "" && linkRange > 0
      && ScCanvasActivityService.rangeSceneDistance(entryPoint, point, rangeShape, scene) > linkRange) {
      return "linkRange";
    }

    return null;
  }

  #warnPlacementIssue(issue) {
    if (issue === "origin") {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      return;
    }
    if (issue === "linkRange") {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.LinkTooFar",
        { range: this.config.linkRange },
        `The two portal sides must be within ${this.config.linkRange} of each other.`
      ));
      return;
    }
    if (issue === "range") {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.OutOfRange",
        { range: this.config.placementRange },
        `The portal must be placed within ${this.config.placementRange}.`
      ));
      return;
    }

    ui.notifications?.warn?.(Constants.localize(
      "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidPosition",
      "The requested canvas position is invalid."
    ));
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
      this.#clearLabels();
      this.previewLabels.parent?.removeChild?.(this.previewLabels);
      this.previewLabels.destroy();
      this.previewLabels = null;
    }
    if (!this.previewGraphics) {
      return;
    }

    this.previewGraphics.parent?.removeChild?.(this.previewGraphics);
    this.previewGraphics.destroy();
    this.previewGraphics = null;
  }

  #drawPreviewState() {
    this.#ensurePreviewGraphics();
    const graphics = this.previewGraphics;
    if (!graphics) {
      return;
    }

    graphics.clear();
    this.#clearLabels();
    const originCenter = this.#originCenter();
    const colors = ModuleSettings.getPortalRangeColors();
    ScRangeShape.drawPreview(graphics, {
      center: originCenter,
      distance: this.config.placementRange,
      rangeShape: this.config.rangeShape,
      scene: canvas?.scene,
      borderColor: colors.borderColor,
      fillColor: colors.fillColor
    });
    const radius = ScPortalGeometry.radiusPixels(this.config.squares, canvas?.scene);
    const [entry, exit] = this.points;
    if (entry && !exit && this.config.linkRange !== "") {
      ScRangeShape.drawPreview(graphics, {
        center: entry,
        distance: this.config.linkRange,
        rangeShape: this.config.rangeShape,
        scene: canvas?.scene,
        borderColor: colors.borderColor,
        fillColor: colors.fillColor,
        borderAlpha: 0.75,
        fillAlpha: 0.08
      });
    }
    const entryLabel = Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Side.Entry", "Entry");
    const exitLabel = Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Side.Exit", "Exit");

    if (entry) {
      this.#drawSide(graphics, entry, radius, SIDE_COLORS.entry);
      this.#drawLabel(entry, radius, entryLabel, SIDE_COLORS.entry.fill);
    }
    if (exit) {
      this.#drawSide(graphics, exit, radius, SIDE_COLORS.exit);
      this.#drawLabel(exit, radius, exitLabel, SIDE_COLORS.exit.fill);
    }
    if (entry && exit) {
      this.#drawLink(graphics, entry, exit, radius, LINK_COLOR, 0.8);
    }

    if (!this.isPlacing || !this.hoverPoint || this.points.length >= 2) {
      return;
    }

    // The hover preview wears the colours and name of the side it will become,
    // so the user always knows which one the next click places.
    const valid = !this.#placementIssue(this.hoverPoint);
    const sideColors = valid ? (entry ? SIDE_COLORS.exit : SIDE_COLORS.entry) : INVALID_COLORS;
    this.#drawSide(graphics, this.hoverPoint, radius, sideColors);
    this.#drawLabel(this.hoverPoint, radius, entry ? exitLabel : entryLabel, sideColors.fill);
    if (entry) {
      this.#drawLink(graphics, entry, this.hoverPoint, radius, valid ? LINK_COLOR : INVALID_COLORS.border, 0.6);
    }
  }

  /** A line from the edge of one side to the edge of the other, with an arrowhead pointing at the exit. */
  #drawLink(graphics, from, to, radius, color, alpha) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    if (Math.hypot(to.x - from.x, to.y - from.y) <= radius * 2) {
      return;
    }

    const start = { x: from.x + (Math.cos(angle) * radius), y: from.y + (Math.sin(angle) * radius) };
    const tip = { x: to.x - (Math.cos(angle) * radius), y: to.y - (Math.sin(angle) * radius) };
    graphics.lineStyle(2, color, alpha);
    graphics.moveTo(start.x, start.y);
    graphics.lineTo(tip.x, tip.y);

    const size = Math.max(10, radius * 0.3);
    const spread = 0.45;
    graphics.lineStyle(0);
    graphics.beginFill(color, alpha);
    graphics.moveTo(tip.x, tip.y);
    graphics.lineTo(tip.x - (Math.cos(angle - spread) * size), tip.y - (Math.sin(angle - spread) * size));
    graphics.lineTo(tip.x - (Math.cos(angle + spread) * size), tip.y - (Math.sin(angle + spread) * size));
    graphics.closePath();
    graphics.endFill();
  }

  #drawLabel(center, radius, text, color) {
    if (!this.previewLabels) {
      return;
    }

    const gridSize = ScPortalGeometry.gridSize(canvas?.scene);
    const label = new PIXI.Text(text, new PIXI.TextStyle({
      fontFamily: "Signika, sans-serif",
      fontSize: Math.max(Math.round(gridSize * 0.22), 14),
      fill: color,
      stroke: 0x000000,
      strokeThickness: 4,
      align: "center"
    }));
    label.eventMode = "none";
    label.interactive = false;
    label.anchor?.set?.(0.5, 1);
    label.x = center.x;
    label.y = center.y - radius - Math.round(gridSize * 0.08);
    this.previewLabels.addChild(label);
  }

  #clearLabels() {
    this.previewLabels?.removeChildren?.().forEach((child) => child.destroy?.());
  }

  #drawSide(graphics, center, radius, { border: borderColor, fill: fillColor }) {
    graphics.lineStyle(3, borderColor, 0.95);
    graphics.beginFill(fillColor, 0.3);
    if (this.config.shape === "circle") {
      graphics.drawCircle(center.x, center.y, radius);
    } else {
      graphics.drawRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    }
    graphics.endFill();
  }

  #shapeLabel() {
    return this.config.shape === "circle"
      ? Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Fields.Shape.Choices.Circle", "Circle")
      : Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Fields.Shape.Choices.Square", "Square");
  }

  #placementSceneIsActive() {
    if (!this.sceneId || canvas?.scene?.id === this.sceneId) {
      return true;
    }

    ui.notifications?.warn?.(Constants.localize(
      "SCMOREACTIVITIES.Activities.ScPortal.Warning.SceneChanged",
      "Portal placement was cancelled because the active scene changed."
    ));
    return false;
  }

  #originTokenObject() {
    return ScCanvasActivityService.getOriginTokenObject(this.activity, {
      originTokenId: this.originTokenId
    });
  }

  #originCenter() {
    const origin = this.#originTokenObject();
    return origin ? ScCanvasActivityService.getTokenCenter(origin) : null;
  }

  /** Language-neutral footprint label, such as "2×2". */
  static #squareLabel(squares) {
    const count = ScPortalGeometry.squareCount(squares);
    return `${count}×${count}`;
  }

  static #gridUnits() {
    return String(canvas?.scene?.grid?.units ?? "").trim();
  }
}
