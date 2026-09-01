import { ScActivityResultTracker } from "../ScActivityResultTracker.js";

/**
 * Keeps a canvas activity's usage open until its placement window finishes.
 *
 * A canvas activity returns from `use()` as soon as it opens its window, so a
 * chain used to run the next step while the user was still placing — and ran it
 * even when the placement was cancelled. This holds the usage open and settles
 * it once, from whichever window ends the flow.
 *
 * Teleport hands off between two windows, so a settlement can be transferred:
 * the window that hands over stops being responsible for cancelling it.
 */
export class ScCanvasUsageSettlement {
  #usage;
  #settled = false;

  constructor(usage) {
    this.#usage = usage ?? null;
  }

  /**
   * Starts holding the usage open. Returns null when the usage is not tracked
   * — a direct click rather than a chain — so callers stay untouched by this.
   */
  static begin(usage) {
    return ScActivityResultTracker.awaitAsyncResult(usage)
      ? new ScCanvasUsageSettlement(usage)
      : null;
  }

  get settled() {
    return this.#settled;
  }

  /** Settles with a result, so the chain reads what the placement did. */
  complete(partial = {}) {
    if (this.#settled) {
      return false;
    }
    this.#settled = true;
    ScActivityResultTracker.completeAsyncResult(this.#usage, partial);
    return true;
  }

  /** Settles as cancelled, which is what stops a chain with `stopOnCancel`. */
  cancel(reason = "canvas-canceled") {
    if (this.#settled) {
      return false;
    }
    this.#settled = true;
    ScActivityResultTracker.cancelUsage(this.#usage, reason);
    return true;
  }

  /**
   * Hands responsibility to the next window. The caller keeps a settled
   * instance so its own close no longer cancels anything, and the returned
   * instance is the live one.
   */
  transfer() {
    if (this.#settled) {
      return null;
    }
    this.#settled = true;
    return new ScCanvasUsageSettlement(this.#usage);
  }

  /**
   * Cancels only if nothing settled it yet; safe to call from every close
   * path, including the window's X button.
   */
  cancelIfPending(reason = "canvas-canceled") {
    return this.cancel(reason);
  }
}
