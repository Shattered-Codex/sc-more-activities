export const FLOW_PROPERTY_OPERATORS = Object.freeze({
  EQ: "eq",
  NE: "ne",
  GT: "gt",
  GTE: "gte",
  LT: "lt",
  LTE: "lte",
  BETWEEN: "between",
  INCLUDES: "includes"
});

export class ScConditionalChainConditions {
  static isOperator(operator) {
    return Object.values(FLOW_PROPERTY_OPERATORS).includes(operator);
  }

  static getPropertyValue(source, path) {
    const parts = String(path ?? "").split(".").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) {
      return undefined;
    }
    let current = source;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  static compare(operator, actual, expected) {
    switch (operator) {
      case FLOW_PROPERTY_OPERATORS.EQ:
        return { valid: true, result: ScConditionalChainConditions.#looseEquals(actual, expected) };
      case FLOW_PROPERTY_OPERATORS.NE:
        return { valid: true, result: !ScConditionalChainConditions.#looseEquals(actual, expected) };
      case FLOW_PROPERTY_OPERATORS.GT:
      case FLOW_PROPERTY_OPERATORS.GTE:
      case FLOW_PROPERTY_OPERATORS.LT:
      case FLOW_PROPERTY_OPERATORS.LTE:
        return ScConditionalChainConditions.#compareNumeric(operator, actual, expected);
      case FLOW_PROPERTY_OPERATORS.BETWEEN:
        return ScConditionalChainConditions.#compareBetween(actual, expected);
      case FLOW_PROPERTY_OPERATORS.INCLUDES:
        return ScConditionalChainConditions.#compareIncludes(actual, expected);
      default:
        return { valid: false, reason: "invalid-operator" };
    }
  }

  static evaluateProperty(condition = {}, source, { resolveExpected, treatNullAsMissing = false } = {}) {
    if (!ScConditionalChainConditions.isOperator(condition.operator)) {
      return { valid: false, reason: "invalid-operator" };
    }

    const actual = ScConditionalChainConditions.getPropertyValue(source, condition.path);
    if (actual === undefined) {
      return { valid: false, reason: "missing-property" };
    }
    if (treatNullAsMissing && actual === null) {
      return { valid: false, reason: "null-property" };
    }

    const rawExpected = String(condition.value ?? "").trim();
    const expected = typeof resolveExpected === "function" ? resolveExpected(rawExpected) : rawExpected;
    const comparison = ScConditionalChainConditions.compare(condition.operator, actual, expected);
    if (!comparison.valid) {
      return { valid: false, reason: comparison.reason ?? "invalid-comparison" };
    }
    return { valid: true, result: comparison.result, actual, expected };
  }

  static evaluateActorProperty(condition = {}, actorSource, { resolveExpected } = {}) {
    return ScConditionalChainConditions.evaluateProperty(condition, actorSource, { resolveExpected });
  }

  /** Returns an interval for statically numeric comparisons, or null when it cannot be proven. */
  static numericInterval(operator, rawValue) {
    if (operator === FLOW_PROPERTY_OPERATORS.BETWEEN) {
      const bounds = ScConditionalChainConditions.#rangeBounds(rawValue);
      return bounds ? { min: bounds[0], minInclusive: true, max: bounds[1], maxInclusive: true } : null;
    }
    const value = ScConditionalChainConditions.#asNumber(rawValue);
    if (value === null) {
      return null;
    }
    switch (operator) {
      case FLOW_PROPERTY_OPERATORS.EQ:
        return { min: value, minInclusive: true, max: value, maxInclusive: true };
      case FLOW_PROPERTY_OPERATORS.GT:
        return { min: value, minInclusive: false, max: Infinity, maxInclusive: false };
      case FLOW_PROPERTY_OPERATORS.GTE:
        return { min: value, minInclusive: true, max: Infinity, maxInclusive: false };
      case FLOW_PROPERTY_OPERATORS.LT:
        return { min: -Infinity, minInclusive: false, max: value, maxInclusive: false };
      case FLOW_PROPERTY_OPERATORS.LTE:
        return { min: -Infinity, minInclusive: false, max: value, maxInclusive: true };
      default:
        return null;
    }
  }

  static intervalsOverlap(left, right) {
    if (!left || !right) {
      return false;
    }
    if (left.max < right.min || right.max < left.min) {
      return false;
    }
    if (left.max === right.min) {
      return left.maxInclusive && right.minInclusive;
    }
    if (right.max === left.min) {
      return right.maxInclusive && left.minInclusive;
    }
    return true;
  }

  static #looseEquals(actual, expected) {
    const actualBoolean = ScConditionalChainConditions.#asBoolean(actual);
    const expectedBoolean = ScConditionalChainConditions.#asBoolean(expected);
    if (actualBoolean !== null && expectedBoolean !== null) {
      return actualBoolean === expectedBoolean;
    }

    const actualNumber = ScConditionalChainConditions.#asNumber(actual);
    const expectedNumber = ScConditionalChainConditions.#asNumber(expected);
    if (actualNumber !== null && expectedNumber !== null) {
      return actualNumber === expectedNumber;
    }
    return String(actual) === String(expected);
  }

  static #compareNumeric(operator, actual, expected) {
    const actualNumber = ScConditionalChainConditions.#asNumber(actual);
    const expectedNumber = ScConditionalChainConditions.#asNumber(expected);
    if (actualNumber === null || expectedNumber === null) {
      return { valid: false, reason: "not-numeric" };
    }
    switch (operator) {
      case FLOW_PROPERTY_OPERATORS.GT:
        return { valid: true, result: actualNumber > expectedNumber };
      case FLOW_PROPERTY_OPERATORS.GTE:
        return { valid: true, result: actualNumber >= expectedNumber };
      case FLOW_PROPERTY_OPERATORS.LT:
        return { valid: true, result: actualNumber < expectedNumber };
      default:
        return { valid: true, result: actualNumber <= expectedNumber };
    }
  }

  static #compareIncludes(actual, expected) {
    if (Array.isArray(actual)) {
      return {
        valid: true,
        result: actual.some((entry) => ScConditionalChainConditions.#looseEquals(entry, expected))
      };
    }
    if (actual instanceof Set) {
      return ScConditionalChainConditions.#compareIncludes([...actual], expected);
    }
    if (typeof actual === "string") {
      return { valid: true, result: actual.includes(String(expected)) };
    }
    return { valid: false, reason: "not-collection" };
  }

  static #compareBetween(actual, expected) {
    const actualNumber = ScConditionalChainConditions.#asNumber(actual);
    const bounds = ScConditionalChainConditions.#rangeBounds(expected);
    if (actualNumber === null || !bounds) {
      return { valid: false, reason: "invalid-range" };
    }
    return { valid: true, result: actualNumber >= bounds[0] && actualNumber <= bounds[1] };
  }

  static #rangeBounds(value) {
    const match = String(value ?? "").trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:\.\.|,)\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      return null;
    }
    const min = Number(match[1]);
    const max = Number(match[2]);
    return Number.isFinite(min) && Number.isFinite(max) && min <= max ? [min, max] : null;
  }

  static #asNumber(value) {
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (value === null || value === undefined) {
      return null;
    }
    const text = String(value).trim();
    if (!text) {
      return null;
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  static #asBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === null || value === undefined) {
      return null;
    }
    const text = String(value).trim().toLowerCase();
    if (text === "true") {
      return true;
    }
    if (text === "false") {
      return false;
    }
    return null;
  }
}
