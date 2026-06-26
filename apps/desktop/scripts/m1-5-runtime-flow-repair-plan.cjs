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

const runtimeFlowReadiness = "partial_requires_runtime_flow";
const partialBridgeReadiness = "partial_runtime_bridge_requires_followup";
const a4ReadyBridgeReadiness = "runtime_bridge_needs_a4_review";

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

function frIdsByReadiness(evidenceMap, readiness) {
  return sorted(
    evidenceMap.fr_evidence_items
      .filter((item) => item.acceptance_readiness === readiness)
      .map((item) => item.id),
  );
}

function expectedGapGroup(readiness) {
  if (readiness === runtimeFlowReadiness) {
    return "runtime_flow_gap";
  }
  if (readiness === partialBridgeReadiness) {
    return "partial_bridge_followup";
  }
  throw new Error(`unexpected readiness for runtime-flow plan: ${readiness}`);
}

function assertBucket(plan, readiness, expectedFrIds) {
  const bucket = plan.repair_track.source_buckets.find(
    (candidate) => candidate.acceptance_readiness === readiness,
  );
  assertCondition(Boolean(bucket), `missing source bucket ${readiness}`);
  assertDeepEqual(
    sorted(bucket.fr_ids),
    expectedFrIds,
    `${readiness} source bucket FR ids`,
  );
  assertEqual(
    bucket.source_map,
    `docs/04_runbook/m1.5-fr-evidence-map.json#acceptance_readiness=${readiness}`,
    `${readiness} source bucket map`,
  );
}

function validateRuntimeFlowRepairPlan(options = {}) {
  const plan = readJson(options.planPath ?? planPath);
  const evidenceMap = readJson(options.evidenceMapPath ?? evidenceMapPath);
  const checklist = readJson(options.checklistPath ?? checklistPath);
  const a4Manifest = readJson(options.a4ManifestPath ?? a4ManifestPath);

  const runtimeFlowFrIds = frIdsByReadiness(evidenceMap, runtimeFlowReadiness);
  const partialBridgeFrIds = frIdsByReadiness(
    evidenceMap,
    partialBridgeReadiness,
  );
  const a4ReadyBridgeFrIds = frIdsByReadiness(
    evidenceMap,
    a4ReadyBridgeReadiness,
  );
  const expectedRemainingFrIds = sorted([
    ...runtimeFlowFrIds,
    ...partialBridgeFrIds,
  ]);

  assertEqual(plan.schema_version, "0.1.0", "schema version");
  assertEqual(plan.milestone, "M1.5", "milestone");
  assertEqual(plan.slice, "W1.5.188", "slice id");
  assertEqual(
    plan.plan_status,
    "remaining_runtime_flow_implementation_plan_refreshed_not_implemented",
    "plan status",
  );
  assertEqual(plan.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertEqual(plan.refreshed_from?.slice, "W1.5.177", "refreshed-from slice");
  assertEqual(
    plan.repair_track.source_track_id,
    "TRACK-REMAINING-RUNTIME-FLOW-IMPLEMENTATION",
    "source track id",
  );
  assertEqual(
    plan.repair_track.track_kind,
    "remaining_runtime_flow_and_partial_bridge_followup",
    "track kind",
  );
  assertEqual(
    plan.repair_track.source_track_status,
    "refreshed_not_implemented",
    "track status",
  );
  assertDeepEqual(
    sorted(plan.repair_track.source_acceptance_readiness),
    sorted([runtimeFlowReadiness, partialBridgeReadiness]),
    "source readiness buckets",
  );
  assertDeepEqual(
    sorted(plan.repair_track.fr_ids),
    expectedRemainingFrIds,
    "repair track FR ids",
  );
  assertBucket(plan, runtimeFlowReadiness, runtimeFlowFrIds);
  assertBucket(plan, partialBridgeReadiness, partialBridgeFrIds);
  assertDeepEqual(
    sorted(plan.repair_track.excluded_a4_candidate_bridge_fr_ids),
    a4ReadyBridgeFrIds,
    "A4-ready bridge ids must stay excluded from remaining implementation",
  );
  assertDeepEqual(
    sorted(a4Manifest.bridge_review_track.fr_ids),
    a4ReadyBridgeFrIds,
    "A4 manifest bridge ids must match evidence map",
  );
  assertDeepEqual(
    sorted(
      a4Manifest.bridge_review_track.excluded_partial_runtime_bridge_fr_ids,
    ),
    partialBridgeFrIds,
    "A4 manifest excluded partial bridge ids must match implementation plan",
  );
  assertDeepEqual(
    plan.repair_track.blocked_by_dependency_gates,
    [],
    "remaining runtime-flow plan must not be dependency-gated",
  );

  const runtimeFlowItemFrIds = plan.runtime_flow_items.map(
    (item) => item.fr_id,
  );
  const runtimeFlowItemIds = plan.runtime_flow_items.map((item) => item.id);
  assertDeepEqual(
    sorted(runtimeFlowItemFrIds),
    expectedRemainingFrIds,
    "runtime flow item FR ids",
  );
  assertEqual(
    new Set(runtimeFlowItemFrIds).size,
    runtimeFlowItemFrIds.length,
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
    assertCondition(
      [runtimeFlowReadiness, partialBridgeReadiness].includes(
        evidenceItem.acceptance_readiness,
      ),
      `${runtimeItem.fr_id} must be a remaining implementation gap`,
    );
    assertEqual(
      evidenceItem.checklist_status,
      checklistItem.current_evidence_status,
      `${runtimeItem.id} checklist/evidence status mirror`,
    );
    assertEqual(
      runtimeItem.implementation_gap_group,
      expectedGapGroup(evidenceItem.acceptance_readiness),
      `${runtimeItem.id} implementation gap group`,
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

  const expectedSequenceItemIds = [
    "RUNTIME-FR-008-CHAT-COMMAND-ROUTING",
    "RUNTIME-FR-017-ARTIFACT-ACTIONS",
    "RUNTIME-FR-011-PROJECT-CREATION-REFERENCE-FOLLOWUP",
    "RUNTIME-FR-014-SKILL-CONFIGURATION-FOLLOWUP",
    "RUNTIME-FR-015-SNAPSHOT-RESTORE-CONTINUE",
    "RUNTIME-FR-018-PENDING-DECISION-PAUSE-RESUME",
  ];
  assertDeepEqual(
    plan.implementation_sequence.map((step) => step.item_id),
    expectedSequenceItemIds,
    "implementation sequence item order",
  );
  assertDeepEqual(
    sorted(plan.implementation_sequence.map((step) => step.fr_id)),
    expectedRemainingFrIds,
    "implementation sequence FR ids",
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
    plan.summary.runtime_flow_gap_fr_items,
    runtimeFlowFrIds.length,
    "summary runtime-flow gap count",
  );
  assertEqual(
    plan.summary.partial_bridge_followup_fr_items,
    partialBridgeFrIds.length,
    "summary partial bridge follow-up count",
  );
  assertEqual(
    plan.summary.a4_ready_bridge_fr_items,
    a4ReadyBridgeFrIds.length,
    "summary A4-ready bridge count",
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
    plan.runner_contract.runner_output_contract.implemented_item_count,
    0,
    "runner implemented item count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.runtime_flow_gap_item_count,
    runtimeFlowFrIds.length,
    "runner runtime-flow gap count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract
      .partial_bridge_followup_item_count,
    partialBridgeFrIds.length,
    "runner partial bridge follow-up count",
  );
  assertEqual(
    plan.runner_contract.runner_output_contract.a4_ready_bridge_item_count,
    a4ReadyBridgeFrIds.length,
    "runner A4-ready bridge count",
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
    ["W1.5.189", "W1.5.190"],
    "next recommended slices",
  );

  return {
    status: plan.plan_status,
    exitP1_1Status: plan.exit_p1_1_status,
    repairItemCount: plan.runtime_flow_items.length,
    frIds: runtimeFlowItemFrIds,
    runtimeFlowGapFrIds: runtimeFlowFrIds,
    partialBridgeFollowupFrIds: partialBridgeFrIds,
    a4ReadyBridgeFrIds,
    acceptedItemCount: plan.summary.accepted_items,
    implementedItemCount: plan.summary.implemented_items,
    pendingImplementationItemCount: plan.summary.pending_implementation_items,
    contractAnchorCount,
    refreshedFrom: plan.refreshed_from?.slice ?? null,
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
