const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const followUpPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-follow-up-plan.json",
);
const blockerDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-repair-decision-record.json",
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
  "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
  "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP",
  "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP",
];
const expectedFrIdsByTrack = {
  "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP": expectedStreamFrIds,
  "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP": expectedRuntimeUxFrIds,
  "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP": expectedGitHistoryFrIds,
};
const expectedTrackByReviewGroup = {
  stream_acceptance_repair: "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
  runtime_ux_repair: "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP",
  git_history_conformance_repair: "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP",
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
  "prompt_to_user",
  "user staged content",
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

function validateA4BlockerFollowUpPlan(options = {}) {
  const followUpPlan = readJson(options.followUpPlanPath ?? followUpPlanPath);
  const decisionRecord = readJson(
    options.blockerDecisionRecordPath ?? blockerDecisionRecordPath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(followUpPlan, "A4 blocker follow-up plan");
  assertEqual(followUpPlan.schema_version, "0.1.0", "schema version");
  assertEqual(followUpPlan.milestone, "M1.5", "milestone");
  assertEqual(followUpPlan.slice, "W1.5.219", "slice id");
  assertEqual(
    followUpPlan.plan_status,
    "a4_blocker_follow_up_plan_prepared_not_implemented",
    "plan status",
  );
  assertEqual(followUpPlan.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(followUpPlan.exit_p1_10_status, "not_ready", "EXIT-P1-10");

  assertEqual(decisionRecord.slice, "W1.5.218", "decision record slice");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_blocker_repair_reviewer_decisions_recorded_needs_followup",
    "decision record status",
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
    decisionRecord.blocker_repair_decision_items.length,
    "source needs-followup count",
  );
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.219",
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
  if (readinessLedger.slice === "W1.5.219") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.220"],
      "readiness ledger next recommended slices",
    );
  } else {
    const ledgerText = JSON.stringify(readinessLedger);
    assertCondition(
      ledgerText.includes("W1.5.219"),
      "future readiness ledger must retain W1.5.219 evidence",
    );
  }

  const sourceItemsById = new Map(
    decisionRecord.blocker_repair_decision_items.map((item) => [item.id, item]),
  );
  const tracksById = new Map(
    followUpPlan.follow_up_tracks.map((track) => [track.id, track]),
  );
  const trackItemCounts = new Map(expectedTracks.map((track) => [track, 0]));

  assertDeepEqual(
    sorted(followUpPlan.follow_up_tracks.map((track) => track.id)),
    sorted(expectedTracks),
    "follow-up track ids",
  );
  assertEqual(
    followUpPlan.follow_up_items.length,
    decisionRecord.blocker_repair_decision_items.length,
    "follow-up item count",
  );
  assertDeepEqual(
    sorted(
      followUpPlan.follow_up_items.map(
        (item) => item.source_blocker_repair_decision_id,
      ),
    ),
    sorted(decisionRecord.blocker_repair_decision_items.map((item) => item.id)),
    "source blocker repair decision ids",
  );
  assertDeepEqual(
    sorted(followUpPlan.follow_up_items.map((item) => item.fr_id)),
    sorted(expectedAllFrIds),
    "follow-up FR ids",
  );
  assertEqual(
    followUpPlan.follow_up_items.some((item) => item.fr_id === "FR-015"),
    false,
    "FR-015 follow-up absence",
  );
  assertEqual(
    followUpPlan.excluded_items.some((item) => item.fr_id === "FR-015"),
    true,
    "FR-015 excluded item",
  );

  for (const track of followUpPlan.follow_up_tracks) {
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

  for (const followUpItem of followUpPlan.follow_up_items) {
    const sourceItem = sourceItemsById.get(
      followUpItem.source_blocker_repair_decision_id,
    );
    const track = tracksById.get(followUpItem.track_id);

    assertCondition(Boolean(sourceItem), `${followUpItem.id} source item`);
    assertCondition(Boolean(track), `${followUpItem.id} track`);
    assertEqual(
      followUpItem.fr_id,
      sourceItem.fr_id,
      `${followUpItem.id} source FR id`,
    );
    assertEqual(
      sourceItem.decision,
      "needs_followup",
      `${followUpItem.id} source decision`,
    );
    assertEqual(
      sourceItem.accepted,
      false,
      `${followUpItem.id} source accepted`,
    );
    assertEqual(
      sourceItem.implemented,
      false,
      `${followUpItem.id} source implemented`,
    );
    assertEqual(
      followUpItem.source_decision,
      sourceItem.decision,
      `${followUpItem.id} copied source decision`,
    );
    assertEqual(
      followUpItem.source_repair_status,
      sourceItem.source_repair_status,
      `${followUpItem.id} copied source repair status`,
    );
    assertEqual(
      followUpItem.follow_up_status,
      "planned_not_implemented",
      `${followUpItem.id} follow-up status`,
    );
    assertEqual(followUpItem.accepted, false, `${followUpItem.id} accepted`);
    assertEqual(
      followUpItem.implemented,
      false,
      `${followUpItem.id} implemented`,
    );
    assertEqual(
      followUpItem.review_group,
      sourceItem.review_group,
      `${followUpItem.id} review group`,
    );
    assertEqual(
      followUpItem.decision_owner,
      sourceItem.decision_owner,
      `${followUpItem.id} decision owner`,
    );
    assertEqual(
      followUpItem.track_id,
      expectedTrackByReviewGroup[sourceItem.review_group],
      `${followUpItem.id} track by review group`,
    );
    assertCondition(
      track.fr_ids.includes(followUpItem.fr_id),
      `${followUpItem.id} track FR membership`,
    );
    assertDeepEqual(
      followUpItem.acceptance_blockers,
      sourceItem.remaining_acceptance_blockers,
      `${followUpItem.id} acceptance blockers`,
    );
    assertCondition(
      followUpItem.required_actions.length > 0,
      `${followUpItem.id} required actions`,
    );
    assertCondition(
      followUpItem.verification_commands.length > 0,
      `${followUpItem.id} verification commands`,
    );
    assertCondition(
      followUpItem.evidence_refs.length > 0,
      `${followUpItem.id} evidence refs`,
    );
    assertCondition(
      followUpItem.evidence_refs.some((ref) =>
        ref.includes(followUpItem.source_blocker_repair_decision_id),
      ),
      `${followUpItem.id} evidence ref points to source decision`,
    );
    assertCondition(
      followUpItem.evidence_refs.some((ref) =>
        sourceItem.evidence_refs.some((sourceRef) =>
          ref.includes(sourceRef.split("#")[1] ?? "__missing__"),
        ),
      ),
      `${followUpItem.id} evidence ref points to reviewed source evidence`,
    );
    trackItemCounts.set(
      followUpItem.track_id,
      (trackItemCounts.get(followUpItem.track_id) ?? 0) + 1,
    );
  }

  const acceptedItemCount = countBy(
    followUpPlan.follow_up_items,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    followUpPlan.follow_up_items,
    (item) => item.implemented === true,
  );
  const plannedItemCount = countBy(
    followUpPlan.follow_up_items,
    (item) => item.follow_up_status === "planned_not_implemented",
  );
  const sourceExecutedCount = countBy(
    decisionRecord.blocker_repair_decision_items,
    (item) => item.source_repair_status === "executed_not_accepted",
  );

  assertEqual(
    followUpPlan.summary.follow_up_item_count,
    followUpPlan.follow_up_items.length,
    "summary follow-up item count",
  );
  assertEqual(
    followUpPlan.summary.stream_acceptance_follow_up_items,
    trackItemCounts.get("TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP"),
    "summary stream count",
  );
  assertEqual(
    followUpPlan.summary.runtime_ux_acceptance_follow_up_items,
    trackItemCounts.get("TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP"),
    "summary runtime UX count",
  );
  assertEqual(
    followUpPlan.summary.git_history_conformance_follow_up_items,
    trackItemCounts.get("TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP"),
    "summary git history count",
  );
  assertEqual(
    followUpPlan.summary.accepted_items,
    acceptedItemCount,
    "summary accepted items",
  );
  assertEqual(
    followUpPlan.summary.implemented_items,
    implementedItemCount,
    "summary implemented items",
  );
  assertEqual(
    followUpPlan.summary.planned_not_implemented_items,
    plannedItemCount,
    "summary planned item count",
  );
  assertEqual(
    followUpPlan.summary.excluded_items,
    followUpPlan.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    followUpPlan.summary.source_needs_followup_items,
    decisionRecord.summary.needs_followup_items,
    "summary source needs-followup count",
  );
  assertEqual(
    followUpPlan.summary.source_executed_not_accepted_items,
    sourceExecutedCount,
    "summary source executed count",
  );
  assertEqual(
    followUpPlan.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    followUpPlan.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    followUpPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.220"],
    "next recommended slices",
  );

  return {
    status: followUpPlan.plan_status,
    exitP1_1Status: followUpPlan.exit_p1_1_status,
    exitP1_10Status: followUpPlan.exit_p1_10_status,
    followUpItemCount: followUpPlan.follow_up_items.length,
    streamAcceptanceFollowUpItemCount:
      followUpPlan.summary.stream_acceptance_follow_up_items,
    runtimeUxAcceptanceFollowUpItemCount:
      followUpPlan.summary.runtime_ux_acceptance_follow_up_items,
    gitHistoryConformanceFollowUpItemCount:
      followUpPlan.summary.git_history_conformance_follow_up_items,
    acceptedItemCount,
    implementedItemCount,
    plannedNotImplementedItemCount: plannedItemCount,
    excludedItemCount: followUpPlan.excluded_items.length,
    frIds: followUpPlan.follow_up_items.map((item) => item.fr_id),
    nextRecommendedSlices: followUpPlan.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4BlockerFollowUpPlan();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4BlockerFollowUpPlan,
};
