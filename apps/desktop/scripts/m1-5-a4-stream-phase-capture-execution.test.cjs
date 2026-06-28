const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4StreamPhaseCaptureExecution,
} = require("./m1-5-a4-stream-phase-capture-execution.cjs");

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
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRequiredMatrixCases = [
  "known-desktop",
  "known-mobile",
  "unknown-desktop",
  "unknown-mobile",
  "unknown-mobile-scroll-900",
  "unknown-mobile-scroll-1440",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeJsonFixture(prefix, fileName, value) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

test("M1.5 A4 stream phase capture returns a conservative summary", () => {
  const summary = validateA4StreamPhaseCaptureExecution();

  assert.equal(summary.status, "a4_stream_phase_capture_executed_not_accepted");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.phaseCaptureItemCount, 3);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedStreamFrIds));
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingA4ReviewItemCount, 3);
  assert.equal(summary.matrixCaseCount, 8);
  assert.equal(summary.streamRequiredCaseCount, 6);
  assert.deepEqual(
    sorted(summary.requiredMatrixCases),
    sorted(expectedRequiredMatrixCases),
  );
  assert.deepEqual(
    sorted(summary.excludedTrackIds),
    sorted(["TRACK-A4-RUNTIME-BRIDGE-CAPTURE", "TRACK-A8-GIT-HISTORY-PREREQ"]),
  );
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.211"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 stream phase capture mirrors W1.5.209 repair track and W1.5.208 decisions", () => {
  const streamCapture = readJson(streamCapturePath);
  const repairPlan = readJson(repairPlanPath);
  const decisionRecord = readJson(decisionRecordPath);
  const streamRepairItems = repairPlan.repair_items.filter(
    (item) => item.track_id === "TRACK-A4-STREAM-PHASE-CAPTURE",
  );

  assert.equal(streamCapture.slice, "W1.5.210");
  assert.equal(repairPlan.slice, "W1.5.209");
  assert.equal(decisionRecord.slice, "W1.5.208");
  assert.deepEqual(
    sorted(streamCapture.phase_capture_items.map((item) => item.fr_id)),
    sorted(streamRepairItems.map((item) => item.fr_id)),
  );
  assert.deepEqual(
    sorted(streamCapture.phase_capture_items.map((item) => item.fr_id)),
    sorted(expectedStreamFrIds),
  );

  const decisionById = new Map(
    decisionRecord.decision_items.map((item) => [item.id, item]),
  );
  for (const phaseItem of streamCapture.phase_capture_items) {
    const decision = decisionById.get(phaseItem.source_decision_id);
    assert.ok(decision, `${phaseItem.id} decision exists`);
    assert.equal(decision.decision, "needs_followup");
    assert.equal(phaseItem.source_decision, "needs_followup");
    assert.equal(phaseItem.source_repair_status, "planned_not_implemented");
    assert.equal(phaseItem.phase_capture_status, "executed_not_accepted");
    assert.equal(phaseItem.accepted, false);
  }
});

test("M1.5 A4 stream phase capture reuses passed matrix and source capture evidence", () => {
  const streamCapture = readJson(streamCapturePath);
  const sourceCapture = readJson(sourceCapturePath);
  const matrix = readJson(matrixManifestPath);
  const sourceCapturesById = new Map(
    sourceCapture.review_item_captures.map((item) => [item.id, item]),
  );

  assert.equal(matrix.outputEvidence.caseCount, 8);
  assert.equal(matrix.failures.length, 0);
  assert.equal(
    streamCapture.stream_required_case_capture.execution_status,
    "executed_passed",
  );
  assert.deepEqual(
    sorted(streamCapture.stream_required_case_capture.case_names),
    sorted(expectedRequiredMatrixCases),
  );
  assert.equal(
    streamCapture.stream_required_case_capture
      .chat_enabled_optional_context_in_scope,
    false,
  );
  assert.deepEqual(
    sorted(streamCapture.visual_smoke_matrix_capture.observed_case_names),
    sorted(matrix.cases.map((item) => item.name)),
  );
  for (const matrixCase of matrix.cases) {
    assert.equal(matrixCase.process.exitCode, 0);
    assert.equal(matrixCase.process.stderrLength, 0);
    assert.deepEqual(matrixCase.failures, []);
    assert.equal(matrixCase.horizontalOverflow, 0);
  }

  for (const phaseItem of streamCapture.phase_capture_items) {
    const sourceCaptureItem = sourceCapturesById.get(
      phaseItem.source_capture_id,
    );
    assert.ok(sourceCaptureItem, `${phaseItem.id} source capture exists`);
    assert.deepEqual(
      phaseItem.observed_matrix_cases,
      sourceCaptureItem.observed_matrix_cases,
    );
    assert.deepEqual(
      phaseItem.observed_evidence_fields,
      sourceCaptureItem.observed_evidence_fields,
    );
  }
});

test("M1.5 A4 stream phase capture rejects accepted item drift", () => {
  const streamCapture = readJson(streamCapturePath);
  streamCapture.phase_capture_items[0].accepted = true;
  streamCapture.summary.accepted_items = 1;
  const mutatedStreamCapturePath = writeJsonFixture(
    "cw-a4-stream-capture-accepted-",
    "stream-capture.json",
    streamCapture,
  );

  assert.throws(
    () =>
      validateA4StreamPhaseCaptureExecution({
        streamCapturePath: mutatedStreamCapturePath,
      }),
    /accepted flag|summary accepted/u,
  );
});

test("M1.5 A4 stream phase capture rejects runtime bridge item drift", () => {
  const streamCapture = readJson(streamCapturePath);
  streamCapture.phase_capture_items.push({
    ...streamCapture.phase_capture_items[0],
    id: "PHASE-CAPTURE-A4-FR-007-EXECUTION-MODE-BRIDGE",
    fr_id: "FR-007",
    repair_item_id: "REPAIR-A4-FR-007-EXECUTION-MODE-BRIDGE",
    source_decision_id: "DECISION-A4-FR-007-EXECUTION-MODE-BRIDGE",
    source_capture_id: "CAPTURE-A4-FR-007-EXECUTION-MODE-BRIDGE",
  });
  streamCapture.summary.phase_capture_item_count += 1;
  const mutatedStreamCapturePath = writeJsonFixture(
    "cw-a4-stream-capture-bridge-",
    "stream-capture.json",
    streamCapture,
  );

  assert.throws(
    () =>
      validateA4StreamPhaseCaptureExecution({
        streamCapturePath: mutatedStreamCapturePath,
      }),
    /phase capture item count|phase capture FR ids/u,
  );
});

test("M1.5 A4 stream phase capture rejects FR-015 drift", () => {
  const streamCapture = readJson(streamCapturePath);
  streamCapture.phase_capture_items[0].fr_id = "FR-015";
  const mutatedStreamCapturePath = writeJsonFixture(
    "cw-a4-stream-capture-fr015-",
    "stream-capture.json",
    streamCapture,
  );

  assert.throws(
    () =>
      validateA4StreamPhaseCaptureExecution({
        streamCapturePath: mutatedStreamCapturePath,
      }),
    /phase capture FR ids|FR-015 phase capture absence/u,
  );
});

test("M1.5 A4 stream phase capture rejects matrix failure drift", () => {
  const matrix = readJson(matrixManifestPath);
  matrix.cases[0].failures.push("unexpected stream overflow");
  const mutatedMatrixPath = writeJsonFixture(
    "cw-a4-stream-capture-matrix-",
    "matrix.json",
    matrix,
  );

  assert.throws(
    () =>
      validateA4StreamPhaseCaptureExecution({
        matrixManifestPath: mutatedMatrixPath,
      }),
    /known-desktop failures/u,
  );
});

test("M1.5 A4 stream phase capture test is wired into desktop package gates", () => {
  const streamCapture = readJson(streamCapturePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-stream-phase-capture-execution\.test\.cjs/u,
  );
  assert.deepEqual(
    streamCapture.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.211"],
  );
});
