import { Logger } from "../../support/Logger.js";

const MODULE_ID = "sc-item-rarity-colors";
const MIN_API_VERSION = 1;

/**
 * Optional styling from SC - Item Rarity Colors. Does nothing unless that
 * module is active and publishes a compatible API.
 */
export class ScItemRarityColorsIntegration {
  /**
   * Styles an item row like an actor inventory row (rarity colors, and the
   * unidentified style with its image cover). The image must sit in a
   * positioned parent.
   */
  static styleItemRow(row, item, { imageSelector = "img" } = {}) {
    const api = ScItemRarityColorsIntegration.#api();
    if (!api || !row || !item) {
      return;
    }
    try {
      api.styleItemRow(row, item, { imageSelector });
    } catch (error) {
      Logger.warn("Could not apply SC Item Rarity Colors styles.", error);
    }
  }

  static #api() {
    const module = game?.modules?.get?.(MODULE_ID);
    const api = module?.active ? module.api : null;
    return Number(api?.version) >= MIN_API_VERSION && typeof api.styleItemRow === "function" ? api : null;
  }
}
