const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const runtimeCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-bridge-user-path-capture.json",
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
const streamCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-phase-capture-execution.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

const expectedRuntimeBridgeFrIds = [
  "FR-007",
  "FR-008",
  "FR-011",
  "FR-013",
  "FR-014",
  "FR-017",
  "FR-018",
];
const excludedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const excludedFrIds = ["FR-009", "FR-010", "FR-012", "FR-015", "FR-016"];

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

function validateA4RuntimeBridgeUserPathCapture(options = {}) {
  const runtimeCapture = readJson(
    options.runtimeCapturePath ?? runtimeCapturePath,
  );
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const sourceCapture = readJson(
    options.sourceCapturePath ?? sourceCapturePath,
  );
  const streamCapture = readJson(
    options.streamCapturePath ?? streamCapturePath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(runtimeCapture, "runtime bridge user-path capture");
  assertEqual(runtimeCapture.schema_version, "0.1.0", "schema version");
  assertEqual(runtimeCapture.milestone, "M1.5", "milestone");
  assertEqual(runtimeCapture.slice, "W1.5.211", "slice id");
  assertEqual(
    runtimeCapture.capture_status,
    "a4_runtime_bridge_user_path_capture_executed_not_accepted",
    "capture status",
  );
  assertEqual(runtimeCapture.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");

  assertEqual(repairPlan.slice, "W1.5.209", "repair plan source slice");
  assertEqual(decisionRecord.slice, "W1.5.208", "decision source slice");
  assertEqual(
    sourceCapture.capture_status,
    "a4_capture_executed_not_accepted",
    "source capture status",
  );
  assertEqual(
    streamCapture.capture_status,
    "a4_stream_phase_capture_executed_not_accepted",
    "stream source capture status",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );

  const sourceTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-A4-RUNTIME-BRIDGE-CAPTURE",
  );
  assertCondition(Boolean(sourceTrack), "source runtime bridge track exists");
  assertDeepEqual(
    sorted(sourceTrack.fr_ids),
    sorted(expectedRuntimeBridgeFrIds),
    "source runtime bridge FR ids",
  );
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source track status",
  );
  assertEqual(sourceTrack.entry_slice, "W1.5.211", "source track entry slice");
  assertDeepEqual(
    sorted(runtimeCapture.track_execution.fr_ids),
    sorted(expectedRuntimeBridgeFrIds),
    "track execution FR ids",
  );
  assertEqual(
    runtimeCapture.track_execution.execution_status,
    "executed_not_accepted",
    "track execution status",
  );

  const commandEvidenceById = new Map(
    runtimeCapture.command_execution_evidence.map((item) => [item.id, item]),
  );
  assertEqual(
    runtimeCapture.command_execution_evidence.length,
    6,
    "command evidence count",
  );
  for (const commandEvidence of runtimeCapture.command_execution_evidence) {
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
      commandEvidence.applies_to_fr_ids.length > 0,
      `${commandEvidence.id} FR scope`,
    );
  }

  const repairItemsById = new Map(
    repairPlan.repair_items.map((item) => [item.id, item]),
  );
  const decisionItemsById = new Map(
    decisionRecord.decision_items.map((item) => [item.id, item]),
  );
  const sourceCapturesById = new Map(
    sourceCapture.review_item_captures.map((item) => [item.id, item]),
  );

  assertEqual(
    runtimeCapture.runtime_bridge_capture_items.length,
    expectedRuntimeBridgeFrIds.length,
    "runtime bridge capture item count",
  );
  assertDeepEqual(
    sorted(
      runtimeCapture.runtime_bridge_capture_items.map((item) => item.fr_id),
    ),
    sorted(expectedRuntimeBridgeFrIds),
    "runtime bridge capture FR ids",
  );
  for (const frId of [...excludedStreamFrIds, "FR-012", "FR-015"]) {
    assertEqual(
      runtimeCapture.runtime_bridge_capture_items.some(
        (item) => item.fr_id === frId,
      ),
      false,
      `${frId} runtime bridge capture absence`,
    );
  }

  for (const captureItem of runtimeCapture.runtime_bridge_capture_items) {
    const repairItem = repairItemsById.get(captureItem.repair_item_id);
    const decisionItem = decisionItemsById.get(captureItem.source_decision_id);
    const sourceCaptureItem = sourceCapturesById.get(
      captureItem.source_capture_id,
    );

    assertCondition(Boolean(repairItem), `${captureItem.id} repair item`);
    assertCondition(Boolean(decisionItem), `${captureItem.id} decision item`);
    assertCondition(
      Boolean(sourceCaptureItem),
      `${captureItem.id} source capture item`,
    );
    assertEqual(
      captureItem.fr_id,
      repairItem.fr_id,
      `${captureItem.id} repair FR`,
    );
    assertEqual(
      captureItem.fr_id,
      decisionItem.fr_id,
      `${captureItem.id} decision FR`,
    );
    assertEqual(
      captureItem.fr_id,
      sourceCaptureItem.fr_id,
      `${captureItem.id} source capture FR`,
    );
    assertEqual(
      repairItem.track_id,
      "TRACK-A4-RUNTIME-BRIDGE-CAPTURE",
      `${captureItem.id} repair track`,
    );
    assertEqual(
      captureItem.review_group,
      "runtime_bridge_evidence",
      `${captureItem.id} review group`,
    );
    assertEqual(
      captureItem.user_path_capture_status,
      "executed_not_accepted",
      `${captureItem.id} user path capture status`,
    );
    assertEqual(
      captureItem.source_decision,
      "needs_followup",
      `${captureItem.id} source decision`,
    );
    assertEqual(
      decisionItem.decision,
      "needs_followup",
      `${captureItem.id} source record decision`,
    );
    assertEqual(
      captureItem.source_repair_status,
      "planned_not_implemented",
      `${captureItem.id} source repair status`,
    );
    assertEqual(
      repairItem.implementation_status,
      "planned_not_implemented",
      `${captureItem.id} repair implementation status`,
    );
    assertEqual(
      captureItem.source_capture_status,
      "captured_not_accepted",
      `${captureItem.id} source capture status`,
    );
    assertEqual(
      sourceCaptureItem.capture_status,
      "captured_not_accepted",
      `${captureItem.id} source capture item status`,
    );
    assertEqual(captureItem.accepted, false, `${captureItem.id} accepted flag`);
    assertEqual(
      captureItem.reviewer_decision_required,
      true,
      `${captureItem.id} reviewer decision flag`,
    );
    assertEqual(
      captureItem.bridge_command_id,
      sourceCaptureItem.bridge_command_id,
      `${captureItem.id} bridge command id`,
    );
    assertDeepEqual(
      captureItem.observed_a4_evidence_inputs,
      sourceCaptureItem.observed_a4_evidence_inputs,
      `${captureItem.id} observed A4 inputs`,
    );
    assertDeepEqual(
      captureItem.source_acceptance_blockers,
      decisionItem.acceptance_blockers,
      `${captureItem.id} source acceptance blockers`,
    );
    assertCondition(
      captureItem.user_path_capture_inputs.length > 0,
      `${captureItem.id} user path capture inputs`,
    );
    assertCondition(
      captureItem.post_capture_remaining_blockers.length > 0,
      `${captureItem.id} remaining blockers`,
    );
    assertCondition(
      captureItem.command_evidence_ids.length > 0,
      `${captureItem.id} command evidence ids`,
    );
    for (const commandEvidenceId of captureItem.command_evidence_ids) {
      const commandEvidence = commandEvidenceById.get(commandEvidenceId);
      assertCondition(
        Boolean(commandEvidence),
        `${captureItem.id} command evidence ${commandEvidenceId}`,
      );
      assertCondition(
        commandEvidence.applies_to_fr_ids.includes(captureItem.fr_id),
        `${captureItem.id} command evidence ${commandEvidenceId} FR scope`,
      );
    }
  }

  assertDeepEqual(
    sorted(runtimeCapture.summary.excluded_fr_ids),
    sorted(excludedFrIds),
    "summary excluded FR ids",
  );
  assertEqual(
    runtimeCapture.excluded_items.some(
      (item) => item.track_id === "TRACK-A4-STREAM-PHASE-CAPTURE",
    ),
    true,
    "stream track excluded item",
  );
  assertEqual(
    runtimeCapture.excluded_items.some((item) => item.fr_id === "FR-012"),
    true,
    "FR-012 excluded item",
  );
  assertEqual(
    runtimeCapture.excluded_items.some((item) => item.fr_id === "FR-015"),
    true,
    "FR-015 excluded item",
  );
  assertEqual(
    runtimeCapture.summary.runtime_bridge_capture_item_count,
    runtimeCapture.runtime_bridge_capture_items.length,
    "summary runtime bridge capture item count",
  );
  assertEqual(
    runtimeCapture.summary.stream_phase_capture_items,
    0,
    "summary stream phase count",
  );
  assertEqual(
    runtimeCapture.summary.runtime_bridge_capture_items,
    expectedRuntimeBridgeFrIds.length,
    "summary runtime bridge count",
  );
  assertEqual(
    runtimeCapture.summary.git_history_prereq_items,
    0,
    "summary git prereq count",
  );
  assertEqual(runtimeCapture.summary.accepted_items, 0, "summary accepted");
  assertEqual(
    runtimeCapture.summary.implemented_items,
    0,
    "summary implemented",
  );
  assertEqual(
    runtimeCapture.summary.pending_a4_review_items,
    expectedRuntimeBridgeFrIds.length,
    "summary pending A4 review",
  );
  assertEqual(
    runtimeCapture.summary.source_needs_followup_items,
    expectedRuntimeBridgeFrIds.length,
    "summary source needs-followup",
  );
  assertEqual(
    runtimeCapture.summary.source_repair_items,
    expectedRuntimeBridgeFrIds.length,
    "summary source repair items",
  );
  assertEqual(
    runtimeCapture.summary.command_evidence_count,
    runtimeCapture.command_execution_evidence.length,
    "summary command evidence count",
  );
  assertEqual(
    runtimeCapture.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertDeepEqual(
    runtimeCapture.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.212"],
    "next recommended slices",
  );

  return {
    status: runtimeCapture.capture_status,
    exitP1_1Status: runtimeCapture.exit_p1_1_status,
    runtimeBridgeCaptureItemCount:
      runtimeCapture.runtime_bridge_capture_items.length,
    frIds: runtimeCapture.runtime_bridge_capture_items.map(
      (item) => item.fr_id,
    ),
    acceptedItemCount: runtimeCapture.summary.accepted_items,
    implementedItemCount: runtimeCapture.summary.implemented_items,
    pendingA4ReviewItemCount: runtimeCapture.summary.pending_a4_review_items,
    commandEvidenceCount: runtimeCapture.summary.command_evidence_count,
    excludedFrIds: runtimeCapture.summary.excluded_fr_ids,
    nextRecommendedSlices: runtimeCapture.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4RuntimeBridgeUserPathCapture();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = { validateA4RuntimeBridgeUserPathCapture };
