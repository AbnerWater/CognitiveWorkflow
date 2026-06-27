const fs = require("node:fs");
const path = require("node:path");

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

const forbiddenFragments = [
  "Review repair plan now",
  "Confirm workflow handoff",
  "Resume local request",
  "cw-w1-5-189-a4-capture-matrix",
  "AppData",
  "outputDir",
  "outputPath",
  "jsonPath",
  "token=",
  "#hash",
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

function assertBasenameOnly(value, message) {
  assertCondition(typeof value === "string" && value.length > 0, message);
  assertCondition(
    !value.includes("/") && !value.includes("\\"),
    `${message} must be a file name, not a path`,
  );
}

function validateMatrixManifest(matrix, capture) {
  assertSanitizedJson(matrix, "matrix manifest");
  assertEqual(
    matrix.outputEvidence.manifestFileName,
    capture.visual_smoke_matrix_capture.output_evidence.manifest_file_name,
    "matrix manifest file name",
  );
  assertEqual(
    matrix.outputEvidence.caseCount,
    capture.visual_smoke_matrix_capture.output_evidence.case_count,
    "matrix case count",
  );
  assertEqual(
    matrix.outputEvidence.caseCount,
    matrix.cases.length,
    "matrix output case count",
  );
  assertEqual(matrix.failures.length, 0, "matrix failure count");
  assertDeepEqual(
    matrix.targetLocation,
    capture.visual_smoke_matrix_capture.target,
    "matrix target location",
  );

  const observedCaseNames = matrix.cases.map((testCase) => testCase.name);
  assertDeepEqual(
    sorted(capture.visual_smoke_matrix_capture.observed_case_names),
    sorted(observedCaseNames),
    "observed matrix case names",
  );
  for (const caseName of capture.visual_smoke_matrix_capture
    .required_case_names) {
    assertCondition(
      observedCaseNames.includes(caseName),
      `matrix missing required case ${caseName}`,
    );
  }
  for (const testCase of matrix.cases) {
    assertEqual(testCase.process.exitCode, 0, `${testCase.name} exit code`);
    assertEqual(testCase.process.stderrLength, 0, `${testCase.name} stderr`);
    assertEqual(testCase.failures.length, 0, `${testCase.name} failures`);
    assertEqual(
      testCase.horizontalOverflow,
      0,
      `${testCase.name} horizontal overflow`,
    );
    assertBasenameOnly(
      testCase.outputEvidence.outputFileName,
      `${testCase.name} output file name`,
    );
    assertBasenameOnly(
      testCase.outputEvidence.jsonFileName,
      `${testCase.name} JSON file name`,
    );
  }
}

function validateA4CaptureExecution(options = {}) {
  const capture = readJson(options.capturePath ?? capturePath);
  const a4Manifest = readJson(options.a4ManifestPath ?? a4ManifestPath);
  const matrix = readJson(options.matrixManifestPath ?? matrixManifestPath);

  assertSanitizedJson(capture, "capture execution artifact");
  assertEqual(capture.schema_version, "0.1.0", "schema version");
  assertEqual(capture.milestone, "M1.5", "milestone");
  assertEqual(capture.slice, "W1.5.207", "slice id");
  assertEqual(
    capture.capture_status,
    "a4_capture_executed_not_accepted",
    "capture status",
  );
  assertEqual(capture.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    capture.visual_smoke_matrix_capture.execution_status,
    "executed_passed",
    "matrix execution status",
  );
  assertEqual(
    capture.visual_smoke_matrix_capture.raw_output_dir_recorded,
    false,
    "matrix raw output dir flag",
  );
  assertEqual(
    capture.visual_smoke_matrix_capture.query_hash_recorded,
    false,
    "matrix query/hash flag",
  );
  assertEqual(
    capture.visual_smoke_matrix_capture.matrix_manifest_artifact,
    "docs/04_runbook/m1.5-a4-capture-matrix.json",
    "matrix artifact path",
  );

  validateMatrixManifest(matrix, capture);

  const manifestItemsById = new Map(
    a4Manifest.review_items.map((item) => [item.id, item]),
  );
  const captureItemsByReviewId = new Map(
    capture.review_item_captures.map((item) => [item.review_item_id, item]),
  );
  assertDeepEqual(
    sorted([...captureItemsByReviewId.keys()]),
    sorted([...manifestItemsById.keys()]),
    "capture review item ids",
  );

  const bridgeCommandsById = new Map(
    capture.bridge_command_evidence.map((command) => [command.id, command]),
  );
  let streamCaptureCount = 0;
  let bridgeCaptureCount = 0;
  for (const manifestItem of a4Manifest.review_items) {
    const captureItem = captureItemsByReviewId.get(manifestItem.id);
    assertCondition(
      Boolean(captureItem),
      `missing capture for ${manifestItem.id}`,
    );
    assertEqual(
      captureItem.fr_id,
      manifestItem.fr_id,
      `${captureItem.id} FR id`,
    );
    assertEqual(
      captureItem.review_group,
      manifestItem.review_group,
      `${captureItem.id} review group`,
    );
    assertEqual(
      captureItem.capture_status,
      "captured_not_accepted",
      `${captureItem.id} capture status`,
    );
    assertEqual(
      captureItem.source_review_status,
      manifestItem.review_status,
      `${captureItem.id} source review status`,
    );
    assertEqual(
      manifestItem.review_status,
      "pending_a4_review",
      `${captureItem.id} manifest review status`,
    );
    assertDeepEqual(
      captureItem.missing_before_acceptance,
      manifestItem.missing_before_acceptance,
      `${captureItem.id} missing before acceptance`,
    );
    if (manifestItem.review_group === "candidate_stream_evidence") {
      streamCaptureCount += 1;
      assertDeepEqual(
        captureItem.observed_matrix_cases,
        manifestItem.required_matrix_cases,
        `${captureItem.id} observed matrix cases`,
      );
      assertDeepEqual(
        captureItem.observed_evidence_fields,
        manifestItem.required_evidence_fields,
        `${captureItem.id} observed evidence fields`,
      );
      for (const caseName of captureItem.observed_matrix_cases) {
        assertCondition(
          capture.visual_smoke_matrix_capture.observed_case_names.includes(
            caseName,
          ),
          `${captureItem.id} references unobserved matrix case ${caseName}`,
        );
      }
    } else if (manifestItem.review_group === "runtime_bridge_evidence") {
      bridgeCaptureCount += 1;
      assertDeepEqual(
        captureItem.observed_matrix_cases,
        [],
        `${captureItem.id} bridge capture must not invent matrix cases`,
      );
      assertDeepEqual(
        captureItem.observed_a4_evidence_inputs,
        manifestItem.required_a4_evidence_inputs,
        `${captureItem.id} bridge evidence inputs`,
      );
      const command = bridgeCommandsById.get(captureItem.bridge_command_id);
      assertCondition(
        Boolean(command),
        `${captureItem.id} must reference bridge command evidence`,
      );
      assertEqual(
        command.fr_id,
        captureItem.fr_id,
        `${captureItem.id} command FR`,
      );
      assertEqual(
        command.execution_status,
        "executed_passed",
        `${captureItem.id} command status`,
      );
      assertEqual(
        command.accepted,
        false,
        `${captureItem.id} command accepted`,
      );
      assertCondition(
        manifestItem.required_commands.includes(command.command),
        `${captureItem.id} command must come from A4 manifest required commands`,
      );
    } else {
      throw new Error(`${manifestItem.id} has unsupported review group`);
    }
  }

  assertEqual(
    capture.summary.review_item_count,
    capture.review_item_captures.length,
    "summary review item count",
  );
  assertEqual(
    capture.summary.stream_capture_items,
    streamCaptureCount,
    "summary stream capture count",
  );
  assertEqual(
    capture.summary.bridge_capture_items,
    bridgeCaptureCount,
    "summary bridge capture count",
  );
  assertEqual(
    capture.summary.matrix_case_count,
    matrix.cases.length,
    "summary matrix case count",
  );
  assertEqual(
    capture.summary.required_matrix_case_count,
    capture.visual_smoke_matrix_capture.required_case_names.length,
    "summary required matrix case count",
  );
  assertEqual(capture.summary.accepted_items, 0, "summary accepted items");
  assertEqual(
    capture.summary.pending_a4_review_items,
    capture.review_item_captures.length,
    "summary pending A4 review items",
  );
  assertEqual(
    capture.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.status,
    capture.capture_status,
    "runner status",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.review_item_count,
    capture.review_item_captures.length,
    "runner review item count",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.stream_capture_item_count,
    streamCaptureCount,
    "runner stream capture item count",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.bridge_capture_item_count,
    bridgeCaptureCount,
    "runner bridge capture item count",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.matrix_case_count,
    matrix.cases.length,
    "runner matrix case count",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.accepted_item_count,
    0,
    "runner accepted item count",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.pending_a4_review_item_count,
    capture.review_item_captures.length,
    "runner pending A4 review item count",
  );
  assertEqual(
    capture.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
    "runner summary-only flag",
  );
  assertDeepEqual(
    capture.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.208"],
    "next recommended slices",
  );

  return {
    status: capture.capture_status,
    exitP1_1Status: capture.exit_p1_1_status,
    reviewItemCount: capture.review_item_captures.length,
    streamCaptureItemCount: streamCaptureCount,
    bridgeCaptureItemCount: bridgeCaptureCount,
    matrixCaseCount: matrix.cases.length,
    requiredMatrixCases:
      capture.visual_smoke_matrix_capture.required_case_names,
    acceptedItemCount: capture.summary.accepted_items,
    pendingA4ReviewItemCount: capture.summary.pending_a4_review_items,
    nextRecommendedSlices: capture.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4CaptureExecution();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  capturePath,
  matrixManifestPath,
  validateA4CaptureExecution,
};
