const USAGE_KEY = "scMoreActivitiesChain";
const HARD_MAX_DEPTH = 20;
const DEFAULT_MAX_DEPTH = 5;

export class ScChainExecutionContext {
  static USAGE_KEY = USAGE_KEY;
  static HARD_MAX_DEPTH = HARD_MAX_DEPTH;
  static DEFAULT_MAX_DEPTH = DEFAULT_MAX_DEPTH;

  static activityKey(activity) {
    return activity?.uuid ?? `${activity?.item?.uuid ?? "Item"}.Activity.${activity?.id ?? activity?._id ?? "unknown"}`;
  }

  static clampDepth(value) {
    const depth = Number(value);
    if (!Number.isFinite(depth)) {
      return DEFAULT_MAX_DEPTH;
    }
    return Math.min(HARD_MAX_DEPTH, Math.max(1, Math.trunc(depth)));
  }

  static fromUsage(usage, activity, configuredMaxDepth) {
    const source = usage?.[USAGE_KEY] ?? {};
    const currentKey = ScChainExecutionContext.activityKey(activity);
    const maxDepth = ScChainExecutionContext.clampDepth(configuredMaxDepth ?? source.maxDepth);
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

  static isDepthExceeded(context) {
    return Number(context?.depth ?? 0) >= ScChainExecutionContext.clampDepth(context?.maxDepth);
  }

  static hasVisited(context, targetKey) {
    return Array.isArray(context?.path) && context.path.includes(targetKey);
  }

  static childUsage(usage, context, targetKey) {
    return {
      ...(usage ?? {}),
      [USAGE_KEY]: {
        root: context.root,
        depth: context.depth + 1,
        maxDepth: context.maxDepth,
        path: [...context.path, targetKey]
      }
    };
  }
}
