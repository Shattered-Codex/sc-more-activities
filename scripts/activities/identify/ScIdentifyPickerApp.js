import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScItemRarityColorsIntegration } from "../../integrations/sc-item-rarity-colors/ScItemRarityColorsIntegration.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const LANG = "SCMOREACTIVITIES.Activities.ScIdentify.Picker";

/**
 * Lets the user pick whose inventory to search (when more than one creature is
 * offered) and which unidentified item to identify. Resolves with
 * `{ candidate, item }`, or `null` when the window is closed.
 */
export class ScIdentifyPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-identify-picker"],
    tag: "form",
    window: {
      icon: "fa-solid fa-magnifying-glass"
    },
    position: {
      width: 440,
      height: "auto"
    },
    form: {
      handler: ScIdentifyPickerApp.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      selectCreature: ScIdentifyPickerApp.#onSelectCreature,
      cancel: ScIdentifyPickerApp.#onCancel
    }
  };

  static PARTS = {
    body: {
      template: "modules/sc-more-activities/templates/applications/sc-identify-picker.hbs"
    },
    footer: {
      template: "modules/sc-more-activities/templates/applications/sc-identify-picker-footer.hbs"
    }
  };

  /**
   * @param {object[]} candidates  `{ actor, token, isSelf, distance, items }`, each with at least one item.
   * @param {string} checkLabel    How the identification is resolved, shown under the list.
   */
  static wait({ candidates, checkLabel = "" }) {
    return new Promise((resolve) => {
      // A window that fails to render never closes, so the usage would wait forever.
      new ScIdentifyPickerApp({ candidates, checkLabel, resolve }).render(true).catch((error) => {
        Logger.error("Could not render the sc-identify picker.", error);
        resolve(null);
      });
    });
  }

  #candidates;
  #checkLabel;
  #resolve;
  #creatureIndex = 0;
  #itemId = null;

  constructor({ candidates, checkLabel, resolve, ...options } = {}) {
    super({
      window: { title: Constants.localize(`${LANG}.Title`, "Identify an Item") },
      ...options
    });
    this.#candidates = candidates ?? [];
    this.#checkLabel = checkLabel;
    this.#resolve = resolve;
  }

  async _prepareContext() {
    const candidate = this.#candidates[this.#creatureIndex];
    const items = candidate?.items ?? [];
    const itemId = items.some((item) => item.id === this.#itemId) ? this.#itemId : items[0]?.id;
    const units = canvas?.scene?.grid?.units || "ft";

    return {
      showCreatures: this.#candidates.length > 1,
      creatures: this.#candidates.map((entry, index) => ({
        index,
        name: ScIdentifyPickerApp.#name(entry),
        img: ScIdentifyPickerApp.#img(entry),
        isSelf: entry.isSelf,
        distance: Number.isFinite(entry.distance) ? `${Math.round(entry.distance)} ${units}` : "",
        count: entry.items.length,
        selected: index === this.#creatureIndex
      })),
      owner: {
        name: ScIdentifyPickerApp.#name(candidate),
        img: ScIdentifyPickerApp.#img(candidate),
        count: Constants.format(`${LANG}.ItemCount`, { count: items.length }, `${items.length} unidentified`)
      },
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        img: item.img,
        type: game.i18n.localize(CONFIG.Item?.typeLabels?.[item.type] ?? item.type ?? ""),
        quantity: Number(item.system?.quantity) > 1 ? item.system.quantity : null,
        container: candidate.actor?.items?.get?.(item.system?.container)?.name ?? "",
        checked: item.id === itemId
      })),
      checkLabel: this.#checkLabel
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const items = this.#candidates[this.#creatureIndex]?.items ?? [];
    for (const row of this.element.querySelectorAll(".sc-ma-identify-item[data-item-id]")) {
      const item = items.find((entry) => entry.id === row.dataset.itemId);
      ScItemRarityColorsIntegration.styleItemRow(row, item, { imageSelector: ".sc-ma-identify-item-icon > img" });
    }
  }

  _onClose(options) {
    super._onClose(options);
    this.#settle(null);
  }

  #settle(value) {
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(value);
  }

  static #onSelectCreature(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index === this.#creatureIndex) {
      return;
    }
    this.#creatureIndex = index;
    this.#itemId = null;
    this.render();
  }

  static #onCancel() {
    this.close();
  }

  static async #onSubmit(_event, _form, formData) {
    const candidate = this.#candidates[this.#creatureIndex];
    const item = candidate?.items.find((entry) => entry.id === formData.object.itemId);
    if (item) {
      this.#settle({ candidate, item });
    }
  }

  static #name(candidate) {
    return candidate?.token?.name ?? candidate?.actor?.name ?? "";
  }

  static #img(candidate) {
    return candidate?.token?.document?.texture?.src ?? candidate?.actor?.img ?? "";
  }
}
