export class RegistrationApi {
  #registry;

  constructor({ registry }) {
    this.#registry = registry;
  }

  registerType = (definition) => {
    return this.#registry.registerType(definition);
  };

  listTypes = () => {
    return this.#registry.listTypes();
  };

  getType = (type) => {
    return this.#registry.getType(type);
  };

  hasType = (type) => {
    return this.#registry.hasType(type);
  };

  getRegistrationReport = () => {
    return this.#registry.getRegistrationReport();
  };

  getLifecycleState = () => {
    return this.#registry.lifecycleState;
  };

  isRegistryLocked = () => {
    return this.#registry.isLocked;
  };

  assertCanRegister = () => {
    return this.#registry.assertCanRegister();
  };

  createActivityOnItem = async (item, type, data = {}, options = {}) => {
    const resolvedItem = await RegistrationApi.#resolveItem(item);
    if (!resolvedItem) {
      return RegistrationApi.#failure(type, "item-not-found", "Could not resolve the target item.");
    }

    if (!resolvedItem.system?.activities) {
      return RegistrationApi.#failure(type, "item-without-activities", "The target item does not support system.activities.");
    }

    if (!this.#registry.hasType(type)) {
      return RegistrationApi.#failure(type, "unregistered-type", `Activity type ${type} is not registered with sc-more-activities.`);
    }

    if (!globalThis.CONFIG?.DND5E?.activityTypes?.[type]) {
      return RegistrationApi.#failure(type, "adapter-unavailable", `Activity type ${type} has not been flushed to dnd5e yet.`);
    }

    if (typeof resolvedItem.createActivity !== "function") {
      return RegistrationApi.#failure(type, "create-activity-unavailable", "The target item does not expose createActivity.");
    }

    try {
      const created = await resolvedItem.createActivity(type, data, options);
      return Object.freeze({
        ok: true,
        type,
        status: "created",
        item: resolvedItem,
        activity: created ?? null
      });
    } catch (error) {
      return RegistrationApi.#failure(type, "create-activity-failed", error?.message ?? String(error));
    }
  };

  asPublicObject() {
    return Object.freeze({
      registerType: this.registerType,
      listTypes: this.listTypes,
      getType: this.getType,
      hasType: this.hasType,
      getRegistrationReport: this.getRegistrationReport,
      getLifecycleState: this.getLifecycleState,
      isRegistryLocked: this.isRegistryLocked,
      assertCanRegister: this.assertCanRegister,
      createActivityOnItem: this.createActivityOnItem
    });
  }

  static async #resolveItem(item) {
    if (!item) {
      return null;
    }
    if (typeof item === "string") {
      return globalThis.fromUuid ? await globalThis.fromUuid(item) : null;
    }
    return item;
  }

  static #failure(type, reason, message) {
    return Object.freeze({
      ok: false,
      type: type ?? null,
      status: "failed",
      reason,
      message
    });
  }
}
