const TYPE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const FALLBACK_NATIVE_TYPES = Object.freeze([
  "attack",
  "cast",
  "check",
  "damage",
  "enchant",
  "forward",
  "heal",
  "order",
  "save",
  "summon",
  "transform",
  "utility"
]);

const LEGACY_MORE_ACTIVITIES_TYPES = Object.freeze([
  "macro",
  "hook",
  "contested",
  "chain",
  "teleport",
  "movement",
  "sound",
  "grant",
  "wall",
  "advancement"
]);

const UI_SCOPES = Object.freeze(["native", "shattered-codex", "legacy", "external"]);

export class ActivityDefinitionValidator {
  static nativeTypes() {
    const configuredTypes = Object.keys(globalThis.CONFIG?.DND5E?.activityTypes ?? {});
    return Array.from(new Set([...FALLBACK_NATIVE_TYPES, ...configuredTypes])).sort();
  }

  static legacyMoreActivitiesTypes() {
    return [...LEGACY_MORE_ACTIVITIES_TYPES];
  }

  validate(definition) {
    const errors = [];
    const warnings = [];
    const moduleId = typeof definition?.moduleId === "string" ? definition.moduleId.trim() : "";
    const type = typeof definition?.type === "string" ? definition.type.trim() : "";

    if (!moduleId) {
      errors.push(this.#failure(definition, "missing-module-id", "Activity registration is missing moduleId."));
    }

    if (!type) {
      errors.push(this.#failure(definition, "missing-type", "Activity registration is missing type."));
    } else if (!TYPE_ID_PATTERN.test(type)) {
      errors.push(this.#failure(
        definition,
        "invalid-type-id",
        `Activity type ${type} must be lowercase ASCII and contain only letters, numbers, and hyphens.`
      ));
    }

    if (!definition?.documentClass) {
      errors.push(this.#failure(definition, "missing-document-class", `Activity type ${type || "(missing)"} is missing documentClass.`));
    } else if (typeof definition.documentClass !== "function") {
      errors.push(this.#failure(definition, "invalid-document-class", `Activity type ${type || "(missing)"} documentClass must be a class or constructor function.`));
    } else if (!definition.documentClass.metadata) {
      errors.push(this.#failure(definition, "missing-document-metadata", `Activity type ${type || "(missing)"} documentClass is missing static metadata.`));
    } else if (definition.documentClass.metadata.type && type && definition.documentClass.metadata.type !== type) {
      errors.push(this.#failure(
        definition,
        "metadata-type-mismatch",
        `Activity type ${type} does not match documentClass.metadata.type ${definition.documentClass.metadata.type}.`
      ));
    }

    if (typeof definition?.documentClass === "function") {
      if (typeof definition.documentClass.availableForItem !== "function") {
        errors.push(this.#failure(
          definition,
          "missing-available-for-item",
          `Activity type ${type || "(missing)"} documentClass is missing static availableForItem.`
        ));
      }
      if (typeof definition.documentClass.localize !== "function") {
        errors.push(this.#failure(
          definition,
          "missing-localize",
          `Activity type ${type || "(missing)"} documentClass is missing static localize.`
        ));
      }
    }

    if (type && ActivityDefinitionValidator.nativeTypes().includes(type) && !definition?.compatibility?.nativeBridge) {
      errors.push(this.#failure(definition, "native-type-reserved", `Activity type ${type} collides with a native dnd5e activity type.`));
    }

    if (type && LEGACY_MORE_ACTIVITIES_TYPES.includes(type) && !definition?.compatibility?.legacyAlias) {
      errors.push(this.#failure(definition, "legacy-type-reserved", `Activity type ${type} collides with a legacy More Activities type.`));
    }

    if (!definition?.label) {
      errors.push(this.#failure(definition, "missing-label", `Activity type ${type || "(missing)"} is missing label.`));
    }

    if (!definition?.hint) {
      errors.push(this.#failure(definition, "missing-hint", `Activity type ${type || "(missing)"} is missing hint.`));
    }

    if (!definition?.icon) {
      errors.push(this.#failure(definition, "missing-icon", `Activity type ${type || "(missing)"} is missing icon.`));
    }

    if (!definition?.dataModel) {
      warnings.push(this.#warning(definition, "missing-data-model", `Activity type ${type || "(missing)"} is missing dataModel.`));
    }

    if (!definition?.sheetClass && !definition?.documentClass?.metadata?.sheetClass) {
      warnings.push(this.#warning(definition, "missing-sheet-class", `Activity type ${type || "(missing)"} is missing sheetClass.`));
    }

    if (!definition?.ui) {
      warnings.push(this.#warning(definition, "missing-ui-metadata", `Activity type ${type || "(missing)"} is missing UI grouping metadata.`));
    } else {
      if (definition.ui.scope && !UI_SCOPES.includes(definition.ui.scope)) {
        warnings.push(this.#warning(definition, "invalid-ui-scope", `Activity type ${type || "(missing)"} has unsupported UI scope ${definition.ui.scope}.`));
      }
      if (definition.ui.order !== undefined && !Number.isFinite(Number(definition.ui.order))) {
        warnings.push(this.#warning(definition, "invalid-ui-order", `Activity type ${type || "(missing)"} has non-numeric UI order.`));
      }
    }

    if (!definition?.compatibility) {
      warnings.push(this.#warning(definition, "missing-compatibility", `Activity type ${type || "(missing)"} is missing compatibility metadata.`));
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings
    };
  }

  #failure(definition, reason, message) {
    return {
      ok: false,
      type: definition?.type ?? null,
      moduleId: definition?.moduleId ?? null,
      status: "rejected",
      reason,
      message,
      details: {}
    };
  }

  #warning(definition, reason, message) {
    return {
      type: definition?.type ?? null,
      moduleId: definition?.moduleId ?? null,
      reason,
      message
    };
  }
}
