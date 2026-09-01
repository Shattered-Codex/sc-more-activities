/**
 * Size gating for canvas activities: which token sizes an activity may act on,
 * either as an absolute list or as a span relative to the origin token.
 *
 * Follows the module's "unset means unlimited" convention — an activity left
 * half configured keeps working rather than silently refusing every target.
 */
export class ScTokenSize {
  /** D&D 5e sizes, smallest first. The index is what comparisons use. */
  static ORDER = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);

  static MODES = Object.freeze({
    ANY: "any",
    ABSOLUTE: "absolute",
    RELATIVE: "relative"
  });

  /** How far a relative span may reach; one step past the largest gap. */
  static OFFSET_LIMIT = 5;

  static modes() {
    return Object.values(ScTokenSize.MODES);
  }

  static field(fields) {
    return new fields.SchemaField({
      mode: new fields.StringField({
        required: false,
        initial: ScTokenSize.MODES.ANY,
        choices: ScTokenSize.modes()
      }),
      // ArrayField, like every other list in this module's schemas; Foundry
      // submits repeated checkboxes of one name as an array.
      sizes: new fields.ArrayField(new fields.StringField(), {
        required: false,
        initial: []
      }),
      minOffset: new fields.NumberField({
        required: false,
        initial: -1,
        integer: true,
        min: -ScTokenSize.OFFSET_LIMIT,
        max: ScTokenSize.OFFSET_LIMIT
      }),
      maxOffset: new fields.NumberField({
        required: false,
        initial: 1,
        integer: true,
        min: -ScTokenSize.OFFSET_LIMIT,
        max: ScTokenSize.OFFSET_LIMIT
      })
    });
  }

  static normalize(config = {}) {
    const mode = ScTokenSize.modes().includes(config?.mode) ? config.mode : ScTokenSize.MODES.ANY;
    const sizes = Array.from(config?.sizes ?? [])
      .map((size) => String(size ?? "").trim())
      .filter((size) => ScTokenSize.ORDER.includes(size));

    const clamp = (value, fallback) => {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return Math.min(Math.max(parsed, -ScTokenSize.OFFSET_LIMIT), ScTokenSize.OFFSET_LIMIT);
    };

    let minOffset = clamp(config?.minOffset, -1);
    let maxOffset = clamp(config?.maxOffset, 1);
    // A reversed span would match nothing at all, which is never what a GM
    // means by it; read it as the span between the two values.
    if (minOffset > maxOffset) {
      [minOffset, maxOffset] = [maxOffset, minOffset];
    }

    return { mode, sizes, minOffset, maxOffset };
  }

  /** The size index of a token, or null when the token has no known size. */
  static indexOf(token) {
    const document = token?.document ?? token;
    const size = document?.actor?.system?.traits?.size
      ?? token?.actor?.system?.traits?.size
      ?? null;
    const index = ScTokenSize.ORDER.indexOf(String(size ?? ""));
    return index >= 0 ? index : null;
  }

  static isRestricted(config) {
    const normalized = ScTokenSize.normalize(config);
    if (normalized.mode === ScTokenSize.MODES.ANY) {
      return false;
    }
    if (normalized.mode === ScTokenSize.MODES.ABSOLUTE) {
      // No size picked reads as "not configured yet", not "forbid everything".
      return normalized.sizes.length > 0;
    }
    return normalized.minOffset !== -ScTokenSize.OFFSET_LIMIT
      || normalized.maxOffset !== ScTokenSize.OFFSET_LIMIT;
  }

  /**
   * Whether a target passes the gate. An unknown size passes: the rule cannot
   * be shown to fail, and refusing on missing data would block tokens with no
   * actor for no stated reason.
   */
  static matches(config, { originIndex = null, targetIndex = null } = {}) {
    const normalized = ScTokenSize.normalize(config);
    if (!ScTokenSize.isRestricted(normalized) || targetIndex === null) {
      return true;
    }

    if (normalized.mode === ScTokenSize.MODES.ABSOLUTE) {
      return normalized.sizes.includes(ScTokenSize.ORDER[targetIndex]);
    }

    if (originIndex === null) {
      return true;
    }
    const offset = targetIndex - originIndex;
    return offset >= normalized.minOffset && offset <= normalized.maxOffset;
  }

  /** Convenience wrapper for callers holding tokens rather than indices. */
  static matchesTokens(config, origin, target) {
    return ScTokenSize.matches(config, {
      originIndex: ScTokenSize.indexOf(origin),
      targetIndex: ScTokenSize.indexOf(target)
    });
  }

  static label(size) {
    const key = `SCMOREACTIVITIES.Activities.Canvas.Fields.TargetSize.Sizes.${size}`;
    return globalThis.game?.i18n?.localize?.(key) ?? size;
  }

  static sizeOptions(selected = []) {
    const chosen = new Set(Array.from(selected ?? []));
    return ScTokenSize.ORDER.map((size) => ({
      value: size,
      label: ScTokenSize.label(size),
      selected: chosen.has(size)
    }));
  }

  static modeOptions() {
    return ScTokenSize.modes().map((value) => ({
      value,
      label: globalThis.game?.i18n?.localize?.(
        `SCMOREACTIVITIES.Activities.Canvas.Fields.TargetSize.Modes.${value}`
      ) ?? value
    }));
  }

  static offsetOptions() {
    const options = [];
    for (let offset = -ScTokenSize.OFFSET_LIMIT; offset <= ScTokenSize.OFFSET_LIMIT; offset += 1) {
      options.push({
        value: offset,
        label: offset > 0 ? `+${offset}` : String(offset)
      });
    }
    return options;
  }
}
