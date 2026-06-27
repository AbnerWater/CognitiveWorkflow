const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4RuntimeFlowReviewPackage,
} = require("./m1-5-a4-runtime-flow-review-package.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const reviewPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-review-package.json",
);
const a4ManifestPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-evidence-manifest.json",
);
const capturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-capture-execution.json",
);
const evidenceMapPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-fr-evidence-map.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamCandidateFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRuntimeBridgeFrIds = [
  "FR-007",
  "FR-008",
  "FR-012",
  "FR-013",
  "FR-017",
];
const expectedExcludedPartialBridgeFrIds = [
  "FR-011",
  "FR-014",
  "FR-015",
  "FR-018",
];
const expectedReviewFrIds = [
  ...expectedStreamCandidateFrIds,
  ...expectedRuntimeBridgeFrIds,
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedPackage(mutator) {
  const reviewPackage = readJson(reviewPackagePath);
  mutator(reviewPackage);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-a4-package-"));
  const mutatedPackagePath = path.join(tempDir, "review-package.json");
  fs.writeFileSync(mutatedPackagePath, JSON.stringify(reviewPackage, null, 2));
  return mutatedPackagePath;
}

test("M1.5 A4 runtime-flow review package returns a sanitized conservative summary", () => {
  const summary = validateA4RuntimeFlowReviewPackage();

  assert.equal(
    summary.status,
    "a4_runtime_flow_review_package_prepared_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.reviewItemCount, 8);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedReviewFrIds));
  assert.deepEqual(
    sorted(summary.streamCandidateFrIds),
    expectedStreamCandidateFrIds,
  );
  assert.deepEqual(
    sorted(summary.runtimeBridgeFrIds),
    expectedRuntimeBridgeFrIds,
  );
  assert.deepEqual(
    sorted(summary.excludedPartialRuntimeBridgeFrIds),
    expectedExcludedPartialBridgeFrIds,
  );
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.pendingA4ReviewItemCount, 8);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.200"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 runtime-flow review package mirrors manifest and capture ids", () => {
  const reviewPackage = readJson(reviewPackagePath);
  const manifest = readJson(a4ManifestPath);
  const capture = readJson(capturePath);

  assert.equal(reviewPackage.schema_version, "0.1.0");
  assert.equal(reviewPackage.slice, "W1.5.199");
  assert.equal(reviewPackage.exit_p1_1_status, "not_ready");
  assert.equal(manifest.summary.accepted_items, 0);
  assert.equal(capture.summary.accepted_items, 0);
  assert.deepEqual(
    sorted(
      reviewPackage.review_package_items.map((item) => item.review_item_id),
    ),
    sorted(manifest.review_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(reviewPackage.review_package_items.map((item) => item.capture_id)),
    sorted(capture.review_item_captures.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(reviewPackage.package_scope.included_fr_ids),
    sorted(expectedReviewFrIds),
  );
});

test("M1.5 A4 runtime-flow review package includes FR-017 and excludes remaining partial bridge items", () => {
  const reviewPackage = readJson(reviewPackagePath);
  const evidenceMap = readJson(evidenceMapPath);
  const partialBridgeFrIds = evidenceMap.fr_evidence_items
    .filter(
      (item) =>
        item.acceptance_readiness ===
        "partial_runtime_bridge_requires_followup",
    )
    .map((item) => item.id);

  assert.deepEqual(
    sorted(reviewPackage.package_scope.excluded_partial_runtime_bridge_fr_ids),
    sorted(partialBridgeFrIds),
  );
  assert.equal(
    reviewPackage.package_scope.included_fr_ids.includes("FR-017"),
    true,
  );
  assert.match(reviewPackage.package_scope.excluded_reason, /follow-up/u);
});

test("M1.5 A4 runtime-flow review package does not claim acceptance", () => {
  const reviewPackage = readJson(reviewPackagePath);

  assert.equal(reviewPackage.summary.accepted_items, 0);
  assert.equal(
    reviewPackage.summary.pending_a4_review_items,
    reviewPackage.review_package_items.length,
  );
  assert.equal(
    reviewPackage.reviewer_contract.decision_contract
      .requires_separate_a4_review_record,
    true,
  );
  assert.equal(
    reviewPackage.reviewer_contract.decision_contract
      .package_accepted_item_count_must_remain_zero,
    true,
  );
  assert.equal(
    reviewPackage.review_package_items.every(
      (item) => item.package_status === "ready_for_a4_review_not_accepted",
    ),
    true,
  );
  assert.equal(
    reviewPackage.review_package_items.every(
      (item) => item.reviewer_decision_required === true,
    ),
    true,
  );
});

test("M1.5 A4 runtime-flow review package rejects acceptance drift", () => {
  const mutatedPackagePath = writeMutatedPackage((reviewPackage) => {
    reviewPackage.summary.accepted_items = 1;
  });

  assert.throws(
    () =>
      validateA4RuntimeFlowReviewPackage({
        reviewPackagePath: mutatedPackagePath,
      }),
    /summary accepted item count/u,
  );
});

test("M1.5 A4 runtime-flow review package test is wired into desktop package gates", () => {
  const reviewPackage = readJson(reviewPackagePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-runtime-flow-review-package\.test\.cjs/u,
  );
  assert.equal(
    reviewPackage.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-runtime-flow-review-package.test.cjs",
  );
  assert.equal(
    reviewPackage.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-runtime-flow-review-package.cjs --check",
  );
  assert.equal(
    reviewPackage.reviewer_contract.runner_output_contract
      .sanitized_summary_only,
    true,
  );
});
