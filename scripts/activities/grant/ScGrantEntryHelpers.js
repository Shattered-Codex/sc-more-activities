import { Constants } from "../../constants/Constants.js";

const FLAG_KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
const FORBIDDEN_FLAG_KEY_PARTS = new Set(["__proto__", "prototype", "constructor"]);

export class ScGrantEntryHelpers {
  static SOURCE_TYPES = Object.freeze({
    ITEM: "item",
    TABLE: "table"
  });

  static SELECTION_MODES = Object.freeze({
    ALL: "all",
    CHOOSE: "choose",
    BUDGET: "budget"
  });

  static DELIVERY_MODES = Object.freeze({
    INSTANT: "instant",
    BASTION: "bastion"
  });

  /** Native dnd5e facility orders a bastion grant can run as; the first is the default. */
  static BASTION_ORDERS = Object.freeze(["harvest", "craft"]);

  static DEFAULT_BASTION_DAYS = 7;

  static DEFAULT_BUDGET = "10";

  static normalizeSelection(raw) {
    const mode = Object.values(ScGrantEntryHelpers.SELECTION_MODES).includes(raw?.mode)
      ? raw.mode
      : ScGrantEntryHelpers.SELECTION_MODES.ALL;
    const count = Math.floor(Number(raw?.count));
    const budget = String(raw?.budget ?? "").trim();
    return {
      mode,
      count: Number.isFinite(count) && count >= 1 ? count : 1,
      budget: budget || ScGrantEntryHelpers.DEFAULT_BUDGET
    };
  }

  static isBudget(selection) {
    return ScGrantEntryHelpers.normalizeSelection(selection).mode === ScGrantEntryHelpers.SELECTION_MODES.BUDGET;
  }

  /** A source's weight in the budget mode: the points one unit of it costs. */
  static normalizeCost(value) {
    const cost = Math.floor(Number(value));
    return Number.isFinite(cost) && cost >= 1 ? cost : 1;
  }

  /** `units` packs of a quantity formula, as a formula. */
  static multiplyQuantity(formula, units) {
    const normalized = ScGrantEntryHelpers.normalizeQuantityFormula(formula);
    if (units === 1) {
      return normalized;
    }
    if (/^\d+$/.test(normalized)) {
      return String(Number(normalized) * units);
    }
    return `${units} * (${normalized})`;
  }

  /** The points `units` (one count per entry) spend. */
  static budgetSpent(entries, units) {
    return entries.reduce((total, entry, index) => (
      total + ScGrantEntryHelpers.normalizeCost(entry.cost) * (Number(units?.[index]) || 0)
    ), 0);
  }

  /**
   * How many sources the user must pick from `entryCount` configured ones, or
   * 0 when every source is granted (the "all" mode, or a choice that covers
   * the whole list).
   */
  static choiceCount(selection, entryCount) {
    const { mode, count } = ScGrantEntryHelpers.normalizeSelection(selection);
    if (mode !== ScGrantEntryHelpers.SELECTION_MODES.CHOOSE || count >= entryCount) {
      return 0;
    }
    return count;
  }

  /**
   * The entries a user picked, or `null` when the picks do not satisfy the
   * activity's selection. In the choose mode, picks are indices into the
   * normalized entry list; in the budget mode, one unit count per entry, which
   * may spend up to `budget` points and multiplies each entry's quantity.
   */
  static applyPicks(entries, selection, picks, { budget = 0 } = {}) {
    if (ScGrantEntryHelpers.isBudget(selection)) {
      return ScGrantEntryHelpers.#applyBudget(entries, picks, budget);
    }
    const required = ScGrantEntryHelpers.choiceCount(selection, entries.length);
    if (!required) {
      return entries;
    }
    if (!Array.isArray(picks)) {
      return null;
    }
    const indices = new Set(picks);
    const valid = [...indices].every((index) => Number.isInteger(index) && index >= 0 && index < entries.length);
    if (!valid || indices.size !== required || picks.length !== required) {
      return null;
    }
    return [...indices].sort((left, right) => left - right).map((index) => entries[index]);
  }

  static #applyBudget(entries, units, budget) {
    if (!Array.isArray(units) || units.length !== entries.length) {
      return null;
    }
    if (!units.every((count) => Number.isSafeInteger(count) && count >= 0)) {
      return null;
    }
    const spent = ScGrantEntryHelpers.budgetSpent(entries, units);
    if (spent < 1 || spent > budget) {
      return null;
    }
    return entries.flatMap((entry, index) => (units[index] > 0
      ? [{ ...entry, quantity: ScGrantEntryHelpers.multiplyQuantity(entry.quantity, units[index]) }]
      : []));
  }

  static normalizeDelivery(value) {
    return value === ScGrantEntryHelpers.DELIVERY_MODES.BASTION
      ? ScGrantEntryHelpers.DELIVERY_MODES.BASTION
      : ScGrantEntryHelpers.DELIVERY_MODES.INSTANT;
  }

  static normalizeBastion(raw) {
    const order = ScGrantEntryHelpers.BASTION_ORDERS.includes(raw?.order)
      ? raw.order
      : ScGrantEntryHelpers.BASTION_ORDERS[0];
    const days = Math.floor(Number(raw?.days));
    return {
      order,
      days: Number.isFinite(days) && days >= 1 ? days : ScGrantEntryHelpers.DEFAULT_BASTION_DAYS
    };
  }

  /**
   * Whether `key` can name a flag on a granted item: a dotted `scope.key`
   * path, outside this module's own scope (which holds the delivery data).
   */
  static isValidItemFlagKey(key) {
    const text = String(key ?? "").trim();
    if (!FLAG_KEY_PATTERN.test(text)) {
      return false;
    }
    const parts = text.split(".");
    return parts[0] !== Constants.MODULE_ID && !parts.some((part) => FORBIDDEN_FLAG_KEY_PARTS.has(part));
  }

  /** A flag value as typed: read as JSON when it is (true, 3, "text", {...}), else kept as text. */
  static parseItemFlagValue(value) {
    const text = String(value ?? "").trim();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * The flags a grant writes on every item it creates, from the activity's
   * `itemFlags` rows: `{ key, value }` with a valid key and a parsed value.
   */
  static normalizeItemFlags(rows = []) {
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => ScGrantEntryHelpers.isValidItemFlagKey(row?.key))
      .map((row) => ({
        key: String(row.key).trim(),
        value: ScGrantEntryHelpers.parseItemFlagValue(row.value)
      }));
  }

  static normalizeEntry(raw) {
    const type = raw?.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE
      ? ScGrantEntryHelpers.SOURCE_TYPES.TABLE
      : ScGrantEntryHelpers.SOURCE_TYPES.ITEM;
    return {
      type,
      uuid: String(raw?.uuid ?? "").trim(),
      quantity: ScGrantEntryHelpers.normalizeQuantityFormula(raw?.quantity),
      cost: ScGrantEntryHelpers.normalizeCost(raw?.cost)
    };
  }

  static normalizeEntries(entries = []) {
    const list = Array.isArray(entries) ? entries : [];
    return list
      .map((entry) => ScGrantEntryHelpers.normalizeEntry(entry))
      .filter((entry) => entry.uuid);
  }

  static normalizeQuantityFormula(value) {
    if (value === null || value === undefined) {
      return "1";
    }
    const text = String(value).trim();
    return text || "1";
  }

  static coerceQuantity(value, fallback = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return Math.max(1, Math.floor(fallback));
    }
    return Math.max(1, Math.floor(number));
  }

  static async evaluateQuantity(formula, rollData = {}, { evaluator } = {}) {
    const normalized = ScGrantEntryHelpers.normalizeQuantityFormula(formula);
    if (/^\d+$/.test(normalized)) {
      return ScGrantEntryHelpers.coerceQuantity(normalized);
    }
    const evaluate = evaluator ?? ScGrantEntryHelpers.#defaultEvaluator;
    try {
      const total = await evaluate(normalized, rollData);
      return ScGrantEntryHelpers.coerceQuantity(total);
    } catch {
      return 1;
    }
  }

  static async #defaultEvaluator(formula, rollData) {
    const RollClass = globalThis.Roll;
    if (!RollClass) {
      throw new Error("Roll API unavailable.");
    }
    const roll = new RollClass(formula, rollData);
    await roll.evaluate();
    return roll.total;
  }

  static normalizeCheck(raw) {
    return {
      ability: String(raw?.ability ?? "").trim(),
      skill: String(raw?.skill ?? "").trim(),
      dc: {
        calculation: String(raw?.dc?.calculation ?? "").trim(),
        formula: String(raw?.dc?.formula ?? "").trim()
      }
    };
  }

  static isCheckEnabled(check) {
    const normalized = ScGrantEntryHelpers.normalizeCheck(check);
    return Boolean(normalized.ability || normalized.skill);
  }
}
