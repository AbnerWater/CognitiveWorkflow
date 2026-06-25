const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateLocalUiEvidenceBundle,
} = require("./m1-5-local-ui-evidence-bundle.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const bundlePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-local-ui-evidence-bundle.json",
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
const checklistPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-ux-acceptance-checklist.json",
);
const visualSmokePath = path.join(
  packageRoot,
  "scripts",
  "runtime-workbench-visual-smoke.cjs",
);
const reactShellTestPath = path.join(
  packageRoot,
  "src",
  "renderer",
  "runtime-workbench-shell-react.test.tsx",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedLocalUiFrIds = [
  "FR-001",
  "FR-002",
  "FR-003",
  "FR-005",
  "FR-006",
  "FR-020",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function metricFieldName(fieldRef) {
  const fieldPath = fieldRef.split("=")[0];
  const segments = fieldPath.split(".");
  return segments[segments.length - 1];
}

function writeMutatedBundle(mutator) {
  const bundle = readJson(bundlePath);
  mutator(bundle);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-local-ui-evidence-bundle-"),
  );
  const mutatedBundlePath = path.join(tempDir, "bundle.json");
  fs.writeFileSync(mutatedBundlePath, JSON.stringify(bundle, null, 2));
  return mutatedBundlePath;
}

test("M1.5 local UI evidence bundle runner returns a sanitized conservative summary", () => {
  const summary = validateLocalUiEvidenceBundle();

  assert.equal(summary.status, "local_ui_evidence_prepared_not_accepted");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.reviewItemCount, 6);
  assert.deepEqual(sorted(summary.frIds), expectedLocalUiFrIds);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.requiredVisualSmokeFieldCount > 0, true);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.177", "W1.5.178"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 local UI evidence bundle is scoped to the W1.5.174 local UI track", () => {
  const bundle = readJson(bundlePath);
  const repairPlan = readJson(repairPlanPath);
  const localUiTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-LOCAL-UI-EVIDENCE",
  );

  assert.equal(bundle.schema_version, "0.1.0");
  assert.equal(bundle.slice, "W1.5.176");
  assert.equal(bundle.bundle_status, "local_ui_evidence_prepared_not_accepted");
  assert.equal(bundle.exit_p1_1_status, "not_ready");
  assert.equal(bundle.review_track.source_track_id, localUiTrack?.id);
  assert.equal(bundle.review_track.source_track_status, localUiTrack?.status);
  assert.equal(
    bundle.review_track.local_ui_readiness,
    "partial_requires_ui_evidence",
  );
  assert.deepEqual(sorted(bundle.review_track.fr_ids), expectedLocalUiFrIds);
  assert.deepEqual(sorted(localUiTrack?.fr_ids ?? []), expectedLocalUiFrIds);
});

test("M1.5 local UI evidence review items mirror evidence map and checklist gaps", () => {
  const bundle = readJson(bundlePath);
  const evidenceMap = readJson(evidenceMapPath);
  const checklist = readJson(checklistPath);
  const evidenceById = new Map(
    evidenceMap.fr_evidence_items.map((item) => [item.id, item]),
  );
  const checklistById = new Map(
    checklist.fr_acceptance_items.map((item) => [item.id, item]),
  );

  assert.deepEqual(
    sorted(bundle.review_items.map((item) => item.fr_id)),
    expectedLocalUiFrIds,
  );

  for (const reviewItem of bundle.review_items) {
    const evidenceItem = evidenceById.get(reviewItem.fr_id);
    const checklistItem = checklistById.get(reviewItem.fr_id);
    assert.ok(evidenceItem);
    assert.ok(checklistItem);
    assert.equal(
      evidenceItem.acceptance_readiness,
      "partial_requires_ui_evidence",
    );
    assert.equal(
      reviewItem.source_checklist_status,
      checklistItem.current_evidence_status,
    );
    assert.equal(
      reviewItem.source_acceptance_readiness,
      evidenceItem.acceptance_readiness,
    );
    assert.deepEqual(reviewItem.source_evidence_refs, [
      `docs/04_runbook/m1.5-fr-evidence-map.json#${reviewItem.fr_id}`,
      ...evidenceItem.evidence_refs,
    ]);
    assert.deepEqual(
      reviewItem.source_verification_commands,
      evidenceItem.verification_commands,
    );
    assert.deepEqual(
      reviewItem.source_checklist_remaining_gap,
      checklistItem.remaining_gap,
    );
    assert.deepEqual(
      reviewItem.missing_before_acceptance,
      evidenceItem.missing_evidence,
    );
    assert.notEqual(checklistItem.current_evidence_status, "accepted");
    assert.equal(reviewItem.review_status, "pending_a4_review");
    assert.equal(reviewItem.missing_before_acceptance.length > 0, true);
  }
});

test("M1.5 local UI evidence bundle references existing visual smoke and React markers", () => {
  const bundle = readJson(bundlePath);
  const visualSmokeText = fs.readFileSync(visualSmokePath, {
    encoding: "utf8",
  });
  const reactShellTestText = fs.readFileSync(reactShellTestPath, {
    encoding: "utf8",
  });

  for (const reviewItem of bundle.review_items) {
    assert.equal(reviewItem.required_visual_smoke_fields.length > 0, true);
    assert.equal(reviewItem.required_react_test_markers.length > 0, true);

    for (const fieldRef of reviewItem.required_visual_smoke_fields) {
      assert.match(visualSmokeText, new RegExp(metricFieldName(fieldRef), "u"));
    }
    for (const marker of reviewItem.required_react_test_markers) {
      assert.match(reactShellTestText, new RegExp(escapeRegExp(marker), "u"));
    }
  }
});

test("M1.5 local UI evidence bundle keeps known missing acceptance gaps explicit", () => {
  const bundle = readJson(bundlePath);
  const itemsByFrId = new Map(
    bundle.review_items.map((item) => [item.fr_id, item]),
  );

  assert.match(
    itemsByFrId.get("FR-001").missing_before_acceptance.join(" "),
    /Cross-platform packaged launch evidence/u,
  );
  assert.match(
    itemsByFrId.get("FR-002").missing_before_acceptance.join(" "),
    /Dock collapse/u,
  );
  assert.match(
    itemsByFrId.get("FR-003").missing_before_acceptance.join(" "),
    /Project-backed filesystem enumeration/u,
  );
  assert.match(
    itemsByFrId.get("FR-005").missing_before_acceptance.join(" "),
    /Selection is still local scaffold behavior/u,
  );
  assert.match(
    itemsByFrId.get("FR-006").missing_before_acceptance.join(" "),
    /Runtime-backed detail updates/u,
  );
  assert.match(
    itemsByFrId.get("FR-020").missing_before_acceptance.join(" "),
    /command discoverability/u,
  );
});

test("M1.5 local UI evidence bundle rejects visual smoke expected-value drift", () => {
  const mutatedBundlePath = writeMutatedBundle((bundle) => {
    bundle.review_items[0].required_visual_smoke_fields[0] =
      "metrics.hasRoot=false";
  });

  assert.throws(
    () => validateLocalUiEvidenceBundle({ bundlePath: mutatedBundlePath }),
    /LOCAL-FR-001-SHELL-WINDOW references missing visual smoke assertion metrics\.hasRoot=false/u,
  );
});

test("M1.5 local UI evidence bundle rejects source evidence drift", () => {
  const mutatedBundlePath = writeMutatedBundle((bundle) => {
    bundle.review_items[1].missing_before_acceptance[0] =
      "A4 accepted all first-level module entries.";
  });

  assert.throws(
    () => validateLocalUiEvidenceBundle({ bundlePath: mutatedBundlePath }),
    /LOCAL-FR-002-DOCK-MODULES source missing evidence/u,
  );
});

test("M1.5 local UI evidence bundle rejects checklist source drift", () => {
  const mutatedBundlePath = writeMutatedBundle((bundle) => {
    bundle.review_items[2].source_checklist_remaining_gap[0] =
      "Project-backed filesystem enumeration is complete.";
  });

  assert.throws(
    () => validateLocalUiEvidenceBundle({ bundlePath: mutatedBundlePath }),
    /LOCAL-FR-003-FILE-TREE source checklist remaining gap/u,
  );
});

test("M1.5 local UI evidence bundle rejects verification command drift", () => {
  const mutatedBundlePath = writeMutatedBundle((bundle) => {
    bundle.review_items[5].source_verification_commands = [
      "pnpm --filter @cw/desktop run test",
    ];
  });

  assert.throws(
    () => validateLocalUiEvidenceBundle({ bundlePath: mutatedBundlePath }),
    /LOCAL-FR-020-SHORTCUTS source verification commands/u,
  );
});

test("M1.5 local UI evidence bundle summary does not claim acceptance", () => {
  const bundle = readJson(bundlePath);

  assert.equal(bundle.summary.review_item_count, bundle.review_items.length);
  assert.equal(bundle.summary.local_ui_fr_items, expectedLocalUiFrIds.length);
  assert.equal(bundle.summary.accepted_items, 0);
  assert.equal(
    bundle.summary.pending_a4_review_items,
    bundle.review_items.length,
  );
  assert.equal(bundle.summary.exit_p1_1_status, "not_ready");
  assert.equal(
    bundle.review_items.some((item) => item.review_status === "accepted"),
    false,
  );
});

test("M1.5 local UI evidence bundle test is wired into desktop package gates", () => {
  const bundle = readJson(bundlePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-local-ui-evidence-bundle\.test\.cjs/u,
  );
  assert.equal(
    bundle.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-local-ui-evidence-bundle.test.cjs",
  );
  assert.equal(
    bundle.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-local-ui-evidence-bundle.cjs --check",
  );
  assert.equal(
    bundle.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
