import { Constants } from "../../constants/Constants.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { ScDocumentWindowMinimizer } from "../../applications/ScDocumentWindowMinimizer.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScCanvasResultCard } from "../canvas/ScCanvasResultCard.js";
import { ScSaveRequestCard } from "../canvas/ScSaveRequestCard.js";
import { ScTargetSaveService } from "../canvas/ScTargetSaveService.js";
import { Logger } from "../../support/Logger.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ScTeleportDestinationApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Pixels to stop short of a wall so the sight ray does not hit it. */
  static #SIGHT_EPSILON = 2;

  /** Upper bound on sight tests per wall, so a scene-long wall stays cheap. */
  static #MAX_WALL_SAMPLES = 24;

  /** Sampling budget spread over the candidate walls; every wall keeps at least one test. */
  static #MAX_TOTAL_SAMPLES = 1500;

  /** Hard ceiling on walls the sweep-per-sample fallback will even attempt. */
  static #MAX_FALLBACK_SWEEPS = 1500;

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
    this.staticGraphics = null;
    this.previewLabels = null;
    this.wallSegmentsCache = null;
    this.staticSignature = null;
    this.wallChangeHooks = null;
    this.pendingWallRedraw = null;
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
      this.minimizedWindows = ScDocumentWindowMinimizer.minimizeOpenWindows(this);
    }
    this.#startDestinationSelection();
  }

  async close(options = {}) {
    this.#stopDestinationSelection();
    this.#destroyPreviewGraphics();
    ScDocumentWindowMinimizer.restoreWindows(this.minimizedWindows ?? []);
    this.minimizedWindows = null;
    await super.close(options);
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

    this.#watchWallChanges();
    this.#drawPreview();
  }

  /**
   * A wall edited mid-selection has to invalidate the marks. The cache cannot
   * notice it on its own — moving a wall, opening a door, or flipping one to
   * secret leaves the placeable count untouched — and a stale mark would keep
   * drawing a wall that just became secret.
   */
  #watchWallChanges() {
    const hooks = globalThis.Hooks;
    if (typeof hooks?.on !== "function" || this.wallChangeHooks) {
      return;
    }
    const invalidate = () => this.#invalidateWallMarks();
    this.wallChangeHooks = ["createWall", "updateWall", "deleteWall"]
      .map((event) => ({ event, id: hooks.on(event, invalidate) }));
  }

  /**
   * Drops the cached marks and repaints on the next frame. The hooks fire once
   * per document, so importing a map or dragging a selection of walls would
   * otherwise drive a full recompute per wall; coalescing collapses the burst
   * into a single pass.
   */
  #invalidateWallMarks() {
    this.wallSegmentsCache = null;
    this.staticSignature = null;
    if (this.pendingWallRedraw !== null) {
      return;
    }

    const schedule = globalThis.requestAnimationFrame;
    if (typeof schedule !== "function") {
      this.#drawPreview();
      return;
    }
    this.pendingWallRedraw = schedule(() => {
      this.pendingWallRedraw = null;
      this.#drawPreview();
    });
  }

  #unwatchWallChanges() {
    const hooks = globalThis.Hooks;
    for (const { event, id } of this.wallChangeHooks ?? []) {
      hooks?.off?.(event, id);
    }
    this.wallChangeHooks = null;
    if (this.pendingWallRedraw !== null) {
      globalThis.cancelAnimationFrame?.(this.pendingWallRedraw);
      this.pendingWallRedraw = null;
    }
  }

  #stopDestinationSelection() {
    this.#unwatchWallChanges();
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
    // The range ring and the wall marks only change when the origin token or
    // the walls do, so they live in their own Graphics and survive a redraw.
    // Rebuilding that geometry on every pointer move would re-emit a line per
    // wall — thousands of them on a large scene — for a marker that did not
    // move a pixel. Added first so the destination marker draws on top.
    if (!this.staticGraphics) {
      this.staticGraphics = new PIXI.Graphics();
      this.staticGraphics.eventMode = "none";
      this.staticGraphics.interactive = false;
      canvas?.stage?.addChild?.(this.staticGraphics);
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
    this.wallSegmentsCache = null;
    this.staticSignature = null;
    if (this.previewLabels) {
      this.previewLabels.parent?.removeChild?.(this.previewLabels);
      this.previewLabels.destroy({ children: true });
      this.previewLabels = null;
    }
    if (this.staticGraphics) {
      this.staticGraphics.parent?.removeChild?.(this.staticGraphics);
      this.staticGraphics.destroy();
      this.staticGraphics = null;
    }
    if (!this.previewGraphics) {
      return;
    }
    this.previewGraphics.parent?.removeChild?.(this.previewGraphics);
    this.previewGraphics.destroy();
    this.previewGraphics = null;
  }

  /**
   * Redraws the range ring and the wall marks, but only when something they
   * depend on actually changed. A pointer move does not.
   */
  #drawStatic(originCenter, rangePixels, borderColor, fillColor) {
    const signature = `${originCenter?.x}:${originCenter?.y}:${rangePixels}:${borderColor}:${fillColor}`;
    if (this.staticSignature === signature) {
      return;
    }
    this.staticSignature = signature;

    this.staticGraphics.clear();
    if (Number.isFinite(rangePixels) && rangePixels > 0 && originCenter) {
      this.staticGraphics.lineStyle(2, borderColor, 0.9);
      this.staticGraphics.beginFill(fillColor, 0.12);
      this.staticGraphics.drawCircle(originCenter.x, originCenter.y, rangePixels);
      this.staticGraphics.endFill();
    }
    this.#drawWalls(originCenter, rangePixels);
  }

  #drawPreview() {
    this.#ensurePreviewGraphics();
    if (!this.previewGraphics || !this.staticGraphics) {
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

    this.#drawStatic(originCenter, rangePixels, borderColor, fillColor);

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
      // With a save gate configured, nothing teleports now: the request card
      // in chat collects the native saving throws and its button teleports
      // whoever failed. Without one, the teleport runs immediately as always.
      if (this.#requiresSaveGate()) {
        const request = await ScSaveRequestCard.postTeleportRequest(this.activity, {
          originTokenId: ScCanvasActivityService.getOriginTokenDocument(this.activity)?.id ?? null,
          tokenIds: this.selectedTargets.map((target) => target.id),
          destination
        });
        if (request.posted) {
          await this.close();
          return;
        }
        if (request.reason !== "no-targets") {
          // An invalid DC or a posting failure never falls back to teleporting
          // the targets without the configured saving throw.
          return;
        }
      }

      const tokenIds = this.selectedTargets.map((target) => target.id);
      const sentEntries = this.#tokenEntries(tokenIds);
      const result = await ScCanvasActivityService.executeTeleportPlacement(this.activity, {
        tokenIds,
        destination
      });
      if (result?.ok) {
        await ScCanvasResultCard.createTeleportCard(this.activity, {
          affected: ScCanvasResultCard.affectedEntries(sentEntries, result.skipped),
          skipped: result.skipped ?? []
        });
        await this.close();
        return;
      }
    } finally {
      this.isResolvingDestination = false;
    }

    this.#startDestinationSelection();
  }

  #requiresSaveGate() {
    const config = this.activity?.teleport ?? {};
    if (config.onlyTargetSelf || !ScTargetSaveService.isEnabled(config.save)) {
      return false;
    }
    const originId = ScCanvasActivityService.getOriginTokenDocument(this.activity)?.id ?? null;
    return this.selectedTargets.some((target) => target.id !== originId);
  }

  #tokenEntries(tokenIds) {
    return (tokenIds ?? [])
      .map((id) => canvas?.scene?.tokens?.get?.(id))
      .filter(Boolean)
      .map((token) => ScCanvasResultCard.tokenEntry(token));
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
    const segments = this.#visibleWallSegments(originCenter, rangePixels);
    if (!segments.length) {
      return;
    }

    this.staticGraphics.lineStyle(4, 0xff7a45, 0.85);
    for (const [a, b] of segments) {
      this.staticGraphics.moveTo(a.x, a.y);
      this.staticGraphics.lineTo(b.x, b.y);
    }
  }

  /**
   * The wall stretches the marker may show, memoized for the whole selection:
   * the sight tests below are far too costly to redo on every pointer move, and
   * nothing they depend on changes while the origin token stands still.
   */
  #visibleWallSegments(originCenter, rangePixels) {
    const walls = canvas?.walls?.placeables ?? [];
    if (!walls.length || !originCenter) {
      return [];
    }

    const signature = `${originCenter.x}:${originCenter.y}:${rangePixels}:${walls.length}`;
    if (this.wallSegmentsCache?.signature === signature) {
      return this.wallSegmentsCache.segments;
    }

    const candidates = ScTeleportDestinationApp.#collectWallSegments(walls, originCenter, rangePixels);
    const probe = ScTeleportDestinationApp.#sightProbe(originCenter);
    const segments = ScTeleportDestinationApp.#filterToVisible(candidates, originCenter, probe);
    this.wallSegmentsCache = { signature, segments };
    return segments;
  }

  static #filterToVisible(candidates, originCenter, probe) {
    if (!probe) {
      // Core exposes no sight backend at all (headless run, or a core old
      // enough to have no vision to respect): mark the obstacles rather than
      // dropping the guidance entirely.
      return candidates;
    }

    // Without the sight polygon each sample costs a full sweep, and the budget
    // below still keeps one per wall. Past this many walls that is seconds of a
    // frozen canvas, and marking them all instead would reveal exactly what the
    // marks exist to hide — so the marks are dropped and the picker stays usable.
    if (probe.kind === "collision" && candidates.length > ScTeleportDestinationApp.#MAX_FALLBACK_SWEEPS) {
      Logger.warn(
        `Skipped the teleport wall marks: ${candidates.length} walls are in range and this core build offers `
        + "no sight polygon to test them against."
      );
      return [];
    }

    const maxSamples = ScTeleportDestinationApp.#sampleBudget(candidates.length);
    return candidates
      .flatMap(([a, b]) => ScTeleportDestinationApp.#visibleParts(a, b, originCenter, maxSamples, probe.test));
  }

  /**
   * Answers "can the origin token see this point?" as cheaply as core allows.
   *
   * The sight polygon already is the region the token can see, so one sweep up
   * front turns every later sample into a containment test. Asking
   * testCollision per sample instead means a sweep per sample, which a teleport
   * with no range limit multiplies by every wall on the scene.
   */
  static #sightProbe(originCenter) {
    const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.sight;
    if (!backend || !originCenter) {
      return null;
    }

    if (typeof backend.create === "function") {
      try {
        const polygon = backend.create(originCenter, { type: "sight" });
        // A degenerate sweep would report everything as hidden and silently
        // drop the marks, so it has to be a real polygon before we trust it.
        if (typeof polygon?.contains === "function" && Number(polygon.points?.length) >= 6) {
          return { kind: "polygon", test: (point) => polygon.contains(point.x, point.y) };
        }
      } catch {
        // Fall through to the per-sample form.
      }
    }
    if (typeof backend.testCollision === "function") {
      return {
        kind: "collision",
        test: (point) => !backend.testCollision(originCenter, point, { type: "sight", mode: "any" })
      };
    }
    return null;
  }

  /**
   * How finely a single wall may be sampled, spread over the candidate walls so
   * a crowded scene degrades to whole-wall visibility instead of per-stretch.
   * Not a ceiling on the total: every candidate keeps at least one test, so no
   * obstacle goes unchecked. Normal ranged teleports never reach the budget.
   */
  static #sampleBudget(candidateCount) {
    if (candidateCount <= 0) {
      return ScTeleportDestinationApp.#MAX_WALL_SAMPLES;
    }
    const budget = Math.floor(ScTeleportDestinationApp.#MAX_TOTAL_SAMPLES / candidateCount);
    return Math.min(Math.max(budget, 1), ScTeleportDestinationApp.#MAX_WALL_SAMPLES);
  }

  static #collectWallSegments(walls, originCenter, rangePixels) {
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

    return segments;
  }

  /**
   * Splits a wall into the stretches the origin token can actually see. Marking
   * the whole wall would trace the outline of rooms and corridors the token has
   * never looked into, so a wall the sweep cannot reach is left unmarked and a
   * partly hidden one is drawn only up to where sight stops.
   */
  static #visibleParts(a, b, originCenter, maxSamples, probe) {
    const steps = ScTeleportDestinationApp.#wallSampleCount(a, b, maxSamples);
    const parts = [];
    let runStart = null;
    for (let step = 0; step < steps; step += 1) {
      const from = ScTeleportDestinationApp.#lerp(a, b, step / steps);
      const to = ScTeleportDestinationApp.#lerp(a, b, (step + 1) / steps);
      if (ScTeleportDestinationApp.#canSee(originCenter, ScTeleportDestinationApp.#lerp(from, to, 0.5), probe)) {
        runStart ??= from;
        continue;
      }
      if (runStart) {
        parts.push([runStart, from]);
        runStart = null;
      }
    }
    if (runStart) {
      parts.push([runStart, b]);
    }

    return parts;
  }

  static #canSee(originCenter, point, probe) {
    // The sample sits on the wall itself, which is the boundary of what can be
    // seen, so step just short of it before asking.
    const distance = Math.hypot(point.x - originCenter.x, point.y - originCenter.y);
    if (distance <= ScTeleportDestinationApp.#SIGHT_EPSILON) {
      return true;
    }
    const ratio = (distance - ScTeleportDestinationApp.#SIGHT_EPSILON) / distance;
    const target = ScTeleportDestinationApp.#lerp(originCenter, point, ratio);

    try {
      if (!probe(target)) {
        return false;
      }
    } catch {
      return true;
    }

    // In sight of the token is not the same as on screen: a stretch sitting in
    // the dark or in unexplored fog is still something the player cannot see.
    const visibility = canvas?.visibility;
    if (typeof visibility?.testVisibility !== "function") {
      return true;
    }
    try {
      return visibility.testVisibility(target) !== false;
    } catch {
      return true;
    }
  }

  static #wallSampleCount(a, b, maxSamples) {
    const gridSize = Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(length / Math.max(gridSize / 2, 1));
    return Math.min(Math.max(steps, 1), maxSamples);
  }

  static #lerp(a, b, ratio) {
    return {
      x: a.x + ((b.x - a.x) * ratio),
      y: a.y + ((b.y - a.y) * ratio)
    };
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
