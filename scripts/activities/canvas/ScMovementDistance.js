/**
 * How far a movement activity moves its targets: either one fixed distance or
 * a range the user picks from when the activity is used.
 *
 * `movement.distance` stays the distance of a fixed activity and becomes the
 * maximum of a ranged one, so activities saved before ranges existed (no
 * `distanceMode`) keep moving exactly as far as they always did.
 */
export class ScMovementDistance {
  static MODES = Object.freeze({
    FIXED: "fixed",
    RANGE: "range"
  });

  static DEFAULT_DISTANCE = 10;

  /**
   * Ranges keep the grid step: the preview turns a long list into a slider.
   * Only an absurd range (a tiny step over a huge span) takes bigger steps, so
   * the list stays something a slider can still pick from precisely.
   */
  static MAX_CHOICES = 200;

  static modes() {
    return Object.values(ScMovementDistance.MODES);
  }

  static fields(fields) {
    return {
      distanceMode: new fields.StringField({
        required: false,
        initial: ScMovementDistance.MODES.FIXED,
        choices: ScMovementDistance.modes()
      }),
      minDistance: new fields.NumberField({
        required: false,
        initial: 5,
        min: 0
      })
    };
  }

  static normalizeMode(mode) {
    return mode === ScMovementDistance.MODES.RANGE
      ? ScMovementDistance.MODES.RANGE
      : ScMovementDistance.MODES.FIXED;
  }

  /**
   * The distances an activity allows. A minimum above the maximum is read as
   * the maximum, and a range that collapses to one value behaves as fixed.
   */
  static bounds(config = {}) {
    const max = ScMovementDistance.#nonNegative(config?.distance, ScMovementDistance.DEFAULT_DISTANCE);
    if (ScMovementDistance.normalizeMode(config?.distanceMode) !== ScMovementDistance.MODES.RANGE) {
      return { isRange: false, min: max, max };
    }

    const min = Math.min(ScMovementDistance.#nonNegative(config?.minDistance, 0), max);
    return { isRange: min < max, min, max };
  }

  /**
   * The distance to move. A fixed activity ignores the request; a ranged one
   * keeps it inside its bounds and moves the maximum when nothing was picked.
   */
  static resolve(config = {}, requested = null) {
    const { isRange, min, max } = ScMovementDistance.bounds(config);
    const value = ScMovementDistance.#requestedNumber(requested);
    if (!isRange || value === null) {
      return max;
    }
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Whether a requested distance is one the activity allows. The executing GM
   * refuses anything else instead of clamping a forged request into shape.
   */
  static accepts(config = {}, requested = null) {
    if (requested === null || requested === undefined) {
      return true;
    }

    const { isRange, min, max } = ScMovementDistance.bounds(config);
    if (!isRange) {
      return true;
    }

    const value = ScMovementDistance.#requestedNumber(requested);
    return value !== null && value >= min && value <= max;
  }

  /**
   * The distances offered when the activity is used: the minimum, each grid
   * step between, and the maximum.
   */
  static choices(config = {}, step = 5) {
    const { isRange, min, max } = ScMovementDistance.bounds(config);
    if (!isRange) {
      return [max];
    }

    let unit = Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : 5;
    while (Math.ceil((max - min) / unit) + 1 > ScMovementDistance.MAX_CHOICES) {
      unit *= 2;
    }

    const values = [min];
    const firstStep = Math.floor(min / unit) + 1;
    // Indexed steps avoid accumulating rounding errors and keep iteration
    // bounded even when the step is below the precision of a large minimum.
    for (let index = 0; index < ScMovementDistance.MAX_CHOICES - 2; index += 1) {
      const value = ScMovementDistance.#round((firstStep + index) * unit);
      if (value >= max) {
        break;
      }
      if (value > values.at(-1)) {
        values.push(value);
      }
    }
    values.push(max);
    return values;
  }

  static #requestedNumber(value) {
    if ((typeof value !== "number" && typeof value !== "string")
      || (typeof value === "string" && !value.trim())) {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  static #nonNegative(value, fallback) {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
  }

  static #round(value) {
    return Number(value.toPrecision(15));
  }
}
