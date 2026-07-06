import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScChainExecutionContext } from "./ScChainExecutionContext.js";

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

    const chainContext = ScChainExecutionContext.fromUsage(usageContext.usage, activity, activity?.chain?.maxDepth);
    if (ScChainExecutionContext.isDepthExceeded(chainContext)) {
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

      const targetUuid = ScChainExecutionContext.activityKey(target);
      if (ScChainExecutionContext.hasVisited(chainContext, targetUuid)) {
        ScChainActivityService.#notifyLoop("SCMOREACTIVITIES.Activities.ScChain.Warning.LoopDetected", "Chain loop detected.");
        return;
      }

      let childResults;
      try {
        childResults = await target.use(
          ScChainExecutionContext.childUsage(usageContext.usage, chainContext, targetUuid),
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

  static #handleMissingTarget(activity, targetId) {
    ui.notifications?.warn?.(Constants.format(
      "SCMOREACTIVITIES.Activities.ScChain.Warning.MissingTarget",
      { activity: targetId },
      `Chained activity not found: ${targetId}`
    ));
    return activity?.chain?.continueOnFailure === true;
  }

  static #notifyLoop(key, fallback) {
    ui.notifications?.warn?.(Constants.localize(key, fallback));
  }
}
