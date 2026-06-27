const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4RuntimeFlowDecisionHandoff,
} = require("./m1-5-a4-runtime-flow-decision-handoff.cjs");

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
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamCandidateFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRuntimeBridgeFrIds = [
  "FR-007",
  "FR-008",
  "FR-012",
  "FR-013",
  "FR-017",
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

function writeMutatedHandoff(mutator) {
  const handoff = readJson(decisionHandoffPath);
  mutator(handoff);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-a4-handoff-"));
  const mutatedHandoffPath = path.join(tempDir, "decision-handoff.json");
  fs.writeFileSync(mutatedHandoffPath, JSON.stringify(handoff, null, 2));
  return mutatedHandoffPath;
}

test("M1.5 A4 runtime-flow decision handoff returns a sanitized conservative summary", () => {
  const summary = validateA4RuntimeFlowDecisionHandoff();

  assert.equal(
    summary.status,
    "a4_runtime_flow_decision_handoff_prepared_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.decisionItemCount, 8);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedReviewFrIds));
  assert.equal(
    summary.streamCandidateItemCount,
    expectedStreamCandidateFrIds.length,
  );
  assert.equal(
    summary.runtimeBridgeItemCount,
    expectedRuntimeBridgeFrIds.length,
  );
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.pendingReviewerDecisionItemCount, 8);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.201"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 runtime-flow decision handoff mirrors package review items", () => {
  const handoff = readJson(decisionHandoffPath);
  const reviewPackage = readJson(reviewPackagePath);

  assert.equal(handoff.schema_version, "0.1.0");
  assert.equal(handoff.slice, "W1.5.200");
  assert.equal(handoff.exit_p1_1_status, "not_ready");
  assert.equal(reviewPackage.summary.accepted_items, 0);
  assert.deepEqual(
    sorted(handoff.decision_items.map((item) => item.package_item_id)),
    sorted(reviewPackage.review_package_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(handoff.decision_items.map((item) => item.review_item_id)),
    sorted(
      reviewPackage.review_package_items.map((item) => item.review_item_id),
    ),
  );
  assert.deepEqual(
    sorted(handoff.decision_items.map((item) => item.capture_id)),
    sorted(reviewPackage.review_package_items.map((item) => item.capture_id)),
  );
  assert.deepEqual(
    sorted(handoff.decision_items.map((item) => item.fr_id)),
    sorted(expectedReviewFrIds),
  );
});

test("M1.5 A4 runtime-flow decision handoff keeps all decision slots pending", () => {
  const handoff = readJson(decisionHandoffPath);

  assert.deepEqual(handoff.reviewer_contract.allowed_decisions, [
    "accepted",
    "rejected",
    "needs_followup",
  ]);
  assert.equal(handoff.reviewer_contract.decision_record_required, true);
  assert.equal(
    handoff.reviewer_contract.decision_record_status,
    "not_recorded",
  );
  assert.equal(handoff.summary.accepted_items, 0);
  assert.equal(handoff.summary.rejected_items, 0);
  assert.equal(handoff.summary.needs_followup_items, 0);
  assert.equal(
    handoff.summary.pending_reviewer_decision_items,
    handoff.decision_items.length,
  );
  assert.equal(
    handoff.decision_items.every(
      (item) => item.decision_status === "pending_reviewer_decision",
    ),
    true,
  );
  assert.equal(
    handoff.decision_items.every(
      (item) => item.missing_before_acceptance.length > 0,
    ),
    true,
  );
});

test("M1.5 A4 runtime-flow decision handoff rejects acceptance drift", () => {
  const mutatedHandoffPath = writeMutatedHandoff((handoff) => {
    handoff.summary.accepted_items = 1;
  });

  assert.throws(
    () =>
      validateA4RuntimeFlowDecisionHandoff({
        decisionHandoffPath: mutatedHandoffPath,
      }),
    /summary accepted item count/u,
  );
});

test("M1.5 A4 runtime-flow decision handoff rejects premature reviewer decision drift", () => {
  const mutatedHandoffPath = writeMutatedHandoff((handoff) => {
    handoff.decision_items[0].decision_status = "accepted";
  });

  assert.throws(
    () =>
      validateA4RuntimeFlowDecisionHandoff({
        decisionHandoffPath: mutatedHandoffPath,
      }),
    /decision status/u,
  );
});

test("M1.5 A4 runtime-flow decision handoff test is wired into desktop package gates", () => {
  const handoff = readJson(decisionHandoffPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-runtime-flow-decision-handoff\.test\.cjs/u,
  );
  assert.equal(
    handoff.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-runtime-flow-decision-handoff.test.cjs",
  );
  assert.equal(
    handoff.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-runtime-flow-decision-handoff.cjs --check",
  );
  assert.equal(
    handoff.reviewer_contract.standard_desktop_test,
    "pnpm --filter @cw/desktop run test",
  );
});
