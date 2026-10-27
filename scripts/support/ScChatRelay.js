import { Constants } from "../constants/Constants.js";
import { Logger } from "./Logger.js";

const FLAG = "relay";

/**
 * Lets a player ask the active GM to do what only a GM may (write to another
 * player's actor, create tokens on another scene), as a chat message both
 * sides can trust.
 *
 * The request is a chat message rather than a user query: the server only lets
 * a player create a message as themselves, so its author is the authenticated
 * sender on Foundry v13 too, where a query handler is not told who sent it. The
 * same message is the card everyone sees, first as pending, then updated by the
 * GM with the outcome.
 *
 * Each kind of request has a handler on the GM's client, which must trust
 * nothing but the author and the documents it loads itself. The player, in
 * turn, only accepts an answer the server reports as written by a GM, since the
 * request's author can edit its flags as well.
 */
export class ScChatRelay {
  static TIMEOUT_MS = 30000;

  static #handlers = new Map();

  static registerHooks() {
    Hooks.on("createChatMessage", ScChatRelay.#onCreateMessage);
  }

  /**
   * @param {string} kind
   * @param {(request: { user: User, data: object, message: ChatMessage }) => Promise<{
   *   status: string, content?: string, answer?: object
   * }>} handler  Runs on the active GM's client. `status` is anything but "pending".
   */
  static registerHandler(kind, handler) {
    ScChatRelay.#handlers.set(kind, handler);
  }

  static isAvailable() {
    return Boolean(ScChatRelay.#activeGm());
  }

  /**
   * Posts a request and waits for the GM's answer: `{ status, answer }`, with
   * status "refused" when the GM rejected it, or `null` when no answer arrives
   * in time. `whisper` keeps a routine request out of the public log: the GMs
   * and the author still see it.
   */
  static async request(kind, { speaker = {}, content = "", data = {}, whisper = false } = {}) {
    // The id is chosen here so the answer can be awaited before the request
    // exists: no answer can slip in unobserved, and none has to be read back
    // from the message without knowing who wrote it.
    const messageId = foundry.utils.randomID();
    const answer = ScChatRelay.#awaitAnswer(messageId);
    try {
      await ChatMessage.create({
        _id: messageId,
        speaker,
        content,
        ...(whisper ? { whisper: ScChatRelay.#gmIds() } : {}),
        flags: { [Constants.MODULE_ID]: { [FLAG]: { kind, status: "pending", data } } }
      }, { keepId: true });
    } catch (error) {
      Logger.error(`Could not post the ${kind} request.`, error);
      answer.cancel();
    }
    return answer.promise;
  }

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
        const relay = ScChatRelay.#relayOf(message);
        if (relay && relay.status !== "pending") {
          finish({ status: relay.status, answer: relay.answer ?? null });
        }
      });
      timer = setTimeout(() => finish(null), ScChatRelay.TIMEOUT_MS);
    });
    return { promise, cancel };
  }

  static async #onCreateMessage(message) {
    const relay = ScChatRelay.#relayOf(message);
    const handler = ScChatRelay.#handlers.get(relay?.kind);
    if (relay?.status !== "pending" || !handler || ScChatRelay.#activeGm()?.id !== game?.user?.id) {
      return;
    }

    // Set by the server to the user who created the message. A GM never
    // relays, so a GM-authored request is not one this flow produced.
    const user = message.author;
    let outcome = { status: "refused" };
    if (user && !user.isGM) {
      try {
        outcome = await handler({ user, data: relay.data ?? {}, message });
      } catch (error) {
        Logger.error(`Could not execute a relayed ${relay.kind} request.`, error);
      }
    }

    const changes = {
      [`flags.${Constants.MODULE_ID}.${FLAG}`]: {
        ...relay,
        status: outcome?.status ?? "refused",
        answer: outcome?.answer ?? null
      }
    };
    if (outcome?.content) {
      changes.content = outcome.content;
    }
    try {
      await message.update(changes);
    } catch (error) {
      Logger.error(`Could not answer the ${relay.kind} request.`, error);
    }
  }

  static #relayOf(message) {
    return message?.flags?.[Constants.MODULE_ID]?.[FLAG] ?? null;
  }

  static #gmIds() {
    return Array.from(game?.users ?? []).filter((user) => user?.isGM).map((user) => user.id);
  }

  static #activeGm() {
    const activeGm = game?.users?.activeGM;
    if (activeGm?.active && activeGm?.isGM) {
      return activeGm;
    }
    return game?.users?.find?.((user) => user?.active && user?.isGM) ?? null;
  }
}
