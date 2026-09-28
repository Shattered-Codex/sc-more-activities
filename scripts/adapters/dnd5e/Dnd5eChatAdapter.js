/**
 * Reads the dnd5e chat-card fields used by More Activities without tying the
 * callers to a particular system version. dnd5e 6 stores roll metadata in
 * the message's `type` and `system` data; 5.3 used `flags.dnd5e.roll`.
 *
 * Prefer the current message shape when it is present, then retain the v5
 * flag reads as a fallback for old worlds and existing chat history.
 */
export class Dnd5eChatAdapter {
  static getSaveContext(message) {
    const system = Dnd5eChatAdapter.#system(message);
    if (String(message?.type ?? "") === "save") {
      return {
        // dnd5e 6 also records death saves as save messages. 5.3 gave them
        // their own roll type, so they never counted as saving throws.
        isSave: String(system?.type ?? "") !== "death",
        ability: String(system?.ability ?? "").trim(),
        // dnd5e 6 exposes this state as `resisted` on save messages. Accept
        // `forceSuccess` too so the reader also handles compatible custom
        // messages and future system aliases.
        forceSuccess: system?.resisted === true || system?.forceSuccess === true
      };
    }

    const roll = message?.flags?.dnd5e?.roll ?? message?.getFlag?.("dnd5e", "roll");
    return {
      isSave: String(roll?.type ?? "") === "save",
      ability: String(roll?.ability ?? "").trim(),
      forceSuccess: roll?.forceSuccess === true
    };
  }

  static getTargets(message) {
    const systemTargets = Dnd5eChatAdapter.#system(message)?.targets;
    if (Array.isArray(systemTargets)) {
      return systemTargets;
    }
    const flagTargets = message?.getFlag?.("dnd5e", "targets")
      ?? message?.flags?.dnd5e?.targets;
    return Array.isArray(flagTargets) ? flagTargets : [];
  }

  static #system(message) {
    return message?.system ?? message?._source?.system ?? null;
  }
}
