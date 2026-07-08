import test from "node:test";
import assert from "node:assert/strict";

function createHooks() {
  const handlers = new Map();
  return {
    on(name, callback) {
      const list = handlers.get(name) ?? [];
      list.push(callback);
      handlers.set(name, list);
      return callback;
    },
    callAll(name, ...args) {
      for (const callback of handlers.get(name) ?? []) {
        callback(...args);
      }
    }
  };
}

globalThis.Hooks = createHooks();

const { ScActivityResultTracker } = await import("../../scripts/activities/ScActivityResultTracker.js");
ScActivityResultTracker.registerHooks();

function makeActivity(type = "attack") {
  return {
    id: `${type}-activity`,
    name: `${type} activity`,
    type,
    item: { id: "item-1", uuid: "Item.item-1" },
    actor: { uuid: "Actor.actor-1" }
  };
}

function makeUseResults() {
  return {
    message: { id: "use-message" },
    updates: [],
    effects: [],
    templates: []
  };
}

function makeRoll({
  total,
  isCritical = false,
  isFumble = false,
  target = undefined,
  targets = [{ ac: 15 }]
} = {}) {
  return {
    total,
    formula: "1d20 + 5",
    isCritical,
    isFumble,
    isSuccess: Number.isFinite(target) ? total >= target : false,
    isFailure: Number.isFinite(target) ? total < target : false,
    options: Number.isFinite(target) ? { target } : {},
    parent: {
      getFlag(scope, key) {
        if (scope === "dnd5e" && key === "targets") {
          return targets;
        }
        return undefined;
      }
    }
  };
}

test("captures single-target attack hits from tracked attack rolls", async() => {
  const activity = makeActivity("attack");
  const usage = ScActivityResultTracker.withTrackedUsage({}, activity);
  const runtimeActivity = {
    ...activity,
    async rollAttack() {
      return [makeRoll({ total: 18, targets: [{ ac: 15 }] })];
    }
  };

  Hooks.callAll("dnd5e.preUseActivity", runtimeActivity, usage);
  Hooks.callAll("dnd5e.postUseActivity", runtimeActivity, usage, makeUseResults());

  await runtimeActivity.rollAttack({});
  const result = await ScActivityResultTracker.resolveUsageResult(runtimeActivity, usage, makeUseResults());

  assert.equal(result.kind, "attack");
  assert.equal(result.success, true);
  assert.equal(result.failure, false);
  assert.deepEqual(result.attack, {
    hit: true,
    miss: false,
    total: 18,
    critical: false,
    fumble: false,
    target: 15
  });
});

test("treats critical hits and fumbles as final attack outcomes without a numeric target", async() => {
  const criticalUsage = ScActivityResultTracker.withTrackedUsage({}, makeActivity("attack"));
  const criticalActivity = {
    ...makeActivity("attack"),
    async rollAttack() {
      return [makeRoll({ total: 2, isCritical: true, targets: [] })];
    }
  };

  Hooks.callAll("dnd5e.preUseActivity", criticalActivity, criticalUsage);
  Hooks.callAll("dnd5e.postUseActivity", criticalActivity, criticalUsage, makeUseResults());
  await criticalActivity.rollAttack({});
  const criticalResult = await ScActivityResultTracker.resolveUsageResult(
    criticalActivity,
    criticalUsage,
    makeUseResults()
  );
  assert.equal(criticalResult.attack.hit, true);
  assert.equal(criticalResult.attack.miss, false);

  const fumbleUsage = ScActivityResultTracker.withTrackedUsage({}, makeActivity("attack"));
  const fumbleActivity = {
    ...makeActivity("attack"),
    async rollAttack() {
      return [makeRoll({ total: 30, isFumble: true, targets: [] })];
    }
  };

  Hooks.callAll("dnd5e.preUseActivity", fumbleActivity, fumbleUsage);
  Hooks.callAll("dnd5e.postUseActivity", fumbleActivity, fumbleUsage, makeUseResults());
  await fumbleActivity.rollAttack({});
  const fumbleResult = await ScActivityResultTracker.resolveUsageResult(fumbleActivity, fumbleUsage, makeUseResults());
  assert.equal(fumbleResult.attack.hit, false);
  assert.equal(fumbleResult.attack.miss, true);
});

test("captures damage totals, part sums, and individual dice from tracked damage rolls", async() => {
  const activity = makeActivity("damage");
  const usage = ScActivityResultTracker.withTrackedUsage({}, activity);
  const makeDamageRoll = (total, results) => ({
    total,
    formula: "2d6 + 3",
    dice: [{ results }]
  });
  const runtimeActivity = {
    ...activity,
    async rollDamage() {
      return [
        makeDamageRoll(11, [{ result: 5, active: true }, { result: 3, active: true }]),
        makeDamageRoll(6, [{ result: 6, active: true }, { result: 2, active: false }])
      ];
    }
  };

  Hooks.callAll("dnd5e.preUseActivity", runtimeActivity, usage);
  Hooks.callAll("dnd5e.postUseActivity", runtimeActivity, usage, makeUseResults());

  await runtimeActivity.rollDamage({});
  const result = await ScActivityResultTracker.resolveUsageResult(runtimeActivity, usage, makeUseResults());

  assert.equal(result.kind, "damage");
  assert.equal(result.roll.total, 11);
  assert.equal(result.roll.sum, 17);
  assert.deepEqual(result.roll.totals, [11, 6]);
  assert.deepEqual(result.roll.dice, {
    count: 3,
    values: [5, 3, 6],
    total: 14,
    max: 6,
    min: 3
  });
});

test("reports empty dice details when rolls carry no dice terms", async() => {
  const activity = makeActivity("attack");
  const usage = ScActivityResultTracker.withTrackedUsage({}, activity);
  const runtimeActivity = {
    ...activity,
    async rollAttack() {
      return [makeRoll({ total: 12, targets: [] })];
    }
  };

  Hooks.callAll("dnd5e.preUseActivity", runtimeActivity, usage);
  Hooks.callAll("dnd5e.postUseActivity", runtimeActivity, usage, makeUseResults());

  await runtimeActivity.rollAttack({});
  const result = await ScActivityResultTracker.resolveUsageResult(runtimeActivity, usage, makeUseResults());

  assert.equal(result.roll.sum, 12);
  assert.deepEqual(result.roll.dice, { count: 0, values: [], total: null, max: null, min: null });
});

test("injects the previous result into tracked rolls as formula-safe @scLast data", async() => {
  const activity = makeActivity("heal");
  const lastResult = {
    kind: "damage",
    success: true,
    target: null,
    roll: { sum: 14, dice: { max: 6 } }
  };
  const usage = ScActivityResultTracker.withTrackedUsage({}, activity, lastResult);

  Hooks.callAll("dnd5e.preUseActivity", activity, usage);

  const rollConfig = {
    subject: activity,
    rolls: [{ data: { abilities: { str: 3 } } }, { data: {} }]
  };
  Hooks.callAll("dnd5e.preRollDamageV2", rollConfig);

  assert.equal(rollConfig.rolls[0].data.abilities.str, 3);
  assert.equal(rollConfig.rolls[0].data.scLast.roll.sum, 14);
  assert.equal(rollConfig.rolls[0].data.scLast.success, 1);
  assert.equal(rollConfig.rolls[0].data.scLast.target, 0);
  assert.equal(rollConfig.rolls[1].data.scLast.roll.dice.max, 6);
  assert.equal(String(rollConfig.rolls[0].data.scLast), "14");
  assert.ok(!Object.keys(rollConfig.rolls[0].data.scLast).includes("toString"));

  Hooks.callAll("dnd5e.postUseActivity", activity, usage, makeUseResults());
  await ScActivityResultTracker.resolveUsageResult(activity, usage, makeUseResults());
});

test("leaves untracked rolls and usages without a previous result untouched", async() => {
  const orphanConfig = {
    subject: makeActivity("damage"),
    rolls: [{ data: {} }]
  };
  Hooks.callAll("dnd5e.preRollDamageV2", orphanConfig);
  assert.equal(orphanConfig.rolls[0].data.scLast, undefined);

  const activity = makeActivity("attack");
  const usage = ScActivityResultTracker.withTrackedUsage({}, activity);
  Hooks.callAll("dnd5e.preUseActivity", activity, usage);
  const rollConfig = {
    subject: activity,
    rolls: [{ data: {} }]
  };
  Hooks.callAll("dnd5e.preRollAttackV2", rollConfig);
  assert.equal(rollConfig.rolls[0].data.scLast, undefined);

  Hooks.callAll("dnd5e.postUseActivity", activity, usage, makeUseResults());
  await ScActivityResultTracker.resolveUsageResult(activity, usage, makeUseResults());
});

test("returns the latest in-memory activity payload even when it is recorded after postUse finalizes", async() => {
  const activity = makeActivity("sc-contest");
  const usage = ScActivityResultTracker.withTrackedUsage({}, activity);

  Hooks.callAll("dnd5e.preUseActivity", activity, usage);
  Hooks.callAll("dnd5e.postUseActivity", activity, usage, makeUseResults());

  ScActivityResultTracker.recordActivityResult(usage, {
    kind: "contest",
    success: true,
    activity: { winner: "initiator" }
  });

  const result = await ScActivityResultTracker.resolveUsageResult(activity, usage, makeUseResults());
  assert.equal(result.kind, "contest");
  assert.equal(result.success, true);
  assert.equal(result.activity.winner, "initiator");
});
