const fs = require("node:fs");
const path = require("node:path");

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

function metricFieldName(fieldRef) {
  const fieldPath = fieldRef.split("=")[0];
  const segments = fieldPath.split(".");
  return segments[segments.length - 1];
}

function parseVisualSmokeFieldRef(fieldRef) {
  const [fieldPath, expectedRaw] = fieldRef.split("=");
  assertCondition(
    typeof fieldPath === "string" &&
      fieldPath.includes(".") &&
      typeof expectedRaw === "string" &&
      expectedRaw.length > 0,
    `invalid visual smoke field reference ${fieldRef}`,
  );
  const segments = fieldPath.split(".");
  return {
    fieldPath,
    objectName: segments.slice(0, -1).join("."),
    fieldName: segments[segments.length - 1],
    expectedLiterals: expectedLiterals(expectedRaw),
  };
}

function expectedLiterals(expectedRaw) {
  if (expectedRaw === "true" || expectedRaw === "false") {
    return [expectedRaw, JSON.stringify(expectedRaw)];
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(expectedRaw)) {
    return [expectedRaw];
  }
  return [JSON.stringify(expectedRaw)];
}

function normalizeJavaScriptForSearch(text) {
  return text.replace(/\?\./gu, ".").replace(/\s+/gu, "");
}

function assertVisualSmokeAssertion(visualSmokeText, fieldRef, reviewItemId) {
  const parsedField = parseVisualSmokeFieldRef(fieldRef);
  const normalizedText = normalizeJavaScriptForSearch(visualSmokeText);
  const strictInequalityAssertions = parsedField.expectedLiterals.map(
    (expectedLiteral) =>
      `${parsedField.objectName}.${parsedField.fieldName}!==${expectedLiteral}`,
  );
  assertCondition(
    strictInequalityAssertions.some((assertion) =>
      normalizedText.includes(assertion),
    ),
    `${reviewItemId} references missing visual smoke assertion ${fieldRef}`,
  );
}

function validateLocalUiEvidenceBundle(options = {}) {
  const bundle = readJson(options.bundlePath ?? bundlePath);
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const evidenceMap = readJson(options.evidenceMapPath ?? evidenceMapPath);
  const checklist = readJson(options.checklistPath ?? checklistPath);
  const visualSmokeText = readText(options.visualSmokePath ?? visualSmokePath);
  const reactShellTestText = readText(
    options.reactShellTestPath ?? reactShellTestPath,
  );

  assertEqual(bundle.slice, "W1.5.176", "slice id");
  assertEqual(
    bundle.bundle_status,
    "local_ui_evidence_prepared_not_accepted",
    "bundle status",
  );
  assertEqual(bundle.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    bundle.review_track.source_track_id,
    "TRACK-LOCAL-UI-EVIDENCE",
    "source track id",
  );

  const repairTrack = repairPlan.repair_tracks.find(
    (track) => track.id === bundle.review_track.source_track_id,
  );
  assertCondition(Boolean(repairTrack), "missing source repair track");
  assertEqual(
    repairTrack.status,
    "planned_not_implemented",
    "source repair track status",
  );
  assertEqual(
    bundle.review_track.source_track_status,
    repairTrack.status,
    "bundle source track status",
  );
  assertDeepEqual(
    sorted(bundle.review_track.fr_ids),
    sorted(repairTrack.fr_ids),
    "bundle FR ids must match source repair track",
  );

  const reviewItemFrIds = bundle.review_items.map((item) => item.fr_id);
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
  const checklistById = new Map(
    checklist.fr_acceptance_items.map((item) => [item.id, item]),
  );

  for (const reviewItem of bundle.review_items) {
    const evidenceItem = evidenceById.get(reviewItem.fr_id);
    const checklistItem = checklistById.get(reviewItem.fr_id);
    assertCondition(
      Boolean(evidenceItem),
      `missing evidence map item ${reviewItem.fr_id}`,
    );
    assertCondition(
      Boolean(checklistItem),
      `missing checklist item ${reviewItem.fr_id}`,
    );
    assertEqual(
      evidenceItem.acceptance_readiness,
      bundle.review_track.local_ui_readiness,
      `${reviewItem.fr_id} readiness`,
    );
    assertEqual(
      evidenceItem.checklist_status,
      checklistItem.current_evidence_status,
      `${reviewItem.fr_id} checklist status mirror`,
    );
    assertEqual(
      reviewItem.source_checklist_status,
      checklistItem.current_evidence_status,
      `${reviewItem.id} source checklist status`,
    );
    assertEqual(
      reviewItem.source_acceptance_readiness,
      evidenceItem.acceptance_readiness,
      `${reviewItem.id} source acceptance readiness`,
    );
    assertDeepEqual(
      reviewItem.source_evidence_refs,
      [
        `docs/04_runbook/m1.5-fr-evidence-map.json#${reviewItem.fr_id}`,
        ...evidenceItem.evidence_refs,
      ],
      `${reviewItem.id} source evidence refs`,
    );
    assertDeepEqual(
      reviewItem.source_verification_commands,
      evidenceItem.verification_commands,
      `${reviewItem.id} source verification commands`,
    );
    assertDeepEqual(
      reviewItem.source_checklist_remaining_gap,
      checklistItem.remaining_gap,
      `${reviewItem.id} source checklist remaining gap`,
    );
    assertDeepEqual(
      reviewItem.missing_before_acceptance,
      evidenceItem.missing_evidence,
      `${reviewItem.id} source missing evidence`,
    );
    assertCondition(
      checklistItem.current_evidence_status !== "accepted",
      `${reviewItem.fr_id} must not be accepted in checklist`,
    );
    assertEqual(
      reviewItem.review_status,
      "pending_a4_review",
      `${reviewItem.id} review status`,
    );
    assertDeepEqual(
      reviewItem.required_commands,
      [
        bundle.runner_contract.standard_desktop_test,
        bundle.runner_contract.visual_smoke_matrix_command,
      ],
      `${reviewItem.id} required review commands`,
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
      reviewItem.required_visual_smoke_fields.length > 0,
      `${reviewItem.id} must list visual smoke fields`,
    );
    assertCondition(
      reviewItem.required_react_test_markers.length > 0,
      `${reviewItem.id} must list React test markers`,
    );
    assertCondition(
      reviewItem.missing_before_acceptance.length > 0,
      `${reviewItem.id} must keep missing acceptance gaps`,
    );

    for (const fieldRef of reviewItem.required_visual_smoke_fields) {
      assertCondition(
        visualSmokeText.includes(metricFieldName(fieldRef)),
        `${reviewItem.id} references missing visual smoke field ${metricFieldName(fieldRef)}`,
      );
      assertVisualSmokeAssertion(visualSmokeText, fieldRef, reviewItem.id);
    }
    for (const marker of reviewItem.required_react_test_markers) {
      assertCondition(
        reactShellTestText.includes(marker),
        `${reviewItem.id} references missing React test marker ${marker}`,
      );
    }
  }

  assertEqual(
    bundle.summary.review_item_count,
    bundle.review_items.length,
    "summary review item count",
  );
  assertEqual(
    bundle.summary.local_ui_fr_items,
    bundle.review_items.length,
    "summary local UI item count",
  );
  assertEqual(bundle.summary.accepted_items, 0, "summary accepted item count");
  assertEqual(
    bundle.summary.pending_a4_review_items,
    bundle.review_items.length,
    "summary pending A4 item count",
  );
  assertEqual(
    bundle.runner_contract.runner_output_contract.review_item_count,
    bundle.review_items.length,
    "runner review item count",
  );
  assertEqual(
    bundle.runner_contract.runner_output_contract.accepted_item_count,
    0,
    "runner accepted item count",
  );
  assertEqual(
    bundle.runner_contract.runner_output_contract.local_ui_fr_item_count,
    bundle.review_items.length,
    "runner local UI item count",
  );
  assertEqual(
    bundle.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
    "runner output must be sanitized summary only",
  );

  return {
    status: bundle.bundle_status,
    exitP1_1Status: bundle.exit_p1_1_status,
    reviewItemCount: bundle.review_items.length,
    frIds: reviewItemFrIds,
    acceptedItemCount: bundle.summary.accepted_items,
    requiredVisualSmokeFieldCount: bundle.review_items.reduce(
      (count, item) => count + item.required_visual_smoke_fields.length,
      0,
    ),
    nextRecommendedSlices: bundle.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateLocalUiEvidenceBundle();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  bundlePath,
  validateLocalUiEvidenceBundle,
};
