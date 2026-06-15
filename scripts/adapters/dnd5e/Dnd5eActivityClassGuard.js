export class Dnd5eActivityClassGuard {
  validateDefinition(definition) {
    const errors = [];
    const warnings = [];
    const type = definition?.type ?? null;
    const moduleId = definition?.moduleId ?? null;

    if (!definition?.documentClass || typeof definition.documentClass !== "function") {
      errors.push(Dnd5eActivityClassGuard.#failure(definition, "invalid-document-class", `Activity type ${type ?? "(missing)"} has no usable documentClass.`));
    } else {
      const metadata = definition.documentClass.metadata;
      if (!metadata || typeof metadata !== "object") {
        errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-document-metadata", `Activity type ${type} documentClass is missing metadata.`));
      } else if (metadata.type !== type) {
        errors.push(Dnd5eActivityClassGuard.#failure(definition, "metadata-type-mismatch", `Activity type ${type} does not match documentClass.metadata.type ${metadata.type}.`));
      } else {
        if (metadata.name && metadata.name !== "Activity") {
          errors.push(Dnd5eActivityClassGuard.#failure(definition, "invalid-document-metadata-name", `Activity type ${type} metadata.name must be Activity.`));
        }
        if (!metadata.title) {
          errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-metadata-title", `Activity type ${type} documentClass.metadata is missing title.`));
        }
        if (!metadata.hint) {
          errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-metadata-hint", `Activity type ${type} documentClass.metadata is missing hint.`));
        }
        if (!metadata.img) {
          errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-metadata-img", `Activity type ${type} documentClass.metadata is missing img.`));
        }
        if (metadata.title && definition.label && metadata.title !== definition.label) {
          warnings.push(Dnd5eActivityClassGuard.#warning(definition, "metadata-title-mismatch", `Activity type ${type} label differs from documentClass.metadata.title.`));
        }
        if (metadata.hint && definition.hint && metadata.hint !== definition.hint) {
          warnings.push(Dnd5eActivityClassGuard.#warning(definition, "metadata-hint-mismatch", `Activity type ${type} hint differs from documentClass.metadata.hint.`));
        }
        if (metadata.img && definition.icon && metadata.img !== definition.icon) {
          warnings.push(Dnd5eActivityClassGuard.#warning(definition, "metadata-img-mismatch", `Activity type ${type} icon differs from documentClass.metadata.img.`));
        }
      }

      if (typeof definition.documentClass.availableForItem !== "function") {
        errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-available-for-item", `Activity type ${type} documentClass is missing availableForItem.`));
      }

      if (typeof definition.documentClass.localize !== "function") {
        errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-localize", `Activity type ${type} documentClass is missing localize.`));
      }

      if (typeof definition.documentClass.prototype?.use !== "function") {
        errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-use-method", `Activity type ${type} documentClass prototype is missing use.`));
      }
    }

    if (definition?.sheetClass && typeof definition.sheetClass !== "function") {
      errors.push(Dnd5eActivityClassGuard.#failure(definition, "invalid-sheet-class", `Activity type ${type} sheetClass must be a constructor function.`));
    }

    const metadataSheetClass = definition?.documentClass?.metadata?.sheetClass;
    if (definition?.sheetClass && metadataSheetClass && definition.sheetClass !== metadataSheetClass) {
      errors.push(Dnd5eActivityClassGuard.#failure(definition, "sheet-class-mismatch", `Activity type ${type} sheetClass differs from documentClass.metadata.sheetClass.`));
    }

    if (definition?.sheetClass && !metadataSheetClass) {
      errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-metadata-sheet-class", `Activity type ${type ?? "(missing)"} provides sheetClass but documentClass.metadata.sheetClass is missing.`));
    }

    if (definition?.configurable !== false && !metadataSheetClass) {
      errors.push(Dnd5eActivityClassGuard.#failure(definition, "missing-configurable-sheet-class", `Configurable activity type ${type ?? "(missing)"} has no documentClass.metadata.sheetClass.`));
    }

    if (definition?.dataModel && typeof definition.dataModel !== "function") {
      errors.push(Dnd5eActivityClassGuard.#failure(definition, "invalid-data-model", `Activity type ${type} dataModel must be a constructor function.`));
    }

    if (
      definition?.dataModel
      && typeof definition.documentClass === "function"
      && !(definition.documentClass.prototype instanceof definition.dataModel)
    ) {
      errors.push(Dnd5eActivityClassGuard.#failure(definition, "data-model-mismatch", `Activity type ${type} documentClass does not extend dataModel.`));
    }

    if (!definition?.dataModel) {
      warnings.push(Dnd5eActivityClassGuard.#warning(definition, "missing-data-model", `Activity type ${type ?? "(missing)"} has no dataModel in the registry definition.`));
    }

    if (!definition?.sheetClass && !definition?.documentClass?.metadata?.sheetClass) {
      warnings.push(Dnd5eActivityClassGuard.#warning(definition, "missing-sheet-class", `Activity type ${type ?? "(missing)"} has no sheetClass in the registry definition or metadata.`));
    }

    return {
      ok: errors.length === 0,
      type,
      moduleId,
      errors,
      warnings
    };
  }

  static #failure(definition, reason, message) {
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

  static #warning(definition, reason, message) {
    return {
      type: definition?.type ?? null,
      moduleId: definition?.moduleId ?? null,
      reason,
      message
    };
  }
}
