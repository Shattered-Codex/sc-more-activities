import { Constants } from "../../constants/Constants.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { MOVEMENT_TYPES } from "../canvas/ScCanvasActivityConstants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ScMovementPreviewApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-movement-preview-app"],
    tag: "form",
    position: {
      width: 420,
      height: "auto"
    }
  };

  static PARTS = {
    form: {
      template: "modules/sc-more-activities/templates/applications/sc-movement-preview.hbs"
    }
  };

  constructor(activity, options = {}) {
    super({
      window: {
        title: Constants.localize("SCMOREACTIVITIES.Activities.ScMovement.App.Title", "Movement Preview")
      },
      ...options
    });
    this.activity = activity;
    this.requiresMovementChoice = activity?.movement?.type === MOVEMENT_TYPES.EITHER;
    this.movementType = this.requiresMovementChoice ? null : activity?.movement?.type;
    this.originTokenId = ScCanvasActivityService.getOriginTokenDocument(activity)?.id ?? null;
    this.selectedTargetIds = [];
    this.previewTemplate = null;
    this.previewGraphics = null;
    this.isSubmitting = false;
    this.previewError = null;
    this.selfDirectionPoint = null;
    this.isChoosingSelfDirection = false;
    this.canvasPointerDownHandler = null;
    this.canvasPointerUpHandler = null;
    this.#prepopulateTargets();
  }

  async _prepareContext() {
    const preview = this.#previewData();
    if (!preview) {
      return {
        isSubmitting: this.isSubmitting,
        originName: "",
        movementTypeLabel: "",
        movementDistance: 0,
        maxRange: 0,
        rangeLabel: "",
        maxTargets: 0,
        hasRangeLimit: false,
        targetCount: 0,
        eligibleCount: 0,
        targets: [],
        tokenGroups: { selfTokens: [], otherTokens: [] },
        requiresMovementChoice: this.requiresMovementChoice,
        isPush: false,
        isPull: false,
        requiresSelfDirection: false,
        hasSelfDirection: false,
        isChoosingSelfDirection: false,
        canExecute: false,
        blockReason: ""
      };
    }

    const maxRange = preview.config.maxRange;
    const requiresSelfDirection = this.#requiresSelfDirection(preview);
    const canExecute = !this.isSubmitting
      && this.selectedTargetIds.length > 0
      && (!this.requiresMovementChoice || Boolean(this.movementType))
      && (!requiresSelfDirection || Boolean(this.selfDirectionPoint));
    return {
      isSubmitting: this.isSubmitting,
      originName: preview.origin?.name ?? preview.origin?.document?.name ?? "",
      movementTypeLabel: this.requiresMovementChoice && !this.movementType
        ? Constants.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.Type.Choices.Either", "Either")
        : preview.config.type === MOVEMENT_TYPES.PULL
          ? Constants.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.Type.Choices.Pull", "Pull")
          : Constants.localize("SCMOREACTIVITIES.Activities.ScMovement.Fields.Type.Choices.Push", "Push"),
      requiresMovementChoice: this.requiresMovementChoice,
      isPush: this.movementType === MOVEMENT_TYPES.PUSH,
      isPull: this.movementType === MOVEMENT_TYPES.PULL,
      movementDistance: preview.config.distance,
      maxRange,
      rangeLabel: maxRange > 0
        ? String(maxRange)
        : Constants.localize("SCMOREACTIVITIES.Activities.ScMovement.App.Unlimited", "Unlimited"),
      maxTargets: preview.config.maxTargets,
      hasRangeLimit: maxRange > 0,
      targetCount: preview.targets.length,
      eligibleCount: preview.targets.filter((target) => target.inRange).length,
      targets: preview.targets.map((entry, index) => ({
        id: entry.token?.id ?? "",
        index,
        name: entry.token?.name ?? entry.token?.document?.name ?? "",
        distance: Math.round(Number(entry.distance) || 0),
        inRange: entry.inRange,
        statusLabel: entry.inRange
          ? Constants.localize("SCMOREACTIVITIES.Activities.ScMovement.App.InRange", "In range")
          : Constants.localize("SCMOREACTIVITIES.Activities.ScMovement.App.OutOfRange", "Out of range")
      })),
      tokenGroups: this.#availableTokens(preview),
      requiresSelfDirection,
      hasSelfDirection: Boolean(this.selfDirectionPoint),
      isChoosingSelfDirection: this.isChoosingSelfDirection,
      canExecute,
      blockReason: canExecute ? "" : this.#blockReason(requiresSelfDirection)
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    if (this.previewError) {
      ui.notifications?.warn?.(this.previewError?.message ?? String(this.previewError));
      await this.close();
      return;
    }

    this.element.querySelector("select[name='targetId']")?.addEventListener("change", (event) => {
      const tokenId = event.currentTarget.value;
      if (!tokenId) {
        return;
      }
      this.#addTarget(tokenId);
      event.currentTarget.value = "";
    });

    this.element.querySelector(".sc-ma-movement-sync-targets")?.addEventListener("click", () => this.#useCurrentTargets());
    this.element.querySelectorAll("[data-movement-type]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const movementType = event.currentTarget.dataset.movementType;
        if (![MOVEMENT_TYPES.PUSH, MOVEMENT_TYPES.PULL].includes(movementType)) {
          return;
        }
        this.movementType = movementType;
        this.render();
      });
    });
    this.element.querySelector(".sc-ma-movement-choose-self-direction")?.addEventListener("click", () => {
      this.#toggleSelfDirectionSelection();
    });
    this.element.querySelector(".sc-ma-movement-confirm")?.addEventListener("click", () => this.#confirm());
    this.element.querySelector(".sc-ma-movement-cancel")?.addEventListener("click", () => this.close());
    this.element.querySelectorAll(".sc-ma-target-delete").forEach((button) => {
      button.addEventListener("click", (event) => {
        const index = Number(event.currentTarget.dataset.index);
        if (Number.isInteger(index)) {
          this.selectedTargetIds.splice(index, 1);
          this.#syncSelfDirectionState();
          this.render();
        }
      });
    });

    await this.#renderRangePreview();
    this.#drawPreviewState();
  }

  async close(options = {}) {
    this.#stopSelfDirectionSelection();
    this.#destroyPreviewGraphics();
    await super.close(options);
    await ScCanvasActivityService.removePreviewTemplate(this.previewTemplate);
    this.previewTemplate = null;
  }

  #prepopulateTargets() {
    try {
      const preview = ScCanvasActivityService.getMovementPreviewData(this.activity, {
        originTokenId: this.originTokenId,
        movementType: this.movementType
      });
      this.selectedTargetIds = preview.targets.map((entry) => entry.token?.id).filter(Boolean);
      this.previewError = null;
    } catch (error) {
      this.previewError = error;
      this.selectedTargetIds = [];
    }
  }

  #previewData() {
    try {
      this.previewError = null;
      return ScCanvasActivityService.getMovementPreviewData(this.activity, {
        originTokenId: this.originTokenId,
        selfDirectionPoint: this.selfDirectionPoint,
        movementType: this.movementType,
        tokenIds: this.selectedTargetIds,
        useExplicitTokenIds: true
      });
    } catch (error) {
      this.previewError = error;
      return null;
    }
  }

  #availableTokens(preview) {
    const origin = preview?.origin ?? this.#originTokenObject();
    const selected = new Set(this.selectedTargetIds);
    const selfTokens = [];
    const otherTokens = [];

    for (const token of ScCanvasActivityService.getSceneTokens(preview?.scene)) {
      const tokenId = token?.document?.id ?? token?.id ?? "";
      if (!tokenId || selected.has(tokenId) || !ScCanvasActivityService.canMoveToken(token)) {
        continue;
      }

      const distance = origin ? ScCanvasActivityService.sceneDistanceBetweenTokens(origin, token, preview?.scene) : 0;
      const data = {
        id: tokenId,
        name: token?.name ?? token?.document?.name ?? "",
        distance: Math.round(Number(distance) || 0)
      };

      const isOrigin = origin && (origin.id === tokenId || origin.document?.id === tokenId);
      if (isOrigin) {
        selfTokens.push(data);
      } else {
        otherTokens.push(data);
      }
    }

    return { selfTokens, otherTokens };
  }

  #originTokenObject() {
    return ScCanvasActivityService.getOriginTokenObject(this.activity, {
      originTokenId: this.originTokenId
    });
  }

  #addTarget(tokenId) {
    const preview = this.#previewData();
    if (!preview || !tokenId) {
      return;
    }

    if (this.selectedTargetIds.includes(tokenId)) {
      return;
    }

    if (this.selectedTargetIds.length >= preview.config.maxTargets) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.MaximumTargets",
        "Maximum movement targets reached."
      ));
      return;
    }

    this.selectedTargetIds.push(tokenId);
    this.render();
  }

  #useCurrentTargets() {
    const preview = this.#previewData();
    if (!preview) {
      return;
    }

    const selected = [];
    for (const target of Array.from(game?.user?.targets ?? [])) {
      const token = target?.document?.object ?? target;
      const tokenId = token?.document?.id ?? token?.id ?? "";
      if (!tokenId || selected.includes(tokenId) || !ScCanvasActivityService.canMoveToken(token)) {
        continue;
      }
      selected.push(tokenId);
      if (selected.length >= preview.config.maxTargets) {
        break;
      }
    }

    this.selectedTargetIds = selected;
    this.#syncSelfDirectionState();
    this.render();
  }

  async #renderRangePreview() {
    if (this.previewTemplate) {
      return;
    }

    const preview = this.#previewData();
    if (!preview || preview.config.maxRange <= 0) {
      return;
    }

    const originCenter = ScCanvasActivityService.getTokenCenter(preview.origin, preview.scene);
    if (!originCenter) {
      return;
    }

    const previewColors = ModuleSettings.getMovementRangeColors();
    this.previewTemplate = await ScCanvasActivityService.createPreviewTemplate({
      type: "circle",
      x: originCenter.x,
      y: originCenter.y,
      distance: preview.config.maxRange,
      fillColor: previewColors.fillColor,
      borderColor: previewColors.borderColor
    });
  }

  #ensurePreviewGraphics() {
    if (!globalThis.PIXI?.Graphics || this.previewGraphics) {
      return;
    }

    this.previewGraphics = new PIXI.Graphics();
    this.previewGraphics.eventMode = "none";
    this.previewGraphics.interactive = false;
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

  #drawPreviewState() {
    this.#ensurePreviewGraphics();
    if (!this.previewGraphics) {
      return;
    }

    this.previewGraphics.clear();
    const preview = this.#previewData();
    if (!preview) {
      return;
    }

    const movementColors = ModuleSettings.getMovementRangeColors();
    const movementBorder = Number.parseInt(String(movementColors.borderColor ?? "#4da3ff").slice(1), 16);
    const movementFill = Number.parseInt(String(movementColors.fillColor ?? "#8fd3ff").slice(1), 16);

    const originCenter = ScCanvasActivityService.getTokenCenter(preview.origin, preview.scene);
    if (originCenter) {
      const radius = this.#pointMarkerPixelRadius();
      this.previewGraphics.lineStyle(2, 0xf4c542, 0.95);
      this.previewGraphics.beginFill(0xf4c542, 0.3);
      this.previewGraphics.drawCircle(originCenter.x, originCenter.y, radius);
      this.previewGraphics.endFill();
    }

    for (const entry of preview.targets) {
      const currentCenter = entry.currentCenter;
      if (!currentCenter) {
        continue;
      }

      const radius = this.#pointMarkerPixelRadius();
      if (!entry.inRange || !entry.destinationCenter) {
        this.previewGraphics.lineStyle(2, 0xd32f2f, 0.95);
        this.previewGraphics.beginFill(0xffb3b3, 0.25);
        this.previewGraphics.drawCircle(currentCenter.x, currentCenter.y, radius);
        this.previewGraphics.endFill();
        continue;
      }

      this.previewGraphics.lineStyle(3, movementBorder, 0.9);
      this.previewGraphics.moveTo(currentCenter.x, currentCenter.y);
      this.previewGraphics.lineTo(entry.destinationCenter.x, entry.destinationCenter.y);

      this.previewGraphics.lineStyle(2, movementBorder, 0.95);
      this.previewGraphics.beginFill(movementFill, 0.25);
      this.previewGraphics.drawCircle(entry.destinationCenter.x, entry.destinationCenter.y, radius);
      this.previewGraphics.endFill();
    }
  }

  #pointMarkerPixelRadius() {
    const gridSize = Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    return Math.max(Math.round(gridSize * 0.08), 6);
  }

  #blockReason(requiresSelfDirection) {
    if (this.isSubmitting) {
      return "";
    }

    if (!this.selectedTargetIds.length) {
      return Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      );
    }

    if (this.requiresMovementChoice && !this.movementType) {
      return Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.MissingMovementType",
        "Choose whether to push or pull the targets."
      );
    }

    if (requiresSelfDirection && !this.selfDirectionPoint) {
      return Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.MissingSelfDirection",
        "Choose a movement direction for the self target."
      );
    }

    return "";
  }

  #requiresSelfDirection(preview = null) {
    const data = preview ?? this.#previewData();
    const originId = data?.origin?.id ?? "";
    return Boolean(originId && data?.targets?.some((entry) => entry?.token?.id === originId));
  }

  #syncSelfDirectionState() {
    if (this.#requiresSelfDirection()) {
      return;
    }

    this.selfDirectionPoint = null;
    this.#stopSelfDirectionSelection();
  }

  #toggleSelfDirectionSelection() {
    if (this.isChoosingSelfDirection) {
      this.#stopSelfDirectionSelection();
      this.render();
      return;
    }

    this.#startSelfDirectionSelection();
  }

  #startSelfDirectionSelection() {
    const preview = this.#previewData();
    if (!this.#requiresSelfDirection(preview)) {
      return;
    }

    if (this.canvasPointerUpHandler) {
      return;
    }

    this.canvasPointerDownHandler = this.#onCanvasPointerDown.bind(this);
    this.canvasPointerUpHandler = this.#onCanvasPointerUp.bind(this);
    canvas?.app?.view?.addEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
    canvas?.app?.view?.addEventListener?.("pointerup", this.canvasPointerUpHandler, true);
    this.isChoosingSelfDirection = true;
    this.render();
  }

  #stopSelfDirectionSelection() {
    if (this.canvasPointerDownHandler) {
      canvas?.app?.view?.removeEventListener?.("pointerdown", this.canvasPointerDownHandler, true);
      this.canvasPointerDownHandler = null;
    }

    if (this.canvasPointerUpHandler) {
      canvas?.app?.view?.removeEventListener?.("pointerup", this.canvasPointerUpHandler, true);
      this.canvasPointerUpHandler = null;
    }

    this.isChoosingSelfDirection = false;
  }

  #onCanvasPointerDown(event) {
    if (Number(event?.button ?? 0) !== 0) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
  }

  #onCanvasPointerUp(event) {
    if (Number(event?.button ?? 0) !== 0) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();

    const point = this.#eventCanvasPosition(event);
    const origin = this.#originTokenObject();
    const originCenter = origin ? ScCanvasActivityService.getTokenCenter(origin) : null;
    if (!point || !originCenter || Math.hypot(point.x - originCenter.x, point.y - originCenter.y) <= 0) {
      return;
    }

    this.selfDirectionPoint = point;
    this.#stopSelfDirectionSelection();
    this.render();
  }

  #eventCanvasPosition(event) {
    const clientPosition = canvas?.canvasCoordinatesFromClient?.(event);
    if (Number.isFinite(clientPosition?.x) && Number.isFinite(clientPosition?.y)) {
      return clientPosition;
    }

    return null;
  }

  async #confirm() {
    if (this.isSubmitting) {
      return;
    }

    if (!this.selectedTargetIds.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      ));
      return;
    }

    if (this.requiresMovementChoice && !this.movementType) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.MissingMovementType",
        "Choose whether to push or pull the targets."
      ));
      return;
    }

    if (this.#requiresSelfDirection() && !this.selfDirectionPoint) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.MissingSelfDirection",
        "Choose a movement direction for the self target."
      ));
      return;
    }

    this.isSubmitting = true;
    this.render();

    const result = await ScCanvasActivityService.executeMovement(this.activity, {
      originTokenId: this.originTokenId,
      selfDirectionPoint: this.selfDirectionPoint,
      movementType: this.movementType,
      tokenIds: this.selectedTargetIds
    });
    if (result?.ok) {
      await this.close();
      return;
    }

    this.isSubmitting = false;
    this.render();
  }
}
