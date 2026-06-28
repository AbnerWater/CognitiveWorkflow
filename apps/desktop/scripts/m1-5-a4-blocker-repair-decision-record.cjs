const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const blockerDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-repair-decision-record.json",
);
const blockerRepairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-blocker-repair-plan.json",
);
const postCaptureDecisionPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-decision-record.json",
);
const streamRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-blocker-repair.json",
);
const runtimeUxRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-blocker-repair.json",
);
const a8RepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-blocker-repair.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

const allowedDecisions = ["accepted", "rejected", "needs_followup"];
const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRuntimeUxFrIds = [
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
  ...expectedRuntimeUxFrIds,
  ...expectedA8FrIds,
];
const expectedReviewGroups = {
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE": "stream_acceptance_repair",
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE": "runtime_ux_repair",
  "TRACK-A8-GIT-HISTORY-CONFORMANCE": "git_history_conformance_repair",
};
const expectedDecisionOwners = {
  stream_acceptance_repair: "A4 ux-acceptance-reviewer",
  runtime_ux_repair: "A4 ux-acceptance-reviewer",
  git_history_conformance_repair: "A8 git-history-auditor",
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
  "prompt_to_user",
  "user staged content",
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

function parseSliceOrdinal(sliceId) {
  const match = /^W1\.5\.(\d+)$/.exec(sliceId);
  assertCondition(Boolean(match), `invalid slice id ${sliceId}`);
  return Number(match[1]);
}

function assertSliceAtLeast(actual, expected, message) {
  const actualOrdinal = parseSliceOrdinal(actual);
  const expectedOrdinal = parseSliceOrdinal(expected);
  assertCondition(
    actualOrdinal >= expectedOrdinal,
    `${message}: expected ${actual} to be at least ${expected}`,
  );
}

function collectRepairItems(streamRepair, runtimeUxRepair, a8Repair) {
  return [
    ...streamRepair.repair_items.map((item) => ({
      ...item,
      sourceRepairArtifact:
        "docs/04_runbook/m1.5-a4-stream-acceptance-blocker-repair.json",
      sourceSlice: "W1.5.215",
    })),
    ...runtimeUxRepair.repair_items.map((item) => ({
      ...item,
      sourceRepairArtifact:
        "docs/04_runbook/m1.5-a4-runtime-ux-acceptance-blocker-repair.json",
      sourceSlice: "W1.5.216",
    })),
    ...a8Repair.repair_items.map((item) => ({
      ...item,
      sourceRepairArtifact:
        "docs/04_runbook/m1.5-a8-git-history-conformance-blocker-repair.json",
      sourceSlice: "W1.5.217",
    })),
  ];
}

function validateA4BlockerRepairDecisionRecord(options = {}) {
  const decisionRecord = readJson(
    options.blockerDecisionRecordPath ?? blockerDecisionRecordPath,
  );
  const blockerRepairPlan = readJson(
    options.blockerRepairPlanPath ?? blockerRepairPlanPath,
  );
  const postCaptureDecision = readJson(
    options.postCaptureDecisionPath ?? postCaptureDecisionPath,
  );
  const streamRepair = readJson(options.streamRepairPath ?? streamRepairPath);
  const runtimeUxRepair = readJson(
    options.runtimeUxRepairPath ?? runtimeUxRepairPath,
  );
  const a8Repair = readJson(options.a8RepairPath ?? a8RepairPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(decisionRecord, "A4 blocker repair decision record");
  assertEqual(decisionRecord.schema_version, "0.1.0", "schema version");
  assertEqual(decisionRecord.milestone, "M1.5", "milestone");
  assertEqual(decisionRecord.slice, "W1.5.218", "slice id");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_blocker_repair_reviewer_decisions_recorded_needs_followup",
    "decision record status",
  );
  assertEqual(decisionRecord.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(decisionRecord.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertDeepEqual(
    decisionRecord.reviewer_contract.reviewers,
    ["A4 ux-acceptance-reviewer", "A8 git-history-auditor"],
    "reviewers",
  );
  assertDeepEqual(
    decisionRecord.reviewer_contract.allowed_decisions,
    allowedDecisions,
    "allowed decisions",
  );
  assertEqual(
    decisionRecord.reviewer_contract.accepted_item_count_must_remain_zero,
    true,
    "accepted item guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.implemented_item_count_must_remain_zero,
    true,
    "implemented item guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );

  assertEqual(blockerRepairPlan.slice, "W1.5.214", "blocker plan slice");
  assertEqual(streamRepair.slice, "W1.5.215", "stream repair slice");
  assertEqual(runtimeUxRepair.slice, "W1.5.216", "runtime UX repair slice");
  assertEqual(a8Repair.slice, "W1.5.217", "A8 repair slice");
  assertEqual(
    streamRepair.repair_status,
    "a4_stream_acceptance_blocker_repair_executed_not_accepted",
    "stream repair status",
  );
  assertEqual(
    runtimeUxRepair.repair_status,
    "a4_runtime_ux_acceptance_blocker_repair_executed_not_accepted",
    "runtime UX repair status",
  );
  assertEqual(
    a8Repair.repair_status,
    "a8_git_history_conformance_blocker_repair_executed_not_accepted",
    "A8 repair status",
  );
  assertEqual(
    postCaptureDecision.slice,
    "W1.5.213",
    "post-capture decision slice",
  );
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.218",
    "readiness ledger slice",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-10",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-10",
  );

  const sourceRepairItems = collectRepairItems(
    streamRepair,
    runtimeUxRepair,
    a8Repair,
  );
  const sourceRepairItemsById = new Map(
    sourceRepairItems.map((item) => [item.id, item]),
  );
  const blockerPlanItemsById = new Map(
    blockerRepairPlan.repair_items.map((item) => [item.id, item]),
  );
  const postCaptureItemsById = new Map(
    postCaptureDecision.post_capture_decision_items.map((item) => [
      item.id,
      item,
    ]),
  );

  assertDeepEqual(
    sorted(sourceRepairItems.map((item) => item.fr_id)),
    sorted(expectedAllFrIds),
    "source repair FR ids",
  );
  assertEqual(
    decisionRecord.blocker_repair_decision_items.length,
    expectedAllFrIds.length,
    "decision item count",
  );
  assertDeepEqual(
    sorted(
      decisionRecord.blocker_repair_decision_items.map((item) => item.fr_id),
    ),
    sorted(expectedAllFrIds),
    "decision FR ids",
  );
  assertCondition(
    !decisionRecord.blocker_repair_decision_items.some(
      (item) => item.fr_id === "FR-015",
    ),
    "FR-015 must stay out of blocker decisions",
  );

  let streamDecisionCount = 0;
  let runtimeUxDecisionCount = 0;
  let gitHistoryDecisionCount = 0;
  for (const decisionItem of decisionRecord.blocker_repair_decision_items) {
    const sourceRepairItem = sourceRepairItemsById.get(
      decisionItem.source_repair_item_id,
    );
    const blockerPlanItem = blockerPlanItemsById.get(
      decisionItem.source_blocker_repair_item_id,
    );
    const postCaptureItem = postCaptureItemsById.get(
      decisionItem.source_post_capture_decision_id,
    );

    assertCondition(
      Boolean(sourceRepairItem),
      `${decisionItem.id} source repair`,
    );
    assertCondition(
      Boolean(blockerPlanItem),
      `${decisionItem.id} blocker plan`,
    );
    assertCondition(
      Boolean(postCaptureItem),
      `${decisionItem.id} post-capture decision`,
    );
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
      decisionItem.decision_status,
      "reviewed_needs_followup_not_accepted",
      `${decisionItem.id} decision status`,
    );
    assertEqual(decisionItem.accepted, false, `${decisionItem.id} accepted`);
    assertEqual(
      decisionItem.implemented,
      false,
      `${decisionItem.id} implemented`,
    );
    assertEqual(
      decisionItem.follow_up_required,
      true,
      `${decisionItem.id} follow-up required`,
    );
    assertEqual(
      decisionItem.evidence_reviewed,
      true,
      `${decisionItem.id} evidence reviewed`,
    );
    assertEqual(
      decisionItem.fr_id,
      sourceRepairItem.fr_id,
      `${decisionItem.id} source repair FR`,
    );
    assertEqual(
      decisionItem.fr_id,
      blockerPlanItem.fr_id,
      `${decisionItem.id} blocker plan FR`,
    );
    assertEqual(
      decisionItem.fr_id,
      postCaptureItem.fr_id,
      `${decisionItem.id} post-capture FR`,
    );
    assertEqual(
      decisionItem.source_repair_artifact,
      sourceRepairItem.sourceRepairArtifact,
      `${decisionItem.id} source artifact`,
    );
    assertEqual(
      decisionItem.source_blocker_repair_item_id,
      sourceRepairItem.source_blocker_repair_item_id,
      `${decisionItem.id} source blocker id`,
    );
    assertEqual(
      decisionItem.source_post_capture_decision_id,
      sourceRepairItem.source_post_capture_decision_id,
      `${decisionItem.id} source post-capture id`,
    );
    assertEqual(
      decisionItem.source_track_id,
      sourceRepairItem.track_id,
      `${decisionItem.id} track id`,
    );
    assertEqual(
      decisionItem.source_repair_status,
      sourceRepairItem.repair_status,
      `${decisionItem.id} source repair status`,
    );
    assertEqual(
      decisionItem.review_group,
      expectedReviewGroups[sourceRepairItem.track_id],
      `${decisionItem.id} review group`,
    );
    assertEqual(
      decisionItem.decision_owner,
      expectedDecisionOwners[decisionItem.review_group],
      `${decisionItem.id} decision owner`,
    );
    assertDeepEqual(
      decisionItem.remaining_acceptance_blockers,
      sourceRepairItem.remaining_acceptance_blockers,
      `${decisionItem.id} remaining acceptance blockers`,
    );
    assertDeepEqual(
      decisionItem.source_acceptance_blockers,
      sourceRepairItem.source_acceptance_blockers,
      `${decisionItem.id} source acceptance blockers`,
    );
    assertCondition(
      decisionItem.evidence_refs.some((ref) =>
        ref.includes(decisionItem.source_repair_item_id),
      ),
      `${decisionItem.id} source repair evidence ref`,
    );
    assertCondition(
      decisionItem.evidence_refs.some((ref) =>
        ref.includes(decisionItem.source_blocker_repair_item_id),
      ),
      `${decisionItem.id} source blocker evidence ref`,
    );
    assertCondition(
      decisionItem.next_action_refs.length > 0,
      `${decisionItem.id} next action refs`,
    );

    if (decisionItem.review_group === "stream_acceptance_repair") {
      streamDecisionCount += 1;
    } else if (decisionItem.review_group === "runtime_ux_repair") {
      runtimeUxDecisionCount += 1;
    } else if (decisionItem.review_group === "git_history_conformance_repair") {
      gitHistoryDecisionCount += 1;
      assertEqual(
        decisionItem.source_prerequisite_item_id,
        sourceRepairItem.source_prerequisite_item_id,
        `${decisionItem.id} source prerequisite id`,
      );
    } else {
      throw new Error(`${decisionItem.id} has unsupported review group`);
    }
  }

  const acceptedItemCount = countBy(
    decisionRecord.blocker_repair_decision_items,
    (item) => item.accepted === true || item.decision === "accepted",
  );
  const rejectedItemCount = countBy(
    decisionRecord.blocker_repair_decision_items,
    (item) => item.decision === "rejected",
  );
  const needsFollowupItemCount = countBy(
    decisionRecord.blocker_repair_decision_items,
    (item) => item.decision === "needs_followup",
  );
  const implementedItemCount = countBy(
    decisionRecord.blocker_repair_decision_items,
    (item) => item.implemented === true,
  );
  const sourceExecutedCount = countBy(
    sourceRepairItems,
    (item) => item.repair_status === "executed_not_accepted",
  );

  assertEqual(
    decisionRecord.summary.decision_item_count,
    decisionRecord.blocker_repair_decision_items.length,
    "summary decision item count",
  );
  assertEqual(
    decisionRecord.summary.stream_repair_decision_items,
    streamDecisionCount,
    "summary stream decision count",
  );
  assertEqual(
    decisionRecord.summary.runtime_ux_repair_decision_items,
    runtimeUxDecisionCount,
    "summary runtime UX decision count",
  );
  assertEqual(
    decisionRecord.summary.git_history_conformance_decision_items,
    gitHistoryDecisionCount,
    "summary git-history decision count",
  );
  assertEqual(
    decisionRecord.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    decisionRecord.summary.rejected_items,
    rejectedItemCount,
    "summary rejected count",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_items,
    needsFollowupItemCount,
    "summary needs-followup count",
  );
  assertEqual(
    decisionRecord.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    decisionRecord.summary.post_repair_reviewed_items,
    decisionRecord.blocker_repair_decision_items.length,
    "summary post-repair reviewed count",
  );
  assertEqual(
    decisionRecord.summary.source_stream_repair_items,
    streamRepair.repair_items.length,
    "summary source stream count",
  );
  assertEqual(
    decisionRecord.summary.source_runtime_ux_repair_items,
    runtimeUxRepair.repair_items.length,
    "summary source runtime UX count",
  );
  assertEqual(
    decisionRecord.summary.source_a8_repair_items,
    a8Repair.repair_items.length,
    "summary source A8 count",
  );
  assertEqual(
    decisionRecord.summary.source_executed_not_accepted_items,
    sourceExecutedCount,
    "summary source executed count",
  );
  assertEqual(
    decisionRecord.summary.excluded_items,
    decisionRecord.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    decisionRecord.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    decisionRecord.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    decisionRecord.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.219"],
    "next recommended slices",
  );
  if (readinessLedger.slice === "W1.5.218") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.219"],
      "ledger next recommended slices",
    );
  } else {
    const ledgerText = JSON.stringify(readinessLedger);
    assertCondition(
      ledgerText.includes("W1.5.218"),
      "future readiness ledger must retain W1.5.218 evidence",
    );
  }

  return {
    status: decisionRecord.decision_record_status,
    exitP1_1Status: decisionRecord.exit_p1_1_status,
    exitP1_10Status: decisionRecord.exit_p1_10_status,
    decisionItemCount: decisionRecord.blocker_repair_decision_items.length,
    streamRepairDecisionItemCount: streamDecisionCount,
    runtimeUxRepairDecisionItemCount: runtimeUxDecisionCount,
    gitHistoryConformanceDecisionItemCount: gitHistoryDecisionCount,
    acceptedItemCount,
    rejectedItemCount,
    needsFollowupItemCount,
    implementedItemCount,
    sourceExecutedNotAcceptedItemCount: sourceExecutedCount,
    nextRecommendedSlices: decisionRecord.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4BlockerRepairDecisionRecord();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4BlockerRepairDecisionRecord,
};
