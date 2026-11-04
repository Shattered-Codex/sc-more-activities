import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const LANG = "SCMOREACTIVITIES.Activities.ScGrant.Choice";

/**
 * Asks the user which of a grant's sources to receive when the activity lets
 * them choose. In the "choose" mode the user picks `count` sources and the
 * picker resolves with their indices; in the "budget" mode the user spends up
 * to `budget` points on units of the sources (each unit costs the source's
 * weight) and the picker resolves with one unit count per source. Resolves
 * with `null` when closed.
 */
export class ScGrantChoiceApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-grant-choice"],
    tag: "form",
    window: {
      icon: "fa-solid fa-hand-holding-heart"
    },
    position: {
      width: 460,
      height: "auto"
    },
    form: {
      handler: ScGrantChoiceApp.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      toggleOption: ScGrantChoiceApp.#onToggleOption,
      increment: ScGrantChoiceApp.#onIncrement,
      decrement: ScGrantChoiceApp.#onDecrement,
      cancel: ScGrantChoiceApp.#onCancel
    }
  };

  static PARTS = {
    body: {
      template: "modules/sc-more-activities/templates/applications/sc-grant-choice.hbs"
    },
    footer: {
      template: "modules/sc-more-activities/templates/applications/sc-grant-choice-footer.hbs"
    }
  };

  /**
   * @param {object} config
   * @param {string} config.title       The activity's name, for the window title.
   * @param {string} [config.mode]      "choose" or "budget".
   * @param {number} [config.count]     How many options must be picked (choose mode).
   * @param {number} [config.budget]    The points to spend (budget mode).
   * @param {object[]} config.options   `{ name, img, quantity, cost, typeLabel }`, in entry order.
   * @param {string} [config.note]      An extra line under the prompt (e.g. the bastion order).
   */
  static wait({ title = "", mode = "choose", count = 1, budget = 0, options = [], note = "" } = {}) {
    return new Promise((resolve) => {
      // A window that fails to render never closes, so the usage would wait forever.
      new ScGrantChoiceApp({ title, mode, count, budget, choices: options, note, resolve }).render(true).catch((error) => {
        Logger.error("Could not render the sc-grant choice picker.", error);
        resolve(null);
      });
    });
  }

  #budgetMode;
  #count;
  #budget;
  #choices;
  #note;
  #selected = [];
  #units;
  #resolve;

  constructor({ title, mode, count, budget, choices, note, resolve, ...options } = {}) {
    super({
      window: { title: title || Constants.localize(`${LANG}.Title`, "Choose your reward") },
      ...options
    });
    this.#budgetMode = mode === "budget";
    this.#count = Math.max(1, Number(count) || 1);
    this.#budget = Math.max(0, Math.floor(Number(budget) || 0));
    this.#choices = choices ?? [];
    this.#units = this.#choices.map(() => 0);
    this.#note = note ?? "";
    this.#resolve = resolve;
  }

  async _prepareContext() {
    return this.#budgetMode ? this.#budgetContext() : this.#chooseContext();
  }

  #chooseContext() {
    const selected = new Set(this.#selected);
    return {
      budgetMode: false,
      prompt: Constants.format(`${LANG}.Prompt`, { count: this.#count }, `Choose ${this.#count}:`),
      note: this.#note,
      counter: Constants.format(
        `${LANG}.Counter`,
        { selected: this.#selected.length, count: this.#count },
        `${this.#selected.length} / ${this.#count}`
      ),
      complete: this.#selected.length === this.#count,
      canConfirm: this.#selected.length === this.#count,
      single: this.#count === 1,
      options: this.#choices.map((choice, index) => ({
        index,
        name: choice.name,
        img: choice.img,
        quantity: choice.quantity,
        typeLabel: choice.typeLabel,
        selected: selected.has(index)
      }))
    };
  }

  #budgetContext() {
    const spent = this.#spent();
    const left = this.#budget - spent;
    return {
      budgetMode: true,
      prompt: Constants.format(`${LANG}.BudgetPrompt`, { budget: this.#budget }, `Spend up to ${this.#budget} points:`),
      note: this.#note,
      counter: Constants.format(
        `${LANG}.BudgetCounter`,
        { spent, budget: this.#budget },
        `${spent} / ${this.#budget}`
      ),
      complete: spent === this.#budget,
      canConfirm: spent > 0,
      leftover: spent > 0 && left > 0
        ? Constants.format(`${LANG}.Leftover`, { left }, `${left} point(s) left unspent will be lost.`)
        : "",
      options: this.#choices.map((choice, index) => {
        const cost = this.#cost(index);
        const units = this.#units[index];
        return {
          index,
          name: choice.name,
          img: choice.img,
          quantity: choice.quantity,
          typeLabel: choice.typeLabel,
          units,
          selected: units > 0,
          costLabel: Constants.format(`${LANG}.Cost`, { cost }, `${cost} pt`),
          total: units > 0 ? ScGrantChoiceApp.#total(choice.quantity, units) : "",
          canIncrement: cost <= left,
          canDecrement: units > 0
        };
      })
    };
  }

  #cost(index) {
    const cost = Math.floor(Number(this.#choices[index]?.cost));
    return Number.isFinite(cost) && cost >= 1 ? cost : 1;
  }

  #spent() {
    return this.#units.reduce((total, units, index) => total + (units * this.#cost(index)), 0);
  }

  /** What `units` packs of a quantity add up to, for display: "×6", or "3 × (1d4)". */
  static #total(quantity, units) {
    const text = String(quantity ?? "1").trim() || "1";
    return /^\d+$/.test(text) ? `×${Number(text) * units}` : `${units} × (${text})`;
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

  static #onToggleOption(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || !this.#choices[index]) {
      return;
    }
    if (this.#selected.includes(index)) {
      this.#selected = this.#selected.filter((value) => value !== index);
    } else if (this.#count === 1) {
      // A single choice behaves like a radio group: picking another swaps it.
      this.#selected = [index];
    } else if (this.#selected.length < this.#count) {
      this.#selected = [...this.#selected, index];
    }
    this.render();
  }

  static #onIncrement(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || !this.#choices[index]) {
      return;
    }
    if (this.#spent() + this.#cost(index) <= this.#budget) {
      this.#units[index] += 1;
      this.render();
    }
  }

  static #onDecrement(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || !(this.#units[index] > 0)) {
      return;
    }
    this.#units[index] -= 1;
    this.render();
  }

  static #onCancel() {
    this.close();
  }

  static async #onSubmit() {
    if (this.#budgetMode) {
      const spent = this.#spent();
      if (spent > 0 && spent <= this.#budget) {
        this.#settle([...this.#units]);
      }
      return;
    }
    if (this.#selected.length !== this.#count) {
      return;
    }
    this.#settle([...this.#selected].sort((left, right) => left - right));
  }
}
