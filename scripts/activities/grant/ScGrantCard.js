import { ScItemRarityColorsIntegration } from "../../integrations/sc-item-rarity-colors/ScItemRarityColorsIntegration.js";

const FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";
const FALLBACK_TABLE_IMG = "icons/svg/d20-grey.svg";

/**
 * The chat card of a grant: a banner naming where the items come from, one
 * row per item with its art and quantity, roll tables with the items they
 * drew, and footer notes (the check, a bastion order's ETA).
 *
 * Item rows carry the inventory classes (`item-name`, `item-detail`,
 * `item-quantity`) so SC Item Rarity Colors gives their text the colors made
 * for its rarity gradient, as it does in an actor's inventory.
 */
export class ScGrantCard {
  /** Styles the granted items with SC Item Rarity Colors when that module is active. */
  static registerHooks() {
    Hooks.on("renderChatMessageHTML", (_message, html) => ScGrantCard.#onRender(html));
  }

  /**
   * @param {object} card
   * @param {object} card.banner   `{ img, title, subtitle }`
   * @param {string} [card.intro]  The line above the list, e.g. "Beiro received:".
   * @param {object[]} card.lines  Items `{ kind: "item", uuid, name, img, quantity, formula, total }`
   *                               and tables `{ kind: "table", uuid, name, img, draws, formula, total, items }`,
   *                               whose `items` may hold the inner tables they drew from, as table lines.
   * @param {object[]} [card.notes] Footer notes `{ icon, text }`.
   * @param {string} [card.emptyText] Shown under a table that drew nothing.
   * @param {Function} [card.drawsText] `(count) => string` for a table's draw count.
   * @param {object[]} [card.actions] Buttons `{ action, icon, label }`, as `data-sc-grant-action`.
   * @param {object} [card.dataset]   `data-*` attributes for the card, by camelCase name.
   */
  static content({
    banner = {}, intro = "", lines = [], notes = [], emptyText = "", drawsText = (count) => `${count}`,
    actions = [], dataset = {}
  } = {}) {
    const escape = ScGrantCard.#escape;
    const bannerArt = banner.img
      ? `<img class="sc-ma-grant-card-banner-art" src="${escape(banner.img)}" alt="">`
      : `<i class="fa-solid fa-gift sc-ma-grant-card-banner-art" inert></i>`;
    const parts = [
      `<header class="sc-ma-grant-card-banner">${bannerArt}`
        + `<span class="sc-ma-grant-card-banner-text">`
        + `<strong>${escape(banner.title ?? "")}</strong>`
        + (banner.subtitle ? `<span>${escape(banner.subtitle)}</span>` : "")
        + `</span></header>`
    ];

    if (intro) {
      parts.push(`<div class="sc-ma-grant-card-intro"><i class="fa-solid fa-treasure-chest" inert></i>`
        + `<span>${escape(intro)}</span></div>`);
    }

    const rows = lines.map((line) => (line.kind === "table"
      ? ScGrantCard.#tableRow(line, { emptyText, drawsText })
      : ScGrantCard.#itemRow(line)));
    parts.push(`<ul class="sc-ma-grant-card-items">${rows.join("")}</ul>`);

    const footer = notes.filter((note) => note?.text);
    if (footer.length) {
      parts.push(`<ul class="sc-ma-grant-card-footer">${footer.map((note) => (
        `<li class="sc-ma-grant-card-pill"><i class="fa-solid ${escape(note.icon ?? "fa-circle-info")}" inert></i>`
        + ` <span>${escape(note.text)}</span></li>`
      )).join("")}</ul>`);
    }

    if (actions.length) {
      parts.push(`<footer class="sc-ma-grant-card-actions">${actions.map((action) => (
        `<button type="button" data-sc-grant-action="${escape(action.action)}">`
        + `<i class="fa-solid ${escape(action.icon ?? "")}" inert></i> ${escape(action.label ?? "")}</button>`
      )).join("")}</footer>`);
    }

    const attributes = Object.entries(dataset).map(([name, value]) => (
      ` data-${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${escape(value)}"`
    )).join("");
    return `<div class="sc-ma-grant-card"${attributes}>${parts.join("")}</div>`;
  }

  static #itemRow({ uuid, name, img, quantity, formula, total }) {
    const escape = ScGrantCard.#escape;
    const roll = formula
      ? `<span class="sc-ma-grant-card-roll item-detail"><i class="fa-solid fa-dice" inert></i> ${escape(formula)} = ${escape(total)}</span>`
      : "";
    return `<li class="sc-ma-grant-card-item" data-item-uuid="${escape(uuid)}">`
      + `<span class="sc-ma-grant-card-art"><img src="${escape(img || FALLBACK_ITEM_IMG)}" alt=""></span>`
      + `<span class="sc-ma-grant-card-info">`
      + `<span class="sc-ma-grant-card-name item-name">@UUID[${uuid}]{${escape(name)}}</span>${roll}`
      + `</span>`
      + `<span class="sc-ma-grant-card-qty item-quantity">&times;${escape(quantity)}</span>`
      + `</li>`;
  }

  /**
   * A table line as flat groups, one per table that drew items, each headed
   * by the path of tables it was reached through ("Reward › Gems"), so
   * nested tables do not indent the card further at every level.
   */
  static #tableRow(line, { emptyText, drawsText }) {
    return ScGrantCard.#tableGroups(line).map(({ path, table, items, nested }) => {
      const escape = ScGrantCard.#escape;
      const meta = ScGrantCard.#drawsMeta(table, drawsText);
      const crumbs = path.map((step) => `<span class="sc-ma-grant-card-crumb">@UUID[${step.uuid}]{${escape(step.name)}}</span>`)
        .join(`<span class="sc-ma-grant-card-crumb-sep" aria-hidden="true">›</span>`);
      let children = items.map((item) => ScGrantCard.#itemRow(item)).join("");
      if (!children && !nested) {
        children = `<li class="sc-ma-grant-card-empty">${escape(emptyText)}</li>`;
      }
      return `<li class="sc-ma-grant-card-table${path.length > 1 ? " is-nested" : ""}">`
        + `<div class="sc-ma-grant-card-table-head">`
        + `<img src="${escape(table.img || FALLBACK_TABLE_IMG)}" alt="">`
        + `<span class="sc-ma-grant-card-path">${crumbs}</span>`
        + (meta ? `<span class="sc-ma-grant-card-table-meta">${escape(meta)}</span>` : "")
        + `</div>`
        + (children ? `<ul class="sc-ma-grant-card-items">${children}</ul>` : "")
        + `</li>`;
    }).join("");
  }

  /**
   * The groups of a table line: the table's own items, then each inner
   * table's groups. A table whose draws only reached inner tables shows no
   * group of its own, unless its draw count says something (see #drawsMeta).
   */
  static #tableGroups(table, path = []) {
    const here = [...path, table];
    const items = (table.items ?? []).filter((entry) => entry.kind !== "table");
    const inner = (table.items ?? []).filter((entry) => entry.kind === "table");
    const groups = [];
    if (items.length || !inner.length || ScGrantCard.#drawsMeta(table, () => "x")) {
      groups.push({ path: here, table, items, nested: inner.length > 0 });
    }
    for (const nested of inner) {
      groups.push(...ScGrantCard.#tableGroups(nested, here));
    }
    return groups;
  }

  /** A table's draw count, worth showing only when it was rolled or is more than one. */
  static #drawsMeta({ draws, formula, total }, drawsText) {
    if (formula) {
      return `${drawsText(draws)} · ${formula} = ${total}`;
    }
    return Number(draws) > 1 ? drawsText(draws) : "";
  }

  static #onRender(html) {
    const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : (html?.[0] ?? html);
    const rows = root?.querySelectorAll?.(".sc-ma-grant-card-item[data-item-uuid]");
    if (!rows?.length || typeof globalThis.fromUuidSync !== "function") {
      return;
    }
    for (const row of rows) {
      let item = null;
      try {
        item = globalThis.fromUuidSync(row.dataset.itemUuid);
      } catch {
        item = null;
      }
      ScItemRarityColorsIntegration.styleItemRow(row, item, { imageSelector: ".sc-ma-grant-card-art > img" });
    }
  }

  static #escape(value) {
    const text = String(value ?? "");
    const escapeHTML = globalThis.foundry?.utils?.escapeHTML;
    if (typeof escapeHTML === "function") {
      return escapeHTML(text);
    }
    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }
}
