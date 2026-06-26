const fs = require("node:fs");
const path = require("node:path");

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

const expectedBridgeFrIds = ["FR-007", "FR-011", "FR-012", "FR-014", "FR-018"];
const expectedBridgeItemIds = [
  "BRIDGE-FR-007-EXECUTION-MODE-CONTROL",
  "BRIDGE-FR-011-PROJECT-CREATION",
  "BRIDGE-FR-012-GIT-INITIALIZATION",
  "BRIDGE-FR-014-SKILL-MANAGEMENT",
  "BRIDGE-FR-018-SEMI-AUTO-HITL",
];

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

function isSupersededByW15186EvidenceRefresh(plan) {
  return (
    plan.superseded_by?.slice === "W1.5.186" &&
    plan.superseded_by?.artifact === "docs/04_runbook/m1.5-fr-evidence-map.json"
  );
}

function assertHistoricalSourceSnapshot(item) {
  assertCondition(
    typeof item.source_checklist_status === "string" &&
      item.source_checklist_status.length > 0,
    `${item.id} historical source checklist status must be recorded`,
  );
  assertCondition(
    typeof item.source_acceptance_readiness === "string" &&
      item.source_acceptance_readiness.length > 0,
    `${item.id} historical source acceptance readiness must be recorded`,
  );
  assertCondition(
    Array.isArray(item.source_evidence_refs) &&
      item.source_evidence_refs.length > 0,
    `${item.id} historical source evidence refs must be recorded`,
  );
  assertCondition(
    Array.isArray(item.source_verification_commands),
    `${item.id} historical source verification commands must be recorded`,
  );
  assertCondition(
    Array.isArray(item.source_checklist_remaining_gap) &&
      item.source_checklist_remaining_gap.length > 0,
    `${item.id} historical source checklist remaining gap must be recorded`,
  );
  assertCondition(
    Array.isArray(item.missing_before_implementation) &&
      item.missing_before_implementation.length > 0,
    `${item.id} historical missing implementation evidence must be recorded`,
  );
  assertCondition(
    typeof item.source_next_action === "string" &&
      item.source_next_action.length > 0,
    `${item.id} historical source next action must be recorded`,
  );
}

function repoPath(sourcePath) {
  return path.join(repoRoot, ...sourcePath.split("/"));
}

function contractText(sourcePath, options) {
  const overrideText = options.contractTexts?.[sourcePath];
  if (typeof overrideText === "string") {
    return overrideText;
  }
  return readText(repoPath(sourcePath));
}

function validateDesktopRuntimeBridgePlan(options = {}) {
  const plan = readJson(options.planPath ?? planPath);
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const evidenceMap = readJson(options.evidenceMapPath ?? evidenceMapPath);
  const checklist = readJson(options.checklistPath ?? checklistPath);

  assertEqual(plan.schema_version, "0.1.0", "schema version");
  assertEqual(plan.milestone, "M1.5", "milestone");
  assertEqual(plan.slice, "W1.5.178", "slice id");
  const isSuperseded = isSupersededByW15186EvidenceRefresh(plan);
  if (isSuperseded) {
    assertCondition(
      plan.superseded_by.reason.includes("no longer mirrors"),
      "superseded reason must explain current evidence map drift",
    );
  }
  assertEqual(
    plan.plan_status,
    "desktop_runtime_bridge_plan_not_implemented",
    "plan status",
  );
  assertEqual(plan.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    plan.repair_track.source_track_id,
    "TRACK-DESKTOP-RUNTIME-BRIDGE",
    "source track id",
  );

  const repairTrack = repairPlan.repair_tracks.find(
    (track) => track.id === plan.repair_track.source_track_id,
  );
  assertCondition(Boolean(repairTrack), "missing source repair track");
  assertEqual(
    plan.repair_track.source_track_status,
    repairTrack.status,
    "source repair track status",
  );
  assertEqual(
    plan.repair_track.track_kind,
    repairTrack.track_kind,
    "source repair track kind",
  );
  assertEqual(
    plan.repair_track.priority,
    repairTrack.priority,
    "source repair track priority",
  );
  assertEqual(
    plan.repair_track.source_acceptance_readiness,
    repairTrack.source_acceptance_readiness,
    "source repair track readiness",
  );
  assertDeepEqual(
    sorted(plan.repair_track.fr_ids),
    sorted(repairTrack.fr_ids),
    "desktop runtime bridge FR ids must match source repair track",
  );
  assertDeepEqual(
    plan.repair_track.blocked_by_dependency_gates,
    repairTrack.blocked_by_dependency_gates,
    "desktop runtime bridge dependency gates must match source repair track",
  );
  assertEqual(
    plan.repair_track.objective,
    repairTrack.objective,
    "source repair track objective",
  );
  assertDeepEqual(
    plan.repair_track.entry_criteria,
    repairTrack.entry_criteria,
    "source repair track entry criteria",
  );
  assertDeepEqual(
    plan.repair_track.planned_repair_steps,
    repairTrack.planned_repair_steps,
    "source repair track planned repair steps",
  );
  assertDeepEqual(
    plan.repair_track.planned_verification,
    repairTrack.planned_verification,
    "source repair track planned verification",
  );
  assertEqual(
    plan.repair_track.next_slice,
    repairTrack.next_slice,
    "source repair track next slice",
  );

  const bridgeFrIds = plan.desktop_runtime_bridge_items.map(
    (item) => item.fr_id,
  );
  const bridgeItemIds = plan.desktop_runtime_bridge_items.map(
    (item) => item.id,
  );
  assertDeepEqual(sorted(bridgeFrIds), expectedBridgeFrIds, "bridge FR ids");
  assertDeepEqual(
    sorted(bridgeItemIds),
    sorted(expectedBridgeItemIds),
    "bridge item ids",
  );
  assertEqual(
    new Set(bridgeFrIds).size,
    bridgeFrIds.length,
    "bridge FR ids must be unique",
  );
  assertEqual(
    new Set(bridgeItemIds).size,
    bridgeItemIds.length,
    "bridge item ids must be unique",
  );

  const evidenceById = new Map(
    evidenceMap.fr_evidence_items.map((item) => [item.id, item]),
  );
  const checklistById = new Map(
    checklist.fr_acceptance_items.map((item) => [item.id, item]),
  );

  let contractAnchorCount = 0;
  for (const bridgeItem of plan.desktop_runtime_bridge_items) {
    const evidenceItem = evidenceById.get(bridgeItem.fr_id);
    const checklistItem = checklistById.get(bridgeItem.fr_id);
    assertCondition(
      Boolean(evidenceItem),
      `missing evidence map item ${bridgeItem.fr_id}`,
    );
    assertCondition(
      Boolean(checklistItem),
      `missing checklist item ${bridgeItem.fr_id}`,
    );
    assertEqual(
      evidenceItem.checklist_status,
      checklistItem.current_evidence_status,
      `${bridgeItem.id} checklist/evidence status mirror`,
    );
    if (isSuperseded) {
      assertHistoricalSourceSnapshot(bridgeItem);
    } else {
      assertEqual(
        bridgeItem.source_checklist_status,
        checklistItem.current_evidence_status,
        `${bridgeItem.id} source checklist status`,
      );
      assertEqual(
        bridgeItem.source_acceptance_readiness,
        evidenceItem.acceptance_readiness,
        `${bridgeItem.id} source acceptance readiness`,
      );
      assertDeepEqual(
        bridgeItem.source_evidence_refs,
        [
          `docs/04_runbook/m1.5-fr-evidence-map.json#${bridgeItem.fr_id}`,
          ...evidenceItem.evidence_refs,
        ],
        `${bridgeItem.id} source evidence refs`,
      );
      assertDeepEqual(
        bridgeItem.source_verification_commands,
        evidenceItem.verification_commands,
        `${bridgeItem.id} source verification commands`,
      );
      assertDeepEqual(
        bridgeItem.source_checklist_remaining_gap,
        checklistItem.remaining_gap,
        `${bridgeItem.id} source checklist remaining gap`,
      );
      assertDeepEqual(
        bridgeItem.missing_before_implementation,
        evidenceItem.missing_evidence,
        `${bridgeItem.id} source missing implementation evidence`,
      );
      assertEqual(
        bridgeItem.source_next_action,
        evidenceItem.next_action,
        `${bridgeItem.id} source next action`,
      );
    }
    assertEqual(
      bridgeItem.planning_status,
      "planned_not_implemented",
      `${bridgeItem.id} planning status`,
    );
    assertCondition(
      bridgeItem.planned_repair_steps.length > 0,
      `${bridgeItem.id} must list planned repair steps`,
    );
    assertCondition(
      bridgeItem.required_runtime_contracts.length > 0,
      `${bridgeItem.id} must list runtime contract anchors`,
    );
    assertCondition(
      checklistItem.current_evidence_status !== "accepted",
      `${bridgeItem.fr_id} must not be accepted in checklist`,
    );

    for (const contract of bridgeItem.required_runtime_contracts) {
      assertCondition(
        typeof contract.source === "string" && contract.source.length > 0,
        `${bridgeItem.id} has invalid runtime contract source`,
      );
      assertCondition(
        typeof contract.pattern === "string" && contract.pattern.length > 0,
        `${bridgeItem.id} has invalid runtime contract pattern`,
      );
      assertCondition(
        typeof contract.reason === "string" && contract.reason.length > 0,
        `${bridgeItem.id} has invalid runtime contract reason`,
      );
      assertCondition(
        contractText(contract.source, options).includes(contract.pattern),
        `${bridgeItem.id} missing runtime contract anchor ${contract.pattern} in ${contract.source}`,
      );
      contractAnchorCount += 1;
    }
  }

  assertDeepEqual(
    plan.implementation_sequence.map((step) => step.item_id),
    expectedBridgeItemIds,
    "implementation sequence item order",
  );
  assertDeepEqual(
    plan.implementation_sequence.map((step) => step.fr_id),
    expectedBridgeFrIds,
    "implementation sequence FR order",
  );
  for (const [index, sequenceStep] of plan.implementation_sequence.entries()) {
    assertEqual(sequenceStep.order, index + 1, "implementation sequence order");
    assertCondition(
      bridgeItemIds.includes(sequenceStep.item_id),
      `${sequenceStep.item_id} must reference a bridge item`,
    );
    assertCondition(
      typeof sequenceStep.reason === "string" && sequenceStep.reason.length > 0,
      `${sequenceStep.item_id} must explain sequence reason`,
    );
  }

  assertEqual(
    plan.summary.bridge_item_count,
    plan.desktop_runtime_bridge_items.length,
    "summary bridge item count",
  );
  assertEqual(
    plan.summary.backend_only_fr_items,
    plan.desktop_runtime_bridge_items.length,
    "summary backend-only item count",
  );
  assertEqual(plan.summary.accepted_items, 0, "summary accepted item count");
  assertEqual(
    plan.summary.implemented_items,
    0,
    "summary implemented item count",
  );
  assertEqual(
    plan.summary.pending_implementation_items,
    plan.desktop_runtime_bridge_items.length,
    "summary pending implementation item count",
  );
  assertEqual(
    plan.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.status,
    plan.plan_status,
    "runner output status",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.bridge_item_count,
    plan.desktop_runtime_bridge_items.length,
    "runner bridge item count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.accepted_item_count,
    0,
    "runner accepted item count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.implemented_item_count,
    0,
    "runner implemented item count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
    "runner output must be sanitized summary only",
  );
  assertEqual(
    plan.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-desktop-runtime-bridge-plan.cjs --check",
    "runner focused check",
  );
  assertEqual(
    plan.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-desktop-runtime-bridge-plan.test.cjs",
    "runner focused test",
  );
  assertEqual(
    plan.runner_contract.standard_desktop_test,
    "pnpm --filter @cw/desktop run test",
    "runner standard desktop test",
  );
  assertEqual(
    plan.runner_contract.runtime_focused_test,
    "uv run pytest apps/runtime/tests -q",
    "runner runtime focused test",
  );
  assertEqual(
    plan.runner_contract.schema_focused_test,
    "uv run pytest packages/schemas/tests -q",
    "runner schema focused test",
  );
  assertDeepEqual(
    plan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.179", "W1.5.180", "W1.5.181"],
    "next recommended slices",
  );

  return {
    status: plan.plan_status,
    exitP1_1Status: plan.exit_p1_1_status,
    bridgeItemCount: plan.desktop_runtime_bridge_items.length,
    backendOnlyFrItems: plan.summary.backend_only_fr_items,
    frIds: bridgeFrIds,
    acceptedItemCount: plan.summary.accepted_items,
    implementedItemCount: plan.summary.implemented_items,
    pendingImplementationItemCount: plan.summary.pending_implementation_items,
    contractAnchorCount,
    supersededBy: plan.superseded_by?.slice ?? null,
    nextRecommendedSlices: plan.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateDesktopRuntimeBridgePlan();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  planPath,
  validateDesktopRuntimeBridgePlan,
};
