import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScDeferredItemDestroy } from "../ScDeferredItemDestroy.js";
import { ScChatRelay } from "../../support/ScChatRelay.js";
import { ScRecallArrivalCamera } from "./ScRecallArrivalCamera.js";
import { ScRecallPlacement } from "./ScRecallPlacement.js";
import { ScRecallRange } from "./ScRecallRange.js";

const KIND = "recall";
const LANG = "SCMOREACTIVITIES.Activities.ScRecall";
const MAX_TRAVELLERS = 50;

/**
 * Moves the user's token, and the companions they chose, to the activity's
 * destination: a Region on any scene, or beside the NPC the user's character
 * calls home.
 *
 * Travel to another scene creates the tokens there and deletes the originals,
 * which only a GM may do, so a player's request goes to the GM through
 * `ScChatRelay`. Either way the same checks run, from the stored activity and
 * documents only: the user owns the activity, the first token is the
 * activity's own actor, every companion is within range (and on the same side
 * when the activity says so), and a home is a token that may be one.
 */
export class ScRecallTravel {
  /** Tail of the travel queue (see `queue`). */
  static #queue = Promise.resolve();

  static registerHandler() {
    ScChatRelay.registerHandler(KIND, ScRecallTravel.#handle);
  }

  /** Whether `token` may be bound as a home under this activity. */
  static isRecallPoint(token, activity) {
    const document = token?.document ?? token;
    if (document?.flags?.[Constants.MODULE_ID]?.recallPoint === true) {
      return true;
    }
    return activity?.recall?.homeSource === "any"
      && document?.actor?.type === "npc"
      && document.actor.hasPlayerOwner !== true;
  }

  /** The home bound on `actor`, as stored: `{ tokenUuid, name, sceneName }`, or `null`. */
  static homeOf(actor) {
    const home = actor?.flags?.[Constants.MODULE_ID]?.recallHome;
    return home?.tokenUuid ? home : null;
  }

  /**
   * Where the activity sends its user's actor: `{ kind: "region", region, scene, label }`,
   * `{ kind: "home", anchor, scene, label }`, or `{ error }` naming why there is none.
   */
  static async resolveDestination(activity, actor) {
    if (activity?.recall?.mode === "home") {
      const home = ScRecallTravel.homeOf(actor);
      if (!home) {
        return { error: "no-home" };
      }
      const anchor = await ScRecallTravel.#fromUuid(home.tokenUuid);
      if (!ScRecallTravel.#is(anchor, "Token") || !anchor.parent || !ScRecallTravel.isRecallPoint(anchor, activity)) {
        return { error: "home-lost" };
      }
      return { kind: "home", anchor, scene: anchor.parent, label: ScRecallTravel.#label(anchor.name, anchor.parent) };
    }

    const region = await ScRecallTravel.#fromUuid(activity?.recall?.regionUuid);
    if (!ScRecallTravel.#is(region, "Region") || !region.parent) {
      return { error: "no-region" };
    }
    return { kind: "region", region, scene: region.parent, label: ScRecallTravel.#label(region.name, region.parent) };
  }

  /** Asks the GM to run `execute` for this user. Resolves with `{ status, answer }` or `null`. */
  static request({ actor, destinationLabel, data }) {
    return ScChatRelay.request(KIND, {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: ScRecallTravel.chatCardContent({ status: "pending", actor, destinationLabel }),
      data
    });
  }

  /**
   * Runs `task` after every travel queued before it, failed or not. A token
   * sent two ways at once would otherwise pass both checks before either
   * moved it, and be copied to both destinations. Each travel looks its
   * tokens up again once its turn comes, so the later one finds them gone or
   * moved. One queue rather than one per token, because a travel takes its
   * companions along; portal crossings wait in it too.
   */
  static queue(task) {
    const current = ScRecallTravel.#queue.then(task);
    ScRecallTravel.#queue = current.catch(() => {});
    return current;
  }

  /**
   * Validates the request and travels, in its turn (see `queue`). `data` is
   * `{ activityUuid, travellerUuids }`, the user's own token first. Returns
   * `{ status, ... }` where status is "travelled", "blocked" (nobody fit at
   * the destination), or "refused".
   */
  static execute(user, data = {}) {
    return ScRecallTravel.queue(() => ScRecallTravel.#execute(user, data));
  }

  static async #execute(user, data) {
    const refused = { status: "refused" };
    const activity = await ScRecallTravel.#fromUuid(data.activityUuid);
    if (String(activity?.type ?? "") !== ACTIVITY_TYPES.RECALL || !ScRecallTravel.canUseActivity(activity, user)) {
      return refused;
    }

    const actor = activity.actor ?? activity.item?.actor ?? null;
    const travellers = await ScRecallTravel.#travellers(activity, actor, data.travellerUuids, user);
    const destination = travellers ? await ScRecallTravel.resolveDestination(activity, actor) : null;
    if (!travellers || !destination || destination.error) {
      return refused;
    }

    // The scroll is spent and the request checked: it must not ride along on an unlinked token.
    await ScDeferredItemDestroy.discardSpent(activity);
    const [main] = travellers;
    const originScene = main.parent;
    const arrivals = destination.kind === "region"
      ? await ScRecallTravel.#toRegion(destination.region, travellers)
      : await ScRecallTravel.#besideAnchor(destination.anchor, travellers);
    const arrived = arrivals.map(({ to }) => to);
    const outcome = {
      actor,
      destinationLabel: destination.label,
      sceneUuid: destination.scene.uuid ?? null,
      travelled: arrived.length
    };
    if (!arrived.length) {
      return { status: "blocked", ...outcome };
    }

    // Marked before anyone is pulled across, so the mark is there when their new scene loads.
    await Promise.all(arrived.map((token) => ScRecallArrivalCamera.mark(token, user)));
    ScRecallTravel.bringViewers(arrived, originScene, destination.scene, user, {
      follow: arrivals.some(({ from }) => from === main)
    });
    return { status: "travelled", ...outcome };
  }

  /** The chat card for a recall: `status` is "pending", "travelled", "blocked", or "refused". */
  static chatCardContent({ status, actor = null, destinationLabel = "", travelled = 1 } = {}) {
    const name = actor?.name ?? "";
    const companions = Math.max(0, (Number(travelled) || 1) - 1);
    let text = "";
    if (status === "pending") {
      text = Constants.format(`${LANG}.Card.Pending`, { actor: name, destination: destinationLabel },
        `${name} is travelling to ${destinationLabel}…`);
    } else if (status === "travelled") {
      text = companions
        ? Constants.format(`${LANG}.Card.TravelledWith`, { actor: name, count: companions, destination: destinationLabel },
          `${name} and ${companions} companion(s) travelled to ${destinationLabel}.`)
        : Constants.format(`${LANG}.Card.Travelled`, { actor: name, destination: destinationLabel },
          `${name} travelled to ${destinationLabel}.`);
    } else if (status === "blocked") {
      text = Constants.format(`${LANG}.Card.Blocked`, { actor: name, destination: destinationLabel },
        `There was no room for ${name} at ${destinationLabel}.`);
    } else {
      text = Constants.localize(`${LANG}.Card.Refused`, "The recall was refused.");
    }
    return `<div class="sc-ma-recall-card"><p>${ScRecallTravel.#escape(text)}</p></div>`;
  }

  static async #handle({ user, data }) {
    const outcome = await ScRecallTravel.execute(user, data);
    return {
      status: outcome.status,
      content: ScRecallTravel.chatCardContent(outcome),
      answer: { travelled: outcome.travelled ?? 0, sceneUuid: outcome.sceneUuid ?? null }
    };
  }

  /**
   * The tokens to move, the user's own first. Companions must share its scene,
   * be within the activity's range, be visible unless a GM asked, and be on
   * its side when the activity only takes allies.
   */
  static async #travellers(activity, actor, uuids, user) {
    const list = Array.isArray(uuids) ? [...new Set(uuids.map(String))] : [];
    if (!list.length || list.length > MAX_TRAVELLERS) {
      return null;
    }

    const tokens = await Promise.all(list.map((uuid) => ScRecallTravel.#fromUuid(uuid)));
    const [origin, ...companions] = tokens;
    if (!ScRecallTravel.#is(origin, "Token") || !origin.parent || !ScRecallTravel.isActorToken(origin, actor)) {
      return null;
    }

    const range = Math.max(0, Number(activity.recall?.allyRange) || 0);
    if (companions.length && range <= 0) {
      return null;
    }
    const alliesOnly = activity.recall?.allyFilter !== "any";
    const valid = companions.every((token) => ScRecallTravel.#is(token, "Token")
      && token.parent === origin.parent
      && (user?.isGM || token.hidden !== true)
      && (!alliesOnly || token.disposition === origin.disposition)
      && ScRecallRange.between(origin, token, activity.recall?.rangeShape, origin.parent) <= range);
    return valid ? tokens : null;
  }

  /** Core teleports into a Region, finding a spot inside it and crossing scenes as needed. */
  /** Each token that made it, as `{ from, to }`: the token sent and the token that arrived. */
  static async #toRegion(region, tokens) {
    const arrived = [];
    for (const token of tokens) {
      try {
        arrived.push({ from: token, to: await region.teleportToken(token) });
      } catch (error) {
        Logger.warn(`Could not bring ${token.name} into the recall region.`, error);
      }
    }
    return arrived;
  }

  static async #besideAnchor(anchor, tokens) {
    const scene = anchor.parent;
    const leaving = new Set(tokens.filter((token) => token.parent === scene).map((token) => token.id));
    const spots = ScRecallPlacement.findSpots(scene, anchor, tokens, { ignoreIds: leaving });
    const arrived = [];
    for (const [index, token] of tokens.entries()) {
      const spot = spots[index];
      if (!spot) {
        Logger.warn(`No free square beside ${anchor.name} for ${token.name}.`);
        continue;
      }
      try {
        arrived.push({ from: token, to: await ScRecallTravel.placeToken(token, scene, spot) });
      } catch (error) {
        Logger.warn(`Could not bring ${token.name} beside ${anchor.name}.`, error);
      }
    }
    return arrived;
  }

  /**
   * Moves `token` to `spot` on `scene`, the same steps as core's
   * RegionDocument#teleportToken: a displacement on its own scene, otherwise a
   * copy created there and the original deleted. Returns the token at its new place.
   */
  static async placeToken(token, scene, spot) {
    if (token.parent === scene) {
      if (typeof token.move === "function") {
        await token.move({ x: spot.x, y: spot.y, action: "displace" });
      } else {
        await token.update({ x: spot.x, y: spot.y }, { animate: false });
      }
      return token;
    }

    const data = token.toObject();
    data.x = spot.x;
    data.y = spot.y;
    if (scene.tokens?.has?.(token.id)) {
      delete data._id;
    }
    const created = await foundry.documents.TokenDocument.implementation.create(data, { parent: scene, keepId: true });
    if (!created) {
      throw new Error(`Could not create ${token.name} on ${scene.name}.`);
    }
    await token.delete({ replacements: { [token.id]: created.uuid } });
    return created;
  }

  /**
   * Takes the owners of the tokens that arrived along to the new scene, as core
   * does for its Teleport Token behavior, when they were watching the scene
   * those tokens left. Only tokens that actually made it count: the owner of a
   * companion left behind stays where their token is, and so does the user
   * whose own token could not travel. `follow` says the requester's own token
   * arrived, which is what moves a requester on this client to the new scene.
   */
  static bringViewers(arrived, originScene, destinationScene, requester, { follow = false } = {}) {
    if (!destinationScene || destinationScene === originScene || !arrived?.length) {
      return;
    }
    // The user who travelled on this client follows only their own token: a
    // companion arriving alone is no reason to leave the scene they are on.
    if (follow && requester?.id === game?.user?.id && originScene?.isView) {
      destinationScene.view?.();
    }

    const viewers = new Set();
    for (const token of arrived) {
      for (const user of game?.users ?? []) {
        if (user?.active && !user.isGM && token?.actor?.testUserPermission?.(user, "OWNER")) {
          viewers.add(user);
        }
      }
    }
    for (const user of viewers) {
      if (user.id !== game?.user?.id && user.viewedScene === originScene?.id) {
        game.socket?.emit?.("pullToScene", destinationScene.id, user.id);
      }
    }
  }


  static isActorToken(token, actor) {
    return Boolean(actor) && (token.actor === actor || (Boolean(actor.uuid) && token.actor?.uuid === actor.uuid));
  }

  static canUseActivity(activity, user) {
    if (user?.isGM) {
      return true;
    }
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const item = activity?.item ?? null;
    return Boolean(
      actor?.testUserPermission?.(user, "OWNER")
      || item?.testUserPermission?.(user, "OWNER")
    );
  }

  static #label(name, scene) {
    return scene?.name ? `${name ?? ""} (${scene.name})` : String(name ?? "");
  }

  static #is(document, documentName) {
    return document?.documentName === documentName || document?.constructor?.documentName === documentName;
  }

  static async #fromUuid(uuid) {
    if (!uuid || typeof globalThis.fromUuid !== "function") {
      return null;
    }
    try {
      return await globalThis.fromUuid(uuid);
    } catch (error) {
      Logger.warn("Could not resolve sc-recall UUID.", error);
      return null;
    }
  }

  static #escape(value) {
    const text = String(value ?? "");
    const foundryUtils = globalThis.foundry?.utils;
    if (typeof foundryUtils?.escapeHTML === "function") {
      return foundryUtils.escapeHTML(text);
    }
    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[char]));
  }
}
