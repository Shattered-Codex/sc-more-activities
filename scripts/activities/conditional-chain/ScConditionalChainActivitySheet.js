import { ScActivityResultPathCatalog } from "../ScActivityResultPathCatalog.js";
import { ScConditionalChainActivityService } from "./ScConditionalChainActivityService.js";
import { FLOW_PROPERTY_OPERATORS } from "./ScConditionalChainConditions.js";
import {
  FLOW_CONDITION_TYPES,
  FLOW_END,
  FLOW_ROLL_TYPES,
  ScConditionalChainFlow
} from "./ScConditionalChainFlow.js";

const LANG = "SCMOREACTIVITIES.Activities.ScConditionalChain";
const CUSTOM_PATH_OPTION = "__custom__";

export class ScConditionalChainActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: [
      "dnd5e2", "sheet", "activity-sheet", "sc-more-activities",
      "sc-ma-activity", "sc-ma-activity--conditional-chain"
    ]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-conditional-chain-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  #policiesExpanded = false;

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const flow = ScConditionalChainFlow.normalizeFlow(this.activity?.flow);
    const availableActivities = this.#availableActivities();
    const availableActivityIndex = new Map(availableActivities.map((entry) => [entry.id, entry]));
    const issues = ScConditionalChainFlow.validateFlow(flow, availableActivities.map((entry) => entry.id));

    context.flow = {
      startNode: flow.startNode,
      maxDepth: flow.maxDepth,
      stopOnCancel: flow.stopOnCancel,
      continueOnChildError: flow.continueOnChildError
    };
    context.policiesExpanded = this.#policiesExpanded;
    context.issues = issues.map((issue) => ScConditionalChainActivityService.describeIssue(issue));

    context.startNodeOptions = flow.nodes
      .filter((node) => node.nodeId)
      .map((node) => ({ value: node.nodeId, label: this.#nodeLabel(node) }));

    context.activityOptions = [
      { value: "", label: game.i18n.localize(`${LANG}.Fields.Node.Activity.None`) },
      ...availableActivities.map((entry) => ({
        value: entry.id,
        label: `${entry.name} (${entry.type}) [${entry.id}]`
      }))
    ];
    context.conditionTypeOptions = this.#localizedOptions("ConditionTypes", {
      [FLOW_CONDITION_TYPES.ALWAYS]: "Always",
      [FLOW_CONDITION_TYPES.ACTOR_PROPERTY]: "ActorProperty",
      [FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT]: "LastActivityResult",
      [FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE]: "LastActivityValue",
      [FLOW_CONDITION_TYPES.ROLL_CHECK]: "RollCheck",
      [FLOW_CONDITION_TYPES.CHOICE]: "Choice"
    });
    context.operatorOptions = this.#localizedOptions("Operators", {
      [FLOW_PROPERTY_OPERATORS.EQ]: "Eq",
      [FLOW_PROPERTY_OPERATORS.NE]: "Ne",
      [FLOW_PROPERTY_OPERATORS.GT]: "Gt",
      [FLOW_PROPERTY_OPERATORS.GTE]: "Gte",
      [FLOW_PROPERTY_OPERATORS.LT]: "Lt",
      [FLOW_PROPERTY_OPERATORS.LTE]: "Lte",
      [FLOW_PROPERTY_OPERATORS.BETWEEN]: "Between",
      [FLOW_PROPERTY_OPERATORS.INCLUDES]: "Includes"
    });
    context.rollTypeOptions = this.#localizedOptions("RollTypes", {
      [FLOW_ROLL_TYPES.ABILITY_CHECK]: "AbilityCheck",
      [FLOW_ROLL_TYPES.SAVING_THROW]: "SavingThrow",
      [FLOW_ROLL_TYPES.SKILL]: "Skill",
      [FLOW_ROLL_TYPES.CUSTOM]: "Custom"
    });
    context.abilityOptions = Object.entries(CONFIG.DND5E?.abilities ?? {}).map(([value, config]) => ({
      value,
      label: game.i18n.localize(config?.label ?? value)
    }));
    context.skillOptions = Object.entries(CONFIG.DND5E?.skills ?? {}).map(([value, config]) => ({
      value,
      label: game.i18n.localize(config?.label ?? value)
    }));

    const knownActivityIds = new Set(availableActivities.map((entry) => entry.id));
    const endOption = { value: FLOW_END, label: game.i18n.localize(`${LANG}.Fields.Node.Routes.End`) };
    context.nodes = flow.nodes.map((node, index) => {
      const usesPathCondition = [
        FLOW_CONDITION_TYPES.ACTOR_PROPERTY,
        FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT,
        FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE
      ].includes(node.conditionType);
      const usesBinaryPathCondition = [
        FLOW_CONDITION_TYPES.ACTOR_PROPERTY,
        FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT
      ].includes(node.conditionType);
      const isLastActivityValue = node.conditionType === FLOW_CONDITION_TYPES.LAST_ACTIVITY_VALUE;
      const isLastActivityResult = node.conditionType === FLOW_CONDITION_TYPES.LAST_ACTIVITY_RESULT
        || isLastActivityValue;
      const suggestionActivity = availableActivityIndex.get(node.activityId) ?? null;
      const conditionPath = String(node.condition.path ?? "").trim();
      const pathSuggestionGroups = isLastActivityResult
        ? this.#lastResultPathGroups(suggestionActivity, conditionPath)
        : [];
      const pathIsCustom = isLastActivityResult
        && Boolean(conditionPath)
        && !pathSuggestionGroups.some((group) => group.paths.some((entry) => entry.selected));
      const routeOptions = [
        endOption,
        ...flow.nodes
          .filter((other) => other.nodeId && other.nodeId !== node.nodeId)
          .map((other) => ({ value: other.nodeId, label: this.#nodeLabel(other) }))
      ];
      return {
        ...node,
        index,
        number: index + 1,
        isStart: node.nodeId === flow.startNode,
        isAlways: node.conditionType === FLOW_CONDITION_TYPES.ALWAYS,
        isActorProperty: node.conditionType === FLOW_CONDITION_TYPES.ACTOR_PROPERTY,
        isLastActivityResult,
        isLastActivityValue,
        isRollCheck: node.conditionType === FLOW_CONDITION_TYPES.ROLL_CHECK,
        isChoice: node.conditionType === FLOW_CONDITION_TYPES.CHOICE,
        usesPathCondition,
        usesBinaryPathCondition,
        needsAbility: [FLOW_ROLL_TYPES.ABILITY_CHECK, FLOW_ROLL_TYPES.SAVING_THROW].includes(node.condition.rollType),
        needsSkill: node.condition.rollType === FLOW_ROLL_TYPES.SKILL,
        needsFormula: node.condition.rollType === FLOW_ROLL_TYPES.CUSTOM,
        activityMissing: Boolean(node.activityId) && !knownActivityIds.has(node.activityId),
        pathFieldLabel: game.i18n.localize(`${LANG}.Fields.Node.${isLastActivityResult ? "LastActivityResult" : "Path"}.Label`),
        pathFieldHint: game.i18n.localize(`${LANG}.Fields.Node.${isLastActivityResult ? "LastActivityResult" : "Path"}.Hint`),
        pathFieldPlaceholder: isLastActivityResult ? "roll.total" : "system.attributes.hp.value",
        pathSuggestionGroups,
        pathIsCustom,
        pathSelectedHint: isLastActivityResult
          ? this.#lastResultSelectedHint(suggestionActivity, conditionPath)
          : "",
        pathSelectedTooltip: isLastActivityResult && !pathIsCustom
          ? this.#resultPathDescription(conditionPath)
          : "",
        routeOptions,
        choices: node.choices.map((choice, choiceIndex) => ({ ...choice, choiceIndex })),
        valueBranches: node.valueBranches.map((branch, branchIndex) => ({ ...branch, branchIndex }))
      };
    });

    return context;
  }

  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    const rawNodes = foundry.utils.getProperty(submitData, "flow.nodes");
    foundry.utils.setProperty(submitData, "flow.nodes", this.#nodesFromSubmit(rawNodes));
    return submitData;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element.querySelector("[data-action='sc-add-node']")?.addEventListener("click", async(event) => {
      event.preventDefault();
      const nodes = this.#cloneNodes();
      nodes.push(this.#blankNode());
      const update = { "flow.nodes": nodes };
      if (!this.activity?.flow?.startNode) {
        update["flow.startNode"] = nodes[0].nodeId;
      }
      await this.activity.update(update);
      this.render();
    });

    this.element.querySelectorAll("[data-action='sc-remove-node']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        if (!Number.isInteger(index)) {
          return;
        }
        const nodes = this.#cloneNodes();
        nodes.splice(index, 1);
        await this.activity.update({ "flow.nodes": nodes });
        this.render();
      });
    });

    this.element.querySelectorAll("[data-action='sc-add-choice']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        const nodes = this.#cloneNodes();
        if (!nodes[index]) {
          return;
        }
        nodes[index].choices.push({ key: foundry.utils.randomID(8), label: "", next: FLOW_END });
        await this.activity.update({ "flow.nodes": nodes });
        this.render();
      });
    });

    this.element.querySelectorAll("[data-action='sc-remove-choice']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        const choiceIndex = Number(event.currentTarget.dataset.choiceIndex);
        const nodes = this.#cloneNodes();
        if (!nodes[index] || !Number.isInteger(choiceIndex)) {
          return;
        }
        nodes[index].choices.splice(choiceIndex, 1);
        await this.activity.update({ "flow.nodes": nodes });
        this.render();
      });
    });

    this.element.querySelectorAll("[data-action='sc-add-value-branch']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        const nodes = this.#cloneNodes();
        if (!nodes[index]) {
          return;
        }
        nodes[index].valueBranches.push({
          key: foundry.utils.randomID(8), operator: "eq", value: "", next: FLOW_END
        });
        await this.activity.update({ "flow.nodes": nodes });
        this.render();
      });
    });

    this.element.querySelectorAll("[data-action='sc-remove-value-branch']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        const branchIndex = Number(event.currentTarget.dataset.branchIndex);
        const nodes = this.#cloneNodes();
        if (!nodes[index] || !Number.isInteger(branchIndex)) {
          return;
        }
        nodes[index].valueBranches.splice(branchIndex, 1);
        await this.activity.update({ "flow.nodes": nodes });
        this.render();
      });
    });

    const activityIndex = new Map(this.#availableActivities().map((entry) => [entry.id, entry]));
    this.element.querySelectorAll("[data-last-result-node]").forEach((element) => {
      this.#refreshLastResultSuggestionUi(element, activityIndex);
    });

    this.element.querySelectorAll("[data-node-activity-select]").forEach((select) => {
      select.addEventListener("change", (event) => {
        const nodeElement = event.currentTarget.closest("[data-last-result-node]");
        if (!nodeElement) {
          return;
        }
        this.#refreshLastResultSuggestionUi(nodeElement, activityIndex);
      });
    });

    this.element.querySelectorAll("[data-last-result-path-select]").forEach((select) => {
      select.addEventListener("change", (event) => {
        const nodeElement = event.currentTarget.closest("[data-last-result-node]");
        if (!nodeElement) {
          return;
        }
        this.#onLastResultPathSelected(nodeElement, event, activityIndex);
      });
    });

    this.element.querySelector("[data-action='sc-toggle-policies']")?.addEventListener("click", (event) => {
      event.preventDefault();
      const tray = this.element.querySelector("[data-flow-policies]");
      if (!tray) {
        return;
      }
      tray.classList.toggle("collapsed");
      this.#policiesExpanded = !tray.classList.contains("collapsed");
    });
  }

  #availableActivities() {
    const activities = this.activity?.item?.system?.activities;
    const values = typeof activities?.values === "function" ? activities.values() : activities;
    return Array.from(values ?? [])
      .filter((activity) => activity.id !== this.activity?.id)
      .map((activity) => ({
        id: activity.id,
        name: activity.name,
        type: activity.type
      }))
      .sort((left, right) => left.name.localeCompare(right.name, game?.i18n?.lang ?? undefined));
  }

  #nodeLabel(node) {
    return node.label || `${game.i18n.localize(`${LANG}.Fields.Node.Untitled`)} [${node.nodeId}]`;
  }

  #localizedOptions(section, entries) {
    return Object.entries(entries).map(([value, key]) => ({
      value,
      label: game.i18n.localize(`${LANG}.${section}.${key}`)
    }));
  }

  #lastResultPathGroups(activity = null, selectedPath = "") {
    return ScActivityResultPathCatalog.groupsForActivity(activity).map((group) => ({
      id: group.id,
      label: this.#localizeOr(`${LANG}.ResultPathGroups.${group.id}`, group.id),
      paths: group.paths.map((path) => ({
        value: path,
        label: this.#resultPathLabel(path),
        selected: path === selectedPath
      }))
    }));
  }

  #resultPathLabel(path) {
    return this.#localizeOr(`${LANG}.ResultPaths.${path}.Label`, path);
  }

  #resultPathDescription(path) {
    if (!path) {
      return "";
    }
    return this.#localizeOr(`${LANG}.ResultPaths.${path}.Description`, "");
  }

  #localizeOr(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
  }

  #lastResultPathSuggestionHint(activity = null) {
    if (!activity) {
      return game.i18n.localize(`${LANG}.Fields.Node.LastActivityResult.Suggestions.HintNoActivity`);
    }
    return game.i18n.format(`${LANG}.Fields.Node.LastActivityResult.Suggestions.HintActivity`, {
      activity: activity.name || activity.id,
      type: activity.type || ""
    });
  }

  #lastResultSelectedHint(activity, path) {
    const trimmed = String(path ?? "").trim();
    if (!trimmed) {
      return this.#lastResultPathSuggestionHint(activity);
    }
    if (!this.#knownResultPaths(activity).has(trimmed)) {
      return game.i18n.localize(`${LANG}.Fields.Node.LastActivityResult.CustomHint`);
    }
    const description = this.#resultPathDescription(trimmed);
    return description ? `${trimmed} — ${description}` : trimmed;
  }

  #knownResultPaths(activity = null) {
    return new Set(ScActivityResultPathCatalog.suggestionsForActivity(activity).map((entry) => entry.path));
  }

  #onLastResultPathSelected(nodeElement, event, activityIndex) {
    const select = event.currentTarget;
    const pathInput = nodeElement.querySelector("[data-last-result-path-input]");
    const customRow = nodeElement.querySelector("[data-last-result-custom-path]");
    if (!pathInput) {
      return;
    }

    const value = String(select.value ?? "");
    if (value === CUSTOM_PATH_OPTION) {
      // Keep the sheet from submitting while the user is still typing the path.
      event.stopPropagation();
      customRow?.removeAttribute("hidden");
      pathInput.focus();
      this.#refreshLastResultDescription(nodeElement, activityIndex);
      return;
    }

    customRow?.setAttribute("hidden", "");
    pathInput.value = value;
    pathInput.dispatchEvent(new Event("input", { bubbles: true }));
    this.#refreshLastResultDescription(nodeElement, activityIndex);
  }

  #refreshLastResultSuggestionUi(nodeElement, activityIndex) {
    const activitySelect = nodeElement?.querySelector("[data-node-activity-select]");
    const suggestionSelect = nodeElement?.querySelector("[data-last-result-path-select]");
    const pathInput = nodeElement?.querySelector("[data-last-result-path-input]");
    const customRow = nodeElement?.querySelector("[data-last-result-custom-path]");
    if (!activitySelect || !suggestionSelect || !pathInput) {
      return;
    }

    const activity = activityIndex.get(String(activitySelect.value ?? "").trim()) ?? null;
    const currentPath = String(pathInput.value ?? "").trim();
    const groups = this.#lastResultPathGroups(activity, currentPath);
    const isKnown = groups.some((group) => group.paths.some((entry) => entry.selected));
    const isCustom = Boolean(currentPath) && !isKnown;
    this.#replaceLastResultSelectOptions(suggestionSelect, groups, isCustom ? CUSTOM_PATH_OPTION : currentPath);
    customRow?.toggleAttribute("hidden", !isCustom);
    this.#refreshLastResultDescription(nodeElement, activityIndex);
  }

  #refreshLastResultDescription(nodeElement, activityIndex) {
    const activitySelect = nodeElement?.querySelector("[data-node-activity-select]");
    const suggestionSelect = nodeElement?.querySelector("[data-last-result-path-select]");
    const pathInput = nodeElement?.querySelector("[data-last-result-path-input]");
    const hint = nodeElement?.querySelector("[data-last-result-path-hint]");
    if (!suggestionSelect || !pathInput) {
      return;
    }

    const activity = activityIndex.get(String(activitySelect?.value ?? "").trim()) ?? null;
    const path = String(pathInput.value ?? "").trim();
    if (hint) {
      hint.textContent = this.#lastResultSelectedHint(activity, path);
    }
    const description = this.#knownResultPaths(activity).has(path)
      ? this.#resultPathDescription(path)
      : "";
    if (description) {
      suggestionSelect.dataset.tooltip = description;
    } else {
      delete suggestionSelect.dataset.tooltip;
    }
  }

  #replaceLastResultSelectOptions(select, groups, selectedValue) {
    select.replaceChildren();

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = game.i18n.localize(`${LANG}.Fields.Node.LastActivityResult.Choose`);
    select.append(blank);

    for (const group of groups) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (const suggestion of group.paths) {
        const option = document.createElement("option");
        option.value = suggestion.value;
        option.textContent = suggestion.label;
        optgroup.append(option);
      }
      select.append(optgroup);
    }

    const custom = document.createElement("option");
    custom.value = CUSTOM_PATH_OPTION;
    custom.textContent = game.i18n.localize(`${LANG}.Fields.Node.LastActivityResult.CustomOption`);
    select.append(custom);

    select.value = selectedValue;
  }

  #cloneNodes() {
    return ScConditionalChainFlow.normalizeFlow(this.activity?.flow).nodes;
  }

  #blankNode() {
    return ScConditionalChainFlow.normalizeNode({ nodeId: foundry.utils.randomID(8) });
  }

  #nodesFromSubmit(rawNodes) {
    if (!rawNodes) {
      return this.#cloneNodes();
    }
    const entries = Array.isArray(rawNodes)
      ? rawNodes
      : Object.entries(rawNodes)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, value]) => value);

    const previous = new Map(this.#cloneNodes().map((node) => [node.nodeId, node]));
    return entries.map((entry) => {
      const nodeId = String(entry?.nodeId ?? "").trim();
      const base = previous.get(nodeId) ?? {};
      const merged = foundry.utils.mergeObject(base, entry ?? {}, { inplace: false });
      merged.choices = entry?.choices !== undefined
        ? this.#choicesFromSubmit(entry.choices)
        : (base.choices ?? []);
      merged.valueBranches = entry?.valueBranches !== undefined
        ? this.#indexedEntries(entry.valueBranches)
        : (base.valueBranches ?? []);
      return ScConditionalChainFlow.normalizeNode(merged);
    });
  }

  #choicesFromSubmit(rawChoices) {
    if (!rawChoices) {
      return [];
    }
    if (Array.isArray(rawChoices)) {
      return rawChoices;
    }
    return Object.entries(rawChoices)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => value);
  }

  #indexedEntries(rawEntries) {
    if (!rawEntries) {
      return [];
    }
    if (Array.isArray(rawEntries)) {
      return rawEntries;
    }
    return Object.entries(rawEntries)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => value);
  }
}
