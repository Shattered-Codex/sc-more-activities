import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const LANG = "SCMOREACTIVITIES.Activities.ScRecall.Picker";

/**
 * Shown every time a recall activity is used, to confirm where it leads before
 * anyone moves, and to offer the choices: who comes along, and, beside a
 * recall point, whether to bind it as home. Resolves with
 * `{ action: "travel", companions }` (open the portal, for a portal recall),
 * `{ action: "bind", token }`, or `null` when closed.
 */
export class ScRecallPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-recall-picker"],
    tag: "form",
    window: {
      icon: "sc-ma-recall-icon sc-ma-recall-icon--home"
    },
    position: {
      width: 440,
      height: "auto"
    },
    form: {
      handler: ScRecallPickerApp.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      toggleCompanion: ScRecallPickerApp.#onToggleCompanion,
      bind: ScRecallPickerApp.#onBind,
      cancel: ScRecallPickerApp.#onCancel
    }
  };

  static PARTS = {
    body: {
      template: "modules/sc-more-activities/templates/applications/sc-recall-picker.hbs"
    },
    footer: {
      template: "modules/sc-more-activities/templates/applications/sc-recall-picker-footer.hbs"
    }
  };

  /**
   * @param {object} destination  `{ label, anchor }` (the home NPC's token, whose art the card
   *                              shows), or `{ error }` when there is nowhere to go yet.
   * @param {object|null} home    The home bound on the user's character.
   * @param {object[]} companions `{ token, distance, selected }`
   * @param {object[]} bindables  `{ token, distance, isHome }`
   */
  static wait({ destination, home = null, companions = [], bindables = [], portal = false }) {
    return new Promise((resolve) => {
      // A window that fails to render never closes, so the usage would wait forever.
      new ScRecallPickerApp({ destination, home, companions, bindables, portal, resolve }).render(true).catch((error) => {
        Logger.error("Could not render the sc-recall picker.", error);
        resolve(null);
      });
    });
  }

  #destination;
  #home;
  #companions;
  #bindables;
  #selected;
  #portal;
  #resolve;

  constructor({ destination, home, companions, bindables, portal = false, resolve, ...options } = {}) {
    super({
      window: { title: Constants.localize(`${LANG}.Title`, "Recall") },
      ...options
    });
    this.#destination = destination ?? {};
    this.#home = home;
    this.#companions = companions ?? [];
    this.#bindables = bindables ?? [];
    this.#portal = portal;
    this.#selected = new Set(this.#companions.flatMap((entry, index) => (entry.selected ? [index] : [])));
    this.#resolve = resolve;
  }

  async _prepareContext() {
    const units = canvas?.scene?.grid?.units || "ft";
    const tile = (entry, index) => ({
      index,
      name: entry.token?.name ?? entry.token?.document?.name ?? "",
      img: ScRecallPickerApp.#image(entry.token),
      distance: `${Math.round(Number(entry.distance) || 0)} ${units}`
    });
    const canTravel = !this.#destination.error;
    return {
      canTravel,
      // A home shows the NPC it leads to; a region has no face, so it keeps the marker.
      destinationArt: canTravel ? ScRecallPickerApp.#image(this.#destination.anchor) : "",
      portal: this.#portal,
      destination: canTravel
        ? this.#destination.label
        : Constants.localize(`${LANG}.NoHome`, "No home set"),
      question: canTravel
        ? Constants.format(
          `${LANG}.${this.#portal ? "ConfirmPortal" : "ConfirmTravel"}`,
          { destination: this.#destination.label },
          this.#portal ? `Open a portal to ${this.#destination.label}?` : `Travel to ${this.#destination.label}?`
        )
        : "",
      home: this.#home?.name
        ? Constants.format(`${LANG}.CurrentHome`, { name: this.#home.name }, `Home: ${this.#home.name}`)
        : "",
      companions: this.#companions.map((entry, index) => ({ ...tile(entry, index), selected: this.#selected.has(index) })),
      bindables: this.#bindables.map((entry, index) => ({ ...tile(entry, index), isHome: entry.isHome }))
    };
  }

  /**
   * A token's art for an <img>: its texture, or its actor's portrait when the
   * texture is a video, which an <img> cannot show.
   */
  static #image(token) {
    const src = token?.document?.texture?.src ?? token?.texture?.src ?? "";
    if (src && !/\.(webm|mp4|m4v|ogv)(\?|$)/i.test(src)) {
      return src;
    }
    return token?.actor?.img ?? "";
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

  static #onToggleCompanion(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) {
      return;
    }
    if (this.#selected.has(index)) {
      this.#selected.delete(index);
    } else {
      this.#selected.add(index);
    }
    this.render();
  }

  static #onBind(_event, target) {
    const entry = this.#bindables[Number(target.dataset.index)];
    if (entry) {
      this.#settle({ action: "bind", token: entry.token });
      this.close();
    }
  }

  static #onCancel() {
    this.close();
  }

  static async #onSubmit() {
    if (this.#destination.error) {
      return;
    }
    const companions = this.#companions.filter((_entry, index) => this.#selected.has(index)).map((entry) => entry.token);
    this.#settle({ action: "travel", companions });
  }
}
