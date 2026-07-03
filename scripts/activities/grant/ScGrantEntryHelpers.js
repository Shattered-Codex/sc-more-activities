export class ScGrantEntryHelpers {
  static SOURCE_TYPES = Object.freeze({
    ITEM: "item",
    TABLE: "table"
  });

  static normalizeEntry(raw) {
    const type = raw?.type === ScGrantEntryHelpers.SOURCE_TYPES.TABLE
      ? ScGrantEntryHelpers.SOURCE_TYPES.TABLE
      : ScGrantEntryHelpers.SOURCE_TYPES.ITEM;
    return {
      type,
      uuid: String(raw?.uuid ?? "").trim(),
      quantity: ScGrantEntryHelpers.normalizeQuantityFormula(raw?.quantity)
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
