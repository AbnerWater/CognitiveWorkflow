const fs = require("node:fs");
const path = require("node:path");
const {
  validateA4A8RoutedPackageHandoffDecisionRecord,
} = require("./m1-5-a4-a8-routed-package-handoff-decision-record.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const needsFollowupPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-package-handoff-needs-followup-plan.json",
);
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-package-handoff-decision-record.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const adr0012Path = path.join(
  repoRoot,
  "docs",
  "03_decisions",
  "0012-fr015-snapshot-ledger-restore-contract.md",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedTrackByReviewGroup = {
  stream_acceptance_repair: "TRACK-A4-STREAM-HANDOFF-FOLLOWUP",
  runtime_ux_repair: "TRACK-A4-RUNTIME-UX-HANDOFF-FOLLOWUP",
  git_history_conformance_repair: "TRACK-A8-PHASE-CONFORMANCE-HANDOFF-FOLLOWUP",
};
const expectedDependencyGateIds = [
  "DEP-FORGE",
  "DEP-TAILWIND",
  "DEP-REACT-FLOW",
  "DEP-UPDATER",
];
const expectedCarriedForwardTriggerIds = [
  "attempt_completed_important_node",
  "references_manifest_change",
  "run_started",
  "run_terminal",
];
const expectedDeferredTriggerIds = [
  "human_gate_resolved",
  "memory_json_write",
  "repair_patch_applied",
  "workflow_draft_instantiated",
  "workflow_manual_edit_saved",
  "workflow_patch_applied_draft",
];
const forbiddenFragments = [
  "Review repair plan now",
  "Confirm workflow handoff",
  "Resume local request",
  "AppData",
  "outputDir",
  "outputPath",
  "jsonPath",
  "token=",
  "#hash",
  "rawPrompt",
  "rawInstructionText",
  "rawModelOutput",
  "rawResponseBody",
  "rawArtifactBody",
  "rawUploadedFileBytes",
  "rawFileContent",
  "raw_file_content",
  "rawCustomValue",
  "raw_custom_value",
  "rawCredentialValue",
  "raw_credential_value",
  "customValue",
  "custom_value",
  "instructionText",
  "instruction_text",
  "destinationPath",
  "destination_path",
  "cachePath",
  "cache_path",
  "prompt_to_user",
  "user staged content",
  "secure://",
  "cache://",
];
const forbiddenPatterns = [
  /[a-z]:\\\\/iu,
  /[a-z]:\//iu,
  /\\\\users\\\\/iu,
  /\/users\//iu,
  /\\\\appdata\\\\/iu,
  /\/appdata\//iu,
  /(^|[^a-z0-9_-])cache\/[a-z0-9_.-]+/iu,
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

function assertSanitizedJson(value, label) {
  const text = JSON.stringify(value);
  const lowerText = text.toLowerCase();
  for (const fragment of forbiddenFragments) {
    assertCondition(
      !lowerText.includes(fragment.toLowerCase()),
      `${label} must not contain forbidden fragment ${fragment}`,
    );
  }
  for (const pattern of forbiddenPatterns) {
    assertCondition(
      !pattern.test(text),
      `${label} must not contain forbidden pattern ${pattern}`,
    );
  }
}

function countBy(items, predicate) {
  return items.filter(predicate).length;
}

function parseSliceOrdinal(sliceId) {
  const match = /^W1\.5\.(\d+)$/.exec(sliceId);
  assertCondition(Boolean(match), `invalid slice id ${sliceId}`);
  return Number(match[1]);
}

function assertSliceAtLeast(actual, expected, message) {
  assertCondition(
    parseSliceOrdinal(actual) >= parseSliceOrdinal(expected),
    `${message}: expected ${actual} to be at least ${expected}`,
  );
}

function mapById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function collectDesktopPackageVersions(packageJson) {
  return new Map([
    ...Object.entries(packageJson.dependencies ?? {}),
    ...Object.entries(packageJson.devDependencies ?? {}),
  ]);
}

function handoffPackageFollowUpId(id) {
  return id.replace("HANDOFF-PACKAGE-DECISION-", "HANDOFF-PACKAGE-FOLLOW-UP-");
}

function handoffItemFollowUpId(id) {
  return id.replace("HANDOFF-ITEM-DECISION-", "HANDOFF-ITEM-FOLLOW-UP-");
}

function crossFollowUpId(id) {
  return id.replace("CROSS-HANDOFF-DECISION-", "CROSS-HANDOFF-FOLLOW-UP-");
}

function validateLedgerAndPackageWiring(
  needsFollowupPlan,
  readinessLedger,
  desktopPackage,
) {
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.230",
    "readiness ledger slice",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-10",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-10",
  );
  if (readinessLedger.slice === "W1.5.230") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.231"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.230"),
      "future readiness ledger must retain W1.5.230 evidence",
    );
  }
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-package-handoff-needs-followup-plan.test.cjs",
    ),
    "desktop package gate wiring",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-package-handoff-decision-record.test.cjs",
    ),
    "source decision package gate wiring",
  );

  const desktopPackageVersions = collectDesktopPackageVersions(desktopPackage);
  assertDeepEqual(
    readinessLedger.dependency_boundary.requires_separate_gate.map(
      (gate) => gate.id,
    ),
    expectedDependencyGateIds,
    "dependency gate ids",
  );
  for (const gate of readinessLedger.dependency_boundary
    .requires_separate_gate) {
    for (const packageName of gate.packages) {
      assertEqual(
        desktopPackageVersions.has(packageName),
        false,
        `dependency-gated package must stay absent: ${packageName}`,
      );
    }
  }

  assertDeepEqual(
    needsFollowupPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.231"],
    "plan next recommended slices",
  );
}

function validateTracks(needsFollowupPlan, decisionRecord) {
  assertDeepEqual(
    sorted(needsFollowupPlan.follow_up_tracks.map((track) => track.id)),
    sorted(Object.values(expectedTrackByReviewGroup)),
    "follow-up track ids",
  );
  for (const track of needsFollowupPlan.follow_up_tracks) {
    assertEqual(track.status, "planned_not_implemented", `${track.id} status`);
    assertEqual(
      track.id,
      expectedTrackByReviewGroup[track.review_group],
      `${track.id} review group mapping`,
    );
    assertEqual(track.entry_slice, "W1.5.230", `${track.id} entry slice`);
    assertEqual(
      track.source_handoff_package_decision_count,
      countBy(
        decisionRecord.handoff_package_decision_items,
        (item) => item.route_group === track.review_group,
      ),
      `${track.id} source package count`,
    );
    assertEqual(
      track.source_routed_blocker_handoff_decision_count,
      countBy(
        decisionRecord.routed_blocker_handoff_decision_items,
        (item) => item.review_group === track.review_group,
      ),
      `${track.id} source item count`,
    );
  }
}

function validatePackageFollowUps(needsFollowupPlan, decisionRecord) {
  const sourceById = mapById(decisionRecord.handoff_package_decision_items);
  const followUps = needsFollowupPlan.handoff_package_follow_up_items;
  assertDeepEqual(
    sorted(followUps.map((item) => item.source_handoff_package_decision_id)),
    sorted(
      decisionRecord.handoff_package_decision_items.map((item) => item.id),
    ),
    "source handoff package decision ids",
  );

  for (const item of followUps) {
    const source = sourceById.get(item.source_handoff_package_decision_id);
    assertCondition(
      source !== undefined,
      `${item.id} source handoff package decision exists`,
    );
    assertEqual(
      item.id,
      handoffPackageFollowUpId(source.id),
      `${item.id} follow-up id`,
    );
    assertEqual(
      item.source_decision_record_slice,
      "W1.5.229",
      `${item.id} source slice`,
    );
    assertEqual(item.source_decision, "needs_followup", `${item.id} decision`);
    assertEqual(
      item.source_decision_status,
      "reviewed_handoff_package_needs_followup_not_accepted",
      `${item.id} source decision status`,
    );
    assertEqual(
      item.follow_up_status,
      "planned_not_implemented",
      `${item.id} follow-up status`,
    );
    assertEqual(item.accepted, false, `${item.id} accepted`);
    assertEqual(item.implemented, false, `${item.id} implemented`);
    assertEqual(item.source_accepted, false, `${item.id} source accepted`);
    assertEqual(
      item.source_implemented,
      false,
      `${item.id} source implemented`,
    );
    assertEqual(item.follow_up_required, true, `${item.id} follow-up required`);
    assertEqual(
      item.track_id,
      expectedTrackByReviewGroup[source.route_group],
      `${item.id} track id`,
    );
    assertDeepEqual(item.fr_ids, source.fr_ids, `${item.id} FR ids`);
    assertDeepEqual(
      sorted(item.source_handoff_item_decision_ids),
      sorted(
        source.source_handoff_item_ids.map((sourceId) =>
          sourceId.replace("HANDOFF-ITEM-", "HANDOFF-ITEM-DECISION-"),
        ),
      ),
      `${item.id} source handoff item decision ids`,
    );
    assertCondition(
      item.remaining_package_blockers.length > 0,
      `${item.id} remaining package blockers`,
    );
    assertCondition(item.evidence_refs.length > 0, `${item.id} evidence refs`);
    assertCondition(
      item.evidence_refs.includes(
        `docs/04_runbook/m1.5-a4-a8-routed-package-handoff-decision-record.json#${source.id}`,
      ),
      `${item.id} source evidence ref`,
    );
    assertCondition(
      item.next_action_refs.length > 0,
      `${item.id} next action refs`,
    );
  }
}

function validateRoutedBlockerFollowUps(needsFollowupPlan, decisionRecord) {
  const sourceById = mapById(
    decisionRecord.routed_blocker_handoff_decision_items,
  );
  const packageFollowUpsById = mapById(
    needsFollowupPlan.handoff_package_follow_up_items,
  );
  const followUps = needsFollowupPlan.routed_blocker_handoff_follow_up_items;
  assertDeepEqual(
    sorted(followUps.map((item) => item.source_handoff_item_decision_id)),
    sorted(
      decisionRecord.routed_blocker_handoff_decision_items.map(
        (item) => item.id,
      ),
    ),
    "source routed blocker handoff decision ids",
  );

  for (const item of followUps) {
    const source = sourceById.get(item.source_handoff_item_decision_id);
    assertCondition(
      source !== undefined,
      `${item.id} source routed blocker decision exists`,
    );
    assertEqual(
      item.id,
      handoffItemFollowUpId(source.id),
      `${item.id} follow-up id`,
    );
    assertEqual(item.fr_id, source.fr_id, `${item.id} FR id`);
    assertCondition(item.fr_id !== "FR-015", `${item.id} must exclude FR-015`);
    assertEqual(item.source_decision, "needs_followup", `${item.id} decision`);
    assertEqual(
      item.source_decision_status,
      "reviewed_handoff_item_needs_followup_not_accepted",
      `${item.id} source decision status`,
    );
    assertEqual(
      item.follow_up_status,
      "planned_not_implemented",
      `${item.id} follow-up status`,
    );
    assertEqual(item.accepted, false, `${item.id} accepted`);
    assertEqual(item.implemented, false, `${item.id} implemented`);
    assertEqual(item.source_accepted, false, `${item.id} source accepted`);
    assertEqual(
      item.source_implemented,
      false,
      `${item.id} source implemented`,
    );
    assertEqual(item.follow_up_required, true, `${item.id} follow-up required`);
    assertEqual(item.package_required, true, `${item.id} package required`);
    assertEqual(
      item.track_id,
      expectedTrackByReviewGroup[source.review_group],
      `${item.id} track id`,
    );
    assertCondition(
      packageFollowUpsById.has(item.handoff_package_follow_up_id),
      `${item.id} handoff package follow-up exists`,
    );
    assertCondition(
      item.acceptance_blockers.length > 0,
      `${item.id} acceptance blockers`,
    );
    assertCondition(item.evidence_refs.length > 0, `${item.id} evidence refs`);
    assertCondition(
      item.evidence_refs.includes(
        `docs/04_runbook/m1.5-a4-a8-routed-package-handoff-decision-record.json#${source.id}`,
      ),
      `${item.id} source evidence ref`,
    );
  }
}

function validateCrossCuttingFollowUps(
  needsFollowupPlan,
  decisionRecord,
  adr0012Text,
) {
  const sourceById = mapById(decisionRecord.cross_cutting_decision_items);
  const followUps = needsFollowupPlan.cross_cutting_follow_up_items;
  assertDeepEqual(
    sorted(followUps.map((item) => item.source_cross_cutting_decision_id)),
    sorted(decisionRecord.cross_cutting_decision_items.map((item) => item.id)),
    "source cross-cutting decision ids",
  );

  const followUpsById = mapById(followUps);
  const dependency = followUpsById.get(
    "CROSS-HANDOFF-FOLLOW-UP-DEPENDENCY-GATED-DESKTOP-SURFACES",
  );
  const fr015 = followUpsById.get(
    "CROSS-HANDOFF-FOLLOW-UP-FR-015-CONTRACT-GATE",
  );
  const m16 = followUpsById.get("CROSS-HANDOFF-FOLLOW-UP-M1-6-DEMO-EVIDENCE");
  assertCondition(dependency !== undefined, "dependency follow-up exists");
  assertCondition(fr015 !== undefined, "FR-015 follow-up exists");
  assertCondition(m16 !== undefined, "M1.6 follow-up exists");
  assertEqual(
    dependency.follow_up_status,
    "blocked_not_implemented",
    "dependency follow-up status",
  );
  assertDeepEqual(
    dependency.dependency_gate_ids,
    expectedDependencyGateIds,
    "dependency gate ids",
  );
  assertEqual(fr015.fr_id, "FR-015", "FR-015 id");
  assertEqual(fr015.current_adr_status, "Proposed", "FR-015 ADR status");
  assertCondition(
    /\|\s*Status\s*\|\s*Proposed\s*\|/u.test(adr0012Text),
    "ADR-0012 must remain Proposed",
  );
  assertEqual(
    fr015.follow_up_status,
    "blocked_not_implemented",
    "FR-015 follow-up status",
  );
  assertEqual(
    m16.follow_up_status,
    "deferred_not_implemented",
    "M1.6 follow-up status",
  );

  for (const item of followUps) {
    const source = sourceById.get(item.source_cross_cutting_decision_id);
    assertCondition(source !== undefined, `${item.id} source exists`);
    assertEqual(item.id, crossFollowUpId(source.id), `${item.id} id`);
    assertEqual(item.accepted, false, `${item.id} accepted`);
    assertEqual(item.implemented, false, `${item.id} implemented`);
    assertCondition(
      item.evidence_refs.includes(
        `docs/04_runbook/m1.5-a4-a8-routed-package-handoff-decision-record.json#${source.id}`,
      ),
      `${item.id} source evidence ref`,
    );
  }
}

function validateA8FollowUpPlan(needsFollowupPlan, decisionRecord) {
  const a8 = needsFollowupPlan.a8_phase_conformance_follow_up_plan;
  const source = decisionRecord.a8_phase_conformance_decision_context;
  assertEqual(a8.plan_status, "planned_not_implemented", "A8 plan status");
  assertEqual(a8.accepted, false, "A8 accepted");
  assertEqual(a8.implemented, false, "A8 implemented");
  assertEqual(a8.phase_conformance_accepted_items, 0, "A8 accepted item count");
  assertEqual(
    a8.runtime_harness_8_2_trigger_count,
    source.runtime_harness_8_2_trigger_count,
    "A8 trigger count",
  );
  assertEqual(
    a8.evidence_carried_forward_trigger_count,
    source.evidence_carried_forward_trigger_count,
    "A8 carried-forward count",
  );
  assertEqual(
    a8.explicitly_deferred_trigger_count,
    source.explicitly_deferred_trigger_count,
    "A8 deferred count",
  );
  assertDeepEqual(
    sorted(a8.carried_forward_trigger_ids),
    sorted(expectedCarriedForwardTriggerIds),
    "A8 carried-forward ids",
  );
  assertDeepEqual(
    sorted(a8.deferred_trigger_ids),
    sorted(expectedDeferredTriggerIds),
    "A8 deferred ids",
  );
  assertDeepEqual(
    a8.trigger_rows.map((row) => row.trigger_id),
    source.trigger_rows.map((row) => row.trigger_id),
    "A8 trigger row ids",
  );
  assertEqual(
    countBy(a8.trigger_rows, (row) => row.accepted === true),
    0,
    "A8 trigger rows accepted",
  );
}

function validateSummary(needsFollowupPlan, decisionRecord) {
  const summary = needsFollowupPlan.summary;
  assertEqual(
    summary.handoff_package_follow_up_item_count,
    needsFollowupPlan.handoff_package_follow_up_items.length,
    "summary handoff package follow-up count",
  );
  assertEqual(
    summary.routed_blocker_handoff_follow_up_item_count,
    needsFollowupPlan.routed_blocker_handoff_follow_up_items.length,
    "summary routed blocker handoff follow-up count",
  );
  assertEqual(summary.total_handoff_follow_up_item_count, 14, "summary total");
  assertEqual(summary.accepted_items, 0, "summary accepted");
  assertEqual(summary.rejected_items, 0, "summary rejected");
  assertEqual(summary.implemented_items, 0, "summary implemented");
  assertEqual(
    summary.planned_not_implemented_items,
    14,
    "summary planned not implemented",
  );
  assertEqual(
    summary.source_handoff_package_decisions,
    decisionRecord.handoff_package_decision_items.length,
    "summary source package decisions",
  );
  assertEqual(
    summary.source_routed_blocker_handoff_decisions,
    decisionRecord.routed_blocker_handoff_decision_items.length,
    "summary source blocker decisions",
  );
  assertEqual(
    summary.source_needs_followup_not_accepted_decisions,
    14,
    "summary source needs-followup decisions",
  );
  assertEqual(
    summary.cross_cutting_follow_up_item_count,
    needsFollowupPlan.cross_cutting_follow_up_items.length,
    "summary cross-cutting count",
  );
  assertEqual(
    summary.runtime_harness_8_2_trigger_count,
    10,
    "summary A8 trigger count",
  );
  assertEqual(
    summary.evidence_carried_forward_trigger_count,
    4,
    "summary carried-forward count",
  );
  assertEqual(summary.explicitly_deferred_trigger_count, 6, "summary deferred");
  assertEqual(
    summary.phase_conformance_accepted_items,
    0,
    "summary phase conformance accepted",
  );
  assertEqual(summary.exit_p1_1_status, "not_ready", "summary EXIT-P1-1");
  assertEqual(summary.exit_p1_10_status, "not_ready", "summary EXIT-P1-10");
}

function validateA4A8RoutedPackageHandoffNeedsFollowupPlan(options = {}) {
  const needsFollowupPlan = readJson(
    options.needsFollowupPlanPath ?? needsFollowupPlanPath,
  );
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );
  const adr0012Text = readText(options.adr0012Path ?? adr0012Path);

  validateA4A8RoutedPackageHandoffDecisionRecord({
    decisionRecordPath: options.decisionRecordPath ?? decisionRecordPath,
    readinessLedgerPath: options.readinessLedgerPath ?? readinessLedgerPath,
    desktopPackagePath: options.desktopPackagePath ?? desktopPackagePath,
    adr0012Path: options.adr0012Path ?? adr0012Path,
  });

  assertSanitizedJson(
    needsFollowupPlan,
    "A4/A8 routed package handoff needs-followup plan",
  );
  assertEqual(needsFollowupPlan.schema_version, "0.1.0", "schema version");
  assertEqual(needsFollowupPlan.milestone, "M1.5", "milestone");
  assertEqual(needsFollowupPlan.slice, "W1.5.230", "slice id");
  assertEqual(
    needsFollowupPlan.plan_status,
    "a4_a8_routed_package_handoff_needs_followup_plan_prepared_not_implemented",
    "plan status",
  );
  assertEqual(needsFollowupPlan.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(needsFollowupPlan.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .accepted_item_count_must_remain_zero,
    true,
    "accepted item guard",
  );
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .implemented_item_count_must_remain_zero,
    true,
    "implemented item guard",
  );
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );

  validateLedgerAndPackageWiring(
    needsFollowupPlan,
    readinessLedger,
    desktopPackage,
  );
  validateTracks(needsFollowupPlan, decisionRecord);
  validatePackageFollowUps(needsFollowupPlan, decisionRecord);
  validateRoutedBlockerFollowUps(needsFollowupPlan, decisionRecord);
  validateCrossCuttingFollowUps(needsFollowupPlan, decisionRecord, adr0012Text);
  validateA8FollowUpPlan(needsFollowupPlan, decisionRecord);
  validateSummary(needsFollowupPlan, decisionRecord);

  return {
    status: needsFollowupPlan.plan_status,
    exitP1_1Status: needsFollowupPlan.exit_p1_1_status,
    exitP1_10Status: needsFollowupPlan.exit_p1_10_status,
    handoffPackageFollowUpItemCount:
      needsFollowupPlan.summary.handoff_package_follow_up_item_count,
    routedBlockerHandoffFollowUpItemCount:
      needsFollowupPlan.summary.routed_blocker_handoff_follow_up_item_count,
    totalHandoffFollowUpItemCount:
      needsFollowupPlan.summary.total_handoff_follow_up_item_count,
    streamPackageFollowUpItemCount:
      needsFollowupPlan.summary.stream_package_follow_up_items,
    runtimeUxPackageFollowUpItemCount:
      needsFollowupPlan.summary.runtime_ux_package_follow_up_items,
    gitHistoryPackageFollowUpItemCount:
      needsFollowupPlan.summary.git_history_package_follow_up_items,
    streamRoutedBlockerFollowUpItemCount:
      needsFollowupPlan.summary.stream_routed_blocker_follow_up_items,
    runtimeUxRoutedBlockerFollowUpItemCount:
      needsFollowupPlan.summary.runtime_ux_routed_blocker_follow_up_items,
    gitHistoryRoutedBlockerFollowUpItemCount:
      needsFollowupPlan.summary.git_history_routed_blocker_follow_up_items,
    acceptedItemCount: needsFollowupPlan.summary.accepted_items,
    rejectedItemCount: needsFollowupPlan.summary.rejected_items,
    implementedItemCount: needsFollowupPlan.summary.implemented_items,
    plannedNotImplementedItemCount:
      needsFollowupPlan.summary.planned_not_implemented_items,
    crossCuttingFollowUpItemCount:
      needsFollowupPlan.summary.cross_cutting_follow_up_item_count,
    blockedCrossCuttingFollowUpItemCount:
      needsFollowupPlan.summary.blocked_cross_cutting_follow_up_items,
    deferredCrossCuttingFollowUpItemCount:
      needsFollowupPlan.summary.deferred_cross_cutting_follow_up_items,
    runtimeHarness8_2TriggerCount:
      needsFollowupPlan.summary.runtime_harness_8_2_trigger_count,
    evidenceCarriedForwardTriggerCount:
      needsFollowupPlan.summary.evidence_carried_forward_trigger_count,
    explicitlyDeferredTriggerCount:
      needsFollowupPlan.summary.explicitly_deferred_trigger_count,
    phaseConformanceAcceptedItemCount:
      needsFollowupPlan.summary.phase_conformance_accepted_items,
    sourceHandoffPackageDecisionIds:
      needsFollowupPlan.handoff_package_follow_up_items.map(
        (item) => item.source_handoff_package_decision_id,
      ),
    sourceHandoffItemDecisionIds:
      needsFollowupPlan.routed_blocker_handoff_follow_up_items.map(
        (item) => item.source_handoff_item_decision_id,
      ),
    excludedFrIds: needsFollowupPlan.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: needsFollowupPlan.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4A8RoutedPackageHandoffNeedsFollowupPlan();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4A8RoutedPackageHandoffNeedsFollowupPlan,
};
