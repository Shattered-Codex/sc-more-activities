import { HOOKS } from "../constants/Hooks.js";
import { ActivityDefinitionValidator } from "./ActivityDefinitionValidator.js";
import { ActivityRegistrationReport } from "./ActivityRegistrationReport.js";

const LIFECYCLE_STATES = Object.freeze({
  CREATED: "created",
  COLLECTING: "collecting",
  FLUSHING: "flushing",
  LOCKED: "locked"
});

const REGISTRY_INTERNAL_ACCESS = Symbol("sc-more-activities.registry.internalAccess");

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

  flushWith(adapter) {
    if (this.#state === LIFECYCLE_STATES.LOCKED) {
      return this.getRegistrationReport();
    }

    if (this.#state !== LIFECYCLE_STATES.COLLECTING) {
      return this.getRegistrationReport();
    }

    try {
      this.#state = LIFECYCLE_STATES.FLUSHING;
      const result = adapter?.flush?.(this) ?? { flushed: [], rejected: [], warnings: [] };
      this.#recordFlushResult(result);
    } catch (error) {
      this.#report.addRejected({
        ok: false,
        type: null,
        moduleId: null,
        status: "rejected",
        reason: "adapter-error",
        message: error?.message ?? String(error),
        details: {}
      });
    } finally {
      this.#state = LIFECYCLE_STATES.LOCKED;
    }

    return this.getRegistrationReport();
  }

  #recordFlushResult(result) {
    for (const entry of result.flushed ?? []) {
      this.#report.addFlushed(entry);
    }
    for (const entry of result.rejected ?? []) {
      this.#report.addRejected(entry);
      if (entry.reason === "native-type-reserved" || entry.reason === "dnd5e-type-conflict") {
        this.#report.addNativeTypeConflict(entry);
      }
      if (entry.reason === "legacy-type-reserved") {
        this.#report.addLegacyTypeConflict(entry);
      }
    }
    for (const entry of result.warnings ?? []) {
      this.#report.addWarning(entry);
    }
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

  getDefinitionsForAdapter(accessToken) {
    if (accessToken !== REGISTRY_INTERNAL_ACCESS) {
      throw new Error("Activity definitions are internal and are not exposed through the public API.");
    }

    return Object.freeze(Array.from(this.#definitions.values())
      .map((definition) => ActivityRegistry.#freezeDefinitionCopy(definition))
      .sort((left, right) => left.type.localeCompare(right.type)));
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

  static #freezeDefinitionCopy(definition) {
    return ActivityRegistry.#deepFreeze({
      ...definition,
      ui: ActivityRegistry.#clonePlain(definition.ui),
      tags: [...definition.tags],
      compatibility: ActivityRegistry.#clonePlain(definition.compatibility),
      templates: [...definition.templates],
      migrations: [...definition.migrations],
      ownership: ActivityRegistry.#clonePlain(definition.ownership)
    });
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

export { LIFECYCLE_STATES, REGISTRY_INTERNAL_ACCESS };
