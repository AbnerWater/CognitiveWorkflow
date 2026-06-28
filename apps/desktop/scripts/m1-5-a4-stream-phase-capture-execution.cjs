const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const streamCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-phase-capture-execution.json",
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
const matrixManifestPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-capture-matrix.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRequiredMatrixCases = [
  "known-desktop",
  "known-mobile",
  "unknown-desktop",
  "unknown-mobile",
  "unknown-mobile-scroll-900",
  "unknown-mobile-scroll-1440",
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

function assertMatrixCasePassed(matrixCasesByName, caseName) {
  const matrixCase = matrixCasesByName.get(caseName);
  assertCondition(Boolean(matrixCase), `missing matrix case ${caseName}`);
  assertEqual(matrixCase.process.exitCode, 0, `${caseName} exit code`);
  assertEqual(matrixCase.process.stderrLength, 0, `${caseName} stderr`);
  assertEqual(matrixCase.failures.length, 0, `${caseName} failures`);
  assertEqual(matrixCase.horizontalOverflow, 0, `${caseName} overflow`);
}

function validateA4StreamPhaseCaptureExecution(options = {}) {
  const streamCapture = readJson(
    options.streamCapturePath ?? streamCapturePath,
  );
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const sourceCapture = readJson(
    options.sourceCapturePath ?? sourceCapturePath,
  );
  const matrix = readJson(options.matrixManifestPath ?? matrixManifestPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(streamCapture, "stream phase capture artifact");
  assertSanitizedJson(matrix, "stream phase matrix artifact");
  assertEqual(streamCapture.schema_version, "0.1.0", "schema version");
  assertEqual(streamCapture.milestone, "M1.5", "milestone");
  assertEqual(streamCapture.slice, "W1.5.210", "slice id");
  assertEqual(
    streamCapture.capture_status,
    "a4_stream_phase_capture_executed_not_accepted",
    "capture status",
  );
  assertEqual(streamCapture.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");

  assertEqual(repairPlan.slice, "W1.5.209", "repair plan source slice");
  assertEqual(decisionRecord.slice, "W1.5.208", "decision source slice");
  assertEqual(
    sourceCapture.capture_status,
    "a4_capture_executed_not_accepted",
    "source capture status",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );

  const sourceTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-A4-STREAM-PHASE-CAPTURE",
  );
  assertCondition(Boolean(sourceTrack), "source stream phase track exists");
  assertDeepEqual(
    sorted(sourceTrack.fr_ids),
    sorted(expectedStreamFrIds),
    "source stream FR ids",
  );
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source track status",
  );
  assertEqual(sourceTrack.entry_slice, "W1.5.210", "source track entry slice");
  assertDeepEqual(
    sorted(streamCapture.track_execution.fr_ids),
    sorted(expectedStreamFrIds),
    "track execution FR ids",
  );
  assertEqual(
    streamCapture.track_execution.execution_status,
    "executed_not_accepted",
    "track execution status",
  );

  assertEqual(
    streamCapture.stream_required_case_capture.execution_status,
    "executed_passed",
    "stream required case execution status",
  );
  assertEqual(
    streamCapture.stream_required_case_capture.case_count,
    expectedRequiredMatrixCases.length,
    "stream required case count",
  );
  assertDeepEqual(
    sorted(streamCapture.stream_required_case_capture.case_names),
    sorted(expectedRequiredMatrixCases),
    "stream required case names",
  );
  assertEqual(
    streamCapture.stream_required_case_capture
      .chat_enabled_optional_context_in_scope,
    false,
    "chat-enabled optional context scope",
  );
  assertEqual(
    streamCapture.stream_required_case_capture.raw_output_dir_recorded,
    false,
    "stream required raw output dir flag",
  );
  assertEqual(
    streamCapture.stream_required_case_capture.query_hash_recorded,
    false,
    "stream required query/hash flag",
  );

  assertEqual(
    matrix.outputEvidence.caseCount,
    matrix.cases.length,
    "matrix case count",
  );
  assertEqual(matrix.failures.length, 0, "matrix failure count");
  assertDeepEqual(
    matrix.targetLocation,
    streamCapture.visual_smoke_matrix_capture.target,
    "matrix target location",
  );
  assertEqual(
    streamCapture.visual_smoke_matrix_capture.source_execution_status,
    "executed_passed",
    "source matrix execution status",
  );
  assertEqual(
    streamCapture.visual_smoke_matrix_capture.raw_output_dir_recorded,
    false,
    "matrix raw output dir flag",
  );
  assertEqual(
    streamCapture.visual_smoke_matrix_capture.query_hash_recorded,
    false,
    "matrix query/hash flag",
  );
  assertDeepEqual(
    sorted(streamCapture.visual_smoke_matrix_capture.required_case_names),
    sorted(expectedRequiredMatrixCases),
    "required matrix cases",
  );
  assertDeepEqual(
    sorted(streamCapture.visual_smoke_matrix_capture.observed_case_names),
    sorted(matrix.cases.map((item) => item.name)),
    "observed matrix cases",
  );

  const matrixCasesByName = new Map(
    matrix.cases.map((matrixCase) => [matrixCase.name, matrixCase]),
  );
  for (const caseName of expectedRequiredMatrixCases) {
    assertMatrixCasePassed(matrixCasesByName, caseName);
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
    streamCapture.phase_capture_items.length,
    expectedStreamFrIds.length,
    "phase capture item count",
  );
  assertDeepEqual(
    sorted(streamCapture.phase_capture_items.map((item) => item.fr_id)),
    sorted(expectedStreamFrIds),
    "phase capture FR ids",
  );
  assertEqual(
    streamCapture.phase_capture_items.some((item) => item.fr_id === "FR-015"),
    false,
    "FR-015 phase capture absence",
  );

  for (const phaseItem of streamCapture.phase_capture_items) {
    const repairItem = repairItemsById.get(phaseItem.repair_item_id);
    const decisionItem = decisionItemsById.get(phaseItem.source_decision_id);
    const sourceCaptureItem = sourceCapturesById.get(
      phaseItem.source_capture_id,
    );

    assertCondition(Boolean(repairItem), `${phaseItem.id} repair item`);
    assertCondition(Boolean(decisionItem), `${phaseItem.id} decision item`);
    assertCondition(
      Boolean(sourceCaptureItem),
      `${phaseItem.id} source capture item`,
    );
    assertEqual(phaseItem.fr_id, repairItem.fr_id, `${phaseItem.id} repair FR`);
    assertEqual(
      phaseItem.fr_id,
      decisionItem.fr_id,
      `${phaseItem.id} decision FR`,
    );
    assertEqual(
      phaseItem.fr_id,
      sourceCaptureItem.fr_id,
      `${phaseItem.id} source capture FR`,
    );
    assertEqual(
      repairItem.track_id,
      "TRACK-A4-STREAM-PHASE-CAPTURE",
      `${phaseItem.id} repair track`,
    );
    assertEqual(
      phaseItem.review_group,
      "candidate_stream_evidence",
      `${phaseItem.id} review group`,
    );
    assertEqual(
      phaseItem.phase_capture_status,
      "executed_not_accepted",
      `${phaseItem.id} phase capture status`,
    );
    assertEqual(
      phaseItem.source_decision,
      "needs_followup",
      `${phaseItem.id} source decision`,
    );
    assertEqual(
      decisionItem.decision,
      "needs_followup",
      `${phaseItem.id} source record decision`,
    );
    assertEqual(
      phaseItem.source_repair_status,
      "planned_not_implemented",
      `${phaseItem.id} source repair status`,
    );
    assertEqual(
      repairItem.implementation_status,
      "planned_not_implemented",
      `${phaseItem.id} repair implementation status`,
    );
    assertEqual(
      phaseItem.source_capture_status,
      "captured_not_accepted",
      `${phaseItem.id} source capture status`,
    );
    assertEqual(
      sourceCaptureItem.capture_status,
      "captured_not_accepted",
      `${phaseItem.id} source capture item status`,
    );
    assertEqual(phaseItem.accepted, false, `${phaseItem.id} accepted flag`);
    assertEqual(
      phaseItem.reviewer_decision_required,
      true,
      `${phaseItem.id} reviewer decision flag`,
    );
    assertDeepEqual(
      phaseItem.observed_matrix_cases,
      sourceCaptureItem.observed_matrix_cases,
      `${phaseItem.id} observed matrix cases`,
    );
    assertDeepEqual(
      phaseItem.observed_evidence_fields,
      sourceCaptureItem.observed_evidence_fields,
      `${phaseItem.id} observed evidence fields`,
    );
    assertDeepEqual(
      phaseItem.source_acceptance_blockers,
      decisionItem.acceptance_blockers,
      `${phaseItem.id} source acceptance blockers`,
    );
    assertCondition(
      phaseItem.phase_level_capture_inputs.length > 0,
      `${phaseItem.id} phase capture inputs`,
    );
    assertCondition(
      phaseItem.post_capture_remaining_blockers.length > 0,
      `${phaseItem.id} remaining blockers`,
    );
    for (const caseName of phaseItem.observed_matrix_cases) {
      assertMatrixCasePassed(matrixCasesByName, caseName);
    }
  }

  assertEqual(
    streamCapture.summary.phase_capture_item_count,
    streamCapture.phase_capture_items.length,
    "summary phase capture item count",
  );
  assertEqual(
    streamCapture.summary.stream_phase_capture_items,
    expectedStreamFrIds.length,
    "summary stream phase item count",
  );
  assertEqual(
    streamCapture.summary.runtime_bridge_capture_items,
    0,
    "summary runtime bridge count",
  );
  assertEqual(
    streamCapture.summary.git_history_prereq_items,
    0,
    "summary git prereq count",
  );
  assertEqual(streamCapture.summary.accepted_items, 0, "summary accepted");
  assertEqual(
    streamCapture.summary.implemented_items,
    0,
    "summary implemented",
  );
  assertEqual(
    streamCapture.summary.pending_a4_review_items,
    expectedStreamFrIds.length,
    "summary pending A4 review",
  );
  assertEqual(
    streamCapture.summary.source_needs_followup_items,
    expectedStreamFrIds.length,
    "summary source needs-followup",
  );
  assertEqual(
    streamCapture.summary.source_repair_items,
    expectedStreamFrIds.length,
    "summary source repair items",
  );
  assertEqual(
    streamCapture.summary.matrix_case_count,
    matrix.cases.length,
    "summary matrix case count",
  );
  assertEqual(
    streamCapture.summary.required_matrix_case_count,
    expectedRequiredMatrixCases.length,
    "summary required matrix case count",
  );
  assertEqual(
    streamCapture.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertDeepEqual(
    streamCapture.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.211"],
    "next recommended slices",
  );

  return {
    status: streamCapture.capture_status,
    exitP1_1Status: streamCapture.exit_p1_1_status,
    phaseCaptureItemCount: streamCapture.phase_capture_items.length,
    frIds: streamCapture.phase_capture_items.map((item) => item.fr_id),
    acceptedItemCount: streamCapture.summary.accepted_items,
    implementedItemCount: streamCapture.summary.implemented_items,
    pendingA4ReviewItemCount: streamCapture.summary.pending_a4_review_items,
    matrixCaseCount: streamCapture.summary.matrix_case_count,
    streamRequiredCaseCount:
      streamCapture.stream_required_case_capture.case_count,
    requiredMatrixCases:
      streamCapture.visual_smoke_matrix_capture.required_case_names,
    excludedTrackIds: streamCapture.excluded_items
      .filter((item) => typeof item.track_id === "string")
      .map((item) => item.track_id),
    excludedFrIds: streamCapture.excluded_items
      .filter((item) => typeof item.fr_id === "string")
      .map((item) => item.fr_id),
    nextRecommendedSlices: streamCapture.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4StreamPhaseCaptureExecution();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = { validateA4StreamPhaseCaptureExecution };
