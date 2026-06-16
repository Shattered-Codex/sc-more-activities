import { Constants } from "../../constants/Constants.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScWallConfig } from "./ScWallConfig.js";
import { ScWallGeometry } from "./ScWallGeometry.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ScWallPlacementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-wall-placement-app"],
    tag: "form",
    position: {
      width: 420,
      height: "auto"
    }
  };

  static PARTS = {
    form: {
      template: "modules/sc-more-activities/templates/applications/sc-wall-placement.hbs"
    }
  };

  constructor(activity, options = {}) {
    super({
      window: {
        title: Constants.localize("SCMOREACTIVITIES.Activities.ScWall.App.Title", "Wall Placement")
      },
      ...options
    });
    this.activity = activity;
    this.config = ScWallConfig.fromActivity(activity);
    this.allWalls = [];
    this.placementPoints = [];
    this.currentLength = 0;
    this.canvasClickHandler = null;
    this.canvasPointerDownHandler = null;
    this.canvasMoveHandler = null;
    this.canvasContextMenuHandler = null;
    this.isPlacing = false;
    this.isSubmitting = false;
    this.hoverPoint = null;
    this.previewGraphics = null;
    this.previewText = null;
    this.placementRangeTemplate = null;
    this.sceneId = canvas?.scene?.id ?? null;
    this.originTokenId = ScCanvasActivityService.getOriginTokenDocument(activity)?.id ?? null;
    this.selectedFacing = this.config.facing === "any" ? "away" : this.config.facing;
    this.pendingCircularDrag = null;
  }

  async _prepareContext() {
    const config = this.#config();
    const committedWallCount = this.#committedWallCount();
    const lengthLabel = config.wallType === "circular"
      ? Constants.localize("SCMOREACTIVITIES.Activities.ScWall.App.Radius", "Radius")
      : Constants.localize("SCMOREACTIVITIES.Activities.ScWall.App.Length", "Length");
    return {
      wallType: config.wallType,
      wallTypeLabel: this.#wallTypeLabel(config.wallType),
      facing: this.selectedFacing,
      maxLength: config.maxLength,
      lengthLabel,
      lengthLimitReached: this.#hasReachedLengthLimit(),
      wallLimitReached: this.#hasReachedWallLimit(),
      currentLength: Math.round(this.currentLength),
      totalLength: Math.round(this.#totalLength()),
      placedPoints: this.placementPoints.length,
      isPlacing: this.isPlacing,
      isSubmitting: this.isSubmitting,
      canChooseFacing: config.facing === "any",
      canFinish: !this.isSubmitting && this.placementPoints.length >= 2,
      canAddMoreWalls: !this.isSubmitting && !this.#hasReachedLengthLimit() && !this.#hasReachedWallLimit() && this.#placedWallCount() < config.maxWalls,
      completedWalls: committedWallCount,
      hasCompletedWalls: this.allWalls.length > 0,
      maxWalls: config.maxWalls,
      isMultipleWalls: config.maxWalls > 1,
      panelSize: config.panelSize,
      maxPanels: config.maxPanels || Constants.localize("SCMOREACTIVITIES.Activities.ScWall.App.Unlimited", "Unlimited"),
      completedWallsData: this.allWalls.map((wall, index) => ({
        index,
        displayIndex: index + 1,
        pointCount: wall.points.length,
        length: Math.round(wall.length),
        measurementLabel: lengthLabel
      })),
      facingOptions: [
        {
          value: "towards",
          label: Constants.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.Facing.Choices.Towards", "Towards origin"),
          selected: this.selectedFacing === "towards"
        },
        {
          value: "away",
          label: Constants.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.Facing.Choices.Away", "Away from origin"),
          selected: this.selectedFacing === "away"
        }
      ]
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    if (!this.#placementSceneIsActive()) {
      await this.close();
      return;
    }

    if (!this.#originTokenObject()) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      await this.close();
      return;
    }

    this.element.querySelector(".sc-ma-wall-place")?.addEventListener("click", () => this.#togglePlacement());
    this.element.querySelector(".sc-ma-wall-facing")?.addEventListener("change", (event) => {
      this.selectedFacing = event.currentTarget.value;
      this.render();
    });
    this.element.querySelector(".sc-ma-wall-next")?.addEventListener("click", () => this.#nextWall());
    this.element.querySelector(".sc-ma-wall-finish")?.addEventListener("click", () => this.#finishWall());
    this.element.querySelector(".sc-ma-wall-clear")?.addEventListener("click", () => this.#clearCurrentWall());
    this.element.querySelector(".sc-ma-wall-cancel")?.addEventListener("click", () => this.close());
    this.element.querySelectorAll(".sc-ma-wall-delete").forEach((button) => {
      button.addEventListener("click", (event) => {
        this.#deleteWall(Number(event.currentTarget.dataset.wallIndex));
      });
    });

    await this.#renderPlacementRangeMarker();
    this.#drawPreviewState();
  }

  async close(options = {}) {
    this.#stopCanvasListener();
    this.#destroyPreviewGraphics();
    await this.#clearPlacementRangeMarker();
    await super.close(options);
  }

  async #togglePlacement() {
    if (!this.#placementSceneIsActive() || this.isSubmitting) {
      return;
    }

    if (this.isPlacing) {
      await this.#stopPlacement();
      return;
    }

    if (this.#hasReachedLengthLimit() || this.#hasReachedWallLimit()) {
      return;
    }

    if (this.canvasClickHandler) {
      this.#stopCanvasListener();
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
    this.render();
  }

  async #stopPlacement() {
    this.#stopCanvasListener();
    this.#drawPreviewState();
    this.render();
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
    this.pendingCircularDrag = null;
    this.hoverPoint = null;
    this.#clearInteractivePreview();
    this.isPlacing = false;
  }

  #onCanvasPointerDown(event) {
    if (!this.isPlacing || this.isSubmitting || !this.#placementSceneIsActive()) {
      return;
    }

    if (Number(event?.button ?? 0) !== 0) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (this.#config().wallType !== "circular" || this.placementPoints.length >= 2) {
      return;
    }

    const point = this.#eventPoint(event);
    if (!point) {
      return;
    }

    const existingPointCount = this.placementPoints.length;

    if (!existingPointCount) {
      const placementIssue = this.#placementIssue(point);
      if (placementIssue) {
        this.#warnPlacementIssue(placementIssue);
        return;
      }

      this.placementPoints = [point];
      this.currentLength = 0;
      this.hoverPoint = point;
    }

    const originPoint = this.placementPoints[0] ?? point;
    this.pendingCircularDrag = {
      existingPointCount,
      originPoint,
      previewStarted: false
    };
    this.#drawPreviewState();
    this.render();
  }

  async #onCanvasClick(event) {
    if (!this.#placementSceneIsActive() || this.isSubmitting) {
      return;
    }

    const originalEvent = event?.data?.originalEvent ?? event;
    if (Number(originalEvent?.button) === 2) {
      originalEvent?.preventDefault?.();
      originalEvent?.stopPropagation?.();
      await this.#stopPlacement();
      return;
    }
    if (Number(originalEvent?.button ?? 0) !== 0) {
      return;
    }

    originalEvent?.preventDefault?.();
    originalEvent?.stopPropagation?.();

    const point = this.#eventPoint(event);
    if (!point) {
      return;
    }

    if (this.pendingCircularDrag) {
      this.#completeCircularDrag(point);
      return;
    }

    this.#placePoint(point);
  }

  async #onCanvasContextMenu(event) {
    if (!this.isPlacing) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
    await this.#stopPlacement();
  }

  #onCanvasMove(event) {
    if (!this.isPlacing || this.isSubmitting || !this.#placementSceneIsActive()) {
      return;
    }

    const point = this.#eventPoint(event);
    if (!point) {
      return;
    }

    if (this.pendingCircularDrag && this.#config().wallType === "circular") {
      const originPoint = this.pendingCircularDrag.originPoint;
      this.pendingCircularDrag.previewStarted = Math.hypot(point.x - originPoint.x, point.y - originPoint.y) >= 4;
    }

    this.hoverPoint = point;
    this.#drawPreviewState();
  }

  async #nextWall() {
    if (this.isSubmitting) {
      return;
    }

    const finished = await this.#finishCurrentWall();
    if (!finished) {
      return;
    }

    this.render();
  }

  async #finishWall() {
    if (this.isSubmitting || !this.#placementSceneIsActive()) {
      return;
    }

    this.isSubmitting = true;
    this.#stopCanvasListener();
    this.render();

    if (this.placementPoints.length >= 2) {
      const finished = await this.#finishCurrentWall();
      if (!finished) {
        this.isSubmitting = false;
        this.render();
        return;
      }
    }

    if (!this.allWalls.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.NoWalls",
        "No walls to create."
      ));
      this.isSubmitting = false;
      this.render();
      return;
    }

    const result = await ScCanvasActivityService.executeWallPlacement(this.activity, {
      facing: this.selectedFacing,
      originTokenId: this.originTokenId,
      walls: this.#wallsForRequest()
    });
    if (result?.ok) {
      await this.close();
      return;
    }

    this.isSubmitting = false;
    this.render();
  }

  async #finishCurrentWall() {
    if (this.placementPoints.length < 2) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.NeedTwoPoints",
        "Need at least two points to create a wall."
      ));
      return false;
    }

    const config = this.#config();
    const segments = this.#calculateSegments(this.placementPoints, config.wallType);
    if (!segments.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.NoSegments",
        "No valid wall segments could be created."
      ));
      return false;
    }

    this.allWalls.push({
      facing: this.selectedFacing,
      length: this.currentLength,
      points: [...this.placementPoints],
      wallCount: this.#wallCountForPoints(this.placementPoints, config.wallType),
      segments
    });
    this.pendingCircularDrag = null;
    this.placementPoints = [];
    this.currentLength = 0;
    return true;
  }

  #deleteWall(index) {
    if (this.isSubmitting || !Number.isInteger(index) || index < 0 || index >= this.allWalls.length) {
      return;
    }

    this.allWalls.splice(index, 1);
    this.render();
  }

  #clearCurrentWall() {
    if (this.isSubmitting) {
      return;
    }

    this.pendingCircularDrag = null;
    this.placementPoints = [];
    this.currentLength = 0;
    this.render();
  }

  #placePoint(point) {
    const placementIssue = this.#placementIssue(point);
    if (placementIssue) {
      this.#warnPlacementIssue(placementIssue);
      return false;
    }

    const config = this.#config();
    const newLength = this.#calculateLength([...this.placementPoints, point], config.wallType);
    this.placementPoints.push(point);
    this.currentLength = newLength;
    this.hoverPoint = point;

    if (config.wallType === "circular" && this.placementPoints.length >= 2) {
      this.#stopCanvasListener();
    } else if (this.#hasReachedLengthLimit() || this.#hasReachedWallLimit()) {
      this.#stopCanvasListener();
    }

    this.#drawPreviewState();
    this.render();
    return true;
  }

  #completeCircularDrag(point) {
    const dragState = this.pendingCircularDrag;
    this.pendingCircularDrag = null;
    if (!dragState) {
      return;
    }

    const originPoint = dragState.originPoint ?? this.placementPoints[0] ?? null;
    if (!originPoint) {
      return;
    }

    if (!dragState.previewStarted) {
      if (dragState.existingPointCount >= 1) {
        this.#placePoint(point);
        return;
      }

      this.hoverPoint = originPoint;
      this.#drawPreviewState();
      this.render();
      return;
    }

    if (this.placementPoints.length < 1) {
      this.placementPoints = [originPoint];
    }
    this.#placePoint(point);
  }

  #warnPlacementIssue(placementIssue) {
    if (placementIssue === "maxLength") {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.MaxLengthExceeded",
        { length: this.#config().maxLength },
        `Adding this point would exceed the maximum wall length of ${this.#config().maxLength}.`
      ));
      return;
    }

    if (placementIssue === "maxWalls") {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.MaxWallsExceeded",
        { count: this.#config().maxWalls },
        `You can place at most ${this.#config().maxWalls} wall(s).`
      ));
      return;
    }

    ui.notifications?.warn?.(Constants.format(
      "SCMOREACTIVITIES.Activities.ScWall.Warning.PointOutOfRange",
      { range: this.#config().referenceRange },
      `Wall point must be within ${this.#config().referenceRange}.`
    ));
  }

  #eventPoint(event) {
    const originalEvent = event?.data?.originalEvent ?? event;
    const rawPosition = canvas?.canvasCoordinatesFromClient?.(originalEvent);
    return ScCanvasActivityService.snapCenterPoint(rawPosition);
  }

  #calculateLength(points, wallType) {
    if (points.length < 2) {
      return 0;
    }

    if (wallType === "circular") {
      return ScCanvasActivityService.sceneDistanceBetweenPoints(points[0], points[1]);
    }

    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      total += ScCanvasActivityService.sceneDistanceBetweenPoints(points[index], points[index + 1]);
    }
    return total;
  }

  async #renderPlacementRangeMarker() {
    const config = this.#config();
    if (config.referenceRange <= 0 || this.placementRangeTemplate) {
      return;
    }

    const originCenter = this.#originCenter();
    if (!originCenter) {
      return;
    }

    const previewColors = ModuleSettings.getWallRangeColors();
    this.placementRangeTemplate = await ScCanvasActivityService.createPreviewTemplate({
      type: "circle",
      x: originCenter.x,
      y: originCenter.y,
      distance: config.referenceRange,
      fillColor: previewColors.fillColor,
      borderColor: previewColors.borderColor
    });
  }

  async #clearPlacementRangeMarker() {
    await ScCanvasActivityService.removePreviewTemplate(this.placementRangeTemplate);
    this.placementRangeTemplate = null;
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
    if (!this.previewText && globalThis.PIXI?.Text && globalThis.PIXI?.TextStyle) {
      this.previewText = new PIXI.Text("", new PIXI.TextStyle({
        fontFamily: "Signika, sans-serif",
        fontSize: 16,
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 4,
        align: "left"
      }));
      this.previewText.eventMode = "none";
      this.previewText.interactive = false;
      this.previewText.visible = false;
      canvas?.stage?.addChild?.(this.previewText);
    }
  }

  #clearInteractivePreview() {
    this.previewGraphics?.clear?.();
    if (this.previewText) {
      this.previewText.visible = false;
      this.previewText.text = "";
    }
  }

  #destroyPreviewGraphics() {
    if (!this.previewGraphics) {
      return;
    }

    this.previewGraphics.parent?.removeChild?.(this.previewGraphics);
    this.previewGraphics.destroy();
    this.previewGraphics = null;
    if (this.previewText) {
      this.previewText.parent?.removeChild?.(this.previewText);
      this.previewText.destroy();
      this.previewText = null;
    }
  }

  #drawPreviewState() {
    this.#ensurePreviewGraphics();
    const graphics = this.previewGraphics;
    if (!graphics) {
      return;
    }

    graphics.clear();
    this.#drawPlacedWalls(graphics);
    this.#drawCurrentPlacement(graphics);

    if (!this.isPlacing || !this.hoverPoint) {
      if (this.previewText) {
        this.previewText.visible = false;
      }
      return;
    }

    const pointIsValid = this.#canPlacePoint(this.hoverPoint);
    const strokeColor = pointIsValid ? 0x1f9d55 : 0xd32f2f;
    const fillColor = pointIsValid ? 0x7ed6a7 : 0xffb3b3;

    graphics.lineStyle(3, strokeColor, 0.9);
    const segments = this.#previewSegments(this.hoverPoint);
    for (const segment of segments) {
      graphics.moveTo(Number(segment.x1) || 0, Number(segment.y1) || 0);
      graphics.lineTo(Number(segment.x2) || 0, Number(segment.y2) || 0);
    }

    if (this.#config().wallType === "circular" && this.placementPoints.length === 1) {
      const center = this.placementPoints[0];
      graphics.lineStyle(2, fillColor, 0.8);
      graphics.moveTo(center.x, center.y);
      graphics.lineTo(this.hoverPoint.x, this.hoverPoint.y);
    }

    const radius = this.#pointMarkerPixelRadius();
    graphics.lineStyle(2, strokeColor, 0.95);
    graphics.beginFill(fillColor, 0.35);
    graphics.drawCircle(this.hoverPoint.x, this.hoverPoint.y, radius);
    graphics.endFill();

    this.#drawDistanceMeter(this.hoverPoint, strokeColor, pointIsValid);
  }

  #drawPlacedWalls(graphics) {
    for (const wall of this.allWalls) {
      this.#drawSegments(graphics, wall.segments, {
        color: 0x95a5a6,
        alpha: 0.85,
        width: 3
      });
      this.#drawPoints(graphics, wall.points, {
        borderColor: 0x7f8c8d,
        fillColor: 0x95a5a6
      });
    }
  }

  #drawCurrentPlacement(graphics) {
    if (!this.placementPoints.length) {
      return;
    }

    if (this.placementPoints.length >= 2) {
      this.#drawSegments(graphics, this.#calculateSegments(this.placementPoints, this.#config().wallType), {
        color: 0x1f9d55,
        alpha: 0.9,
        width: 3
      });
    }

    this.#drawPoints(graphics, this.placementPoints, {
      borderColor: 0x24b86a,
      fillColor: 0x39f08c
    });
  }

  #drawSegments(graphics, segments, { color, alpha = 1, width = 3 } = {}) {
    if (!Array.isArray(segments) || !segments.length) {
      return;
    }

    graphics.lineStyle(width, color, alpha);
    for (const segment of segments) {
      graphics.moveTo(Number(segment.x1) || 0, Number(segment.y1) || 0);
      graphics.lineTo(Number(segment.x2) || 0, Number(segment.y2) || 0);
    }
  }

  #drawPoints(graphics, points, { borderColor, fillColor } = {}) {
    if (!Array.isArray(points) || !points.length) {
      return;
    }

    const radius = this.#pointMarkerPixelRadius();
    graphics.lineStyle(2, borderColor, 0.95);
    graphics.beginFill(fillColor, 0.35);
    for (const point of points) {
      graphics.drawCircle(Number(point.x) || 0, Number(point.y) || 0, radius);
    }
    graphics.endFill();
  }

  #totalLength() {
    return this.allWalls.reduce((total, wall) => total + wall.length, this.currentLength);
  }

  #wallsForRequest() {
    return this.allWalls.map((wall) => ({
      points: wall.points,
      facing: wall.facing
    }));
  }

  #wallTypeLabel(wallType) {
    if (wallType === "circular") {
      return Constants.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.WallType.Choices.Circular", "Circular");
    }
    if (wallType === "panels") {
      return Constants.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.WallType.Choices.Panels", "Panels");
    }
    return Constants.localize("SCMOREACTIVITIES.Activities.ScWall.Fields.WallType.Choices.Continuous", "Continuous");
  }

  #config() {
    return this.config;
  }

  #placementSceneIsActive() {
    if (!this.sceneId || canvas?.scene?.id === this.sceneId) {
      return true;
    }

    ui.notifications?.warn?.(Constants.localize(
      "SCMOREACTIVITIES.Activities.ScWall.Warning.SceneChanged",
      "Wall placement was cancelled because the active scene changed."
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

  #pointWithinPlacementRange(point) {
    const range = this.#config().referenceRange;
    if (range <= 0) {
      return true;
    }

    const originCenter = this.#originCenter();
    if (!originCenter) {
      return false;
    }

    return ScCanvasActivityService.sceneDistanceBetweenPoints(originCenter, point) <= range;
  }

  #canPlacePoint(point) {
    return !this.#placementIssue(point);
  }

  #placementIssue(point) {
    if (!point || !this.#pointWithinPlacementRange(point)) {
      return "range";
    }

    const config = this.#config();
    const projectedPoints = [...this.placementPoints, point];
    const newLength = this.#calculateLength(projectedPoints, config.wallType);
    const priorLength = this.#totalLength() - this.currentLength;
    if (config.maxLength > 0 && newLength + priorLength > config.maxLength) {
      return "maxLength";
    }

    const projectedWallCount = this.#committedWallCount() + this.#wallCountForPoints(projectedPoints, config.wallType);
    if (projectedWallCount > config.maxWalls) {
      return "maxWalls";
    }

    if (config.wallType === "circular" && projectedPoints.length >= 2) {
      const segments = this.#calculateSegments(projectedPoints, config.wallType);
      if (!this.#segmentsWithinPlacementRange(segments)) {
        return "range";
      }
    }

    return null;
  }

  #hasReachedLengthLimit() {
    const maxLength = this.#config().maxLength;
    if (!(maxLength > 0)) {
      return false;
    }

    return this.#totalLength() >= (maxLength - 0.0001);
  }

  #hasReachedWallLimit() {
    return this.#placedWallCount() >= this.#config().maxWalls;
  }

  #placedWallCount() {
    return this.#committedWallCount() + this.#currentProjectedWallCount();
  }

  #committedWallCount() {
    return this.allWalls.reduce((total, wall) => total + Number(wall?.wallCount ?? 0), 0);
  }

  #currentProjectedWallCount() {
    if (this.placementPoints.length < 2) {
      return 0;
    }

    return this.#wallCountForPoints(this.placementPoints, this.#config().wallType);
  }

  #wallCountForPoints(points, wallType) {
    const count = Array.isArray(points) ? points.length : 0;
    if (count < 2) {
      return 0;
    }
    if (wallType === "circular") {
      return 1;
    }
    return Math.max(0, count - 1);
  }

  #previewSegments(point) {
    if (!point || this.placementPoints.length < 1) {
      return [];
    }

    return this.#calculateSegments([...this.placementPoints, point], this.#config().wallType);
  }

  #segmentsWithinPlacementRange(segments) {
    return segments.every((segment) => this.#pointWithinPlacementRange({ x: segment?.x1, y: segment?.y1 })
      && this.#pointWithinPlacementRange({ x: segment?.x2, y: segment?.y2 }));
  }

  #calculateSegments(points, wallType) {
    const config = this.#config();
    return ScWallGeometry.calculateSegments(points, wallType, {
      panelSize: config.panelSize,
      panelSpacing: config.panelSpacing,
      maxPanels: config.maxPanels,
      scene: canvas?.scene
    }).filter((segment) => Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) > 0);
  }

  #drawDistanceMeter(point, strokeColor, pointIsValid) {
    if (!this.previewText || !point || this.placementPoints.length < 1) {
      if (this.previewText) {
        this.previewText.visible = false;
      }
      return;
    }

    const label = this.#distanceMeterLabel(point);
    if (!label) {
      this.previewText.visible = false;
      return;
    }

    this.previewText.text = label;
    this.previewText.visible = true;

    const labelX = Number(point.x) + 18;
    const labelY = Number(point.y) - Number(this.previewText.height) - 18;
    this.previewText.position.set(labelX + 8, labelY + 6);

    const width = Number(this.previewText.width) + 16;
    const height = Number(this.previewText.height) + 12;
    this.previewGraphics.lineStyle(2, strokeColor, 0.95);
    this.previewGraphics.beginFill(pointIsValid ? 0x101418 : 0x2a0f12, 0.9);
    this.previewGraphics.drawRoundedRect(labelX, labelY, width, height, 8);
    this.previewGraphics.endFill();
  }

  #distanceMeterLabel(point) {
    if (!point || this.placementPoints.length < 1) {
      return "";
    }

    const config = this.#config();
    const previewLength = this.#calculateLength([...this.placementPoints, point], config.wallType);
    const priorLength = this.#totalLength() - this.currentLength;
    const totalLength = priorLength + previewLength;
    const lastPoint = this.placementPoints[this.placementPoints.length - 1] ?? null;
    const segmentLength = lastPoint
      ? ScCanvasActivityService.sceneDistanceBetweenPoints(lastPoint, point)
      : previewLength;

    const addText = this.#formatDistanceValue(segmentLength);
    const totalText = this.#formatDistanceValue(totalLength);
    if (config.maxLength > 0) {
      return Constants.format(
        "SCMOREACTIVITIES.Activities.ScWall.App.DistanceMeterWithLimit",
        {
          add: addText,
          limit: this.#formatDistanceValue(config.maxLength),
          total: totalText
        },
        `+${addText}  Total ${totalText}/${this.#formatDistanceValue(config.maxLength)}`
      );
    }
    return Constants.format(
      "SCMOREACTIVITIES.Activities.ScWall.App.DistanceMeter",
      {
        add: addText,
        total: totalText
      },
      `+${addText}  Total ${totalText}`
    );
  }

  #formatDistanceValue(value) {
    const rounded = Math.round((Number(value) || 0) * 10) / 10;
    const locale = game?.i18n?.lang || "en";
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 1,
      minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1
    }).format(rounded);
  }

  #pointMarkerPixelRadius() {
    const gridSize = Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    return Math.max(Math.round(gridSize * 0.08), 6);
  }
}
