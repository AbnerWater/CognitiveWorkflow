const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4RuntimeFlowDecisionRecord,
} = require("./m1-5-a4-runtime-flow-decision-record.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-decision-record.json",
);
const decisionHandoffPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-decision-handoff.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamCandidateFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRuntimeBridgeFrIds = [
  "FR-007",
  "FR-008",
  "FR-011",
  "FR-012",
  "FR-013",
  "FR-014",
  "FR-017",
  "FR-018",
];
const expectedReviewFrIds = [
  ...expectedStreamCandidateFrIds,
  ...expectedRuntimeBridgeFrIds,
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedDecisionRecord(mutator) {
  const decisionRecord = readJson(decisionRecordPath);
  mutator(decisionRecord);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-a4-record-"));
  const mutatedDecisionRecordPath = path.join(tempDir, "decision-record.json");
  fs.writeFileSync(
    mutatedDecisionRecordPath,
    JSON.stringify(decisionRecord, null, 2),
  );
  return mutatedDecisionRecordPath;
}

test("M1.5 A4 runtime-flow decision record returns a conservative summary", () => {
  const summary = validateA4RuntimeFlowDecisionRecord();

  assert.equal(
    summary.status,
    "a4_runtime_flow_reviewer_decisions_recorded_needs_followup",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.decisionItemCount, 11);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedReviewFrIds));
  assert.equal(
    summary.streamCandidateItemCount,
    expectedStreamCandidateFrIds.length,
  );
  assert.equal(
    summary.runtimeBridgeItemCount,
    expectedRuntimeBridgeFrIds.length,
  );
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.rejectedItemCount, 0);
  assert.equal(summary.needsFollowupItemCount, 11);
  assert.equal(summary.pendingReviewerDecisionItemCount, 0);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.209"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 runtime-flow decision record mirrors the W1.5.207 handoff", () => {
  const decisionRecord = readJson(decisionRecordPath);
  const handoff = readJson(decisionHandoffPath);

  assert.equal(decisionRecord.schema_version, "0.1.0");
  assert.equal(decisionRecord.slice, "W1.5.208");
  assert.equal(decisionRecord.exit_p1_1_status, "not_ready");
  assert.equal(handoff.slice, "W1.5.207");
  assert.deepEqual(
    sorted(decisionRecord.decision_items.map((item) => item.id)),
    sorted(handoff.decision_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(decisionRecord.decision_items.map((item) => item.package_item_id)),
    sorted(handoff.decision_items.map((item) => item.package_item_id)),
  );
  assert.deepEqual(
    sorted(decisionRecord.decision_items.map((item) => item.capture_id)),
    sorted(handoff.decision_items.map((item) => item.capture_id)),
  );
  assert.deepEqual(
    sorted(decisionRecord.decision_items.map((item) => item.fr_id)),
    sorted(expectedReviewFrIds),
  );
});

test("M1.5 A4 runtime-flow decision record keeps all decisions as needs_followup", () => {
  const decisionRecord = readJson(decisionRecordPath);

  assert.deepEqual(decisionRecord.reviewer_contract.allowed_decisions, [
    "accepted",
    "rejected",
    "needs_followup",
  ]);
  assert.equal(decisionRecord.reviewer_contract.decision_record_required, true);
  assert.equal(
    decisionRecord.reviewer_contract.decision_record_status,
    "recorded",
  );
  assert.equal(decisionRecord.summary.accepted_items, 0);
  assert.equal(decisionRecord.summary.rejected_items, 0);
  assert.equal(decisionRecord.summary.needs_followup_items, 11);
  assert.equal(decisionRecord.summary.pending_reviewer_decision_items, 0);
  assert.equal(
    decisionRecord.decision_items.every(
      (item) =>
        item.decision === "needs_followup" &&
        item.follow_up_required === true &&
        item.acceptance_blockers.length > 0,
    ),
    true,
  );
});

test("M1.5 A4 runtime-flow decision record rejects accepted item drift", () => {
  const mutatedDecisionRecordPath = writeMutatedDecisionRecord(
    (decisionRecord) => {
      decisionRecord.summary.accepted_items = 1;
    },
  );

  assert.throws(
    () =>
      validateA4RuntimeFlowDecisionRecord({
        decisionRecordPath: mutatedDecisionRecordPath,
      }),
    /summary accepted item count/u,
  );
});

test("M1.5 A4 runtime-flow decision record rejects unsupported decision drift", () => {
  const mutatedDecisionRecordPath = writeMutatedDecisionRecord(
    (decisionRecord) => {
      decisionRecord.decision_items[0].decision = "pending_reviewer_decision";
    },
  );

  assert.throws(
    () =>
      validateA4RuntimeFlowDecisionRecord({
        decisionRecordPath: mutatedDecisionRecordPath,
      }),
    /unsupported decision/u,
  );
});

test("M1.5 A4 runtime-flow decision record rejects missing follow-up refs", () => {
  const mutatedDecisionRecordPath = writeMutatedDecisionRecord(
    (decisionRecord) => {
      decisionRecord.decision_items[0].follow_up_refs = [];
    },
  );

  assert.throws(
    () =>
      validateA4RuntimeFlowDecisionRecord({
        decisionRecordPath: mutatedDecisionRecordPath,
      }),
    /follow-up refs/u,
  );
});

test("M1.5 A4 runtime-flow decision record test is wired into desktop package gates", () => {
  const decisionRecord = readJson(decisionRecordPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-runtime-flow-decision-record\.test\.cjs/u,
  );
  assert.equal(
    decisionRecord.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-runtime-flow-decision-record.test.cjs",
  );
  assert.equal(
    decisionRecord.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-runtime-flow-decision-record.cjs --check",
  );
  assert.equal(
    decisionRecord.reviewer_contract.standard_desktop_test,
    "pnpm --filter @cw/desktop run test",
  );
});
