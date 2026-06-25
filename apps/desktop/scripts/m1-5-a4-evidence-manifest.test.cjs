const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4EvidenceManifest,
} = require("./m1-5-a4-evidence-manifest.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const manifestPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-evidence-manifest.json",
);
const repairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-ux-gap-repair-plan.json",
);
const evidenceMapPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-fr-evidence-map.json",
);
const matrixRunnerPath = path.join(
  packageRoot,
  "scripts",
  "runtime-workbench-visual-smoke-matrix.cjs",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedCandidateFrIds = ["FR-009", "FR-010", "FR-016"];
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

test("M1.5 A4 evidence manifest runner returns a sanitized conservative summary", () => {
  const summary = validateA4EvidenceManifest();

  assert.equal(summary.status, "a4_evidence_inputs_prepared_not_accepted");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.reviewItemCount, 3);
  assert.deepEqual(sorted(summary.frIds), expectedCandidateFrIds);
  assert.equal(summary.acceptedItemCount, 0);
  assert.deepEqual(
    sorted(summary.requiredMatrixCases),
    sorted(expectedRequiredMatrixCases),
  );
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.176", "W1.5.177"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 evidence manifest is scoped to the W1.5.174 candidate track", () => {
  const manifest = readJson(manifestPath);
  const repairPlan = readJson(repairPlanPath);
  const candidateTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-A4-CANDIDATE-EVIDENCE",
  );

  assert.equal(manifest.schema_version, "0.1.0");
  assert.equal(manifest.slice, "W1.5.175");
  assert.equal(
    manifest.manifest_status,
    "a4_evidence_inputs_prepared_not_accepted",
  );
  assert.equal(manifest.exit_p1_1_status, "not_ready");
  assert.equal(manifest.review_track.source_track_id, candidateTrack?.id);
  assert.equal(
    manifest.review_track.candidate_evidence_readiness,
    "candidate_evidence_needs_a4_review",
  );
  assert.deepEqual(
    sorted(manifest.review_track.fr_ids),
    expectedCandidateFrIds,
  );
  assert.deepEqual(
    sorted(candidateTrack?.fr_ids ?? []),
    expectedCandidateFrIds,
  );
});

test("M1.5 A4 evidence manifest review items mirror candidate evidence items", () => {
  const manifest = readJson(manifestPath);
  const evidenceMap = readJson(evidenceMapPath);
  const evidenceById = new Map(
    evidenceMap.fr_evidence_items.map((item) => [item.id, item]),
  );

  assert.deepEqual(
    sorted(manifest.review_items.map((item) => item.fr_id)),
    expectedCandidateFrIds,
  );

  for (const reviewItem of manifest.review_items) {
    const evidenceItem = evidenceById.get(reviewItem.fr_id);
    assert.ok(evidenceItem);
    assert.equal(
      evidenceItem.acceptance_readiness,
      "candidate_evidence_needs_a4_review",
    );
    assert.equal(reviewItem.review_status, "pending_a4_review");
    assert.equal(reviewItem.required_commands.length >= 2, true);
    assert.equal(
      reviewItem.required_commands.includes(
        "pnpm --filter @cw/desktop run test",
      ),
      true,
    );
    assert.equal(
      reviewItem.required_commands.includes(
        "pnpm --filter @cw/desktop run visual-smoke:matrix",
      ),
      true,
    );
    assert.equal(reviewItem.required_matrix_cases.length > 0, true);
    assert.equal(reviewItem.required_evidence_fields.length > 0, true);
    assert.equal(reviewItem.missing_before_acceptance.length > 0, true);
  }
});

test("M1.5 A4 evidence manifest references existing visual smoke matrix cases", () => {
  const manifest = readJson(manifestPath);
  const matrixRunnerText = fs.readFileSync(matrixRunnerPath, {
    encoding: "utf8",
  });

  assert.equal(manifest.matrix_case_contract.expected_default_case_count, 8);
  assert.deepEqual(
    sorted(manifest.matrix_case_contract.required_cases_for_a4),
    sorted(expectedRequiredMatrixCases),
  );

  for (const caseName of manifest.matrix_case_contract.required_cases_for_a4) {
    assert.match(matrixRunnerText, new RegExp(`name: "${caseName}"`, "u"));
  }

  for (const reviewItem of manifest.review_items) {
    for (const caseName of reviewItem.required_matrix_cases) {
      assert.equal(
        manifest.matrix_case_contract.required_cases_for_a4.includes(caseName),
        true,
      );
    }
  }
});

test("M1.5 A4 evidence manifest summary does not claim acceptance", () => {
  const manifest = readJson(manifestPath);

  assert.equal(
    manifest.summary.review_item_count,
    manifest.review_items.length,
  );
  assert.equal(
    manifest.summary.candidate_fr_items,
    expectedCandidateFrIds.length,
  );
  assert.equal(manifest.summary.accepted_items, 0);
  assert.equal(
    manifest.summary.pending_a4_review_items,
    manifest.review_items.length,
  );
  assert.equal(
    manifest.summary.required_matrix_case_count,
    manifest.matrix_case_contract.required_cases_for_a4.length,
  );
  assert.equal(manifest.summary.exit_p1_1_status, "not_ready");
  assert.equal(
    manifest.review_items.some((item) => item.review_status === "accepted"),
    false,
  );
});

test("M1.5 A4 evidence manifest test is wired into desktop package gates", () => {
  const manifest = readJson(manifestPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-evidence-manifest\.test\.cjs/u,
  );
  assert.equal(
    manifest.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-evidence-manifest.test.cjs",
  );
  assert.equal(
    manifest.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-evidence-manifest.cjs --check",
  );
  assert.equal(
    manifest.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
  );
});
