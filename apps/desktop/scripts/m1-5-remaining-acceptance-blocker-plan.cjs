const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const blockerPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-remaining-acceptance-blocker-plan.json",
);
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-packaged-follow-up-decision-record.json",
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

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRuntimeUxFrIds = [
  "FR-007",
  "FR-008",
  "FR-011",
  "FR-013",
  "FR-014",
  "FR-017",
  "FR-018",
];
const expectedGitHistoryFrIds = ["FR-012"];
const expectedAllFrIds = [
  ...expectedStreamFrIds,
  ...expectedRuntimeUxFrIds,
  ...expectedGitHistoryFrIds,
];
const expectedTrackIds = [
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE-BLOCKERS",
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE-BLOCKERS",
  "TRACK-A8-PHASE-CONFORMANCE-BLOCKERS",
  "TRACK-DEPENDENCY-GATED-DESKTOP-SURFACES",
  "TRACK-FR-015-CONTRACT-GATED-BLOCKERS",
  "TRACK-M1-6-DEMO-AND-PHASE-EVIDENCE",
];
const expectedFrIdsByTrack = {
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE-BLOCKERS": expectedStreamFrIds,
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE-BLOCKERS": expectedRuntimeUxFrIds,
  "TRACK-A8-PHASE-CONFORMANCE-BLOCKERS": expectedGitHistoryFrIds,
};
const expectedTrackByReviewGroup = {
  stream_acceptance_repair: "TRACK-A4-STREAM-FINAL-ACCEPTANCE-BLOCKERS",
  runtime_ux_repair: "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE-BLOCKERS",
  git_history_conformance_repair: "TRACK-A8-PHASE-CONFORMANCE-BLOCKERS",
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
  const actualOrdinal = parseSliceOrdinal(actual);
  const expectedOrdinal = parseSliceOrdinal(expected);
  assertCondition(
    actualOrdinal >= expectedOrdinal,
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

function optionalEqual(actual, expected, key, message) {
  if (expected[key] !== undefined) {
    assertEqual(actual[key], expected[key], `${message} ${key}`);
  } else {
    assertEqual(actual[key], undefined, `${message} ${key}`);
  }
}

function validateLedgerAndDependencyBoundary(
  blockerPlan,
  readinessLedger,
  desktopPackage,
) {
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.224",
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
  if (readinessLedger.slice === "W1.5.224") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.225"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.224"),
      "future readiness ledger must retain W1.5.224 evidence",
    );
  }

  const desktopPackageVersions = collectDesktopPackageVersions(desktopPackage);
  const ledgerDependencyGates =
    readinessLedger.dependency_boundary.requires_separate_gate;
  assertDeepEqual(
    ledgerDependencyGates.map((gate) => gate.id),
    expectedDependencyGateIds,
    "readiness ledger dependency gate ids",
  );
  const planDependencyGateTrack = blockerPlan.remaining_blocker_tracks.find(
    (track) => track.id === "TRACK-DEPENDENCY-GATED-DESKTOP-SURFACES",
  );
  assertDeepEqual(
    planDependencyGateTrack.dependency_gate_ids,
    expectedDependencyGateIds,
    "plan dependency gate ids",
  );
  for (const gate of ledgerDependencyGates) {
    for (const packageName of gate.packages) {
      assertEqual(
        desktopPackageVersions.has(packageName),
        false,
        `${packageName} must stay out of package.json before dependency gate`,
      );
    }
  }
}

function validateTracks(blockerPlan) {
  const tracks = blockerPlan.remaining_blocker_tracks;
  const tracksById = mapById(tracks);

  assertDeepEqual(
    sorted(tracks.map((track) => track.id)),
    sorted(expectedTrackIds),
    "remaining blocker track ids",
  );

  for (const [trackId, frIds] of Object.entries(expectedFrIdsByTrack)) {
    const track = tracksById.get(trackId);
    assertCondition(Boolean(track), `${trackId} track`);
    assertEqual(track.status, "planned_not_implemented", `${trackId} status`);
    assertDeepEqual(sorted(track.fr_ids), sorted(frIds), `${trackId} FR ids`);
    assertCondition(
      typeof track.entry_slice === "string" && track.entry_slice.length > 0,
      `${trackId} entry slice`,
    );
  }

  assertEqual(
    tracksById.get("TRACK-DEPENDENCY-GATED-DESKTOP-SURFACES")?.status,
    "blocked_by_dependency_gate",
    "dependency gate track status",
  );
  assertEqual(
    tracksById.get("TRACK-FR-015-CONTRACT-GATED-BLOCKERS")?.status,
    "blocked_by_contract_gate",
    "FR-015 contract track status",
  );
  assertEqual(
    tracksById.get("TRACK-FR-015-CONTRACT-GATED-BLOCKERS")?.current_adr_status,
    "Proposed",
    "FR-015 ADR current status",
  );
  assertEqual(
    tracksById.get("TRACK-M1-6-DEMO-AND-PHASE-EVIDENCE")?.status,
    "deferred_to_m1_6",
    "M1.6 deferred track status",
  );
}

function validateRemainingBlockerItems(blockerPlan, decisionRecord) {
  const decisionItems = decisionRecord.packaged_follow_up_decision_items;
  const sourceItemsById = mapById(decisionItems);
  const tracksById = mapById(blockerPlan.remaining_blocker_tracks);
  const remainingItems = blockerPlan.remaining_blocker_items;

  assertEqual(remainingItems.length, decisionItems.length, "blocker count");
  assertDeepEqual(
    sorted(
      remainingItems.map((item) => item.source_packaged_follow_up_decision_id),
    ),
    sorted(decisionItems.map((item) => item.id)),
    "source packaged decision ids",
  );
  assertDeepEqual(
    sorted(remainingItems.map((item) => item.fr_id)),
    sorted(expectedAllFrIds),
    "remaining blocker FR ids",
  );
  assertCondition(
    !remainingItems.some((item) => item.fr_id === "FR-015"),
    "FR-015 must stay out of source remaining blocker items",
  );

  for (const blockerItem of remainingItems) {
    const sourceItem = sourceItemsById.get(
      blockerItem.source_packaged_follow_up_decision_id,
    );
    const track = tracksById.get(blockerItem.track_id);
    assertCondition(Boolean(sourceItem), `${blockerItem.id} source item`);
    assertCondition(Boolean(track), `${blockerItem.id} track`);
    assertEqual(
      blockerItem.source_decision_record_slice,
      "W1.5.223",
      `${blockerItem.id} source slice`,
    );
    assertEqual(
      blockerItem.blocker_status,
      "planned_not_implemented",
      `${blockerItem.id} blocker status`,
    );
    assertEqual(blockerItem.accepted, false, `${blockerItem.id} accepted`);
    assertEqual(
      blockerItem.implemented,
      false,
      `${blockerItem.id} implemented`,
    );
    assertEqual(
      blockerItem.follow_up_required,
      true,
      `${blockerItem.id} follow-up required`,
    );
    assertEqual(
      blockerItem.fr_id,
      sourceItem.fr_id,
      `${blockerItem.id} source FR id`,
    );
    assertEqual(
      blockerItem.review_group,
      sourceItem.review_group,
      `${blockerItem.id} review group`,
    );
    assertEqual(
      blockerItem.decision_owner,
      sourceItem.decision_owner,
      `${blockerItem.id} decision owner`,
    );
    assertEqual(
      blockerItem.track_id,
      expectedTrackByReviewGroup[sourceItem.review_group],
      `${blockerItem.id} track by review group`,
    );
    assertCondition(
      track.fr_ids.includes(blockerItem.fr_id),
      `${blockerItem.id} track FR membership`,
    );
    for (const key of [
      "source_package_artifact",
      "source_package_slice",
      "source_package_item_id",
      "source_package_status",
      "source_follow_up_item_id",
      "source_blocker_repair_decision_id",
      "source_repair_item_id",
      "source_follow_up_status",
      "source_repair_status",
    ]) {
      assertEqual(
        blockerItem[key],
        sourceItem[key],
        `${blockerItem.id} ${key}`,
      );
    }
    assertEqual(
      blockerItem.source_decision,
      sourceItem.decision,
      `${blockerItem.id} source decision`,
    );
    assertEqual(
      blockerItem.source_decision,
      "needs_followup",
      `${blockerItem.id} needs-followup source decision`,
    );
    assertEqual(
      blockerItem.source_decision_status,
      sourceItem.decision_status,
      `${blockerItem.id} source decision status`,
    );
    assertEqual(
      blockerItem.source_decision_status,
      "reviewed_packaged_follow_up_needs_followup_not_accepted",
      `${blockerItem.id} needs-followup-not-accepted status`,
    );
    optionalEqual(
      blockerItem,
      sourceItem,
      "source_runtime_bridge_capture_item_id",
      blockerItem.id,
    );
    optionalEqual(
      blockerItem,
      sourceItem,
      "source_capture_status",
      blockerItem.id,
    );
    optionalEqual(
      blockerItem,
      sourceItem,
      "source_prerequisite_item_id",
      blockerItem.id,
    );
    optionalEqual(
      blockerItem,
      sourceItem,
      "source_prerequisite_status",
      blockerItem.id,
    );
    assertDeepEqual(
      blockerItem.acceptance_blockers,
      sourceItem.remaining_acceptance_blockers,
      `${blockerItem.id} acceptance blockers`,
    );
    assertCondition(
      blockerItem.acceptance_blockers.length > 0,
      `${blockerItem.id} acceptance blockers present`,
    );
    assertCondition(
      blockerItem.required_actions.length > 0,
      `${blockerItem.id} required actions`,
    );
    assertCondition(
      blockerItem.next_action_refs.length > 0,
      `${blockerItem.id} next action refs`,
    );
    assertCondition(
      blockerItem.evidence_refs.some((ref) =>
        ref.includes(blockerItem.source_packaged_follow_up_decision_id),
      ),
      `${blockerItem.id} source decision evidence ref`,
    );
    for (const sourceId of [
      blockerItem.source_package_item_id,
      blockerItem.source_follow_up_item_id,
      blockerItem.source_blocker_repair_decision_id,
      blockerItem.source_repair_item_id,
      blockerItem.source_runtime_bridge_capture_item_id,
      blockerItem.source_prerequisite_item_id,
    ].filter(Boolean)) {
      assertCondition(
        blockerItem.evidence_refs.some((ref) => ref.includes(sourceId)),
        `${blockerItem.id} evidence ref for ${sourceId}`,
      );
    }
  }
}

function validateA8PhaseConformancePlan(blockerPlan, decisionRecord) {
  const plan = blockerPlan.a8_phase_conformance_plan;
  const context = decisionRecord.a8_runtime_harness_8_2_decision_context;
  const sourceRowsById = mapById(context.trigger_rows);

  assertEqual(
    plan.plan_status,
    "a8_phase_conformance_blockers_planned_not_accepted",
    "A8 plan status",
  );
  assertEqual(plan.phase_exit_decision_status, "not_ready", "A8 phase status");
  assertEqual(
    plan.runtime_harness_8_2_trigger_count,
    context.runtime_harness_8_2_trigger_count,
    "A8 trigger count",
  );
  assertEqual(
    plan.evidence_carried_forward_trigger_count,
    context.evidence_carried_forward_trigger_count,
    "A8 carried-forward count",
  );
  assertEqual(
    plan.explicitly_deferred_trigger_count,
    context.explicitly_deferred_trigger_count,
    "A8 deferred count",
  );
  assertEqual(plan.phase_conformance_accepted_items, 0, "A8 accepted count");
  assertDeepEqual(
    sorted(plan.carried_forward_trigger_ids),
    expectedCarriedForwardTriggerIds,
    "A8 carried-forward trigger ids",
  );
  assertDeepEqual(
    sorted(plan.deferred_trigger_ids),
    expectedDeferredTriggerIds,
    "A8 deferred trigger ids",
  );
  assertDeepEqual(
    plan.trigger_rows.map((row) => row.id),
    context.trigger_rows.map((row) => row.id),
    "A8 trigger row order",
  );
  for (const row of plan.trigger_rows) {
    const sourceRow = sourceRowsById.get(row.id);
    assertCondition(Boolean(sourceRow), `${row.id} source row`);
    assertEqual(row.accepted, false, `${row.id} accepted`);
    assertEqual(row.implemented, false, `${row.id} implemented`);
    assertEqual(row.decision, "needs_followup", `${row.id} decision`);
    assertEqual(
      row.decision_status,
      "reviewed_packaged_follow_up_needs_followup_not_accepted",
      `${row.id} decision status`,
    );
    assertEqual(
      row.conformance_disposition,
      sourceRow.conformance_disposition,
      `${row.id} disposition`,
    );
    if (
      row.conformance_disposition ===
      "evidence_carried_forward_not_phase_accepted"
    ) {
      assertEqual(
        row.blocker_status,
        "needs_phase_acceptance",
        `${row.id} carried-forward blocker status`,
      );
    } else {
      assertEqual(
        row.blocker_status,
        "deferred_not_implemented",
        `${row.id} deferred blocker status`,
      );
      assertCondition(
        typeof row.deferred_reason === "string" &&
          row.deferred_reason.length > 0,
        `${row.id} deferred reason`,
      );
    }
    assertCondition(
      typeof row.required_action === "string" &&
        row.required_action.includes("EXIT-P1-10"),
      `${row.id} required action`,
    );
  }
}

function validateCrossCuttingBlockers(blockerPlan, adr0012Text) {
  const blockersById = mapById(blockerPlan.cross_cutting_blockers);
  const dependencyBlocker = blockersById.get(
    "CROSS-BLOCKER-DEPENDENCY-GATED-DESKTOP-SURFACES",
  );
  const fr015Blocker = blockersById.get("CROSS-BLOCKER-FR-015-CONTRACT-GATE");
  const m16Blocker = blockersById.get("CROSS-BLOCKER-M1-6-DEMO-EVIDENCE");

  assertCondition(Boolean(dependencyBlocker), "dependency blocker");
  assertCondition(Boolean(fr015Blocker), "FR-015 blocker");
  assertCondition(Boolean(m16Blocker), "M1.6 blocker");
  assertEqual(
    dependencyBlocker.blocker_status,
    "blocked_by_dependency_gate",
    "dependency blocker status",
  );
  assertDeepEqual(
    dependencyBlocker.dependency_gate_ids,
    expectedDependencyGateIds,
    "dependency blocker gates",
  );
  assertEqual(
    fr015Blocker.blocker_status,
    "blocked_by_contract_gate",
    "FR-015 blocker status",
  );
  assertEqual(fr015Blocker.fr_id, "FR-015", "FR-015 blocker FR");
  assertEqual(
    fr015Blocker.current_adr_status,
    "Proposed",
    "FR-015 blocker ADR status",
  );
  assertCondition(
    /\|\s*Status\s*\|\s*Proposed\s*\|/u.test(adr0012Text),
    "ADR-0012 must remain Proposed for this blocker plan",
  );
  assertEqual(
    m16Blocker.blocker_status,
    "deferred_to_m1_6",
    "M1.6 blocker status",
  );
  assertDeepEqual(
    m16Blocker.exit_ids,
    ["EXIT-P1-2", "EXIT-P1-3", "EXIT-P1-11"],
    "M1.6 blocker exit ids",
  );
  for (const blocker of blockerPlan.cross_cutting_blockers) {
    assertEqual(blocker.accepted, false, `${blocker.id} accepted`);
    assertEqual(blocker.implemented, false, `${blocker.id} implemented`);
    assertEqual(
      blocker.follow_up_required,
      true,
      `${blocker.id} follow-up required`,
    );
    assertCondition(
      blocker.required_actions.length > 0,
      `${blocker.id} required actions`,
    );
    assertCondition(
      blocker.evidence_refs.length > 0,
      `${blocker.id} evidence refs`,
    );
  }
}

function validateSummary(blockerPlan, decisionRecord) {
  const remainingItems = blockerPlan.remaining_blocker_items;
  const crossCuttingBlockers = blockerPlan.cross_cutting_blockers;
  const trackStatuses = new Map(
    blockerPlan.remaining_blocker_tracks.map((track) => [
      track.id,
      track.status,
    ]),
  );

  const acceptedItemCount = countBy(
    remainingItems,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    remainingItems,
    (item) => item.implemented === true,
  );
  const plannedItemCount = countBy(
    remainingItems,
    (item) => item.blocker_status === "planned_not_implemented",
  );

  assertEqual(
    blockerPlan.summary.remaining_blocker_item_count,
    remainingItems.length,
    "summary blocker count",
  );
  assertEqual(
    blockerPlan.summary.stream_acceptance_blocker_items,
    countBy(
      remainingItems,
      (item) => item.track_id === "TRACK-A4-STREAM-FINAL-ACCEPTANCE-BLOCKERS",
    ),
    "summary stream count",
  );
  assertEqual(
    blockerPlan.summary.runtime_ux_acceptance_blocker_items,
    countBy(
      remainingItems,
      (item) =>
        item.track_id === "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE-BLOCKERS",
    ),
    "summary runtime UX count",
  );
  assertEqual(
    blockerPlan.summary.git_history_conformance_blocker_items,
    countBy(
      remainingItems,
      (item) => item.track_id === "TRACK-A8-PHASE-CONFORMANCE-BLOCKERS",
    ),
    "summary Git-history count",
  );
  assertEqual(
    blockerPlan.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    blockerPlan.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    blockerPlan.summary.planned_not_implemented_items,
    plannedItemCount,
    "summary planned count",
  );
  assertEqual(
    blockerPlan.summary.source_decision_items,
    decisionRecord.summary.decision_item_count,
    "summary source decision count",
  );
  assertEqual(
    blockerPlan.summary.source_needs_followup_items,
    decisionRecord.summary.needs_followup_items,
    "summary source needs-followup count",
  );
  assertEqual(
    blockerPlan.summary.source_packaged_not_accepted_items,
    decisionRecord.summary.source_packaged_not_accepted_items,
    "summary source packaged-not-accepted count",
  );
  assertEqual(
    blockerPlan.summary.cross_cutting_blocker_items,
    crossCuttingBlockers.length,
    "summary cross-cutting blocker count",
  );
  assertEqual(
    blockerPlan.summary.dependency_gated_tracks,
    countBy(
      [...trackStatuses.values()],
      (status) => status === "blocked_by_dependency_gate",
    ),
    "summary dependency-gated tracks",
  );
  assertEqual(
    blockerPlan.summary.contract_gated_tracks,
    countBy(
      [...trackStatuses.values()],
      (status) => status === "blocked_by_contract_gate",
    ),
    "summary contract-gated tracks",
  );
  assertEqual(
    blockerPlan.summary.m1_6_deferred_tracks,
    countBy(
      [...trackStatuses.values()],
      (status) => status === "deferred_to_m1_6",
    ),
    "summary M1.6 deferred tracks",
  );
  assertEqual(
    blockerPlan.summary.runtime_harness_8_2_trigger_count,
    decisionRecord.summary.runtime_harness_8_2_trigger_count,
    "summary A8 trigger count",
  );
  assertEqual(
    blockerPlan.summary.evidence_carried_forward_trigger_count,
    expectedCarriedForwardTriggerIds.length,
    "summary carried-forward count",
  );
  assertEqual(
    blockerPlan.summary.explicitly_deferred_trigger_count,
    expectedDeferredTriggerIds.length,
    "summary deferred count",
  );
  assertEqual(
    blockerPlan.summary.phase_conformance_accepted_items,
    0,
    "summary phase accepted count",
  );
  assertEqual(
    blockerPlan.summary.excluded_items,
    blockerPlan.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    blockerPlan.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    blockerPlan.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    blockerPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.225"],
    "next recommended slices",
  );
}

function validateRemainingAcceptanceBlockerPlan(options = {}) {
  const blockerPlan = readJson(options.blockerPlanPath ?? blockerPlanPath);
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

  assertSanitizedJson(blockerPlan, "remaining acceptance blocker plan");
  assertEqual(blockerPlan.schema_version, "0.1.0", "schema version");
  assertEqual(blockerPlan.milestone, "M1.5", "milestone");
  assertEqual(blockerPlan.slice, "W1.5.224", "slice id");
  assertEqual(
    blockerPlan.plan_status,
    "remaining_acceptance_blocker_plan_prepared_not_implemented",
    "plan status",
  );
  assertEqual(blockerPlan.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(blockerPlan.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertEqual(
    blockerPlan.blocker_plan_contract.accepted_item_count_must_remain_zero,
    true,
    "accepted item guard",
  );
  assertEqual(
    blockerPlan.blocker_plan_contract.implemented_item_count_must_remain_zero,
    true,
    "implemented item guard",
  );
  assertEqual(
    blockerPlan.blocker_plan_contract.phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );
  assertEqual(
    blockerPlan.blocker_plan_contract.runner_script,
    "apps/desktop/scripts/m1-5-remaining-acceptance-blocker-plan.cjs",
    "runner script",
  );
  assertEqual(
    blockerPlan.blocker_plan_contract.focused_check,
    "node apps/desktop/scripts/m1-5-remaining-acceptance-blocker-plan.cjs --check",
    "focused check",
  );
  assertEqual(
    blockerPlan.blocker_plan_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-remaining-acceptance-blocker-plan.test.cjs",
    "focused test",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-remaining-acceptance-blocker-plan.test.cjs",
    ),
    "desktop package gate wiring",
  );

  assertEqual(decisionRecord.slice, "W1.5.223", "source decision slice");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_a8_packaged_follow_up_reviewer_decisions_recorded_needs_followup",
    "source decision status",
  );
  assertEqual(
    decisionRecord.summary.accepted_items,
    0,
    "source accepted items",
  );
  assertEqual(
    decisionRecord.summary.implemented_items,
    0,
    "source implemented items",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_items,
    decisionRecord.packaged_follow_up_decision_items.length,
    "source needs-followup items",
  );

  validateLedgerAndDependencyBoundary(
    blockerPlan,
    readinessLedger,
    desktopPackage,
  );
  validateTracks(blockerPlan);
  validateRemainingBlockerItems(blockerPlan, decisionRecord);
  validateA8PhaseConformancePlan(blockerPlan, decisionRecord);
  validateCrossCuttingBlockers(blockerPlan, adr0012Text);
  validateSummary(blockerPlan, decisionRecord);

  return {
    status: blockerPlan.plan_status,
    exitP1_1Status: blockerPlan.exit_p1_1_status,
    exitP1_10Status: blockerPlan.exit_p1_10_status,
    remainingBlockerItemCount: blockerPlan.remaining_blocker_items.length,
    streamAcceptanceBlockerItemCount:
      blockerPlan.summary.stream_acceptance_blocker_items,
    runtimeUxAcceptanceBlockerItemCount:
      blockerPlan.summary.runtime_ux_acceptance_blocker_items,
    gitHistoryConformanceBlockerItemCount:
      blockerPlan.summary.git_history_conformance_blocker_items,
    acceptedItemCount: blockerPlan.summary.accepted_items,
    implementedItemCount: blockerPlan.summary.implemented_items,
    plannedNotImplementedItemCount:
      blockerPlan.summary.planned_not_implemented_items,
    crossCuttingBlockerItemCount:
      blockerPlan.summary.cross_cutting_blocker_items,
    dependencyGatedTrackCount: blockerPlan.summary.dependency_gated_tracks,
    contractGatedTrackCount: blockerPlan.summary.contract_gated_tracks,
    m1_6DeferredTrackCount: blockerPlan.summary.m1_6_deferred_tracks,
    runtimeHarness8_2TriggerCount:
      blockerPlan.summary.runtime_harness_8_2_trigger_count,
    evidenceCarriedForwardTriggerCount:
      blockerPlan.summary.evidence_carried_forward_trigger_count,
    explicitlyDeferredTriggerCount:
      blockerPlan.summary.explicitly_deferred_trigger_count,
    phaseConformanceAcceptedItemCount:
      blockerPlan.summary.phase_conformance_accepted_items,
    frIds: blockerPlan.remaining_blocker_items.map((item) => item.fr_id),
    dependencyGateIds: blockerPlan.remaining_blocker_tracks.find(
      (track) => track.id === "TRACK-DEPENDENCY-GATED-DESKTOP-SURFACES",
    ).dependency_gate_ids,
    crossCuttingBlockerIds: blockerPlan.cross_cutting_blockers.map(
      (item) => item.id,
    ),
    nextRecommendedSlices: blockerPlan.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateRemainingAcceptanceBlockerPlan();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateRemainingAcceptanceBlockerPlan,
};
