const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-packaged-follow-up-decision-record.json",
);
const streamPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-follow-up-package.json",
);
const runtimeUxPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-follow-up-package.json",
);
const gitHistoryPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-follow-up-package.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const allowedDecisions = ["accepted", "rejected", "needs_followup"];
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
const expectedDecisionOwners = {
  stream_acceptance_repair: "A4 ux-acceptance-reviewer",
  runtime_ux_repair: "A4 ux-acceptance-reviewer",
  git_history_conformance_repair: "A8 git-history-auditor",
};
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

function collectPackageItems(
  streamPackage,
  runtimeUxPackage,
  gitHistoryPackage,
) {
  return [
    ...streamPackage.package_items.map((item) => ({
      ...item,
      sourcePackageArtifact:
        "docs/04_runbook/m1.5-a4-stream-acceptance-follow-up-package.json",
      sourcePackageSlice: "W1.5.220",
    })),
    ...runtimeUxPackage.package_items.map((item) => ({
      ...item,
      sourcePackageArtifact:
        "docs/04_runbook/m1.5-a4-runtime-ux-acceptance-follow-up-package.json",
      sourcePackageSlice: "W1.5.221",
    })),
    ...gitHistoryPackage.package_items.map((item) => ({
      ...item,
      sourcePackageArtifact:
        "docs/04_runbook/m1.5-a8-git-history-conformance-follow-up-package.json",
      sourcePackageSlice: "W1.5.222",
    })),
  ];
}

function optionalEqual(actual, expected, key, message) {
  if (expected[key] !== undefined) {
    assertEqual(actual[key], expected[key], `${message} ${key}`);
  } else {
    assertEqual(actual[key], undefined, `${message} ${key}`);
  }
}

function validatePackageSourceStatus(sourcePackages) {
  assertEqual(
    sourcePackages.streamPackage.slice,
    "W1.5.220",
    "stream package slice",
  );
  assertEqual(
    sourcePackages.streamPackage.package_status,
    "a4_stream_acceptance_follow_up_package_packaged_not_accepted",
    "stream package status",
  );
  assertEqual(
    sourcePackages.runtimeUxPackage.slice,
    "W1.5.221",
    "runtime UX package slice",
  );
  assertEqual(
    sourcePackages.runtimeUxPackage.package_status,
    "a4_runtime_ux_acceptance_follow_up_package_packaged_not_accepted",
    "runtime UX package status",
  );
  assertEqual(
    sourcePackages.gitHistoryPackage.slice,
    "W1.5.222",
    "A8 package slice",
  );
  assertEqual(
    sourcePackages.gitHistoryPackage.package_status,
    "a8_git_history_conformance_follow_up_package_packaged_not_accepted",
    "A8 package status",
  );
}

function validateA8Context(record, gitHistoryPackage) {
  const context = record.a8_runtime_harness_8_2_decision_context;
  const packageItem = gitHistoryPackage.package_items[0];
  const sourceRows = gitHistoryPackage.runtime_harness_8_2_follow_up_matrix;
  const sourceRowsById = mapById(sourceRows);

  assertEqual(context.source_package_slice, "W1.5.222", "A8 context slice");
  assertEqual(
    context.source_package_item_id,
    packageItem.id,
    "A8 context source package item",
  );
  assertEqual(context.decision, "needs_followup", "A8 context decision");
  assertEqual(
    context.phase_exit_decision_status,
    "not_ready",
    "A8 phase exit decision status",
  );
  assertEqual(
    context.runtime_harness_8_2_trigger_count,
    gitHistoryPackage.summary.runtime_harness_8_2_trigger_count,
    "A8 trigger count",
  );
  assertEqual(
    context.evidence_carried_forward_trigger_count,
    gitHistoryPackage.summary.evidence_carried_forward_trigger_count,
    "A8 carried-forward count",
  );
  assertEqual(
    context.explicitly_deferred_trigger_count,
    gitHistoryPackage.summary.explicitly_deferred_trigger_count,
    "A8 deferred count",
  );
  assertEqual(
    context.phase_conformance_accepted_items,
    0,
    "A8 phase accepted rows",
  );
  assertDeepEqual(
    sorted(context.carried_forward_trigger_ids),
    expectedCarriedForwardTriggerIds,
    "A8 carried-forward trigger ids",
  );
  assertDeepEqual(
    sorted(context.deferred_trigger_ids),
    expectedDeferredTriggerIds,
    "A8 deferred trigger ids",
  );
  assertDeepEqual(
    context.trigger_rows.map((row) => row.id),
    sourceRows.map((row) => row.id),
    "A8 trigger row order",
  );
  for (const row of context.trigger_rows) {
    const sourceRow = sourceRowsById.get(row.id);
    assertCondition(Boolean(sourceRow), `${row.id} source trigger row`);
    assertEqual(row.trigger, sourceRow.trigger, `${row.id} trigger`);
    assertEqual(
      row.expected_commit_message,
      sourceRow.expected_commit_message,
      `${row.id} commit message`,
    );
    assertEqual(
      row.expected_tag ?? null,
      sourceRow.expected_tag ?? null,
      `${row.id} expected tag`,
    );
    assertEqual(
      row.source_evidence_status,
      sourceRow.source_evidence_status,
      `${row.id} source evidence status`,
    );
    assertEqual(
      row.conformance_disposition,
      sourceRow.conformance_disposition,
      `${row.id} disposition`,
    );
    assertEqual(row.accepted, false, `${row.id} accepted`);
    assertEqual(row.implemented, false, `${row.id} implemented`);
    assertEqual(row.decision, "needs_followup", `${row.id} decision`);
    assertEqual(
      row.decision_status,
      "reviewed_packaged_follow_up_needs_followup_not_accepted",
      `${row.id} decision status`,
    );
    if (
      row.conformance_disposition ===
      "evidence_carried_forward_not_phase_accepted"
    ) {
      assertDeepEqual(
        row.evidence_refs,
        sourceRow.evidence_refs,
        `${row.id} carried-forward evidence refs`,
      );
    } else {
      assertEqual(
        row.conformance_disposition,
        "explicitly_deferred_not_implemented",
        `${row.id} deferred disposition`,
      );
      assertCondition(
        typeof row.deferred_reason === "string" &&
          row.deferred_reason.includes("W1.5.222"),
        `${row.id} deferred reason`,
      );
    }
  }
}

function validateA4A8PackagedFollowUpDecisionRecord(options = {}) {
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const streamPackage = readJson(
    options.streamPackagePath ?? streamPackagePath,
  );
  const runtimeUxPackage = readJson(
    options.runtimeUxPackagePath ?? runtimeUxPackagePath,
  );
  const gitHistoryPackage = readJson(
    options.gitHistoryPackagePath ?? gitHistoryPackagePath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );

  assertSanitizedJson(
    decisionRecord,
    "A4/A8 packaged follow-up decision record",
  );
  assertEqual(decisionRecord.schema_version, "0.1.0", "schema version");
  assertEqual(decisionRecord.milestone, "M1.5", "milestone");
  assertEqual(decisionRecord.slice, "W1.5.223", "slice id");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_a8_packaged_follow_up_reviewer_decisions_recorded_needs_followup",
    "decision record status",
  );
  assertEqual(decisionRecord.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(decisionRecord.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertDeepEqual(
    decisionRecord.reviewer_contract.reviewers,
    ["A4 ux-acceptance-reviewer", "A8 git-history-auditor"],
    "reviewers",
  );
  assertDeepEqual(
    decisionRecord.reviewer_contract.allowed_decisions,
    allowedDecisions,
    "allowed decisions",
  );
  assertEqual(
    decisionRecord.reviewer_contract.accepted_item_count_must_remain_zero,
    true,
    "accepted item guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.implemented_item_count_must_remain_zero,
    true,
    "implemented item guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.runner_script,
    "apps/desktop/scripts/m1-5-a4-a8-packaged-follow-up-decision-record.cjs",
    "runner script",
  );
  assertEqual(
    decisionRecord.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-a8-packaged-follow-up-decision-record.cjs --check",
    "focused check",
  );
  assertEqual(
    decisionRecord.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-a8-packaged-follow-up-decision-record.test.cjs",
    "focused test",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-packaged-follow-up-decision-record.test.cjs",
    ),
    "desktop package gate wiring",
  );

  validatePackageSourceStatus({
    streamPackage,
    runtimeUxPackage,
    gitHistoryPackage,
  });
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.223",
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
  if (readinessLedger.slice === "W1.5.223") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.224"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.223"),
      "future readiness ledger must retain W1.5.223 evidence",
    );
  }

  const sourcePackageItems = collectPackageItems(
    streamPackage,
    runtimeUxPackage,
    gitHistoryPackage,
  );
  const sourcePackageItemsById = mapById(sourcePackageItems);
  const decisionItems = decisionRecord.packaged_follow_up_decision_items;

  assertEqual(decisionItems.length, expectedAllFrIds.length, "decision count");
  assertDeepEqual(
    sorted(sourcePackageItems.map((item) => item.fr_id)),
    sorted(expectedAllFrIds),
    "source package FR ids",
  );
  assertDeepEqual(
    sorted(decisionItems.map((item) => item.fr_id)),
    sorted(expectedAllFrIds),
    "decision FR ids",
  );
  assertCondition(
    !decisionItems.some((item) => item.fr_id === "FR-015"),
    "FR-015 must stay out of packaged follow-up decisions",
  );

  let streamDecisionCount = 0;
  let runtimeUxDecisionCount = 0;
  let gitHistoryDecisionCount = 0;
  for (const decisionItem of decisionItems) {
    const sourcePackageItem = sourcePackageItemsById.get(
      decisionItem.source_package_item_id,
    );
    assertCondition(
      Boolean(sourcePackageItem),
      `${decisionItem.id} source package item`,
    );
    assertCondition(
      allowedDecisions.includes(decisionItem.decision),
      `${decisionItem.id} unsupported decision`,
    );
    assertEqual(
      decisionItem.decision,
      "needs_followup",
      `${decisionItem.id} decision`,
    );
    assertEqual(
      decisionItem.decision_status,
      "reviewed_packaged_follow_up_needs_followup_not_accepted",
      `${decisionItem.id} decision status`,
    );
    assertEqual(decisionItem.accepted, false, `${decisionItem.id} accepted`);
    assertEqual(
      decisionItem.implemented,
      false,
      `${decisionItem.id} implemented`,
    );
    assertEqual(
      decisionItem.follow_up_required,
      true,
      `${decisionItem.id} follow-up required`,
    );
    assertEqual(
      decisionItem.evidence_reviewed,
      true,
      `${decisionItem.id} evidence reviewed`,
    );
    assertEqual(
      decisionItem.package_reviewed,
      true,
      `${decisionItem.id} package reviewed`,
    );
    assertEqual(
      decisionItem.fr_id,
      sourcePackageItem.fr_id,
      `${decisionItem.id} source package FR`,
    );
    assertEqual(
      decisionItem.review_group,
      sourcePackageItem.review_group,
      `${decisionItem.id} review group`,
    );
    assertEqual(
      decisionItem.decision_owner,
      expectedDecisionOwners[decisionItem.review_group],
      `${decisionItem.id} decision owner`,
    );
    assertEqual(
      decisionItem.decision_owner,
      sourcePackageItem.decision_owner,
      `${decisionItem.id} source decision owner`,
    );
    assertEqual(
      decisionItem.source_package_artifact,
      sourcePackageItem.sourcePackageArtifact,
      `${decisionItem.id} source package artifact`,
    );
    assertEqual(
      decisionItem.source_package_slice,
      sourcePackageItem.sourcePackageSlice,
      `${decisionItem.id} source package slice`,
    );
    assertEqual(
      decisionItem.source_package_status,
      sourcePackageItem.package_status,
      `${decisionItem.id} source package status`,
    );
    assertEqual(
      decisionItem.source_package_status,
      "packaged_not_accepted",
      `${decisionItem.id} packaged source status`,
    );
    for (const key of [
      "source_follow_up_item_id",
      "source_blocker_repair_decision_id",
      "source_repair_item_id",
      "source_follow_up_status",
      "source_decision",
      "source_repair_status",
    ]) {
      assertEqual(
        decisionItem[key],
        sourcePackageItem[key],
        `${decisionItem.id} ${key}`,
      );
    }
    optionalEqual(
      decisionItem,
      sourcePackageItem,
      "source_runtime_bridge_capture_item_id",
      decisionItem.id,
    );
    optionalEqual(
      decisionItem,
      sourcePackageItem,
      "source_capture_status",
      decisionItem.id,
    );
    optionalEqual(
      decisionItem,
      sourcePackageItem,
      "source_prerequisite_item_id",
      decisionItem.id,
    );
    optionalEqual(
      decisionItem,
      sourcePackageItem,
      "source_prerequisite_status",
      decisionItem.id,
    );
    assertDeepEqual(
      decisionItem.remaining_acceptance_blockers,
      sourcePackageItem.remaining_acceptance_blockers,
      `${decisionItem.id} remaining acceptance blockers`,
    );
    assertCondition(
      Array.isArray(decisionItem.remaining_acceptance_blockers) &&
        decisionItem.remaining_acceptance_blockers.length > 0,
      `${decisionItem.id} remaining blockers present`,
    );
    assertCondition(
      decisionItem.evidence_refs.some((ref) =>
        ref.includes(decisionItem.source_package_item_id),
      ),
      `${decisionItem.id} source package evidence ref`,
    );
    for (const sourceId of [
      decisionItem.source_follow_up_item_id,
      decisionItem.source_blocker_repair_decision_id,
      decisionItem.source_repair_item_id,
      decisionItem.source_runtime_bridge_capture_item_id,
      decisionItem.source_prerequisite_item_id,
    ].filter(Boolean)) {
      assertCondition(
        decisionItem.evidence_refs.some((ref) => ref.includes(sourceId)),
        `${decisionItem.id} evidence ref for ${sourceId}`,
      );
    }
    assertCondition(
      decisionItem.next_action_refs.length > 0,
      `${decisionItem.id} next action refs`,
    );

    if (decisionItem.review_group === "stream_acceptance_repair") {
      streamDecisionCount += 1;
    } else if (decisionItem.review_group === "runtime_ux_repair") {
      runtimeUxDecisionCount += 1;
    } else if (decisionItem.review_group === "git_history_conformance_repair") {
      gitHistoryDecisionCount += 1;
    } else {
      throw new Error(`${decisionItem.id} has unsupported review group`);
    }
  }

  validateA8Context(decisionRecord, gitHistoryPackage);

  const acceptedItemCount = countBy(
    decisionItems,
    (item) => item.accepted === true || item.decision === "accepted",
  );
  const rejectedItemCount = countBy(
    decisionItems,
    (item) => item.decision === "rejected",
  );
  const needsFollowupItemCount = countBy(
    decisionItems,
    (item) => item.decision === "needs_followup",
  );
  const implementedItemCount = countBy(
    decisionItems,
    (item) => item.implemented === true,
  );
  const packagedReviewedItemCount = countBy(
    decisionItems,
    (item) => item.package_reviewed === true,
  );
  const sourcePackagedNotAcceptedCount = countBy(
    sourcePackageItems,
    (item) => item.package_status === "packaged_not_accepted",
  );

  assertEqual(
    decisionRecord.summary.decision_item_count,
    decisionItems.length,
    "summary decision count",
  );
  assertEqual(
    decisionRecord.summary.stream_package_decision_items,
    streamDecisionCount,
    "summary stream count",
  );
  assertEqual(
    decisionRecord.summary.runtime_ux_package_decision_items,
    runtimeUxDecisionCount,
    "summary runtime UX count",
  );
  assertEqual(
    decisionRecord.summary.git_history_package_decision_items,
    gitHistoryDecisionCount,
    "summary Git-history count",
  );
  assertEqual(
    decisionRecord.summary.accepted_items,
    acceptedItemCount,
    "summary accepted count",
  );
  assertEqual(
    decisionRecord.summary.rejected_items,
    rejectedItemCount,
    "summary rejected count",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_items,
    needsFollowupItemCount,
    "summary needs-followup count",
  );
  assertEqual(
    decisionRecord.summary.implemented_items,
    implementedItemCount,
    "summary implemented count",
  );
  assertEqual(
    decisionRecord.summary.packaged_reviewed_items,
    packagedReviewedItemCount,
    "summary packaged reviewed count",
  );
  assertEqual(
    decisionRecord.summary.source_package_items,
    sourcePackageItems.length,
    "summary source package items",
  );
  assertEqual(
    decisionRecord.summary.source_stream_package_items,
    streamPackage.package_items.length,
    "summary source stream items",
  );
  assertEqual(
    decisionRecord.summary.source_runtime_ux_package_items,
    runtimeUxPackage.package_items.length,
    "summary source runtime UX items",
  );
  assertEqual(
    decisionRecord.summary.source_git_history_package_items,
    gitHistoryPackage.package_items.length,
    "summary source Git-history items",
  );
  assertEqual(
    decisionRecord.summary.source_packaged_not_accepted_items,
    sourcePackagedNotAcceptedCount,
    "summary source packaged-not-accepted count",
  );
  assertEqual(
    decisionRecord.summary.runtime_harness_8_2_trigger_count,
    gitHistoryPackage.runtime_harness_8_2_follow_up_matrix.length,
    "summary A8 trigger count",
  );
  assertEqual(
    decisionRecord.summary.evidence_carried_forward_trigger_count,
    expectedCarriedForwardTriggerIds.length,
    "summary carried-forward count",
  );
  assertEqual(
    decisionRecord.summary.explicitly_deferred_trigger_count,
    expectedDeferredTriggerIds.length,
    "summary deferred count",
  );
  assertEqual(
    decisionRecord.summary.phase_conformance_accepted_items,
    0,
    "summary phase accepted count",
  );
  assertEqual(
    decisionRecord.summary.excluded_items,
    decisionRecord.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    decisionRecord.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    decisionRecord.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    decisionRecord.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.224"],
    "next recommended slices",
  );

  return {
    status: decisionRecord.decision_record_status,
    exitP1_1Status: decisionRecord.exit_p1_1_status,
    exitP1_10Status: decisionRecord.exit_p1_10_status,
    decisionItemCount: decisionItems.length,
    streamPackageDecisionItemCount: streamDecisionCount,
    runtimeUxPackageDecisionItemCount: runtimeUxDecisionCount,
    gitHistoryPackageDecisionItemCount: gitHistoryDecisionCount,
    acceptedItemCount,
    rejectedItemCount,
    needsFollowupItemCount,
    implementedItemCount,
    packagedReviewedItemCount,
    sourcePackagedNotAcceptedItemCount: sourcePackagedNotAcceptedCount,
    runtimeHarness8_2TriggerCount:
      decisionRecord.summary.runtime_harness_8_2_trigger_count,
    evidenceCarriedForwardTriggerCount:
      decisionRecord.summary.evidence_carried_forward_trigger_count,
    explicitlyDeferredTriggerCount:
      decisionRecord.summary.explicitly_deferred_trigger_count,
    phaseConformanceAcceptedItemCount:
      decisionRecord.summary.phase_conformance_accepted_items,
    frIds: decisionItems.map((item) => item.fr_id),
    carriedForwardTriggerIds:
      decisionRecord.a8_runtime_harness_8_2_decision_context
        .carried_forward_trigger_ids,
    deferredTriggerIds:
      decisionRecord.a8_runtime_harness_8_2_decision_context
        .deferred_trigger_ids,
    excludedFrIds: decisionRecord.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: decisionRecord.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4A8PackagedFollowUpDecisionRecord();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4A8PackagedFollowUpDecisionRecord,
};
