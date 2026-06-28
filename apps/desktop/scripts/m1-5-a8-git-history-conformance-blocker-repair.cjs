const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const repairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-blocker-repair.json",
);
const blockerPlanPath = path.join(
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
const prerequisiteEvidencePath = path.join(
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
const runtimeHarnessPath = path.join(repoRoot, "specs", "runtime_harness.md");

const expectedTriggerRows = [
  "workflow_draft_instantiated",
  "workflow_patch_applied_draft",
  "workflow_manual_edit_saved",
  "run_started",
  "attempt_completed_important_node",
  "human_gate_resolved",
  "repair_patch_applied",
  "run_terminal",
  "memory_json_write",
  "references_manifest_change",
];
const expectedCarriedForwardRows = [
  "run_started",
  "attempt_completed_important_node",
  "run_terminal",
  "references_manifest_change",
];
const expectedDeferredRows = [
  "workflow_draft_instantiated",
  "workflow_patch_applied_draft",
  "workflow_manual_edit_saved",
  "human_gate_resolved",
  "repair_patch_applied",
  "memory_json_write",
];
const excludedTrackIds = [
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
];
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
  "user staged content",
  "secure://",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function readText(filePath) {
  return fs.readFileSync(filePath, { encoding: "utf8" });
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

function assertTextIncludes(text, fragment, message) {
  assertCondition(text.includes(fragment), `${message}: missing ${fragment}`);
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

function validateA8GitHistoryConformanceBlockerRepair(options = {}) {
  const repair = readJson(options.repairPath ?? repairPath);
  const blockerPlan = readJson(options.blockerPlanPath ?? blockerPlanPath);
  const postCaptureDecision = readJson(
    options.postCaptureDecisionPath ?? postCaptureDecisionPath,
  );
  const prerequisiteEvidence = readJson(
    options.prerequisiteEvidencePath ?? prerequisiteEvidencePath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const runtimeHarness = readText(
    options.runtimeHarnessPath ?? runtimeHarnessPath,
  );

  assertSanitizedJson(repair, "A8 Git-history conformance blocker repair");
  assertEqual(repair.schema_version, "0.1.0", "schema version");
  assertEqual(repair.milestone, "M1.5", "milestone");
  assertEqual(repair.slice, "W1.5.217", "slice id");
  assertEqual(
    repair.repair_status,
    "a8_git_history_conformance_blocker_repair_executed_not_accepted",
    "repair status",
  );
  assertEqual(repair.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(repair.exit_p1_10_status, "not_ready", "EXIT-P1-10 status");

  assertEqual(blockerPlan.slice, "W1.5.214", "blocker plan source slice");
  assertEqual(
    blockerPlan.plan_status,
    "a4_post_capture_blocker_repair_plan_prepared_not_implemented",
    "blocker plan status",
  );
  assertEqual(
    postCaptureDecision.slice,
    "W1.5.213",
    "post-capture source slice",
  );
  assertEqual(
    prerequisiteEvidence.slice,
    "W1.5.212",
    "A8 prerequisite source slice",
  );
  assertEqual(
    prerequisiteEvidence.evidence_status,
    "a8_git_history_prerequisite_evidence_recorded_not_accepted",
    "A8 prerequisite source status",
  );
  assertEqual(readinessLedger.slice, "W1.5.217", "readiness ledger slice");
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

  assertTextIncludes(
    runtimeHarness,
    "### 8.2 自动 commit / tag 触发点",
    "runtime_harness section 8.2",
  );
  for (const fragment of [
    "WorkflowDraft",
    "WorkflowPatch",
    "chore(workflow): manual edit",
    "chore(run): start",
    "attempt.completed",
    "human.gate_resolved",
    "repair.patch_applied",
    "run-<run_id>-<state>",
    "chore(memory): update v<n> — <topic>",
    "chore(refs): import/enable/disable",
  ]) {
    assertTextIncludes(runtimeHarness, fragment, "runtime_harness trigger row");
  }

  const sourceTrack = blockerPlan.repair_tracks.find(
    (track) => track.id === "TRACK-A8-GIT-HISTORY-CONFORMANCE",
  );
  assertCondition(Boolean(sourceTrack), "source A8 conformance track");
  assertDeepEqual(sourceTrack.fr_ids, ["FR-012"], "source A8 track FR ids");
  assertEqual(sourceTrack.entry_slice, "W1.5.217", "source track entry slice");
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source track status",
  );
  assertEqual(
    repair.track_execution.source_track_id,
    sourceTrack.id,
    "track execution source track",
  );
  assertEqual(
    repair.track_execution.source_track_status,
    sourceTrack.status,
    "track execution source status",
  );
  assertEqual(
    repair.track_execution.execution_status,
    "executed_not_accepted",
    "track execution status",
  );
  assertEqual(
    repair.track_execution.phase_exit_decision_status,
    "not_ready",
    "track phase exit status",
  );
  assertDeepEqual(repair.track_execution.fr_ids, ["FR-012"], "track FR ids");

  assertEqual(
    repair.a8_conformance_evidence_package.source_prerequisite_slice,
    "W1.5.212",
    "conformance package source slice",
  );
  assertEqual(
    repair.a8_conformance_evidence_package.source_prerequisite_status,
    prerequisiteEvidence.evidence_status,
    "conformance package source status",
  );
  assertEqual(
    repair.a8_conformance_evidence_package.runtime_harness_8_2_trigger_count,
    prerequisiteEvidence.summary.runtime_harness_8_2_trigger_count,
    "conformance package trigger count",
  );
  assertEqual(
    repair.a8_conformance_evidence_package
      .evidence_carried_forward_trigger_count,
    prerequisiteEvidence.summary.trigger_evidence_available_items,
    "conformance package carried-forward count",
  );
  assertEqual(
    repair.a8_conformance_evidence_package.explicitly_deferred_trigger_count,
    prerequisiteEvidence.summary.trigger_gap_items,
    "conformance package deferred count",
  );
  assertEqual(
    repair.a8_conformance_evidence_package.source_command_evidence_count,
    prerequisiteEvidence.command_execution_evidence.length,
    "conformance package command evidence count",
  );
  assertEqual(
    repair.a8_conformance_evidence_package.accepted_conformance_rows,
    0,
    "conformance package accepted rows",
  );
  assertEqual(
    repair.a8_conformance_evidence_package.phase_exit_ready,
    false,
    "conformance package phase exit flag",
  );
  for (const flagName of [
    "raw_file_content_recorded",
    "raw_user_staged_content_recorded",
    "raw_path_values_recorded",
    "credential_values_recorded",
  ]) {
    assertEqual(
      repair.a8_conformance_evidence_package[flagName],
      false,
      `${flagName} flag`,
    );
  }

  assertEqual(repair.repair_items.length, 1, "repair item count");
  const repairItem = repair.repair_items[0];
  const sourceBlockerItem = blockerPlan.repair_items.find(
    (item) => item.id === repairItem.source_blocker_repair_item_id,
  );
  const postCaptureItem = postCaptureDecision.post_capture_decision_items.find(
    (item) => item.id === repairItem.source_post_capture_decision_id,
  );
  assertCondition(Boolean(sourceBlockerItem), "source blocker item");
  assertCondition(Boolean(postCaptureItem), "source post-capture item");
  assertEqual(sourceBlockerItem.fr_id, "FR-012", "source blocker FR");
  assertEqual(postCaptureItem.fr_id, "FR-012", "post-capture FR");
  assertEqual(
    sourceBlockerItem.track_id,
    "TRACK-A8-GIT-HISTORY-CONFORMANCE",
    "source blocker track",
  );
  assertEqual(
    sourceBlockerItem.implementation_status,
    "planned_not_implemented",
    "source implementation status",
  );
  assertEqual(
    postCaptureItem.post_capture_decision,
    "needs_followup",
    "post-capture decision",
  );
  assertEqual(
    repairItem.source_prerequisite_item_id,
    prerequisiteEvidence.fr012_prerequisite_item.id,
    "source prerequisite item",
  );
  assertEqual(repairItem.fr_id, "FR-012", "repair item FR");
  assertEqual(
    repairItem.track_id,
    "TRACK-A8-GIT-HISTORY-CONFORMANCE",
    "repair item track",
  );
  assertEqual(
    repairItem.repair_status,
    "executed_not_accepted",
    "repair item status",
  );
  assertEqual(repairItem.accepted, false, "repair item accepted");
  assertEqual(repairItem.implemented, false, "repair item implemented");
  assertEqual(
    repairItem.phase_exit_decision_status,
    "not_ready",
    "repair item phase exit status",
  );
  assertDeepEqual(
    repairItem.source_acceptance_blockers,
    sourceBlockerItem.acceptance_blockers,
    "source acceptance blockers",
  );
  assertCondition(
    repairItem.remaining_acceptance_blockers.some((blocker) =>
      blocker.includes("six runtime_harness.md §8.2 trigger rows"),
    ),
    "remaining blockers mention deferred rows",
  );
  assertCondition(
    repairItem.evidence_refs.some((ref) =>
      ref.includes(repairItem.source_blocker_repair_item_id),
    ),
    "source blocker evidence ref",
  );
  assertCondition(
    repairItem.evidence_refs.some((ref) =>
      ref.includes(repairItem.source_prerequisite_item_id),
    ),
    "source prerequisite evidence ref",
  );

  const matrix = repair.runtime_harness_8_2_conformance_matrix;
  const sourceTriggerRows =
    prerequisiteEvidence.runtime_harness_8_2_trigger_audit.trigger_rows;
  assertEqual(matrix.length, expectedTriggerRows.length, "matrix row count");
  assertDeepEqual(
    matrix.map((row) => row.id),
    expectedTriggerRows,
    "matrix row order",
  );
  assertDeepEqual(
    matrix.map((row) => row.id),
    sourceTriggerRows.map((row) => row.id),
    "source trigger row order",
  );
  for (let index = 0; index < matrix.length; index += 1) {
    const row = matrix[index];
    const sourceRow = sourceTriggerRows[index];
    assertEqual(row.trigger, sourceRow.trigger, `${row.id} trigger`);
    assertEqual(
      row.expected_commit_message,
      sourceRow.expected_commit_message,
      `${row.id} commit message`,
    );
    assertEqual(row.expected_tag, sourceRow.expected_tag, `${row.id} tag`);
    assertEqual(
      row.source_evidence_status,
      sourceRow.evidence_status,
      `${row.id} source evidence status`,
    );
    assertEqual(row.accepted, false, `${row.id} accepted`);
    assertEqual(row.implemented, false, `${row.id} implemented`);
    if (
      row.conformance_disposition ===
      "evidence_carried_forward_not_phase_accepted"
    ) {
      assertCondition(
        expectedCarriedForwardRows.includes(row.id),
        `${row.id} carried-forward membership`,
      );
      assertCondition(row.evidence_refs.length > 0, `${row.id} evidence refs`);
    } else {
      assertEqual(
        row.conformance_disposition,
        "explicitly_deferred_not_implemented",
        `${row.id} deferred disposition`,
      );
      assertCondition(
        expectedDeferredRows.includes(row.id),
        `${row.id} deferred membership`,
      );
      assertCondition(
        typeof row.deferred_reason === "string" &&
          row.deferred_reason.length > 0,
        `${row.id} deferred reason`,
      );
    }
  }
  assertDeepEqual(
    sorted(
      matrix
        .filter(
          (row) =>
            row.conformance_disposition ===
            "evidence_carried_forward_not_phase_accepted",
        )
        .map((row) => row.id),
    ),
    sorted(expectedCarriedForwardRows),
    "carried-forward rows",
  );
  assertDeepEqual(
    sorted(
      matrix
        .filter(
          (row) =>
            row.conformance_disposition ===
            "explicitly_deferred_not_implemented",
        )
        .map((row) => row.id),
    ),
    sorted(expectedDeferredRows),
    "deferred rows",
  );

  assertEqual(
    repair.runtime_harness_8_3_8_4_boundary.hook_audit_status,
    prerequisiteEvidence.runtime_harness_8_3_hook_audit.audit_status,
    "hook boundary status",
  );
  assertEqual(
    repair.runtime_harness_8_3_8_4_boundary.invariant_audit_status,
    prerequisiteEvidence.runtime_harness_8_4_invariant_audit.audit_status,
    "invariant boundary status",
  );
  assertCondition(
    repair.runtime_harness_8_3_8_4_boundary.remaining_gap.length > 0,
    "8.3/8.4 boundary remaining gaps",
  );

  const acceptedItemCount = countBy(
    repair.repair_items,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    repair.repair_items,
    (item) => item.implemented === true,
  );
  const executedItemCount = countBy(
    repair.repair_items,
    (item) => item.repair_status === "executed_not_accepted",
  );

  assertEqual(
    repair.summary.repair_item_count,
    repair.repair_items.length,
    "summary repair count",
  );
  assertEqual(
    repair.summary.a8_conformance_repair_items,
    1,
    "summary A8 repair count",
  );
  assertEqual(
    repair.summary.stream_acceptance_repair_items,
    0,
    "summary stream repair count",
  );
  assertEqual(
    repair.summary.runtime_ux_repair_items,
    0,
    "summary runtime UX count",
  );
  assertEqual(
    repair.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    repair.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    repair.summary.executed_not_accepted_items,
    executedItemCount,
    "summary executed count",
  );
  assertEqual(
    repair.summary.runtime_harness_8_2_trigger_count,
    expectedTriggerRows.length,
    "summary trigger count",
  );
  assertEqual(
    repair.summary.evidence_carried_forward_trigger_count,
    expectedCarriedForwardRows.length,
    "summary carried-forward count",
  );
  assertEqual(
    repair.summary.explicitly_deferred_trigger_count,
    expectedDeferredRows.length,
    "summary deferred count",
  );
  assertEqual(
    repair.summary.source_trigger_gap_items,
    prerequisiteEvidence.summary.trigger_gap_items,
    "summary source trigger gap count",
  );
  assertEqual(
    repair.summary.phase_conformance_accepted_items,
    0,
    "summary accepted conformance count",
  );
  assertEqual(
    repair.summary.source_command_evidence_items,
    prerequisiteEvidence.command_execution_evidence.length,
    "summary command evidence count",
  );
  assertEqual(
    repair.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    repair.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertEqual(
    repair.summary.excluded_items,
    repair.excluded_items.length,
    "summary excluded count",
  );
  assertDeepEqual(
    sorted(
      repair.excluded_items
        .filter((item) => item.track_id !== undefined)
        .map((item) => item.track_id),
    ),
    sorted(excludedTrackIds),
    "excluded track ids",
  );
  assertDeepEqual(
    repair.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    ["FR-015"],
    "excluded FR ids",
  );
  assertDeepEqual(
    repair.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.218"],
    "next recommended slices",
  );
  assertDeepEqual(
    readinessLedger.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.218"],
    "readiness ledger next recommended slices",
  );

  return {
    status: repair.repair_status,
    exitP1_1Status: repair.exit_p1_1_status,
    exitP1_10Status: repair.exit_p1_10_status,
    repairItemCount: repair.repair_items.length,
    acceptedItemCount,
    implementedItemCount,
    executedNotAcceptedItemCount: executedItemCount,
    runtimeHarnessTriggerCount:
      repair.summary.runtime_harness_8_2_trigger_count,
    evidenceCarriedForwardTriggerCount:
      repair.summary.evidence_carried_forward_trigger_count,
    explicitlyDeferredTriggerCount:
      repair.summary.explicitly_deferred_trigger_count,
    phaseConformanceAcceptedItems:
      repair.summary.phase_conformance_accepted_items,
    nextRecommendedSlices: repair.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA8GitHistoryConformanceBlockerRepair();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA8GitHistoryConformanceBlockerRepair,
};
