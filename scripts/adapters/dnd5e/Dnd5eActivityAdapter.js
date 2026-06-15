import { REGISTRY_INTERNAL_ACCESS } from "../../registry/ActivityRegistry.js";
import { Dnd5eActivityClassGuard } from "./Dnd5eActivityClassGuard.js";
import { Dnd5eActivityTypeRegistrar } from "./Dnd5eActivityTypeRegistrar.js";

export class Dnd5eActivityAdapter {
  #classGuard;
  #registrar;

  constructor({
    classGuard = new Dnd5eActivityClassGuard(),
    registrar = new Dnd5eActivityTypeRegistrar()
  } = {}) {
    this.#classGuard = classGuard;
    this.#registrar = registrar;
  }

  isAvailable() {
    return this.#registrar.isAvailable();
  }

  getNativeTypes() {
    return this.#registrar.getNativeTypes();
  }

  flush(registry) {
    const definitions = registry.getDefinitionsForAdapter(REGISTRY_INTERNAL_ACCESS);
    const result = {
      flushed: [],
      rejected: [],
      warnings: []
    };

    if (!this.#registrar.activityTypes) {
      result.rejected.push({
        ok: false,
        type: null,
        moduleId: null,
        status: "rejected",
        reason: "dnd5e-config-unavailable",
        message: "CONFIG.DND5E.activityTypes is not available.",
        details: {}
      });
      return result;
    }

    const candidates = [];
    for (const definition of definitions) {
      const validation = this.#classGuard.validateDefinition(definition);
      result.warnings.push(...validation.warnings);
      if (!validation.ok) {
        result.rejected.push(...validation.errors);
        continue;
      }

      if (this.#registrar.hasType(definition.type)) {
        result.rejected.push({
          ok: false,
          type: definition.type,
          moduleId: definition.moduleId,
          status: "rejected",
          reason: "dnd5e-type-conflict",
          message: `CONFIG.DND5E.activityTypes already contains ${definition.type}.`,
          details: {}
        });
        continue;
      }

      candidates.push(definition);
    }

    for (const definition of candidates) {
      const registration = this.#registrar.register(definition);
      if (registration.ok) {
        result.flushed.push(registration);
      } else {
        result.rejected.push(registration);
      }
    }

    return result;
  }
}
