/**
 * Where a chain step's measured template is centred.
 *
 * A step can borrow the landing point of any earlier step that produced one —
 * a teleport's destination, say — so a spell can drop its area exactly where
 * the caster arrived instead of asking for a second click.
 */
export class ScTemplateOrigin {
  static MODES = Object.freeze({
    DEFAULT: "default",
    STEP: "step"
  });

  /**
   * Activity types that publish a landing point. Only these are worth offering
   * as an origin; every other step would resolve to nothing.
   */
  static PROVIDER_TYPES = Object.freeze(["sc-teleport"]);

  static modes() {
    return Object.values(ScTemplateOrigin.MODES);
  }

  static provides(activityType) {
    return ScTemplateOrigin.PROVIDER_TYPES.includes(String(activityType ?? "").trim());
  }

  static field(fields) {
    // Only the chosen step is stored: the mode is derived from it, so the two
    // can never disagree, and the sheet needs a single select with an empty
    // option rather than a mode picker beside it.
    return new fields.SchemaField({
      stepId: new fields.StringField({
        required: false,
        blank: true,
        initial: ""
      })
    });
  }

  static normalize(config = {}) {
    const stepId = String(config?.stepId ?? "").trim();
    return {
      mode: stepId ? ScTemplateOrigin.MODES.STEP : ScTemplateOrigin.MODES.DEFAULT,
      stepId
    };
  }

  static isOverridden(config) {
    return ScTemplateOrigin.normalize(config).mode === ScTemplateOrigin.MODES.STEP;
  }

  /** A finite scene point, or null when the value is not usable as one. */
  static point(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  /**
   * The point a step should centre on, or null to leave placement to the
   * system — the referenced step may not have run, or may have produced no
   * destination at all.
   *
   * @param {object} config                 The step's template origin config.
   * @param {Map<string, object>} results   Snapshots by step id.
   */
  static resolvePoint(config, results) {
    const normalized = ScTemplateOrigin.normalize(config);
    if (normalized.mode !== ScTemplateOrigin.MODES.STEP) {
      return null;
    }

    const snapshot = results?.get?.(normalized.stepId) ?? null;
    return ScTemplateOrigin.point(snapshot?.activity?.destination);
  }

  /**
   * Steps offered as an origin: those declared before this one whose activity
   * actually produces a landing point.
   *
   * A later step is excluded on purpose. It cannot have run yet when this one
   * needs the point, so choosing it would quietly fall back to the interactive
   * placement — an option that never works is worse than no option.
   *
   * @param {object[]} nodes            The flow's steps, in declaration order.
   * @param {string} currentNodeId      The step being configured.
   * @param {Map<string, object>} index Activities by id, for their type.
   */
  static stepOptions(nodes = [], currentNodeId = "", index = null) {
    const list = Array.from(nodes);
    const currentIndex = list.findIndex((node) => node?.nodeId === currentNodeId);
    const options = [];
    for (const [position, node] of list.entries()) {
      if (!node?.nodeId || node.nodeId === currentNodeId) {
        continue;
      }
      if (currentIndex >= 0 && position > currentIndex) {
        continue;
      }
      const type = index?.get?.(node.activityId)?.type ?? null;
      if (index && !ScTemplateOrigin.provides(type)) {
        continue;
      }
      options.push({
        value: node.nodeId,
        label: String(node.label ?? "").trim() || node.nodeId
      });
    }
    return options;
  }
}
