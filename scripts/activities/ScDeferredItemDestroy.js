import { Constants } from "../constants/Constants.js";
import { Logger } from "../support/Logger.js";

/**
 * Names the use on its usage config. dnd5e clones the usage before consuming,
 * so the use is told apart by this id rather than by the config object.
 */
const USAGE_KEY = "scMoreActivitiesDeferDestroy";
/** Set on an item kept after its use spent it, until that use is done. */
const SPENT_FLAG = "spentByUse";

/**
 * Keeps a consumable that its own use spends to nothing until the activity is
 * done with it.
 *
 * dnd5e deletes an auto-destroyed item while consuming, before
 * `_finalizeUsage`. An activity whose effect the GM carries out is loaded
 * there again by its UUID, the only thing the GM trusts, so a last scroll
 * would be gone before the GM could check it.
 *
 * dnd5e still plans and records the deletion as usual, so a refund from the
 * chat card brings the item back; only the deletion itself is held back, the
 * item is left spent (no quantity, no uses, the `spentByUse` flag) and deleted
 * once the use is done, however it ends. Consuming from the chat card later is
 * not such a use, so it is left to dnd5e entirely.
 *
 * Whoever deletes it goes by the flag, which every client sees: the GM runs
 * the effect, and anyone may refund from the chat card while the use is still
 * going.
 */
export class ScDeferredItemDestroy {
  /** Actor and item (see `#key`) → `{ used }` for a consumption running now that may not delete it. */
  static #vetoes = new Map();

  /** Use id (see `USAGE_KEY`) → the item held for that use. */
  static #held = new Map();

  static #lastUse = 0;

  static registerHooks() {
    Hooks.on("preDeleteItem", (item) => ScDeferredItemDestroy.#onPreDeleteItem(item));
  }

  /** The usage options for `use`, asking that the item be held. Pass them to `release` once `use` returns. */
  static usage(usage = {}) {
    ScDeferredItemDestroy.#lastUse += 1;
    return { ...usage, [USAGE_KEY]: ScDeferredItemDestroy.#lastUse };
  }

  /**
   * Runs `consume` (the activity's own) and holds back the deletion of the
   * activity's item when the usage asked for it. Call from `consume`.
   */
  static async consume(activity, config, consume) {
    const id = activity?.item?.id;
    const actor = activity?.item?.actor ?? null;
    const key = ScDeferredItemDestroy.#key(actor, id);
    const use = config?.[USAGE_KEY];
    if (!use || !key) {
      return consume();
    }

    const veto = { used: false };
    ScDeferredItemDestroy.#vetoes.set(key, veto);
    let updates;
    let failure = null;
    try {
      updates = await consume();
    } catch (error) {
      failure = { error };
    } finally {
      if (ScDeferredItemDestroy.#vetoes.get(key) === veto) {
        ScDeferredItemDestroy.#vetoes.delete(key);
      }
    }

    if (veto.used && (failure || updates === false)) {
      // Stopped or failed after consuming: nothing is left to do with it.
      await ScDeferredItemDestroy.#delete(actor, id);
    } else if (veto.used) {
      if (await ScDeferredItemDestroy.#markSpent(actor, id)) {
        ScDeferredItemDestroy.#held.set(use, { actor, id });
      } else {
        // Left unmarked, it would look unspent and be kept: lose it now instead.
        await ScDeferredItemDestroy.#delete(actor, id);
      }
    }
    if (failure) {
      throw failure.error;
    }
    return updates;
  }

  /**
   * Deletes the item held for this use: `usage` is what `usage()` returned, or
   * the config dnd5e made from it. Call once `use` is done, even if it threw.
   */
  static async release(usage) {
    const use = usage?.[USAGE_KEY];
    const held = use ? ScDeferredItemDestroy.#held.get(use) : null;
    if (!held) {
      return;
    }
    ScDeferredItemDestroy.#held.delete(use);
    // A refund during the use already brought the item back unspent.
    await ScDeferredItemDestroy.#deleteSpent(held.actor, held.id);
  }

  /**
   * Makes way for a refund of a use whose item is still held. dnd5e recreates
   * a deleted item from the chat card's record, but skips one whose id is
   * taken, then clears the record: the held item would keep the id, and go
   * once the use is done. Deleting it first lets the refund bring it back as
   * it was. Call from `refund`, before dnd5e's own, with what it refunds.
   */
  static async prepareRefund(actor, consumed) {
    const deleted = Array.isArray(consumed?.deleted) ? consumed.deleted : [];
    for (const { _id: id } of deleted) {
      await ScDeferredItemDestroy.#deleteSpent(actor, id);
    }
  }

  /**
   * Deletes the activity's item now if a use left it spent. For whoever runs
   * the effect, before moving tokens: an unlinked token carries its items
   * along, and the copy would escape the release.
   */
  static async discardSpent(activity) {
    await ScDeferredItemDestroy.#deleteSpent(activity?.item?.actor ?? null, activity?.item?.id);
  }

  static #onPreDeleteItem(item) {
    // An unlinked token's items are deleted through its ActorDelta, which stands for the synthetic actor.
    const parent = item?.parent;
    const actor = parent?.documentName === "ActorDelta" ? parent.syntheticActor : parent;
    const veto = ScDeferredItemDestroy.#vetoes.get(ScDeferredItemDestroy.#key(actor, item?.id));
    if (!veto) {
      return undefined;
    }
    veto.used = true;
    return false;
  }

  /**
   * Item ids repeat across actors (copied tokens, duplicated actors), so the
   * actor is part of the key; an unlinked token's actor has its own uuid.
   */
  static #key(actor, id) {
    return actor?.uuid && id ? `${actor.uuid}.Item.${id}` : null;
  }

  /** Whether the item is now marked spent. */
  static async #markSpent(actor, id) {
    const item = actor?.items?.get?.(id);
    if (!item) {
      return false;
    }
    const changes = { _id: id, "system.quantity": 0, [`flags.${Constants.MODULE_ID}.${SPENT_FLAG}`]: true };
    const maxUses = Number(item.system?.uses?.max) || 0;
    if (maxUses > 0) {
      changes["system.uses.spent"] = maxUses;
    }
    try {
      await actor.updateEmbeddedDocuments("Item", [changes]);
      return true;
    } catch (error) {
      Logger.warn("Could not mark the spent item.", error);
      return false;
    }
  }

  static async #deleteSpent(actor, id) {
    const item = id ? actor?.items?.get?.(id) : null;
    if (item?.flags?.[Constants.MODULE_ID]?.[SPENT_FLAG] === true) {
      await ScDeferredItemDestroy.#delete(actor, id);
    }
  }

  static async #delete(actor, id) {
    try {
      if (actor?.items?.has?.(id)) {
        await actor.deleteEmbeddedDocuments("Item", [id]);
      }
    } catch (error) {
      Logger.warn("Could not delete the spent item.", error);
    }
  }
}
