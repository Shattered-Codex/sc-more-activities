import { ActivityAvailability } from "../../availability/ActivityAvailability.js";
import { Constants } from "../../constants/Constants.js";

const AVAILABILITY_GUARD_ATTR = "__scMoreActivitiesAvailabilityGuard";

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

    const guardedDocumentClass = Dnd5eActivityTypeRegistrar.#installAvailabilityGuard(definition);
    const config = {
      documentClass: guardedDocumentClass,
      typeLabel: definition.label,
      configurable: definition.configurable !== false,
      scMoreActivities: {
        moduleId: definition.moduleId,
        source: definition.source,
        category: definition.category,
        ui: definition.ui ?? null
      }
    };
    if (definition.sheetClass ?? guardedDocumentClass?.metadata?.sheetClass) {
      config.sheetClass = definition.sheetClass ?? guardedDocumentClass.metadata.sheetClass;
    }
    if (definition.dataModel) {
      config.dataModel = definition.dataModel;
    }

    try {
      guardedDocumentClass.localize();
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

  static #installAvailabilityGuard(definition) {
    const documentClass = definition.documentClass;
    if (documentClass?.[AVAILABILITY_GUARD_ATTR]?.type === definition.type) {
      return documentClass;
    }

    const type = definition.type;
    const originalAvailableForItem = documentClass.availableForItem;
    const originalPreCreate = documentClass.prototype?._preCreate;
    const originalCanConfigure = Dnd5eActivityTypeRegistrar.#getPropertyDescriptor(documentClass.prototype, "canConfigure");
    const originalCanUse = Dnd5eActivityTypeRegistrar.#getPropertyDescriptor(documentClass.prototype, "canUse");

    documentClass.availableForItem = function availableForItemWithScMoreActivitiesAvailability(...args) {
      return ActivityAvailability.isTypeEnabled(type) && originalAvailableForItem.call(this, ...args);
    };

    if (documentClass.prototype) {
      Object.defineProperty(documentClass.prototype, "canConfigure", {
        configurable: true,
        get() {
          const original = Dnd5eActivityTypeRegistrar.#readDescriptor(originalCanConfigure, this, true);
          if (!original) {
            return false;
          }
          return ActivityAvailability.isTypeEnabled(type) || game?.user?.isGM === true;
        }
      });

      Object.defineProperty(documentClass.prototype, "canUse", {
        configurable: true,
        get() {
          return ActivityAvailability.isTypeEnabled(type)
            && Dnd5eActivityTypeRegistrar.#readDescriptor(originalCanUse, this, true);
        }
      });

      documentClass.prototype._preCreate = async function preCreateWithScMoreActivitiesAvailability(...args) {
        if (!ActivityAvailability.isTypeEnabled(type)) {
          ui?.notifications?.warn?.(Constants.format(
            "SCMOREACTIVITIES.Warning.ActivityTypeDisabled",
            { type: Constants.localize(definition.label, type) },
            `${Constants.localize(definition.label, type)} is disabled by the GM.`
          ));
          return false;
        }

        return typeof originalPreCreate === "function"
          ? originalPreCreate.call(this, ...args)
          : true;
      };
    }

    Object.defineProperty(documentClass, AVAILABILITY_GUARD_ATTR, {
      configurable: true,
      value: Object.freeze({
        type,
        originalAvailableForItem,
        originalCanConfigure,
        originalCanUse,
        originalPreCreate
      })
    });
    return documentClass;
  }

  static #getPropertyDescriptor(prototype, property) {
    let cursor = prototype;
    while (cursor) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, property);
      if (descriptor) {
        return descriptor;
      }
      cursor = Object.getPrototypeOf(cursor);
    }
    return null;
  }

  static #readDescriptor(descriptor, target, fallback) {
    if (typeof descriptor?.get === "function") {
      return descriptor.get.call(target);
    }
    if (typeof descriptor?.value === "function") {
      return descriptor.value.call(target);
    }
    if (descriptor && "value" in descriptor) {
      return descriptor.value;
    }
    return fallback;
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
