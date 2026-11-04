import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScGrantActivityService } from "./ScGrantActivityService.js";
import { ScGrantCard } from "./ScGrantCard.js";
import { ScGrantEntryHelpers } from "./ScGrantEntryHelpers.js";

const FLAG = "bastionGrant";

/**
 * A pending grant's delivery state once its order completed: "owed" from the
 * very write that completes the order, "delivering" while a client creates the
 * items, "failed" when they could not be. Each claim names the user, the
 * client (one per browser tab), a token, and when it was made. The grant stays
 * on the facility until a delivery succeeds or a GM discards it.
 */
const DELIVERY_STATES = Object.freeze({
  OWED: "owed",
  DELIVERING: "delivering",
  FAILED: "failed"
});

const LANG = "SCMOREACTIVITIES.Activities.ScGrant.Bastion";

/**
 * Integration with dnd5e bastions: a grant on a facility can run as a
 * facility order instead of granting at once.
 *
 * Issuing writes the facility's native `system.progress` (so the sheet shows
 * the order's icon and progress bar and bastion turns advance it) and keeps
 * what to deliver in a module flag. dnd5e completes an order by clearing its
 * progress (`{ value: 0, max: null, order: "" }`); that update is when the
 * module creates the items. The core only lists harvested items in its turn
 * summary, so the grant is never written to `system.craft`, which would make
 * the core list the item as well.
 *
 * Using the activity again while its order runs changes the order: the new
 * choice replaces the old one and the progress restarts.
 *
 * Delivery is recoverable. Its first attempt rolls the quantities and draws
 * the tables once, and stores the result as a plan on the facility; each
 * source is then written with a delivery key the recipient's item keeps, so a
 * retry delivers only what is still missing. A delivery that fails (the
 * recipient is gone, or the items cannot be created) stays on the facility,
 * marked as failed: items never go to another actor than the one the order
 * was issued for. Only the active GM retries or discards it, from any grant
 * activity of the facility or from the GM-only card posted on failure, and
 * never while another attempt is running.
 */
export class ScGrantBastionOrders {
  /** Facilities (by UUID) whose delivery is running on this client. */
  static #inFlight = new Set();

  /** This client's id: two tabs of the same user are two clients. */
  static #clientId = null;

  /**
   * How long a retry waits after claiming a delivery before it checks that its
   * claim held. Two clients that claim at once both write; the later write
   * wins, and the other client gives up.
   */
  static CLAIM_SETTLE_MS = 500;

  /**
   * A claim is a lease. The delivering client renews it (`claimedAt`) every
   * quarter of this time while it runs, so another client may take the order
   * over only after the claimant stopped renewing (its tab died or hung) for
   * this long. The claimant itself stops writing once half of this time has
   * passed since its last renewal, before anyone else may take over.
   */
  static CLAIM_TIMEOUT_MS = 60 * 1000;

  static registerHooks() {
    Hooks.on("preUpdateItem", (item, changes) => ScGrantBastionOrders.onPreUpdateItem(item, changes));
    Hooks.on("updateItem", (item, changes, options, userId) => {
      ScGrantBastionOrders.onUpdateItem(item, changes, options, userId).catch((error) => {
        Logger.error("Could not resolve an sc-grant bastion order.", error);
      });
    });
    Hooks.on("renderChatMessageHTML", (_message, html) => ScGrantBastionOrders.#bindRecoveryCard(html));
  }

  static isFacility(item) {
    return item?.type === "facility";
  }

  /** Whether `activity` grants through a bastion order rather than at once. */
  static appliesTo(activity) {
    return ScGrantEntryHelpers.normalizeDelivery(activity?.delivery) === ScGrantEntryHelpers.DELIVERY_MODES.BASTION
      && ScGrantBastionOrders.isFacility(activity?.item);
  }

  /** The grant a facility is waiting to deliver, or `null`. */
  static pendingOf(facility) {
    const pending = facility?.flags?.[Constants.MODULE_ID]?.[FLAG];
    return pending && typeof pending === "object" && pending.activityId ? pending : null;
  }

  /** Whether a pending grant's order already completed and only awaits its items. */
  static awaitsDelivery(pending) {
    return Object.values(DELIVERY_STATES).includes(pending?.state);
  }

  static orderIcon(order) {
    return globalThis.CONFIG?.DND5E?.facilities?.orders?.[order]?.icon ?? "";
  }

  static orderLabel(order) {
    const label = globalThis.CONFIG?.DND5E?.facilities?.orders?.[order]?.label;
    return label ? Constants.localize(label, order) : order;
  }

  /**
   * Why the facility cannot take this order now, as a localized message, or
   * `null` when it can. Another of this module's grants is not a blocker: the
   * new order replaces it.
   */
  static blocker(activity) {
    const facility = ScGrantBastionOrders.#liveFacility(activity);
    if (!facility?.isOwner) {
      return Constants.localize(`${LANG}.Warning.NotOwner`, "You must own this facility to issue its orders.");
    }
    if (facility.system?.disabled) {
      return Constants.localize(`${LANG}.Warning.Disabled`, "This facility is shut down and cannot take orders.");
    }
    const progress = facility._source?.system?.progress ?? facility.system?.progress ?? {};
    const pending = ScGrantBastionOrders.pendingOf(facility);
    if (ScGrantBastionOrders.awaitsDelivery(pending)) {
      return Constants.format(
        `${LANG}.Warning.Undelivered`,
        { facility: facility.name ?? "" },
        `${facility.name ?? ""} has a completed order whose items were not delivered yet.`
      );
    }
    if (progress.max && !(pending && progress.order === pending.order)) {
      return Constants.format(
        `${LANG}.Warning.Busy`,
        { order: ScGrantBastionOrders.orderLabel(progress.order) },
        `This facility is already executing an order (${progress.order}).`
      );
    }
    return null;
  }

  /**
   * Starts (or changes) the facility order that will deliver `entries` to
   * `recipientActor`. The facility is checked again here, right before it is
   * written: the user may have spent a while in the picker, and another order
   * may have started meanwhile. Resolves with `{ ok: false, message }` then.
   */
  static async issue(activity, { recipientActor, entries, checkInfo = null }) {
    const unavailable = ScGrantBastionOrders.blocker(activity);
    if (unavailable) {
      return { ok: false, message: unavailable };
    }

    // What the order delivers is decided now, once: quantities rolled, tables
    // drawn. Deliveries only apply this plan, so every attempt (and every
    // retry) delivers the same items, and none of them ever writes a plan.
    const rollData = activity?.getRollData?.() ?? activity?.actor?.getRollData?.() ?? {};
    const resolved = await ScGrantActivityService.planGrant(entries, rollData, { itemFlags: activity.itemFlags });
    if (!resolved.sources.length) {
      return {
        ok: false,
        message: Constants.localize(
          "SCMOREACTIVITIES.Activities.ScGrant.Warning.NoResolvedItems",
          "No valid items could be resolved for this grant activity."
        )
      };
    }

    // Checked again right before the write: the user may have spent a while
    // in the picker, and another order may have started meanwhile.
    const blocker = ScGrantBastionOrders.blocker(activity);
    if (blocker) {
      return { ok: false, message: blocker };
    }
    const facility = ScGrantBastionOrders.#liveFacility(activity);
    const { order, days } = ScGrantEntryHelpers.normalizeBastion(activity.bastion);
    const changed = Boolean(ScGrantBastionOrders.pendingOf(facility));
    const plan = { sources: resolved.sources, lines: resolved.lines, itemFlags: resolved.itemFlags };

    await facility.update({
      "system.progress.value": 0,
      "system.progress.max": days,
      "system.progress.order": order,
      [`flags.${Constants.MODULE_ID}.${FLAG}`]: {
        // Names this order in every delivery key.
        orderId: foundry.utils.randomID(),
        activityId: activity.id,
        recipientUuid: recipientActor?.uuid ?? null,
        order,
        entries: entries.map((entry) => ScGrantEntryHelpers.normalizeEntry(entry)),
        checkInfo: checkInfo ?? null,
        state: "",
        failure: "",
        claimedBy: "",
        claimClient: "",
        claimToken: "",
        claimedAt: 0,
        plan
      }
    });

    await ScGrantBastionOrders.#createIssuedCard(facility, recipientActor, plan.lines, resolved.rolls, { order, days, changed });
    return { ok: true, order, days, changed };
  }

  /** The notice for an issued (or changed) order, for the user who issued it. */
  static issuedNotice(facilityName, { order, days, changed }) {
    const orderLabel = ScGrantBastionOrders.orderLabel(order);
    return Constants.format(
      `${LANG}.Info.${changed ? "Changed" : "Issued"}`,
      { facility: facilityName ?? "", order: orderLabel, days },
      `${facilityName ?? ""}: ${orderLabel} (${days} days).`
    );
  }

  /**
   * Runs on the client that writes the update. When the update completes the
   * facility's order, the grant is marked owed (and claimed by this client) in
   * that same write, so the items stay owed whatever happens next.
   */
  static onPreUpdateItem(item, changes) {
    if (!ScGrantBastionOrders.isFacility(item)) {
      return;
    }
    const pending = ScGrantBastionOrders.pendingOf(item);
    if (!pending || ScGrantBastionOrders.awaitsDelivery(pending) || !ScGrantBastionOrders.#completes(changes)) {
      return;
    }
    const path = `flags.${Constants.MODULE_ID}.${FLAG}`;
    const setProperty = foundry.utils.setProperty;
    for (const [key, value] of Object.entries(ScGrantBastionOrders.#claim(DELIVERY_STATES.OWED))) {
      setProperty(changes, `${path}.${key}`, value);
    }
  }

  static async onUpdateItem(item, changes, _options, userId) {
    if (userId !== globalThis.game?.user?.id || !ScGrantBastionOrders.isFacility(item)) {
      return;
    }
    const pending = ScGrantBastionOrders.pendingOf(item);
    if (!pending) {
      return;
    }

    const getProperty = foundry.utils.getProperty;
    const hasProperty = foundry.utils.hasProperty;

    // This client's write completed the order: it delivers it. Another tab of
    // the same user sees the same update, but not its own claim.
    const owedHere = pending.state === DELIVERY_STATES.OWED
      && pending.claimClient === ScGrantBastionOrders.#client()
      && getProperty(changes, `flags.${Constants.MODULE_ID}.${FLAG}.state`) === DELIVERY_STATES.OWED;
    if (owedHere) {
      await ScGrantBastionOrders.#deliver(item, pending);
      return;
    }
    // A completed order's items are owed whatever the facility does next.
    if (ScGrantBastionOrders.awaitsDelivery(pending)) {
      return;
    }

    const progress = getProperty(changes, "system.progress");
    const craftChanged = hasProperty(changes, "system.craft");
    if (!progress && !craftChanged) {
      return;
    }

    // dnd5e 5.x completes a shut-down facility's order as a repair, which also
    // re-enables it: that turn delivers nothing. Otherwise the grant is only
    // dropped when another order (native or edited by hand) took over.
    const repaired = hasProperty(changes, "system.disabled");
    const source = item._source?.system?.progress ?? item.system?.progress ?? {};
    if (craftChanged || repaired || (source.max && source.order !== pending.order)) {
      await ScGrantBastionOrders.#clear(item);
    }
  }

  /** Whether an update is dnd5e completing the facility's order (and not a 5.x repair). */
  static #completes(changes) {
    const progress = foundry.utils.getProperty(changes, "system.progress");
    return progress?.order === "" && progress?.max === null && !foundry.utils.hasProperty(changes, "system.disabled");
  }

  /** Whether this user resolves undelivered orders: the active GM only, so attempts never race. */
  static isResolver(user = globalThis.game?.user) {
    if (!user?.isGM) {
      return false;
    }
    const activeGm = globalThis.game?.users?.activeGM ?? null;
    return !activeGm || activeGm.id === user.id;
  }

  /**
   * Whether an undelivered order can be retried or discarded now: after a
   * failure, or once its delivery is no longer running: claimed by this
   * client but not in flight here (the attempt ended without recording an
   * outcome), claimed by a user who left, or claimed too long ago. A claim
   * by another client of the same user is still running.
   */
  static canResolve(facility, pending = ScGrantBastionOrders.pendingOf(facility)) {
    if (!ScGrantBastionOrders.awaitsDelivery(pending) || ScGrantBastionOrders.#inFlight.has(ScGrantBastionOrders.#lockOf(facility))) {
      return false;
    }
    return pending.state === DELIVERY_STATES.FAILED || !ScGrantBastionOrders.#claimRunning(pending);
  }

  /** Whether another client may still be delivering this order. */
  static #claimRunning(pending) {
    if (pending.claimClient === ScGrantBastionOrders.#client()) {
      return false;
    }
    const claimant = globalThis.game?.users?.get?.(pending.claimedBy);
    if (!claimant?.active) {
      return false;
    }
    return Date.now() - (Number(pending.claimedAt) || 0) < ScGrantBastionOrders.CLAIM_TIMEOUT_MS;
  }

  /** Delivers a completed order whose delivery failed or was interrupted. */
  static async retry(facility) {
    const pending = ScGrantBastionOrders.pendingOf(facility);
    if (!ScGrantBastionOrders.isResolver() || !ScGrantBastionOrders.canResolve(facility, pending)) {
      return { ok: false, reason: "not-retryable" };
    }
    return ScGrantBastionOrders.#deliver(facility, pending, { settle: true });
  }

  /** Drops a completed order's undelivered items. */
  static async discard(facility) {
    if (!ScGrantBastionOrders.isResolver() || !ScGrantBastionOrders.canResolve(facility)) {
      return { ok: false, reason: "not-discardable" };
    }
    await ScGrantBastionOrders.#clear(facility);
    return { ok: true };
  }

  static async #deliver(facility, pending, { settle = false } = {}) {
    const lock = ScGrantBastionOrders.#lockOf(facility);
    if (ScGrantBastionOrders.#inFlight.has(lock)) {
      return { ok: false, reason: "in-progress" };
    }
    ScGrantBastionOrders.#inFlight.add(lock);
    try {
      // Claimed first, so no other client starts while this one runs. If the
      // claim cannot be written, the order keeps its owed or failed state, which
      // this client can still resolve.
      const claim = ScGrantBastionOrders.#claim(DELIVERY_STATES.DELIVERING);
      try {
        await ScGrantBastionOrders.#writeState(facility, claim);
      } catch (error) {
        Logger.error("Could not claim an sc-grant bastion delivery.", error);
        return { ok: false, reason: "grant-failed" };
      }
      if (settle && ScGrantBastionOrders.CLAIM_SETTLE_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, ScGrantBastionOrders.CLAIM_SETTLE_MS));
      }
      const lease = ScGrantBastionOrders.#holdLease(facility, claim);
      try {
        if (!lease.holds()) {
          return { ok: false, reason: "claimed-elsewhere" };
        }

        // Any error ends the attempt as a failure, never as a delivery left
        // marked as running.
        let reason;
        try {
          reason = await ScGrantBastionOrders.#attemptDelivery(facility, pending, lease.holds);
        } catch (error) {
          Logger.error("Could not deliver an sc-grant bastion order.", error);
          reason = "grant-failed";
        }
        // Another client took the order over: it is theirs to settle now.
        if (reason === "claim-lost" || !lease.holds()) {
          Logger.warn("An sc-grant bastion delivery lost its claim to another client and stopped.");
          return { ok: false, reason: "claim-lost" };
        }
        if (reason) {
          await ScGrantBastionOrders.#fail(facility, reason);
          return { ok: false, reason };
        }

        await ScGrantBastionOrders.#clear(facility);
        return { ok: true };
      } finally {
        lease.release();
      }
    } finally {
      ScGrantBastionOrders.#inFlight.delete(lock);
    }
  }

  /**
   * Keeps this client's claim alive while it delivers. `holds()` is checked
   * before every write: it is false once another client's claim replaced this
   * one, or once this client could not renew the claim for half the timeout,
   * so a client that lost the order stops before writing anything else.
   */
  static #holdLease(facility, claim) {
    let renewedAt = claim.claimedAt;
    const timer = setInterval(async() => {
      if (ScGrantBastionOrders.pendingOf(facility)?.claimToken !== claim.claimToken) {
        return;
      }
      const now = Date.now();
      try {
        await ScGrantBastionOrders.#writeState(facility, { claimedAt: now });
        renewedAt = now;
      } catch (error) {
        Logger.warn("Could not renew an sc-grant bastion delivery claim.", error);
      }
    }, Math.max(1, ScGrantBastionOrders.CLAIM_TIMEOUT_MS / 4));
    return {
      holds: () => ScGrantBastionOrders.pendingOf(facility)?.claimToken === claim.claimToken
        && Date.now() - renewedAt < ScGrantBastionOrders.CLAIM_TIMEOUT_MS / 2,
      release: () => clearInterval(timer)
    };
  }

  static async #fail(facility, reason) {
    try {
      await ScGrantBastionOrders.#writeState(facility, { state: DELIVERY_STATES.FAILED, failure: reason });
    } catch (error) {
      // Left as "delivering" by this client: canResolve still lets it resolve it.
      Logger.error("Could not record an sc-grant bastion delivery failure.", error);
    }
    ui.notifications?.warn?.(Constants.format(
      `${LANG}.Warning.DeliveryFailed`,
      { facility: facility.name ?? "", reason: ScGrantBastionOrders.failureLabel(reason) },
      `${facility.name ?? ""} could not deliver its order (${reason}). It stays pending.`
    ));
    await ScGrantBastionOrders.#createRecoveryCard(facility, reason);
  }

  static #lockOf(facility) {
    return facility?.uuid ?? facility?.id ?? null;
  }

  /** Creates the order's items, or returns why it could not. */
  static async #attemptDelivery(facility, pending, holds = () => true) {
    // The order is owed to the actor it was issued for, and to no other.
    let recipient = null;
    try {
      recipient = pending.recipientUuid ? await fromUuid(pending.recipientUuid) : null;
    } catch {
      recipient = null;
    }
    if (!recipient) {
      return "recipient-missing";
    }

    // The plan was fixed when the order was issued; delivering never changes it.
    const plan = pending.plan;
    if (!Array.isArray(plan?.sources) || !plan.sources.length) {
      return "no-items";
    }
    // Flags only mark the created items; they change neither which items arrive
    // nor how many. So a delivery (or a retry) follows the activity's current
    // flags, and the ones stored with the order only once the activity is gone.
    const activity = facility.system?.activities?.get?.(pending.activityId) ?? null;
    const outcome = await ScGrantActivityService.deliverPlan(recipient, plan, {
      itemFlags: activity ? ScGrantEntryHelpers.normalizeItemFlags(activity.itemFlags) : (plan.itemFlags ?? []),
      activityId: pending.activityId,
      deliveryId: pending.orderId,
      checkInfo: pending.checkInfo ?? null,
      banner: ScGrantBastionOrders.#banner(facility, pending.order, "Completed"),
      holds
    });
    if (outcome?.ok) {
      return null;
    }
    return ["no-items", "claim-lost"].includes(outcome?.reason) ? outcome.reason : "grant-failed";
  }

  /** Why an undelivered order is still waiting, localized. */
  static reasonLabel(pending) {
    if (pending?.state === DELIVERY_STATES.FAILED) {
      return ScGrantBastionOrders.failureLabel(pending.failure);
    }
    if (pending && ScGrantBastionOrders.#claimRunning(pending)) {
      const claimant = globalThis.game?.users?.get?.(pending.claimedBy);
      return Constants.format(`${LANG}.Failure.Delivering`, { user: claimant?.name ?? "" }, "being delivered");
    }
    return Constants.localize(`${LANG}.Failure.Interrupted`, "the delivery was interrupted");
  }

  /** The localized reason a delivery failed. */
  static failureLabel(reason) {
    const key = { "recipient-missing": "RecipientMissing", "no-items": "NoItems" }[reason] ?? "GrantFailed";
    return Constants.localize(`${LANG}.Failure.${key}`, reason);
  }

  /** A claim of the order by this client, in `state`. */
  static #claim(state) {
    return {
      state,
      failure: "",
      claimedBy: globalThis.game?.user?.id ?? "",
      claimClient: ScGrantBastionOrders.#client(),
      claimToken: foundry.utils.randomID(),
      claimedAt: Date.now()
    };
  }

  static #client() {
    ScGrantBastionOrders.#clientId ??= foundry.utils.randomID();
    return ScGrantBastionOrders.#clientId;
  }

  static async #writeState(facility, values) {
    await facility.update(Object.fromEntries(Object.entries(values).map(([key, value]) => (
      [`flags.${Constants.MODULE_ID}.${FLAG}.${key}`, value]
    ))));
  }

  static async #clear(facility) {
    await facility.update({ [`flags.${Constants.MODULE_ID}.${FLAG}`]: null });
  }

  /**
   * Posts, for the GMs only, a card that names the failed delivery and offers
   * to retry or discard it: reachable even when no grant activity is left on
   * the facility.
   */
  static async #createRecoveryCard(facility, reason) {
    const pending = ScGrantBastionOrders.pendingOf(facility);
    if (!pending) {
      return;
    }
    const content = ScGrantCard.content({
      banner: ScGrantBastionOrders.#banner(facility, pending?.order, "Undelivered"),
      intro: ScGrantBastionOrders.failureLabel(reason),
      lines: pending?.plan?.lines ?? [],
      dataset: { scGrantFacility: facility.uuid ?? "" },
      actions: [
        { action: "retry", icon: "fa-rotate-right", label: Constants.localize(`${LANG}.Retry`, "Retry delivery") },
        { action: "discard", icon: "fa-trash", label: Constants.localize(`${LANG}.Discard`, "Discard") }
      ]
    });
    try {
      const gms = globalThis.ChatMessage?.getWhisperRecipients?.("GM") ?? [];
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: facility.actor ?? null }),
        whisper: gms.map((user) => user.id),
        content
      });
    } catch (error) {
      Logger.warn("Could not create the sc-grant recovery card.", error);
    }
  }

  static #bindRecoveryCard(html) {
    const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : (html?.[0] ?? html);
    const card = root?.querySelector?.(".sc-ma-grant-card[data-sc-grant-facility]");
    if (!card) {
      return;
    }
    const actions = card.querySelectorAll("[data-sc-grant-action]");
    if (!ScGrantBastionOrders.isResolver()) {
      actions.forEach((button) => button.remove());
      return;
    }
    actions.forEach((button) => button.addEventListener("click", async(event) => {
      event.preventDefault();
      button.disabled = true;
      const facility = await fromUuid(card.dataset.scGrantFacility).catch(() => null);
      const action = button.dataset.scGrantAction;
      let result = { ok: false };
      if (facility && action === "retry") {
        result = await ScGrantBastionOrders.retry(facility);
      } else if (facility && action === "discard" && await ScGrantBastionOrders.confirmDiscard()) {
        result = await ScGrantBastionOrders.discard(facility);
      }
      if (!result.ok && result.reason !== "grant-failed" && result.reason !== "recipient-missing") {
        ui.notifications?.info?.(Constants.localize(
          `${LANG}.Info.NothingToResolve`,
          "This order has nothing left to retry or discard right now."
        ));
      }
      button.disabled = false;
    }));
  }

  static async confirmDiscard() {
    return foundry.applications.api.DialogV2.confirm({
      window: { title: Constants.localize(`${LANG}.Discard`, "Discard") },
      content: `<p>${Constants.localize(`${LANG}.DiscardConfirm`, "Discard this completed order?")}</p>`,
      rejectClose: false
    });
  }

  /** The facility as stored now, not the copy the activity was prepared with. */
  static #liveFacility(activity) {
    const item = activity?.item ?? null;
    return item?.actor?.items?.get?.(item.id) ?? item;
  }

  /** A bastion card's banner: the order's icon, the facility, and what happened to the order. */
  static #banner(facility, order, state) {
    const orderLabel = ScGrantBastionOrders.orderLabel(order);
    return {
      img: ScGrantBastionOrders.orderIcon(order) || facility?.img || "",
      title: facility?.name ?? "",
      subtitle: Constants.format(`${LANG}.Card.${state}`, { order: orderLabel }, orderLabel)
    };
  }

  static async #createIssuedCard(facility, recipientActor, lines, rolls, { order, days, changed }) {
    const content = ScGrantCard.content({
      banner: ScGrantBastionOrders.#banner(facility, order, changed ? "Changed" : "Issued"),
      intro: Constants.format(
        `${LANG}.Card.WillDeliver`,
        { actor: recipientActor?.name ?? "" },
        `${recipientActor?.name ?? ""} will receive:`
      ),
      lines,
      notes: [{
        icon: "fa-hourglass-half",
        text: Constants.format(`${LANG}.Card.Eta`, { days }, `Ready in ${days} day(s).`)
      }]
    });

    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: facility.actor ?? recipientActor }),
        content,
        rolls
      });
    } catch (error) {
      Logger.warn("Could not create the sc-grant bastion order card.", error);
    }
  }
}
