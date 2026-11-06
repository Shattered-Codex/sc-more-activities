import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScUsageScaling } from "../ScUsageScaling.js";
import { ScGrantBastionOrders } from "./ScGrantBastionOrders.js";
import { ScGrantCard } from "./ScGrantCard.js";
import { ScGrantChoiceApp } from "./ScGrantChoiceApp.js";
import { ScGrantEntryHelpers } from "./ScGrantEntryHelpers.js";
import { ScGrantTableResults } from "./ScGrantTableResults.js";

const QUERY_ID = "sc-more-activities.grantItems";
const QUERY_TIMEOUT = 30000;
// Up to v0.16.1 a stack kept only its last 20 delivery keys (`grantDeliveryKeys`),
// so a full list may have dropped a key whose order is still pending. Stacks
// now keep every key in `grantDeliveryLedger` until its order is settled, one
// field per key (`grantDeliveryLedger.<orderId>.<index>: true`): writes add or
// delete their own fields and never rewrite another order's keys.
const LEGACY_MAX_DELIVERY_KEYS = 20;
const LEDGER = "grantDeliveryLedger";
const LEDGER_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** A bastion delivery stopped because another client took its order over. */
class ClaimLostError extends Error {}

/** A bastion delivery stopped because nobody confirmed a source that may already have arrived. */
class UncertainDeliveryError extends Error {}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export class ScGrantActivityService {
  static registerQueries() {
    if (!globalThis.CONFIG?.queries) {
      return false;
    }
    CONFIG.queries[QUERY_ID] = ScGrantActivityService.handleGrantQuery;
    return true;
  }

  /**
   * Creates the granted items on the GM client for a player who cannot write
   * to the recipient actor (another player's character, an NPC) or to a world
   * roll table. The GM re-derives everything it can from the stored activity:
   * the caller must own the activity, only the configured entries are granted,
   * and a "self" grant always lands on the activity's own actor.
   *
   * Foundry v14 passes the authenticated sender as `context.user`; without it
   * `requestUserId` is only a claim, so a claim of GM rights is refused (a GM
   * never relays, see `#shouldRelay`).
   */
  static async handleGrantQuery(payload = {}, context = {}) {
    if (!game?.user?.isGM) {
      return ScGrantActivityService.#failure(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.GmRequired",
        "A GM must grant these items."
      );
    }

    const user = context?.user ?? game?.users?.get?.(payload.requestUserId) ?? null;
    let activity = await ScGrantActivityService.#fromUuid(payload.activityUuid);
    if (!user || (!context?.user && user.isGM) || String(activity?.type ?? "") !== ACTIVITY_TYPES.GRANT) {
      return ScGrantActivityService.#invalidRequest();
    }

    if (!ScGrantActivityService.#canUseActivity(activity, user)) {
      return ScGrantActivityService.#failure(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.ActivityPermission",
        "You do not have permission to use this activity."
      );
    }

    activity = ScUsageScaling.apply(activity, payload.scaling ?? 0);
    if (!activity) {
      return ScGrantActivityService.#invalidRequest();
    }

    const sourceActor = activity.actor ?? activity.item?.actor ?? null;
    const recipientActor = await ScGrantActivityService.#requestedRecipient(activity, sourceActor, payload.recipientUuid);
    const entries = ScGrantEntryHelpers.applyPicks(
      ScGrantEntryHelpers.normalizeEntries(activity.grants ?? []),
      activity.selection,
      payload.picks,
      { budget: ScGrantActivityService.resolveBudget(activity) }
    );
    if (!sourceActor || !recipientActor || !entries?.length) {
      return ScGrantActivityService.#invalidRequest();
    }

    let checkInfo = null;
    const check = ScGrantEntryHelpers.normalizeCheck(activity.check);
    if (ScGrantEntryHelpers.isCheckEnabled(check)) {
      const dc = await ScGrantActivityService.resolveCheckDc(activity, check);
      const total = Number(payload.check?.total);
      if (!Number.isFinite(total) || total < dc) {
        return ScGrantActivityService.#invalidRequest();
      }
      checkInfo = { dc, total };
    }

    // A player's bastion order whose tables must be drawn by the GM: the GM
    // issues it, and with it draws the tables.
    if (ScGrantBastionOrders.appliesTo(activity)) {
      try {
        const issued = await ScGrantBastionOrders.issue(activity, { recipientActor, entries, checkInfo });
        return issued.ok
          ? { ok: true, bastion: { order: issued.order, days: issued.days, changed: issued.changed } }
          : { ok: false, message: issued.message };
      } catch (error) {
        Logger.error("Could not issue a relayed sc-grant bastion order.", error);
        return { ok: false, message: ScGrantActivityService.#executionFailedMessage(error) };
      }
    }

    try {
      const outcome = await ScGrantActivityService.#grantItems(activity, sourceActor, recipientActor, entries, checkInfo);
      if (!outcome.ok) {
        return outcome;
      }
      return {
        ...outcome,
        created: outcome.created.map((document) => document?.uuid ?? null),
        updated: outcome.updated.map((document) => document?.uuid ?? null)
      };
    } catch (error) {
      Logger.error("Could not execute a relayed sc-grant activity.", error);
      return { ok: false, message: ScGrantActivityService.#executionFailedMessage(error) };
    }
  }

  static async execute(activity) {
    const sourceActor = activity?.actor ?? activity?.item?.actor ?? null;
    if (!sourceActor) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.MissingActor",
        "This grant activity needs an actor."
      ));
      return { canceled: true, reason: "missing-actor" };
    }

    const recipient = ScGrantActivityService.#resolveRecipient(activity, sourceActor);
    if (!recipient) {
      return { canceled: true, reason: "missing-recipient" };
    }
    const recipientActor = recipient.actor;

    const entries = ScGrantEntryHelpers.normalizeEntries(activity?.grants ?? []);
    if (!entries.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.MissingItems",
        "Add at least one granted item before using this activity."
      ));
      return { canceled: true, reason: "missing-items" };
    }

    const budget = ScGrantEntryHelpers.isBudget(activity?.selection)
      ? ScGrantActivityService.resolveBudget(activity)
      : 0;
    if (ScGrantEntryHelpers.isBudget(activity?.selection) && budget < 1) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.NoBudget",
        "This grant has no points to spend."
      ));
      return { canceled: true, reason: "no-budget" };
    }

    const bastion = ScGrantBastionOrders.appliesTo(activity);
    if (bastion) {
      const blocker = ScGrantBastionOrders.blocker(activity);
      if (blocker) {
        ui.notifications?.warn?.(blocker);
        return { canceled: true, reason: "bastion-unavailable" };
      }
    }

    // A bastion order only writes to the user's own facility, and its items are
    // created later; only its table draws need the GM, as for any grant.
    const relay = bastion
      ? ScGrantActivityService.#drawsTablesAsPlayer(entries)
      : ScGrantActivityService.#shouldRelay(recipientActor, entries);
    if (relay && !ScGrantActivityService.#canRelay()) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.NoActiveGm",
        "An active GM is required to grant items to this actor."
      ));
      return { canceled: true, reason: "no-active-gm" };
    }

    try {
      const check = ScGrantEntryHelpers.normalizeCheck(activity?.check);
      let checkInfo = null;
      if (ScGrantEntryHelpers.isCheckEnabled(check)) {
        const checkResult = await ScGrantActivityService.#performCheck(activity, recipientActor, check);
        if (checkResult.canceled) {
          return { canceled: true, reason: "check-canceled" };
        }
        if (!checkResult.passed) {
          ui.notifications?.info?.(Constants.format(
            "SCMOREACTIVITIES.Activities.ScGrant.Info.CheckFailed",
            { actor: recipientActor.name ?? "", dc: checkResult.dc },
            `${recipientActor.name ?? "The actor"} failed the check (DC ${checkResult.dc}). No items granted.`
          ));
          return {
            canceled: false,
            checkPassed: false,
            check: {
              dc: checkResult.dc,
              total: Number(checkResult.roll?.total) || 0
            },
            updated: [],
            created: []
          };
        }
        checkInfo = {
          dc: checkResult.dc,
          total: Number(checkResult.roll?.total) || 0
        };
      }

      const picks = await ScGrantActivityService.#choose(activity, entries, { bastion, budget });
      const chosen = ScGrantEntryHelpers.applyPicks(entries, activity?.selection, picks, { budget });
      if (!chosen) {
        return { canceled: true, reason: "choice-canceled" };
      }

      if (bastion) {
        const issued = relay
          ? await ScGrantActivityService.#requestGmIssue(activity, recipient, checkInfo, picks)
          : await ScGrantBastionOrders.issue(activity, { recipientActor, entries: chosen, checkInfo });
        if (!issued.ok) {
          ui.notifications?.warn?.(issued.message);
          return { canceled: true, reason: "bastion-unavailable" };
        }
        ui.notifications?.info?.(ScGrantBastionOrders.issuedNotice(activity.item?.name, issued));
        return {
          canceled: false,
          checkPassed: true,
          check: checkInfo,
          actor: recipientActor,
          pending: true,
          updated: [],
          created: []
        };
      }

      const outcome = relay
        ? await ScGrantActivityService.#requestGmGrant(activity, recipient, checkInfo, picks)
        : await ScGrantActivityService.#grantItems(activity, sourceActor, recipientActor, chosen, checkInfo);

      if (!outcome.ok) {
        if (outcome.reason === "no-create-data") {
          ui.notifications?.warn?.(Constants.localize(
            "SCMOREACTIVITIES.Activities.ScGrant.Warning.NoResolvedItems",
            "No valid items could be resolved for this grant activity."
          ));
        } else if (outcome.message) {
          ui.notifications?.warn?.(outcome.message);
        }
        return { canceled: true, reason: outcome.reason ?? "gm-request-failed" };
      }

      ui.notifications?.info?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Info.GrantedItems",
        { count: outcome.totalGranted, actor: recipientActor.name ?? "" },
        `Granted ${outcome.totalGranted} item(s).`
      ));

      return {
        canceled: false,
        checkPassed: true,
        check: checkInfo,
        actor: recipientActor,
        updated: outcome.updated,
        created: outcome.created
      };
    } catch (error) {
      Logger.error("Could not execute sc-grant activity.", error);
      ui.notifications?.error?.(ScGrantActivityService.#executionFailedMessage(error));
      return { canceled: true, error };
    }
  }

  /**
   * Rolls the quantities and draws the tables of `entries`: what a grant will
   * deliver, as plain data that can be stored and applied later. `rolls` (the
   * Roll objects, for the chat card) are not part of the stored plan.
   */
  static async planGrant(rawEntries, rollData = {}, { itemFlags = [] } = {}) {
    const entries = ScGrantEntryHelpers.normalizeEntries(rawEntries);
    const { sources, lines, rolls } = await ScGrantActivityService.#resolveSources(entries, rollData);
    return {
      // Parsed here, once: from now on the values keep their types.
      itemFlags: ScGrantEntryHelpers.normalizeItemFlags(itemFlags),
      sources: sources.map(({ item, quantity, tableUuid }) => ({
        uuid: item.uuid,
        quantity,
        tableUuid: tableUuid ?? null
      })),
      lines,
      rolls
    };
  }

  /**
   * Delivers a completed bastion order's stored plan (see ScGrantBastionOrders).
   * Each source is written with `deliveryId`, so a retry after a partial
   * failure skips the sources that already reached the recipient. The sources
   * in `delivered` (indexes into `plan.sources`, as the order recorded them)
   * are skipped as well, and `onDelivered(index)` is awaited after each source
   * this attempt writes, so the order can record it. `holds()` is checked
   * before every write: once it is false (another client took the order over),
   * nothing else is written and the result is "claim-lost".
   *
   * `confirmUncertain({ item, quantity, actor })` is asked about a source that
   * goes to a stack whose legacy key list was full (see
   * LEGACY_MAX_DELIVERY_KEYS): it may have dropped this source's key, so
   * whether it arrived cannot be told. It resolves to "deliver" or "skip"
   * (already there); anything else stops with "uncertain". Without it, such
   * a source is delivered.
   */
  static async deliverPlan(recipientActor, plan, {
    activityId, deliveryId, checkInfo = null, banner = null, rolls = [], holds = () => true, itemFlags = null,
    delivered = [], onDelivered = null, confirmUncertain = null
  }) {
    // Like an immediate grant, a plan that resolved no item delivers nothing.
    if (!plan?.sources?.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.NoResolvedItems",
        "No valid items could be resolved for this grant activity."
      ));
      return { ok: false, reason: "no-items" };
    }
    try {
      const outcome = await ScGrantActivityService.#applyPlan(recipientActor, plan, {
        activityId, deliveryId, holds, itemFlags: itemFlags ?? plan.itemFlags, delivered, onDelivered, confirmUncertain
      });
      if (!holds()) {
        return { ok: false, reason: "claim-lost" };
      }
      await ScGrantActivityService.#createChatCard(null, recipientActor, plan.lines ?? [], rolls, checkInfo, banner);
      ui.notifications?.info?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Info.GrantedItems",
        { count: outcome.totalGranted, actor: recipientActor.name ?? "" },
        `Granted ${outcome.totalGranted} item(s).`
      ));
      return { ok: true, ...outcome };
    } catch (error) {
      if (error instanceof ClaimLostError) {
        return { ok: false, reason: "claim-lost" };
      }
      if (error instanceof UncertainDeliveryError) {
        return { ok: false, reason: "uncertain" };
      }
      Logger.error("Could not deliver an sc-grant bastion order.", error);
      ui.notifications?.error?.(ScGrantActivityService.#executionFailedMessage(error));
      return { ok: false, error };
    }
  }

  /**
   * Drops the delivery keys of a settled order (delivered or discarded) from
   * the recipient's stacks: no retry of it can happen any more, so they only
   * took space. Keys of other orders stay.
   */
  static async releaseDeliveryKeys(actor, deliveryId) {
    if (!actor || !LEDGER_SEGMENT.test(String(deliveryId ?? ""))) {
      return;
    }
    // Only this order's field is deleted: keys another delivery adds while
    // this update is in flight live in fields of their own and stay.
    const updates = Array.from(actor.items ?? [])
      .filter((item) => ScGrantActivityService.#ledgerOf(item)?.[deliveryId] !== undefined)
      .map((item) => ({ _id: item.id, ...ScGrantActivityService.#deleteLedgerOrder(deliveryId) }));
    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
    }
  }

  /** An update that deletes one order's keys from a stack's ledger, in the syntax this Foundry knows. */
  static #deleteLedgerOrder(deliveryId) {
    const parent = `flags.${Constants.MODULE_ID}.${LEDGER}`;
    const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
    return typeof ForcedDeletion === "function"
      ? { [`${parent}.${deliveryId}`]: new ForcedDeletion() }
      : { [`${parent}.-=${deliveryId}`]: null };
  }

  static #ledgerOf(item) {
    const ledger = item?.flags?.[Constants.MODULE_ID]?.[LEDGER];
    return ledger && typeof ledger === "object" && !Array.isArray(ledger) ? ledger : null;
  }

  /** The ledger field of a delivery key (`<orderId>.<index>`), or `null` for a key it cannot hold. */
  static #ledgerPath(key) {
    const [deliveryId, index, ...rest] = String(key).split(".");
    return !rest.length && LEDGER_SEGMENT.test(deliveryId ?? "") && /^\d+$/.test(index ?? "")
      ? { deliveryId, index }
      : null;
  }

  /**
   * The points a budget grant lets the user spend: a whole number or a
   * deterministic formula over the activity's roll data, so the GM resolves
   * the same budget when it checks a relayed choice.
   */
  static resolveBudget(activity) {
    const formula = ScGrantEntryHelpers.normalizeSelection(activity?.selection).budget;
    let value = Number(formula);
    if (!/^\d+$/.test(formula)) {
      const actor = activity?.actor ?? activity?.item?.actor ?? null;
      const rollData = activity?.getRollData?.({ deterministic: true })
        ?? actor?.getRollData?.({ deterministic: true })
        ?? {};
      const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
      value = typeof simplify === "function" ? simplify(formula, rollData) : Number.NaN;
    }
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  /**
   * What the user picked: source indices in the choose mode, one unit count
   * per source in the budget mode, `[]` when the activity grants every
   * source, or `null` when the user closed the picker.
   */
  static async #choose(activity, entries, { bastion = false, budget = 0 } = {}) {
    const isBudget = ScGrantEntryHelpers.isBudget(activity?.selection);
    const count = ScGrantEntryHelpers.choiceCount(activity?.selection, entries.length);
    if (!isBudget && !count) {
      return [];
    }

    const options = await Promise.all(entries.map(async(entry) => {
      const document = await ScGrantActivityService.#fromUuid(entry.uuid);
      const isTable = entry.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE;
      return {
        name: document?.name ?? entry.uuid,
        img: document?.img ?? (isTable ? "icons/svg/d20-grey.svg" : "icons/svg/item-bag.svg"),
        quantity: entry.quantity,
        cost: entry.cost,
        typeLabel: Constants.localize(
          isTable
            ? "SCMOREACTIVITIES.Activities.ScGrant.Fields.Source.TypeTable"
            : "SCMOREACTIVITIES.Activities.ScGrant.Fields.Source.TypeItem",
          isTable ? "Roll Table" : "Item"
        )
      };
    }));

    let note = "";
    if (bastion) {
      const { order, days } = ScGrantEntryHelpers.normalizeBastion(activity?.bastion);
      note = Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Bastion.ChoiceNote",
        { order: ScGrantBastionOrders.orderLabel(order), days },
        `Delivered when the order completes (${days} days).`
      );
    }

    return ScGrantChoiceApp.wait({
      title: activity?.name ?? "",
      mode: isBudget ? "budget" : "choose",
      count,
      budget,
      options,
      note
    });
  }

  /**
   * Resolves, stacks, and creates the granted items, then posts the chat
   * card. Runs on whichever client may write to the recipient: the user's own
   * when they own it, the GM's otherwise.
   */
  static async #grantItems(activity, sourceActor, recipientActor, entries, checkInfo, { banner = null } = {}) {
    const rollData = activity?.getRollData?.() ?? sourceActor?.getRollData?.() ?? {};
    const plan = await ScGrantActivityService.planGrant(entries, rollData, { itemFlags: activity?.itemFlags });
    if (!plan.sources.length) {
      return { ok: false, reason: "no-create-data" };
    }
    const outcome = await ScGrantActivityService.#applyPlan(recipientActor, plan, { activityId: activity?.id ?? null });
    await ScGrantActivityService.#createChatCard(activity, recipientActor, plan.lines, plan.rolls, checkInfo, banner);
    return { ok: true, ...outcome };
  }

  /**
   * Writes a plan's sources to the recipient, one source per write: a stack
   * gets its quantity raised, anything else is created. With a `deliveryId`,
   * each source's key is written in the same update as its items, and a
   * source whose key the recipient already holds is skipped, like a source
   * listed in `delivered`.
   */
  static async #applyPlan(recipientActor, plan, {
    activityId = null, deliveryId = null, holds = () => true, itemFlags = plan.itemFlags,
    delivered = [], onDelivered = null, confirmUncertain = null
  } = {}) {
    const created = [];
    const updated = [];
    const done = new Set(Array.isArray(delivered) ? delivered : []);
    let totalGranted = 0;

    for (const [index, source] of (plan.sources ?? []).entries()) {
      const key = deliveryId ? `${deliveryId}.${index}` : null;
      totalGranted += source.quantity;
      // Delivered sources are skipped before anything is loaded: their source
      // item may since have been deleted, which must not block the rest.
      if (done.has(index)) {
        continue;
      }
      if (key && ScGrantActivityService.#holdsDeliveryKey(recipientActor, key)) {
        // Delivered by an attempt that stopped before recording it.
        await onDelivered?.(index);
        continue;
      }

      const sourceItem = await fromUuid(source.uuid).catch(() => null);
      if (!sourceItem || !ScGrantActivityService.#isItemDocument(sourceItem)) {
        throw new Error(Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Error.InvalidUuid",
          { uuid: source.uuid },
          `Invalid grant item UUID: ${source.uuid}`
        ));
      }

      // A stack whose legacy key list was full may have dropped this key: only
      // whoever delivers can tell whether the source already arrived.
      if (key && confirmUncertain) {
        const target = ScGrantActivityService.#findExistingStack(recipientActor, sourceItem, activityId);
        if (target && ScGrantActivityService.#mayHaveDroppedKeys(target)) {
          const answer = await confirmUncertain({ item: sourceItem, quantity: source.quantity, actor: recipientActor });
          if (answer === "skip") {
            await onDelivered?.(index);
            continue;
          }
          if (answer !== "deliver") {
            throw new UncertainDeliveryError();
          }
        }
      }

      // From here to the write nothing awaits: the claim and the delivery key
      // are checked against the state the write starts from, so a client that
      // lost its claim, or a source another client delivered, is never written.
      if (key && ScGrantActivityService.#holdsDeliveryKey(recipientActor, key)) {
        await onDelivered?.(index);
        continue;
      }
      if (!holds()) {
        throw new ClaimLostError();
      }

      const stack = ScGrantActivityService.#findExistingStack(recipientActor, sourceItem, activityId);
      if (stack) {
        const update = {
          _id: stack.id,
          "system.quantity": (Number(stack.system?.quantity) || 0) + source.quantity
        };
        const entry = key ? ScGrantActivityService.#ledgerPath(key) : null;
        if (entry) {
          // A field of its own, never trimmed: it leaves only once its order is
          // settled (see releaseDeliveryKeys), and no other write rewrites it.
          update[`flags.${Constants.MODULE_ID}.${LEDGER}.${entry.deliveryId}.${entry.index}`] = true;
        }
        const result = await recipientActor.updateEmbeddedDocuments("Item", [update]) ?? [];
        // A hook can veto the update: nothing was delivered then.
        if (!result.length) {
          throw new Error(ScGrantActivityService.#refusedMessage(sourceItem));
        }
        updated.push(...result);
        await onDelivered?.(index);
        continue;
      }

      const documents = ScGrantActivityService.#createDocumentsForEntry(
        { item: sourceItem, quantity: source.quantity, tableUuid: source.tableUuid },
        activityId,
        key,
        itemFlags
      );
      created.push(...await ScGrantActivityService.#createDocuments(recipientActor, documents, key, sourceItem));
      await onDelivered?.(index);
    }

    return { totalGranted, created, updated };
  }


  /**
   * Creates a source's items. A keyed (bastion) delivery gives each item an id
   * derived from its delivery key and keeps it, so the same item can only be
   * created once: a creation still in flight from a client that lost its claim
   * and the creation of the client that took over cannot both land. Items that
   * already exist are skipped, and a conflict on those ids means another
   * attempt created them.
   */
  static async #createDocuments(actor, documents, key, sourceItem) {
    // A hook can veto a creation (Foundry then returns fewer documents, or
    // none): the source was not delivered, which must fail the delivery.
    if (!key) {
      const created = await actor.createEmbeddedDocuments("Item", documents) ?? [];
      if (created.length < documents.length) {
        throw new Error(ScGrantActivityService.#refusedMessage(sourceItem));
      }
      return created;
    }
    const pending = documents
      .map((data, copy) => ({ ...data, _id: ScGrantActivityService.#deliveryItemId(key, copy) }))
      .filter((data) => !ScGrantActivityService.#hasItem(actor, data._id));
    if (!pending.length) {
      return [];
    }
    let created = [];
    try {
      created = await actor.createEmbeddedDocuments("Item", pending, { keepId: true }) ?? [];
    } catch (error) {
      if (!pending.every((data) => ScGrantActivityService.#hasItem(actor, data._id))) {
        throw error;
      }
    }
    // Delivered only when every item exists, by this attempt or another one.
    if (!pending.every((data) => ScGrantActivityService.#hasItem(actor, data._id))) {
      throw new Error(ScGrantActivityService.#refusedMessage(sourceItem));
    }
    return created;
  }

  static #refusedMessage(sourceItem) {
    return Constants.format(
      "SCMOREACTIVITIES.Activities.ScGrant.Error.Refused",
      { item: sourceItem?.name ?? "" },
      `The creation of ${sourceItem?.name ?? "an item"} was refused.`
    );
  }

  static #hasItem(actor, id) {
    return Boolean(actor?.items?.get?.(id)) || Array.from(actor?.items ?? []).some((item) => (item.id ?? item._id) === id);
  }

  /**
   * A valid document id (16 alphanumeric characters) that depends only on a
   * delivery key and the copy number, so every client derives the same one.
   */
  static #deliveryItemId(key, copy) {
    const text = `${key}#${copy}`;
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b ^ code, 2246822519);
    }
    let id = "";
    for (let index = 0; index < 16; index += 1) {
      const state = index % 2 ? (a = ScGrantActivityService.#xorshift(a)) : (b = ScGrantActivityService.#xorshift(b));
      id += ID_CHARS[(state >>> 0) % ID_CHARS.length];
    }
    return id;
  }

  static #xorshift(value) {
    let state = value || 1;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state;
  }

  /**
   * Whether a source was fully delivered: added to a stack (which keeps the
   * key), or created with every copy it needs. A creation that a hook cut
   * short leaves copies missing, so the source is not delivered yet.
   */
  static #holdsDeliveryKey(actor, key) {
    const items = Array.from(actor?.items ?? []);
    const flagsOf = (item) => item.flags?.[Constants.MODULE_ID] ?? {};
    const entry = ScGrantActivityService.#ledgerPath(key);
    const stacked = (item) => (entry && ScGrantActivityService.#ledgerOf(item)?.[entry.deliveryId]?.[entry.index] === true)
      || (Array.isArray(flagsOf(item).grantDeliveryKeys) && flagsOf(item).grantDeliveryKeys.includes(key));
    if (items.some(stacked)) {
      return true;
    }
    const copies = Number(items.find((item) => flagsOf(item).grantDeliveryKey === key)
      ?.flags?.[Constants.MODULE_ID]?.grantDeliveryCopies);
    if (!Number.isInteger(copies) || copies < 1) {
      return false;
    }
    return Array.from({ length: copies }, (_unused, copy) => ScGrantActivityService.#deliveryItemId(key, copy))
      .every((id) => ScGrantActivityService.#hasItem(actor, id));
  }

  /** Whether a stack's legacy key list was full, and so may have dropped keys of pending orders. */
  static #mayHaveDroppedKeys(stack) {
    const legacy = stack?.flags?.[Constants.MODULE_ID]?.grantDeliveryKeys;
    return Array.isArray(legacy) && legacy.length >= LEGACY_MAX_DELIVERY_KEYS;
  }

  /**
   * Players hand the write to the GM when they cannot make it themselves:
   * the recipient belongs to someone else, or a roll table draw has to mark
   * world table results as drawn. With no GM online, a player who owns the
   * recipient still grants locally, as before.
   */
  static #shouldRelay(recipientActor, entries) {
    if (game?.user?.isGM) {
      return false;
    }
    if (!recipientActor?.isOwner) {
      return true;
    }
    const drawsTables = entries.some((entry) => entry.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE);
    return drawsTables && ScGrantActivityService.#canRelay();
  }

  /** Whether a player's grant draws world tables, whose results only a GM may mark as drawn. */
  static #drawsTablesAsPlayer(entries) {
    if (game?.user?.isGM) {
      return false;
    }
    const drawsTables = entries.some((entry) => entry.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE);
    return drawsTables && ScGrantActivityService.#canRelay();
  }

  static async #requestGmIssue(activity, recipient, checkInfo, picks) {
    const result = await ScGrantActivityService.#requestGmGrant(activity, recipient, checkInfo, picks);
    return result.ok && result.bastion ? { ok: true, ...result.bastion } : { ok: false, message: result.message };
  }

  static #canRelay() {
    const gm = ScGrantActivityService.#activeGmUser();
    return Boolean(gm && typeof gm.query === "function" && globalThis.CONFIG?.queries?.[QUERY_ID]);
  }

  static async #requestGmGrant(activity, recipient, checkInfo, picks = []) {
    const gm = ScGrantActivityService.#activeGmUser();
    try {
      const result = await gm.query(QUERY_ID, {
        activityUuid: activity?.uuid ?? null,
        recipientUuid: recipient.token?.uuid ?? recipient.actor?.uuid ?? null,
        requestUserId: game?.user?.id ?? null,
        scaling: ScUsageScaling.of(activity),
        check: checkInfo,
        picks
      }, { timeout: QUERY_TIMEOUT });
      return {
        ok: result?.ok === true,
        reason: result?.reason,
        message: result?.message,
        totalGranted: Number(result?.totalGranted) || 0,
        bastion: result?.bastion ?? null,
        created: Array.isArray(result?.created) ? result.created : [],
        updated: Array.isArray(result?.updated) ? result.updated : []
      };
    } catch (error) {
      Logger.error("Could not request a GM grant.", error);
      return {
        ok: false,
        message: Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Warning.GmRequestFailed",
          { error: error?.message ?? String(error) },
          `Could not ask the GM to grant these items: ${error?.message ?? String(error)}`
        )
      };
    }
  }

  static async #requestedRecipient(activity, sourceActor, recipientUuid) {
    const mode = String(activity?.recipient ?? "self").trim().toLowerCase();
    if (mode !== "target") {
      return sourceActor;
    }
    // Targets are always sent as token UUIDs, so a relayed grant can only reach
    // an actor that is actually placed on a scene.
    const document = await ScGrantActivityService.#fromUuid(recipientUuid);
    const isToken = document?.documentName === "Token" || document?.constructor?.documentName === "Token";
    return isToken ? document.actor ?? null : null;
  }

  static #canUseActivity(activity, user) {
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

  static #activeGmUser() {
    const activeGm = game?.users?.activeGM;
    if (activeGm?.active && activeGm?.isGM) {
      return activeGm;
    }
    return game?.users?.find?.((user) => user?.active && user?.isGM) ?? null;
  }

  static async #fromUuid(uuid) {
    if (!uuid || typeof globalThis.fromUuid !== "function") {
      return null;
    }
    try {
      return await globalThis.fromUuid(uuid);
    } catch (error) {
      Logger.warn("Could not resolve sc-grant UUID.", error);
      return null;
    }
  }

  static #invalidRequest() {
    return ScGrantActivityService.#failure(
      "SCMOREACTIVITIES.Activities.ScGrant.Warning.InvalidRequest",
      "The grant request is no longer valid."
    );
  }

  static #failure(key, fallback) {
    return { ok: false, message: Constants.localize(key, fallback) };
  }

  static #executionFailedMessage(error) {
    return Constants.format(
      "SCMOREACTIVITIES.Activities.ScGrant.Error.ExecutionFailed",
      { error: error?.message ?? String(error) },
      `Could not grant items: ${error?.message ?? String(error)}`
    );
  }

  static #resolveRecipient(activity, sourceActor) {
    const recipient = String(activity?.recipient ?? "self").trim().toLowerCase();
    if (recipient !== "target") {
      return { actor: sourceActor, token: null };
    }

    const targets = Array.from(game?.user?.targets ?? []);
    if (targets.length !== 1) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.TargetRequired",
        "Target exactly one token to receive granted items."
      ));
      return null;
    }

    const targetActor = targets[0]?.actor ?? null;
    if (!targetActor) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.TargetActorMissing",
        "The selected target token does not have a valid actor."
      ));
      return null;
    }

    return { actor: targetActor, token: targets[0]?.document ?? null };
  }

  static async #performCheck(activity, actor, check) {
    const dc = await ScGrantActivityService.resolveCheckDc(activity, check);
    let rolls = null;

    if (check.skill && typeof actor?.rollSkill === "function") {
      rolls = await actor.rollSkill({
        skill: check.skill,
        ability: check.ability || undefined,
        target: dc
      }, {}, {});
    } else if (check.ability && typeof actor?.rollAbilityCheck === "function") {
      rolls = await actor.rollAbilityCheck({
        ability: check.ability,
        target: dc
      }, {}, {});
    } else {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.CheckUnavailable",
        "Could not roll the configured grant check."
      ));
      return { canceled: true };
    }

    const roll = ScGrantActivityService.#extractRoll(rolls);
    if (!roll) {
      return { canceled: true };
    }

    return {
      canceled: false,
      passed: (Number(roll.total) || 0) >= dc,
      dc,
      roll
    };
  }

  static async resolveCheckDc(activity, check) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const calculation = check.dc.calculation;

    let ability = "";
    if (calculation === "spellcasting") {
      ability = activity?.spellcastingAbility
        ?? actor?.system?.attributes?.spellcasting
        ?? "";
    } else if (calculation) {
      ability = calculation;
    }

    if (ability) {
      const abilityDc = Number(actor?.system?.abilities?.[ability]?.dc);
      if (Number.isFinite(abilityDc) && abilityDc > 0) {
        return abilityDc;
      }
      return 8 + (Number(actor?.system?.attributes?.prof) || 0);
    }

    const formula = check.dc.formula;
    if (formula) {
      const rollData = activity?.getRollData?.({ deterministic: true })
        ?? actor?.getRollData?.({ deterministic: true })
        ?? {};
      const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
      const value = typeof simplify === "function"
        ? simplify(formula, rollData)
        : Number(formula);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }

    return 10;
  }

  static #extractRoll(rolls) {
    if (!rolls) {
      return null;
    }
    if (Array.isArray(rolls)) {
      return rolls.find((roll) => Number.isFinite(Number(roll?.total))) ?? null;
    }
    return Number.isFinite(Number(rolls?.total)) ? rolls : null;
  }

  static async #resolveSources(entries, rollData) {
    const grouped = new Map();
    const lines = [];
    const rolls = [];
    const append = (item, quantity, tableUuid = null) => {
      const key = item.uuid ?? item.id;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        grouped.set(key, { item, quantity, tableUuid });
      }
    };

    for (const entry of entries) {
      const { quantity, roll } = await ScGrantActivityService.#rollQuantity(entry.quantity, rollData);
      if (roll) {
        rolls.push(roll);
      }

      if (entry.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE) {
        const table = await fromUuid(entry.uuid).catch(() => null);
        if (!table || table.documentName !== "RollTable") {
          ui.notifications?.warn?.(Constants.format(
            "SCMOREACTIVITIES.Activities.ScGrant.Warning.InvalidTable",
            { uuid: entry.uuid },
            `Invalid roll table UUID: ${entry.uuid}`
          ));
          continue;
        }
        const ignored = [];
        const drawn = await ScGrantActivityService.#drawTable(table, quantity, { ignored });
        for (const drawnItem of drawn.items) {
          append(drawnItem, 1, table.uuid);
        }
        ScGrantActivityService.#warnIgnored(ignored);
        lines.push({
          kind: "table",
          uuid: table.uuid,
          name: table.name ?? "",
          img: table.img ?? "",
          draws: quantity,
          formula: roll ? roll.formula : null,
          total: roll?.total ?? null,
          items: drawn.rows
        });
        continue;
      }

      const item = await fromUuid(entry.uuid).catch(() => null);
      if (!item || !ScGrantActivityService.#isItemDocument(item)) {
        throw new Error(Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Error.InvalidUuid",
          { uuid: entry.uuid },
          `Invalid grant item UUID: ${entry.uuid}`
        ));
      }
      append(item, quantity);
      lines.push({
        kind: "item",
        uuid: item.uuid,
        name: item.name ?? "",
        img: item.img ?? "",
        quantity,
        formula: roll ? roll.formula : null,
        total: roll?.total ?? null
      });
    }

    return { sources: Array.from(grouped.values()), lines, rolls };
  }

  static async #rollQuantity(formula, rollData) {
    const normalized = ScGrantEntryHelpers.normalizeQuantityFormula(formula);
    if (/^\d+$/.test(normalized)) {
      return { quantity: ScGrantEntryHelpers.coerceQuantity(normalized), roll: null };
    }
    try {
      const roll = new Roll(normalized, rollData);
      await roll.evaluate();
      return { quantity: ScGrantEntryHelpers.coerceQuantity(roll.total), roll };
    } catch {
      return { quantity: 1, roll: null };
    }
  }

  static async #createChatCard(activity, recipientActor, lines, rolls, checkInfo, banner = null) {
    if (!lines.length) {
      return;
    }

    const notes = [];
    if (checkInfo) {
      notes.push({
        icon: "fa-dice-d20",
        text: Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Card.CheckPassed",
          { dc: checkInfo.dc, total: checkInfo.total },
          `Check passed (DC ${checkInfo.dc}, rolled ${checkInfo.total}).`
        )
      });
    }

    const content = ScGrantCard.content({
      banner: banner ?? ScGrantActivityService.#defaultBanner(activity),
      intro: Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Card.Received",
        { actor: recipientActor.name ?? "" },
        `${recipientActor.name ?? "The actor"} received:`
      ),
      lines,
      notes,
      emptyText: Constants.localize("SCMOREACTIVITIES.Activities.ScGrant.Card.TableEmpty", "No items drawn."),
      drawsText: (count) => Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Card.TableDraws",
        { count },
        `${count} draw(s)`
      )
    });

    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: recipientActor }),
        content,
        rolls
      });
    } catch (error) {
      Logger.warn("Could not create sc-grant chat card.", error);
    }
  }

  /** The card's banner for a grant used directly: the item it comes from, and the activity. */
  static #defaultBanner(activity) {
    const item = activity?.item ?? null;
    const title = item?.name || activity?.name || "";
    const subtitle = activity?.name && activity.name !== title ? activity.name : "";
    return { img: item?.img ?? "", title, subtitle };
  }

  /**
   * Draws `draws` results from `table` and, in turn, from the inner tables
   * they name, down to ScGrantTableResults.MAX_DEPTH levels. Returns the
   * items drawn (one per unit) and the card rows: items by count, and inner
   * tables with what they drew. Results that grant nothing are collected in
   * `ignored` (see #warnIgnored) instead of failing the draw.
   */
  static async #drawTable(table, draws, { depth = 1, chain = [table.uuid], ignored = [] } = {}) {
    const { CYCLE, TOO_DEEP, NOT_ITEM } = ScGrantTableResults.CODES;
    // Inner tables are drawn here rather than by Foundry, which would mark
    // their results as drawn on this table and does not follow text links.
    const { results } = await table.drawMany(draws, { displayChat: false, recursive: false });
    const items = [];
    const rows = new Map();
    const inner = new Map();

    for (const result of results ?? []) {
      const classified = await ScGrantTableResults.classify(result, ScGrantActivityService.#resolveDocument);
      for (const item of classified.items) {
        items.push(item);
        const key = `item:${item.uuid ?? item.id}`;
        const row = rows.get(key);
        if (row) {
          row.quantity += 1;
        } else {
          rows.set(key, { kind: "item", uuid: item.uuid, name: item.name ?? "", img: item.img ?? "", quantity: 1 });
        }
      }
      for (const nested of classified.tables) {
        if (chain.includes(nested.uuid)) {
          ignored.push({ table, result, code: CYCLE });
        } else if (depth >= ScGrantTableResults.MAX_DEPTH) {
          ignored.push({ table, result, code: TOO_DEEP });
        } else {
          const pending = inner.get(nested.uuid) ?? { table: nested, draws: 0 };
          pending.draws += 1;
          inner.set(nested.uuid, pending);
          // Keeps the card in draw order: the row is filled once the table is drawn.
          if (!rows.has(`table:${nested.uuid}`)) {
            rows.set(`table:${nested.uuid}`, null);
          }
        }
      }
      if (!classified.items.length && !classified.tables.length) {
        ignored.push({ table, result, code: NOT_ITEM });
      }
    }

    for (const { table: nested, draws: count } of inner.values()) {
      const drawn = await ScGrantActivityService.#drawTable(nested, count, {
        depth: depth + 1,
        chain: [...chain, nested.uuid],
        ignored
      });
      items.push(...drawn.items);
      rows.set(`table:${nested.uuid}`, {
        kind: "table",
        uuid: nested.uuid,
        name: nested.name ?? "",
        img: nested.img ?? "",
        draws: count,
        items: drawn.rows
      });
    }

    return { items, rows: Array.from(rows.values()).filter(Boolean) };
  }

  /** One warning per table and reason for the drawn results that granted nothing. */
  static #warnIgnored(ignored) {
    const { CYCLE, TOO_DEEP } = ScGrantTableResults.CODES;
    const groups = new Map();
    for (const entry of ignored) {
      const key = `${entry.table.uuid ?? entry.table.name}|${entry.code}`;
      const group = groups.get(key) ?? { table: entry.table, code: entry.code, results: [] };
      group.results.push(entry.result);
      groups.set(key, group);
    }

    for (const { table, code, results } of groups.values()) {
      const names = results.map((result) => `"${ScGrantTableResults.label(result)}"`).join(", ");
      const data = { count: results.length, table: table.name ?? "", results: names, max: ScGrantTableResults.MAX_DEPTH };
      let message;
      if (code === CYCLE) {
        message = Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Warning.TableCycle",
          data,
          `${data.count} result(s) from "${data.table}" lead back to a table they were drawn from and were ignored: ${names}.`
        );
      } else if (code === TOO_DEEP) {
        message = Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Warning.TableTooDeep",
          data,
          `${data.count} result(s) from "${data.table}" go deeper than ${data.max} levels of roll tables and were ignored: ${names}.`
        );
      } else {
        message = Constants.format(
          "SCMOREACTIVITIES.Activities.ScGrant.Warning.TableInvalidResults",
          data,
          `${data.count} result(s) from "${data.table}" did not resolve to items and were ignored: ${names}`
        );
      }
      ui.notifications?.warn?.(message);
      Logger.warn(`Results drawn from "${table.name ?? ""}" (${table.uuid ?? ""}) that grant no item (${code}):`, results.map((result) => ({
        name: result?.name ?? "",
        type: result?.type ?? "",
        documentUuid: result?.documentUuid ?? null,
        description: result?.description ?? ""
      })));
    }
  }

  static async #resolveDocument(uuid, relative) {
    return await fromUuid(uuid, { relative }) ?? null;
  }

  static #isItemDocument(document) {
    return document?.documentName === "Item" || document?.constructor?.documentName === "Item";
  }

  static #createDocumentsForEntry(source, activityId = null, deliveryKey = null, itemFlags = []) {
    const { item: sourceItem, quantity, tableUuid } = source;
    const baseData = sourceItem.toObject();
    delete baseData._id;

    const moduleFlags = {
      grantActivityId: activityId,
      grantSourceUuid: sourceItem.uuid ?? null
    };
    if (tableUuid) {
      moduleFlags.grantTableUuid = tableUuid;
    }
    if (deliveryKey) {
      moduleFlags.grantDeliveryKey = deliveryKey;
      moduleFlags.grantDeliveryCopies = ScGrantActivityService.#supportsQuantity(baseData) ? 1 : quantity;
    }
    const flags = foundry.utils.mergeObject(baseData.flags ?? {}, {
      [Constants.MODULE_ID]: moduleFlags
    }, { inplace: false });
    // Parsed flags: their keys are checked again, their values written as they are.
    for (const { key, value } of Array.isArray(itemFlags) ? itemFlags : []) {
      if (ScGrantEntryHelpers.isValidItemFlagKey(key)) {
        foundry.utils.setProperty(flags, key, foundry.utils.deepClone(value));
      }
    }

    if (ScGrantActivityService.#supportsQuantity(baseData)) {
      baseData.system.quantity = quantity;
      baseData.flags = flags;
      return [baseData];
    }

    const documents = [];
    for (let index = 0; index < quantity; index += 1) {
      const clone = foundry.utils.deepClone(baseData);
      clone.flags = foundry.utils.deepClone(flags);
      documents.push(clone);
    }
    return documents;
  }

  static #supportsQuantity(itemData) {
    return typeof itemData?.system?.quantity === "number";
  }

  static #findExistingStack(actor, sourceItem, activityId) {
    return Array.from(actor.items ?? []).find((item) => {
      const sourceUuid = item.flags?.[Constants.MODULE_ID]?.grantSourceUuid;
      const grantActivityId = item.flags?.[Constants.MODULE_ID]?.grantActivityId;
      const compendiumSource = item?._source?._stats?.compendiumSource ?? item?.system?._source?.compendiumSource ?? null;
      return ScGrantActivityService.#supportsQuantity(item.toObject())
        && (sourceUuid === sourceItem.uuid || compendiumSource === sourceItem.uuid)
        && (grantActivityId === activityId || compendiumSource === sourceItem.uuid);
    }) ?? null;
  }
}
