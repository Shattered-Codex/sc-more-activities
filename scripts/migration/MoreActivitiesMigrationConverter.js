import { Constants } from "../constants/Constants.js";
import { LEGACY_MORE_ACTIVITIES_TARGET_TYPES } from "./LegacyMoreActivities.js";

const COMMON_ACTIVITY_KEYS = Object.freeze([
  "_id",
  "id",
  "name",
  "img",
  "sort",
  "activation",
  "consumption",
  "description",
  "duration",
  "effects",
  "range",
  "target",
  "uses",
  "visibility",
  "chatFlavor",
  "flags"
]);

export class MoreActivitiesMigrationConverter {
  static preview(activitySource = {}, context = {}) {
    const legacyType = String(activitySource?.type ?? "").trim();
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES[legacyType] ?? null;
    if (!targetType) {
      return Object.freeze({
        ok: false,
        legacyType,
        targetType: null,
        convertible: false,
        lossy: false,
        reason: "unsupported-activity-type",
        warnings: []
      });
    }

    const result = MoreActivitiesMigrationConverter.#convert(activitySource, context, false);
    return Object.freeze({
      ok: result.ok,
      legacyType,
      targetType,
      convertible: result.ok,
      lossy: result.lossy === true,
      reason: result.reason ?? null,
      warnings: Object.freeze([...(result.warnings ?? [])])
    });
  }

  static convert(activitySource = {}, context = {}) {
    const result = MoreActivitiesMigrationConverter.#convert(activitySource, context, true);
    return Object.freeze({
      ...result,
      warnings: Object.freeze([...(result.warnings ?? [])])
    });
  }

  static #convert(activitySource, context, includeSource) {
    const legacyType = String(activitySource?.type ?? "").trim();
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES[legacyType] ?? null;
    if (!targetType) {
      return {
        ok: false,
        legacyType,
        targetType: null,
        convertible: false,
        lossy: false,
        reason: "unsupported-activity-type",
        warnings: []
      };
    }

    switch (legacyType) {
      case "macro":
        return MoreActivitiesMigrationConverter.#convertMacro(activitySource, context, includeSource);
      case "hook":
        return MoreActivitiesMigrationConverter.#blocked(
          legacyType,
          targetType,
          "unsupported-legacy-hook",
          "Legacy hook activities use listener and macro behavior that does not map safely to sc-hook."
        );
      case "contested":
        return MoreActivitiesMigrationConverter.#convertContest(activitySource, context, includeSource);
      case "chain":
        return MoreActivitiesMigrationConverter.#convertChain(activitySource, context, includeSource);
      case "teleport":
        return MoreActivitiesMigrationConverter.#convertTeleport(activitySource, context, includeSource);
      case "movement":
        return MoreActivitiesMigrationConverter.#convertMovement(activitySource, context, includeSource);
      case "sound":
        return MoreActivitiesMigrationConverter.#convertSound(activitySource, context, includeSource);
      case "grant":
        return MoreActivitiesMigrationConverter.#convertGrant(activitySource, context, includeSource);
      case "wall":
        return MoreActivitiesMigrationConverter.#convertWall(activitySource, context, includeSource);
      case "advancement":
        return MoreActivitiesMigrationConverter.#convertAdvancement(activitySource, context, includeSource);
      default:
        return MoreActivitiesMigrationConverter.#blocked(
          legacyType,
          targetType,
          "unsupported-activity-type",
          `Unsupported legacy activity type: ${legacyType}`
        );
    }
  }

  static #convertMacro(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.macro;
    const warnings = [];
    const unmapped = {};
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.execution = { mode: "inline" };
    convertedSource.inline = { code: String(activitySource?.macroCode ?? "") };
    convertedSource.world = { macroUuid: "" };
    warnings.push("Converted legacy macroCode to inline SC macro code. Inline execution is GM-only.");
    unmapped.macroCode = activitySource?.macroCode ?? "";
    return MoreActivitiesMigrationConverter.#success({
      legacyType: "macro",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: true,
      context
    });
  }

  static #convertContest(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.contested;
    if (activitySource?.attackerRollType === "spellcasting" || activitySource?.defenderRollType === "spellcasting") {
      return MoreActivitiesMigrationConverter.#blocked(
        "contested",
        targetType,
        "unsupported-contest-roll-type",
        "Legacy contested activities using spellcasting rolls cannot be mapped safely to sc-contest."
      );
    }

    const warnings = [];
    const unmapped = {};
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.contest = {
      targetSource: "target",
      tiePolicy: MoreActivitiesMigrationConverter.#mapTiePolicy(activitySource?.tieCondition),
      initiator: MoreActivitiesMigrationConverter.#mapContestParticipant(
        "attacker",
        activitySource?.attackerRollType,
        activitySource?.attackerOptions,
        activitySource?.attackerCustom,
        warnings
      ),
      defender: MoreActivitiesMigrationConverter.#mapContestParticipant(
        "defender",
        activitySource?.defenderRollType,
        activitySource?.defenderOptions,
        null,
        warnings
      )
    };

    if (activitySource?.allowPlayerTargeting) {
      warnings.push("Broader defender selection is not preserved. sc-contest uses the currently targeted defender.");
      unmapped.allowPlayerTargeting = true;
    }
    if (Array.isArray(activitySource?.effectGroups) && activitySource.effectGroups.length) {
      warnings.push("Legacy contested effect groups were preserved under migration flags and must be rebuilt manually.");
      unmapped.effectGroups = MoreActivitiesMigrationConverter.#clone(activitySource.effectGroups);
    }
    for (const key of ["allowMinorSuccess", "thresholdMinorSuccess", "allowMajorSuccess", "thresholdMajorSuccess", "attackerLabel", "defenderLabel"]) {
      if (activitySource?.[key] !== undefined) {
        unmapped[key] = MoreActivitiesMigrationConverter.#clone(activitySource[key]);
      }
    }

    return MoreActivitiesMigrationConverter.#success({
      legacyType: "contested",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: Object.keys(unmapped).length > 0 || warnings.length > 0,
      context
    });
  }

  static #convertChain(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.chain;
    const warnings = [];
    const unmapped = {};
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    const activityIds = Array.isArray(activitySource?.chainedActivityIds)
      ? activitySource.chainedActivityIds.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    convertedSource.chain = {
      activityIds: activityIds.join("\n"),
      maxDepth: 5,
      continueOnFailure: false,
      stopOnCancel: true
    };

    if (Array.isArray(activitySource?.chainTriggers) && activitySource.chainTriggers.length) {
      warnings.push("Legacy chain triggers were not migrated to sc-chain and were preserved under migration flags.");
      unmapped.chainTriggers = MoreActivitiesMigrationConverter.#clone(activitySource.chainTriggers);
    }
    if (Array.isArray(activitySource?.chainListeners) && activitySource.chainListeners.length) {
      warnings.push("Legacy chain listeners were not migrated to sc-chain and were preserved under migration flags.");
      unmapped.chainListeners = MoreActivitiesMigrationConverter.#clone(activitySource.chainListeners);
    }
    if (Array.isArray(activitySource?.chainedActivityNames) && activitySource.chainedActivityNames.length) {
      unmapped.chainedActivityNames = MoreActivitiesMigrationConverter.#clone(activitySource.chainedActivityNames);
    }

    return MoreActivitiesMigrationConverter.#success({
      legacyType: "chain",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: Object.keys(unmapped).length > 0 || warnings.length > 0,
      context
    });
  }

  static #convertTeleport(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.teleport;
    const warnings = [];
    const unmapped = {};
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.teleport = {
      maxTargets: MoreActivitiesMigrationConverter.#toPositiveInteger(activitySource?.maxTargets, 1),
      targetSelf: activitySource?.targetSelf === true,
      onlyTargetSelf: activitySource?.onlyTargetSelf === true,
      targetRadius: MoreActivitiesMigrationConverter.#toNonNegativeNumber(activitySource?.targetRadius, 15),
      teleportDistance: MoreActivitiesMigrationConverter.#toNonNegativeNumber(activitySource?.teleportDistance, 30),
      keepArrangement: activitySource?.keepArrangement === true,
      clusterRadius: MoreActivitiesMigrationConverter.#toNonNegativeNumber(activitySource?.clusterRadius, 5),
      snapToGrid: true
    };

    for (const key of ["manualPlacement", "manualRadius", "autoApply", "appliedEffects"]) {
      if (activitySource?.[key] !== undefined && activitySource[key] !== false && activitySource[key] !== "") {
        unmapped[key] = MoreActivitiesMigrationConverter.#clone(activitySource[key]);
      }
    }
    if (Object.keys(unmapped).length) {
      warnings.push("Legacy teleport placement and auto-apply options were preserved under migration flags and require manual review.");
    }

    return MoreActivitiesMigrationConverter.#success({
      legacyType: "teleport",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: Object.keys(unmapped).length > 0,
      context
    });
  }

  static #convertMovement(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.movement;
    const movementType = String(activitySource?.movementType ?? "push").trim().toLowerCase();
    if (!["push", "pull"].includes(movementType)) {
      return MoreActivitiesMigrationConverter.#blocked(
        "movement",
        targetType,
        "unsupported-movement-type",
        `Legacy movement type ${movementType} cannot be mapped safely to sc-movement.`
      );
    }

    const warnings = [];
    const unmapped = {};
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.movement = {
      targetSource: activitySource?.targetSelf === true || activitySource?.onlyTargetSelf === true ? "self" : "targets",
      type: movementType,
      distance: MoreActivitiesMigrationConverter.#toNonNegativeNumber(activitySource?.movementDistance, 10),
      maxRange: MoreActivitiesMigrationConverter.#toNonNegativeNumber(activitySource?.targetRange, 0),
      maxTargets: MoreActivitiesMigrationConverter.#toPositiveInteger(activitySource?.maxTargets, 1),
      snapToGrid: true
    };

    for (const key of ["autoApply", "appliedEffects"]) {
      if (activitySource?.[key] !== undefined && activitySource[key] !== false && activitySource[key] !== "") {
        unmapped[key] = MoreActivitiesMigrationConverter.#clone(activitySource[key]);
      }
    }
    if (Object.keys(unmapped).length) {
      warnings.push("Legacy movement auto-apply data was preserved under migration flags and must be rebuilt manually.");
    }

    return MoreActivitiesMigrationConverter.#success({
      legacyType: "movement",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: Object.keys(unmapped).length > 0,
      context
    });
  }

  static #convertSound(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.sound;
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.audio = {
      source: String(activitySource?.soundFile ?? ""),
      volume: MoreActivitiesMigrationConverter.#clampNumber(activitySource?.volume, 0.8, 0, 1)
    };
    convertedSource.playback = {
      audience: activitySource?.playForAll === true ? "everyone" : "self"
    };
    const unmapped = {
      soundFile: String(activitySource?.soundFile ?? ""),
      playForAll: activitySource?.playForAll === true,
      volume: MoreActivitiesMigrationConverter.#clampNumber(activitySource?.volume, 0.8, 0, 1)
    };
    return MoreActivitiesMigrationConverter.#success({
      legacyType: "sound",
      targetType,
      convertedSource,
      warnings: [],
      unmapped,
      includeSource,
      lossy: false,
      context
    });
  }

  static #convertGrant(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.grant;
    const grants = Array.isArray(activitySource?.grants)
      ? activitySource.grants.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    const hasComplexBehavior = activitySource?.grantAll === false
      || activitySource?.swappable === true
      || activitySource?.spellsAsScrolls === true
      || MoreActivitiesMigrationConverter.#hasNonDefaultJson(activitySource?.itemCustomizations)
      || MoreActivitiesMigrationConverter.#hasNonDefaultJson(activitySource?.advancementIds)
      || MoreActivitiesMigrationConverter.#hasGrantCosts(activitySource);
    if (hasComplexBehavior) {
      return MoreActivitiesMigrationConverter.#blocked(
        "grant",
        targetType,
        "unsupported-complex-grant",
        "Legacy grant activities with swap, cost, customization, scroll, or advancement behavior cannot be migrated safely."
      );
    }

    const warnings = [];
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    const count = MoreActivitiesMigrationConverter.#toPositiveInteger(activitySource?.count, 1);
    convertedSource.recipient = "self";
    convertedSource.grants = grants.map((uuid, index) => ({
      uuid,
      quantity: grants.length === 1 ? count : 1
    }));
    if (grants.length > 1 && count > 1) {
      warnings.push("Legacy grant count was ignored for multiple grant entries. Review quantities manually.");
    }
    const unmapped = {
      grantAll: activitySource?.grantAll !== false,
      count
    };
    return MoreActivitiesMigrationConverter.#success({
      legacyType: "grant",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: warnings.length > 0,
      context
    });
  }

  static #convertWall(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.wall;
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.wall = {
      maxWalls: String(activitySource?.maxWalls ?? "1"),
      wallType: String(activitySource?.wallType ?? "continuous"),
      facing: String(activitySource?.facing ?? "both"),
      panelSize: String(activitySource?.panelSize ?? "5"),
      panelSpacing: String(activitySource?.panelSpacing ?? "0"),
      maxPanels: String(activitySource?.maxPanels ?? ""),
      referenceRange: String(activitySource?.referenceRange ?? "0"),
      maxLength: String(activitySource?.maxLength ?? "60"),
      blocksMovement: activitySource?.blocksMovement !== false,
      blocksSight: activitySource?.blocksSight !== false,
      blocksSound: activitySource?.blocksSound === true,
      allowPlayerRequests: false
    };
    return MoreActivitiesMigrationConverter.#success({
      legacyType: "wall",
      targetType,
      convertedSource,
      warnings: [],
      unmapped: {},
      includeSource,
      lossy: false,
      context
    });
  }

  static #convertAdvancement(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.advancement;
    const sourceItemUuid = String(activitySource?.sourceItem ?? "").trim();
    if (!sourceItemUuid) {
      return MoreActivitiesMigrationConverter.#blocked(
        "advancement",
        targetType,
        "missing-source-item",
        "Legacy advancement activities without a source item UUID cannot be migrated safely."
      );
    }

    const warnings = [];
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.sourceItemUuid = sourceItemUuid;
    convertedSource.selections = MoreActivitiesMigrationConverter.#mapAdvancementSelections(
      activitySource?.advancementIds,
      context?.sourceItemAdvancements
    );
    if (activitySource?.allowReselection !== undefined) {
      warnings.push("Legacy allowReselection is not used by sc-advancement and was preserved under migration flags.");
    }
    const unmapped = {};
    if (activitySource?.allowReselection !== undefined) {
      unmapped.allowReselection = activitySource.allowReselection;
    }
    return MoreActivitiesMigrationConverter.#success({
      legacyType: "advancement",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: warnings.length > 0,
      context
    });
  }

  static #success({
    legacyType,
    targetType,
    convertedSource,
    warnings,
    unmapped,
    includeSource,
    lossy,
    context
  }) {
    const source = includeSource
      ? MoreActivitiesMigrationConverter.#attachMigrationFlags(
        convertedSource,
        legacyType,
        warnings,
        unmapped,
        context
      )
      : null;
    return {
      ok: true,
      legacyType,
      targetType,
      convertible: true,
      lossy: lossy === true,
      reason: null,
      warnings,
      convertedSource: source
    };
  }

  static #blocked(legacyType, targetType, reason, warning) {
    return {
      ok: false,
      legacyType,
      targetType,
      convertible: false,
      lossy: false,
      reason,
      warnings: warning ? [warning] : []
    };
  }

  static #baseSource(activitySource, targetType) {
    const source = {};
    for (const key of COMMON_ACTIVITY_KEYS) {
      if (activitySource?.[key] !== undefined) {
        source[key] = MoreActivitiesMigrationConverter.#clone(activitySource[key]);
      }
    }
    source.type = targetType;
    return source;
  }

  static #attachMigrationFlags(convertedSource, legacyType, warnings, unmapped, context = {}) {
    const source = MoreActivitiesMigrationConverter.#clone(convertedSource);
    const baseFlags = source.flags && typeof source.flags === "object"
      ? MoreActivitiesMigrationConverter.#clone(source.flags)
      : {};
    const existingModuleFlags = baseFlags[Constants.MODULE_ID] && typeof baseFlags[Constants.MODULE_ID] === "object"
      ? MoreActivitiesMigrationConverter.#clone(baseFlags[Constants.MODULE_ID])
      : {};

    existingModuleFlags.migration = {
      sourceModule: "more-activities",
      legacyType,
      previewId: context?.previewId ?? null,
      migratedAt: context?.migratedAt ?? null,
      warnings: [...warnings],
      unmapped: MoreActivitiesMigrationConverter.#clone(unmapped)
    };

    baseFlags[Constants.MODULE_ID] = existingModuleFlags;
    source.flags = baseFlags;
    return source;
  }

  static #mapTiePolicy(value) {
    switch (String(value ?? "").trim().toLowerCase()) {
      case "attacker":
        return "initiator";
      case "defender":
        return "defender";
      case "tie":
      default:
        return "tie";
    }
  }

  static #mapContestParticipant(role, rollType, options, custom, warnings) {
    const primaryOption = Array.isArray(options) ? String(options[0] ?? "").trim() : "";
    if (Array.isArray(options) && options.length > 1) {
      warnings.push(`Legacy contested ${role} options had multiple choices. Only the first option was migrated.`);
    }

    switch (String(rollType ?? "ability").trim().toLowerCase()) {
      case "skill":
        return {
          rollType: "skill",
          ability: "str",
          skill: primaryOption || "ath",
          formula: `1d20 + @skills.${primaryOption || "ath"}.mod`
        };
      case "custom":
        return {
          rollType: "custom",
          ability: "str",
          skill: "ath",
          formula: String(custom ?? "").trim() || "1d20"
        };
      case "ability":
      default:
        return {
          rollType: "ability-check",
          ability: primaryOption || "str",
          skill: "ath",
          formula: `1d20 + @abilities.${primaryOption || "str"}.mod`
        };
    }
  }

  static #mapAdvancementSelections(advancementIds, sourceItemAdvancements = {}) {
    const ids = Array.isArray(advancementIds)
      ? advancementIds.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    return ids.map((advancementId) => ({
      advancementId,
      level: MoreActivitiesMigrationConverter.#resolveAdvancementLevel(advancementId, sourceItemAdvancements)
    }));
  }

  static #resolveAdvancementLevel(advancementId, sourceItemAdvancements = {}) {
    const advancement = sourceItemAdvancements?.[advancementId] ?? null;
    if (!advancement) {
      return 0;
    }
    const explicitLevel = Number(advancement.level);
    if (Number.isFinite(explicitLevel)) {
      return Math.max(0, Math.trunc(explicitLevel));
    }
    if (Array.isArray(advancement.levels) && advancement.levels.length) {
      const firstLevel = Number(advancement.levels[0]);
      if (Number.isFinite(firstLevel)) {
        return Math.max(0, Math.trunc(firstLevel));
      }
    }
    return 0;
  }

  static #hasNonDefaultJson(value) {
    const normalized = String(value ?? "").trim();
    return normalized !== "" && normalized !== "{}";
  }

  static #hasGrantCosts(source = {}) {
    const costGroups = Array.isArray(source?.costGroups) ? source.costGroups : [];
    if (costGroups.length) {
      return true;
    }
    return ["baseCost", "spellCost", "consumeItemId", "consumeItemAmount"].some((key) => {
      const normalized = String(source?.[key] ?? "").trim();
      return normalized !== "" && normalized !== "0";
    });
  }

  static #toPositiveInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(1, Math.trunc(number));
  }

  static #toNonNegativeNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(0, number);
  }

  static #clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  static #clone(value) {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }
}

