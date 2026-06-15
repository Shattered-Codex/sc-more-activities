export class Dnd5eActivityTypeRegistrar {
  get activityTypes() {
    return globalThis.CONFIG?.DND5E?.activityTypes ?? null;
  }

  isAvailable() {
    return Boolean(this.activityTypes);
  }

  getNativeTypes() {
    return Object.freeze(Object.keys(this.activityTypes ?? {}).sort());
  }

  hasType(type) {
    return Object.prototype.hasOwnProperty.call(this.activityTypes ?? {}, type);
  }

  register(definition) {
    const activityTypes = this.activityTypes;
    if (!activityTypes) {
      return Dnd5eActivityTypeRegistrar.#failure(definition, "dnd5e-config-unavailable", "CONFIG.DND5E.activityTypes is not available.");
    }

    if (this.hasType(definition.type)) {
      return Dnd5eActivityTypeRegistrar.#failure(definition, "dnd5e-type-conflict", `CONFIG.DND5E.activityTypes already contains ${definition.type}.`);
    }

    const config = {
      documentClass: definition.documentClass,
      typeLabel: definition.label,
      configurable: definition.configurable !== false,
      scMoreActivities: {
        moduleId: definition.moduleId,
        source: definition.source,
        category: definition.category,
        ui: definition.ui ?? null
      }
    };
    if (definition.sheetClass ?? definition.documentClass?.metadata?.sheetClass) {
      config.sheetClass = definition.sheetClass ?? definition.documentClass.metadata.sheetClass;
    }
    if (definition.dataModel) {
      config.dataModel = definition.dataModel;
    }

    try {
      definition.documentClass.localize();
      activityTypes[definition.type] = config;
    } catch (error) {
      return Dnd5eActivityTypeRegistrar.#failure(
        definition,
        "dnd5e-registration-failed",
        error?.message ?? String(error)
      );
    }

    return Object.freeze({
      ok: true,
      type: definition.type,
      moduleId: definition.moduleId,
      source: definition.source,
      status: "flushed"
    });
  }

  static #failure(definition, reason, message) {
    return Object.freeze({
      ok: false,
      type: definition?.type ?? null,
      moduleId: definition?.moduleId ?? null,
      status: "rejected",
      reason,
      message,
      details: {}
    });
  }
}
