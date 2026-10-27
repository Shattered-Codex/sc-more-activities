import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScDocumentWindowMinimizer } from "../../applications/ScDocumentWindowMinimizer.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScRangeShape } from "../canvas/ScRangeShape.js";
import { ScPortalGeometry } from "../portal/ScPortalGeometry.js";

const LANG = "SCMOREACTIVITIES.Activities.ScRecall";
const VALID = { border: 0x24b86a, fill: 0x39f08c };
const INVALID = { border: 0xd32f2f, fill: 0xffb3b3 };

/**
 * Lets the user click where the near side of a recall portal opens, within
 * range of their token, the way the portal activity places its sides: the
 * range is drawn around the token and the portal follows the pointer, green
 * where it may open and red where it may not. Left click places it; right
 * click or Escape cancels.
 *
 * There is no window: the user already confirmed the trip, and a single point
 * is all that is left to choose.
 */
export class ScRecallPortalPlacement {
  /**
   * Resolves with the snapped center the user picked, or `null` when they cancel.
   * @param {object} options
   * @param {Token} options.origin       The user's token, the range's center.
   * @param {number} options.range        Placement range in scene units; 0 means anywhere on the scene.
   * @param {string} options.rangeShape
   * @param {number} options.squares      Portal footprint in squares.
   * @param {string} options.shape        "circle" or "square".
   */
  static pick({ origin, range = 0, rangeShape = "circle", squares = 1, shape = "circle" }) {
    return new Promise((resolve) => {
      new ScRecallPortalPlacement({ origin, range, rangeShape, squares, shape, resolve }).#start();
    });
  }

  /**
   * Why `point` cannot hold the portal: "invalid", "bounds" (off the scene), or
   * "range"; `null` when it can. Used on the user's client and again by the GM.
   */
  static issueFor({ point, originCenter = null, range = 0, rangeShape = "circle", scene = null }) {
    const target = ScPortalGeometry.validPoint(point);
    if (!target) {
      return "invalid";
    }
    const bounds = scene?.dimensions?.sceneRect;
    if (bounds && (target.x < bounds.x || target.y < bounds.y
      || target.x > bounds.x + bounds.width || target.y > bounds.y + bounds.height)) {
      return "bounds";
    }
    if (range > 0 && (!originCenter
      || ScCanvasActivityService.rangeSceneDistance(originCenter, target, rangeShape, scene) > range)) {
      return "range";
    }
    return null;
  }

  #options;
  #resolve;
  #graphics = null;
  #hover = null;
  #minimized = [];
  #handlers = {};

  constructor({ resolve, ...options }) {
    this.#options = options;
    this.#resolve = resolve;
  }

  #start() {
    const view = canvas?.app?.view;
    if (!canvas?.stage || !view) {
      this.#finish(null);
      return;
    }

    this.#minimized = ScDocumentWindowMinimizer.minimizeOpenWindows();
    if (globalThis.PIXI?.Graphics) {
      this.#graphics = new PIXI.Graphics();
      this.#graphics.eventMode = "none";
      canvas.stage.addChild(this.#graphics);
    }

    this.#handlers = {
      move: (event) => this.#onMove(event),
      up: (event) => this.#onClick(event),
      // Captured so the press never reaches the token layer or a portal's own click handler.
      down: (event) => {
        if (Number(event?.button ?? 0) === 0) {
          event.preventDefault?.();
          event.stopPropagation?.();
        }
      },
      context: (event) => {
        event.preventDefault?.();
        this.#finish(null);
      },
      key: (event) => {
        if (event.key === "Escape") {
          event.preventDefault?.();
          event.stopPropagation?.();
          this.#finish(null);
        }
      }
    };
    canvas.stage.on("mousemove", this.#handlers.move);
    canvas.stage.on("mouseup", this.#handlers.up);
    view.addEventListener("pointerdown", this.#handlers.down, true);
    view.addEventListener("contextmenu", this.#handlers.context);
    globalThis.document?.addEventListener?.("keydown", this.#handlers.key, true);

    const { range } = this.#options;
    const units = canvas.scene?.grid?.units || "";
    ui.notifications?.info?.(range > 0
      ? Constants.format(`${LANG}.Placement.InstructionsRange`, { range, units },
        `Click where the portal opens, within ${range} ${units}. Right-click or Escape cancels.`)
      : Constants.localize(`${LANG}.Placement.Instructions`, "Click where the portal opens. Right-click or Escape cancels."));
    this.#draw();
  }

  #onMove(event) {
    this.#hover = this.#pointOf(event);
    this.#draw();
  }

  #onClick(event) {
    const original = event?.data?.originalEvent ?? event;
    if (Number(original?.button ?? 0) !== 0) {
      return;
    }
    const point = this.#pointOf(event);
    const issue = this.#issue(point);
    if (issue) {
      ui.notifications?.warn?.(issue === "range"
        ? Constants.format(`${LANG}.Placement.OutOfRange`, { range: this.#options.range },
          `The portal must open within ${this.#options.range}.`)
        : Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidPosition", "The requested canvas position is invalid."));
      return;
    }
    this.#finish(point);
  }

  #pointOf(event) {
    const original = event?.data?.originalEvent ?? event;
    return ScPortalGeometry.snapCenter(canvas?.canvasCoordinatesFromClient?.(original), {
      scene: canvas?.scene,
      squares: this.#options.squares
    });
  }

  #issue(point) {
    return ScRecallPortalPlacement.issueFor({
      point,
      originCenter: this.#originCenter(),
      range: this.#options.range,
      rangeShape: this.#options.rangeShape,
      scene: canvas?.scene
    });
  }

  #originCenter() {
    return this.#options.origin ? ScCanvasActivityService.getTokenCenter(this.#options.origin) : null;
  }

  #draw() {
    const graphics = this.#graphics;
    if (!graphics) {
      return;
    }
    graphics.clear();
    const colors = ModuleSettings.getPortalRangeColors();
    ScRangeShape.drawPreview(graphics, {
      center: this.#originCenter(),
      distance: this.#options.range,
      rangeShape: this.#options.rangeShape,
      scene: canvas?.scene,
      borderColor: colors.borderColor,
      fillColor: colors.fillColor
    });
    if (!this.#hover) {
      return;
    }

    const { border, fill } = this.#issue(this.#hover) ? INVALID : VALID;
    const radius = ScPortalGeometry.radiusPixels(this.#options.squares, canvas?.scene);
    graphics.lineStyle(3, border, 0.95);
    graphics.beginFill(fill, 0.3);
    if (this.#options.shape === "square") {
      graphics.drawRect(this.#hover.x - radius, this.#hover.y - radius, radius * 2, radius * 2);
    } else {
      graphics.drawCircle(this.#hover.x, this.#hover.y, radius);
    }
    graphics.endFill();
  }

  #finish(point) {
    try {
      canvas?.stage?.off?.("mousemove", this.#handlers.move);
      canvas?.stage?.off?.("mouseup", this.#handlers.up);
      canvas?.app?.view?.removeEventListener?.("pointerdown", this.#handlers.down, true);
      canvas?.app?.view?.removeEventListener?.("contextmenu", this.#handlers.context);
      globalThis.document?.removeEventListener?.("keydown", this.#handlers.key, true);
      if (this.#graphics) {
        this.#graphics.parent?.removeChild?.(this.#graphics);
        this.#graphics.destroy();
        this.#graphics = null;
      }
      ScDocumentWindowMinimizer.restoreWindows(this.#minimized);
    } catch (error) {
      Logger.debug("Could not clean up the recall portal placement.", error);
    }
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(point);
  }
}
