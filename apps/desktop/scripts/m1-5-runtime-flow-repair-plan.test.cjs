const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateRuntimeFlowRepairPlan,
} = require("./m1-5-runtime-flow-repair-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const planPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-runtime-flow-repair-plan.json",
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
const a4ManifestPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-evidence-manifest.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedRuntimeFlowGapFrIds = [];
const expectedPartialBridgeFollowupFrIds = [
  "FR-011",
  "FR-014",
  "FR-015",
  "FR-018",
];
const expectedA4ReadyBridgeFrIds = [
  "FR-007",
  "FR-008",
  "FR-012",
  "FR-013",
  "FR-017",
];
const expectedRemainingFrIds = [
  ...expectedRuntimeFlowGapFrIds,
  ...expectedPartialBridgeFollowupFrIds,
].sort((left, right) => left.localeCompare(right));
const expectedSequenceItemIds = [
  "RUNTIME-FR-011-PROJECT-CREATION-REFERENCE-FOLLOWUP",
  "RUNTIME-FR-014-SKILL-CONFIGURATION-FOLLOWUP",
  "RUNTIME-FR-015-SNAPSHOT-RESTORE-CONTINUE",
  "RUNTIME-FR-018-PENDING-DECISION-PAUSE-RESUME",
];

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
    path.join(os.tmpdir(), "cw-runtime-flow-repair-plan-"),
  );
  const mutatedPlanPath = path.join(tempDir, "plan.json");
  fs.writeFileSync(mutatedPlanPath, JSON.stringify(plan, null, 2));
  return mutatedPlanPath;
}

test("M1.5 runtime flow repair plan runner returns a sanitized W1.5.199 summary", () => {
  const summary = validateRuntimeFlowRepairPlan();

  assert.equal(
    summary.status,
    "remaining_runtime_flow_implementation_plan_refreshed_after_artifact_task_drawer_detail",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.repairItemCount, 4);
  assert.deepEqual(sorted(summary.frIds), expectedRemainingFrIds);
  assert.deepEqual(summary.runtimeFlowGapFrIds, expectedRuntimeFlowGapFrIds);
  assert.deepEqual(
    summary.partialBridgeFollowupFrIds,
    expectedPartialBridgeFollowupFrIds,
  );
  assert.deepEqual(summary.a4ReadyBridgeFrIds, expectedA4ReadyBridgeFrIds);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingImplementationItemCount, 4);
  assert.equal(summary.contractAnchorCount > 0, true);
  assert.equal(summary.refreshedFrom, "W1.5.188");
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.200"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 runtime flow plan mirrors current W1.5.199 evidence buckets", () => {
  const plan = readJson(planPath);
  const evidenceMap = readJson(evidenceMapPath);
  const runtimeFlowGapFrIds = evidenceMap.fr_evidence_items
    .filter(
      (item) => item.acceptance_readiness === "partial_requires_runtime_flow",
    )
    .map((item) => item.id)
    .sort();
  const partialBridgeFrIds = evidenceMap.fr_evidence_items
    .filter(
      (item) =>
        item.acceptance_readiness ===
        "partial_runtime_bridge_requires_followup",
    )
    .map((item) => item.id)
    .sort();

  assert.equal(plan.schema_version, "0.1.0");
  assert.equal(plan.slice, "W1.5.199");
  assert.equal(
    plan.plan_status,
    "remaining_runtime_flow_implementation_plan_refreshed_after_artifact_task_drawer_detail",
  );
  assert.equal(plan.exit_p1_1_status, "not_ready");
  assert.equal(plan.refreshed_from?.slice, "W1.5.188");
  assert.equal(
    plan.repair_track.source_track_id,
    "TRACK-REMAINING-RUNTIME-FLOW-IMPLEMENTATION",
  );
  assert.equal(
    plan.repair_track.track_kind,
    "remaining_runtime_flow_and_partial_bridge_followup",
  );
  assert.deepEqual(runtimeFlowGapFrIds, expectedRuntimeFlowGapFrIds);
  assert.deepEqual(partialBridgeFrIds, expectedPartialBridgeFollowupFrIds);
  assert.deepEqual(sorted(plan.repair_track.fr_ids), expectedRemainingFrIds);
});

test("M1.5 runtime flow items mirror current checklist and evidence map fields", () => {
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
    sorted(plan.runtime_flow_items.map((item) => item.fr_id)),
    expectedRemainingFrIds,
  );

  for (const runtimeItem of plan.runtime_flow_items) {
    const evidenceItem = evidenceById.get(runtimeItem.fr_id);
    const checklistItem = checklistById.get(runtimeItem.fr_id);
    assert.ok(evidenceItem);
    assert.ok(checklistItem);
    assert.equal(
      runtimeItem.source_checklist_status,
      checklistItem.current_evidence_status,
    );
    assert.equal(
      runtimeItem.source_acceptance_readiness,
      evidenceItem.acceptance_readiness,
    );
    assert.deepEqual(runtimeItem.source_verification_commands, [
      ...evidenceItem.verification_commands,
    ]);
    assert.deepEqual(
      runtimeItem.source_checklist_remaining_gap,
      checklistItem.remaining_gap,
    );
    assert.deepEqual(
      runtimeItem.missing_before_implementation,
      evidenceItem.missing_evidence,
    );
    assert.equal(runtimeItem.source_next_action, evidenceItem.next_action);
    assert.equal(runtimeItem.planning_status, "planned_not_implemented");
    assert.notEqual(checklistItem.current_evidence_status, "accepted");
  }
});

test("M1.5 runtime flow plan keeps A4-ready bridge items out of implementation refresh", () => {
  const plan = readJson(planPath);
  const a4Manifest = readJson(a4ManifestPath);

  assert.deepEqual(
    sorted(plan.repair_track.excluded_a4_candidate_bridge_fr_ids),
    expectedA4ReadyBridgeFrIds,
  );
  assert.deepEqual(
    sorted(a4Manifest.bridge_review_track.fr_ids),
    expectedA4ReadyBridgeFrIds,
  );
  assert.deepEqual(
    sorted(
      a4Manifest.bridge_review_track.excluded_partial_runtime_bridge_fr_ids,
    ),
    expectedPartialBridgeFollowupFrIds,
  );
});

test("M1.5 runtime flow plan references existing runtime and API contract anchors", () => {
  const plan = readJson(planPath);

  for (const runtimeItem of plan.runtime_flow_items) {
    assert.equal(runtimeItem.required_runtime_contracts.length > 0, true);
    for (const contract of runtimeItem.required_runtime_contracts) {
      const sourceText = fs.readFileSync(
        path.join(repoRoot, ...contract.source.split("/")),
        { encoding: "utf8" },
      );
      assert.match(sourceText, new RegExp(escapeRegExp(contract.pattern), "u"));
      assert.equal(contract.reason.length > 0, true);
    }
  }
});

test("M1.5 runtime flow plan keeps implementation sequence conservative", () => {
  const plan = readJson(planPath);

  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.item_id),
    expectedSequenceItemIds,
  );
  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.order),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    sorted(plan.implementation_sequence.map((step) => step.fr_id)),
    expectedRemainingFrIds,
  );
  assert.deepEqual(
    plan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.200"],
  );
});

test("M1.5 runtime flow plan summary does not claim acceptance or implementation", () => {
  const plan = readJson(planPath);

  assert.equal(plan.summary.repair_item_count, plan.runtime_flow_items.length);
  assert.equal(
    plan.summary.runtime_flow_gap_fr_items,
    expectedRuntimeFlowGapFrIds.length,
  );
  assert.equal(
    plan.summary.partial_bridge_followup_fr_items,
    expectedPartialBridgeFollowupFrIds.length,
  );
  assert.equal(
    plan.summary.a4_ready_bridge_fr_items,
    expectedA4ReadyBridgeFrIds.length,
  );
  assert.equal(plan.summary.accepted_items, 0);
  assert.equal(plan.summary.implemented_items, 0);
  assert.equal(
    plan.summary.pending_implementation_items,
    plan.runtime_flow_items.length,
  );
  assert.equal(plan.summary.exit_p1_1_status, "not_ready");
  assert.equal(
    plan.runtime_flow_items.some(
      (item) => item.planning_status !== "planned_not_implemented",
    ),
    false,
  );
});

test("M1.5 runtime flow plan rejects stale source evidence after W1.5.199 refresh", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.runtime_flow_items[0].source_next_action =
      "Route Chat Box submissions through local-only renderer state.";
  });

  assert.throws(
    () => validateRuntimeFlowRepairPlan({ planPath: mutatedPlanPath }),
    /RUNTIME-FR-011-PROJECT-CREATION-REFERENCE-FOLLOWUP source next action/u,
  );
});

test("M1.5 runtime flow plan rejects missing runtime contract anchors", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.runtime_flow_items[0].required_runtime_contracts[0].pattern =
      "unknown-runtime-contract-anchor";
  });

  assert.throws(
    () => validateRuntimeFlowRepairPlan({ planPath: mutatedPlanPath }),
    /RUNTIME-FR-011-PROJECT-CREATION-REFERENCE-FOLLOWUP missing runtime contract anchor unknown-runtime-contract-anchor/u,
  );
});

test("M1.5 runtime flow repair plan test is wired into desktop package gates", () => {
  const plan = readJson(planPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-runtime-flow-repair-plan\.test\.cjs/u,
  );
  assert.equal(
    plan.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-runtime-flow-repair-plan.test.cjs",
  );
  assert.equal(
    plan.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-runtime-flow-repair-plan.cjs --check",
  );
  assert.equal(
    plan.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
