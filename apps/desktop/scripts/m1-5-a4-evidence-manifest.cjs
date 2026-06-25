const fs = require("node:fs");
const path = require("node:path");

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function readText(filePath) {
  return fs.readFileSync(filePath, { encoding: "utf8" });
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

function validateA4EvidenceManifest(options = {}) {
  const manifest = readJson(options.manifestPath ?? manifestPath);
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const evidenceMap = readJson(options.evidenceMapPath ?? evidenceMapPath);
  const matrixRunnerText = readText(
    options.matrixRunnerPath ?? matrixRunnerPath,
  );

  assertEqual(
    manifest.manifest_status,
    "a4_evidence_inputs_prepared_not_accepted",
    "manifest status",
  );
  assertEqual(manifest.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    manifest.review_track.source_track_id,
    "TRACK-A4-CANDIDATE-EVIDENCE",
    "source track id",
  );

  const repairTrack = repairPlan.repair_tracks.find(
    (track) => track.id === manifest.review_track.source_track_id,
  );
  assertCondition(Boolean(repairTrack), "missing source repair track");
  assertEqual(
    repairTrack.status,
    "ready_for_evidence_runner",
    "source repair track status",
  );
  assertEqual(
    manifest.review_track.source_track_status,
    repairTrack.status,
    "manifest source track status",
  );
  assertDeepEqual(
    sorted(manifest.review_track.fr_ids),
    sorted(repairTrack.fr_ids),
    "manifest FR ids must match source repair track",
  );

  const reviewItemFrIds = manifest.review_items.map((item) => item.fr_id);
  assertDeepEqual(
    sorted(reviewItemFrIds),
    sorted(repairTrack.fr_ids),
    "review item FR ids must match source repair track",
  );
  assertEqual(
    new Set(reviewItemFrIds).size,
    reviewItemFrIds.length,
    "review items must assign each FR once",
  );

  const evidenceById = new Map(
    evidenceMap.fr_evidence_items.map((item) => [item.id, item]),
  );
  for (const reviewItem of manifest.review_items) {
    const evidenceItem = evidenceById.get(reviewItem.fr_id);
    assertCondition(
      Boolean(evidenceItem),
      `missing evidence map item ${reviewItem.fr_id}`,
    );
    assertEqual(
      evidenceItem.acceptance_readiness,
      manifest.review_track.candidate_evidence_readiness,
      `${reviewItem.fr_id} readiness`,
    );
    assertEqual(
      reviewItem.review_status,
      "pending_a4_review",
      `${reviewItem.id} review status`,
    );
    assertCondition(
      reviewItem.required_commands.includes(
        "pnpm --filter @cw/desktop run test",
      ),
      `${reviewItem.id} must require desktop test`,
    );
    assertCondition(
      reviewItem.required_commands.includes(
        "pnpm --filter @cw/desktop run visual-smoke:matrix",
      ),
      `${reviewItem.id} must require visual smoke matrix`,
    );
    assertCondition(
      reviewItem.required_matrix_cases.length > 0,
      `${reviewItem.id} must list matrix cases`,
    );
    assertCondition(
      reviewItem.required_evidence_fields.length > 0,
      `${reviewItem.id} must list evidence fields`,
    );
  }

  for (const caseName of manifest.matrix_case_contract.required_cases_for_a4) {
    assertCondition(
      matrixRunnerText.includes(`name: "${caseName}"`),
      `matrix runner missing required case ${caseName}`,
    );
  }
  for (const reviewItem of manifest.review_items) {
    for (const caseName of reviewItem.required_matrix_cases) {
      assertCondition(
        manifest.matrix_case_contract.required_cases_for_a4.includes(caseName),
        `${reviewItem.id} references case outside A4 required set: ${caseName}`,
      );
    }
  }
  const matrixCaseCount = Array.from(
    matrixRunnerText.matchAll(/\bname: "[^"]+"/gu),
  ).length;
  assertEqual(
    manifest.matrix_case_contract.expected_default_case_count,
    matrixCaseCount,
    "matrix default case count",
  );

  assertEqual(
    manifest.summary.review_item_count,
    manifest.review_items.length,
    "summary review item count",
  );
  assertEqual(
    manifest.summary.accepted_items,
    0,
    "summary accepted item count",
  );
  assertEqual(
    manifest.summary.pending_a4_review_items,
    manifest.review_items.length,
    "summary pending A4 item count",
  );
  assertEqual(
    manifest.summary.required_matrix_case_count,
    manifest.matrix_case_contract.required_cases_for_a4.length,
    "summary required matrix case count",
  );
  assertEqual(
    manifest.runner_contract.runner_output_contract.review_item_count,
    manifest.review_items.length,
    "runner review item count",
  );
  assertEqual(
    manifest.runner_contract.runner_output_contract.accepted_item_count,
    0,
    "runner accepted item count",
  );
  assertEqual(
    manifest.runner_contract.runner_output_contract.required_matrix_case_count,
    manifest.matrix_case_contract.required_cases_for_a4.length,
    "runner required matrix case count",
  );
  assertEqual(
    manifest.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
    "runner output must be sanitized summary only",
  );

  return {
    status: manifest.manifest_status,
    exitP1_1Status: manifest.exit_p1_1_status,
    reviewItemCount: manifest.review_items.length,
    frIds: reviewItemFrIds,
    acceptedItemCount: manifest.summary.accepted_items,
    requiredMatrixCases: manifest.matrix_case_contract.required_cases_for_a4,
    nextRecommendedSlices: manifest.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4EvidenceManifest();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  manifestPath,
  validateA4EvidenceManifest,
};
