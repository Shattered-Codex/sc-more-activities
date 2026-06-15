import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const HARD_MAX_DEPTH = 20;

export class ScChainActivityService {
  static async execute(activity, usageContext = {}) {
    const targetIds = ScChainActivityService.#parseActivityIds(activity?.chain?.activityIds);
    if (!targetIds.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScChain.Warning.MissingTargets",
        "Add at least one activity id before using this chain."
      ));
      return;
    }

    const chainContext = ScChainActivityService.#buildChainContext(activity, usageContext);
    if (chainContext.depth >= chainContext.maxDepth) {
      ScChainActivityService.#notifyLoop("SCMOREACTIVITIES.Activities.ScChain.Warning.MaxDepth", "Chain depth limit reached.");
      return;
    }

    for (const targetId of targetIds) {
      const target = activity?.item?.system?.activities?.get?.(targetId) ?? null;
      if (!target) {
        const shouldContinue = ScChainActivityService.#handleMissingTarget(activity, targetId);
        if (!shouldContinue) {
          return;
        }
        continue;
      }

      const targetUuid = ScChainActivityService.#activityKey(target);
      if (chainContext.path.includes(targetUuid)) {
        ScChainActivityService.#notifyLoop("SCMOREACTIVITIES.Activities.ScChain.Warning.LoopDetected", "Chain loop detected.");
        return;
      }

      let childResults;
      try {
        childResults = await target.use(
          ScChainActivityService.#buildChildUsage(usageContext.usage, chainContext, targetUuid),
          usageContext.dialog ?? {},
          usageContext.message ?? {}
        );
      } catch (error) {
        Logger.error("Could not execute chained activity.", error);
        ui.notifications?.error?.(Constants.format(
          "SCMOREACTIVITIES.Activities.ScChain.Error.ChildFailed",
          { activity: target.name ?? target.id, error: error?.message ?? String(error) },
          `Could not execute chained activity: ${error?.message ?? String(error)}`
        ));
        if (!activity?.chain?.continueOnFailure) {
          return;
        }
        continue;
      }

      if (childResults === undefined && activity?.chain?.stopOnCancel !== false) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScChain.Warning.ChildCanceled",
          "A chained activity was canceled."
        ));
        return;
      }
    }
  }

  static #parseActivityIds(value) {
    return String(value ?? "")
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  static #buildChainContext(activity, usageContext) {
    const source = usageContext.usage?.scMoreActivitiesChain ?? {};
    const currentKey = ScChainActivityService.#activityKey(activity);
    const maxDepth = ScChainActivityService.#clampDepth(activity?.chain?.maxDepth ?? source.maxDepth);
    const path = Array.isArray(source.path) ? [...source.path] : [];
    if (!path.includes(currentKey)) {
      path.push(currentKey);
    }
    return {
      root: source.root ?? currentKey,
      depth: Number(source.depth ?? 0),
      maxDepth,
      path
    };
  }

  static #buildChildUsage(usage, chainContext, targetUuid) {
    return {
      ...(usage ?? {}),
      scMoreActivitiesChain: {
        root: chainContext.root,
        depth: chainContext.depth + 1,
        maxDepth: chainContext.maxDepth,
        path: [...chainContext.path, targetUuid]
      }
    };
  }

  static #handleMissingTarget(activity, targetId) {
    ui.notifications?.warn?.(Constants.format(
      "SCMOREACTIVITIES.Activities.ScChain.Warning.MissingTarget",
      { activity: targetId },
      `Chained activity not found: ${targetId}`
    ));
    return activity?.chain?.continueOnFailure === true;
  }

  static #activityKey(activity) {
    return activity?.uuid ?? `${activity?.item?.uuid ?? "Item"}.Activity.${activity?.id ?? activity?._id ?? "unknown"}`;
  }

  static #clampDepth(value) {
    const depth = Number(value);
    if (!Number.isFinite(depth)) {
      return 5;
    }
    return Math.min(HARD_MAX_DEPTH, Math.max(1, Math.trunc(depth)));
  }

  static #notifyLoop(key, fallback) {
    ui.notifications?.warn?.(Constants.localize(key, fallback));
  }
}
