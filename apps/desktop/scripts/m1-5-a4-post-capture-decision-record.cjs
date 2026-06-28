const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const postCaptureDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-decision-record.json",
);
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-decision-record.json",
);
const repairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-needs-followup-repair-plan.json",
);
const streamCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-phase-capture-execution.json",
);
const runtimeBridgeCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-bridge-user-path-capture.json",
);
const a8EvidencePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-prerequisite-evidence.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRuntimeBridgeFrIds = [
  "FR-007",
  "FR-008",
  "FR-011",
  "FR-013",
  "FR-014",
  "FR-017",
  "FR-018",
];
const expectedA8FrIds = ["FR-012"];
const expectedAllFrIds = [
  ...expectedStreamFrIds,
  ...expectedRuntimeBridgeFrIds,
  ...expectedA8FrIds,
];
const allowedDecisions = ["accepted", "rejected", "needs_followup"];
const artifactByGroup = {
  candidate_stream_evidence:
    "docs/04_runbook/m1.5-a4-stream-phase-capture-execution.json",
  runtime_bridge_evidence:
    "docs/04_runbook/m1.5-a4-runtime-bridge-user-path-capture.json",
  git_history_prereq_evidence:
    "docs/04_runbook/m1.5-a8-git-history-prerequisite-evidence.json",
};
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
  "rawInstructionText",
  "rawModelOutput",
  "rawResponseBody",
  "rawArtifactBody",
  "rawUploadedFileBytes",
  "rawFileContent",
  "rawCustomValue",
  "rawCredentialValue",
  "secure://",
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

function countBy(items, predicate) {
  return items.filter(predicate).length;
}

function buildFollowUpItems(streamCapture, runtimeBridgeCapture, a8Evidence) {
  const items = [];
  for (const item of streamCapture.phase_capture_items) {
    items.push({
      artifact: artifactByGroup.candidate_stream_evidence,
      group: "candidate_stream_evidence",
      trackId: "TRACK-A4-STREAM-PHASE-CAPTURE",
      id: item.id,
      frId: item.fr_id,
      repairItemId: item.repair_item_id,
      sourceDecisionId: item.source_decision_id,
      reviewItemId: item.review_item_id,
      accepted: item.accepted,
      reviewerDecisionRequired: item.reviewer_decision_required,
      sourceDecision: item.source_decision,
      remainingBlockers: item.post_capture_remaining_blockers,
    });
  }
  for (const item of runtimeBridgeCapture.runtime_bridge_capture_items) {
    items.push({
      artifact: artifactByGroup.runtime_bridge_evidence,
      group: "runtime_bridge_evidence",
      trackId: "TRACK-A4-RUNTIME-BRIDGE-CAPTURE",
      id: item.id,
      frId: item.fr_id,
      repairItemId: item.repair_item_id,
      sourceDecisionId: item.source_decision_id,
      reviewItemId: item.review_item_id,
      accepted: item.accepted,
      reviewerDecisionRequired: item.reviewer_decision_required,
      sourceDecision: item.source_decision,
      remainingBlockers: item.post_capture_remaining_blockers,
    });
  }
  const item = a8Evidence.fr012_prerequisite_item;
  items.push({
    artifact: artifactByGroup.git_history_prereq_evidence,
    group: "git_history_prereq_evidence",
    trackId: "TRACK-A8-GIT-HISTORY-PREREQ",
    id: item.id,
    frId: item.fr_id,
    repairItemId: item.repair_item_id,
    sourceDecisionId: item.source_decision_id,
    reviewItemId: item.review_item_id,
    accepted: item.accepted,
    reviewerDecisionRequired: item.reviewer_decision_required,
    sourceDecision: item.source_decision,
    remainingBlockers: item.post_audit_remaining_blockers,
  });
  return items;
}

function validateA4PostCaptureDecisionRecord(options = {}) {
  const postCaptureDecisionRecord = readJson(
    options.postCaptureDecisionRecordPath ?? postCaptureDecisionRecordPath,
  );
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const streamCapture = readJson(
    options.streamCapturePath ?? streamCapturePath,
  );
  const runtimeBridgeCapture = readJson(
    options.runtimeBridgeCapturePath ?? runtimeBridgeCapturePath,
  );
  const a8Evidence = readJson(options.a8EvidencePath ?? a8EvidencePath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(
    postCaptureDecisionRecord,
    "A4 post-capture decision record",
  );
  assertEqual(
    postCaptureDecisionRecord.schema_version,
    "0.1.0",
    "schema version",
  );
  assertEqual(postCaptureDecisionRecord.milestone, "M1.5", "milestone");
  assertEqual(postCaptureDecisionRecord.slice, "W1.5.213", "slice id");
  assertEqual(
    postCaptureDecisionRecord.decision_record_status,
    "a4_post_capture_reviewer_decisions_recorded_needs_followup",
    "decision record status",
  );
  assertEqual(
    postCaptureDecisionRecord.exit_p1_1_status,
    "not_ready",
    "EXIT-P1-1 status",
  );
  assertEqual(
    postCaptureDecisionRecord.exit_p1_10_status,
    "not_ready",
    "EXIT-P1-10 status",
  );
  assertDeepEqual(
    postCaptureDecisionRecord.reviewer_contract.allowed_decisions,
    allowedDecisions,
    "allowed decisions",
  );
  assertEqual(
    postCaptureDecisionRecord.reviewer_contract.decision_record_status,
    "recorded",
    "reviewer contract decision status",
  );
  assertEqual(
    postCaptureDecisionRecord.reviewer_contract
      .accepted_item_count_must_remain_zero,
    true,
    "accepted-item guard",
  );
  assertEqual(
    postCaptureDecisionRecord.reviewer_contract
      .phase_exit_status_must_remain_not_ready,
    true,
    "phase-exit guard",
  );

  assertEqual(decisionRecord.slice, "W1.5.208", "source decision slice");
  assertEqual(repairPlan.slice, "W1.5.209", "repair plan source slice");
  assertEqual(streamCapture.slice, "W1.5.210", "stream capture source slice");
  assertEqual(
    runtimeBridgeCapture.slice,
    "W1.5.211",
    "runtime bridge capture source slice",
  );
  assertEqual(a8Evidence.slice, "W1.5.212", "A8 evidence source slice");
  assertEqual(
    streamCapture.capture_status,
    "a4_stream_phase_capture_executed_not_accepted",
    "stream capture status",
  );
  assertEqual(
    runtimeBridgeCapture.capture_status,
    "a4_runtime_bridge_user_path_capture_executed_not_accepted",
    "runtime bridge capture status",
  );
  assertEqual(
    a8Evidence.evidence_status,
    "a8_git_history_prerequisite_evidence_recorded_not_accepted",
    "A8 evidence status",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-10",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-10 status",
  );

  const sourceDecisionItemsById = new Map(
    decisionRecord.decision_items.map((item) => [item.id, item]),
  );
  const repairItemsById = new Map(
    repairPlan.repair_items.map((item) => [item.id, item]),
  );
  const followUpItemsById = new Map(
    buildFollowUpItems(streamCapture, runtimeBridgeCapture, a8Evidence).map(
      (item) => [item.id, item],
    ),
  );

  assertDeepEqual(
    sorted(followUpItemsById.values().map((item) => item.frId)),
    sorted(expectedAllFrIds),
    "source follow-up FR ids",
  );
  assertEqual(
    postCaptureDecisionRecord.post_capture_decision_items.length,
    expectedAllFrIds.length,
    "post-capture decision item count",
  );
  assertDeepEqual(
    sorted(
      postCaptureDecisionRecord.post_capture_decision_items.map(
        (item) => item.fr_id,
      ),
    ),
    sorted(expectedAllFrIds),
    "post-capture decision FR ids",
  );
  assertEqual(
    postCaptureDecisionRecord.post_capture_decision_items.some(
      (item) => item.fr_id === "FR-015",
    ),
    false,
    "FR-015 absence",
  );

  for (const item of postCaptureDecisionRecord.post_capture_decision_items) {
    const sourceDecisionItem = sourceDecisionItemsById.get(
      item.source_decision_id,
    );
    const repairItem = repairItemsById.get(item.repair_item_id);
    const followUpItem = followUpItemsById.get(item.follow_up_item_id);

    assertCondition(Boolean(sourceDecisionItem), `${item.id} source decision`);
    assertCondition(Boolean(repairItem), `${item.id} repair item`);
    assertCondition(Boolean(followUpItem), `${item.id} follow-up item`);
    assertCondition(
      allowedDecisions.includes(item.post_capture_decision),
      `${item.id} allowed decision`,
    );
    assertEqual(
      item.post_capture_decision,
      "needs_followup",
      `${item.id} post-capture decision`,
    );
    assertEqual(
      item.post_capture_review_status,
      "reviewed_needs_followup_not_accepted",
      `${item.id} review status`,
    );
    assertEqual(item.accepted, false, `${item.id} accepted flag`);
    assertEqual(item.rejected, false, `${item.id} rejected flag`);
    assertEqual(item.follow_up_required, true, `${item.id} follow-up required`);
    assertEqual(item.evidence_reviewed, true, `${item.id} evidence reviewed`);
    assertEqual(item.fr_id, sourceDecisionItem.fr_id, `${item.id} source FR`);
    assertEqual(item.fr_id, repairItem.fr_id, `${item.id} repair FR`);
    assertEqual(item.fr_id, followUpItem.frId, `${item.id} follow-up FR`);
    assertEqual(
      item.review_item_id,
      followUpItem.reviewItemId,
      `${item.id} review item`,
    );
    assertEqual(
      item.source_decision,
      sourceDecisionItem.decision,
      `${item.id} source decision value`,
    );
    assertEqual(
      sourceDecisionItem.decision,
      "needs_followup",
      `${item.id} source decision needs-followup`,
    );
    assertEqual(
      repairItem.implementation_status,
      "planned_not_implemented",
      `${item.id} repair implementation status`,
    );
    assertEqual(
      item.follow_up_track_id,
      followUpItem.trackId,
      `${item.id} follow-up track`,
    );
    assertEqual(
      item.follow_up_artifact,
      artifactByGroup[item.review_group],
      `${item.id} artifact by review group`,
    );
    assertEqual(
      item.follow_up_artifact,
      followUpItem.artifact,
      `${item.id} source follow-up artifact`,
    );
    assertEqual(
      item.review_group,
      followUpItem.group,
      `${item.id} source follow-up group`,
    );
    assertEqual(
      followUpItem.accepted,
      false,
      `${item.id} source follow-up accepted flag`,
    );
    assertEqual(
      followUpItem.reviewerDecisionRequired,
      true,
      `${item.id} source reviewer decision required`,
    );
    assertEqual(
      followUpItem.sourceDecision,
      "needs_followup",
      `${item.id} source follow-up decision`,
    );
    assertCondition(
      item.resolved_source_blockers.length > 0,
      `${item.id} resolved source blockers`,
    );
    assertCondition(
      item.remaining_acceptance_blockers.length > 0,
      `${item.id} remaining acceptance blockers`,
    );
    assertCondition(item.evidence_refs.length >= 3, `${item.id} evidence refs`);
    assertCondition(
      item.evidence_refs.some((ref) => ref.includes(item.follow_up_item_id)),
      `${item.id} evidence ref points to follow-up item`,
    );
    assertCondition(
      item.next_action_refs.length > 0,
      `${item.id} next action refs`,
    );
  }

  const streamItemCount = countBy(
    postCaptureDecisionRecord.post_capture_decision_items,
    (item) => item.review_group === "candidate_stream_evidence",
  );
  const runtimeBridgeItemCount = countBy(
    postCaptureDecisionRecord.post_capture_decision_items,
    (item) => item.review_group === "runtime_bridge_evidence",
  );
  const gitHistoryItemCount = countBy(
    postCaptureDecisionRecord.post_capture_decision_items,
    (item) => item.review_group === "git_history_prereq_evidence",
  );
  const acceptedItemCount = countBy(
    postCaptureDecisionRecord.post_capture_decision_items,
    (item) => item.post_capture_decision === "accepted",
  );
  const rejectedItemCount = countBy(
    postCaptureDecisionRecord.post_capture_decision_items,
    (item) => item.post_capture_decision === "rejected",
  );
  const needsFollowupItemCount = countBy(
    postCaptureDecisionRecord.post_capture_decision_items,
    (item) => item.post_capture_decision === "needs_followup",
  );

  assertEqual(
    postCaptureDecisionRecord.summary.decision_item_count,
    postCaptureDecisionRecord.post_capture_decision_items.length,
    "summary decision item count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.stream_phase_decision_items,
    streamItemCount,
    "summary stream count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.runtime_bridge_decision_items,
    runtimeBridgeItemCount,
    "summary runtime bridge count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.git_history_prereq_decision_items,
    gitHistoryItemCount,
    "summary git history count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.rejected_items,
    rejectedItemCount,
    "summary rejected count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.needs_followup_items,
    needsFollowupItemCount,
    "summary needs-followup count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.post_capture_reviewed_items,
    postCaptureDecisionRecord.post_capture_decision_items.length,
    "summary post-capture reviewed count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.source_w1_5_210_items,
    streamCapture.phase_capture_items.length,
    "summary W1.5.210 count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.source_w1_5_211_items,
    runtimeBridgeCapture.runtime_bridge_capture_items.length,
    "summary W1.5.211 count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.source_w1_5_212_items,
    1,
    "summary W1.5.212 count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10 status",
  );
  assertEqual(
    postCaptureDecisionRecord.excluded_items.some(
      (item) => item.fr_id === "FR-015",
    ),
    true,
    "FR-015 excluded item",
  );
  assertDeepEqual(
    postCaptureDecisionRecord.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.214"],
    "next recommended slices",
  );

  return {
    status: postCaptureDecisionRecord.decision_record_status,
    exitP1_1Status: postCaptureDecisionRecord.exit_p1_1_status,
    exitP1_10Status: postCaptureDecisionRecord.exit_p1_10_status,
    decisionItemCount:
      postCaptureDecisionRecord.post_capture_decision_items.length,
    frIds: postCaptureDecisionRecord.post_capture_decision_items.map(
      (item) => item.fr_id,
    ),
    streamPhaseDecisionItemCount: streamItemCount,
    runtimeBridgeDecisionItemCount: runtimeBridgeItemCount,
    gitHistoryPrereqDecisionItemCount: gitHistoryItemCount,
    acceptedItemCount,
    rejectedItemCount,
    needsFollowupItemCount,
    nextRecommendedSlices:
      postCaptureDecisionRecord.next_recommended_slices.map(
        (slice) => slice.id,
      ),
  };
}

if (require.main === module) {
  const summary = validateA4PostCaptureDecisionRecord();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  postCaptureDecisionRecordPath,
  validateA4PostCaptureDecisionRecord,
};
