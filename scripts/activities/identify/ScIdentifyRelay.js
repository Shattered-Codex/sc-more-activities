import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScIdentifyActivityService } from "./ScIdentifyActivityService.js";

const FLAG = "identifyRequest";

/**
 * Identifies an item on an actor the user cannot write to (another player's
 * character, an NPC) by asking the active GM.
 *
 * The request is a chat message rather than a user query: the server only
 * lets a player create a message as themselves, so its author is the
 * authenticated sender on Foundry v13 too, where a query handler is not told
 * who sent it. The same message is the card everyone sees, first as pending,
 * then updated by the GM with the outcome.
 *
 * The GM trusts nothing but the author and the stored activity: it re-derives
 * the item's DC and the range, and rolls the check itself, since a total sent
 * by the player could be anything. The player, in turn, only accepts an answer
 * the server reports as written by a GM, since the request's author can edit
 * its flags as well.
 */
export class ScIdentifyRelay {
  static registerHooks() {
    Hooks.on("createChatMessage", ScIdentifyRelay.#onCreateMessage);
  }

  static isAvailable() {
    return Boolean(ScIdentifyRelay.#activeGm());
  }

  static TIMEOUT_MS = 30000;

  /**
   * Posts the request and waits for the GM's answer: the request flag with its
   * final `status` ("identified", "failed", or "refused") and `check`, or
   * `null` when no answer arrives in time.
   */
  static async request({ activity, identifier, candidate, origin, item }) {
    const request = {
      status: "pending",
      activityUuid: activity?.uuid ?? null,
      recipientUuid: ScIdentifyRelay.#tokenUuid(candidate.token) ?? candidate.actor?.uuid ?? null,
      originUuid: ScIdentifyRelay.#tokenUuid(origin),
      itemId: item.id
    };

    // The id is chosen here so the answer can be awaited before the request
    // exists: no answer can slip in unobserved, and none has to be read back
    // from the message without knowing who wrote it.
    const messageId = foundry.utils.randomID();
    const answer = ScIdentifyRelay.#awaitAnswer(messageId);
    try {
      await ChatMessage.create({
        _id: messageId,
        speaker: ChatMessage.getSpeaker({ actor: identifier }),
        content: ScIdentifyActivityService.chatCardContent({
          status: "pending",
          identifier,
          owner: candidate.actor,
          item
        }),
        flags: { [Constants.MODULE_ID]: { [FLAG]: request } }
      }, { keepId: true });
    } catch (error) {
      Logger.error("Could not post the sc-identify request.", error);
      answer.cancel();
    }
    return answer.promise;
  }

  /**
   * Resolves with the first answer a GM writes to message `messageId`. The
   * player authors the request and may edit its flags too, so an update only
   * counts when the server reports a GM as the user who made it.
   */
  static #awaitAnswer(messageId) {
    let cancel = null;
    const promise = new Promise((resolve) => {
      let hookId = null;
      let timer = null;
      const finish = (answer) => {
        Hooks.off("updateChatMessage", hookId);
        clearTimeout(timer);
        resolve(answer);
      };
      cancel = () => finish(null);

      hookId = Hooks.on("updateChatMessage", (message, _changes, _options, userId) => {
        if (message?.id !== messageId || game?.users?.get?.(userId)?.isGM !== true) {
          return;
        }
        const request = ScIdentifyRelay.#requestOf(message);
        if (request && request.status !== "pending") {
          finish(request);
        }
      });
      timer = setTimeout(() => finish(null), ScIdentifyRelay.TIMEOUT_MS);
    });
    return { promise, cancel };
  }

  static async #onCreateMessage(message) {
    const request = ScIdentifyRelay.#requestOf(message);
    if (request?.status !== "pending" || ScIdentifyRelay.#activeGm()?.id !== game?.user?.id) {
      return;
    }

    let outcome = null;
    try {
      outcome = await ScIdentifyRelay.#process(message, request);
    } catch (error) {
      Logger.error("Could not execute a relayed sc-identify request.", error);
      outcome = { status: "refused" };
    }

    try {
      await message.update({
        content: ScIdentifyActivityService.chatCardContent(outcome),
        [`flags.${Constants.MODULE_ID}.${FLAG}`]: { ...request, status: outcome.status, check: outcome.check ?? null }
      });
    } catch (error) {
      Logger.error("Could not answer the sc-identify request.", error);
    }
  }

  static async #process(message, request) {
    // Set by the server to the user who created the message. A GM never
    // relays, so a GM-authored request is not one this flow produced.
    const user = message.author;
    const refused = { status: "refused" };
    if (!user || user.isGM) {
      return refused;
    }

    const activity = await ScIdentifyRelay.#fromUuid(request.activityUuid);
    if (String(activity?.type ?? "") !== ACTIVITY_TYPES.IDENTIFY || !ScIdentifyRelay.#canUseActivity(activity, user)) {
      return refused;
    }

    const identifier = activity.actor ?? activity.item?.actor ?? null;
    const owner = await ScIdentifyRelay.#requestedRecipient(activity, identifier, request);
    const item = ScIdentifyActivityService.unidentifiedItems(owner)
      .find((entry) => entry.id === String(request.itemId ?? ""));
    if (!identifier || !item) {
      return refused;
    }

    let check = null;
    if (ScIdentifyActivityService.isCheckEnabled(activity.check)) {
      const dc = ScIdentifyActivityService.dcForItem(activity, item);
      const roll = await ScIdentifyActivityService.rollCheck(identifier, activity.check, dc, { configure: false });
      if (!roll) {
        return refused;
      }
      check = { dc, total: Number(roll.total) || 0 };
      if (check.total < dc) {
        return { status: "failed", identifier, owner, item, check };
      }
    }

    await item.update({ "system.identified": true });
    return { status: "identified", identifier, owner, item, check };
  }

  /**
   * The actor the request may touch. Other creatures are always sent as token
   * UUIDs, so the request can only reach an actor placed on a scene, and that
   * token must be within range of the identifier's own token.
   */
  static async #requestedRecipient(activity, identifier, request) {
    const mode = activity?.recipient;
    if (mode !== "target" && mode !== "choose") {
      return identifier;
    }

    const token = await ScIdentifyRelay.#fromUuid(request.recipientUuid);
    if (!ScIdentifyRelay.#isToken(token)) {
      return null;
    }
    return await ScIdentifyRelay.#withinRange(activity, identifier, token, request.originUuid)
      ? token.actor ?? null
      : null;
  }

  static async #withinRange(activity, identifier, token, originUuid) {
    const range = ScIdentifyActivityService.rangeOf(activity);
    if (range <= 0) {
      return true;
    }
    const origin = await ScIdentifyRelay.#fromUuid(originUuid);
    if (!ScIdentifyRelay.#isToken(origin) || origin.parent !== token.parent) {
      return false;
    }
    if (origin.actor !== identifier && origin.actor?.uuid !== identifier?.uuid) {
      return false;
    }
    return ScCanvasActivityService.rangeDistanceBetweenTokens(
      origin,
      token,
      activity.identify?.rangeShape,
      token.parent
    ) <= range;
  }

  static #canUseActivity(activity, user) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const item = activity?.item ?? null;
    return Boolean(
      actor?.testUserPermission?.(user, "OWNER")
      || item?.testUserPermission?.(user, "OWNER")
    );
  }

  static #requestOf(message) {
    return message?.flags?.[Constants.MODULE_ID]?.[FLAG] ?? null;
  }

  static #activeGm() {
    const activeGm = game?.users?.activeGM;
    if (activeGm?.active && activeGm?.isGM) {
      return activeGm;
    }
    return game?.users?.find?.((user) => user?.active && user?.isGM) ?? null;
  }

  static #isToken(document) {
    return document?.documentName === "Token" || document?.constructor?.documentName === "Token";
  }

  static #tokenUuid(token) {
    return token?.document?.uuid ?? token?.uuid ?? null;
  }

  static async #fromUuid(uuid) {
    if (!uuid || typeof globalThis.fromUuid !== "function") {
      return null;
    }
    try {
      return await globalThis.fromUuid(uuid);
    } catch (error) {
      Logger.warn("Could not resolve sc-identify UUID.", error);
      return null;
    }
  }
}
