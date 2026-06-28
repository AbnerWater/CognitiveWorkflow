const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const streamFollowUpPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-follow-up-package.json",
);
const blockerFollowUpPlanPath = path.join(
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
const streamRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-blocker-repair.json",
);
const streamCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-phase-capture-execution.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const excludedTrackIds = [
  "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP",
  "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP",
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

function validateA4StreamAcceptanceFollowUpPackage(options = {}) {
  const followUpPackage = readJson(
    options.streamFollowUpPackagePath ?? streamFollowUpPackagePath,
  );
  const followUpPlan = readJson(
    options.blockerFollowUpPlanPath ?? blockerFollowUpPlanPath,
  );
  const decisionRecord = readJson(
    options.blockerDecisionRecordPath ?? blockerDecisionRecordPath,
  );
  const streamRepair = readJson(options.streamRepairPath ?? streamRepairPath);
  const streamCapture = readJson(
    options.streamCapturePath ?? streamCapturePath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );

  assertSanitizedJson(
    followUpPackage,
    "A4 stream acceptance follow-up package",
  );
  assertEqual(followUpPackage.schema_version, "0.1.0", "schema version");
  assertEqual(followUpPackage.milestone, "M1.5", "milestone");
  assertEqual(followUpPackage.slice, "W1.5.220", "slice id");
  assertEqual(
    followUpPackage.package_status,
    "a4_stream_acceptance_follow_up_package_packaged_not_accepted",
    "package status",
  );
  assertEqual(followUpPackage.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(followUpPackage.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertEqual(
    followUpPackage.runner_contract.runner_script,
    "apps/desktop/scripts/m1-5-a4-stream-acceptance-follow-up-package.cjs",
    "runner script",
  );
  assertEqual(
    followUpPackage.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-stream-acceptance-follow-up-package.cjs --check",
    "focused check command",
  );
  assertEqual(
    followUpPackage.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-stream-acceptance-follow-up-package.test.cjs",
    "focused test command",
  );
  assertEqual(
    followUpPackage.runner_contract.standard_desktop_test,
    "pnpm --filter @cw/desktop run test",
    "standard desktop test command",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-stream-acceptance-follow-up-package.test.cjs",
    ),
    "desktop package gate wiring",
  );

  assertEqual(followUpPlan.slice, "W1.5.219", "follow-up plan slice");
  assertEqual(
    followUpPlan.plan_status,
    "a4_blocker_follow_up_plan_prepared_not_implemented",
    "follow-up plan status",
  );
  assertEqual(decisionRecord.slice, "W1.5.218", "decision record slice");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_blocker_repair_reviewer_decisions_recorded_needs_followup",
    "decision record status",
  );
  assertEqual(streamRepair.slice, "W1.5.215", "stream repair slice");
  assertEqual(
    streamRepair.repair_status,
    "a4_stream_acceptance_blocker_repair_executed_not_accepted",
    "stream repair status",
  );
  assertEqual(streamCapture.slice, "W1.5.210", "stream capture slice");
  assertEqual(
    streamCapture.capture_status,
    "a4_stream_phase_capture_executed_not_accepted",
    "stream capture status",
  );
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.220",
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
  if (readinessLedger.slice === "W1.5.220") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.221"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.220"),
      "future readiness ledger must retain W1.5.220 evidence",
    );
  }

  const sourceTrack = followUpPlan.follow_up_tracks.find(
    (track) => track.id === "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
  );
  assertCondition(Boolean(sourceTrack), "source stream follow-up track");
  assertDeepEqual(
    sorted(sourceTrack.fr_ids),
    sorted(expectedStreamFrIds),
    "source track FR ids",
  );
  assertEqual(sourceTrack.entry_slice, "W1.5.220", "source track entry slice");
  assertEqual(
    sourceTrack.status,
    "planned_not_implemented",
    "source track status",
  );
  assertEqual(
    followUpPackage.track_execution.source_track_id,
    sourceTrack.id,
    "track execution source track",
  );
  assertEqual(
    followUpPackage.track_execution.source_track_status,
    sourceTrack.status,
    "track execution source status",
  );
  assertEqual(
    followUpPackage.track_execution.execution_status,
    "packaged_not_accepted",
    "track execution status",
  );
  assertDeepEqual(
    sorted(followUpPackage.track_execution.fr_ids),
    sorted(expectedStreamFrIds),
    "track execution FR ids",
  );
  assertEqual(
    followUpPackage.track_execution.acceptance_decision_status,
    "pending_reviewer_decision",
    "track acceptance decision status",
  );

  assertEqual(
    followUpPackage.stream_follow_up_package.source_follow_up_slice,
    "W1.5.219",
    "stream package source follow-up slice",
  );
  assertEqual(
    followUpPackage.stream_follow_up_package.source_repair_slice,
    "W1.5.215",
    "stream package source repair slice",
  );
  assertEqual(
    followUpPackage.stream_follow_up_package.source_decision_slice,
    "W1.5.218",
    "stream package source decision slice",
  );
  assertEqual(
    followUpPackage.stream_follow_up_package.source_capture_slice,
    "W1.5.210",
    "stream package source capture slice",
  );
  assertEqual(
    followUpPackage.stream_follow_up_package.acceptance_decision_recorded,
    false,
    "acceptance decision recorded flag",
  );
  assertEqual(
    followUpPackage.stream_follow_up_package.raw_output_dir_recorded,
    false,
    "raw output dir flag",
  );
  assertEqual(
    followUpPackage.stream_follow_up_package.query_hash_recorded,
    false,
    "query/hash flag",
  );
  assertEqual(
    followUpPackage.stream_follow_up_package.raw_stream_payload_recorded,
    false,
    "raw stream payload flag",
  );

  const sourceFollowUpItems = followUpPlan.follow_up_items.filter(
    (item) => item.track_id === "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
  );
  const sourceFollowUpItemsById = new Map(
    sourceFollowUpItems.map((item) => [item.id, item]),
  );
  const decisionItemsById = new Map(
    decisionRecord.blocker_repair_decision_items.map((item) => [item.id, item]),
  );
  const streamRepairItemsById = new Map(
    streamRepair.repair_items.map((item) => [item.id, item]),
  );
  const streamCaptureItemsById = new Map(
    streamCapture.phase_capture_items.map((item) => [item.id, item]),
  );

  assertEqual(
    followUpPackage.package_items.length,
    expectedStreamFrIds.length,
    "package item count",
  );
  assertDeepEqual(
    sorted(followUpPackage.package_items.map((item) => item.fr_id)),
    sorted(expectedStreamFrIds),
    "package FR ids",
  );
  assertDeepEqual(
    sorted(
      followUpPackage.package_items.map(
        (item) => item.source_follow_up_item_id,
      ),
    ),
    sorted(sourceFollowUpItems.map((item) => item.id)),
    "source follow-up item ids",
  );
  assertEqual(
    followUpPackage.package_items.some((item) => item.fr_id === "FR-015"),
    false,
    "FR-015 stream package absence",
  );

  for (const packageItem of followUpPackage.package_items) {
    const sourceFollowUpItem = sourceFollowUpItemsById.get(
      packageItem.source_follow_up_item_id,
    );
    const decisionItem = decisionItemsById.get(
      packageItem.source_blocker_repair_decision_id,
    );
    const streamRepairItem = streamRepairItemsById.get(
      packageItem.source_repair_item_id,
    );
    const streamCaptureItem = streamCaptureItemsById.get(
      streamRepairItem?.source_phase_capture_item_id,
    );

    assertCondition(
      Boolean(sourceFollowUpItem),
      `${packageItem.id} source follow-up`,
    );
    assertCondition(Boolean(decisionItem), `${packageItem.id} source decision`);
    assertCondition(
      Boolean(streamRepairItem),
      `${packageItem.id} source repair`,
    );
    assertCondition(
      Boolean(streamCaptureItem),
      `${packageItem.id} stream phase capture source`,
    );
    assertEqual(
      packageItem.fr_id,
      sourceFollowUpItem.fr_id,
      `${packageItem.id} source follow-up FR`,
    );
    assertEqual(
      packageItem.fr_id,
      decisionItem.fr_id,
      `${packageItem.id} source decision FR`,
    );
    assertEqual(
      packageItem.fr_id,
      streamRepairItem.fr_id,
      `${packageItem.id} source repair FR`,
    );
    assertEqual(
      packageItem.fr_id,
      streamCaptureItem.fr_id,
      `${packageItem.id} stream capture FR`,
    );
    assertEqual(
      packageItem.review_group,
      "stream_acceptance_repair",
      `${packageItem.id} review group`,
    );
    assertEqual(
      packageItem.review_group,
      sourceFollowUpItem.review_group,
      `${packageItem.id} copied review group`,
    );
    assertEqual(
      packageItem.decision_owner,
      sourceFollowUpItem.decision_owner,
      `${packageItem.id} copied decision owner`,
    );
    assertEqual(
      packageItem.package_status,
      "packaged_not_accepted",
      `${packageItem.id} package status`,
    );
    assertEqual(
      packageItem.source_follow_up_status,
      sourceFollowUpItem.follow_up_status,
      `${packageItem.id} source follow-up status`,
    );
    assertEqual(
      packageItem.source_follow_up_status,
      "planned_not_implemented",
      `${packageItem.id} planned source follow-up status`,
    );
    assertEqual(
      packageItem.source_decision,
      decisionItem.decision,
      `${packageItem.id} source decision`,
    );
    assertEqual(
      packageItem.source_decision,
      "needs_followup",
      `${packageItem.id} needs-followup source decision`,
    );
    assertEqual(
      packageItem.source_repair_status,
      streamRepairItem.repair_status,
      `${packageItem.id} source repair status`,
    );
    assertEqual(
      packageItem.source_repair_status,
      "executed_not_accepted",
      `${packageItem.id} executed source repair status`,
    );
    assertEqual(
      streamCaptureItem.phase_capture_status,
      "executed_not_accepted",
      `${packageItem.id} stream capture status`,
    );
    assertEqual(packageItem.accepted, false, `${packageItem.id} accepted`);
    assertEqual(
      packageItem.implemented,
      false,
      `${packageItem.id} implemented`,
    );
    assertEqual(
      packageItem.reviewer_decision_required,
      true,
      `${packageItem.id} reviewer decision required`,
    );
    assertEqual(
      packageItem.acceptance_decision_status,
      "pending_reviewer_decision",
      `${packageItem.id} decision status`,
    );
    assertDeepEqual(
      packageItem.remaining_acceptance_blockers,
      sourceFollowUpItem.acceptance_blockers,
      `${packageItem.id} remaining acceptance blockers`,
    );
    assertCondition(
      packageItem.package_actions_executed.length > 0,
      `${packageItem.id} package actions`,
    );
    assertCondition(
      packageItem.evidence_refs.some((ref) =>
        ref.includes(packageItem.source_follow_up_item_id),
      ),
      `${packageItem.id} source follow-up evidence ref`,
    );
    assertCondition(
      packageItem.evidence_refs.some((ref) =>
        ref.includes(packageItem.source_blocker_repair_decision_id),
      ),
      `${packageItem.id} source decision evidence ref`,
    );
    assertCondition(
      packageItem.evidence_refs.some((ref) =>
        ref.includes(packageItem.source_repair_item_id),
      ),
      `${packageItem.id} source repair evidence ref`,
    );
    assertCondition(
      streamRepairItem.evidence_refs.some((ref) =>
        ref.includes(streamRepairItem.source_phase_capture_item_id),
      ),
      `${packageItem.id} source repair evidence links stream capture`,
    );
    assertCondition(
      packageItem.next_action_refs.length > 0,
      `${packageItem.id} next action refs`,
    );
  }

  const acceptedItemCount = countBy(
    followUpPackage.package_items,
    (item) => item.accepted === true,
  );
  const implementedItemCount = countBy(
    followUpPackage.package_items,
    (item) => item.implemented === true,
  );
  const packagedItemCount = countBy(
    followUpPackage.package_items,
    (item) => item.package_status === "packaged_not_accepted",
  );
  const pendingDecisionItemCount = countBy(
    followUpPackage.package_items,
    (item) => item.acceptance_decision_status === "pending_reviewer_decision",
  );

  assertEqual(
    followUpPackage.summary.package_item_count,
    followUpPackage.package_items.length,
    "summary package item count",
  );
  assertEqual(
    followUpPackage.summary.stream_acceptance_package_items,
    followUpPackage.package_items.length,
    "summary stream package count",
  );
  assertEqual(
    followUpPackage.summary.runtime_ux_package_items,
    0,
    "summary runtime UX package count",
  );
  assertEqual(
    followUpPackage.summary.git_history_package_items,
    0,
    "summary Git-history package count",
  );
  assertEqual(
    followUpPackage.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    followUpPackage.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    followUpPackage.summary.packaged_not_accepted_items,
    packagedItemCount,
    "summary packaged count",
  );
  assertEqual(
    followUpPackage.summary.pending_a4_decision_items,
    pendingDecisionItemCount,
    "summary pending decision count",
  );
  assertEqual(
    followUpPackage.summary.source_follow_up_items,
    sourceFollowUpItems.length,
    "summary source follow-up count",
  );
  assertEqual(
    followUpPackage.summary.source_decision_items,
    followUpPackage.package_items.length,
    "summary source decision count",
  );
  assertEqual(
    followUpPackage.summary.source_stream_repair_items,
    streamRepair.repair_items.length,
    "summary source stream repair count",
  );
  assertEqual(
    followUpPackage.summary.excluded_items,
    followUpPackage.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    followUpPackage.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    followUpPackage.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    sorted(
      followUpPackage.excluded_items
        .filter((item) => item.track_id !== undefined)
        .map((item) => item.track_id),
    ),
    sorted(excludedTrackIds),
    "excluded track ids",
  );
  assertDeepEqual(
    followUpPackage.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    ["FR-015"],
    "excluded FR ids",
  );
  assertDeepEqual(
    followUpPackage.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.221"],
    "next recommended slices",
  );

  return {
    status: followUpPackage.package_status,
    exitP1_1Status: followUpPackage.exit_p1_1_status,
    exitP1_10Status: followUpPackage.exit_p1_10_status,
    packageItemCount: followUpPackage.package_items.length,
    streamAcceptancePackageItemCount:
      followUpPackage.summary.stream_acceptance_package_items,
    acceptedItemCount,
    implementedItemCount,
    packagedNotAcceptedItemCount: packagedItemCount,
    pendingA4DecisionItemCount: pendingDecisionItemCount,
    frIds: followUpPackage.package_items.map((item) => item.fr_id),
    excludedTrackIds: followUpPackage.excluded_items
      .filter((item) => item.track_id !== undefined)
      .map((item) => item.track_id),
    excludedFrIds: followUpPackage.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: followUpPackage.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4StreamAcceptanceFollowUpPackage();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4StreamAcceptanceFollowUpPackage,
};
