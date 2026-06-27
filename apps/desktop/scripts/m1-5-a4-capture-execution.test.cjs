const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4CaptureExecution,
} = require("./m1-5-a4-capture-execution.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const capturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-capture-execution.json",
);
const a4ManifestPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-evidence-manifest.json",
);
const matrixManifestPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-capture-matrix.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedBridgeFrIds = ["FR-007", "FR-008", "FR-012", "FR-013", "FR-017"];
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

test("M1.5 A4 capture execution runner returns a sanitized conservative summary", () => {
  const summary = validateA4CaptureExecution();

  assert.equal(summary.status, "a4_capture_executed_not_accepted");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.reviewItemCount, 8);
  assert.equal(summary.streamCaptureItemCount, 3);
  assert.equal(summary.bridgeCaptureItemCount, 5);
  assert.equal(summary.matrixCaseCount, 8);
  assert.deepEqual(
    sorted(summary.requiredMatrixCases),
    sorted(expectedRequiredMatrixCases),
  );
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.pendingA4ReviewItemCount, 8);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.200"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 capture execution mirrors the W1.5.199 A4 manifest", () => {
  const capture = readJson(capturePath);
  const a4Manifest = readJson(a4ManifestPath);
  const captureByReviewId = new Map(
    capture.review_item_captures.map((item) => [item.review_item_id, item]),
  );

  assert.equal(capture.schema_version, "0.1.0");
  assert.equal(capture.slice, "W1.5.199");
  assert.equal(capture.capture_status, "a4_capture_executed_not_accepted");
  assert.equal(capture.exit_p1_1_status, "not_ready");
  assert.deepEqual(
    sorted([...captureByReviewId.keys()]),
    sorted(a4Manifest.review_items.map((item) => item.id)),
  );

  for (const manifestItem of a4Manifest.review_items) {
    const captureItem = captureByReviewId.get(manifestItem.id);
    assert.ok(captureItem);
    assert.equal(captureItem.fr_id, manifestItem.fr_id);
    assert.equal(captureItem.review_group, manifestItem.review_group);
    assert.equal(captureItem.capture_status, "captured_not_accepted");
    assert.equal(captureItem.source_review_status, "pending_a4_review");
    assert.deepEqual(
      captureItem.missing_before_acceptance,
      manifestItem.missing_before_acceptance,
    );
  }
});

test("M1.5 A4 capture matrix artifact is sanitized and all cases passed", () => {
  const capture = readJson(capturePath);
  const matrix = readJson(matrixManifestPath);
  const matrixText = JSON.stringify(matrix);

  assert.equal(matrix.outputEvidence.manifestFileName, "matrix.json");
  assert.equal(matrix.outputEvidence.caseCount, 8);
  assert.equal(matrix.cases.length, 8);
  assert.deepEqual(matrix.failures, []);
  assert.equal(matrixText.includes("cw-w1-5-189-a4-capture-matrix"), false);
  assert.equal(matrixText.includes("Review repair plan now"), false);
  assert.equal(matrixText.includes("Confirm workflow handoff"), false);
  assert.equal(matrixText.includes("Resume local request"), false);
  assert.equal(matrixText.includes("outputPath"), false);
  assert.equal(matrixText.includes("outputDir"), false);
  assert.deepEqual(
    sorted(matrix.cases.map((item) => item.name)),
    sorted(capture.visual_smoke_matrix_capture.observed_case_names),
  );

  for (const testCase of matrix.cases) {
    assert.equal(testCase.process.exitCode, 0);
    assert.equal(testCase.process.stderrLength, 0);
    assert.deepEqual(testCase.failures, []);
    assert.equal(testCase.horizontalOverflow, 0);
    assert.equal(testCase.outputEvidence.outputFileName.includes("\\"), false);
    assert.equal(testCase.outputEvidence.outputFileName.includes("/"), false);
    assert.equal(testCase.outputEvidence.jsonFileName.includes("\\"), false);
    assert.equal(testCase.outputEvidence.jsonFileName.includes("/"), false);
  }
});

test("M1.5 A4 capture execution keeps stream and bridge evidence separated", () => {
  const capture = readJson(capturePath);
  const capturesByFrId = new Map(
    capture.review_item_captures.map((item) => [item.fr_id, item]),
  );

  for (const frId of expectedStreamFrIds) {
    const captureItem = capturesByFrId.get(frId);
    assert.ok(captureItem);
    assert.equal(captureItem.review_group, "candidate_stream_evidence");
    assert.equal(captureItem.observed_matrix_cases.length > 0, true);
    assert.equal(captureItem.observed_evidence_fields.length > 0, true);
  }
  for (const frId of expectedBridgeFrIds) {
    const captureItem = capturesByFrId.get(frId);
    assert.ok(captureItem);
    assert.equal(captureItem.review_group, "runtime_bridge_evidence");
    assert.deepEqual(captureItem.observed_matrix_cases, []);
    assert.equal(captureItem.observed_a4_evidence_inputs.length > 0, true);
    assert.equal(typeof captureItem.bridge_command_id, "string");
  }
});

test("M1.5 A4 capture execution summary does not claim acceptance", () => {
  const capture = readJson(capturePath);

  assert.equal(
    capture.summary.review_item_count,
    capture.review_item_captures.length,
  );
  assert.equal(
    capture.summary.stream_capture_items,
    expectedStreamFrIds.length,
  );
  assert.equal(
    capture.summary.bridge_capture_items,
    expectedBridgeFrIds.length,
  );
  assert.equal(capture.summary.accepted_items, 0);
  assert.equal(
    capture.summary.pending_a4_review_items,
    capture.review_item_captures.length,
  );
  assert.equal(capture.summary.exit_p1_1_status, "not_ready");
  assert.equal(
    capture.review_item_captures.some(
      (item) => item.capture_status === "accepted",
    ),
    false,
  );
  assert.equal(
    capture.bridge_command_evidence.some((item) => item.accepted === true),
    false,
  );
});

test("M1.5 A4 capture execution rejects matrix failures", () => {
  const matrix = readJson(matrixManifestPath);
  matrix.failures.push("known-desktop: unexpected overflow");
  const mutatedMatrixPath = writeJsonFixture(
    "cw-a4-capture-matrix-failure-",
    "matrix.json",
    matrix,
  );

  assert.throws(
    () => validateA4CaptureExecution({ matrixManifestPath: mutatedMatrixPath }),
    /matrix failure count/u,
  );
});

test("M1.5 A4 capture execution rejects raw output path leakage", () => {
  const matrix = readJson(matrixManifestPath);
  matrix.cases[0].outputEvidence.outputFileName =
    "C:\\Users\\admin\\AppData\\Local\\Temp\\known-desktop.png";
  const mutatedMatrixPath = writeJsonFixture(
    "cw-a4-capture-matrix-path-",
    "matrix.json",
    matrix,
  );

  assert.throws(
    () => validateA4CaptureExecution({ matrixManifestPath: mutatedMatrixPath }),
    /forbidden fragment AppData|output file name must be a file name/u,
  );
});

test("M1.5 A4 capture execution rejects acceptance drift", () => {
  const capture = readJson(capturePath);
  capture.review_item_captures[0].capture_status = "accepted";
  const mutatedCapturePath = writeJsonFixture(
    "cw-a4-capture-accepted-",
    "capture.json",
    capture,
  );

  assert.throws(
    () => validateA4CaptureExecution({ capturePath: mutatedCapturePath }),
    /CAPTURE-A4-FR-009-STREAM-COLLAPSED capture status/u,
  );
});

test("M1.5 A4 capture execution test is wired into desktop package gates", () => {
  const capture = readJson(capturePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-capture-execution\.test\.cjs/u,
  );
  assert.equal(
    capture.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-capture-execution.test.cjs",
  );
  assert.equal(
    capture.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-capture-execution.cjs --check",
  );
  assert.equal(
    capture.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
  );
});
