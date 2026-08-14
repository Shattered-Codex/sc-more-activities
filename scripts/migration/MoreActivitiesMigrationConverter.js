import { Constants } from "../constants/Constants.js";
import { ACTIVITY_TYPES } from "../activities/ActivityTypes.js";
import { FLOW_CONDITION_TYPES, FLOW_END } from "../activities/conditional-chain/ScConditionalChainFlow.js";
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
      targetType: result.targetType ?? targetType,
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
    // Legacy chains branch whenever a step carries triggers: the runtime stops
    // after that step, posts the trigger buttons, and resumes on the steps whose
    // listeners match. sc-chain is strictly linear and cannot express that, so
    // branching chains go to sc-conditional-chain instead.
    //
    // A step only ever posted its triggers when the runtime got that far:
    // executeChainedActivity returned early when the step's activity id did not
    // resolve, and the buttons were guarded on `index < chainedActivityIds.length
    // - 1`. Triggers on a blank step, on the last step, or past the end of the
    // chain therefore never fired and do not make the chain branch.
    const triggers = MoreActivitiesMigrationConverter.#chainMatrix(activitySource?.chainTriggers);
    const activityIds = MoreActivitiesMigrationConverter.#chainActivityIdsRaw(activitySource);
    const lastIndex = activityIds.length - 1;
    const branching = triggers.some((entry, index) => (
      entry.length > 0 && index < lastIndex && Boolean(activityIds[index])
    ));

    // No activity at all means nothing to run and nothing to branch on, whatever
    // the trigger matrix says. Converting it would produce an empty sc-chain
    // that only warns when used.
    if (!activityIds.some(Boolean)) {
      return MoreActivitiesMigrationConverter.#blocked(
        "chain",
        LEGACY_MORE_ACTIVITIES_TARGET_TYPES.chain,
        "empty-legacy-chain",
        "This legacy chain declares no chained activities."
      );
    }

    return branching
      ? MoreActivitiesMigrationConverter.#convertBranchingChain(activitySource, context, includeSource, triggers)
      : MoreActivitiesMigrationConverter.#convertLinearChain(activitySource, context, includeSource);
  }

  static #convertLinearChain(activitySource, context, includeSource) {
    const targetType = LEGACY_MORE_ACTIVITIES_TARGET_TYPES.chain;
    const warnings = [];
    const unmapped = {};
    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    const rawIds = MoreActivitiesMigrationConverter.#chainActivityIdsRaw(activitySource);
    const activityIds = rawIds.filter(Boolean);
    convertedSource.chain = {
      activityIds: activityIds.join("\n"),
      maxDepth: 5,
      continueOnFailure: false,
      stopOnCancel: true
    };

    // The legacy runtime only ever executed the first step of a chain without
    // triggers: executeChainedActivity ran one activity and returned, and only a
    // trigger button resumed it. A blank first step made it return before running
    // anything at all. sc-chain runs the whole sequence, which is what the legacy
    // sheet always implied but never did, so the remaining steps become live.
    // That is a deliberate behaviour change and has to be flagged loudly.
    const legacyExecuted = rawIds[0] ?? "";
    const neverExecuted = legacyExecuted ? activityIds.slice(1) : [...activityIds];
    if (neverExecuted.length) {
      warnings.push(legacyExecuted
        ? `Legacy chains without triggers only ever executed the first step ("${legacyExecuted}"); `
          + `sc-chain runs all ${activityIds.length} steps in order. `
          + "Damage, consumption, and effects on the later steps never fired before and will fire now — review them."
        : "This legacy chain's first step had no activity id, so the legacy runtime executed nothing at all; "
          + `sc-chain runs all ${activityIds.length} step(s) listed here. `
          + "Damage, consumption, and effects that never fired before will fire now — review them.");
      unmapped.unexecutedLegacySteps = neverExecuted;
    }

    if (MoreActivitiesMigrationConverter.#chainMatrix(activitySource?.chainTriggers).some((entry) => entry.length)) {
      warnings.push(
        "Legacy chain triggers on the last step, or past the end of the chain, were never posted by the legacy "
        + "runtime and were preserved under migration flags."
      );
      unmapped.chainTriggers = MoreActivitiesMigrationConverter.#clone(activitySource.chainTriggers);
    }
    if (MoreActivitiesMigrationConverter.#chainMatrix(activitySource?.chainListeners).some((entry) => entry.length)) {
      warnings.push("Legacy chain listeners without matching triggers can never fire and were preserved under migration flags.");
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

  static #convertBranchingChain(activitySource, context, includeSource, triggers) {
    const targetType = ACTIVITY_TYPES.CONDITIONAL_CHAIN;
    const warnings = [];
    const unmapped = {};
    // Triggers and listeners are indexed against the raw legacy array, so this
    // path must not compact it: dropping a blank id would shift every branch.
    const activityIds = MoreActivitiesMigrationConverter.#chainActivityIdsRaw(activitySource);
    const listeners = MoreActivitiesMigrationConverter.#chainMatrix(activitySource?.chainListeners);
    const names = Array.isArray(activitySource?.chainedActivityNames) ? activitySource.chainedActivityNames : [];
    // Every listener key a choice can actually fire. Anything left over belongs
    // to a trigger the migration did not turn into a choice.
    const consumedKeys = new Set();
    const nodes = activityIds.map((activityId, index) => MoreActivitiesMigrationConverter.#chainNode({
      index,
      activityId,
      label: String(names[index] ?? "").trim(),
      stepTriggers: triggers[index] ?? [],
      listeners,
      total: activityIds.length,
      consumedKeys,
      warnings,
      unmapped
    }));

    // Nodes only exist for the steps the legacy chain declared, so triggers
    // stored past the end are never read above. Preserve them rather than
    // dropping data the flags promise to keep.
    const trailingTriggers = {};
    for (let index = activityIds.length; index < triggers.length; index += 1) {
      if (triggers[index].length) {
        trailingTriggers[index] = [...triggers[index]];
      }
    }
    if (Object.keys(trailingTriggers).length) {
      warnings.push(
        "Legacy triggers stored past the end of the chain could never fire and were preserved under migration flags."
      );
      unmapped.trailingTriggers = trailingTriggers;
    }

    // The dead triggers are preserved above, but a GM rebuilding those branches
    // by hand needs the trigger -> listener link too, and the flags only keep it
    // for the keys a choice ended up owning. Everything else — listeners on an
    // ignored trigger, on a repeated label, or on a key no trigger ever had — is
    // recorded here rather than dropped.
    const unconsumedListeners = {};
    listeners.forEach((stepListeners, index) => {
      const dead = stepListeners.filter((key) => !consumedKeys.has(key));
      if (dead.length) {
        unconsumedListeners[index] = dead;
      }
    });
    if (Object.keys(unconsumedListeners).length) {
      warnings.push(
        "Legacy listeners keyed to a trigger that never became a choice can never fire and were preserved "
        + "under migration flags."
      );
      unmapped.unconsumedListeners = unconsumedListeners;
    }

    const convertedSource = MoreActivitiesMigrationConverter.#baseSource(activitySource, targetType);
    convertedSource.flow = {
      startNode: MoreActivitiesMigrationConverter.#chainNodeId(0),
      maxDepth: 5,
      stopOnCancel: true,
      continueOnChildError: false,
      suppressChildMessages: false,
      compactChildCards: false,
      nodes
    };

    warnings.push(
      "Legacy branch triggers were converted into conditional chain choice steps. "
      + "The legacy module posted those buttons on the chat card; sc-conditional-chain asks for the choice in a dialog instead."
    );
    if (nodes.some((node) => node.conditionType === FLOW_CONDITION_TYPES.ALWAYS)) {
      warnings.push(
        "The legacy runtime ran a single step and stopped unless that step posted trigger buttons, "
        + "so every step without triggers now ends the flow. Route them manually if the chain should continue."
      );
    }

    const unreachable = MoreActivitiesMigrationConverter.#unreachableChainNodes(nodes);
    if (unreachable.length) {
      warnings.push(
        `${unreachable.length} legacy step(s) cannot be reached from the first step and never ran in the legacy module either. `
        + "They were kept as flow steps so nothing is lost; wire or delete them manually."
      );
      unmapped.unreachableSteps = unreachable.map((node) => node.nodeId);
    }

    return MoreActivitiesMigrationConverter.#success({
      legacyType: "chain",
      targetType,
      convertedSource,
      warnings,
      unmapped,
      includeSource,
      lossy: true,
      context
    });
  }

  static #chainNode({ index, activityId, label, stepTriggers, listeners, total, consumedKeys, warnings, unmapped }) {
    const node = {
      nodeId: MoreActivitiesMigrationConverter.#chainNodeId(index),
      label,
      activityId,
      conditionType: FLOW_CONDITION_TYPES.ALWAYS,
      routes: {
        next: FLOW_END,
        onTrue: FLOW_END,
        onFalse: FLOW_END,
        fallback: FLOW_END
      },
      choices: [],
      valueBranches: []
    };

    if (!stepTriggers.length) {
      // The legacy runtime never advanced on its own: executeChainedActivity ran
      // exactly one step and returned, and only a trigger button resumed the
      // chain. Falling through to index + 1 here would run the opposite branch
      // of a "Hit / Miss" chain, so a step without triggers ends the flow.
      return node;
    }

    const quotedTriggers = stepTriggers.map((triggerLabel) => `"${triggerLabel}"`).join(", ");

    if (!activityId) {
      // executeChainedActivity looked the activity up first and returned when it
      // did not resolve, before adding the trigger buttons. A choice node here
      // would offer branches the legacy chain never reached, making the steps
      // behind them executable for the first time.
      warnings.push(
        `Legacy trigger(s) ${quotedTriggers} sit on a step with no activity id, which the legacy runtime `
        + "never got past. They were preserved under migration flags instead of becoming a choice step."
      );
      unmapped.ignoredEmptyStepTriggers ??= {};
      unmapped.ignoredEmptyStepTriggers[MoreActivitiesMigrationConverter.#chainNodeId(index)] = [...stepTriggers];
      return node;
    }

    if (index === total - 1) {
      // The runtime posted trigger buttons only while `index <
      // chainedActivityIds.length - 1`, so triggers on the last step never
      // fired and no later step could listen to them. A choice node here would
      // pop a dialog the legacy chain never showed, after the activity already
      // ran, and dismissing it would look like a cancelled execution.
      warnings.push(
        `Legacy trigger(s) ${quotedTriggers} sit on the last step, `
        + "which the legacy runtime never offered. They were preserved under migration flags instead of "
        + "becoming a choice step."
      );
      unmapped.ignoredLastStepTriggers ??= {};
      unmapped.ignoredLastStepTriggers[MoreActivitiesMigrationConverter.#chainNodeId(index)] = [...stepTriggers];
      return node;
    }

    node.conditionType = FLOW_CONDITION_TYPES.CHOICE;
    const firstKeyByLabel = new Map();
    for (const [triggerIndex, triggerLabel] of stepTriggers.entries()) {
      const key = `${index}:${triggerIndex}`;

      // continueChainFrom resolved a clicked button with
      // sourceTriggers.indexOf(label), so every button sharing a label always
      // resumed the first occurrence. One choice per position would make the
      // steps behind the repeats executable for the first time.
      const resolvedKey = firstKeyByLabel.get(triggerLabel);
      if (resolvedKey) {
        warnings.push(
          `Legacy trigger "${triggerLabel}" is repeated on this step. The legacy runtime resolved every button `
          + `with that label to "${resolvedKey}", so the repeat never fired. It was preserved under migration `
          + "flags instead of becoming a second choice."
        );
        unmapped.duplicateTriggers ??= {};
        unmapped.duplicateTriggers[key] = { label: triggerLabel, resolvedKey };
        continue;
      }
      firstKeyByLabel.set(triggerLabel, key);
      consumedKeys.add(key);

      const { targets, beyond } = MoreActivitiesMigrationConverter.#chainListenerTargets(listeners, key, index, total);
      if (beyond.length) {
        // Routing to a node that was never built would fail validateFlow with
        // unknown-route and block the whole chain at runtime.
        warnings.push(
          `Legacy trigger "${triggerLabel}" was listened to by step(s) past the end of the chain `
          + `(${beyond.map((target) => target + 1).join(", ")}), which never existed. `
          + "Those listeners were preserved under migration flags."
        );
        unmapped.outOfRangeListeners ??= {};
        unmapped.outOfRangeListeners[key] = [...beyond];
      }
      if (targets.length > 1) {
        // The legacy runtime opened a branch picker when several steps listened
        // to the same trigger. A choice route resolves to exactly one node.
        warnings.push(
          `Legacy trigger "${triggerLabel}" resumed ${targets.length} steps and opened a branch picker. `
          + "The migration routes it to the first step; rebuild the remaining branches manually."
        );
        unmapped.droppedBranches ??= {};
        unmapped.droppedBranches[key] = targets.slice(1)
          .map((target) => MoreActivitiesMigrationConverter.#chainNodeId(target));
      }
      if (!targets.length) {
        warnings.push(`Legacy trigger "${triggerLabel}" had no listening step and now ends the flow.`);
      }

      node.choices.push({
        key,
        label: triggerLabel,
        next: targets.length ? MoreActivitiesMigrationConverter.#chainNodeId(targets[0]) : FLOW_END
      });
    }

    return node;
  }

  static #unreachableChainNodes(nodes) {
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const reached = new Set();
    const queue = nodes.length ? [nodes[0].nodeId] : [];

    while (queue.length) {
      const nodeId = queue.shift();
      if (!nodeId || nodeId === FLOW_END || reached.has(nodeId)) {
        continue;
      }
      reached.add(nodeId);
      const node = byId.get(nodeId);
      if (!node) {
        continue;
      }
      queue.push(node.routes.next, ...node.choices.map((choice) => choice.next));
    }

    return nodes.filter((node) => node.activityId && !reached.has(node.nodeId));
  }

  /**
   * Splits the steps listening to `key` into the ones that map to a real flow
   * node and the ones the legacy data placed past the end of the chain.
   */
  static #chainListenerTargets(listeners, key, fromIndex, total) {
    const targets = [];
    const beyond = [];
    for (let index = fromIndex + 1; index < listeners.length; index += 1) {
      if (!listeners[index].includes(key)) {
        continue;
      }
      if (index < total) {
        targets.push(index);
      } else {
        beyond.push(index);
      }
    }
    return { targets, beyond };
  }

  static #chainActivityIds(activitySource) {
    return MoreActivitiesMigrationConverter.#chainActivityIdsRaw(activitySource).filter(Boolean);
  }

  static #chainActivityIdsRaw(activitySource) {
    return Array.isArray(activitySource?.chainedActivityIds)
      ? activitySource.chainedActivityIds.map((entry) => String(entry ?? "").trim())
      : [];
  }

  static #chainMatrix(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => (Array.isArray(entry)
      ? entry.map((item) => String(item ?? "").trim()).filter(Boolean)
      : []));
  }

  static #chainNodeId(index) {
    return `node-${index}`;
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
    if (!["push", "pull", "either"].includes(movementType)) {
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
