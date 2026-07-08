const TRACKING_KEY = "scMoreActivitiesActivityResult";
const LAST_RESULT_KEY = "scMoreActivitiesLastResult";

export class ScActivityResultTracker {
  static TRACKING_KEY = TRACKING_KEY;
  static LAST_RESULT_KEY = LAST_RESULT_KEY;

  static #records = new Map();
  static #registered = false;

  static registerHooks() {
    if (ScActivityResultTracker.#registered || typeof Hooks?.on !== "function") {
      return;
    }
    ScActivityResultTracker.#registered = true;
    Hooks.on("dnd5e.preUseActivity", (activity, usageConfig) => {
      ScActivityResultTracker.#onPreUseActivity(activity, usageConfig);
    });
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      ScActivityResultTracker.#onPostUseActivity(activity, usageConfig, results);
    });
    Hooks.on("dnd5e.preRollAttackV2", (rollConfig) => {
      ScActivityResultTracker.#injectLastResultRollData(rollConfig);
    });
    Hooks.on("dnd5e.preRollDamageV2", (rollConfig) => {
      ScActivityResultTracker.#injectLastResultRollData(rollConfig);
    });
  }

  static withTrackedUsage(usage = {}, activity, lastResult = undefined) {
    const trackedUsage = {
      ...(usage ?? {}),
      [TRACKING_KEY]: {
        executionId: ScActivityResultTracker.#randomId(),
        trackerKey: ScActivityResultTracker.#trackerKey(activity),
        activityType: String(activity?.type ?? "").trim()
      }
    };
    if (lastResult !== undefined) {
      if (lastResult === null) {
        delete trackedUsage[LAST_RESULT_KEY];
      } else {
        trackedUsage[LAST_RESULT_KEY] = ScActivityResultTracker.#clone(lastResult);
      }
    }
    return trackedUsage;
  }

  static withLastResult(usage = {}, lastResult = undefined) {
    const next = { ...(usage ?? {}) };
    if (lastResult === undefined) {
      return next;
    }
    if (lastResult === null) {
      delete next[LAST_RESULT_KEY];
      return next;
    }
    next[LAST_RESULT_KEY] = ScActivityResultTracker.#clone(lastResult);
    return next;
  }

  static getLastResult(usage = {}) {
    const value = usage?.[LAST_RESULT_KEY];
    return value === undefined ? undefined : ScActivityResultTracker.#clone(value);
  }

  static recordActivityResult(usageLike, partial = {}) {
    const meta = ScActivityResultTracker.#trackingMeta(usageLike);
    if (!meta) {
      return;
    }
    const record = ScActivityResultTracker.#ensureRecord(meta);
    ScActivityResultTracker.#mergeRecord(record, partial);
    if (record.useComplete && !record.awaitsAsyncResult && !record.finalized) {
      ScActivityResultTracker.#finalize(record);
    }
  }

  static cancelUsage(usageLike, reason = "canceled") {
    const meta = ScActivityResultTracker.#trackingMeta(usageLike);
    if (!meta) {
      return;
    }
    const record = ScActivityResultTracker.#ensureRecord(meta);
    ScActivityResultTracker.#finalize(record, {
      canceled: true,
      activity: { canceled: true, reason }
    });
  }

  static async resolveUsageResult(activity, usageLike, immediateResults) {
    const meta = ScActivityResultTracker.#trackingMeta(usageLike);
    if (!meta) {
      if (immediateResults === undefined) {
        return null;
      }
      return ScActivityResultTracker.#snapshotFromUse(activity, immediateResults);
    }

    if (immediateResults === undefined) {
      ScActivityResultTracker.cancelUsage(usageLike);
      const canceled = await ScActivityResultTracker.#ensureRecord(meta).promise;
      ScActivityResultTracker.#records.delete(meta.executionId);
      return ScActivityResultTracker.#clone(canceled);
    }

    const record = ScActivityResultTracker.#ensureRecord(meta, activity);
    if (!record.useComplete) {
      ScActivityResultTracker.#mergeRecord(record, ScActivityResultTracker.#snapshotFromUse(activity, immediateResults));
      record.useComplete = true;
    }
    if (!record.awaitsAsyncResult && !record.finalized) {
      ScActivityResultTracker.#finalize(record);
    }

    if (record.finalized) {
      const snapshot = ScActivityResultTracker.#clone(record.snapshot);
      ScActivityResultTracker.#records.delete(meta.executionId);
      return snapshot;
    }

    const snapshot = await record.promise;
    ScActivityResultTracker.#records.delete(meta.executionId);
    return ScActivityResultTracker.#clone(snapshot);
  }

  static buildRollSnapshot(kind, rolls, extra = {}) {
    const list = Array.isArray(rolls) ? rolls.filter(Boolean) : (rolls ? [rolls] : []);
    const primary = list.find((roll) => Number.isFinite(Number(roll?.total))) ?? list[0] ?? null;
    const totals = list
      .map((roll) => Number(roll?.total))
      .filter((total) => Number.isFinite(total));

    const total = Number.isFinite(Number(primary?.total)) ? Number(primary.total) : null;
    const sum = totals.length ? totals.reduce((left, right) => left + right, 0) : null;
    const dice = ScActivityResultTracker.#diceSnapshot(list);
    const critical = ScActivityResultTracker.#asBoolean(primary?.isCritical);
    const fumble = ScActivityResultTracker.#asBoolean(primary?.isFumble);
    const directTarget = ScActivityResultTracker.#directRollTarget(primary, extra);
    const messageTarget = kind === "attack"
      ? ScActivityResultTracker.#attackMessageTarget(primary)
      : null;
    const target = ScActivityResultTracker.#rollTarget(primary, extra, messageTarget);
    const hasTarget = Number.isFinite(target);
    const hasDirectTarget = Number.isFinite(directTarget);

    let success = hasDirectTarget ? primary?.isSuccess === true : null;
    let failure = hasDirectTarget ? primary?.isFailure === true : null;
    if (kind === "attack") {
      if (critical === true && fumble !== true) {
        success = true;
        failure = false;
      } else if (fumble === true) {
        success = false;
        failure = true;
      } else if (!hasDirectTarget && messageTarget?.supported) {
        failure = total === null ? null : (total < messageTarget.ac);
        success = failure === null ? null : !failure;
      }
    }

    const snapshot = {
      kind,
      success,
      failure,
      total,
      critical: critical === true,
      fumble: fumble === true,
      target: hasTarget ? target : null,
      roll: {
        kind,
        total,
        sum,
        totals,
        dice,
        count: list.length,
        success,
        failure,
        critical: critical === true,
        fumble: fumble === true,
        target: hasTarget ? target : null,
        formula: String(primary?.formula ?? "").trim(),
        ability: String(extra?.ability ?? "").trim(),
        skill: String(extra?.skill ?? "").trim(),
        tool: String(extra?.tool ?? "").trim()
      }
    };

    if (kind === "attack") {
      snapshot.attack = {
        hit: success,
        miss: failure,
        total,
        critical: critical === true,
        fumble: fumble === true,
        target: hasTarget ? target : null
      };
    }

    return snapshot;
  }

  /**
   * Converts a result snapshot into formula-safe roll data: booleans become
   * 1/0 and nulls become 0 so `@scLast.*` references always resolve. A bare
   * `@scLast` resolves to the main roll value instead of a serialized object.
   */
  static lastResultFormulaData(lastResult) {
    return ScActivityResultTracker.#withFormulaDefault(
      ScActivityResultTracker.#formulaSafe(lastResult),
      lastResult
    );
  }

  static #withFormulaDefault(data, original) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return data;
    }
    const preferred = [original?.roll?.sum, original?.roll?.total, original?.total]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value)) ?? 0;
    Object.defineProperty(data, "toString", {
      value: () => String(preferred),
      enumerable: false
    });
    return data;
  }

  static #formulaSafe(value) {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => ScActivityResultTracker.#formulaSafe(entry));
    }
    if (typeof value === "object") {
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        result[key] = ScActivityResultTracker.#formulaSafe(entry);
      }
      return result;
    }
    return value;
  }

  /** Exposes the previous chain result to tracked attack/damage/heal rolls as `@scLast`. */
  static #injectLastResultRollData(rollConfig) {
    const rolls = Array.isArray(rollConfig?.rolls) ? rollConfig.rolls : [];
    if (!rolls.length) {
      return;
    }
    const record = ScActivityResultTracker.#pendingRecordFor(rollConfig?.subject);
    if (!record || record.lastResult === undefined || record.lastResult === null) {
      return;
    }
    for (const roll of rolls) {
      if (!roll || typeof roll !== "object") {
        continue;
      }
      roll.data = {
        ...(roll.data ?? {}),
        scLast: ScActivityResultTracker.lastResultFormulaData(record.lastResult)
      };
    }
  }

  static #pendingRecordFor(activity) {
    if (!activity) {
      return null;
    }
    const trackerKey = ScActivityResultTracker.#trackerKey(activity);
    let match = null;
    for (const record of ScActivityResultTracker.#records.values()) {
      if (!record.finalized && record.trackerKey === trackerKey && record.lastResult !== undefined) {
        match = record;
      }
    }
    return match;
  }

  /** Aggregates kept (non-discarded) die results across every roll. */
  static #diceSnapshot(rolls) {
    const values = [];
    for (const roll of rolls) {
      for (const die of roll?.dice ?? []) {
        for (const result of die?.results ?? []) {
          if (result?.active === false || result?.discarded === true) {
            continue;
          }
          const value = Number(result?.result);
          if (Number.isFinite(value)) {
            values.push(value);
          }
        }
      }
    }
    return {
      count: values.length,
      values,
      total: values.length ? values.reduce((left, right) => left + right, 0) : null,
      max: values.length ? Math.max(...values) : null,
      min: values.length ? Math.min(...values) : null
    };
  }

  static #onPreUseActivity(activity, usageConfig) {
    const meta = ScActivityResultTracker.#trackingMeta(usageConfig);
    if (!meta) {
      return;
    }
    const record = ScActivityResultTracker.#ensureRecord(meta, activity);
    const lastResult = ScActivityResultTracker.getLastResult(usageConfig);
    if (lastResult !== undefined) {
      record.lastResult = lastResult;
    }
    ScActivityResultTracker.#wrapAutoResultMethod(activity, record);
  }

  static #onPostUseActivity(activity, usageConfig, results) {
    const meta = ScActivityResultTracker.#trackingMeta(usageConfig);
    if (!meta) {
      return;
    }
    const record = ScActivityResultTracker.#ensureRecord(meta, activity);
    ScActivityResultTracker.#mergeRecord(record, ScActivityResultTracker.#snapshotFromUse(activity, results));
    record.useComplete = true;
    if (!record.awaitsAsyncResult) {
      ScActivityResultTracker.#finalize(record);
    }
  }

  static #wrapAutoResultMethod(activity, record) {
    if (record.instrumented) {
      return;
    }
    const methodName = ScActivityResultTracker.#autoResultMethod(activity?.type);
    if (!methodName || typeof activity?.[methodName] !== "function") {
      return;
    }

    const original = activity[methodName];
    record.awaitsAsyncResult = true;
    record.instrumented = true;

    activity[methodName] = async(...args) => {
      try {
        const rolls = await original.apply(activity, args);
        record.awaitsAsyncResult = false;
        if (rolls) {
          const kind = ScActivityResultTracker.#rollKind(activity, methodName);
          ScActivityResultTracker.#finalize(
            record,
            ScActivityResultTracker.buildRollSnapshot(kind, rolls, ScActivityResultTracker.#rollExtra(args[0]))
          );
        } else {
          ScActivityResultTracker.#finalize(record, {
            kind: ScActivityResultTracker.#rollKind(activity, methodName),
            canceled: true,
            activity: { canceled: true, reason: "roll-canceled" }
          });
        }
        return rolls;
      } catch (error) {
        record.awaitsAsyncResult = false;
        ScActivityResultTracker.#finalize(record, {
          kind: ScActivityResultTracker.#rollKind(activity, methodName),
          error: error?.message ?? String(error),
          activity: { error: error?.message ?? String(error) }
        });
        throw error;
      }
    };
  }

  static #autoResultMethod(type) {
    switch (String(type ?? "").trim()) {
      case "attack":
        return "rollAttack";
      case "damage":
      case "heal":
      case "save":
        return "rollDamage";
      default:
        return "";
    }
  }

  static #rollKind(activity, methodName) {
    if (methodName === "rollAttack") {
      return "attack";
    }
    if (activity?.type === "heal") {
      return "healing";
    }
    return "damage";
  }

  static #rollExtra(config = {}) {
    return {
      target: config?.target,
      ability: config?.ability,
      skill: config?.skill,
      tool: config?.tool
    };
  }

  static #trackingMeta(usageLike) {
    if (!usageLike || typeof usageLike !== "object") {
      return null;
    }
    const meta = usageLike[TRACKING_KEY];
    return (meta && typeof meta === "object") ? meta : null;
  }

  static #ensureRecord(meta, activity = null) {
    const executionId = String(meta?.executionId ?? "").trim();
    if (!executionId) {
      const fallback = ScActivityResultTracker.#createRecord(meta, activity);
      ScActivityResultTracker.#records.set(fallback.executionId, fallback);
      return fallback;
    }

    let record = ScActivityResultTracker.#records.get(executionId);
    if (!record) {
      record = ScActivityResultTracker.#createRecord(meta, activity);
      ScActivityResultTracker.#records.set(executionId, record);
    } else if (activity) {
      ScActivityResultTracker.#mergeRecord(record, ScActivityResultTracker.#baseSnapshot(activity));
    }
    return record;
  }

  static #createRecord(meta, activity) {
    const executionId = String(meta?.executionId ?? ScActivityResultTracker.#randomId()).trim();
    let resolve;
    const promise = new Promise((recordResolve) => {
      resolve = recordResolve;
    });
    return {
      executionId,
      trackerKey: String(meta?.trackerKey ?? "").trim(),
      activityType: String(meta?.activityType ?? "").trim(),
      awaitsAsyncResult: false,
      finalized: false,
      instrumented: false,
      useComplete: false,
      lastResult: undefined,
      resolve,
      promise,
      snapshot: ScActivityResultTracker.#baseSnapshot(activity)
    };
  }

  static #finalize(record, partial = undefined) {
    if (record.finalized) {
      return;
    }
    if (partial !== undefined) {
      ScActivityResultTracker.#mergeRecord(record, partial);
    }
    record.finalized = true;
    record.resolve(ScActivityResultTracker.#clone(record.snapshot));
  }

  static #mergeRecord(record, partial) {
    if (!partial || typeof partial !== "object") {
      return;
    }
    record.snapshot = ScActivityResultTracker.#mergeObjects(record.snapshot ?? {}, partial);
  }

  static #snapshotFromUse(activity, results = {}) {
    return {
      ...ScActivityResultTracker.#baseSnapshot(activity),
      use: {
        messageId: String(results?.message?.id ?? "").trim(),
        updateCount: Array.isArray(results?.updates) ? results.updates.length : 0,
        effectCount: Array.isArray(results?.effects) ? results.effects.length : 0,
        templateCount: Array.isArray(results?.templates) ? results.templates.length : 0
      }
    };
  }

  static #baseSnapshot(activity) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    return {
      sourceActivity: {
        id: String(activity?.id ?? activity?._id ?? "").trim(),
        type: String(activity?.type ?? "").trim(),
        name: String(activity?.name ?? "").trim(),
        itemId: String(activity?.item?.id ?? activity?.item?._id ?? "").trim(),
        itemUuid: String(activity?.item?.uuid ?? "").trim(),
        actorUuid: String(actor?.uuid ?? "").trim()
      },
      canceled: false
    };
  }

  static #trackerKey(activity) {
    const actorUuid = String(activity?.actor?.uuid ?? activity?.item?.actor?.uuid ?? "").trim();
    const itemKey = String(activity?.item?.uuid ?? activity?.item?.id ?? activity?.item?._id ?? "").trim();
    const activityId = String(activity?.id ?? activity?._id ?? "").trim();
    const type = String(activity?.type ?? "").trim();
    return [actorUuid || "Actor", itemKey || "Item", activityId || "Activity", type || "type"].join("|");
  }

  static #rollTarget(roll, extra = {}, messageTarget = null) {
    const direct = ScActivityResultTracker.#directRollTarget(roll, extra);
    if (Number.isFinite(direct)) {
      return direct;
    }
    if (messageTarget?.supported) {
      const messageValue = Number(messageTarget.ac);
      return Number.isFinite(messageValue) ? messageValue : null;
    }
    return null;
  }

  static #directRollTarget(roll, extra = {}) {
    const candidate = extra?.target ?? roll?.options?.target;
    const target = Number(candidate);
    return Number.isFinite(target) ? target : null;
  }

  static #attackMessageTarget(roll) {
    const message = roll?.parent ?? null;
    const targets = message?.getFlag?.("dnd5e", "targets")
      ?? message?.flags?.dnd5e?.targets
      ?? [];
    if (!Array.isArray(targets) || targets.length !== 1) {
      return { supported: false, ac: null };
    }
    return {
      supported: true,
      ac: targets[0]?.ac ?? null
    };
  }

  static #asBoolean(value) {
    return typeof value === "boolean" ? value : null;
  }

  static #randomId() {
    const randomID = globalThis.foundry?.utils?.randomID;
    if (typeof randomID === "function") {
      return randomID(16);
    }
    return Math.random().toString(36).slice(2, 18);
  }

  static #clone(value) {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => ScActivityResultTracker.#clone(entry));
    }
    if (typeof value === "object") {
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        result[key] = ScActivityResultTracker.#clone(entry);
      }
      return result;
    }
    return value;
  }

  static #mergeObjects(base, partial) {
    const result = ScActivityResultTracker.#clone(base);
    for (const [key, value] of Object.entries(partial ?? {})) {
      if (value === undefined) {
        continue;
      }
      if (ScActivityResultTracker.#isPlainObject(result[key]) && ScActivityResultTracker.#isPlainObject(value)) {
        result[key] = ScActivityResultTracker.#mergeObjects(result[key], value);
      } else {
        result[key] = ScActivityResultTracker.#clone(value);
      }
    }
    return result;
  }

  static #isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
