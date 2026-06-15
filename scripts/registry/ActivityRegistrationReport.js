export class ActivityRegistrationReport {
  #registered = [];
  #rejected = [];
  #warnings = [];
  #duplicates = [];
  #lateRegistrations = [];
  #flushed = [];
  #nativeTypes = [];
  #nativeTypeConflicts = [];
  #legacyTypeConflicts = [];

  addRegistered(entry) {
    this.#registered.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  addRejected(entry) {
    this.#rejected.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  addWarning(entry) {
    this.#warnings.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  addDuplicate(entry) {
    this.#duplicates.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  addLateRegistration(entry) {
    this.#lateRegistrations.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  addFlushed(entry) {
    this.#flushed.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  setNativeTypes(types) {
    this.#nativeTypes = Array.from(new Set(types ?? [])).sort();
  }

  addNativeTypeConflict(entry) {
    this.#nativeTypeConflicts.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  addLegacyTypeConflict(entry) {
    this.#legacyTypeConflicts.push(ActivityRegistrationReport.#clonePlain(entry));
  }

  snapshot() {
    return ActivityRegistrationReport.#deepFreeze({
      registered: ActivityRegistrationReport.#clonePlain(this.#registered),
      rejected: ActivityRegistrationReport.#clonePlain(this.#rejected),
      warnings: ActivityRegistrationReport.#clonePlain(this.#warnings),
      duplicates: ActivityRegistrationReport.#clonePlain(this.#duplicates),
      lateRegistrations: ActivityRegistrationReport.#clonePlain(this.#lateRegistrations),
      flushed: ActivityRegistrationReport.#clonePlain(this.#flushed),
      nativeTypes: ActivityRegistrationReport.#clonePlain(this.#nativeTypes),
      nativeTypeConflicts: ActivityRegistrationReport.#clonePlain(this.#nativeTypeConflicts),
      legacyTypeConflicts: ActivityRegistrationReport.#clonePlain(this.#legacyTypeConflicts)
    });
  }

  toJSON() {
    return this.snapshot();
  }

  static #clonePlain(value) {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }

  static #deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }

    Object.freeze(value);
    for (const nested of Object.values(value)) {
      ActivityRegistrationReport.#deepFreeze(nested);
    }
    return value;
  }
}
