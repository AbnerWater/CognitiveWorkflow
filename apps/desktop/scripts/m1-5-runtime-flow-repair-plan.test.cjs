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

const expectedRuntimeFlowFrIds = ["FR-008", "FR-015", "FR-017"];
const expectedCurrentReadinessByFrId = new Map([
  ["FR-008", "partial_requires_runtime_flow"],
  ["FR-015", "partial_runtime_bridge_requires_followup"],
  ["FR-017", "partial_requires_runtime_flow"],
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
    path.join(os.tmpdir(), "cw-runtime-flow-repair-plan-"),
  );
  const mutatedPlanPath = path.join(tempDir, "plan.json");
  fs.writeFileSync(mutatedPlanPath, JSON.stringify(plan, null, 2));
  return mutatedPlanPath;
}

test("M1.5 runtime flow repair plan runner returns a sanitized conservative summary", () => {
  const summary = validateRuntimeFlowRepairPlan();

  assert.equal(summary.status, "runtime_flow_repair_plan_not_implemented");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.repairItemCount, 3);
  assert.equal(summary.runtimeFlowItemCount, 3);
  assert.deepEqual(sorted(summary.frIds), expectedRuntimeFlowFrIds);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingImplementationItemCount, 3);
  assert.equal(summary.contractAnchorCount > 0, true);
  assert.equal(summary.supersededBy, "W1.5.186");
  assert.deepEqual(summary.nextRecommendedSlices, [
    "W1.5.178",
    "W1.5.179",
    "W1.5.180",
  ]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 runtime flow repair plan is scoped to the W1.5.174 runtime track", () => {
  const plan = readJson(planPath);
  const repairPlan = readJson(repairPlanPath);
  const runtimeTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-RUNTIME-FLOW-REPAIR",
  );

  assert.equal(plan.schema_version, "0.1.0");
  assert.equal(plan.slice, "W1.5.177");
  assert.equal(plan.plan_status, "runtime_flow_repair_plan_not_implemented");
  assert.equal(plan.exit_p1_1_status, "not_ready");
  assert.equal(plan.superseded_by?.slice, "W1.5.186");
  assert.match(plan.superseded_by?.reason ?? "", /no longer mirrors/u);
  assert.equal(plan.repair_track.source_track_id, runtimeTrack?.id);
  assert.equal(plan.repair_track.track_kind, runtimeTrack?.track_kind);
  assert.equal(plan.repair_track.source_track_status, runtimeTrack?.status);
  assert.equal(
    plan.repair_track.source_acceptance_readiness,
    "partial_requires_runtime_flow",
  );
  assert.deepEqual(sorted(plan.repair_track.fr_ids), expectedRuntimeFlowFrIds);
  assert.deepEqual(
    sorted(runtimeTrack?.fr_ids ?? []),
    expectedRuntimeFlowFrIds,
  );
  assert.deepEqual(
    plan.repair_track.planned_verification,
    runtimeTrack?.planned_verification,
  );
});

test("M1.5 runtime flow items preserve historical source snapshots", () => {
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
    expectedRuntimeFlowFrIds,
  );

  for (const runtimeItem of plan.runtime_flow_items) {
    const evidenceItem = evidenceById.get(runtimeItem.fr_id);
    const checklistItem = checklistById.get(runtimeItem.fr_id);
    assert.ok(evidenceItem);
    assert.ok(checklistItem);
    assert.equal(
      evidenceItem.acceptance_readiness,
      expectedCurrentReadinessByFrId.get(runtimeItem.fr_id),
    );
    assert.equal(
      runtimeItem.source_acceptance_readiness,
      "partial_requires_runtime_flow",
    );
    assert.match(runtimeItem.source_checklist_status, /.+/u);
    assert.equal(
      runtimeItem.source_evidence_refs[0],
      `docs/04_runbook/m1.5-fr-evidence-map.json#${runtimeItem.fr_id}`,
    );
    assert.equal(Array.isArray(runtimeItem.source_verification_commands), true);
    assert.equal(runtimeItem.source_checklist_remaining_gap.length > 0, true);
    assert.equal(runtimeItem.missing_before_implementation.length > 0, true);
    assert.match(runtimeItem.source_next_action, /.+/u);
    assert.equal(runtimeItem.planning_status, "planned_not_implemented");
    assert.notEqual(checklistItem.current_evidence_status, "accepted");
  }
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
    [
      "RUNTIME-FR-008-CHAT-COMMAND-ROUTING",
      "RUNTIME-FR-015-SNAPSHOT-RESTORE",
      "RUNTIME-FR-017-ARTIFACT-ACTIONS",
    ],
  );
  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.order),
    [1, 2, 3],
  );
  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.fr_id),
    expectedRuntimeFlowFrIds,
  );
  assert.deepEqual(
    plan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.178", "W1.5.179", "W1.5.180"],
  );
});

test("M1.5 runtime flow plan summary does not claim acceptance or implementation", () => {
  const plan = readJson(planPath);

  assert.equal(plan.summary.repair_item_count, plan.runtime_flow_items.length);
  assert.equal(
    plan.summary.runtime_flow_fr_items,
    expectedRuntimeFlowFrIds.length,
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

test("M1.5 runtime flow plan preserves superseded source evidence drift", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.runtime_flow_items[0].missing_before_implementation[0] =
      "Real chat command routing is implemented.";
  });

  assert.doesNotThrow(() =>
    validateRuntimeFlowRepairPlan({ planPath: mutatedPlanPath }),
  );
});

test("M1.5 runtime flow plan preserves superseded checklist gap drift", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.runtime_flow_items[1].source_checklist_remaining_gap[0] =
      "Automatic snapshot creation is accepted.";
  });

  assert.doesNotThrow(() =>
    validateRuntimeFlowRepairPlan({ planPath: mutatedPlanPath }),
  );
});

test("M1.5 runtime flow plan rejects missing runtime contract anchors", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.runtime_flow_items[2].required_runtime_contracts[0].pattern =
      "artifacts/unknown-index.jsonl";
  });

  assert.throws(
    () => validateRuntimeFlowRepairPlan({ planPath: mutatedPlanPath }),
    /RUNTIME-FR-017-ARTIFACT-ACTIONS missing runtime contract anchor artifacts\/unknown-index\.jsonl/u,
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
