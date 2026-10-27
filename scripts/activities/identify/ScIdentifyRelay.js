import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScUsageScaling } from "../ScUsageScaling.js";
import { ScChatRelay } from "../../support/ScChatRelay.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScIdentifyActivityService } from "./ScIdentifyActivityService.js";
import { Logger } from "../../support/Logger.js";

const KIND = "identify";

/**
 * Identifies an item on an actor the user cannot write to (another player's
 * character, an NPC) by asking the active GM through `ScChatRelay`.
 *
 * The GM trusts nothing but the request's author and the stored activity: it
 * re-derives the item's DC and the range, and rolls the check itself, since a
 * total sent by the player could be anything.
 */
export class ScIdentifyRelay {
  static registerHandler() {
    ScChatRelay.registerHandler(KIND, ScIdentifyRelay.#handle);
  }

  /**
   * Posts the request and waits for the GM's answer: `{ status, check }` with
   * status "identified", "failed", or "refused", or `null` when no answer
   * arrives in time.
   */
  static async request({ activity, identifier, candidate, origin, item }) {
    const answer = await ScChatRelay.request(KIND, {
      speaker: ChatMessage.getSpeaker({ actor: identifier }),
      content: ScIdentifyActivityService.chatCardContent({
        status: "pending",
        identifier,
        owner: candidate.actor,
        item
      }),
      data: {
        activityUuid: activity?.uuid ?? null,
        recipientUuid: ScIdentifyRelay.#tokenUuid(candidate.token) ?? candidate.actor?.uuid ?? null,
        originUuid: ScIdentifyRelay.#tokenUuid(origin),
        itemId: item.id,
        scaling: ScUsageScaling.of(activity)
      }
    });
    return answer ? { status: answer.status, check: answer.answer?.check ?? null } : null;
  }

  static async #handle({ user, data }) {
    const outcome = await ScIdentifyRelay.#process(user, data);
    return {
      status: outcome.status,
      content: ScIdentifyActivityService.chatCardContent(outcome),
      answer: { check: outcome.check ?? null }
    };
  }

  static async #process(user, request) {
    const refused = { status: "refused" };
    const stored = await ScIdentifyRelay.#fromUuid(request.activityUuid);
    if (String(stored?.type ?? "") !== ACTIVITY_TYPES.IDENTIFY || !ScIdentifyRelay.#canUseActivity(stored, user)) {
      return refused;
    }
    // A DC formula may scale with the use, as it did on the user's client.
    const activity = ScUsageScaling.apply(stored, request.scaling ?? 0);
    if (!activity) {
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

    // Read before identifying: once identified, the item shows its true name.
    const formerName = item.name ?? "";
    await item.update({ "system.identified": true });
    return {
      status: "identified",
      identifier,
      owner,
      item,
      check,
      formerName,
      checkName: ScIdentifyActivityService.checkName(activity.check)
    };
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
