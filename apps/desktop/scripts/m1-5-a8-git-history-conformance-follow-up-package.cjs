const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const gitHistoryFollowUpPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-follow-up-package.json",
);
const blockerFollowUpPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-follow-up-plan.json",
);
const blockerDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-repair-decision-record.json",
);
const gitHistoryRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-blocker-repair.json",
);
const gitHistoryPrerequisitePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-prerequisite-evidence.json",
);
const runtimeHarnessPath = path.join(repoRoot, "specs", "runtime_harness.md");
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedGitHistoryFrIds = ["FR-012"];
const expectedTriggerIds = [
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
const expectedCarriedForwardTriggerIds = [
  "attempt_completed_important_node",
  "references_manifest_change",
  "run_started",
  "run_terminal",
];
const expectedDeferredTriggerIds = [
  "human_gate_resolved",
  "memory_json_write",
  "repair_patch_applied",
  "workflow_draft_instantiated",
  "workflow_manual_edit_saved",
  "workflow_patch_applied_draft",
];
const excludedTrackIds = [
  "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP",
  "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
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
  "raw_file_content",
  "rawCustomValue",
  "raw_custom_value",
  "rawCredentialValue",
  "raw_credential_value",
  "customValue",
  "custom_value",
  "instructionText",
  "instruction_text",
  "destinationPath",
  "destination_path",
  "cachePath",
  "cache_path",
  "prompt_to_user",
  "user staged content",
  "secure://",
  "cache://",
];
const forbiddenPatterns = [
  /[a-z]:\\\\/iu,
  /[a-z]:\//iu,
  /\\\\users\\\\/iu,
  /\/users\//iu,
  /\\\\appdata\\\\/iu,
  /\/appdata\//iu,
  /(^|[^a-z0-9_-])cache\/[a-z0-9_.-]+/iu,
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
  const lowerText = text.toLowerCase();
  for (const fragment of forbiddenFragments) {
    assertCondition(
      !lowerText.includes(fragment.toLowerCase()),
      `${label} must not contain forbidden fragment ${fragment}`,
    );
  }
  for (const pattern of forbiddenPatterns) {
    assertCondition(
      !pattern.test(text),
      `${label} must not contain forbidden pattern ${pattern}`,
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

function mapById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function validateA8GitHistoryConformanceFollowUpPackage(options = {}) {
  const followUpPackage = readJson(
    options.gitHistoryFollowUpPackagePath ?? gitHistoryFollowUpPackagePath,
  );
  const followUpPlan = readJson(
    options.blockerFollowUpPlanPath ?? blockerFollowUpPlanPath,
  );
  const decisionRecord = readJson(
    options.blockerDecisionRecordPath ?? blockerDecisionRecordPath,
  );
  const gitHistoryRepair = readJson(
    options.gitHistoryRepairPath ?? gitHistoryRepairPath,
  );
  const gitHistoryPrerequisite = readJson(
    options.gitHistoryPrerequisitePath ?? gitHistoryPrerequisitePath,
  );
  const runtimeHarness = fs.readFileSync(
    options.runtimeHarnessPath ?? runtimeHarnessPath,
    { encoding: "utf8" },
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );

  assertSanitizedJson(
    followUpPackage,
    "A8 Git-history conformance follow-up package",
  );
  assertEqual(followUpPackage.schema_version, "0.1.0", "schema version");
  assertEqual(followUpPackage.milestone, "M1.5", "milestone");
  assertEqual(followUpPackage.slice, "W1.5.222", "slice id");
  assertEqual(
    followUpPackage.package_status,
    "a8_git_history_conformance_follow_up_package_packaged_not_accepted",
    "package status",
  );
  assertEqual(followUpPackage.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(followUpPackage.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertEqual(
    followUpPackage.runner_contract.runner_script,
    "apps/desktop/scripts/m1-5-a8-git-history-conformance-follow-up-package.cjs",
    "runner script",
  );
  assertEqual(
    followUpPackage.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a8-git-history-conformance-follow-up-package.cjs --check",
    "focused check command",
  );
  assertEqual(
    followUpPackage.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a8-git-history-conformance-follow-up-package.test.cjs",
    "focused test command",
  );
  assertEqual(
    followUpPackage.runner_contract.standard_desktop_test,
    "pnpm --filter @cw/desktop run test",
    "standard desktop test command",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a8-git-history-conformance-follow-up-package.test.cjs",
    ),
    "desktop package gate wiring",
  );

  assertEqual(followUpPlan.slice, "W1.5.219", "follow-up plan slice");
  assertEqual(
    followUpPlan.plan_status,
    "a4_blocker_follow_up_plan_prepared_not_implemented",
    "follow-up plan status",
  );
  assertEqual(decisionRecord.slice, "W1.5.218", "decision record slice");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_blocker_repair_reviewer_decisions_recorded_needs_followup",
    "decision record status",
  );
  assertEqual(gitHistoryRepair.slice, "W1.5.217", "A8 repair slice");
  assertEqual(
    gitHistoryRepair.repair_status,
    "a8_git_history_conformance_blocker_repair_executed_not_accepted",
    "A8 repair status",
  );
  assertEqual(
    gitHistoryPrerequisite.slice,
    "W1.5.212",
    "A8 prerequisite slice",
  );
  assertEqual(
    gitHistoryPrerequisite.evidence_status,
    "a8_git_history_prerequisite_evidence_recorded_not_accepted",
    "A8 prerequisite evidence status",
  );
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.222",
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
  if (readinessLedger.slice === "W1.5.222") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.223"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.222"),
      "future readiness ledger must retain W1.5.222 evidence",
    );
  }

  const sourceTrack = followUpPlan.follow_up_tracks.find(
    (track) => track.id === "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP",
  );
  assertCondition(Boolean(sourceTrack), "source A8 follow-up track");
  assertDeepEqual(
    sorted(sourceTrack.fr_ids),
    sorted(expectedGitHistoryFrIds),
    "source track FR ids",
  );
  assertEqual(sourceTrack.entry_slice, "W1.5.222", "source track entry slice");
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source track status",
  );
  assertEqual(
    followUpPackage.track_execution.source_track_id,
    sourceTrack.id,
    "track execution source track",
  );
  assertEqual(
    followUpPackage.track_execution.source_track_status,
    sourceTrack.status,
    "track execution source status",
  );
  assertEqual(
    followUpPackage.track_execution.execution_status,
    "packaged_not_accepted",
    "track execution status",
  );
  assertDeepEqual(
    sorted(followUpPackage.track_execution.fr_ids),
    sorted(expectedGitHistoryFrIds),
    "track execution FR ids",
  );
  assertEqual(
    followUpPackage.track_execution.phase_exit_decision_status,
    "not_ready",
    "track phase exit decision status",
  );

  for (const flag of [
    "phase_exit_decision_recorded",
    "file_content_retained",
    "user_staged_content_retained",
    "path_values_retained",
    "credential_values_recorded",
  ]) {
    assertEqual(
      followUpPackage.a8_follow_up_package[flag],
      false,
      `A8 follow-up ${flag}`,
    );
  }
  assertEqual(
    followUpPackage.a8_follow_up_package.accepted_conformance_rows,
    0,
    "accepted conformance rows",
  );

  const sourceFollowUpItems = followUpPlan.follow_up_items.filter(
    (item) => item.track_id === "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP",
  );
  const sourceFollowUpItemsById = mapById(sourceFollowUpItems);
  const decisionItemsById = mapById(
    decisionRecord.blocker_repair_decision_items,
  );
  const gitHistoryRepairItemsById = mapById(gitHistoryRepair.repair_items);
  const prerequisiteItem = gitHistoryPrerequisite.fr012_prerequisite_item;

  assertEqual(followUpPackage.package_items.length, 1, "package item count");
  assertDeepEqual(
    sorted(followUpPackage.package_items.map((item) => item.fr_id)),
    expectedGitHistoryFrIds,
    "package FR ids",
  );
  assertDeepEqual(
    sorted(
      followUpPackage.package_items.map(
        (item) => item.source_follow_up_item_id,
      ),
    ),
    sorted(sourceFollowUpItems.map((item) => item.id)),
    "source follow-up item ids",
  );

  const packageItem = followUpPackage.package_items[0];
  const sourceFollowUpItem = sourceFollowUpItemsById.get(
    packageItem.source_follow_up_item_id,
  );
  const decisionItem = decisionItemsById.get(
    packageItem.source_blocker_repair_decision_id,
  );
  const gitHistoryRepairItem = gitHistoryRepairItemsById.get(
    packageItem.source_repair_item_id,
  );

  assertCondition(Boolean(sourceFollowUpItem), "source follow-up item");
  assertCondition(Boolean(decisionItem), "source decision item");
  assertCondition(Boolean(gitHistoryRepairItem), "source A8 repair item");
  assertEqual(
    packageItem.source_prerequisite_item_id,
    prerequisiteItem.id,
    "source prerequisite item id",
  );
  assertEqual(
    decisionItem.source_repair_item_id,
    packageItem.source_repair_item_id,
    "decision repair mapping",
  );
  assertEqual(
    decisionItem.source_prerequisite_item_id,
    packageItem.source_prerequisite_item_id,
    "decision prerequisite mapping",
  );
  assertEqual(
    gitHistoryRepairItem.source_prerequisite_item_id,
    packageItem.source_prerequisite_item_id,
    "repair prerequisite mapping",
  );
  assertEqual(packageItem.fr_id, sourceFollowUpItem.fr_id, "follow-up FR");
  assertEqual(packageItem.fr_id, decisionItem.fr_id, "decision FR");
  assertEqual(packageItem.fr_id, gitHistoryRepairItem.fr_id, "repair FR");
  assertEqual(packageItem.fr_id, prerequisiteItem.fr_id, "prerequisite FR");
  assertEqual(
    packageItem.review_group,
    "git_history_conformance_repair",
    "review group",
  );
  assertEqual(
    packageItem.review_group,
    sourceFollowUpItem.review_group,
    "copied review group",
  );
  assertEqual(
    packageItem.decision_owner,
    sourceFollowUpItem.decision_owner,
    "copied decision owner",
  );
  assertEqual(
    packageItem.package_status,
    "packaged_not_accepted",
    "package item status",
  );
  assertEqual(
    packageItem.source_follow_up_status,
    sourceFollowUpItem.follow_up_status,
    "source follow-up status",
  );
  assertEqual(
    packageItem.source_follow_up_status,
    "planned_not_implemented",
    "planned source follow-up status",
  );
  assertEqual(packageItem.source_decision, decisionItem.decision, "decision");
  assertEqual(packageItem.source_decision, "needs_followup", "source decision");
  assertEqual(
    packageItem.source_repair_status,
    gitHistoryRepairItem.repair_status,
    "source repair status",
  );
  assertEqual(
    packageItem.source_repair_status,
    "executed_not_accepted",
    "executed source repair status",
  );
  assertEqual(
    packageItem.source_prerequisite_status,
    prerequisiteItem.a8_evidence_status,
    "source prerequisite status",
  );
  assertEqual(packageItem.accepted, false, "package item accepted");
  assertEqual(packageItem.implemented, false, "package item implemented");
  assertEqual(
    packageItem.reviewer_decision_required,
    true,
    "reviewer decision required",
  );
  assertEqual(
    packageItem.phase_exit_decision_status,
    "not_ready",
    "package item phase decision status",
  );
  assertDeepEqual(
    packageItem.remaining_acceptance_blockers,
    sourceFollowUpItem.acceptance_blockers,
    "remaining acceptance blockers",
  );
  assertCondition(
    packageItem.package_actions_executed.length > 0,
    "package actions",
  );
  for (const sourceId of [
    packageItem.source_follow_up_item_id,
    packageItem.source_blocker_repair_decision_id,
    packageItem.source_repair_item_id,
    packageItem.source_prerequisite_item_id,
  ]) {
    assertCondition(
      packageItem.evidence_refs.some((ref) => ref.includes(sourceId)),
      `package evidence ref for ${sourceId}`,
    );
  }

  const sourcePrerequisiteRowsById = mapById(
    gitHistoryPrerequisite.runtime_harness_8_2_trigger_audit.trigger_rows,
  );
  const sourceRepairRowsById = mapById(
    gitHistoryRepair.runtime_harness_8_2_conformance_matrix,
  );
  const followUpRows = followUpPackage.runtime_harness_8_2_follow_up_matrix;

  assertDeepEqual(
    followUpRows.map((row) => row.id),
    expectedTriggerIds,
    "trigger row order",
  );
  for (const row of followUpRows) {
    const prerequisiteRow = sourcePrerequisiteRowsById.get(row.id);
    const repairRow = sourceRepairRowsById.get(row.id);
    assertCondition(Boolean(prerequisiteRow), `${row.id} prerequisite row`);
    assertCondition(Boolean(repairRow), `${row.id} repair matrix row`);
    assertCondition(
      runtimeHarness.includes(row.expected_commit_message),
      `${row.id} runtime_harness commit message`,
    );
    if (row.expected_tag !== null && row.expected_tag !== undefined) {
      assertCondition(
        runtimeHarness.includes(row.expected_tag),
        `${row.id} runtime_harness tag text`,
      );
    }
    assertEqual(row.trigger, repairRow.trigger, `${row.id} repair trigger`);
    assertEqual(
      row.expected_commit_message,
      repairRow.expected_commit_message,
      `${row.id} repair commit message`,
    );
    assertEqual(
      row.expected_tag ?? null,
      repairRow.expected_tag ?? null,
      `${row.id} repair expected tag`,
    );
    assertEqual(
      row.source_evidence_status,
      repairRow.source_evidence_status,
      `${row.id} repair source evidence status`,
    );
    assertEqual(
      row.source_evidence_status,
      prerequisiteRow.evidence_status,
      `${row.id} prerequisite evidence status`,
    );
    assertEqual(
      row.conformance_disposition,
      repairRow.conformance_disposition,
      `${row.id} conformance disposition`,
    );
    assertEqual(row.accepted, false, `${row.id} accepted`);
    assertEqual(row.implemented, false, `${row.id} implemented`);
    if (
      row.conformance_disposition ===
      "evidence_carried_forward_not_phase_accepted"
    ) {
      assertCondition(
        Array.isArray(row.evidence_refs) && row.evidence_refs.length > 0,
        `${row.id} carried-forward evidence refs`,
      );
      assertDeepEqual(
        row.evidence_refs,
        repairRow.evidence_refs,
        `${row.id} carried-forward refs mirror repair`,
      );
    } else {
      assertEqual(
        row.conformance_disposition,
        "explicitly_deferred_not_implemented",
        `${row.id} deferred disposition`,
      );
      assertCondition(
        typeof row.deferred_reason === "string" &&
          row.deferred_reason.length > 0,
        `${row.id} deferred reason`,
      );
      assertCondition(
        row.deferred_reason.includes("W1.5.222"),
        `${row.id} deferred reason slice`,
      );
    }
  }

  const carriedForwardRows = followUpRows.filter(
    (row) =>
      row.conformance_disposition ===
      "evidence_carried_forward_not_phase_accepted",
  );
  const deferredRows = followUpRows.filter(
    (row) =>
      row.conformance_disposition === "explicitly_deferred_not_implemented",
  );

  assertDeepEqual(
    sorted(carriedForwardRows.map((row) => row.id)),
    expectedCarriedForwardTriggerIds,
    "carried-forward trigger ids",
  );
  assertDeepEqual(
    sorted(deferredRows.map((row) => row.id)),
    expectedDeferredTriggerIds,
    "deferred trigger ids",
  );

  const acceptedItemCount = countBy(
    followUpPackage.package_items,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    followUpPackage.package_items,
    (item) => item.implemented === true,
  );
  const packagedItemCount = countBy(
    followUpPackage.package_items,
    (item) => item.package_status === "packaged_not_accepted",
  );
  const phaseAcceptedRows = countBy(
    followUpRows,
    (row) => row.accepted === true,
  );

  assertEqual(
    followUpPackage.summary.package_item_count,
    followUpPackage.package_items.length,
    "summary package item count",
  );
  assertEqual(
    followUpPackage.summary.git_history_package_items,
    followUpPackage.package_items.length,
    "summary Git-history package count",
  );
  assertEqual(
    followUpPackage.summary.stream_acceptance_package_items,
    0,
    "summary stream package count",
  );
  assertEqual(
    followUpPackage.summary.runtime_ux_package_items,
    0,
    "summary runtime UX package count",
  );
  assertEqual(
    followUpPackage.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    followUpPackage.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    followUpPackage.summary.packaged_not_accepted_items,
    packagedItemCount,
    "summary packaged count",
  );
  assertEqual(
    followUpPackage.summary.pending_a8_decision_items,
    1,
    "summary pending A8 decision count",
  );
  assertEqual(
    followUpPackage.summary.runtime_harness_8_2_trigger_count,
    followUpRows.length,
    "summary trigger count",
  );
  assertEqual(
    followUpPackage.summary.evidence_carried_forward_trigger_count,
    carriedForwardRows.length,
    "summary carried-forward count",
  );
  assertEqual(
    followUpPackage.summary.explicitly_deferred_trigger_count,
    deferredRows.length,
    "summary deferred count",
  );
  assertEqual(
    followUpPackage.summary.source_trigger_gap_items,
    deferredRows.length,
    "summary source gap count",
  );
  assertEqual(
    followUpPackage.summary.phase_conformance_accepted_items,
    phaseAcceptedRows,
    "summary phase accepted count",
  );
  assertEqual(
    followUpPackage.summary.source_command_evidence_items,
    gitHistoryPrerequisite.command_execution_evidence.length,
    "summary command evidence count",
  );
  assertEqual(
    followUpPackage.summary.source_follow_up_items,
    sourceFollowUpItems.length,
    "summary source follow-up count",
  );
  assertEqual(
    followUpPackage.summary.source_decision_items,
    followUpPackage.package_items.length,
    "summary source decision count",
  );
  assertEqual(
    followUpPackage.summary.source_a8_repair_items,
    gitHistoryRepair.repair_items.length,
    "summary source A8 repair count",
  );
  assertEqual(
    followUpPackage.summary.source_prerequisite_items,
    1,
    "summary source prerequisite count",
  );
  assertEqual(
    followUpPackage.summary.excluded_items,
    followUpPackage.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    followUpPackage.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    followUpPackage.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    sorted(
      followUpPackage.excluded_items
        .filter((item) => item.track_id !== undefined)
        .map((item) => item.track_id),
    ),
    sorted(excludedTrackIds),
    "excluded track ids",
  );
  assertDeepEqual(
    followUpPackage.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    ["FR-015"],
    "excluded FR ids",
  );
  assertDeepEqual(
    followUpPackage.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.223"],
    "next recommended slices",
  );

  return {
    status: followUpPackage.package_status,
    exitP1_1Status: followUpPackage.exit_p1_1_status,
    exitP1_10Status: followUpPackage.exit_p1_10_status,
    packageItemCount: followUpPackage.package_items.length,
    gitHistoryPackageItemCount:
      followUpPackage.summary.git_history_package_items,
    acceptedItemCount,
    implementedItemCount,
    packagedNotAcceptedItemCount: packagedItemCount,
    pendingA8DecisionItemCount:
      followUpPackage.summary.pending_a8_decision_items,
    runtimeHarness8_2TriggerCount: followUpRows.length,
    evidenceCarriedForwardTriggerCount: carriedForwardRows.length,
    explicitlyDeferredTriggerCount: deferredRows.length,
    phaseConformanceAcceptedItemCount: phaseAcceptedRows,
    frIds: followUpPackage.package_items.map((item) => item.fr_id),
    carriedForwardTriggerIds: carriedForwardRows.map((row) => row.id),
    deferredTriggerIds: deferredRows.map((row) => row.id),
    excludedTrackIds: followUpPackage.excluded_items
      .filter((item) => item.track_id !== undefined)
      .map((item) => item.track_id),
    excludedFrIds: followUpPackage.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: followUpPackage.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA8GitHistoryConformanceFollowUpPackage();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA8GitHistoryConformanceFollowUpPackage,
};
