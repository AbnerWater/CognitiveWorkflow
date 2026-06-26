const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateReferenceManagementRepairPlan,
} = require("./m1-5-reference-management-repair-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const planPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-reference-management-repair-plan.json",
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
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedReferenceFrIds = ["FR-013"];
const expectedReferenceItemIds = ["REFERENCE-FR-013-LIFECYCLE"];
const expectedCurrentReadinessByFrId = new Map([
  ["FR-013", "runtime_bridge_needs_a4_review"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedPlan(mutator) {
  const plan = readJson(planPath);
  mutator(plan);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-reference-management-repair-plan-"),
  );
  const mutatedPlanPath = path.join(tempDir, "plan.json");
  fs.writeFileSync(mutatedPlanPath, JSON.stringify(plan, null, 2));
  return mutatedPlanPath;
}

test("M1.5 reference management repair plan runner returns a sanitized conservative summary", () => {
  const summary = validateReferenceManagementRepairPlan();

  assert.equal(
    summary.status,
    "reference_management_repair_plan_not_implemented",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.referenceItemCount, 1);
  assert.equal(summary.missingImplementationFrItems, 1);
  assert.deepEqual(sorted(summary.frIds), expectedReferenceFrIds);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingImplementationItemCount, 1);
  assert.equal(summary.contractAnchorCount > 0, true);
  assert.equal(summary.supersededBy, "W1.5.186");
  assert.deepEqual(summary.nextRecommendedSlices, [
    "W1.5.180",
    "W1.5.181",
    "W1.5.182",
  ]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 reference management repair plan is scoped to the W1.5.174 reference track", () => {
  const plan = readJson(planPath);
  const repairPlan = readJson(repairPlanPath);
  const referenceTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-REFERENCE-MANAGEMENT",
  );

  assert.equal(plan.schema_version, "0.1.0");
  assert.equal(plan.slice, "W1.5.179");
  assert.equal(
    plan.plan_status,
    "reference_management_repair_plan_not_implemented",
  );
  assert.equal(plan.exit_p1_1_status, "not_ready");
  assert.equal(plan.superseded_by?.slice, "W1.5.186");
  assert.match(plan.superseded_by?.reason ?? "", /no longer mirrors/u);
  assert.equal(plan.repair_track.source_track_id, referenceTrack?.id);
  assert.equal(plan.repair_track.track_kind, referenceTrack?.track_kind);
  assert.equal(plan.repair_track.source_track_status, referenceTrack?.status);
  assert.equal(
    plan.repair_track.source_acceptance_readiness,
    "missing_implementation",
  );
  assert.deepEqual(sorted(plan.repair_track.fr_ids), expectedReferenceFrIds);
  assert.deepEqual(
    sorted(referenceTrack?.fr_ids ?? []),
    expectedReferenceFrIds,
  );
  assert.deepEqual(
    plan.repair_track.planned_verification,
    referenceTrack?.planned_verification,
  );
});

test("M1.5 reference management item preserves historical source snapshot", () => {
  const plan = readJson(planPath);
  const evidenceMap = readJson(evidenceMapPath);
  const checklist = readJson(checklistPath);
  const evidenceById = new Map(
    evidenceMap.fr_evidence_items.map((item) => [item.id, item]),
  );
  const checklistById = new Map(
    checklist.fr_acceptance_items.map((item) => [item.id, item]),
  );

  assert.deepEqual(
    sorted(plan.reference_management_items.map((item) => item.fr_id)),
    expectedReferenceFrIds,
  );

  for (const referenceItem of plan.reference_management_items) {
    const evidenceItem = evidenceById.get(referenceItem.fr_id);
    const checklistItem = checklistById.get(referenceItem.fr_id);
    assert.ok(evidenceItem);
    assert.ok(checklistItem);
    assert.equal(
      evidenceItem.acceptance_readiness,
      expectedCurrentReadinessByFrId.get(referenceItem.fr_id),
    );
    assert.equal(
      referenceItem.source_acceptance_readiness,
      "missing_implementation",
    );
    assert.match(referenceItem.source_checklist_status, /.+/u);
    assert.equal(
      referenceItem.source_evidence_refs[0],
      `docs/04_runbook/m1.5-fr-evidence-map.json#${referenceItem.fr_id}`,
    );
    assert.equal(
      Array.isArray(referenceItem.source_verification_commands),
      true,
    );
    assert.equal(referenceItem.source_checklist_remaining_gap.length > 0, true);
    assert.equal(referenceItem.missing_before_implementation.length > 0, true);
    assert.match(referenceItem.source_next_action, /.+/u);
    assert.equal(referenceItem.planning_status, "planned_not_implemented");
    assert.notEqual(checklistItem.current_evidence_status, "accepted");
  }
});

test("M1.5 reference management repair plan references existing runtime API and schema anchors", () => {
  const plan = readJson(planPath);

  for (const referenceItem of plan.reference_management_items) {
    assert.equal(referenceItem.required_runtime_contracts.length > 0, true);
    for (const contract of referenceItem.required_runtime_contracts) {
      const sourceText = fs.readFileSync(
        path.join(repoRoot, ...contract.source.split("/")),
        { encoding: "utf8" },
      );
      assert.match(sourceText, new RegExp(escapeRegExp(contract.pattern), "u"));
      assert.equal(contract.reason.length > 0, true);
    }
  }
});

test("M1.5 reference management repair plan keeps implementation sequence conservative", () => {
  const plan = readJson(planPath);

  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.item_id),
    expectedReferenceItemIds,
  );
  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.order),
    [1],
  );
  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.fr_id),
    expectedReferenceFrIds,
  );
  assert.deepEqual(
    plan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.180", "W1.5.181", "W1.5.182"],
  );
});

test("M1.5 reference management repair plan summary does not claim acceptance or implementation", () => {
  const plan = readJson(planPath);

  assert.equal(
    plan.summary.reference_item_count,
    plan.reference_management_items.length,
  );
  assert.equal(
    plan.summary.missing_implementation_fr_items,
    expectedReferenceFrIds.length,
  );
  assert.equal(plan.summary.accepted_items, 0);
  assert.equal(plan.summary.implemented_items, 0);
  assert.equal(
    plan.summary.pending_implementation_items,
    plan.reference_management_items.length,
  );
  assert.equal(plan.summary.exit_p1_1_status, "not_ready");
  assert.equal(
    plan.reference_management_items.some(
      (item) => item.planning_status !== "planned_not_implemented",
    ),
    false,
  );
});

test("M1.5 reference management repair plan preserves superseded source evidence drift", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.reference_management_items[0].missing_before_implementation[0] =
      "Desktop reference import is implemented.";
  });

  assert.doesNotThrow(() =>
    validateReferenceManagementRepairPlan({ planPath: mutatedPlanPath }),
  );
});

test("M1.5 reference management repair plan preserves superseded checklist gap drift", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.reference_management_items[0].source_checklist_remaining_gap[1] =
      "Runtime-backed reference manifest UX is accepted.";
  });

  assert.doesNotThrow(() =>
    validateReferenceManagementRepairPlan({ planPath: mutatedPlanPath }),
  );
});

test("M1.5 reference management repair plan rejects missing runtime contract anchors", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.reference_management_items[0].required_runtime_contracts[0].pattern =
      "GET    /{project_id}/references                   unsupported";
  });

  assert.throws(
    () => validateReferenceManagementRepairPlan({ planPath: mutatedPlanPath }),
    /REFERENCE-FR-013-LIFECYCLE missing runtime contract anchor GET    \/\{project_id\}\/references                   unsupported/u,
  );
});

test("M1.5 reference management repair plan test is wired into desktop package gates", () => {
  const plan = readJson(planPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-reference-management-repair-plan\.test\.cjs/u,
  );
  assert.equal(
    plan.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-reference-management-repair-plan.test.cjs",
  );
  assert.equal(
    plan.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-reference-management-repair-plan.cjs --check",
  );
  assert.equal(
    plan.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
