const GROUPS = Object.freeze({
  common: Object.freeze([
    "kind",
    "success",
    "failure",
    "total",
    "critical",
    "fumble",
    "target",
    "canceled",
    "sourceActivity.id",
    "sourceActivity.type",
    "sourceActivity.name",
    "sourceActivity.itemId",
    "sourceActivity.itemUuid",
    "sourceActivity.actorUuid",
    "use.messageId",
    "use.updateCount",
    "use.effectCount",
    "use.templateCount"
  ]),
  roll: Object.freeze([
    "roll.total",
    "roll.sum",
    "roll.totals.0",
    "roll.count",
    "roll.success",
    "roll.failure",
    "roll.critical",
    "roll.fumble",
    "roll.target",
    "roll.formula",
    "roll.ability",
    "roll.skill",
    "roll.tool"
  ]),
  dice: Object.freeze([
    "roll.dice.total",
    "roll.dice.count",
    "roll.dice.values.0",
    "roll.dice.max",
    "roll.dice.min"
  ]),
  attack: Object.freeze([
    "attack.hit",
    "attack.miss",
    "attack.total",
    "attack.critical",
    "attack.fumble",
    "attack.target"
  ]),
  grant: Object.freeze([
    "activity.checkPassed",
    "activity.createdCount",
    "activity.updatedCount",
    "activity.actorUuid",
    "activity.check.dc",
    "activity.check.total",
    "activity.canceled",
    "activity.reason"
  ]),
  contest: Object.freeze([
    "activity.canceled",
    "activity.winner",
    "activity.tied",
    "activity.attempt",
    "contest.winner",
    "contest.tied",
    "contest.initiator.total",
    "contest.initiator.actorUuid",
    "contest.initiator.tokenUuid",
    "contest.defender.total",
    "contest.defender.actorUuid",
    "contest.defender.tokenUuid"
  ])
});

const ACTIVITY_GROUPS = Object.freeze({
  attack: Object.freeze(["common", "attack", "roll", "dice"]),
  damage: Object.freeze(["common", "roll", "dice"]),
  heal: Object.freeze(["common", "roll", "dice"]),
  save: Object.freeze(["common", "roll", "dice"]),
  "sc-grant": Object.freeze(["common", "grant", "roll"]),
  "sc-contest": Object.freeze(["common", "contest"])
});

export class ScActivityResultPathCatalog {
  static groupDefinitions() {
    return ScActivityResultPathCatalog.#cloneGroups(Object.keys(GROUPS));
  }

  static groupsForActivity(activity) {
    return ScActivityResultPathCatalog.groupsForActivityType(activity?.type ?? activity);
  }

  static groupsForActivityType(activityType) {
    const normalizedType = String(activityType ?? "").trim();
    const primary = ACTIVITY_GROUPS[normalizedType];
    if (!primary) {
      return ScActivityResultPathCatalog.groupDefinitions();
    }
    return ScActivityResultPathCatalog.#cloneGroups(primary, new Set(primary));
  }

  static suggestionsForActivity(activity) {
    return ScActivityResultPathCatalog.suggestionsForActivityType(activity?.type ?? activity);
  }

  static suggestionsForActivityType(activityType) {
    return ScActivityResultPathCatalog.groupsForActivityType(activityType)
      .flatMap((group) => group.paths.map((path) => ({
        group: group.id,
        recommended: group.recommended,
        path
      })));
  }

  static #cloneGroups(groupIds, recommended = new Set()) {
    const seenPaths = new Set();
    return groupIds.map((groupId) => ({
      id: groupId,
      recommended: recommended.has(groupId),
      paths: GROUPS[groupId].filter((path) => {
        if (seenPaths.has(path)) {
          return false;
        }
        seenPaths.add(path);
        return true;
      })
    })).filter((group) => group.paths.length > 0);
  }
}
