import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const FLAG = "recallArrival";

/**
 * Brings each owner's camera to their token after a recall moves it.
 *
 * The GM moves the tokens and pulls their owners to the new scene, but a
 * pulled client opens that scene at its initial view, and nobody can move
 * another user's camera. So the GM marks every token that arrives, and each
 * owner's client pans to it: right away when they are already looking at its
 * scene, or once the scene they were pulled to has loaded. A GM owns every
 * token, so a GM's camera only follows the trips that GM took.
 */
export class ScRecallArrivalCamera {
  /** A mark older than this is from an earlier trip, not one to follow now. */
  static FRESH_MS = 120000;

  /** Arrivals this client already panned to, so a scene reload does not pan again. */
  static #seen = new Set();

  static registerHooks() {
    Hooks.on("updateToken", (token, changes) => ScRecallArrivalCamera.#onUpdateToken(token, changes));
    Hooks.on("canvasReady", () => ScRecallArrivalCamera.#onCanvasReady());
  }

  /**
   * Marks `token` as having just arrived. Runs on the client that moved it;
   * `requester` is the user whose trip it was.
   */
  static async mark(token, requester = null) {
    try {
      await token?.update?.({
        [`flags.${Constants.MODULE_ID}.${FLAG}`]: { id: foundry.utils.randomID(), at: Date.now(), by: requester?.id ?? null }
      });
    } catch (error) {
      // The token already stands where it should; following it is a nicety.
      Logger.debug("Could not mark the recall arrival.", error);
    }
  }

  static #onUpdateToken(token, changes) {
    if (!foundry.utils.hasProperty(changes ?? {}, `flags.${Constants.MODULE_ID}.${FLAG}`)) {
      return;
    }
    if (token?.parent === canvas?.scene && ScRecallArrivalCamera.#isFreshArrival(token)) {
      ScRecallArrivalCamera.#panTo(token);
    }
  }

  static #onCanvasReady() {
    const tokens = canvas?.scene?.tokens?.contents ?? [];
    const arrivals = tokens.filter((token) => ScRecallArrivalCamera.#isFreshArrival(token));
    if (!arrivals.length) {
      return;
    }
    // The user's own character first, then whichever arrived last.
    const character = game?.user?.character ?? null;
    const target = arrivals.find((token) => character && token.actor === character)
      ?? arrivals.sort((left, right) => ScRecallArrivalCamera.#arrival(right).at - ScRecallArrivalCamera.#arrival(left).at)[0];
    for (const token of arrivals) {
      ScRecallArrivalCamera.#seen.add(ScRecallArrivalCamera.#arrival(token).id);
    }
    ScRecallArrivalCamera.#panTo(target);
  }

  static #isFreshArrival(token) {
    const arrival = ScRecallArrivalCamera.#arrival(token);
    // A GM owns every token, so a GM only follows a trip they took themselves.
    const follows = game?.user?.isGM ? arrival?.by === game.user.id : token.isOwner === true;
    return Boolean(arrival?.id)
      && follows
      && !ScRecallArrivalCamera.#seen.has(arrival.id)
      && Math.abs(Date.now() - (Number(arrival.at) || 0)) <= ScRecallArrivalCamera.FRESH_MS;
  }

  static #arrival(token) {
    return token?.flags?.[Constants.MODULE_ID]?.[FLAG] ?? null;
  }

  static #panTo(token) {
    const arrival = ScRecallArrivalCamera.#arrival(token);
    if (arrival?.id) {
      ScRecallArrivalCamera.#seen.add(arrival.id);
    }
    const size = Number(token.parent?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    const x = (Number(token.x) || 0) + (((Number(token.width) || 1) * size) / 2);
    const y = (Number(token.y) || 0) + (((Number(token.height) || 1) * size) / 2);
    try {
      canvas?.animatePan?.({ x, y, duration: 400 });
    } catch (error) {
      Logger.debug("Could not pan to the recall arrival.", error);
    }
  }
}
