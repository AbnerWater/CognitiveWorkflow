const fs = require("node:fs");
const path = require("node:path");

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

const expectedRuntimeFlowFrIds = ["FR-008", "FR-015", "FR-017"];

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

function validateRuntimeFlowRepairPlan(options = {}) {
  const plan = readJson(options.planPath ?? planPath);
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const evidenceMap = readJson(options.evidenceMapPath ?? evidenceMapPath);
  const checklist = readJson(options.checklistPath ?? checklistPath);

  assertEqual(plan.schema_version, "0.1.0", "schema version");
  assertEqual(plan.milestone, "M1.5", "milestone");
  assertEqual(plan.slice, "W1.5.177", "slice id");
  assertEqual(
    plan.plan_status,
    "runtime_flow_repair_plan_not_implemented",
    "plan status",
  );
  assertEqual(plan.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(
    plan.repair_track.source_track_id,
    "TRACK-RUNTIME-FLOW-REPAIR",
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
    "runtime flow FR ids must match source repair track",
  );
  assertDeepEqual(
    plan.repair_track.blocked_by_dependency_gates,
    repairTrack.blocked_by_dependency_gates,
    "runtime flow dependency gates must match source repair track",
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

  const runtimeFlowFrIds = plan.runtime_flow_items.map((item) => item.fr_id);
  const runtimeFlowItemIds = plan.runtime_flow_items.map((item) => item.id);
  assertDeepEqual(
    sorted(runtimeFlowFrIds),
    expectedRuntimeFlowFrIds,
    "runtime flow item FR ids",
  );
  assertEqual(
    new Set(runtimeFlowFrIds).size,
    runtimeFlowFrIds.length,
    "runtime flow FR ids must be unique",
  );
  assertEqual(
    new Set(runtimeFlowItemIds).size,
    runtimeFlowItemIds.length,
    "runtime flow item ids must be unique",
  );

  const evidenceById = new Map(
    evidenceMap.fr_evidence_items.map((item) => [item.id, item]),
  );
  const checklistById = new Map(
    checklist.fr_acceptance_items.map((item) => [item.id, item]),
  );

  let contractAnchorCount = 0;
  for (const runtimeItem of plan.runtime_flow_items) {
    const evidenceItem = evidenceById.get(runtimeItem.fr_id);
    const checklistItem = checklistById.get(runtimeItem.fr_id);
    assertCondition(
      Boolean(evidenceItem),
      `missing evidence map item ${runtimeItem.fr_id}`,
    );
    assertCondition(
      Boolean(checklistItem),
      `missing checklist item ${runtimeItem.fr_id}`,
    );
    assertEqual(
      runtimeItem.source_checklist_status,
      checklistItem.current_evidence_status,
      `${runtimeItem.id} source checklist status`,
    );
    assertEqual(
      runtimeItem.source_acceptance_readiness,
      evidenceItem.acceptance_readiness,
      `${runtimeItem.id} source acceptance readiness`,
    );
    assertEqual(
      evidenceItem.checklist_status,
      checklistItem.current_evidence_status,
      `${runtimeItem.id} checklist/evidence status mirror`,
    );
    assertDeepEqual(
      runtimeItem.source_evidence_refs,
      [
        `docs/04_runbook/m1.5-fr-evidence-map.json#${runtimeItem.fr_id}`,
        ...evidenceItem.evidence_refs,
      ],
      `${runtimeItem.id} source evidence refs`,
    );
    assertDeepEqual(
      runtimeItem.source_verification_commands,
      evidenceItem.verification_commands,
      `${runtimeItem.id} source verification commands`,
    );
    assertDeepEqual(
      runtimeItem.source_checklist_remaining_gap,
      checklistItem.remaining_gap,
      `${runtimeItem.id} source checklist remaining gap`,
    );
    assertDeepEqual(
      runtimeItem.missing_before_implementation,
      evidenceItem.missing_evidence,
      `${runtimeItem.id} source missing implementation evidence`,
    );
    assertEqual(
      runtimeItem.source_next_action,
      evidenceItem.next_action,
      `${runtimeItem.id} source next action`,
    );
    assertEqual(
      runtimeItem.planning_status,
      "planned_not_implemented",
      `${runtimeItem.id} planning status`,
    );
    assertCondition(
      runtimeItem.planned_repair_steps.length > 0,
      `${runtimeItem.id} must list planned repair steps`,
    );
    assertCondition(
      runtimeItem.required_runtime_contracts.length > 0,
      `${runtimeItem.id} must list runtime contract anchors`,
    );
    assertCondition(
      checklistItem.current_evidence_status !== "accepted",
      `${runtimeItem.fr_id} must not be accepted in checklist`,
    );

    for (const contract of runtimeItem.required_runtime_contracts) {
      assertCondition(
        typeof contract.source === "string" && contract.source.length > 0,
        `${runtimeItem.id} has invalid runtime contract source`,
      );
      assertCondition(
        typeof contract.pattern === "string" && contract.pattern.length > 0,
        `${runtimeItem.id} has invalid runtime contract pattern`,
      );
      assertCondition(
        typeof contract.reason === "string" && contract.reason.length > 0,
        `${runtimeItem.id} has invalid runtime contract reason`,
      );
      assertCondition(
        contractText(contract.source, options).includes(contract.pattern),
        `${runtimeItem.id} missing runtime contract anchor ${contract.pattern} in ${contract.source}`,
      );
      contractAnchorCount += 1;
    }
  }

  assertDeepEqual(
    plan.implementation_sequence.map((step) => step.item_id),
    [
      "RUNTIME-FR-008-CHAT-COMMAND-ROUTING",
      "RUNTIME-FR-015-SNAPSHOT-RESTORE",
      "RUNTIME-FR-017-ARTIFACT-ACTIONS",
    ],
    "implementation sequence item order",
  );
  assertDeepEqual(
    plan.implementation_sequence.map((step) => step.fr_id),
    expectedRuntimeFlowFrIds,
    "implementation sequence FR order",
  );
  for (const [index, sequenceStep] of plan.implementation_sequence.entries()) {
    assertEqual(sequenceStep.order, index + 1, "implementation sequence order");
    assertCondition(
      runtimeFlowItemIds.includes(sequenceStep.item_id),
      `${sequenceStep.item_id} must reference a runtime flow item`,
    );
    assertCondition(
      typeof sequenceStep.reason === "string" && sequenceStep.reason.length > 0,
      `${sequenceStep.item_id} must explain sequence reason`,
    );
  }

  assertEqual(
    plan.summary.repair_item_count,
    plan.runtime_flow_items.length,
    "summary repair item count",
  );
  assertEqual(
    plan.summary.runtime_flow_fr_items,
    plan.runtime_flow_items.length,
    "summary runtime flow item count",
  );
  assertEqual(plan.summary.accepted_items, 0, "summary accepted item count");
  assertEqual(
    plan.summary.implemented_items,
    0,
    "summary implemented item count",
  );
  assertEqual(
    plan.summary.pending_implementation_items,
    plan.runtime_flow_items.length,
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
    plan.runner_contract.runner_output_contract.repair_item_count,
    plan.runtime_flow_items.length,
    "runner repair item count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.accepted_item_count,
    0,
    "runner accepted item count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.runtime_flow_item_count,
    plan.runtime_flow_items.length,
    "runner runtime flow item count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
    "runner output must be sanitized summary only",
  );
  assertEqual(
    plan.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-runtime-flow-repair-plan.cjs --check",
    "runner focused check",
  );
  assertEqual(
    plan.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-runtime-flow-repair-plan.test.cjs",
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
  assertDeepEqual(
    plan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.178", "W1.5.179", "W1.5.180"],
    "next recommended slices",
  );

  return {
    status: plan.plan_status,
    exitP1_1Status: plan.exit_p1_1_status,
    repairItemCount: plan.runtime_flow_items.length,
    runtimeFlowItemCount: plan.summary.runtime_flow_fr_items,
    frIds: runtimeFlowFrIds,
    acceptedItemCount: plan.summary.accepted_items,
    implementedItemCount: plan.summary.implemented_items,
    pendingImplementationItemCount: plan.summary.pending_implementation_items,
    contractAnchorCount,
    nextRecommendedSlices: plan.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateRuntimeFlowRepairPlan();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  planPath,
  validateRuntimeFlowRepairPlan,
};
