import { ActivityAvailability } from "../availability/ActivityAvailability.js";

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

  listTypeAvailability = () => {
    const disabledMap = ActivityAvailability.getDisabledMap();
    return Object.freeze(this.#registry.listTypes().map((summary) => Object.freeze({
      type: summary.type,
      label: summary.label,
      moduleId: summary.moduleId,
      category: summary.category,
      scope: summary.ui?.scope ?? summary.scope ?? "external",
      enabled: disabledMap[summary.type] !== true,
      disabled: disabledMap[summary.type] === true
    })));
  };

  getTypeAvailability = (type) => {
    if (!this.#registry.hasType(type)) {
      return RegistrationApi.#failure(type, "unregistered-type", `Activity type ${type} is not registered with sc-more-activities.`);
    }

    const enabled = ActivityAvailability.isTypeEnabled(type);
    return Object.freeze({
      ok: true,
      type,
      registered: true,
      enabled,
      disabled: !enabled,
      status: enabled ? "enabled" : "disabled"
    });
  };

  listEnabledTypes = () => {
    return Object.freeze(this.#registry.listTypes()
      .filter((summary) => ActivityAvailability.isTypeEnabled(summary.type)));
  };

  isTypeEnabled = (type) => {
    if (!this.#registry.hasType(type)) {
      return true;
    }
    return ActivityAvailability.isTypeEnabled(type);
  };

  setTypeEnabled = async (type, enabled = true) => {
    if (!this.#registry.hasType(type)) {
      return RegistrationApi.#failure(type, "unregistered-type", `Activity type ${type} is not registered with sc-more-activities.`);
    }

    return ActivityAvailability.setTypeEnabled(type, enabled === true);
  };

  enableType = async (type) => {
    return this.setTypeEnabled(type, true);
  };

  disableType = async (type) => {
    return this.setTypeEnabled(type, false);
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

    if (!this.isTypeEnabled(type)) {
      return RegistrationApi.#failure(type, "activity-type-disabled", `Activity type ${type} is disabled by the GM.`);
    }

    if (!globalThis.CONFIG?.DND5E?.activityTypes?.[type]) {
      return RegistrationApi.#failure(type, "adapter-unavailable", `Activity type ${type} has not been flushed to dnd5e yet.`);
    }

    if (typeof resolvedItem.createActivity !== "function") {
      return RegistrationApi.#failure(type, "create-activity-unavailable", "The target item does not expose createActivity.");
    }

    try {
      const activityId = data._id ?? RegistrationApi.#randomId();
      const createData = { ...data, _id: activityId };
      await resolvedItem.createActivity(type, createData, { ...options, renderSheet: false });
      const activity = resolvedItem.system.activities?.get?.(activityId) ?? null;
      return Object.freeze({
        ok: true,
        type,
        status: "created",
        item: resolvedItem,
        activity
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
      listTypeAvailability: this.listTypeAvailability,
      getTypeAvailability: this.getTypeAvailability,
      listEnabledTypes: this.listEnabledTypes,
      isTypeEnabled: this.isTypeEnabled,
      setTypeEnabled: this.setTypeEnabled,
      enableType: this.enableType,
      disableType: this.disableType,
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

  static #randomId() {
    return globalThis.foundry?.utils?.randomID?.()
      ?? globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 16)
      ?? Math.random().toString(36).slice(2, 18);
  }
}
