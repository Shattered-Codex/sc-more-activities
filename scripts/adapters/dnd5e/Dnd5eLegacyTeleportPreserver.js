import { Constants } from "../../constants/Constants.js";
import { LEGACY_TELEPORT_SOURCE_KEYS } from "../../migration/LegacyMoreActivities.js";

const INSTALLED_ATTR = "__scMoreActivitiesLegacyTeleportPreserver";
const STASH_FLAG = "legacyTeleportSource";

/**
 * Keeps legacy More Activities teleport data readable under dnd5e 6.
 *
 * dnd5e 6 ships a native `teleport` activity. When Foundry builds a document it
 * cleans every activity against the schema registered for its type, so a
 * legacy teleport loses each field the native schema does not define before
 * the migration can read it. Field migration runs ahead of that cleaning, so
 * the native class's `migrateData` copies the legacy fields into this module's
 * flags, which the cleaning keeps.
 */
export class Dnd5eLegacyTeleportPreserver {
  static STASH_FLAG = STASH_FLAG;

  /**
   * Wraps the registered teleport's `migrateData`. Must run during `init`,
   * before Foundry constructs world and compendium documents.
   * @returns {boolean} whether the wrapper is in place
   */
  static install({
    activityTypes = globalThis.CONFIG?.DND5E?.activityTypes,
    nativeTeleport = globalThis.dnd5e?.documents?.activity?.TeleportActivity
  } = {}) {
    const documentClass = activityTypes?.teleport?.documentClass;
    if (typeof documentClass?.migrateData !== "function") {
      return false;
    }
    // When dnd5e exposes its native class, never wrap a teleport another
    // module registered in its place.
    if (nativeTeleport && documentClass !== nativeTeleport) {
      return false;
    }
    if (Object.hasOwn(documentClass, INSTALLED_ATTR)) {
      return true;
    }

    const originalMigrateData = documentClass.migrateData;
    documentClass.migrateData = function migrateDataPreservingLegacyTeleport(source, ...args) {
      Dnd5eLegacyTeleportPreserver.stash(source);
      return originalMigrateData.call(this, source, ...args);
    };
    Object.defineProperty(documentClass, INSTALLED_ATTR, {
      configurable: true,
      value: Object.freeze({ originalMigrateData })
    });
    return true;
  }

  /**
   * Whether a `teleport` activity source belongs to legacy More Activities.
   * Once a `teleport` type is registered (dnd5e 6 ships one) the type alone
   * is ambiguous, so only sources carrying legacy fields qualify.
   */
  static isLegacySource(source, activityTypes = globalThis.CONFIG?.DND5E?.activityTypes) {
    if (String(source?.type ?? "") !== "teleport") {
      return false;
    }
    if (!activityTypes?.teleport) {
      return true;
    }
    return LEGACY_TELEPORT_SOURCE_KEYS.some((key) => Object.hasOwn(source, key));
  }

  /** Copies legacy teleport fields into module flags. Mutates and returns `source`. */
  static stash(source) {
    if (!source || typeof source !== "object") {
      return source;
    }
    // Update diffs may omit the type; this class only migrates teleports.
    if (source.type !== undefined && source.type !== "teleport") {
      return source;
    }

    const legacy = {};
    for (const key of LEGACY_TELEPORT_SOURCE_KEYS) {
      if (Object.hasOwn(source, key) && source[key] !== undefined) {
        legacy[key] = Dnd5eLegacyTeleportPreserver.#clone(source[key]);
      }
    }
    if (!Object.keys(legacy).length) {
      return source;
    }

    const stash = Dnd5eLegacyTeleportPreserver.stashOf(source);
    const flags = Dnd5eLegacyTeleportPreserver.#objectAt(source, "flags");
    const moduleFlags = Dnd5eLegacyTeleportPreserver.#objectAt(flags, Constants.MODULE_ID);
    moduleFlags[STASH_FLAG] = { ...stash, ...legacy };
    return source;
  }

  static stashOf(source) {
    const stash = source?.flags?.[Constants.MODULE_ID]?.[STASH_FLAG];
    return stash && typeof stash === "object" && !Array.isArray(stash) ? stash : {};
  }

  /**
   * Returns a copy of a teleport source with its stashed legacy fields back at
   * the top level. The stash stays in place so a backup written back to a
   * dnd5e 6 document still carries the data through cleaning.
   */
  static restore(source) {
    if (String(source?.type ?? "") !== "teleport") {
      return source;
    }
    const stash = Dnd5eLegacyTeleportPreserver.stashOf(source);
    if (!Object.keys(stash).length) {
      return source;
    }
    return { ...Dnd5eLegacyTeleportPreserver.#clone(stash), ...source };
  }

  static #objectAt(target, key) {
    const value = target[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    target[key] = {};
    return target[key];
  }

  static #clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
}
