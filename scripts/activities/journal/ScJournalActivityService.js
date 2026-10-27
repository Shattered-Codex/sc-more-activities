import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const LANG = "SCMOREACTIVITIES.Activities.ScJournal";
const PAGE_UUID = /^(.+)\.JournalEntryPage\.([^.]+)$/;

/**
 * Opens the activity's journal entry, at one of its pages if it names one,
 * for the user who used it, whatever their ownership of it.
 *
 * Every client already holds the world's journals; ownership only decides
 * what the interface shows. So this is the same as core's "Show to Players"
 * with force, run on the user's own client: the sheet opens with a temporary
 * Observer level that it drops again once closed, and nothing is saved. No GM
 * is needed. Pages the GM set to None on their own stay hidden when the whole
 * entry opens, as they do for a forced show.
 */
export class ScJournalActivityService {
  /**
   * Opens the journal. Resolves with `{ opened: true, entry, page }`, or
   * `{ opened: false, reason }` after warning the user.
   */
  static async open(activity) {
    const target = await ScJournalActivityService.resolve(activity?.journal);
    if (target.error) {
      ScJournalActivityService.#warn(target.error);
      return { opened: false, reason: target.error };
    }

    const { entry, page } = target;
    if (activity.journal.pageId && !page) {
      ScJournalActivityService.#warn("page-not-found");
    }
    try {
      await foundry.documents.collections.Journal._showEntry((page ?? entry).uuid, true);
    } catch (error) {
      Logger.error("Could not open sc-journal activity.", error);
      ui.notifications?.error?.(Constants.format(
        `${LANG}.Error.OpenFailed`,
        { error: error?.message ?? String(error) },
        `Could not open the journal: ${error?.message ?? String(error)}`
      ));
      return { opened: false, reason: "open-failed" };
    }
    return { opened: true, entry, page };
  }

  /**
   * The stored `{ uuid, pageId }` as documents: `{ entry, page }`, with `page`
   * null for the whole entry or a page that is gone, or `{ error }`.
   */
  static async resolve(journal) {
    const uuid = String(journal?.uuid ?? "").trim();
    if (!uuid) {
      return { error: "missing-journal" };
    }
    const entry = await ScJournalActivityService.#fromUuid(uuid);
    if (!ScJournalActivityService.#is(entry, "JournalEntry")) {
      return { error: "journal-not-found" };
    }
    const pageId = String(journal?.pageId ?? "").trim();
    return { entry, page: pageId ? entry.pages?.get?.(pageId) ?? null : null };
  }

  /**
   * What a dropped or pasted uuid names, as the activity stores it:
   * `{ uuid, pageId, name }`, or `null` when it is not a journal entry or one
   * of its pages.
   */
  static async targetFromUuid(uuid) {
    const document = await ScJournalActivityService.#fromUuid(String(uuid ?? "").trim());
    if (ScJournalActivityService.#is(document, "JournalEntryPage") && document.parent) {
      return { uuid: document.parent.uuid, pageId: document.id, name: document.name ?? "" };
    }
    if (ScJournalActivityService.#is(document, "JournalEntry")) {
      return { uuid: document.uuid, pageId: "", name: document.name ?? "" };
    }
    return null;
  }

  /** Splits a page uuid into its entry's uuid and the page id; any other uuid is kept whole. */
  static splitUuid(uuid) {
    const text = String(uuid ?? "").trim();
    const match = PAGE_UUID.exec(text);
    return match ? { uuid: match[1], pageId: match[2] } : { uuid: text, pageId: null };
  }

  /** The entry's pages in their order, as `{ value, label }`. */
  static pageOptions(entry) {
    const pages = entry?.pages?.contents ?? Array.from(entry?.pages ?? []);
    return [...pages]
      .sort((left, right) => (Number(left.sort) || 0) - (Number(right.sort) || 0))
      .map((page) => ({ value: page.id, label: page.name ?? page.id }));
  }

  static #warn(reason) {
    const messages = {
      "missing-journal": ["Warning.MissingJournal", "Choose a journal before using this activity."],
      "journal-not-found": ["Warning.JournalNotFound", "The journal for this activity no longer exists."],
      "page-not-found": ["Warning.PageNotFound", "The page for this activity no longer exists, so the whole journal opens."]
    };
    const [key, fallback] = messages[reason];
    ui.notifications?.warn?.(Constants.localize(`${LANG}.${key}`, fallback));
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
      Logger.warn("Could not resolve sc-journal UUID.", error);
      return null;
    }
  }
}
