const fs = require("node:fs");
const path = require("node:path");

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
const reviewPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-review-package.json",
);
const capturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-capture-execution.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

const allowedDecisions = ["accepted", "rejected", "needs_followup"];

const forbiddenFragments = [
  "Review repair plan now",
  "Confirm workflow handoff",
  "Resume local request",
  "AppData",
  "outputDir",
  "outputPath",
  "jsonPath",
  "token=",
  "#hash",
  "rawPrompt",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSanitizedJson(value, label) {
  const text = JSON.stringify(value);
  for (const fragment of forbiddenFragments) {
    assertCondition(
      !text.includes(fragment),
      `${label} must not contain forbidden fragment ${fragment}`,
    );
  }
}

function countByDecision(decisionItems, decision) {
  return decisionItems.filter((item) => item.decision === decision).length;
}

function validateA4RuntimeFlowDecisionRecord(options = {}) {
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const handoff = readJson(options.decisionHandoffPath ?? decisionHandoffPath);
  const reviewPackage = readJson(
    options.reviewPackagePath ?? reviewPackagePath,
  );
  const capture = readJson(options.capturePath ?? capturePath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(decisionRecord, "A4 runtime-flow decision record");
  assertEqual(decisionRecord.schema_version, "0.1.0", "schema version");
  assertEqual(decisionRecord.milestone, "M1.5", "milestone");
  assertEqual(decisionRecord.slice, "W1.5.208", "slice id");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_runtime_flow_reviewer_decisions_recorded_needs_followup",
    "decision record status",
  );
  assertEqual(decisionRecord.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    decisionRecord.reviewer_contract.reviewer,
    "A4 ux-acceptance-reviewer",
    "reviewer",
  );
  assertEqual(
    decisionRecord.reviewer_contract.source_handoff_status,
    handoff.handoff_status,
    "source handoff status",
  );
  assertDeepEqual(
    decisionRecord.reviewer_contract.allowed_decisions,
    allowedDecisions,
    "allowed reviewer decisions",
  );
  assertEqual(
    decisionRecord.reviewer_contract.decision_record_status,
    "recorded",
    "decision record flag",
  );
  assertEqual(
    decisionRecord.reviewer_contract.accepted_item_count_must_remain_zero,
    true,
    "accepted item guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );

  assertEqual(handoff.slice, "W1.5.207", "handoff source slice");
  assertEqual(
    handoff.summary.pending_reviewer_decision_items,
    handoff.decision_items.length,
    "handoff pending decision count",
  );
  assertEqual(
    reviewPackage.summary.pending_a4_review_items,
    reviewPackage.review_package_items.length,
    "source package pending count",
  );
  assertEqual(
    reviewPackage.summary.accepted_items,
    0,
    "source package accepted count",
  );
  assertEqual(capture.summary.accepted_items, 0, "capture accepted count");
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );

  const handoffItemsById = new Map(
    handoff.decision_items.map((item) => [item.id, item]),
  );
  const packageItemsById = new Map(
    reviewPackage.review_package_items.map((item) => [item.id, item]),
  );
  const captureItemsById = new Map(
    capture.review_item_captures.map((item) => [item.id, item]),
  );

  assertEqual(
    decisionRecord.decision_items.length,
    handoff.decision_items.length,
    "decision record item count",
  );
  assertDeepEqual(
    sorted(decisionRecord.decision_items.map((item) => item.id)),
    sorted(handoff.decision_items.map((item) => item.id)),
    "decision ids",
  );

  let streamCandidateItemCount = 0;
  let runtimeBridgeItemCount = 0;
  for (const decisionItem of decisionRecord.decision_items) {
    const handoffItem = handoffItemsById.get(decisionItem.id);
    const packageItem = packageItemsById.get(decisionItem.package_item_id);
    const captureItem = captureItemsById.get(decisionItem.capture_id);

    assertCondition(Boolean(handoffItem), `${decisionItem.id} handoff item`);
    assertCondition(Boolean(packageItem), `${decisionItem.id} package item`);
    assertCondition(Boolean(captureItem), `${decisionItem.id} capture item`);
    assertCondition(
      allowedDecisions.includes(decisionItem.decision),
      `${decisionItem.id} unsupported decision`,
    );
    assertEqual(
      decisionItem.decision,
      "needs_followup",
      `${decisionItem.id} decision`,
    );
    assertEqual(
      decisionItem.fr_id,
      handoffItem.fr_id,
      `${decisionItem.id} handoff FR id`,
    );
    assertEqual(
      decisionItem.package_item_id,
      handoffItem.package_item_id,
      `${decisionItem.id} package item id`,
    );
    assertEqual(
      decisionItem.review_item_id,
      handoffItem.review_item_id,
      `${decisionItem.id} review item id`,
    );
    assertEqual(
      decisionItem.capture_id,
      handoffItem.capture_id,
      `${decisionItem.id} capture id`,
    );
    assertEqual(
      decisionItem.review_group,
      handoffItem.review_group,
      `${decisionItem.id} handoff review group`,
    );
    assertEqual(
      decisionItem.review_focus,
      handoffItem.review_focus,
      `${decisionItem.id} review focus`,
    );
    assertDeepEqual(
      decisionItem.acceptance_blockers,
      handoffItem.missing_before_acceptance,
      `${decisionItem.id} acceptance blockers`,
    );
    assertEqual(
      decisionItem.fr_id,
      packageItem.fr_id,
      `${decisionItem.id} package FR id`,
    );
    assertEqual(
      decisionItem.fr_id,
      captureItem.fr_id,
      `${decisionItem.id} capture FR id`,
    );
    assertEqual(
      decisionItem.reviewer,
      "A4 ux-acceptance-reviewer",
      `${decisionItem.id} reviewer`,
    );
    assertCondition(
      typeof decisionItem.decided_at === "string" &&
        decisionItem.decided_at.length > 0,
      `${decisionItem.id} decided_at required`,
    );
    assertCondition(
      typeof decisionItem.rationale === "string" &&
        decisionItem.rationale.length > 0,
      `${decisionItem.id} rationale required`,
    );
    assertCondition(
      decisionItem.evidence_refs.length >= 3,
      `${decisionItem.id} evidence refs`,
    );
    assertEqual(
      decisionItem.follow_up_required,
      true,
      `${decisionItem.id} follow-up required`,
    );
    assertCondition(
      decisionItem.follow_up_refs.length > 0,
      `${decisionItem.id} follow-up refs`,
    );

    if (decisionItem.review_group === "candidate_stream_evidence") {
      streamCandidateItemCount += 1;
    } else if (decisionItem.review_group === "runtime_bridge_evidence") {
      runtimeBridgeItemCount += 1;
    } else {
      throw new Error(`${decisionItem.id} has unsupported review group`);
    }
  }

  assertEqual(
    decisionRecord.summary.decision_item_count,
    decisionRecord.decision_items.length,
    "summary decision item count",
  );
  assertEqual(
    decisionRecord.summary.stream_candidate_items,
    streamCandidateItemCount,
    "summary stream candidate count",
  );
  assertEqual(
    decisionRecord.summary.runtime_bridge_items,
    runtimeBridgeItemCount,
    "summary runtime bridge count",
  );
  assertEqual(
    decisionRecord.summary.accepted_items,
    countByDecision(decisionRecord.decision_items, "accepted"),
    "summary accepted item count",
  );
  assertEqual(
    decisionRecord.summary.rejected_items,
    countByDecision(decisionRecord.decision_items, "rejected"),
    "summary rejected item count",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_items,
    countByDecision(decisionRecord.decision_items, "needs_followup"),
    "summary needs-followup item count",
  );
  assertEqual(
    decisionRecord.summary.pending_reviewer_decision_items,
    0,
    "summary pending reviewer decision count",
  );
  assertEqual(
    decisionRecord.summary.source_handoff_pending_reviewer_decision_items,
    handoff.summary.pending_reviewer_decision_items,
    "summary source handoff pending count",
  );
  assertEqual(
    decisionRecord.summary.source_package_pending_a4_review_items,
    reviewPackage.summary.pending_a4_review_items,
    "summary source package pending count",
  );
  assertEqual(
    decisionRecord.summary.source_package_accepted_items,
    reviewPackage.summary.accepted_items,
    "summary source package accepted count",
  );
  assertEqual(
    decisionRecord.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertDeepEqual(
    decisionRecord.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.209"],
    "next recommended slices",
  );

  return {
    status: decisionRecord.decision_record_status,
    exitP1_1Status: decisionRecord.exit_p1_1_status,
    decisionItemCount: decisionRecord.decision_items.length,
    frIds: decisionRecord.decision_items.map((item) => item.fr_id),
    streamCandidateItemCount,
    runtimeBridgeItemCount,
    acceptedItemCount: decisionRecord.summary.accepted_items,
    rejectedItemCount: decisionRecord.summary.rejected_items,
    needsFollowupItemCount: decisionRecord.summary.needs_followup_items,
    pendingReviewerDecisionItemCount:
      decisionRecord.summary.pending_reviewer_decision_items,
    nextRecommendedSlices: decisionRecord.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4RuntimeFlowDecisionRecord();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  decisionRecordPath,
  validateA4RuntimeFlowDecisionRecord,
};
