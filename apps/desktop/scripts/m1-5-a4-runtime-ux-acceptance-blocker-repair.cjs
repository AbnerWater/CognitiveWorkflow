const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const runtimeRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-blocker-repair.json",
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

const expectedRuntimeUxFrIds = [
  "FR-007",
  "FR-008",
  "FR-011",
  "FR-013",
  "FR-014",
  "FR-017",
  "FR-018",
];
const excludedTrackIds = [
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
  "TRACK-A8-GIT-HISTORY-CONFORMANCE",
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
  "prompt_to_user",
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

function validateA4RuntimeUxAcceptanceBlockerRepair(options = {}) {
  const runtimeRepair = readJson(
    options.runtimeRepairPath ?? runtimeRepairPath,
  );
  const blockerPlan = readJson(options.blockerPlanPath ?? blockerPlanPath);
  const postCaptureDecision = readJson(
    options.postCaptureDecisionPath ?? postCaptureDecisionPath,
  );
  const runtimeBridgeCapture = readJson(
    options.runtimeBridgeCapturePath ?? runtimeBridgeCapturePath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(runtimeRepair, "A4 runtime UX blocker repair");
  assertEqual(runtimeRepair.schema_version, "0.1.0", "schema version");
  assertEqual(runtimeRepair.milestone, "M1.5", "milestone");
  assertEqual(runtimeRepair.slice, "W1.5.216", "slice id");
  assertEqual(
    runtimeRepair.repair_status,
    "a4_runtime_ux_acceptance_blocker_repair_executed_not_accepted",
    "repair status",
  );
  assertEqual(runtimeRepair.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    runtimeRepair.exit_p1_10_status,
    "not_ready",
    "EXIT-P1-10 status",
  );

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
    runtimeBridgeCapture.slice,
    "W1.5.211",
    "runtime bridge source slice",
  );
  assertEqual(
    runtimeBridgeCapture.capture_status,
    "a4_runtime_bridge_user_path_capture_executed_not_accepted",
    "runtime bridge source status",
  );
  assertEqual(readinessLedger.slice, "W1.5.216", "readiness ledger slice");
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

  const sourceTrack = blockerPlan.repair_tracks.find(
    (track) => track.id === "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  );
  assertCondition(Boolean(sourceTrack), "source runtime UX track");
  assertDeepEqual(
    sorted(sourceTrack.fr_ids),
    sorted(expectedRuntimeUxFrIds),
    "source runtime UX track FR ids",
  );
  assertEqual(sourceTrack.entry_slice, "W1.5.216", "source track entry slice");
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source track status",
  );
  assertDeepEqual(
    sorted(runtimeRepair.track_execution.fr_ids),
    sorted(expectedRuntimeUxFrIds),
    "track execution FR ids",
  );
  assertEqual(
    runtimeRepair.track_execution.source_track_id,
    sourceTrack.id,
    "track execution source track",
  );
  assertEqual(
    runtimeRepair.track_execution.source_track_status,
    sourceTrack.status,
    "track execution source status",
  );
  assertEqual(
    runtimeRepair.track_execution.execution_status,
    "executed_not_accepted",
    "track execution status",
  );
  assertEqual(
    runtimeRepair.track_execution.acceptance_decision_status,
    "pending_reviewer_decision",
    "track acceptance decision status",
  );

  const commandFailures =
    runtimeBridgeCapture.command_execution_evidence.filter(
      (item) => item.execution_status !== "executed_passed",
    );
  assertEqual(
    runtimeRepair.runtime_ux_evidence_package.source_capture_slice,
    "W1.5.211",
    "runtime UX package source slice",
  );
  assertEqual(
    runtimeRepair.runtime_ux_evidence_package.source_capture_status,
    runtimeBridgeCapture.capture_status,
    "runtime UX package source status",
  );
  assertEqual(
    runtimeRepair.runtime_ux_evidence_package.runtime_bridge_capture_item_count,
    runtimeBridgeCapture.runtime_bridge_capture_items.length,
    "runtime UX package capture count",
  );
  assertEqual(
    runtimeRepair.runtime_ux_evidence_package.command_evidence_count,
    runtimeBridgeCapture.command_execution_evidence.length,
    "runtime UX package command evidence count",
  );
  assertEqual(
    runtimeRepair.runtime_ux_evidence_package.source_command_failure_count,
    commandFailures.length,
    "runtime UX package command failure count",
  );
  for (const flagName of [
    "raw_instruction_text_recorded",
    "raw_reference_bytes_recorded",
    "raw_artifact_body_recorded",
    "raw_hitl_prompt_recorded",
    "raw_response_body_recorded",
    "raw_path_values_recorded",
    "acceptance_decision_recorded",
  ]) {
    assertEqual(
      runtimeRepair.runtime_ux_evidence_package[flagName],
      false,
      `${flagName} flag`,
    );
  }

  const sourceBlockerItemsById = new Map(
    blockerPlan.repair_items.map((item) => [item.id, item]),
  );
  const postCaptureItemsById = new Map(
    postCaptureDecision.post_capture_decision_items.map((item) => [
      item.id,
      item,
    ]),
  );
  const runtimeCaptureItemsById = new Map(
    runtimeBridgeCapture.runtime_bridge_capture_items.map((item) => [
      item.id,
      item,
    ]),
  );
  const sourceRuntimeBlockerItems = blockerPlan.repair_items.filter(
    (item) => item.track_id === "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  );

  assertEqual(
    runtimeRepair.repair_items.length,
    expectedRuntimeUxFrIds.length,
    "repair item count",
  );
  assertDeepEqual(
    sorted(runtimeRepair.repair_items.map((item) => item.fr_id)),
    sorted(expectedRuntimeUxFrIds),
    "repair item FR ids",
  );
  assertDeepEqual(
    sorted(
      runtimeRepair.repair_items.map(
        (item) => item.source_blocker_repair_item_id,
      ),
    ),
    sorted(sourceRuntimeBlockerItems.map((item) => item.id)),
    "source blocker repair ids",
  );
  assertEqual(
    runtimeRepair.repair_items.some((item) => item.fr_id === "FR-015"),
    false,
    "FR-015 runtime UX repair absence",
  );

  for (const repairItem of runtimeRepair.repair_items) {
    const sourceBlockerItem = sourceBlockerItemsById.get(
      repairItem.source_blocker_repair_item_id,
    );
    const postCaptureItem = postCaptureItemsById.get(
      repairItem.source_post_capture_decision_id,
    );
    const runtimeCaptureItem = runtimeCaptureItemsById.get(
      repairItem.source_runtime_bridge_capture_item_id,
    );

    assertCondition(
      Boolean(sourceBlockerItem),
      `${repairItem.id} source blocker`,
    );
    assertCondition(
      Boolean(postCaptureItem),
      `${repairItem.id} post-capture source`,
    );
    assertCondition(
      Boolean(runtimeCaptureItem),
      `${repairItem.id} runtime bridge capture source`,
    );
    assertEqual(
      repairItem.fr_id,
      sourceBlockerItem.fr_id,
      `${repairItem.id} source blocker FR`,
    );
    assertEqual(
      repairItem.fr_id,
      postCaptureItem.fr_id,
      `${repairItem.id} post-capture FR`,
    );
    assertEqual(
      repairItem.fr_id,
      runtimeCaptureItem.fr_id,
      `${repairItem.id} runtime capture FR`,
    );
    assertEqual(
      sourceBlockerItem.implementation_status,
      "planned_not_implemented",
      `${repairItem.id} source implementation status`,
    );
    assertEqual(
      repairItem.source_implementation_status,
      sourceBlockerItem.implementation_status,
      `${repairItem.id} copied source implementation status`,
    );
    assertEqual(
      repairItem.track_id,
      "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
      `${repairItem.id} track id`,
    );
    assertEqual(
      repairItem.repair_status,
      "executed_not_accepted",
      `${repairItem.id} repair status`,
    );
    assertEqual(repairItem.accepted, false, `${repairItem.id} accepted`);
    assertEqual(repairItem.implemented, false, `${repairItem.id} implemented`);
    assertEqual(
      repairItem.reviewer_decision_required,
      true,
      `${repairItem.id} reviewer decision required`,
    );
    assertEqual(
      repairItem.acceptance_decision_status,
      "pending_reviewer_decision",
      `${repairItem.id} decision status`,
    );
    assertEqual(
      postCaptureItem.post_capture_decision,
      "needs_followup",
      `${repairItem.id} post-capture decision`,
    );
    assertEqual(
      runtimeCaptureItem.user_path_capture_status,
      "executed_not_accepted",
      `${repairItem.id} runtime capture status`,
    );
    assertDeepEqual(
      repairItem.source_acceptance_blockers,
      sourceBlockerItem.acceptance_blockers,
      `${repairItem.id} source acceptance blockers`,
    );
    assertCondition(
      repairItem.remaining_acceptance_blockers.length > 0,
      `${repairItem.id} remaining acceptance blockers`,
    );
    assertCondition(
      repairItem.remaining_acceptance_blockers.some((blocker) =>
        blocker.includes("Formal A4 reviewer acceptance or rejection"),
      ),
      `${repairItem.id} formal A4 decision remains blocked`,
    );
    assertCondition(
      repairItem.repair_actions_executed.length > 0,
      `${repairItem.id} repair actions`,
    );
    assertCondition(
      repairItem.verification_commands.length > 0,
      `${repairItem.id} verification commands`,
    );
    assertCondition(
      repairItem.evidence_refs.some((ref) =>
        ref.includes(repairItem.source_blocker_repair_item_id),
      ),
      `${repairItem.id} evidence ref points to source blocker`,
    );
    assertCondition(
      repairItem.evidence_refs.some((ref) =>
        ref.includes(repairItem.source_runtime_bridge_capture_item_id),
      ),
      `${repairItem.id} evidence ref points to runtime capture`,
    );
  }

  const acceptedItemCount = countBy(
    runtimeRepair.repair_items,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    runtimeRepair.repair_items,
    (item) => item.implemented === true,
  );
  const executedItemCount = countBy(
    runtimeRepair.repair_items,
    (item) => item.repair_status === "executed_not_accepted",
  );
  const pendingDecisionItemCount = countBy(
    runtimeRepair.repair_items,
    (item) => item.acceptance_decision_status === "pending_reviewer_decision",
  );

  assertEqual(
    runtimeRepair.summary.repair_item_count,
    runtimeRepair.repair_items.length,
    "summary repair count",
  );
  assertEqual(
    runtimeRepair.summary.stream_acceptance_repair_items,
    0,
    "summary stream repair count",
  );
  assertEqual(
    runtimeRepair.summary.runtime_ux_repair_items,
    runtimeRepair.repair_items.length,
    "summary runtime UX repair count",
  );
  assertEqual(
    runtimeRepair.summary.git_history_conformance_items,
    0,
    "summary Git-history repair count",
  );
  assertEqual(
    runtimeRepair.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    runtimeRepair.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    runtimeRepair.summary.executed_not_accepted_items,
    executedItemCount,
    "summary executed count",
  );
  assertEqual(
    runtimeRepair.summary.pending_a4_decision_items,
    pendingDecisionItemCount,
    "summary pending decision count",
  );
  assertEqual(
    runtimeRepair.summary.source_runtime_ux_blocker_items,
    sourceRuntimeBlockerItems.length,
    "summary source blocker count",
  );
  assertEqual(
    runtimeRepair.summary.source_runtime_bridge_capture_items,
    runtimeBridgeCapture.runtime_bridge_capture_items.length,
    "summary source runtime capture count",
  );
  assertEqual(
    runtimeRepair.summary.source_command_evidence_items,
    runtimeBridgeCapture.command_execution_evidence.length,
    "summary source command evidence count",
  );
  assertEqual(
    runtimeRepair.summary.excluded_items,
    runtimeRepair.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    runtimeRepair.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertEqual(
    runtimeRepair.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10 status",
  );
  assertDeepEqual(
    sorted(
      runtimeRepair.excluded_items
        .filter((item) => item.track_id !== undefined)
        .map((item) => item.track_id),
    ),
    sorted(excludedTrackIds),
    "excluded track ids",
  );
  assertDeepEqual(
    runtimeRepair.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    ["FR-015"],
    "excluded FR ids",
  );
  assertDeepEqual(
    runtimeRepair.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.217"],
    "next recommended slices",
  );
  assertDeepEqual(
    readinessLedger.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.217"],
    "readiness ledger next recommended slices",
  );

  return {
    status: runtimeRepair.repair_status,
    exitP1_1Status: runtimeRepair.exit_p1_1_status,
    exitP1_10Status: runtimeRepair.exit_p1_10_status,
    repairItemCount: runtimeRepair.repair_items.length,
    runtimeUxRepairItemCount: runtimeRepair.summary.runtime_ux_repair_items,
    acceptedItemCount,
    implementedItemCount,
    executedNotAcceptedItemCount: executedItemCount,
    pendingA4DecisionItemCount: pendingDecisionItemCount,
    runtimeBridgeCaptureItemCount:
      runtimeBridgeCapture.runtime_bridge_capture_items.length,
    commandEvidenceCount:
      runtimeBridgeCapture.command_execution_evidence.length,
    frIds: runtimeRepair.repair_items.map((item) => item.fr_id),
    excludedTrackIds: runtimeRepair.excluded_items
      .filter((item) => item.track_id !== undefined)
      .map((item) => item.track_id),
    excludedFrIds: runtimeRepair.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: runtimeRepair.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4RuntimeUxAcceptanceBlockerRepair();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4RuntimeUxAcceptanceBlockerRepair,
};
