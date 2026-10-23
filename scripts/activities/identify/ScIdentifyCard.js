import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScItemRarityColorsIntegration } from "../../integrations/sc-item-rarity-colors/ScItemRarityColorsIntegration.js";

const LANG = "SCMOREACTIVITIES.Activities.ScIdentify";

/**
 * The chat card of an identification. Once the item is identified it shows the
 * reveal: the item's art framed in its rarity color, its true name (a link),
 * rarity, type and attunement, the name it went by until now, who identified
 * it, and the check that did it.
 */
export class ScIdentifyCard {
  /** Styles the revealed item with SC Item Rarity Colors when that module is active. */
  static registerHooks() {
    Hooks.on("renderChatMessageHTML", (_message, html) => ScIdentifyCard.#onRender(html));
  }

  /**
   * @param {object} outcome
   * @param {string} outcome.status        "pending", "identified", "failed", or "refused".
   * @param {Actor} [outcome.identifier]   Who identified it.
   * @param {Actor} [outcome.owner]        Whose item it is.
   * @param {Item} [outcome.item]
   * @param {string} [outcome.formerName]  The name the item showed while unidentified.
   * @param {object} [outcome.check]       `{ dc, total }` when a check was rolled.
   * @param {string} [outcome.checkName]   The check's skill or ability, such as "Arcana".
   */
  static content({ status, identifier = null, owner = null, item = null, formerName = "", check = null, checkName = "" } = {}) {
    if (status === "identified" && item) {
      try {
        return ScIdentifyCard.#revealed({ identifier, owner, item, formerName, check, checkName });
      } catch (error) {
        // The item is already identified; a plainer card must not undo that.
        Logger.warn("Could not build the identify card.", error);
        const text = Constants.format(`${LANG}.Card.Identified`, { actor: identifier?.name ?? "" }, `${identifier?.name ?? ""} identified:`);
        return `<div class="sc-ma-identify-card"><p class="sc-ma-identify-card-note">${ScIdentifyCard.#escape(text)} `
          + `@UUID[${item.uuid}]{${ScIdentifyCard.#escape(item.name ?? "")}}</p></div>`;
      }
    }

    const actor = identifier?.name ?? "";
    const ownerName = owner?.name ?? "";
    let text = "";
    if (status === "pending") {
      text = Constants.format(`${LANG}.Card.Pending`, { actor, owner: ownerName },
        `${actor} is trying to identify an item of ${ownerName}…`);
    } else if (status === "failed") {
      text = Constants.format(`${LANG}.Card.Failed`, { actor, item: item?.name ?? "" },
        `${actor} could not identify ${item?.name ?? "the item"}.`);
    } else {
      text = Constants.localize(`${LANG}.Card.Refused`, "The identify request was refused.");
    }
    const icon = status === "pending" ? "fa-hourglass-half" : "fa-circle-question";
    return `<div class="sc-ma-identify-card sc-ma-identify-card--${ScIdentifyCard.#escape(status ?? "refused")}">`
      + `<p class="sc-ma-identify-card-note"><i class="fa-solid ${icon}" inert></i> ${ScIdentifyCard.#escape(text)}</p>`
      + "</div>";
  }

  static #revealed({ identifier, owner, item, formerName, check, checkName }) {
    const escape = ScIdentifyCard.#escape;
    const rarity = String(item.system?.rarity ?? "").trim();
    const rarityKey = globalThis.CONFIG?.DND5E?.itemRarity?.[rarity] ?? rarity;
    const rarityLabel = rarity ? Constants.localize(rarityKey, rarityKey) : "";
    const meta = [ScIdentifyCard.#typeLabel(item), ScIdentifyCard.#attunementLabel(item)].filter(Boolean).join(" · ");
    const name = item.name ?? "";
    const forOther = Boolean(owner && identifier && owner !== identifier && owner.uuid !== identifier.uuid);
    const by = forOther
      ? Constants.format(`${LANG}.Card.ByFor`, { actor: identifier.name ?? "", owner: owner.name ?? "" },
        `${identifier.name ?? ""} · ${owner.name ?? ""}'s item`)
      : (identifier?.name ?? "");
    const checkText = check
      ? Constants.format(`${LANG}.Card.CheckResult`, { check: checkName, total: check.total, dc: check.dc },
        `${checkName} ${check.total} · DC ${check.dc}`.trim())
      : "";

    return `
      <div class="sc-ma-identify-card sc-ma-identify-card--identified" data-rarity="${escape(rarity)}">
        <header class="sc-ma-identify-card-banner">
          <i class="fa-solid fa-magnifying-glass" inert></i>
          <span>${escape(Constants.localize(`${LANG}.Card.Revealed`, "Item identified"))}</span>
        </header>
        <div class="sc-ma-identify-card-item" data-item-uuid="${escape(item.uuid ?? "")}">
          <div class="sc-ma-identify-card-art"><img src="${escape(item.img ?? "")}" alt=""></div>
          <div class="sc-ma-identify-card-info">
            <span class="sc-ma-identify-card-name item-name">@UUID[${item.uuid}]{${escape(name)}}</span>
            ${rarityLabel ? `<span class="sc-ma-identify-card-rarity">${escape(rarityLabel)}</span>` : ""}
            ${meta ? `<span class="sc-ma-identify-card-meta item-type">${escape(meta)}</span>` : ""}
          </div>
        </div>
        ${formerName && formerName !== name ? `
        <p class="sc-ma-identify-card-former">
          <i class="fa-solid fa-eye-slash" inert></i>
          ${escape(Constants.format(`${LANG}.Card.Former`, { name: formerName }, `Once known as ${formerName}`))}
        </p>` : ""}
        <footer class="sc-ma-identify-card-footer">
          <span><i class="fa-solid fa-user" inert></i> ${escape(by)}</span>
          ${checkText ? `<span class="sc-ma-identify-card-check"><i class="fa-solid fa-dice-d20" inert></i> ${escape(checkText)}</span>` : ""}
        </footer>
      </div>`;
  }

  static #typeLabel(item) {
    const subtype = item.system?.type?.label;
    if (subtype) {
      return subtype;
    }
    const key = globalThis.CONFIG?.Item?.typeLabels?.[item.type];
    return key ? Constants.localize(key, key) : "";
  }

  static #attunementLabel(item) {
    const attunement = item.system?.attunement;
    if (attunement === "required" || attunement === 1) {
      return Constants.localize(`${LANG}.Card.AttunementRequired`, "Requires attunement");
    }
    if (attunement === "optional") {
      return Constants.localize(`${LANG}.Card.AttunementOptional`, "Attunement optional");
    }
    return "";
  }

  static #onRender(html) {
    const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : (html?.[0] ?? html);
    const row = root?.querySelector?.(".sc-ma-identify-card-item[data-item-uuid]");
    if (!row || typeof globalThis.fromUuidSync !== "function") {
      return;
    }
    let item = null;
    try {
      item = globalThis.fromUuidSync(row.dataset.itemUuid);
    } catch {
      item = null;
    }
    ScItemRarityColorsIntegration.styleItemRow(row, item, { imageSelector: ".sc-ma-identify-card-art > img" });
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
