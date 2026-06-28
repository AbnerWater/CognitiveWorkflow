const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const evidencePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-prerequisite-evidence.json",
);
const repairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-needs-followup-repair-plan.json",
);
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-decision-record.json",
);
const sourceCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-capture-execution.json",
);
const runtimeBridgeCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-bridge-user-path-capture.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const runtimeHarnessPath = path.join(repoRoot, "specs", "runtime_harness.md");
const projectHarnessSourcePath = path.join(
  repoRoot,
  "apps",
  "runtime",
  "src",
  "cw_runtime",
  "harness",
  "project.py",
);
const runtimeStoreSourcePath = path.join(
  repoRoot,
  "apps",
  "runtime",
  "src",
  "cw_runtime",
  "persistence",
  "runtime_store.py",
);

const expectedRuntimeHarnessTriggerRows = [
  {
    id: "workflow_draft_instantiated",
    trigger: "WorkflowDraft 实例化为正式 Workflow",
    expected_commit_message:
      "chore(workflow): instantiate <workflow_id> v<ver>",
    expected_tag: "workflow-<id>-v<ver>",
  },
  {
    id: "workflow_patch_applied_draft",
    trigger: "WorkflowPatch 应用（草案阶段）",
    expected_commit_message:
      "chore(planning): apply patch <patch_id> to draft v<n>",
    expected_tag: null,
  },
  {
    id: "workflow_manual_edit_saved",
    trigger: "Workflow 内手动编辑保存",
    expected_commit_message: "chore(workflow): manual edit v<ver+0.0.1>",
    expected_tag: "workflow-<id>-v<ver+0.0.1>",
  },
  {
    id: "run_started",
    trigger: "RunStarted",
    expected_commit_message:
      "chore(run): start <run_id> on workflow <id> v<ver>",
    expected_tag: null,
  },
  {
    id: "attempt_completed_important_node",
    trigger: "attempt.completed（重要节点）",
    expected_commit_message:
      "snapshot(run/<run_id>): node <node_id> attempt <idx>",
    expected_tag: null,
  },
  {
    id: "human_gate_resolved",
    trigger: "human.gate_resolved",
    expected_commit_message:
      "chore(human): decision on <human_node_id> by <user>",
    expected_tag: null,
  },
  {
    id: "repair_patch_applied",
    trigger: "repair.patch_applied",
    expected_commit_message: "chore(repair): apply <patch_id> on <node_id>",
    expected_tag: null,
  },
  {
    id: "run_terminal",
    trigger: "run.completed / run.failed / run.cancelled",
    expected_commit_message: "chore(run): end <run_id> state=<state>",
    expected_tag: "run-<run_id>-<state>",
  },
  {
    id: "memory_json_write",
    trigger: "memory.json 写入",
    expected_commit_message: "chore(memory): update v<n> — <topic>",
    expected_tag: null,
  },
  {
    id: "references_manifest_change",
    trigger: "references.manifest.json 变更",
    expected_commit_message:
      "chore(refs): import/enable/disable <reference_id>",
    expected_tag: null,
  },
];
const expectedTriggerRows = expectedRuntimeHarnessTriggerRows.map(
  (row) => row.id,
);
const evidenceAvailableTriggerRows = [
  "run_started",
  "attempt_completed_important_node",
  "run_terminal",
  "references_manifest_change",
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
  "rawFileContent",
  "rawUploadedFileBytes",
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

function validateA8GitHistoryPrerequisiteEvidence(options = {}) {
  const evidence = readJson(options.evidencePath ?? evidencePath);
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const sourceCapture = readJson(
    options.sourceCapturePath ?? sourceCapturePath,
  );
  const runtimeBridgeCapture = readJson(
    options.runtimeBridgeCapturePath ?? runtimeBridgeCapturePath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const runtimeHarness = readText(
    options.runtimeHarnessPath ?? runtimeHarnessPath,
  );
  const projectHarnessSource = readText(
    options.projectHarnessSourcePath ?? projectHarnessSourcePath,
  );
  const runtimeStoreSource = readText(
    options.runtimeStoreSourcePath ?? runtimeStoreSourcePath,
  );

  assertSanitizedJson(evidence, "A8 Git-history prerequisite evidence");
  assertEqual(evidence.schema_version, "0.1.0", "schema version");
  assertEqual(evidence.milestone, "M1.5", "milestone");
  assertEqual(evidence.slice, "W1.5.212", "slice id");
  assertEqual(
    evidence.evidence_status,
    "a8_git_history_prerequisite_evidence_recorded_not_accepted",
    "evidence status",
  );
  assertEqual(evidence.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(evidence.exit_p1_10_status, "not_ready", "EXIT-P1-10 status");

  assertEqual(repairPlan.slice, "W1.5.209", "repair plan source slice");
  assertEqual(decisionRecord.slice, "W1.5.208", "decision source slice");
  assertEqual(
    sourceCapture.capture_status,
    "a4_capture_executed_not_accepted",
    "source capture status",
  );
  assertEqual(
    runtimeBridgeCapture.capture_status,
    "a4_runtime_bridge_user_path_capture_executed_not_accepted",
    "runtime bridge capture source status",
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

  const sourceTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-A8-GIT-HISTORY-PREREQ",
  );
  assertCondition(Boolean(sourceTrack), "source A8 track exists");
  assertDeepEqual(sourceTrack.fr_ids, ["FR-012"], "source A8 FR ids");
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source A8 track status",
  );
  assertEqual(sourceTrack.entry_slice, "W1.5.212", "source A8 entry slice");
  assertEqual(
    evidence.track_execution.source_track_id,
    "TRACK-A8-GIT-HISTORY-PREREQ",
    "track execution source track id",
  );
  assertDeepEqual(evidence.track_execution.fr_ids, ["FR-012"], "track FR ids");
  assertEqual(
    evidence.track_execution.execution_status,
    "audit_evidence_recorded_not_accepted",
    "track execution status",
  );

  const repairItem = repairPlan.repair_items.find(
    (item) => item.id === evidence.fr012_prerequisite_item.repair_item_id,
  );
  const decisionItem = decisionRecord.decision_items.find(
    (item) => item.id === evidence.fr012_prerequisite_item.source_decision_id,
  );
  const sourceCaptureItem = sourceCapture.review_item_captures.find(
    (item) => item.id === evidence.fr012_prerequisite_item.source_capture_id,
  );
  assertCondition(Boolean(repairItem), "FR-012 repair item exists");
  assertCondition(Boolean(decisionItem), "FR-012 decision item exists");
  assertCondition(Boolean(sourceCaptureItem), "FR-012 source capture exists");
  assertEqual(repairItem.fr_id, "FR-012", "repair FR id");
  assertEqual(decisionItem.fr_id, "FR-012", "decision FR id");
  assertEqual(sourceCaptureItem.fr_id, "FR-012", "source capture FR id");
  assertEqual(
    repairItem.track_id,
    "TRACK-A8-GIT-HISTORY-PREREQ",
    "FR-012 repair track",
  );
  assertEqual(
    evidence.fr012_prerequisite_item.a8_evidence_status,
    "audit_evidence_recorded_not_accepted",
    "FR-012 A8 evidence status",
  );
  assertEqual(
    evidence.fr012_prerequisite_item.source_decision,
    "needs_followup",
    "FR-012 source decision",
  );
  assertEqual(decisionItem.decision, "needs_followup", "FR-012 decision");
  assertEqual(
    evidence.fr012_prerequisite_item.source_repair_status,
    "planned_not_implemented",
    "FR-012 repair status",
  );
  assertEqual(
    repairItem.implementation_status,
    "planned_not_implemented",
    "FR-012 source repair status",
  );
  assertEqual(
    evidence.fr012_prerequisite_item.source_capture_status,
    "captured_not_accepted",
    "FR-012 source capture status",
  );
  assertEqual(
    sourceCaptureItem.capture_status,
    "captured_not_accepted",
    "FR-012 source capture item status",
  );
  assertEqual(
    evidence.fr012_prerequisite_item.accepted,
    false,
    "FR-012 accepted flag",
  );
  assertEqual(
    evidence.fr012_prerequisite_item.reviewer_decision_required,
    true,
    "FR-012 reviewer flag",
  );
  assertDeepEqual(
    evidence.fr012_prerequisite_item.observed_a4_evidence_inputs,
    sourceCaptureItem.observed_a4_evidence_inputs,
    "FR-012 observed A4 inputs",
  );
  assertDeepEqual(
    evidence.fr012_prerequisite_item.source_acceptance_blockers,
    decisionItem.acceptance_blockers,
    "FR-012 acceptance blockers",
  );

  assertTextIncludes(
    runtimeHarness,
    "### 8.1 初始化",
    "runtime harness init section",
  );
  assertTextIncludes(
    runtimeHarness,
    "chore(cw): initialize CognitiveWorkflow project <project_id>",
    "runtime harness initial commit message",
  );
  assertTextIncludes(
    runtimeHarness,
    "### 8.2 自动 commit / tag 触发点",
    "runtime harness trigger table",
  );
  assertTextIncludes(
    runtimeHarness,
    "WorkflowDraft",
    "runtime harness WorkflowDraft row",
  );
  assertTextIncludes(
    runtimeHarness,
    "WorkflowPatch",
    "runtime harness WorkflowPatch row",
  );
  assertTextIncludes(
    runtimeHarness,
    "chore(run): start",
    "runtime harness run start row",
  );
  assertTextIncludes(
    runtimeHarness,
    "attempt.completed",
    "runtime harness attempt row",
  );
  assertTextIncludes(
    runtimeHarness,
    "human.gate_resolved",
    "runtime harness human row",
  );
  assertTextIncludes(
    runtimeHarness,
    "repair.patch_applied",
    "runtime harness repair row",
  );
  assertTextIncludes(
    runtimeHarness,
    "run-<run_id>-<state>",
    "runtime harness run tag row",
  );
  assertTextIncludes(
    runtimeHarness,
    "chore(memory): update v<n> — <topic>",
    "runtime harness memory row",
  );
  assertTextIncludes(
    runtimeHarness,
    "chore(refs): import/enable/disable",
    "runtime harness refs row",
  );
  assertTextIncludes(
    runtimeHarness,
    "### 8.3 安全约束",
    "runtime harness hook section",
  );
  assertTextIncludes(
    runtimeHarness,
    "### 8.4 不变量",
    "runtime harness invariant section",
  );

  assertTextIncludes(
    projectHarnessSource,
    "_initialize_git_and_commit",
    "project init source",
  );
  assertTextIncludes(
    projectHarnessSource,
    "_install_pre_commit_hook",
    "pre-commit source",
  );
  assertTextIncludes(
    projectHarnessSource,
    "_commit_reference_manifest_change_locked",
    "reference commit source",
  );
  assertTextIncludes(
    projectHarnessSource,
    "_stash_staged_changes",
    "reference staged stash source",
  );
  assertTextIncludes(
    runtimeStoreSource,
    "create_git_snapshot_locked",
    "runtime git snapshot source",
  );
  assertTextIncludes(
    runtimeStoreSource,
    "chore(run): start",
    "runtime run start source",
  );
  assertTextIncludes(
    runtimeStoreSource,
    "snapshot(run/",
    "runtime attempt snapshot source",
  );
  assertTextIncludes(
    runtimeStoreSource,
    "run-{run_id}-{state}",
    "runtime terminal tag source",
  );

  assertEqual(
    evidence.command_execution_evidence.length,
    5,
    "command evidence count",
  );
  for (const commandEvidence of evidence.command_execution_evidence) {
    assertEqual(
      commandEvidence.execution_status,
      "executed_passed",
      `${commandEvidence.id} execution status`,
    );
    assertEqual(
      commandEvidence.accepted,
      false,
      `${commandEvidence.id} accepted`,
    );
    assertEqual(
      commandEvidence.raw_stdout_stderr_retained,
      false,
      `${commandEvidence.id} raw output flag`,
    );
    assertCondition(
      commandEvidence.command.length > 0,
      `${commandEvidence.id} command`,
    );
    assertCondition(
      commandEvidence.applies_to.length > 0,
      `${commandEvidence.id} applies_to`,
    );
  }

  const triggerRows = evidence.runtime_harness_8_2_trigger_audit.trigger_rows;
  assertEqual(triggerRows.length, 10, "runtime_harness §8.2 trigger count");
  assertDeepEqual(
    triggerRows.map((row) => row.id),
    expectedTriggerRows,
    "runtime_harness §8.2 trigger order",
  );
  for (
    let index = 0;
    index < expectedRuntimeHarnessTriggerRows.length;
    index += 1
  ) {
    const row = triggerRows[index];
    const expectedRow = expectedRuntimeHarnessTriggerRows[index];
    assertEqual(row.id, expectedRow.id, `${expectedRow.id} trigger id`);
    assertEqual(
      row.trigger,
      expectedRow.trigger,
      `${expectedRow.id} trigger label`,
    );
    assertEqual(
      row.expected_commit_message,
      expectedRow.expected_commit_message,
      `${expectedRow.id} commit message`,
    );
    assertEqual(
      row.expected_tag,
      expectedRow.expected_tag,
      `${expectedRow.id} expected tag`,
    );
  }
  const availableRows = triggerRows
    .filter((row) => row.evidence_status === "evidence_available")
    .map((row) => row.id);
  assertDeepEqual(
    sorted(availableRows),
    sorted(evidenceAvailableTriggerRows),
    "evidence available trigger rows",
  );
  for (const row of triggerRows) {
    assertCondition(
      row.expected_commit_message.length > 0,
      `${row.id} commit message`,
    );
    if (row.evidence_status === "evidence_available") {
      assertEqual(row.remaining_gap, null, `${row.id} remaining gap`);
      assertCondition(row.evidence_refs.length > 0, `${row.id} evidence refs`);
    } else {
      assertCondition(
        typeof row.remaining_gap === "string" && row.remaining_gap.length > 0,
        `${row.id} remaining gap`,
      );
    }
  }

  assertEqual(
    evidence.runtime_harness_8_3_hook_audit.audit_status,
    "partial_evidence_recorded_not_phase_exit_ready",
    "hook audit status",
  );
  assertEqual(
    evidence.runtime_harness_8_4_invariant_audit.audit_status,
    "partial_evidence_recorded_not_phase_exit_ready",
    "invariant audit status",
  );
  assertCondition(
    evidence.excluded_items.some(
      (item) => item.track_id === "TRACK-A4-STREAM-PHASE-CAPTURE",
    ),
    "stream track excluded item",
  );
  assertCondition(
    evidence.excluded_items.some(
      (item) => item.track_id === "TRACK-A4-RUNTIME-BRIDGE-CAPTURE",
    ),
    "runtime bridge track excluded item",
  );
  assertCondition(
    evidence.excluded_items.some((item) => item.fr_id === "FR-015"),
    "FR-015 excluded item",
  );

  assertEqual(evidence.summary.fr_id, "FR-012", "summary FR id");
  assertEqual(evidence.summary.a8_prerequisite_items, 1, "summary item count");
  assertEqual(
    evidence.summary.runtime_harness_8_2_trigger_count,
    triggerRows.length,
    "summary trigger count",
  );
  assertEqual(
    evidence.summary.trigger_evidence_available_items,
    evidenceAvailableTriggerRows.length,
    "summary trigger evidence available count",
  );
  assertEqual(
    evidence.summary.trigger_gap_items,
    6,
    "summary trigger gap count",
  );
  assertEqual(evidence.summary.accepted_items, 0, "summary accepted");
  assertEqual(evidence.summary.implemented_items, 0, "summary implemented");
  assertEqual(
    evidence.summary.pending_a4_review_items,
    1,
    "summary pending A4",
  );
  assertEqual(
    evidence.summary.source_needs_followup_items,
    1,
    "summary needs-followup",
  );
  assertEqual(evidence.summary.source_repair_items, 1, "summary repair items");
  assertEqual(
    evidence.summary.command_evidence_count,
    evidence.command_execution_evidence.length,
    "summary command evidence count",
  );
  assertEqual(
    evidence.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    evidence.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    evidence.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.213"],
    "next recommended slices",
  );

  return {
    status: evidence.evidence_status,
    exitP1_1Status: evidence.exit_p1_1_status,
    exitP1_10Status: evidence.exit_p1_10_status,
    frId: evidence.summary.fr_id,
    acceptedItemCount: evidence.summary.accepted_items,
    implementedItemCount: evidence.summary.implemented_items,
    triggerCount: evidence.summary.runtime_harness_8_2_trigger_count,
    triggerEvidenceAvailableCount:
      evidence.summary.trigger_evidence_available_items,
    triggerGapCount: evidence.summary.trigger_gap_items,
    commandEvidenceCount: evidence.summary.command_evidence_count,
    nextRecommendedSlices: evidence.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA8GitHistoryPrerequisiteEvidence();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = { validateA8GitHistoryPrerequisiteEvidence };
