const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const needsFollowupPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-package-needs-followup-plan.json",
);
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-blocker-package-decision-record.json",
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

const expectedTrackIds = [
  "TRACK-A4-STREAM-ROUTED-PACKAGE-FOLLOWUP",
  "TRACK-A4-RUNTIME-UX-ROUTED-PACKAGE-FOLLOWUP",
  "TRACK-A8-PHASE-CONFORMANCE-ROUTED-PACKAGE-FOLLOWUP",
];
const expectedDependencyGateIds = [
  "DEP-FORGE",
  "DEP-TAILWIND",
  "DEP-REACT-FLOW",
  "DEP-UPDATER",
];
const expectedTrackByReviewGroup = {
  stream_acceptance_repair: "TRACK-A4-STREAM-ROUTED-PACKAGE-FOLLOWUP",
  runtime_ux_repair: "TRACK-A4-RUNTIME-UX-ROUTED-PACKAGE-FOLLOWUP",
  git_history_conformance_repair:
    "TRACK-A8-PHASE-CONFORMANCE-ROUTED-PACKAGE-FOLLOWUP",
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

function packageFollowUpId(id) {
  return id.replace("ROUTED-PACKAGE-DECISION-", "ROUTED-PACKAGE-FOLLOW-UP-");
}

function blockerFollowUpId(id) {
  return id.replace("ROUTED-BLOCKER-DECISION-", "ROUTED-BLOCKER-FOLLOW-UP-");
}

function crossFollowUpId(id) {
  return id.replace("CROSS-ROUTE-DECISION-", "CROSS-ROUTE-FOLLOW-UP-");
}

function validateSourceDecisionRecord(decisionRecord) {
  assertEqual(decisionRecord.slice, "W1.5.226", "source decision slice");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_a8_routed_blocker_package_decisions_recorded_needs_followup_not_accepted",
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
    decisionRecord.summary.needs_followup_route_package_decisions,
    decisionRecord.route_package_decision_items.length,
    "source route package needs_followup count",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_routed_blocker_decisions,
    decisionRecord.routed_blocker_decision_items.length,
    "source routed blocker needs_followup count",
  );
}

function validateLedgerAndPackageWiring(
  needsFollowupPlan,
  readinessLedger,
  desktopPackage,
) {
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.227",
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
  if (readinessLedger.slice === "W1.5.227") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.228"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.227"),
      "future readiness ledger must retain W1.5.227 evidence",
    );
  }

  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-package-needs-followup-plan.test.cjs",
    ),
    "desktop package gate wiring",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-blocker-package-decision-record.test.cjs",
    ),
    "source decision package gate wiring",
  );
  assertEqual(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-package-needs-followup-plan.cjs",
    ),
    false,
    "desktop package must wire the test file, not the runner",
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
        `${gate.id} dependency ${packageName} must remain uninstalled`,
      );
    }
  }
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .dependency_gates_must_remain_uninstalled,
    true,
    "dependency gate contract",
  );
}

function validateFollowUpTracks(needsFollowupPlan) {
  const tracksById = mapById(needsFollowupPlan.follow_up_tracks);
  assertDeepEqual(
    sorted([...tracksById.keys()]),
    sorted(expectedTrackIds),
    "follow-up track ids",
  );
  for (const track of needsFollowupPlan.follow_up_tracks) {
    assertEqual(track.status, "planned_not_implemented", `${track.id} status`);
    assertEqual(
      track.source_route_package_decision_count,
      1,
      `${track.id} source route package count`,
    );
    assertEqual(
      track.route_package_follow_up_ids.length,
      1,
      `${track.id} route package follow-up ids`,
    );
    assertEqual(
      track.routed_blocker_follow_up_ids.length,
      track.fr_ids.length,
      `${track.id} blocker follow-up ids`,
    );
  }
}

function validateRoutePackageFollowUpItems(needsFollowupPlan, decisionRecord) {
  const sourceItemsById = mapById(decisionRecord.route_package_decision_items);
  const blockerItemsByDecisionId = new Map(
    needsFollowupPlan.routed_blocker_follow_up_items.map((item) => [
      item.source_routed_blocker_decision_id,
      item,
    ]),
  );

  assertEqual(
    needsFollowupPlan.route_package_follow_up_items.length,
    decisionRecord.route_package_decision_items.length,
    "route package follow-up item count",
  );
  assertDeepEqual(
    sorted(
      needsFollowupPlan.route_package_follow_up_items.map(
        (item) => item.source_route_package_decision_id,
      ),
    ),
    sorted(decisionRecord.route_package_decision_items.map((item) => item.id)),
    "source route package decision ids",
  );

  for (const item of needsFollowupPlan.route_package_follow_up_items) {
    const source = sourceItemsById.get(item.source_route_package_decision_id);
    assertCondition(source !== undefined, `${item.id} source decision exists`);
    assertEqual(item.id, packageFollowUpId(source.id), `${item.id} id`);
    assertEqual(
      item.source_decision,
      "needs_followup",
      `${item.id} source decision`,
    );
    assertEqual(
      item.source_decision_status,
      source.decision_status,
      `${item.id} source decision status`,
    );
    assertEqual(
      item.follow_up_status,
      "planned_not_implemented",
      `${item.id} follow-up status`,
    );
    assertEqual(item.accepted, false, `${item.id} accepted`);
    assertEqual(item.implemented, false, `${item.id} implemented`);
    assertEqual(item.follow_up_required, true, `${item.id} follow-up required`);
    assertEqual(item.source_accepted, false, `${item.id} source accepted`);
    assertEqual(
      item.source_implemented,
      false,
      `${item.id} source implemented`,
    );
    assertEqual(
      item.track_id,
      expectedTrackByReviewGroup[source.route_group],
      `${item.id} track id`,
    );
    assertDeepEqual(
      sorted(item.fr_ids),
      sorted(source.fr_ids),
      `${item.id} FR ids`,
    );
    assertDeepEqual(
      sorted(item.routed_blocker_decision_ids),
      sorted(
        decisionRecord.routed_blocker_decision_items
          .filter((blocker) => blocker.route_package_decision_id === source.id)
          .map((blocker) => blocker.id),
      ),
      `${item.id} routed blocker decision ids`,
    );
    for (const blockerDecisionId of item.routed_blocker_decision_ids) {
      assertCondition(
        blockerItemsByDecisionId.has(blockerDecisionId),
        `${item.id} routed blocker follow-up ${blockerDecisionId}`,
      );
    }
    assertCondition(
      item.remaining_package_blockers.length > 0,
      `${item.id} package blockers`,
    );
    assertCondition(item.required_actions.length > 0, `${item.id} actions`);
    assertCondition(
      item.evidence_refs.includes(
        `docs/04_runbook/m1.5-a4-a8-routed-blocker-package-decision-record.json#${source.id}`,
      ),
      `${item.id} source evidence ref`,
    );
  }
}

function validateRoutedBlockerFollowUpItems(needsFollowupPlan, decisionRecord) {
  const sourceItemsById = mapById(decisionRecord.routed_blocker_decision_items);
  const packageItemsById = mapById(
    needsFollowupPlan.route_package_follow_up_items,
  );

  assertEqual(
    needsFollowupPlan.routed_blocker_follow_up_items.length,
    decisionRecord.routed_blocker_decision_items.length,
    "routed blocker follow-up item count",
  );
  assertDeepEqual(
    sorted(
      needsFollowupPlan.routed_blocker_follow_up_items.map(
        (item) => item.source_routed_blocker_decision_id,
      ),
    ),
    sorted(decisionRecord.routed_blocker_decision_items.map((item) => item.id)),
    "source routed blocker decision ids",
  );
  assertEqual(
    needsFollowupPlan.routed_blocker_follow_up_items.some(
      (item) => item.fr_id === "FR-015",
    ),
    false,
    "FR-015 routed blocker absence",
  );
  assertEqual(
    needsFollowupPlan.excluded_items.some((item) => item.fr_id === "FR-015"),
    true,
    "FR-015 excluded item",
  );

  for (const item of needsFollowupPlan.routed_blocker_follow_up_items) {
    const source = sourceItemsById.get(item.source_routed_blocker_decision_id);
    assertCondition(source !== undefined, `${item.id} source decision exists`);
    assertEqual(item.id, blockerFollowUpId(source.id), `${item.id} id`);
    assertEqual(item.fr_id, source.fr_id, `${item.id} FR id`);
    assertEqual(
      item.source_decision,
      "needs_followup",
      `${item.id} source decision`,
    );
    assertEqual(
      item.source_decision_status,
      source.decision_status,
      `${item.id} source decision status`,
    );
    assertEqual(
      item.follow_up_status,
      "planned_not_implemented",
      `${item.id} follow-up status`,
    );
    assertEqual(item.accepted, false, `${item.id} accepted`);
    assertEqual(item.implemented, false, `${item.id} implemented`);
    assertEqual(item.follow_up_required, true, `${item.id} follow-up required`);
    assertEqual(item.source_accepted, false, `${item.id} source accepted`);
    assertEqual(
      item.source_implemented,
      false,
      `${item.id} source implemented`,
    );
    assertEqual(
      item.track_id,
      expectedTrackByReviewGroup[source.review_group],
      `${item.id} track id`,
    );
    assertEqual(
      item.route_package_follow_up_id,
      packageFollowUpId(source.route_package_decision_id),
      `${item.id} route package follow-up id`,
    );
    assertCondition(
      packageItemsById.has(item.route_package_follow_up_id),
      `${item.id} route package follow-up exists`,
    );
    assertCondition(
      item.acceptance_blockers.length > 0,
      `${item.id} acceptance blockers`,
    );
    assertCondition(item.required_actions.length > 0, `${item.id} actions`);
    assertCondition(
      item.evidence_refs.includes(
        `docs/04_runbook/m1.5-a4-a8-routed-blocker-package-decision-record.json#${source.id}`,
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
  const followUpsBySourceId = new Map(
    needsFollowupPlan.cross_cutting_follow_up_items.map((item) => [
      item.source_cross_cutting_decision_id,
      item,
    ]),
  );
  assertEqual(
    needsFollowupPlan.cross_cutting_follow_up_items.length,
    decisionRecord.cross_cutting_decision_items.length,
    "cross-cutting follow-up count",
  );
  for (const source of decisionRecord.cross_cutting_decision_items) {
    const followUp = followUpsBySourceId.get(source.id);
    assertCondition(followUp !== undefined, `${source.id} cross follow-up`);
    assertEqual(followUp.id, crossFollowUpId(source.id), `${source.id} id`);
    assertEqual(followUp.accepted, false, `${source.id} accepted`);
    assertEqual(followUp.implemented, false, `${source.id} implemented`);
    assertEqual(
      followUp.follow_up_required,
      true,
      `${source.id} follow-up required`,
    );
    assertEqual(
      followUp.source_decision,
      source.decision,
      `${source.id} source decision`,
    );
    assertEqual(
      followUp.follow_up_status,
      source.decision === "deferred"
        ? "deferred_not_implemented"
        : "blocked_not_implemented",
      `${source.id} follow-up status`,
    );
    assertCondition(
      followUp.evidence_refs.includes(
        `docs/04_runbook/m1.5-a4-a8-routed-blocker-package-decision-record.json#${source.id}`,
      ),
      `${source.id} evidence ref`,
    );
  }

  const fr015 = needsFollowupPlan.cross_cutting_follow_up_items.find(
    (item) => item.fr_id === "FR-015",
  );
  assertCondition(fr015 !== undefined, "FR-015 cross-cutting follow-up");
  assertEqual(fr015.current_adr_status, "Proposed", "FR-015 ADR status");
  assertCondition(
    /^# ADR-0012:/u.test(adr0012Text) &&
      /\|\s*Status\s*\|\s*Proposed\s*\|/u.test(adr0012Text),
    "ADR-0012 must remain Proposed",
  );
  assertCondition(
    fr015.required_actions.some((action) => action.includes("ADR-0012")),
    "FR-015 required action must reference ADR-0012",
  );
}

function validateA8FollowUpPlan(needsFollowupPlan, decisionRecord) {
  const actual = needsFollowupPlan.a8_phase_conformance_follow_up_plan;
  const source = decisionRecord.a8_phase_conformance_decision_context;
  assertEqual(actual.plan_status, "planned_not_implemented", "A8 plan status");
  assertEqual(actual.source_decision, "needs_followup", "A8 source decision");
  assertEqual(
    actual.source_decision_status,
    source.decision_status,
    "A8 source decision status",
  );
  for (const key of [
    "runtime_harness_8_2_trigger_count",
    "evidence_carried_forward_trigger_count",
    "explicitly_deferred_trigger_count",
    "phase_conformance_accepted_items",
  ]) {
    assertEqual(actual[key], source[key], `A8 ${key}`);
  }
  assertDeepEqual(
    sorted(actual.carried_forward_trigger_ids),
    sorted(expectedCarriedForwardTriggerIds),
    "A8 carried-forward triggers",
  );
  assertDeepEqual(
    sorted(actual.deferred_trigger_ids),
    sorted(expectedDeferredTriggerIds),
    "A8 deferred triggers",
  );
  assertDeepEqual(
    actual.trigger_rows.map((row) => row.trigger_id),
    source.trigger_rows.map((row) => row.trigger_id),
    "A8 trigger row order",
  );
  assertEqual(
    actual.trigger_rows.filter(
      (row) => row.follow_up_status === "planned_not_implemented",
    ).length,
    source.trigger_rows.length,
    "A8 planned trigger rows",
  );
}

function validateSummary(needsFollowupPlan, decisionRecord) {
  const packageItems = needsFollowupPlan.route_package_follow_up_items;
  const blockerItems = needsFollowupPlan.routed_blocker_follow_up_items;
  const crossItems = needsFollowupPlan.cross_cutting_follow_up_items;
  const summary = needsFollowupPlan.summary;

  assertEqual(
    summary.route_package_follow_up_item_count,
    packageItems.length,
    "summary package follow-up count",
  );
  assertEqual(
    summary.routed_blocker_follow_up_item_count,
    blockerItems.length,
    "summary blocker follow-up count",
  );
  assertEqual(
    summary.total_follow_up_item_count,
    packageItems.length + blockerItems.length,
    "summary total follow-up count",
  );
  assertEqual(summary.accepted_items, 0, "summary accepted");
  assertEqual(summary.implemented_items, 0, "summary implemented");
  assertEqual(
    summary.planned_not_implemented_items,
    packageItems.length + blockerItems.length,
    "summary planned count",
  );
  assertEqual(
    summary.source_route_package_decisions,
    decisionRecord.route_package_decision_items.length,
    "summary source package decisions",
  );
  assertEqual(
    summary.source_routed_blocker_decisions,
    decisionRecord.routed_blocker_decision_items.length,
    "summary source blocker decisions",
  );
  assertEqual(
    summary.source_needs_followup_route_package_decisions,
    decisionRecord.summary.needs_followup_route_package_decisions,
    "summary source package needs_followup",
  );
  assertEqual(
    summary.source_needs_followup_routed_blocker_decisions,
    decisionRecord.summary.needs_followup_routed_blocker_decisions,
    "summary source blocker needs_followup",
  );
  assertEqual(
    summary.stream_package_follow_up_items,
    countBy(
      packageItems,
      (item) => item.route_group === "stream_acceptance_repair",
    ),
    "summary stream package follow-up",
  );
  assertEqual(
    summary.runtime_ux_package_follow_up_items,
    countBy(packageItems, (item) => item.route_group === "runtime_ux_repair"),
    "summary runtime UX package follow-up",
  );
  assertEqual(
    summary.git_history_package_follow_up_items,
    countBy(
      packageItems,
      (item) => item.route_group === "git_history_conformance_repair",
    ),
    "summary Git-history package follow-up",
  );
  assertEqual(
    summary.stream_routed_blocker_follow_up_items,
    countBy(
      blockerItems,
      (item) => item.review_group === "stream_acceptance_repair",
    ),
    "summary stream blocker follow-up",
  );
  assertEqual(
    summary.runtime_ux_routed_blocker_follow_up_items,
    countBy(blockerItems, (item) => item.review_group === "runtime_ux_repair"),
    "summary runtime UX blocker follow-up",
  );
  assertEqual(
    summary.git_history_routed_blocker_follow_up_items,
    countBy(
      blockerItems,
      (item) => item.review_group === "git_history_conformance_repair",
    ),
    "summary Git-history blocker follow-up",
  );
  assertEqual(
    summary.cross_cutting_follow_up_item_count,
    crossItems.length,
    "summary cross follow-up count",
  );
  assertEqual(
    summary.blocked_cross_cutting_follow_up_items,
    countBy(
      crossItems,
      (item) => item.follow_up_status === "blocked_not_implemented",
    ),
    "summary blocked cross follow-up",
  );
  assertEqual(
    summary.deferred_cross_cutting_follow_up_items,
    countBy(
      crossItems,
      (item) => item.follow_up_status === "deferred_not_implemented",
    ),
    "summary deferred cross follow-up",
  );
  assertEqual(summary.exit_p1_1_status, "not_ready", "summary EXIT-P1-1");
  assertEqual(summary.exit_p1_10_status, "not_ready", "summary EXIT-P1-10");
  assertDeepEqual(
    needsFollowupPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.228"],
    "next recommended slices",
  );
}

function validateA4A8RoutedPackageNeedsFollowupPlan(options = {}) {
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

  assertSanitizedJson(
    needsFollowupPlan,
    "A4/A8 routed package needs-followup plan",
  );
  assertEqual(needsFollowupPlan.schema_version, "0.1.0", "schema version");
  assertEqual(needsFollowupPlan.milestone, "M1.5", "milestone");
  assertEqual(needsFollowupPlan.slice, "W1.5.227", "slice id");
  assertEqual(
    needsFollowupPlan.plan_status,
    "a4_a8_routed_package_needs_followup_plan_prepared_not_implemented",
    "plan status",
  );
  assertEqual(needsFollowupPlan.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(needsFollowupPlan.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertDeepEqual(
    needsFollowupPlan.follow_up_plan_contract.reviewers,
    ["A4 ux-acceptance-reviewer", "A8 git-history-auditor"],
    "reviewers",
  );
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .accepted_item_count_must_remain_zero,
    true,
    "accepted guard",
  );
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .implemented_item_count_must_remain_zero,
    true,
    "implemented guard",
  );
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );
  assertEqual(
    needsFollowupPlan.follow_up_plan_contract
      .fr015_restore_continue_must_remain_unimplemented,
    true,
    "FR-015 guard",
  );

  validateSourceDecisionRecord(decisionRecord);
  validateLedgerAndPackageWiring(
    needsFollowupPlan,
    readinessLedger,
    desktopPackage,
  );
  validateFollowUpTracks(needsFollowupPlan);
  validateRoutePackageFollowUpItems(needsFollowupPlan, decisionRecord);
  validateRoutedBlockerFollowUpItems(needsFollowupPlan, decisionRecord);
  validateCrossCuttingFollowUps(needsFollowupPlan, decisionRecord, adr0012Text);
  validateA8FollowUpPlan(needsFollowupPlan, decisionRecord);
  validateSummary(needsFollowupPlan, decisionRecord);

  return {
    status: needsFollowupPlan.plan_status,
    exitP1_1Status: needsFollowupPlan.exit_p1_1_status,
    exitP1_10Status: needsFollowupPlan.exit_p1_10_status,
    routePackageFollowUpItemCount:
      needsFollowupPlan.summary.route_package_follow_up_item_count,
    routedBlockerFollowUpItemCount:
      needsFollowupPlan.summary.routed_blocker_follow_up_item_count,
    totalFollowUpItemCount:
      needsFollowupPlan.summary.total_follow_up_item_count,
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
    sourceRoutePackageDecisionIds:
      needsFollowupPlan.route_package_follow_up_items.map(
        (item) => item.source_route_package_decision_id,
      ),
    sourceRoutedBlockerDecisionIds:
      needsFollowupPlan.routed_blocker_follow_up_items.map(
        (item) => item.source_routed_blocker_decision_id,
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
  const summary = validateA4A8RoutedPackageNeedsFollowupPlan();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4A8RoutedPackageNeedsFollowupPlan,
};
