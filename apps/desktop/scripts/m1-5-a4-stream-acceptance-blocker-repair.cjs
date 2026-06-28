const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const streamRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-blocker-repair.json",
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
const streamCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-phase-capture-execution.json",
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
const excludedTrackIds = [
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
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

function assertMatrixCasePassed(matrixCasesByName, caseName) {
  const matrixCase = matrixCasesByName.get(caseName);
  assertCondition(Boolean(matrixCase), `missing matrix case ${caseName}`);
  assertEqual(matrixCase.process.exitCode, 0, `${caseName} exit code`);
  assertEqual(matrixCase.process.stderrLength, 0, `${caseName} stderr`);
  assertEqual(matrixCase.failures.length, 0, `${caseName} failures`);
  assertEqual(matrixCase.horizontalOverflow, 0, `${caseName} overflow`);
}

function validateA4StreamAcceptanceBlockerRepair(options = {}) {
  const streamRepair = readJson(options.streamRepairPath ?? streamRepairPath);
  const blockerPlan = readJson(options.blockerPlanPath ?? blockerPlanPath);
  const postCaptureDecision = readJson(
    options.postCaptureDecisionPath ?? postCaptureDecisionPath,
  );
  const streamCapture = readJson(
    options.streamCapturePath ?? streamCapturePath,
  );
  const matrix = readJson(options.matrixManifestPath ?? matrixManifestPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(streamRepair, "A4 stream acceptance blocker repair");
  assertSanitizedJson(matrix, "A4 stream acceptance matrix");
  assertEqual(streamRepair.schema_version, "0.1.0", "schema version");
  assertEqual(streamRepair.milestone, "M1.5", "milestone");
  assertEqual(streamRepair.slice, "W1.5.215", "slice id");
  assertEqual(
    streamRepair.repair_status,
    "a4_stream_acceptance_blocker_repair_executed_not_accepted",
    "repair status",
  );
  assertEqual(streamRepair.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(streamRepair.exit_p1_10_status, "not_ready", "EXIT-P1-10 status");

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
  assertEqual(streamCapture.slice, "W1.5.210", "stream capture source slice");
  assertEqual(
    streamCapture.capture_status,
    "a4_stream_phase_capture_executed_not_accepted",
    "stream capture source status",
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

  const sourceTrack = blockerPlan.repair_tracks.find(
    (track) => track.id === "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
  );
  assertCondition(Boolean(sourceTrack), "source stream final acceptance track");
  assertDeepEqual(
    sorted(sourceTrack.fr_ids),
    sorted(expectedStreamFrIds),
    "source stream track FR ids",
  );
  assertEqual(sourceTrack.entry_slice, "W1.5.215", "source track entry slice");
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source track status",
  );
  assertDeepEqual(
    sorted(streamRepair.track_execution.fr_ids),
    sorted(expectedStreamFrIds),
    "track execution FR ids",
  );
  assertEqual(
    streamRepair.track_execution.source_track_id,
    sourceTrack.id,
    "track execution source track",
  );
  assertEqual(
    streamRepair.track_execution.source_track_status,
    sourceTrack.status,
    "track execution source status",
  );
  assertEqual(
    streamRepair.track_execution.execution_status,
    "executed_not_accepted",
    "track execution status",
  );
  assertEqual(
    streamRepair.track_execution.acceptance_decision_status,
    "pending_reviewer_decision",
    "track acceptance decision status",
  );

  assertEqual(
    matrix.outputEvidence.caseCount,
    matrix.cases.length,
    "case count",
  );
  assertEqual(matrix.failures.length, 0, "matrix failure count");
  const matrixCasesByName = new Map(
    matrix.cases.map((matrixCase) => [matrixCase.name, matrixCase]),
  );
  for (const caseName of expectedRequiredMatrixCases) {
    assertMatrixCasePassed(matrixCasesByName, caseName);
  }
  assertEqual(
    streamRepair.stream_evidence_package.source_capture_slice,
    "W1.5.210",
    "stream package source slice",
  );
  assertEqual(
    streamRepair.stream_evidence_package.source_capture_status,
    streamCapture.capture_status,
    "stream package source status",
  );
  assertEqual(
    streamRepair.stream_evidence_package.matrix_case_count,
    matrix.cases.length,
    "stream package matrix case count",
  );
  assertEqual(
    streamRepair.stream_evidence_package.source_failure_count,
    matrix.failures.length,
    "stream package failure count",
  );
  assertDeepEqual(
    sorted(streamRepair.stream_evidence_package.required_case_names),
    sorted(expectedRequiredMatrixCases),
    "stream package required cases",
  );
  assertEqual(
    streamRepair.stream_evidence_package.raw_output_dir_recorded,
    false,
    "raw output dir flag",
  );
  assertEqual(
    streamRepair.stream_evidence_package.query_hash_recorded,
    false,
    "query/hash flag",
  );
  assertEqual(
    streamRepair.stream_evidence_package.acceptance_decision_recorded,
    false,
    "acceptance decision recorded flag",
  );

  const sourceBlockerItemsById = new Map(
    blockerPlan.repair_items.map((item) => [item.id, item]),
  );
  const postCaptureItemsById = new Map(
    postCaptureDecision.post_capture_decision_items.map((item) => [
      item.id,
      item,
    ]),
  );
  const streamCaptureItemsById = new Map(
    streamCapture.phase_capture_items.map((item) => [item.id, item]),
  );
  const sourceStreamBlockerItems = blockerPlan.repair_items.filter(
    (item) => item.track_id === "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
  );

  assertEqual(
    streamRepair.repair_items.length,
    expectedStreamFrIds.length,
    "repair item count",
  );
  assertDeepEqual(
    sorted(streamRepair.repair_items.map((item) => item.fr_id)),
    sorted(expectedStreamFrIds),
    "repair item FR ids",
  );
  assertDeepEqual(
    sorted(
      streamRepair.repair_items.map(
        (item) => item.source_blocker_repair_item_id,
      ),
    ),
    sorted(sourceStreamBlockerItems.map((item) => item.id)),
    "source blocker repair ids",
  );
  assertEqual(
    streamRepair.repair_items.some((item) => item.fr_id === "FR-015"),
    false,
    "FR-015 stream repair absence",
  );

  for (const repairItem of streamRepair.repair_items) {
    const sourceBlockerItem = sourceBlockerItemsById.get(
      repairItem.source_blocker_repair_item_id,
    );
    const postCaptureItem = postCaptureItemsById.get(
      repairItem.source_post_capture_decision_id,
    );
    const streamCaptureItem = streamCaptureItemsById.get(
      repairItem.source_phase_capture_item_id,
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
      Boolean(streamCaptureItem),
      `${repairItem.id} stream capture source`,
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
      streamCaptureItem.fr_id,
      `${repairItem.id} stream capture FR`,
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
      "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
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
      streamCaptureItem.phase_capture_status,
      "executed_not_accepted",
      `${repairItem.id} stream capture status`,
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
        ref.includes(repairItem.source_phase_capture_item_id),
      ),
      `${repairItem.id} evidence ref points to stream capture`,
    );
  }

  const acceptedItemCount = countBy(
    streamRepair.repair_items,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    streamRepair.repair_items,
    (item) => item.implemented === true,
  );
  const executedItemCount = countBy(
    streamRepair.repair_items,
    (item) => item.repair_status === "executed_not_accepted",
  );
  const pendingDecisionItemCount = countBy(
    streamRepair.repair_items,
    (item) => item.acceptance_decision_status === "pending_reviewer_decision",
  );

  assertEqual(
    streamRepair.summary.repair_item_count,
    streamRepair.repair_items.length,
    "summary repair count",
  );
  assertEqual(
    streamRepair.summary.stream_acceptance_repair_items,
    streamRepair.repair_items.length,
    "summary stream repair count",
  );
  assertEqual(
    streamRepair.summary.runtime_ux_repair_items,
    0,
    "summary runtime UX repair count",
  );
  assertEqual(
    streamRepair.summary.git_history_conformance_items,
    0,
    "summary Git-history repair count",
  );
  assertEqual(
    streamRepair.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    streamRepair.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    streamRepair.summary.executed_not_accepted_items,
    executedItemCount,
    "summary executed count",
  );
  assertEqual(
    streamRepair.summary.pending_a4_decision_items,
    pendingDecisionItemCount,
    "summary pending decision count",
  );
  assertEqual(
    streamRepair.summary.source_stream_blocker_items,
    sourceStreamBlockerItems.length,
    "summary source blocker count",
  );
  assertEqual(
    streamRepair.summary.source_phase_capture_items,
    streamCapture.phase_capture_items.length,
    "summary source phase capture count",
  );
  assertEqual(
    streamRepair.summary.matrix_case_count,
    matrix.cases.length,
    "summary matrix case count",
  );
  assertEqual(
    streamRepair.summary.required_matrix_case_count,
    expectedRequiredMatrixCases.length,
    "summary required matrix case count",
  );
  assertEqual(
    streamRepair.summary.excluded_items,
    streamRepair.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    streamRepair.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertEqual(
    streamRepair.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10 status",
  );
  assertDeepEqual(
    sorted(
      streamRepair.excluded_items
        .filter((item) => item.track_id !== undefined)
        .map((item) => item.track_id),
    ),
    sorted(excludedTrackIds),
    "excluded track ids",
  );
  assertDeepEqual(
    streamRepair.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    ["FR-015"],
    "excluded FR ids",
  );
  assertDeepEqual(
    streamRepair.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.216"],
    "next recommended slices",
  );

  return {
    status: streamRepair.repair_status,
    exitP1_1Status: streamRepair.exit_p1_1_status,
    exitP1_10Status: streamRepair.exit_p1_10_status,
    repairItemCount: streamRepair.repair_items.length,
    streamAcceptanceRepairItemCount:
      streamRepair.summary.stream_acceptance_repair_items,
    acceptedItemCount,
    implementedItemCount,
    executedNotAcceptedItemCount: executedItemCount,
    pendingA4DecisionItemCount: pendingDecisionItemCount,
    matrixCaseCount: matrix.cases.length,
    requiredMatrixCases: expectedRequiredMatrixCases,
    frIds: streamRepair.repair_items.map((item) => item.fr_id),
    excludedTrackIds: streamRepair.excluded_items
      .filter((item) => item.track_id !== undefined)
      .map((item) => item.track_id),
    excludedFrIds: streamRepair.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: streamRepair.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4StreamAcceptanceBlockerRepair();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4StreamAcceptanceBlockerRepair,
};
