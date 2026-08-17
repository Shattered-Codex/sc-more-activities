import test from "node:test";
import assert from "node:assert/strict";

const { ScTargetSaveService } = await import("../../scripts/activities/canvas/ScTargetSaveService.js");

function saveMessage({
  tokenId = null,
  actorId = null,
  ability = "dex",
  total,
  target = 14,
  isSuccess,
  timestamp = 100,
  type = "save",
  forceSuccess,
  requestTag
} = {}) {
  const roll = { total };
  if (target !== null) {
    roll.options = { target };
  }
  if (isSuccess !== undefined) {
    roll.isSuccess = isSuccess;
  }
  const rollFlag = { type, ability };
  if (forceSuccess !== undefined) {
    rollFlag.forceSuccess = forceSuccess;
  }
  const flags = { dnd5e: { roll: rollFlag } };
  if (requestTag !== undefined) {
    flags["sc-more-activities"] = { saveRequestId: requestTag };
  }
  return {
    timestamp,
    speaker: { token: tokenId, actor: actorId },
    flags,
    rolls: [roll]
  };
}

const targets = [
  { id: "t1", actorId: "a1", name: "Goblin A" },
  { id: "t2", actorId: "a2", name: "Goblin B" }
];

const request = {
  externalTargets: targets,
  ability: "dex",
  dc: 14,
  sinceTimestamp: 50
};

test("a failing roll marks the target as failed", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 5, isSuccess: false })
  ]);
  assert.deepEqual(results.failed.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(results.succeeded, []);
  assert.deepEqual(results.pending.map((entry) => entry.id), ["t2"]);
});

test("a successful roll marks the target as succeeded", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 20, isSuccess: true })
  ]);
  assert.deepEqual(results.succeeded.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(results.failed, []);
});

test("success falls back to comparing the total against the DC", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 14, target: null }),
    saveMessage({ tokenId: "t2", total: 13, target: null })
  ]);
  assert.deepEqual(results.succeeded.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(results.failed.map((entry) => entry.id), ["t2"]);
});

test("rolls made before the request are ignored", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 2, timestamp: 10 })
  ]);
  assert.deepEqual(results.failed, []);
  assert.equal(results.pending.length, 2);
});

test("rolls for another ability are ignored", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 2, ability: "con" })
  ]);
  assert.deepEqual(results.failed, []);
});

test("rolls against a different explicit DC are ignored", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 2, target: 18 })
  ]);
  assert.deepEqual(results.failed, []);
});

test("non-save messages and unknown tokens are ignored", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 2, type: "attack" }),
    saveMessage({ tokenId: "other", total: 2 })
  ]);
  assert.deepEqual(results.failed, []);
  assert.equal(results.pending.length, 2);
});

test("only the first roll per target counts", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 2, isSuccess: false, timestamp: 60 }),
    saveMessage({ tokenId: "t1", total: 20, isSuccess: true, timestamp: 70 })
  ]);
  assert.deepEqual(results.failed.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(results.succeeded, []);
});

test("a tokenless roll matches the pending target by actor", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: null, actorId: "a2", total: 3, isSuccess: false })
  ]);
  assert.deepEqual(results.failed.map((entry) => entry.id), ["t2"]);
});

test("a roll whose token is not pending never matches by actor", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "elsewhere", actorId: "a1", total: 3 })
  ]);
  assert.deepEqual(results.failed, []);
  assert.equal(results.pending.length, 2);
});

test("a roll tagged for another request is never consumed", () => {
  const results = ScTargetSaveService.collectSaveResults(
    { ...request, requestId: "request-a" },
    [saveMessage({ tokenId: "t1", total: 2, isSuccess: false, requestTag: "request-b" })]
  );
  assert.deepEqual(results.failed, []);
  assert.equal(results.pending.length, 2);
});

test("a roll tagged for this request is consumed", () => {
  const results = ScTargetSaveService.collectSaveResults(
    { ...request, requestId: "request-a" },
    [saveMessage({ tokenId: "t1", total: 2, isSuccess: false, requestTag: "request-a" })]
  );
  assert.deepEqual(results.failed.map((entry) => entry.id), ["t1"]);
});

test("with a request id, untagged rolls are never consumed", () => {
  const results = ScTargetSaveService.collectSaveResults(
    { ...request, requestId: "request-a" },
    [saveMessage({ tokenId: "t1", total: 20, isSuccess: true })]
  );
  assert.deepEqual(results.succeeded, []);
  assert.equal(results.pending.length, 2);
});

test("without a request id, untagged rolls match through the heuristics", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 20, isSuccess: true })
  ]);
  assert.deepEqual(results.succeeded.map((entry) => entry.id), ["t1"]);
});

test("without a request id, tagged rolls are never consumed", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 20, isSuccess: true, requestTag: "request-b" })
  ]);
  assert.deepEqual(results.succeeded, []);
  assert.equal(results.pending.length, 2);
});

test("a save forced to succeed by Legendary Resistance counts as a success", () => {
  const results = ScTargetSaveService.collectSaveResults(request, [
    saveMessage({ tokenId: "t1", total: 3, isSuccess: false, forceSuccess: true })
  ]);
  assert.deepEqual(results.succeeded.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(results.failed, []);
});

test("isEnabled only accepts an explicitly enabled config", () => {
  assert.equal(ScTargetSaveService.isEnabled({ enabled: true }), true);
  assert.equal(ScTargetSaveService.isEnabled({ enabled: false }), false);
  assert.equal(ScTargetSaveService.isEnabled(undefined), false);
});

test("resolveDc accepts plain numbers and floors them", () => {
  assert.equal(ScTargetSaveService.resolveDc({ dc: "14" }, {}), 14);
  assert.equal(ScTargetSaveService.resolveDc({ dc: "14.9" }, {}), 14);
});

test("resolveDc returns null for empty or unresolvable values", () => {
  assert.equal(ScTargetSaveService.resolveDc({ dc: "" }, {}), null);
  assert.equal(ScTargetSaveService.resolveDc({ dc: "8 + @prof" }, {}), null);
});

test("resolveDc resolves formulas through dnd5e simplifyBonus", (t) => {
  globalThis.dnd5e = {
    utils: {
      simplifyBonus: (formula, data) => {
        assert.equal(formula, "8 + @prof");
        assert.equal(data.prof, 4);
        return 12;
      }
    }
  };
  t.after(() => {
    delete globalThis.dnd5e;
  });

  const activity = { getRollData: () => ({ prof: 4 }) };
  assert.equal(ScTargetSaveService.resolveDc({ dc: "8 + @prof" }, activity), 12);
});
