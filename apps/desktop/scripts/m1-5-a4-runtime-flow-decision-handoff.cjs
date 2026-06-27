const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const decisionHandoffPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-decision-handoff.json",
);
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
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

const allowedDecisions = ["accepted", "rejected", "needs_followup"];

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

function validateA4RuntimeFlowDecisionHandoff(options = {}) {
  const handoff = readJson(options.decisionHandoffPath ?? decisionHandoffPath);
  const reviewPackage = readJson(
    options.reviewPackagePath ?? reviewPackagePath,
  );
  const manifest = readJson(options.a4ManifestPath ?? a4ManifestPath);
  const capture = readJson(options.capturePath ?? capturePath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(handoff, "A4 runtime-flow decision handoff");
  assertEqual(handoff.schema_version, "0.1.0", "schema version");
  assertEqual(handoff.milestone, "M1.5", "milestone");
  assertEqual(handoff.slice, "W1.5.200", "slice id");
  assertEqual(
    handoff.handoff_status,
    "a4_runtime_flow_decision_handoff_prepared_not_accepted",
    "handoff status",
  );
  assertEqual(handoff.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    handoff.reviewer_contract.required_reviewer,
    "A4 ux-acceptance-reviewer",
    "required reviewer",
  );
  assertDeepEqual(
    handoff.reviewer_contract.allowed_decisions,
    allowedDecisions,
    "allowed reviewer decisions",
  );
  assertEqual(
    handoff.reviewer_contract.decision_record_required,
    true,
    "decision record required flag",
  );
  assertEqual(
    handoff.reviewer_contract.decision_record_status,
    "not_recorded",
    "decision record status",
  );
  assertEqual(
    handoff.reviewer_contract.accepted_item_count_must_remain_zero,
    true,
    "accepted item guard",
  );
  assertEqual(
    handoff.reviewer_contract.phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );

  assertEqual(
    reviewPackage.package_status,
    handoff.reviewer_contract.source_package_status,
    "source package status",
  );
  assertEqual(
    reviewPackage.summary.accepted_items,
    0,
    "source package accepted item count",
  );
  assertEqual(manifest.summary.accepted_items, 0, "manifest accepted items");
  assertEqual(capture.summary.accepted_items, 0, "capture accepted items");
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );

  const packageItemsById = new Map(
    reviewPackage.review_package_items.map((item) => [item.id, item]),
  );
  const packageItemsByReviewId = new Map(
    reviewPackage.review_package_items.map((item) => [
      item.review_item_id,
      item,
    ]),
  );
  const manifestItemsById = new Map(
    manifest.review_items.map((item) => [item.id, item]),
  );
  const captureItemsById = new Map(
    capture.review_item_captures.map((item) => [item.id, item]),
  );

  assertEqual(
    handoff.decision_items.length,
    reviewPackage.review_package_items.length,
    "decision item count",
  );
  assertDeepEqual(
    sorted(handoff.decision_items.map((item) => item.package_item_id)),
    sorted(reviewPackage.review_package_items.map((item) => item.id)),
    "decision package item ids",
  );
  assertDeepEqual(
    sorted(handoff.decision_items.map((item) => item.review_item_id)),
    sorted(
      reviewPackage.review_package_items.map((item) => item.review_item_id),
    ),
    "decision review item ids",
  );
  assertDeepEqual(
    sorted(handoff.decision_items.map((item) => item.capture_id)),
    sorted(reviewPackage.review_package_items.map((item) => item.capture_id)),
    "decision capture ids",
  );

  let streamCandidateItemCount = 0;
  let runtimeBridgeItemCount = 0;
  for (const decisionItem of handoff.decision_items) {
    const packageItem = packageItemsById.get(decisionItem.package_item_id);
    const packageItemByReviewId = packageItemsByReviewId.get(
      decisionItem.review_item_id,
    );
    const manifestItem = manifestItemsById.get(decisionItem.review_item_id);
    const captureItem = captureItemsById.get(decisionItem.capture_id);

    assertCondition(
      Boolean(packageItem),
      `${decisionItem.id} references missing package item`,
    );
    assertCondition(
      packageItemByReviewId?.id === decisionItem.package_item_id,
      `${decisionItem.id} review item id must match package item`,
    );
    assertCondition(
      Boolean(manifestItem),
      `${decisionItem.id} references missing manifest item`,
    );
    assertCondition(
      Boolean(captureItem),
      `${decisionItem.id} references missing capture item`,
    );
    assertEqual(
      decisionItem.fr_id,
      packageItem.fr_id,
      `${decisionItem.id} package FR id`,
    );
    assertEqual(
      decisionItem.fr_id,
      manifestItem.fr_id,
      `${decisionItem.id} manifest FR id`,
    );
    assertEqual(
      decisionItem.fr_id,
      captureItem.fr_id,
      `${decisionItem.id} capture FR id`,
    );
    assertEqual(
      decisionItem.review_group,
      packageItem.review_group,
      `${decisionItem.id} package review group`,
    );
    assertEqual(
      decisionItem.review_group,
      manifestItem.review_group,
      `${decisionItem.id} manifest review group`,
    );
    assertEqual(
      decisionItem.review_focus,
      packageItem.review_focus,
      `${decisionItem.id} review focus`,
    );
    assertEqual(
      decisionItem.decision_status,
      "pending_reviewer_decision",
      `${decisionItem.id} decision status`,
    );
    assertDeepEqual(
      decisionItem.missing_before_acceptance,
      captureItem.missing_before_acceptance,
      `${decisionItem.id} missing before acceptance`,
    );
    assertDeepEqual(
      decisionItem.required_decision_fields,
      ["decision", "reviewer", "decided_at", "rationale", "evidence_refs"],
      `${decisionItem.id} required decision fields`,
    );

    if (decisionItem.review_group === "candidate_stream_evidence") {
      streamCandidateItemCount += 1;
    } else if (decisionItem.review_group === "runtime_bridge_evidence") {
      runtimeBridgeItemCount += 1;
    } else {
      throw new Error(`${decisionItem.id} has unsupported review group`);
    }
  }

  assertEqual(
    handoff.summary.decision_item_count,
    handoff.decision_items.length,
    "summary decision item count",
  );
  assertEqual(
    handoff.summary.stream_candidate_items,
    streamCandidateItemCount,
    "summary stream candidate count",
  );
  assertEqual(
    handoff.summary.runtime_bridge_items,
    runtimeBridgeItemCount,
    "summary runtime bridge count",
  );
  assertEqual(handoff.summary.accepted_items, 0, "summary accepted item count");
  assertEqual(handoff.summary.rejected_items, 0, "summary rejected item count");
  assertEqual(
    handoff.summary.needs_followup_items,
    0,
    "summary needs-followup item count",
  );
  assertEqual(
    handoff.summary.pending_reviewer_decision_items,
    handoff.decision_items.length,
    "summary pending reviewer decision count",
  );
  assertEqual(
    handoff.summary.source_package_pending_a4_review_items,
    reviewPackage.summary.pending_a4_review_items,
    "summary source pending item count",
  );
  assertEqual(
    handoff.summary.source_package_accepted_items,
    reviewPackage.summary.accepted_items,
    "summary source accepted item count",
  );
  assertEqual(
    handoff.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertDeepEqual(
    handoff.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.201"],
    "next recommended slices",
  );

  return {
    status: handoff.handoff_status,
    exitP1_1Status: handoff.exit_p1_1_status,
    decisionItemCount: handoff.decision_items.length,
    frIds: handoff.decision_items.map((item) => item.fr_id),
    streamCandidateItemCount,
    runtimeBridgeItemCount,
    acceptedItemCount: handoff.summary.accepted_items,
    pendingReviewerDecisionItemCount:
      handoff.summary.pending_reviewer_decision_items,
    nextRecommendedSlices: handoff.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4RuntimeFlowDecisionHandoff();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  decisionHandoffPath,
  validateA4RuntimeFlowDecisionHandoff,
};
