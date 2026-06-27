const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateDesktopRuntimeBridgePlan,
} = require("./m1-5-desktop-runtime-bridge-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const planPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-desktop-runtime-bridge-plan.json",
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

const expectedBridgeFrIds = ["FR-007", "FR-011", "FR-012", "FR-014", "FR-018"];
const expectedBridgeItemIds = [
  "BRIDGE-FR-007-EXECUTION-MODE-CONTROL",
  "BRIDGE-FR-011-PROJECT-CREATION",
  "BRIDGE-FR-012-GIT-INITIALIZATION",
  "BRIDGE-FR-014-SKILL-MANAGEMENT",
  "BRIDGE-FR-018-SEMI-AUTO-HITL",
];
const expectedCurrentReadinessByFrId = new Map([
  ["FR-007", "runtime_bridge_needs_a4_review"],
  ["FR-011", "runtime_bridge_needs_a4_review"],
  ["FR-012", "runtime_bridge_needs_a4_review"],
  ["FR-014", "partial_runtime_bridge_requires_followup"],
  ["FR-018", "partial_runtime_bridge_requires_followup"],
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
    path.join(os.tmpdir(), "cw-desktop-runtime-bridge-plan-"),
  );
  const mutatedPlanPath = path.join(tempDir, "plan.json");
  fs.writeFileSync(mutatedPlanPath, JSON.stringify(plan, null, 2));
  return mutatedPlanPath;
}

test("M1.5 desktop runtime bridge plan runner returns a sanitized conservative summary", () => {
  const summary = validateDesktopRuntimeBridgePlan();

  assert.equal(summary.status, "desktop_runtime_bridge_plan_not_implemented");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.bridgeItemCount, 5);
  assert.equal(summary.backendOnlyFrItems, 5);
  assert.deepEqual(sorted(summary.frIds), expectedBridgeFrIds);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingImplementationItemCount, 5);
  assert.equal(summary.contractAnchorCount > 0, true);
  assert.equal(summary.supersededBy, "W1.5.186");
  assert.deepEqual(summary.nextRecommendedSlices, [
    "W1.5.179",
    "W1.5.180",
    "W1.5.181",
  ]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 desktop runtime bridge plan is scoped to the W1.5.174 bridge track", () => {
  const plan = readJson(planPath);
  const repairPlan = readJson(repairPlanPath);
  const bridgeTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-DESKTOP-RUNTIME-BRIDGE",
  );

  assert.equal(plan.schema_version, "0.1.0");
  assert.equal(plan.slice, "W1.5.178");
  assert.equal(plan.plan_status, "desktop_runtime_bridge_plan_not_implemented");
  assert.equal(plan.exit_p1_1_status, "not_ready");
  assert.equal(plan.superseded_by?.slice, "W1.5.186");
  assert.match(plan.superseded_by?.reason ?? "", /no longer mirrors/u);
  assert.equal(plan.repair_track.source_track_id, bridgeTrack?.id);
  assert.equal(plan.repair_track.track_kind, bridgeTrack?.track_kind);
  assert.equal(plan.repair_track.source_track_status, bridgeTrack?.status);
  assert.equal(
    plan.repair_track.source_acceptance_readiness,
    "backend_only_requires_desktop_flow",
  );
  assert.deepEqual(sorted(plan.repair_track.fr_ids), expectedBridgeFrIds);
  assert.deepEqual(sorted(bridgeTrack?.fr_ids ?? []), expectedBridgeFrIds);
  assert.deepEqual(
    plan.repair_track.planned_verification,
    bridgeTrack?.planned_verification,
  );
});

test("M1.5 desktop runtime bridge items preserve historical source snapshots", () => {
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
    sorted(plan.desktop_runtime_bridge_items.map((item) => item.fr_id)),
    expectedBridgeFrIds,
  );

  for (const bridgeItem of plan.desktop_runtime_bridge_items) {
    const evidenceItem = evidenceById.get(bridgeItem.fr_id);
    const checklistItem = checklistById.get(bridgeItem.fr_id);
    assert.ok(evidenceItem);
    assert.ok(checklistItem);
    assert.equal(
      evidenceItem.acceptance_readiness,
      expectedCurrentReadinessByFrId.get(bridgeItem.fr_id),
    );
    assert.equal(
      bridgeItem.source_acceptance_readiness,
      "backend_only_requires_desktop_flow",
    );
    assert.match(bridgeItem.source_checklist_status, /.+/u);
    assert.equal(
      bridgeItem.source_evidence_refs[0],
      `docs/04_runbook/m1.5-fr-evidence-map.json#${bridgeItem.fr_id}`,
    );
    assert.equal(Array.isArray(bridgeItem.source_verification_commands), true);
    assert.equal(bridgeItem.source_checklist_remaining_gap.length > 0, true);
    assert.equal(bridgeItem.missing_before_implementation.length > 0, true);
    assert.match(bridgeItem.source_next_action, /.+/u);
    assert.equal(bridgeItem.planning_status, "planned_not_implemented");
    assert.notEqual(checklistItem.current_evidence_status, "accepted");
  }
});

test("M1.5 desktop runtime bridge plan references existing runtime API and schema anchors", () => {
  const plan = readJson(planPath);

  for (const bridgeItem of plan.desktop_runtime_bridge_items) {
    assert.equal(bridgeItem.required_runtime_contracts.length > 0, true);
    for (const contract of bridgeItem.required_runtime_contracts) {
      const sourceText = fs.readFileSync(
        path.join(repoRoot, ...contract.source.split("/")),
        { encoding: "utf8" },
      );
      assert.match(sourceText, new RegExp(escapeRegExp(contract.pattern), "u"));
      assert.equal(contract.reason.length > 0, true);
    }
  }
});

test("M1.5 desktop runtime bridge plan keeps implementation sequence conservative", () => {
  const plan = readJson(planPath);

  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.item_id),
    expectedBridgeItemIds,
  );
  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.order),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    plan.implementation_sequence.map((step) => step.fr_id),
    expectedBridgeFrIds,
  );
  assert.deepEqual(
    plan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.179", "W1.5.180", "W1.5.181"],
  );
});

test("M1.5 desktop runtime bridge plan summary does not claim acceptance or implementation", () => {
  const plan = readJson(planPath);

  assert.equal(
    plan.summary.bridge_item_count,
    plan.desktop_runtime_bridge_items.length,
  );
  assert.equal(plan.summary.backend_only_fr_items, expectedBridgeFrIds.length);
  assert.equal(plan.summary.accepted_items, 0);
  assert.equal(plan.summary.implemented_items, 0);
  assert.equal(
    plan.summary.pending_implementation_items,
    plan.desktop_runtime_bridge_items.length,
  );
  assert.equal(plan.summary.exit_p1_1_status, "not_ready");
  assert.equal(
    plan.desktop_runtime_bridge_items.some(
      (item) => item.planning_status !== "planned_not_implemented",
    ),
    false,
  );
});

test("M1.5 desktop runtime bridge plan preserves superseded source evidence drift", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.desktop_runtime_bridge_items[0].missing_before_implementation[0] =
      "Desktop execution mode control is implemented.";
  });

  assert.doesNotThrow(() =>
    validateDesktopRuntimeBridgePlan({ planPath: mutatedPlanPath }),
  );
});

test("M1.5 desktop runtime bridge plan preserves superseded checklist gap drift", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.desktop_runtime_bridge_items[2].source_checklist_remaining_gap[0] =
      "Desktop project-creation Git audit evidence is complete.";
  });

  assert.doesNotThrow(() =>
    validateDesktopRuntimeBridgePlan({ planPath: mutatedPlanPath }),
  );
});

test("M1.5 desktop runtime bridge plan rejects missing runtime contract anchors", () => {
  const mutatedPlanPath = writeMutatedPlan((plan) => {
    plan.desktop_runtime_bridge_items[4].required_runtime_contracts[0].pattern =
      "| `semi_auto` | unsupported |";
  });

  assert.throws(
    () => validateDesktopRuntimeBridgePlan({ planPath: mutatedPlanPath }),
    /BRIDGE-FR-018-SEMI-AUTO-HITL missing runtime contract anchor \| `semi_auto` \| unsupported \|/u,
  );
});

test("M1.5 desktop runtime bridge plan test is wired into desktop package gates", () => {
  const plan = readJson(planPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-desktop-runtime-bridge-plan\.test\.cjs/u,
  );
  assert.equal(
    plan.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-desktop-runtime-bridge-plan.test.cjs",
  );
  assert.equal(
    plan.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-desktop-runtime-bridge-plan.cjs --check",
  );
  assert.equal(
    plan.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
