const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const blockerRepairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-blocker-repair-plan.json",
);
const postCaptureDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-decision-record.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

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
const expectedTracks = [
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  "TRACK-A8-GIT-HISTORY-CONFORMANCE",
];
const expectedFrIdsByTrack = {
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE": expectedStreamFrIds,
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE": expectedRuntimeUxFrIds,
  "TRACK-A8-GIT-HISTORY-CONFORMANCE": expectedGitHistoryFrIds,
};
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
  "rawCustomValue",
  "rawCredentialValue",
  "secure://",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
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
  for (const fragment of forbiddenFragments) {
    assertCondition(
      !text.includes(fragment),
      `${label} must not contain forbidden fragment ${fragment}`,
    );
  }
}

function countBy(items, predicate) {
  return items.filter(predicate).length;
}

function validateA4PostCaptureBlockerRepairPlan(options = {}) {
  const blockerRepairPlan = readJson(
    options.blockerRepairPlanPath ?? blockerRepairPlanPath,
  );
  const postCaptureDecisionRecord = readJson(
    options.postCaptureDecisionRecordPath ?? postCaptureDecisionRecordPath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(blockerRepairPlan, "A4 post-capture blocker repair plan");
  assertEqual(blockerRepairPlan.schema_version, "0.1.0", "schema version");
  assertEqual(blockerRepairPlan.milestone, "M1.5", "milestone");
  assertEqual(blockerRepairPlan.slice, "W1.5.214", "slice id");
  assertEqual(
    blockerRepairPlan.plan_status,
    "a4_post_capture_blocker_repair_plan_prepared_not_implemented",
    "plan status",
  );
  assertEqual(
    blockerRepairPlan.exit_p1_1_status,
    "not_ready",
    "EXIT-P1-1 status",
  );
  assertEqual(
    blockerRepairPlan.exit_p1_10_status,
    "not_ready",
    "EXIT-P1-10 status",
  );

  assertEqual(
    postCaptureDecisionRecord.slice,
    "W1.5.213",
    "post-capture decision source slice",
  );
  assertEqual(
    postCaptureDecisionRecord.decision_record_status,
    "a4_post_capture_reviewer_decisions_recorded_needs_followup",
    "post-capture decision source status",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.accepted_items,
    0,
    "source accepted item count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.rejected_items,
    0,
    "source rejected item count",
  );
  assertEqual(
    postCaptureDecisionRecord.summary.needs_followup_items,
    postCaptureDecisionRecord.post_capture_decision_items.length,
    "source needs-followup item count",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-10",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-10 status",
  );

  const sourceItemsById = new Map(
    postCaptureDecisionRecord.post_capture_decision_items.map((item) => [
      item.id,
      item,
    ]),
  );
  const tracksById = new Map(
    blockerRepairPlan.repair_tracks.map((track) => [track.id, track]),
  );
  const trackItemCounts = new Map(expectedTracks.map((track) => [track, 0]));

  assertDeepEqual(
    sorted(blockerRepairPlan.repair_tracks.map((track) => track.id)),
    sorted(expectedTracks),
    "repair track ids",
  );
  assertEqual(
    blockerRepairPlan.repair_items.length,
    postCaptureDecisionRecord.post_capture_decision_items.length,
    "repair item count",
  );
  assertDeepEqual(
    sorted(
      blockerRepairPlan.repair_items.map(
        (item) => item.source_post_capture_decision_id,
      ),
    ),
    sorted(
      postCaptureDecisionRecord.post_capture_decision_items.map(
        (item) => item.id,
      ),
    ),
    "source post-capture decision ids",
  );
  assertDeepEqual(
    sorted(blockerRepairPlan.repair_items.map((item) => item.fr_id)),
    sorted(expectedAllFrIds),
    "repair item FR ids",
  );
  assertEqual(
    blockerRepairPlan.repair_items.some((item) => item.fr_id === "FR-015"),
    false,
    "FR-015 repair absence",
  );
  assertEqual(
    blockerRepairPlan.excluded_items.some((item) => item.fr_id === "FR-015"),
    true,
    "FR-015 excluded item",
  );

  for (const track of blockerRepairPlan.repair_tracks) {
    assertEqual(track.status, "planned_not_implemented", `${track.id} status`);
    assertDeepEqual(
      sorted(track.fr_ids),
      sorted(expectedFrIdsByTrack[track.id]),
      `${track.id} FR ids`,
    );
    assertCondition(
      typeof track.entry_slice === "string" && track.entry_slice.length > 0,
      `${track.id} entry slice`,
    );
  }

  for (const repairItem of blockerRepairPlan.repair_items) {
    const sourceItem = sourceItemsById.get(
      repairItem.source_post_capture_decision_id,
    );
    const track = tracksById.get(repairItem.track_id);

    assertCondition(Boolean(sourceItem), `${repairItem.id} source item`);
    assertCondition(Boolean(track), `${repairItem.id} track`);
    assertEqual(
      repairItem.fr_id,
      sourceItem.fr_id,
      `${repairItem.id} source FR id`,
    );
    assertEqual(
      sourceItem.post_capture_decision,
      "needs_followup",
      `${repairItem.id} source post-capture decision`,
    );
    assertEqual(sourceItem.accepted, false, `${repairItem.id} source accepted`);
    assertEqual(sourceItem.rejected, false, `${repairItem.id} source rejected`);
    assertEqual(
      repairItem.source_post_capture_decision,
      sourceItem.post_capture_decision,
      `${repairItem.id} copied source decision`,
    );
    assertEqual(
      repairItem.implementation_status,
      "planned_not_implemented",
      `${repairItem.id} implementation status`,
    );
    assertEqual(repairItem.accepted, false, `${repairItem.id} accepted`);
    assertEqual(repairItem.implemented, false, `${repairItem.id} implemented`);
    assertCondition(
      track.fr_ids.includes(repairItem.fr_id),
      `${repairItem.id} track FR membership`,
    );
    assertDeepEqual(
      repairItem.acceptance_blockers,
      sourceItem.remaining_acceptance_blockers,
      `${repairItem.id} acceptance blockers`,
    );
    assertCondition(
      repairItem.required_actions.length > 0,
      `${repairItem.id} required actions`,
    );
    assertCondition(
      repairItem.verification_commands.length > 0,
      `${repairItem.id} verification commands`,
    );
    assertCondition(
      repairItem.evidence_refs.length > 0,
      `${repairItem.id} evidence refs`,
    );
    assertCondition(
      repairItem.evidence_refs.some((ref) =>
        ref.includes(repairItem.source_post_capture_decision_id),
      ),
      `${repairItem.id} evidence ref points to source decision`,
    );
    trackItemCounts.set(
      repairItem.track_id,
      (trackItemCounts.get(repairItem.track_id) ?? 0) + 1,
    );
  }

  const acceptedItemCount = countBy(
    blockerRepairPlan.repair_items,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    blockerRepairPlan.repair_items,
    (item) => item.implemented === true,
  );
  const plannedItemCount = countBy(
    blockerRepairPlan.repair_items,
    (item) => item.implementation_status === "planned_not_implemented",
  );

  assertEqual(
    blockerRepairPlan.summary.repair_item_count,
    blockerRepairPlan.repair_items.length,
    "summary repair item count",
  );
  assertEqual(
    blockerRepairPlan.summary.stream_final_acceptance_items,
    trackItemCounts.get("TRACK-A4-STREAM-FINAL-ACCEPTANCE"),
    "summary stream final acceptance count",
  );
  assertEqual(
    blockerRepairPlan.summary.runtime_ux_final_acceptance_items,
    trackItemCounts.get("TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE"),
    "summary runtime UX final acceptance count",
  );
  assertEqual(
    blockerRepairPlan.summary.git_history_conformance_items,
    trackItemCounts.get("TRACK-A8-GIT-HISTORY-CONFORMANCE"),
    "summary git history conformance count",
  );
  assertEqual(
    blockerRepairPlan.summary.accepted_items,
    acceptedItemCount,
    "summary accepted item count",
  );
  assertEqual(
    blockerRepairPlan.summary.implemented_items,
    implementedItemCount,
    "summary implemented item count",
  );
  assertEqual(
    blockerRepairPlan.summary.planned_not_implemented_items,
    plannedItemCount,
    "summary planned item count",
  );
  assertEqual(
    blockerRepairPlan.summary.excluded_items,
    blockerRepairPlan.excluded_items.length,
    "summary excluded item count",
  );
  assertEqual(
    blockerRepairPlan.summary.source_needs_followup_items,
    postCaptureDecisionRecord.summary.needs_followup_items,
    "summary source needs-followup count",
  );
  assertEqual(
    blockerRepairPlan.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertEqual(
    blockerRepairPlan.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10 status",
  );
  assertDeepEqual(
    blockerRepairPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.215"],
    "next recommended slices",
  );

  return {
    status: blockerRepairPlan.plan_status,
    exitP1_1Status: blockerRepairPlan.exit_p1_1_status,
    exitP1_10Status: blockerRepairPlan.exit_p1_10_status,
    repairItemCount: blockerRepairPlan.repair_items.length,
    streamFinalAcceptanceItemCount:
      blockerRepairPlan.summary.stream_final_acceptance_items,
    runtimeUxFinalAcceptanceItemCount:
      blockerRepairPlan.summary.runtime_ux_final_acceptance_items,
    gitHistoryConformanceItemCount:
      blockerRepairPlan.summary.git_history_conformance_items,
    acceptedItemCount,
    implementedItemCount,
    plannedNotImplementedItemCount: plannedItemCount,
    excludedItemCount: blockerRepairPlan.excluded_items.length,
    frIds: blockerRepairPlan.repair_items.map((item) => item.fr_id),
    nextRecommendedSlices: blockerRepairPlan.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4PostCaptureBlockerRepairPlan();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4PostCaptureBlockerRepairPlan,
};
