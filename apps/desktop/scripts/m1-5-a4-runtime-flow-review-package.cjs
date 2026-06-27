const fs = require("node:fs");
const path = require("node:path");

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
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

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

function validateA4RuntimeFlowReviewPackage(options = {}) {
  const reviewPackage = readJson(
    options.reviewPackagePath ?? reviewPackagePath,
  );
  const manifest = readJson(options.a4ManifestPath ?? a4ManifestPath);
  const capture = readJson(options.capturePath ?? capturePath);
  const evidenceMap = readJson(options.evidenceMapPath ?? evidenceMapPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(reviewPackage, "A4 runtime-flow review package");
  assertEqual(reviewPackage.schema_version, "0.1.0", "schema version");
  assertEqual(reviewPackage.milestone, "M1.5", "milestone");
  assertEqual(reviewPackage.slice, "W1.5.202", "slice id");
  assertEqual(
    reviewPackage.package_status,
    "a4_runtime_flow_review_package_prepared_not_accepted",
    "package status",
  );
  assertEqual(reviewPackage.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    reviewPackage.reviewer_contract.required_reviewer,
    "A4 ux-acceptance-reviewer",
    "required reviewer",
  );

  assertEqual(manifest.slice, "W1.5.202", "manifest source slice");
  assertEqual(capture.slice, "W1.5.202", "capture source slice");
  assertEqual(
    manifest.summary.accepted_items,
    0,
    "manifest accepted item count",
  );
  assertEqual(capture.summary.accepted_items, 0, "capture accepted item count");
  assertEqual(
    evidenceMap.exit_p1_1_status,
    "not_ready",
    "evidence map EXIT-P1-1 status",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );

  const manifestItemsById = new Map(
    manifest.review_items.map((item) => [item.id, item]),
  );
  const captureItemsById = new Map(
    capture.review_item_captures.map((item) => [item.id, item]),
  );
  const captureItemsByReviewId = new Map(
    capture.review_item_captures.map((item) => [item.review_item_id, item]),
  );
  const evidenceById = new Map(
    evidenceMap.fr_evidence_items.map((item) => [item.id, item]),
  );

  const candidateFrIds = evidenceMap.fr_evidence_items
    .filter(
      (item) =>
        item.acceptance_readiness === "candidate_evidence_needs_a4_review",
    )
    .map((item) => item.id);
  const runtimeBridgeFrIds = evidenceMap.fr_evidence_items
    .filter(
      (item) => item.acceptance_readiness === "runtime_bridge_needs_a4_review",
    )
    .map((item) => item.id);
  const excludedPartialBridgeFrIds = evidenceMap.fr_evidence_items
    .filter(
      (item) =>
        item.acceptance_readiness ===
        "partial_runtime_bridge_requires_followup",
    )
    .map((item) => item.id);
  const expectedIncludedFrIds = sorted([
    ...candidateFrIds,
    ...runtimeBridgeFrIds,
  ]);

  assertDeepEqual(
    sorted(reviewPackage.package_scope.included_fr_ids),
    expectedIncludedFrIds,
    "included FR ids",
  );
  assertDeepEqual(
    sorted(reviewPackage.package_scope.included_stream_candidate_fr_ids),
    sorted(candidateFrIds),
    "stream candidate FR ids",
  );
  assertDeepEqual(
    sorted(reviewPackage.package_scope.included_runtime_bridge_fr_ids),
    sorted(runtimeBridgeFrIds),
    "runtime bridge FR ids",
  );
  assertDeepEqual(
    sorted(reviewPackage.package_scope.excluded_partial_runtime_bridge_fr_ids),
    sorted(excludedPartialBridgeFrIds),
    "excluded partial runtime bridge FR ids",
  );
  const packageItems = reviewPackage.review_package_items;
  assertEqual(
    packageItems.length,
    manifest.review_items.length,
    "package item count",
  );
  assertDeepEqual(
    sorted(packageItems.map((item) => item.review_item_id)),
    sorted(manifest.review_items.map((item) => item.id)),
    "package review item ids",
  );
  assertDeepEqual(
    sorted(packageItems.map((item) => item.capture_id)),
    sorted(capture.review_item_captures.map((item) => item.id)),
    "package capture ids",
  );

  let streamCandidateItemCount = 0;
  let runtimeBridgeItemCount = 0;
  for (const packageItem of packageItems) {
    const manifestItem = manifestItemsById.get(packageItem.review_item_id);
    const captureItem = captureItemsById.get(packageItem.capture_id);
    const captureByReviewId = captureItemsByReviewId.get(
      packageItem.review_item_id,
    );
    const evidenceItem = evidenceById.get(packageItem.fr_id);

    assertCondition(
      Boolean(manifestItem),
      `${packageItem.id} references missing manifest review item`,
    );
    assertCondition(
      Boolean(captureItem),
      `${packageItem.id} references missing capture item`,
    );
    assertCondition(
      captureByReviewId?.id === packageItem.capture_id,
      `${packageItem.id} capture id must match review item id`,
    );
    assertCondition(
      Boolean(evidenceItem),
      `${packageItem.id} references missing evidence map item`,
    );
    assertEqual(
      packageItem.fr_id,
      manifestItem.fr_id,
      `${packageItem.id} manifest FR id`,
    );
    assertEqual(
      packageItem.fr_id,
      captureItem.fr_id,
      `${packageItem.id} capture FR id`,
    );
    assertEqual(
      packageItem.review_group,
      manifestItem.review_group,
      `${packageItem.id} manifest review group`,
    );
    assertEqual(
      packageItem.review_group,
      captureItem.review_group,
      `${packageItem.id} capture review group`,
    );
    assertEqual(
      packageItem.package_status,
      "ready_for_a4_review_not_accepted",
      `${packageItem.id} package status`,
    );
    assertEqual(
      packageItem.reviewer_decision_required,
      true,
      `${packageItem.id} reviewer decision flag`,
    );
    assertEqual(
      manifestItem.review_status,
      "pending_a4_review",
      `${packageItem.id} manifest status`,
    );
    assertEqual(
      captureItem.capture_status,
      "captured_not_accepted",
      `${packageItem.id} capture status`,
    );
    assertEqual(
      captureItem.source_review_status,
      "pending_a4_review",
      `${packageItem.id} capture source status`,
    );
    assertEqual(
      manifestItem.source_acceptance_readiness,
      evidenceItem.acceptance_readiness,
      `${packageItem.id} evidence readiness`,
    );
    assertCondition(
      packageItem.acceptance_inputs.length > 0,
      `${packageItem.id} must list acceptance inputs`,
    );

    if (packageItem.review_group === "candidate_stream_evidence") {
      streamCandidateItemCount += 1;
      assertEqual(
        manifestItem.source_acceptance_readiness,
        "candidate_evidence_needs_a4_review",
        `${packageItem.id} candidate readiness`,
      );
      assertCondition(
        captureItem.observed_matrix_cases.length > 0,
        `${packageItem.id} must include observed matrix cases`,
      );
    } else if (packageItem.review_group === "runtime_bridge_evidence") {
      runtimeBridgeItemCount += 1;
      assertEqual(
        manifestItem.source_acceptance_readiness,
        "runtime_bridge_needs_a4_review",
        `${packageItem.id} runtime bridge readiness`,
      );
      assertDeepEqual(
        captureItem.observed_matrix_cases,
        [],
        `${packageItem.id} bridge item must not invent matrix cases`,
      );
      assertCondition(
        captureItem.observed_a4_evidence_inputs.length > 0,
        `${packageItem.id} bridge item must list evidence inputs`,
      );
    } else {
      throw new Error(`${packageItem.id} has unsupported review group`);
    }
  }

  assertEqual(
    streamCandidateItemCount,
    candidateFrIds.length,
    "stream candidate item count",
  );
  assertEqual(
    runtimeBridgeItemCount,
    runtimeBridgeFrIds.length,
    "runtime bridge item count",
  );
  assertEqual(
    reviewPackage.summary.review_item_count,
    packageItems.length,
    "summary review item count",
  );
  assertEqual(
    reviewPackage.summary.stream_candidate_items,
    streamCandidateItemCount,
    "summary stream candidate count",
  );
  assertEqual(
    reviewPackage.summary.runtime_bridge_items,
    runtimeBridgeItemCount,
    "summary runtime bridge count",
  );
  assertEqual(
    reviewPackage.summary.excluded_partial_runtime_bridge_items,
    excludedPartialBridgeFrIds.length,
    "summary excluded partial bridge count",
  );
  assertEqual(
    reviewPackage.summary.accepted_items,
    0,
    "summary accepted item count",
  );
  assertEqual(
    reviewPackage.summary.pending_a4_review_items,
    packageItems.length,
    "summary pending A4 review count",
  );
  assertEqual(
    reviewPackage.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertEqual(
    reviewPackage.reviewer_contract.runner_output_contract.review_item_count,
    packageItems.length,
    "runner review item count",
  );
  assertEqual(
    reviewPackage.reviewer_contract.runner_output_contract
      .stream_candidate_item_count,
    streamCandidateItemCount,
    "runner stream candidate count",
  );
  assertEqual(
    reviewPackage.reviewer_contract.runner_output_contract
      .runtime_bridge_item_count,
    runtimeBridgeItemCount,
    "runner runtime bridge count",
  );
  assertEqual(
    reviewPackage.reviewer_contract.runner_output_contract
      .excluded_partial_runtime_bridge_item_count,
    excludedPartialBridgeFrIds.length,
    "runner excluded partial bridge count",
  );
  assertEqual(
    reviewPackage.reviewer_contract.runner_output_contract.accepted_item_count,
    0,
    "runner accepted item count",
  );
  assertEqual(
    reviewPackage.reviewer_contract.runner_output_contract
      .pending_a4_review_item_count,
    packageItems.length,
    "runner pending A4 review item count",
  );
  assertEqual(
    reviewPackage.reviewer_contract.runner_output_contract
      .sanitized_summary_only,
    true,
    "runner sanitized summary flag",
  );
  assertEqual(
    reviewPackage.reviewer_contract.decision_contract
      .requires_separate_a4_review_record,
    true,
    "separate A4 review record flag",
  );
  assertEqual(
    reviewPackage.reviewer_contract.decision_contract
      .package_accepted_item_count_must_remain_zero,
    true,
    "package accepted count guard",
  );
  assertDeepEqual(
    reviewPackage.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.203"],
    "next recommended slices",
  );

  return {
    status: reviewPackage.package_status,
    exitP1_1Status: reviewPackage.exit_p1_1_status,
    reviewItemCount: packageItems.length,
    frIds: packageItems.map((item) => item.fr_id),
    streamCandidateFrIds:
      reviewPackage.package_scope.included_stream_candidate_fr_ids,
    runtimeBridgeFrIds:
      reviewPackage.package_scope.included_runtime_bridge_fr_ids,
    excludedPartialRuntimeBridgeFrIds:
      reviewPackage.package_scope.excluded_partial_runtime_bridge_fr_ids,
    acceptedItemCount: reviewPackage.summary.accepted_items,
    pendingA4ReviewItemCount: reviewPackage.summary.pending_a4_review_items,
    nextRecommendedSlices: reviewPackage.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4RuntimeFlowReviewPackage();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  reviewPackagePath,
  validateA4RuntimeFlowReviewPackage,
};
