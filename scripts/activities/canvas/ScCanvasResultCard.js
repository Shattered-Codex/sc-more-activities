import { Constants } from "../../constants/Constants.js";
import { ModuleSettings } from "../../settings/ModuleSettings.js";
import { Logger } from "../../support/Logger.js";

export class ScCanvasResultCard {
  static async createMovementCard(activity, outcome = {}) {
    return ScCanvasResultCard.#create(activity, outcome, {
      activityType: "sc-movement",
      titleKey: "SCMOREACTIVITIES.Activities.Canvas.Card.MovementTitle",
      titleFallback: "Movement Result",
      affectedKey: "SCMOREACTIVITIES.Activities.Canvas.Card.Moved",
      affectedFallback: "Moved"
    });
  }

  static async createTeleportCard(activity, outcome = {}) {
    return ScCanvasResultCard.#create(activity, outcome, {
      activityType: "sc-teleport",
      titleKey: "SCMOREACTIVITIES.Activities.Canvas.Card.TeleportTitle",
      titleFallback: "Teleport Result",
      affectedKey: "SCMOREACTIVITIES.Activities.Canvas.Card.Teleported",
      affectedFallback: "Teleported"
    });
  }

  /** Builds a name/image entry for a token document, mirroring the contest card identity chain. */
  static tokenEntry(token) {
    const actor = token?.actor ?? null;
    return {
      id: token?.id ?? "",
      actorId: actor?.id ?? "",
      actorUuid: actor?.uuid ?? "",
      name: token?.name ?? actor?.name ?? "",
      img: token?.texture?.src
        ?? actor?.img
        ?? actor?.prototypeToken?.texture?.src
        ?? globalThis.CONST?.DEFAULT_TOKEN
        ?? "icons/svg/mystery-man.svg"
    };
  }

  /** Removes each skipped name once from the sent entries, leaving the tokens that were actually affected. */
  static affectedEntries(sentEntries, skippedNames) {
    const remaining = [...(sentEntries ?? [])];
    for (const name of skippedNames ?? []) {
      const index = remaining.findIndex((entry) => ScCanvasResultCard.#entry(entry).name === name);
      if (index >= 0) {
        remaining.splice(index, 1);
      }
    }
    return remaining;
  }

  /**
   * Renders entries as a native dnd5e chat-card target list (token image and
   * name per row). Accepts plain strings as image-less entries.
   */
  static targetList(entries) {
    const rows = (entries ?? [])
      .map((value) => ScCanvasResultCard.#entry(value))
      .filter((entry) => entry.name)
      .map((entry) => {
        const image = entry.img
          ? `<img class="gold-icon" src="${ScCanvasResultCard.#escape(entry.img)}" alt="${ScCanvasResultCard.#escape(entry.name)}">`
          : "";
        return `
          <li class="flexrow">
            ${image}
            <span class="name-stacked">
              <span class="title">${ScCanvasResultCard.#escape(entry.name)}</span>
            </span>
          </li>
        `;
      });
    return rows.length ? `<ul class="action-list unlist">${rows.join("")}</ul>` : "";
  }

  /** Renders a labelled target section in the native dnd5e chat-card style. */
  static targetSection(label, entries) {
    const list = ScCanvasResultCard.targetList(entries);
    if (!list) {
      return "";
    }
    return `
      <section class="targets">
        <strong class="roboto-condensed-upper">${ScCanvasResultCard.#escape(label)}</strong>
        ${list}
      </section>
    `;
  }

  static async #create(activity, { affected = [], resisted = [], unresolved = [], skipped = [] }, labels) {
    if (!ModuleSettings.isCanvasResultCardsEnabled()) {
      return null;
    }

    try {
      const sections = [];
      if (affected.length) {
        sections.push(ScCanvasResultCard.targetSection(
          Constants.localize(labels.affectedKey, labels.affectedFallback),
          affected
        ));
      }
      if (resisted.length) {
        sections.push(ScCanvasResultCard.targetSection(
          Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Card.Resisted", "Resisted"),
          resisted
        ));
      }
      if (unresolved.length) {
        sections.push(ScCanvasResultCard.targetSection(
          Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Card.Unresolved", "Not completed"),
          unresolved
        ));
      }
      if (skipped.length) {
        sections.push(ScCanvasResultCard.targetSection(
          Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Card.OutOfRange", "Out of range"),
          skipped
        ));
      }
      if (!sections.filter(Boolean).length) {
        return null;
      }

      // "Every target resisted" is only true when the resisted list accounts
      // for everyone: unfinished saves or out-of-range targets tell their own
      // story through their rows.
      const everyTargetResisted = !affected.length && resisted.length > 0
        && !unresolved.length && !skipped.length;
      const note = everyTargetResisted ? `
        <p class="supplement">${ScCanvasResultCard.#escape(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Save.Info.NoneAffected",
          "Every target resisted. No token was affected."
        ))}</p>
      ` : "";

      // No module scoping class here on purpose: the module palette is built
      // for its dark application panels, and on the light chat parchment it
      // washes the text out. The card inherits the dnd5e chat-card look only.
      const resultTitle = Constants.localize(labels.titleKey, labels.titleFallback);
      const content = `
        <div class="chat-card sc-ma-canvas-card">
          ${ScCanvasResultCard.#header(activity, resultTitle)}
          ${sections.join("")}
          ${note}
        </div>
      `;

      const actor = activity?.actor ?? activity?.item?.actor ?? null;
      return await ChatMessage.create({
        speaker: ScCanvasResultCard.#speaker(actor),
        content,
        flags: {
          [Constants.MODULE_ID]: {
            activityType: labels.activityType,
            activityId: activity?.id ?? activity?._id ?? null,
            affectedCount: affected.length,
            resistedCount: resisted.length
          }
        }
      });
    } catch (error) {
      Logger.warn("Could not create the canvas result chat card.", error);
      return null;
    }
  }

  static #entry(value) {
    if (typeof value === "string") {
      return { name: value, img: "" };
    }
    return {
      name: String(value?.name ?? ""),
      img: String(value?.img ?? "")
    };
  }

  /** Builds the native dnd5e card header: item image, item name, and a subtitle. */
  static #header(activity, resultTitle) {
    const itemName = String(activity?.item?.name ?? "").trim();
    const activityName = String(activity?.name ?? "").trim();
    const title = itemName || activityName || resultTitle;
    const subtitleParts = [];
    if (activityName && activityName !== title) {
      subtitleParts.push(activityName);
    }
    if (resultTitle && resultTitle !== title) {
      subtitleParts.push(resultTitle);
    }
    const subtitle = subtitleParts.join(" — ");
    const image = activity?.item?.img
      ?? activity?.actor?.img
      ?? "icons/svg/mystery-man.svg";

    return `
      <section class="card-header">
        <header class="summary">
          <img class="gold-icon" src="${ScCanvasResultCard.#escape(image)}" alt="${ScCanvasResultCard.#escape(title)}">
          <div class="name-stacked border">
            <span class="title">${ScCanvasResultCard.#escape(title)}</span>
            ${subtitle ? `<span class="subtitle">${ScCanvasResultCard.#escape(subtitle)}</span>` : ""}
          </div>
        </header>
      </section>
    `;
  }

  static #speaker(actor) {
    const ChatMessageClass = globalThis.ChatMessage;
    const data = { actor };
    return ChatMessageClass?.implementation?.getSpeaker?.(data)
      ?? ChatMessageClass?.getSpeaker?.(data)
      ?? data;
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
