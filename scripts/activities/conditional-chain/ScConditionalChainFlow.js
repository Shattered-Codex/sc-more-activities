import { ScChainExecutionContext } from "../chain/ScChainExecutionContext.js";
import { ScConditionalChainConditions } from "./ScConditionalChainConditions.js";

export const FLOW_END = "#end";

export const FLOW_CONDITION_TYPES = Object.freeze({
  ALWAYS: "always",
  ACTOR_PROPERTY: "actor-property",
  ROLL_CHECK: "roll-check",
  CHOICE: "choice"
});

export const FLOW_ROLL_TYPES = Object.freeze({
  ABILITY_CHECK: "ability-check",
  SAVING_THROW: "saving-throw",
  SKILL: "skill",
  CUSTOM: "custom"
});

export class ScConditionalChainFlow {
  static normalizeFlow(raw) {
    const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
    return {
      startNode: String(raw?.startNode ?? "").trim(),
      maxDepth: ScChainExecutionContext.clampDepth(raw?.maxDepth),
      stopOnCancel: raw?.stopOnCancel !== false,
      continueOnChildError: raw?.continueOnChildError === true,
      nodes: nodes.map((node) => ScConditionalChainFlow.normalizeNode(node))
    };
  }

  static normalizeNode(raw) {
    const conditionType = Object.values(FLOW_CONDITION_TYPES).includes(raw?.conditionType)
      ? raw.conditionType
      : FLOW_CONDITION_TYPES.ALWAYS;
    const rollType = Object.values(FLOW_ROLL_TYPES).includes(raw?.condition?.rollType)
      ? raw.condition.rollType
      : FLOW_ROLL_TYPES.ABILITY_CHECK;
    const choices = Array.isArray(raw?.choices) ? raw.choices : [];
    return {
      nodeId: String(raw?.nodeId ?? "").trim(),
      label: String(raw?.label ?? "").trim(),
      activityId: String(raw?.activityId ?? "").trim(),
      conditionType,
      condition: {
        path: String(raw?.condition?.path ?? "").trim(),
        operator: String(raw?.condition?.operator ?? "eq").trim() || "eq",
        value: String(raw?.condition?.value ?? "").trim(),
        rollType,
        ability: String(raw?.condition?.ability ?? "str").trim() || "str",
        skill: String(raw?.condition?.skill ?? "ath").trim() || "ath",
        formula: String(raw?.condition?.formula ?? "").trim(),
        dcFormula: String(raw?.condition?.dcFormula ?? "").trim()
      },
      routes: {
        next: ScConditionalChainFlow.#normalizeRoute(raw?.routes?.next),
        onTrue: ScConditionalChainFlow.#normalizeRoute(raw?.routes?.onTrue),
        onFalse: ScConditionalChainFlow.#normalizeRoute(raw?.routes?.onFalse)
      },
      choices: choices.map((choice) => ({
        key: String(choice?.key ?? "").trim(),
        label: String(choice?.label ?? "").trim(),
        next: ScConditionalChainFlow.#normalizeRoute(choice?.next)
      }))
    };
  }

  static #normalizeRoute(value) {
    return String(value ?? "").trim();
  }

  static buildNodeMap(nodes = []) {
    const map = new Map();
    for (const node of nodes) {
      if (node.nodeId && !map.has(node.nodeId)) {
        map.set(node.nodeId, node);
      }
    }
    return map;
  }

  /**
   * Static validation of a normalized flow. Returns a list of issues; an empty
   * list means the flow is safe to execute. Each issue carries a stable `code`
   * plus enough data to build a localized message.
   */
  static validateFlow(flow, availableActivityIds = []) {
    const issues = [];
    const nodes = flow?.nodes ?? [];
    if (!nodes.length) {
      issues.push({ code: "no-nodes" });
      return issues;
    }

    const seenIds = new Set();
    for (const node of nodes) {
      if (!node.nodeId) {
        issues.push({ code: "empty-node-id" });
        continue;
      }
      if (seenIds.has(node.nodeId)) {
        issues.push({ code: "duplicate-node-id", nodeId: node.nodeId });
      }
      seenIds.add(node.nodeId);
    }

    if (!flow.startNode) {
      issues.push({ code: "missing-start" });
    } else if (!seenIds.has(flow.startNode)) {
      issues.push({ code: "unknown-start", ref: flow.startNode });
    }

    const activityIds = new Set(availableActivityIds ?? []);
    for (const node of nodes) {
      if (!node.nodeId) {
        continue;
      }
      const nodeName = node.label || node.nodeId;

      if (node.activityId && !activityIds.has(node.activityId)) {
        issues.push({ code: "unknown-activity", nodeId: nodeName, ref: node.activityId });
      }

      for (const route of ScConditionalChainFlow.#relevantRoutes(node)) {
        if (!route.target) {
          issues.push({ code: "missing-route", nodeId: nodeName, route: route.name });
        } else if (route.target === node.nodeId) {
          issues.push({ code: "self-route", nodeId: nodeName, route: route.name });
        } else if (route.target !== FLOW_END && !seenIds.has(route.target)) {
          issues.push({ code: "unknown-route", nodeId: nodeName, route: route.name, ref: route.target });
        }
      }

      issues.push(...ScConditionalChainFlow.#validateCondition(node, nodeName));
    }

    return issues;
  }

  /**
   * Resolves the configured next node id for a node outcome.
   * Outcomes: {kind:"always"} | {kind:"boolean", value} | {kind:"choice", key}.
   * Returns FLOW_END, a node id, or null when no explicit route matches.
   */
  static resolveNextNode(node, outcome) {
    if (!node || !outcome) {
      return null;
    }
    if (outcome.kind === "always") {
      return node.routes?.next || null;
    }
    if (outcome.kind === "boolean") {
      const target = outcome.value === true ? node.routes?.onTrue : node.routes?.onFalse;
      return target || null;
    }
    if (outcome.kind === "choice") {
      const choice = (node.choices ?? []).find((entry) => entry.key === outcome.key);
      return choice?.next || null;
    }
    return null;
  }

  static #relevantRoutes(node) {
    if (node.conditionType === FLOW_CONDITION_TYPES.ALWAYS) {
      return [{ name: "next", target: node.routes.next }];
    }
    if (node.conditionType === FLOW_CONDITION_TYPES.CHOICE) {
      return node.choices.map((choice, index) => ({
        name: `choice:${choice.key || index}`,
        target: choice.next
      }));
    }
    return [
      { name: "onTrue", target: node.routes.onTrue },
      { name: "onFalse", target: node.routes.onFalse }
    ];
  }

  static #validateCondition(node, nodeName) {
    const issues = [];
    const condition = node.condition;

    if (node.conditionType === FLOW_CONDITION_TYPES.ACTOR_PROPERTY) {
      if (!condition.path) {
        issues.push({ code: "missing-path", nodeId: nodeName });
      }
      if (!ScConditionalChainConditions.isOperator(condition.operator)) {
        issues.push({ code: "invalid-operator", nodeId: nodeName, ref: condition.operator });
      }
    }

    if (node.conditionType === FLOW_CONDITION_TYPES.ROLL_CHECK) {
      if (condition.rollType === FLOW_ROLL_TYPES.CUSTOM && !condition.formula) {
        issues.push({ code: "missing-formula", nodeId: nodeName });
      }
      if (!condition.dcFormula) {
        issues.push({ code: "missing-dc", nodeId: nodeName });
      }
    }

    if (node.conditionType === FLOW_CONDITION_TYPES.CHOICE) {
      if (!node.choices.length) {
        issues.push({ code: "missing-choices", nodeId: nodeName });
      }
      const seenKeys = new Set();
      for (const choice of node.choices) {
        if (!choice.key) {
          issues.push({ code: "empty-choice-key", nodeId: nodeName });
          continue;
        }
        if (seenKeys.has(choice.key)) {
          issues.push({ code: "duplicate-choice-key", nodeId: nodeName, ref: choice.key });
        }
        seenKeys.add(choice.key);
      }
    }

    return issues;
  }
}
