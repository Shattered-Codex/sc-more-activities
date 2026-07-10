import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScActivityResultTracker } from "../ScActivityResultTracker.js";
import { ScChainExecutionContext } from "../chain/ScChainExecutionContext.js";
import { ScConditionalChainConditions } from "./ScConditionalChainConditions.js";
import {
  FLOW_CONDITION_TYPES,
  FLOW_END,
  FLOW_ROLL_TYPES,
  ScConditionalChainFlow
} from "./ScConditionalChainFlow.js";

const LANG = "SCMOREACTIVITIES.Activities.ScConditionalChain";
const MAX_REPORTED_ISSUES = 3;

/**
 * Executes a conditional flow between activities of the same item.
 *
 * Explicit policies:
 * - Invalid configuration blocks execution entirely (no partial runs).
 * - Canceling a roll or a manual choice always ends the flow.
 * - `stopOnCancel` controls only canceled child activities (usage dialog closed).
 * - `continueOnChildError` controls missing/throwing child activities.
 * - Each node runs at most once per flow execution (strict loop protection).
 * - Depth/path protection is shared with sc-chain via ScChainExecutionContext.
 */
export class ScConditionalChainActivityService {
  static async execute(activity, usageContext = {}) {
    const flow = ScConditionalChainFlow.normalizeFlow(activity?.flow);
    const issues = ScConditionalChainFlow.validateFlow(
      flow,
      ScConditionalChainActivityService.#availableActivityIds(activity)
    );
    if (issues.length) {
      ScConditionalChainActivityService.#reportIssues(issues);
      return;
    }

    const chainContext = ScChainExecutionContext.fromUsage(usageContext.usage, activity, flow.maxDepth);
    if (ScChainExecutionContext.isDepthExceeded(chainContext)) {
      ScConditionalChainActivityService.#warn("Warning.MaxDepth", "Conditional chain depth limit reached.");
      return;
    }

    const nodeMap = ScConditionalChainFlow.buildNodeMap(flow.nodes);
    const visited = new Set();
    let currentId = flow.startNode;
    let lastResult = ScActivityResultTracker.getLastResult(usageContext.usage);

    while (currentId && currentId !== FLOW_END) {
      const node = nodeMap.get(currentId);
      if (!node) {
        ScConditionalChainActivityService.#warnFormat("Warning.InvalidRoute", { node: currentId },
          `Conditional chain route points to a missing step: ${currentId}`);
        return;
      }
      if (visited.has(currentId)) {
        ScConditionalChainActivityService.#warn("Warning.LoopDetected", "Conditional chain loop detected.");
        return;
      }
      visited.add(currentId);

      if (node.activityId) {
        const childExecution = await ScConditionalChainActivityService.#runChildActivity(
          activity, node, flow, chainContext, usageContext, lastResult
        );
        if (!childExecution.proceed) {
          return;
        }
        if (childExecution.lastResult !== undefined) {
          lastResult = childExecution.lastResult;
        }
      }

      const outcome = await ScConditionalChainActivityService.#resolveOutcome(activity, node, lastResult);
      if (outcome.canceled || !outcome.valid) {
        return;
      }

      const next = ScConditionalChainFlow.resolveNextNode(node, outcome);
      if (!next) {
        ScConditionalChainActivityService.#warnFormat("Warning.MissingRoute", { node: node.label || node.nodeId },
          `Conditional chain step has no configured route: ${node.label || node.nodeId}`);
        return;
      }
      currentId = next;
    }
  }

  static #availableActivityIds(activity) {
    const activities = activity?.item?.system?.activities;
    const values = typeof activities?.values === "function" ? activities.values() : activities;
    return Array.from(values ?? [])
      .filter((entry) => entry?.id && entry.id !== activity?.id)
      .map((entry) => entry.id);
  }

  static describeIssue(issue) {
    const key = ScConditionalChainActivityService.#issueKey(issue.code);
    return Constants.format(`${LANG}.Issues.${key}`, {
      node: issue.nodeId ?? "",
      route: issue.route ?? "",
      ref: issue.ref ?? ""
    }, `${issue.code}${issue.nodeId ? ` [${issue.nodeId}]` : ""}${issue.ref ? ` (${issue.ref})` : ""}`);
  }

  static #reportIssues(issues) {
    const messages = issues.map((issue) => ScConditionalChainActivityService.describeIssue(issue));
    Logger.warn("Conditional chain configuration is invalid.", messages);
    const shown = messages.slice(0, MAX_REPORTED_ISSUES).join(" ");
    const suffix = messages.length > MAX_REPORTED_ISSUES
      ? ` (+${messages.length - MAX_REPORTED_ISSUES})`
      : "";
    ui.notifications?.warn?.(Constants.format(
      `${LANG}.Warning.InvalidConfiguration`,
      { issues: `${shown}${suffix}` },
      `Conditional chain configuration is invalid: ${shown}${suffix}`
    ));
  }

  static #issueKey(code) {
    return String(code ?? "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }

  /** Returns the child execution outcome and the latest result context when available. */
  static async #runChildActivity(activity, node, flow, chainContext, usageContext, lastResult) {
    const target = activity?.item?.system?.activities?.get?.(node.activityId) ?? null;
    if (!target) {
      ScConditionalChainActivityService.#warnFormat("Warning.MissingChild", { activity: node.activityId },
        `Conditional chain activity not found: ${node.activityId}`);
      return {
        proceed: flow.continueOnChildError,
        lastResult: undefined
      };
    }

    const targetKey = ScChainExecutionContext.activityKey(target);
    if (ScChainExecutionContext.hasVisited(chainContext, targetKey)) {
      ScConditionalChainActivityService.#warn("Warning.LoopDetected", "Conditional chain loop detected.");
      return {
        proceed: false,
        lastResult: undefined
      };
    }

    let childResults;
    const childUsage = ScActivityResultTracker.withTrackedUsage(
      ScChainExecutionContext.childUsage(usageContext.usage, chainContext, targetKey),
      target,
      lastResult
    );
    try {
      const childMessage = flow.suppressChildMessages
        ? { ...(usageContext.message ?? {}), create: false }
        : (usageContext.message ?? {});
      childResults = await target.use(
        childUsage,
        usageContext.dialog ?? {},
        childMessage
      );
    } catch (error) {
      ScActivityResultTracker.cancelUsage(childUsage, "child-error");
      Logger.error("Could not execute conditional chain child activity.", error);
      ui.notifications?.error?.(Constants.format(
        `${LANG}.Error.ChildFailed`,
        { activity: target.name ?? target.id, error: error?.message ?? String(error) },
        `Could not execute ${target.name ?? target.id}: ${error?.message ?? String(error)}`
      ));
      return {
        proceed: flow.continueOnChildError,
        lastResult: undefined
      };
    }

    if (childResults === undefined && flow.stopOnCancel) {
      ScActivityResultTracker.cancelUsage(childUsage, "child-canceled");
      ScConditionalChainActivityService.#warn("Warning.ChildCanceled", "A conditional chain activity was canceled.");
      return {
        proceed: false,
        lastResult: undefined
      };
    }

    if (childResults === undefined) {
      ScActivityResultTracker.cancelUsage(childUsage, "child-canceled");
      return {
        proceed: true,
        lastResult: undefined
      };
    }

    return {
      proceed: true,
      lastResult: await ScActivityResultTracker.resolveUsageResult(target, childUsage, childResults)
    };
  }

  static async #resolveOutcome(activity, node, lastResult) {
    switch (node.conditionType) {
      case FLOW_CONDITION_TYPES.ALWAYS:
        return { valid: true, kind: "always" };
      case FLOW_CONDITION_TYPES.ACTOR_PROPERTY:
        return ScConditionalChainActivityService.#resolveActorProperty(activity, node, lastResult);
      case FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT:
        return ScConditionalChainActivityService.#resolveLastActivityResult(activity, node, lastResult);
      case FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE:
        return ScConditionalChainActivityService.#resolveLastActivityValue(activity, node, lastResult);
      case FLOW_CONDITION_TYPES.ROLL_CHECK:
        return ScConditionalChainActivityService.#resolveRollCheck(activity, node, lastResult);
      case FLOW_CONDITION_TYPES.CHOICE:
        return ScConditionalChainActivityService.#resolveChoice(node);
      default:
        ScConditionalChainActivityService.#warnFormat("Warning.InvalidCondition", { node: node.label || node.nodeId },
          `Conditional chain step has an invalid condition: ${node.label || node.nodeId}`);
        return { valid: false };
    }
  }

  static #resolveLastActivityResult(activity, node, lastResult) {
    if (!lastResult || typeof lastResult !== "object") {
      ScConditionalChainActivityService.#warnFormat(
        "Warning.MissingLastResult",
        { node: node.label || node.nodeId },
        `No previous activity result is available for step "${node.label || node.nodeId}".`
      );
      return { valid: false };
    }

    const actor = ScConditionalChainActivityService.#resolveActor(activity);
    const evaluation = ScConditionalChainConditions.evaluateProperty(node.condition, lastResult, {
      resolveExpected: (raw) => ScConditionalChainActivityService.#resolveExpectedValue(activity, actor, raw, lastResult)
    });
    if (!evaluation.valid) {
      ScConditionalChainActivityService.#warnFormat(
        "Warning.InvalidLastActivityResult",
        { node: node.label || node.nodeId, path: node.condition.path, reason: evaluation.reason ?? "" },
        `Could not evaluate last activity result "${node.condition.path}" (${evaluation.reason ?? "invalid"}).`
      );
      return { valid: false };
    }
    return { valid: true, kind: "boolean", value: evaluation.result };
  }

  static #resolveLastActivityValue(activity, node, lastResult) {
    if (!lastResult || typeof lastResult !== "object") {
      ScConditionalChainActivityService.#warnFormat(
        "Warning.MissingLastResult",
        { node: node.label || node.nodeId },
        `No previous activity result is available for step "${node.label || node.nodeId}".`
      );
      return { valid: false };
    }

    const actor = ScConditionalChainActivityService.#resolveActor(activity);
    for (const branch of node.valueBranches) {
      const evaluation = ScConditionalChainConditions.evaluateProperty({
        path: node.condition.path,
        operator: branch.operator,
        value: branch.value
      }, lastResult, {
        resolveExpected: (raw) => ScConditionalChainActivityService.#resolveExpectedValue(activity, actor, raw, lastResult)
      });
      if (!evaluation.valid) {
        ScConditionalChainActivityService.#warnFormat(
          "Warning.InvalidLastActivityResult",
          { node: node.label || node.nodeId, path: node.condition.path, reason: evaluation.reason ?? "" },
          `Could not evaluate last activity result "${node.condition.path}" (${evaluation.reason ?? "invalid"}).`
        );
        return { valid: false };
      }
      if (evaluation.result) {
        return { valid: true, kind: "value-branch", key: branch.key };
      }
    }
    return { valid: true, kind: "value-fallback" };
  }

  static #resolveActorProperty(activity, node, lastResult) {
    const actor = ScConditionalChainActivityService.#resolveActor(activity);
    if (!actor) {
      ScConditionalChainActivityService.#warn("Warning.MissingActor", "This conditional chain needs an actor.");
      return { valid: false };
    }

    const evaluation = ScConditionalChainConditions.evaluateActorProperty(node.condition, actor, {
      resolveExpected: (raw) => ScConditionalChainActivityService.#resolveExpectedValue(activity, actor, raw, lastResult)
    });
    if (!evaluation.valid) {
      ScConditionalChainActivityService.#warnFormat(
        "Warning.InvalidActorProperty",
        { node: node.label || node.nodeId, path: node.condition.path, reason: evaluation.reason ?? "" },
        `Could not evaluate actor property "${node.condition.path}" (${evaluation.reason ?? "invalid"}).`
      );
      return { valid: false };
    }
    return { valid: true, kind: "boolean", value: evaluation.result };
  }

  static #resolveExpectedValue(activity, actor, raw, lastResult) {
    if (!raw) {
      return raw;
    }
    if (/^(true|false)$/i.test(raw)) {
      return String(raw).trim().toLowerCase() === "true";
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      return Number(raw);
    }
    const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
    if (typeof simplify === "function") {
      const rollData = ScConditionalChainActivityService.#withLastResultRollData(
        activity?.getRollData?.({ deterministic: true })
          ?? actor?.getRollData?.({ deterministic: true })
          ?? {},
        lastResult
      );
      try {
        const value = simplify(raw, rollData);
        if (Number.isFinite(value)) {
          return value;
        }
      } catch (error) {
        Logger.debug("Could not simplify conditional chain expected value.", error);
      }
    }
    return raw;
  }

  /** Merges the previous chain result into roll data as `@scLast` for formula fields. */
  static #withLastResultRollData(rollData, lastResult) {
    if (!lastResult || typeof lastResult !== "object") {
      return rollData;
    }
    return { ...rollData, scLast: ScActivityResultTracker.lastResultFormulaData(lastResult) };
  }

  static async #resolveRollCheck(activity, node, lastResult) {
    const actor = ScConditionalChainActivityService.#resolveActor(activity);
    if (!actor) {
      ScConditionalChainActivityService.#warn("Warning.MissingActor", "This conditional chain needs an actor.");
      return { valid: false };
    }

    const dc = ScConditionalChainActivityService.#resolveDc(activity, actor, node.condition.dcFormula, lastResult);
    if (!Number.isFinite(dc)) {
      ScConditionalChainActivityService.#warnFormat("Warning.InvalidDc", { node: node.label || node.nodeId },
        `Conditional chain step has an invalid DC formula: ${node.label || node.nodeId}`);
      return { valid: false };
    }

    let rolls;
    try {
      rolls = await ScConditionalChainActivityService.#rollForNode(actor, activity, node.condition, dc, lastResult);
    } catch (error) {
      Logger.error("Could not roll conditional chain check.", error);
      ScConditionalChainActivityService.#warnFormat(
        "Warning.InvalidRoll",
        { node: node.label || node.nodeId, error: error?.message ?? String(error) },
        `Conditional chain roll failed: ${error?.message ?? String(error)}`
      );
      return { valid: false };
    }

    const roll = ScConditionalChainActivityService.#extractRoll(rolls);
    if (!roll) {
      ScConditionalChainActivityService.#warn("Warning.RollCanceled", "Conditional chain roll canceled.");
      return { canceled: true };
    }

    const total = Number(roll.total);
    if (!Number.isFinite(total)) {
      ScConditionalChainActivityService.#warnFormat("Warning.InvalidRoll",
        { node: node.label || node.nodeId, error: "invalid total" },
        "Conditional chain roll did not produce a valid total.");
      return { valid: false };
    }

    return { valid: true, kind: "boolean", value: total >= dc };
  }

  static async #rollForNode(actor, activity, condition, dc, lastResult) {
    if (condition.rollType === FLOW_ROLL_TYPES.SKILL && typeof actor?.rollSkill === "function") {
      return actor.rollSkill({ skill: condition.skill, target: dc }, {}, {});
    }
    if (condition.rollType === FLOW_ROLL_TYPES.SAVING_THROW && typeof actor?.rollSavingThrow === "function") {
      return actor.rollSavingThrow({ ability: condition.ability, target: dc }, {}, {});
    }
    if (condition.rollType === FLOW_ROLL_TYPES.ABILITY_CHECK && typeof actor?.rollAbilityCheck === "function") {
      return actor.rollAbilityCheck({ ability: condition.ability, target: dc }, {}, {});
    }
    if (condition.rollType === FLOW_ROLL_TYPES.CUSTOM) {
      const rollData = ScConditionalChainActivityService.#withLastResultRollData(
        activity?.getRollData?.() ?? actor?.getRollData?.() ?? {},
        lastResult
      );
      const roll = new Roll(condition.formula, rollData);
      await roll.evaluate();
      await roll.toMessage?.({
        speaker: ChatMessage.implementation?.getSpeaker?.({ actor }) ?? ChatMessage.getSpeaker({ actor }),
        flavor: Constants.format(`${LANG}.Chat.CustomRoll`, { dc }, `Conditional chain check (DC ${dc})`)
      });
      return [roll];
    }
    throw new Error(Constants.localize(`${LANG}.Error.RollUnavailable`, "The configured roll is not available for this actor."));
  }

  static #resolveDc(activity, actor, formula, lastResult) {
    const rollData = ScConditionalChainActivityService.#withLastResultRollData(
      activity?.getRollData?.({ deterministic: true })
        ?? actor?.getRollData?.({ deterministic: true })
        ?? {},
      lastResult
    );
    const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
    if (typeof simplify === "function") {
      try {
        const value = simplify(formula, rollData);
        return Number.isFinite(value) ? Math.floor(value) : NaN;
      } catch (error) {
        Logger.debug("Could not simplify conditional chain DC formula.", error);
        return NaN;
      }
    }
    const value = Number(formula);
    return Number.isFinite(value) ? Math.floor(value) : NaN;
  }

  static async #resolveChoice(node) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.wait !== "function") {
      ScConditionalChainActivityService.#warn("Warning.ChoiceUnavailable", "Could not open the choice dialog.");
      return { valid: false };
    }

    const title = node.label || Constants.localize(`${LANG}.Dialog.Choice.Title`, "Choose the next step");
    let selection = null;
    try {
      selection = await DialogV2.wait({
        window: {
          icon: "fa-solid fa-code-branch",
          title
        },
        content: `<p>${ScConditionalChainActivityService.#escape(
          Constants.localize(`${LANG}.Dialog.Choice.Content`, "Choose how the flow continues.")
        )}</p>`,
        buttons: node.choices.map((choice, index) => ({
          action: choice.key,
          label: choice.label || choice.key,
          default: index === 0
        })),
        rejectClose: false
      });
    } catch (error) {
      Logger.warn("Could not render conditional chain choice dialog.", error);
      selection = null;
    }

    if (!selection || typeof selection !== "string") {
      ScConditionalChainActivityService.#warn("Warning.ChoiceCanceled", "Conditional chain choice canceled.");
      return { canceled: true };
    }
    return { valid: true, kind: "choice", key: selection };
  }

  static #resolveActor(activity) {
    return activity?.actor ?? activity?.item?.actor ?? null;
  }

  static #extractRoll(rolls) {
    if (!rolls) {
      return null;
    }
    if (Array.isArray(rolls)) {
      return rolls.find((roll) => Number.isFinite(Number(roll?.total))) ?? null;
    }
    return Number.isFinite(Number(rolls?.total)) ? rolls : null;
  }

  static #warn(key, fallback) {
    ui.notifications?.warn?.(Constants.localize(`${LANG}.${key}`, fallback));
  }

  static #warnFormat(key, data, fallback) {
    ui.notifications?.warn?.(Constants.format(`${LANG}.${key}`, data, fallback));
  }

  static #escape(value) {
    const text = String(value ?? "");
    const foundryUtils = globalThis.foundry?.utils;
    if (typeof foundryUtils?.escapeHTML === "function") {
      return foundryUtils.escapeHTML(text);
    }
    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[char]));
  }
}
