import { HOOKS } from "../constants/Hooks.js";
import { ActivityDefinitionValidator } from "./ActivityDefinitionValidator.js";
import { ActivityRegistrationReport } from "./ActivityRegistrationReport.js";

const LIFECYCLE_STATES = Object.freeze({
  CREATED: "created",
  COLLECTING: "collecting",
  FLUSHING: "flushing",
  LOCKED: "locked"
});

export class ActivityRegistry {
  #definitions = new Map();
  #report = new ActivityRegistrationReport();
  #validator;
  #state = LIFECYCLE_STATES.CREATED;

  constructor({ validator = new ActivityDefinitionValidator() } = {}) {
    this.#validator = validator;
    this.#report.setNativeTypes(ActivityDefinitionValidator.nativeTypes());
  }

  get lifecycleState() {
    return this.#state;
  }

  get isLocked() {
    return this.#state === LIFECYCLE_STATES.LOCKED;
  }

  beginCollection() {
    if (this.#state !== LIFECYCLE_STATES.CREATED) {
      return this.#state;
    }
    this.#state = LIFECYCLE_STATES.COLLECTING;
    return this.#state;
  }

  lock() {
    if (this.#state === LIFECYCLE_STATES.LOCKED) {
      return this.getRegistrationReport();
    }

    this.#state = LIFECYCLE_STATES.FLUSHING;
    this.#state = LIFECYCLE_STATES.LOCKED;
    return this.getRegistrationReport();
  }

  registerType(definition) {
    if (this.#state !== LIFECYCLE_STATES.COLLECTING) {
      return this.#reject(definition, this.isLocked ? "registry-locked" : "registry-not-collecting", `Activity registry is ${this.#state}.`);
    }

    const validation = this.#validator.validate(definition);
    for (const warning of validation.warnings) {
      this.#report.addWarning(warning);
    }

    if (!validation.ok) {
      for (const error of validation.errors) {
        this.#report.addRejected(error);
        if (error.reason === "native-type-reserved") {
          this.#report.addNativeTypeConflict(error);
        }
        if (error.reason === "legacy-type-reserved") {
          this.#report.addLegacyTypeConflict(error);
        }
      }
      return validation.errors[0];
    }

    const normalized = ActivityRegistry.#normalizeDefinition(definition);
    const existing = this.#definitions.get(normalized.type);
    if (existing && existing.moduleId !== normalized.moduleId) {
      const result = this.#reject(
        normalized,
        "duplicate-type",
        `Activity type ${normalized.type} is already registered by ${existing.moduleId}.`
      );
      this.#report.addDuplicate(result);
      return result;
    }

    if (existing && ActivityRegistry.#summariesEquivalent(existing, normalized)) {
      const summary = ActivityRegistry.#freezeSummary(ActivityRegistry.#toSummary(existing));
      return Object.freeze({
        ok: true,
        type: existing.type,
        moduleId: existing.moduleId,
        source: existing.source,
        status: "already-registered",
        warnings: ActivityRegistry.#freezeWarnings(validation.warnings),
        definition: summary
      });
    }

    if (existing && definition.updateExisting !== true) {
      const result = this.#reject(
        normalized,
        "conflicting-definition",
        `Activity type ${normalized.type} is already registered by ${existing.moduleId}; pass updateExisting: true to update it during collection.`
      );
      this.#report.addDuplicate(result);
      return result;
    }

    const status = existing ? "updated" : "registered";
    this.#definitions.set(normalized.type, normalized);
    const summary = ActivityRegistry.#freezeSummary(ActivityRegistry.#toSummary(normalized));
    const result = {
      ok: true,
      type: normalized.type,
      moduleId: normalized.moduleId,
      source: normalized.source,
      status,
      warnings: ActivityRegistry.#freezeWarnings(validation.warnings),
      definition: summary
    };
    this.#report.addRegistered(result);
    this.#emitRegisteredHook(normalized);
    return Object.freeze({ ...result });
  }

  hasType(type) {
    return this.#definitions.has(type);
  }

  getType(type) {
    const definition = this.#definitions.get(type);
    if (!definition) {
      return null;
    }
    return ActivityRegistry.#freezeSummary(ActivityRegistry.#toSummary(definition));
  }

  listTypes() {
    return Object.freeze(Array.from(this.#definitions.values())
      .map((definition) => ActivityRegistry.#freezeSummary(ActivityRegistry.#toSummary(definition)))
      .sort((left, right) => left.type.localeCompare(right.type)));
  }

  getRegistrationReport() {
    return this.#report.snapshot();
  }

  assertCanRegister() {
    if (this.#state === LIFECYCLE_STATES.COLLECTING) {
      return Object.freeze({
        ok: true,
        status: "available",
        lifecycleState: this.#state
      });
    }
    return Object.freeze({
      ok: false,
      status: "rejected",
      lifecycleState: this.#state,
      reason: this.isLocked ? "registry-locked" : "registry-not-collecting",
      message: `Activity registry is ${this.#state}; registration is only allowed during collecting.`,
      details: {}
    });
  }

  #reject(definition, reason, message) {
    const result = {
      ok: false,
      type: definition?.type ?? null,
      moduleId: definition?.moduleId ?? null,
      status: "rejected",
      reason,
      message,
      details: {}
    };
    this.#report.addRejected(result);
    if (reason === "registry-locked" || reason === "registry-not-collecting") {
      this.#report.addLateRegistration(result);
    }
    return Object.freeze({ ...result });
  }

  #emitRegisteredHook(definition) {
    globalThis.Hooks?.callAll?.(HOOKS.ACTIVITY_REGISTERED, {
      type: definition.type,
      moduleId: definition.moduleId,
      source: definition.source,
      definition: ActivityRegistry.#freezeSummary(ActivityRegistry.#toSummary(definition))
    });
  }

  static #normalizeDefinition(definition) {
    return {
      moduleId: String(definition.moduleId).trim(),
      type: String(definition.type).trim(),
      label: definition.label ?? "",
      hint: definition.hint ?? "",
      icon: definition.icon ?? "",
      documentClass: definition.documentClass,
      dataModel: definition.dataModel ?? null,
      sheetClass: definition.sheetClass ?? definition.documentClass?.metadata?.sheetClass ?? null,
      configurable: definition.configurable !== false,
      category: definition.category ?? "external",
      ui: ActivityRegistry.#clonePlain(definition.ui ?? null),
      tags: Array.isArray(definition.tags) ? [...definition.tags] : [],
      minModuleVersion: definition.minModuleVersion ?? null,
      compatibility: ActivityRegistry.#clonePlain(definition.compatibility ?? null),
      templates: Array.isArray(definition.templates) ? [...definition.templates] : [],
      migrations: Array.isArray(definition.migrations) ? [...definition.migrations] : [],
      ownership: ActivityRegistry.#clonePlain(definition.ownership ?? {}),
      source: definition.source ?? (definition.moduleId === "sc-more-activities" ? "built-in" : "external")
    };
  }

  static #toSummary(definition) {
    return {
      type: definition.type,
      moduleId: definition.moduleId,
      label: definition.label,
      hint: definition.hint,
      icon: definition.icon,
      category: definition.category,
      ui: ActivityRegistry.#clonePlain(definition.ui),
      tags: [...definition.tags],
      configurable: definition.configurable,
      compatibility: ActivityRegistry.#clonePlain(definition.compatibility),
      source: definition.source
    };
  }

  static #clonePlain(value) {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }

  static #freezeSummary(summary) {
    return ActivityRegistry.#deepFreeze(summary);
  }

  static #freezeWarnings(warnings) {
    return ActivityRegistry.#deepFreeze(ActivityRegistry.#clonePlain(warnings ?? []));
  }

  static #summariesEquivalent(left, right) {
    return JSON.stringify(ActivityRegistry.#toSummary(left)) === JSON.stringify(ActivityRegistry.#toSummary(right));
  }

  static #deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }

    Object.freeze(value);
    for (const nested of Object.values(value)) {
      ActivityRegistry.#deepFreeze(nested);
    }
    return value;
  }
}

export { LIFECYCLE_STATES };
