const fs = require("node:fs");
const path = require("node:path");
const {
  validateA4A8RoutedPackageNeedsFollowupPlan,
} = require("./m1-5-a4-a8-routed-package-needs-followup-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const handoffPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-package-follow-up-handoff.json",
);
const needsFollowupPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-package-needs-followup-plan.json",
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

const sourcePlanRef =
  "docs/04_runbook/m1.5-a4-a8-routed-package-needs-followup-plan.json";
const expectedHandoffStatus = "handoff_prepared_not_accepted";
const expectedDependencyGateIds = [
  "DEP-FORGE",
  "DEP-TAILWIND",
  "DEP-REACT-FLOW",
  "DEP-UPDATER",
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

function mapById(items) {
  return new Map(items.map((item) => [item.id, item]));
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

function packageHandoffId(sourceId) {
  return sourceId.replace("ROUTED-PACKAGE-FOLLOW-UP-", "HANDOFF-PACKAGE-");
}

function blockerHandoffId(sourceId) {
  return sourceId.replace("ROUTED-BLOCKER-FOLLOW-UP-", "HANDOFF-ITEM-");
}

function crossGateId(sourceId) {
  return sourceId.replace("CROSS-ROUTE-FOLLOW-UP-", "CROSS-HANDOFF-GATE-");
}

function collectDesktopPackageVersions(packageJson) {
  return new Map([
    ...Object.entries(packageJson.dependencies ?? {}),
    ...Object.entries(packageJson.devDependencies ?? {}),
  ]);
}

function validateLedgerAndPackageWiring(
  handoff,
  readinessLedger,
  desktopPackage,
) {
  assertSliceAtLeast(readinessLedger.slice, "W1.5.228", "ledger slice");
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "EXIT-P1-1 ledger status",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-10",
    )?.status,
    "not_ready",
    "EXIT-P1-10 ledger status",
  );

  const r7 = readinessLedger.m1_5_roadmap_items.find(
    (item) => item.id === "M1.5-R7",
  );
  assertCondition(r7 !== undefined, "M1.5-R7 ledger item");
  assertCondition(
    r7.verified_evidence.some(
      (item) =>
        item.includes("W1.5.228") &&
        item.includes("reviewer-owned handoff packages"),
    ),
    "ledger W1.5.228 verified evidence",
  );
  assertCondition(
    r7.remaining_gap.some(
      (item) =>
        item.includes("W1.5.228") &&
        item.includes("handoff_prepared_not_accepted"),
    ),
    "ledger W1.5.228 remaining gap",
  );
  if (readinessLedger.slice === "W1.5.228") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.229"],
      "ledger next recommended slices",
    );
  }

  const packageVersions = collectDesktopPackageVersions(desktopPackage);
  for (const gate of readinessLedger.dependency_boundary
    .requires_separate_gate) {
    assertCondition(
      expectedDependencyGateIds.includes(gate.id),
      `${gate.id} dependency gate`,
    );
    for (const packageName of gate.packages) {
      assertCondition(
        !packageVersions.has(packageName),
        `${gate.id} dependency ${packageName} must remain uninstalled`,
      );
    }
  }
  assertCondition(
    desktopPackage.scripts.test.includes(
      "scripts/m1-5-a4-a8-routed-package-follow-up-handoff.test.cjs",
    ),
    "desktop package gate wiring",
  );
  assertCondition(
    desktopPackage.scripts.test.includes(
      "scripts/m1-5-a4-a8-routed-package-needs-followup-plan.test.cjs",
    ),
    "source desktop package gate wiring",
  );
  assertEqual(
    handoff.handoff_contract.runner_script,
    "apps/desktop/scripts/m1-5-a4-a8-routed-package-follow-up-handoff.cjs",
    "handoff runner script",
  );
  assertEqual(
    handoff.handoff_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-a8-routed-package-follow-up-handoff.cjs --check",
    "handoff focused check",
  );
  assertEqual(
    handoff.handoff_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-a8-routed-package-follow-up-handoff.test.cjs",
    "handoff focused test",
  );
}

function validateHandoffPackages(handoff, sourcePlan) {
  const packagesById = mapById(handoff.handoff_packages);
  const itemsByPackageId = new Map();
  for (const item of handoff.routed_blocker_handoff_items) {
    const items = itemsByPackageId.get(item.handoff_package_id) ?? [];
    items.push(item);
    itemsByPackageId.set(item.handoff_package_id, items);
  }

  assertEqual(
    handoff.handoff_packages.length,
    sourcePlan.route_package_follow_up_items.length,
    "handoff package count",
  );

  for (const source of sourcePlan.route_package_follow_up_items) {
    const expectedId = packageHandoffId(source.id);
    const actual = packagesById.get(expectedId);
    assertCondition(actual !== undefined, `${expectedId} handoff package`);
    assertEqual(
      actual.source_route_package_follow_up_id,
      source.id,
      `${expectedId} source follow-up id`,
    );
    assertEqual(
      actual.source_follow_up_plan_artifact,
      sourcePlanRef,
      `${expectedId} source artifact`,
    );
    assertEqual(
      actual.source_follow_up_status,
      "planned_not_implemented",
      `${expectedId} source status`,
    );
    assertEqual(
      actual.source_decision,
      "needs_followup",
      `${expectedId} decision`,
    );
    assertEqual(
      actual.package_status,
      expectedHandoffStatus,
      `${expectedId} package status`,
    );
    assertEqual(
      actual.handoff_status,
      expectedHandoffStatus,
      `${expectedId} handoff status`,
    );
    assertEqual(actual.accepted, false, `${expectedId} accepted`);
    assertEqual(actual.implemented, false, `${expectedId} implemented`);
    assertEqual(
      actual.reviewer_decision_required,
      true,
      `${expectedId} reviewer decision required`,
    );
    assertEqual(
      actual.acceptance_decision_status,
      "pending_reviewer_decision",
      `${expectedId} pending decision`,
    );
    assertEqual(
      actual.target_reviewer,
      source.target_reviewer,
      `${expectedId} target reviewer`,
    );
    assertDeepEqual(
      sorted(actual.fr_ids),
      sorted(source.fr_ids),
      `${expectedId} FR ids`,
    );
    assertDeepEqual(
      sorted(actual.source_routed_blocker_follow_up_ids),
      sorted(source.routed_blocker_follow_up_ids),
      `${expectedId} source blocker follow-up ids`,
    );
    assertDeepEqual(
      sorted(actual.handoff_item_ids),
      sorted(source.routed_blocker_follow_up_ids.map(blockerHandoffId)),
      `${expectedId} handoff item ids`,
    );
    assertEqual(
      (itemsByPackageId.get(actual.id) ?? []).length,
      actual.handoff_item_ids.length,
      `${expectedId} handoff item count`,
    );
    assertCondition(
      actual.evidence_refs.includes(`${sourcePlanRef}#${source.id}`),
      `${expectedId} source evidence ref`,
    );
    assertCondition(
      actual.remaining_acceptance_blockers.length > 0,
      `${expectedId} remaining blockers`,
    );
    assertCondition(
      actual.next_action_refs.some((item) => item.includes("W1.5.229")),
      `${expectedId} W1.5.229 next action`,
    );
    assertCondition(
      !actual.fr_ids.includes("FR-015"),
      `${expectedId} must not include FR-015`,
    );
  }
}

function validateHandoffItems(handoff, sourcePlan) {
  const itemsById = mapById(handoff.routed_blocker_handoff_items);
  const packagesById = mapById(handoff.handoff_packages);

  assertEqual(
    handoff.routed_blocker_handoff_items.length,
    sourcePlan.routed_blocker_follow_up_items.length,
    "handoff item count",
  );

  for (const source of sourcePlan.routed_blocker_follow_up_items) {
    const expectedId = blockerHandoffId(source.id);
    const actual = itemsById.get(expectedId);
    assertCondition(actual !== undefined, `${expectedId} handoff item`);
    const expectedPackageId = packageHandoffId(
      source.route_package_follow_up_id,
    );
    assertCondition(
      packagesById.has(expectedPackageId),
      `${expectedId} target package exists`,
    );
    assertEqual(
      actual.source_routed_blocker_follow_up_id,
      source.id,
      `${expectedId} source follow-up id`,
    );
    assertEqual(
      actual.source_follow_up_plan_artifact,
      sourcePlanRef,
      `${expectedId} source artifact`,
    );
    assertEqual(actual.fr_id, source.fr_id, `${expectedId} FR id`);
    assertEqual(
      actual.handoff_package_id,
      expectedPackageId,
      `${expectedId} handoff package id`,
    );
    assertEqual(
      actual.route_package_follow_up_id,
      source.route_package_follow_up_id,
      `${expectedId} route package follow-up id`,
    );
    assertEqual(
      actual.source_decision,
      "needs_followup",
      `${expectedId} source decision`,
    );
    assertEqual(
      actual.source_follow_up_status,
      "planned_not_implemented",
      `${expectedId} source follow-up status`,
    );
    assertEqual(
      actual.package_status,
      expectedHandoffStatus,
      `${expectedId} package status`,
    );
    assertEqual(
      actual.handoff_status,
      expectedHandoffStatus,
      `${expectedId} handoff status`,
    );
    assertEqual(actual.accepted, false, `${expectedId} accepted`);
    assertEqual(actual.implemented, false, `${expectedId} implemented`);
    assertEqual(
      actual.reviewer_decision_required,
      true,
      `${expectedId} reviewer decision required`,
    );
    assertEqual(
      actual.acceptance_decision_status,
      "pending_reviewer_decision",
      `${expectedId} pending decision`,
    );
    assertCondition(
      actual.acceptance_blockers.length > 0,
      `${expectedId} acceptance blockers`,
    );
    assertCondition(
      actual.evidence_refs.includes(`${sourcePlanRef}#${source.id}`),
      `${expectedId} evidence ref`,
    );
    assertCondition(actual.fr_id !== "FR-015", `${expectedId} FR-015 excluded`);
  }
}

function validateCrossCuttingGates(handoff, sourcePlan, adr0012Text) {
  assertEqual(
    handoff.cross_cutting_handoff_gates.length,
    sourcePlan.cross_cutting_follow_up_items.length,
    "cross-cutting handoff gate count",
  );
  const gatesById = mapById(handoff.cross_cutting_handoff_gates);
  for (const source of sourcePlan.cross_cutting_follow_up_items) {
    const expectedId = crossGateId(source.id);
    const gate = gatesById.get(expectedId);
    assertCondition(gate !== undefined, `${expectedId} gate`);
    assertEqual(
      gate.source_cross_cutting_follow_up_id,
      source.id,
      `${expectedId} source id`,
    );
    assertEqual(gate.accepted, false, `${expectedId} accepted`);
    assertEqual(gate.implemented, false, `${expectedId} implemented`);
    assertEqual(
      gate.source_follow_up_status,
      source.follow_up_status,
      `${expectedId} source status`,
    );
    assertEqual(
      gate.handoff_gate_status,
      source.follow_up_status.replace("_not_implemented", "_not_accepted"),
      `${expectedId} gate status`,
    );
    assertCondition(
      gate.evidence_refs.includes(`${sourcePlanRef}#${source.id}`),
      `${expectedId} evidence ref`,
    );
  }
  const fr015 = handoff.cross_cutting_handoff_gates.find(
    (item) => item.fr_id === "FR-015",
  );
  assertCondition(fr015 !== undefined, "FR-015 handoff gate");
  assertEqual(fr015.current_adr_status, "Proposed", "FR-015 ADR status");
  assertCondition(
    /^# ADR-0012:/u.test(adr0012Text) &&
      /\|\s*Status\s*\|\s*Proposed\s*\|/u.test(adr0012Text),
    "ADR-0012 must remain Proposed",
  );
}

function validateA8Handoff(handoff, sourcePlan) {
  const actual = handoff.a8_phase_conformance_handoff;
  const source = sourcePlan.a8_phase_conformance_follow_up_plan;
  assertEqual(
    actual.handoff_status,
    expectedHandoffStatus,
    "A8 handoff status",
  );
  assertEqual(actual.source_decision, source.source_decision, "A8 decision");
  for (const key of [
    "runtime_harness_8_2_trigger_count",
    "evidence_carried_forward_trigger_count",
    "explicitly_deferred_trigger_count",
  ]) {
    assertEqual(actual[key], source[key], `A8 ${key}`);
  }
  assertEqual(actual.phase_conformance_accepted_items, 0, "A8 accepted items");
  assertEqual(actual.accepted, false, "A8 accepted");
  assertEqual(actual.implemented, false, "A8 implemented");
  assertDeepEqual(
    actual.trigger_rows.map((row) => row.id),
    source.trigger_rows.map((row) => row.id),
    "A8 trigger row order",
  );
  for (const row of actual.trigger_rows) {
    assertEqual(row.accepted, false, `${row.id} accepted`);
    assertEqual(row.implemented, false, `${row.id} implemented`);
    assertEqual(row.handoff_status, expectedHandoffStatus, `${row.id} status`);
  }
}

function validateExcludedItems(handoff) {
  assertCondition(
    handoff.excluded_items.some((item) => item.fr_id === "FR-015"),
    "FR-015 excluded item",
  );
  assertCondition(
    handoff.excluded_items.some(
      (item) => item.scope === "dependency_gated_desktop_surfaces",
    ),
    "dependency-gated excluded item",
  );
  for (const item of handoff.excluded_items) {
    assertEqual(
      item.status,
      "excluded_from_w1_5_228_handoff",
      "excluded item status",
    );
  }
}

function validateSummary(handoff, sourcePlan) {
  assertEqual(
    handoff.summary.handoff_package_count,
    handoff.handoff_packages.length,
    "summary handoff package count",
  );
  assertEqual(
    handoff.summary.routed_blocker_handoff_item_count,
    handoff.routed_blocker_handoff_items.length,
    "summary routed blocker handoff item count",
  );
  assertEqual(
    handoff.summary.total_handoff_record_count,
    handoff.handoff_packages.length +
      handoff.routed_blocker_handoff_items.length,
    "summary total handoff record count",
  );
  assertEqual(handoff.summary.accepted_items, 0, "summary accepted");
  assertEqual(handoff.summary.implemented_items, 0, "summary implemented");
  assertEqual(
    handoff.summary.handoff_prepared_not_accepted_records,
    countBy(
      [...handoff.handoff_packages, ...handoff.routed_blocker_handoff_items],
      (item) => item.handoff_status === expectedHandoffStatus,
    ),
    "summary handoff prepared count",
  );
  assertEqual(
    handoff.summary.pending_reviewer_decision_records,
    countBy(
      [...handoff.handoff_packages, ...handoff.routed_blocker_handoff_items],
      (item) => item.acceptance_decision_status === "pending_reviewer_decision",
    ),
    "summary pending reviewer decision count",
  );
  assertEqual(
    handoff.summary.source_route_package_follow_up_items,
    sourcePlan.summary.route_package_follow_up_item_count,
    "summary source package follow-up count",
  );
  assertEqual(
    handoff.summary.source_routed_blocker_follow_up_items,
    sourcePlan.summary.routed_blocker_follow_up_item_count,
    "summary source blocker follow-up count",
  );
  assertEqual(
    handoff.summary.source_planned_not_implemented_items,
    sourcePlan.summary.planned_not_implemented_items,
    "summary source planned count",
  );
  assertEqual(
    handoff.summary.cross_cutting_handoff_gate_count,
    handoff.cross_cutting_handoff_gates.length,
    "summary cross gate count",
  );
  assertEqual(
    handoff.summary.blocked_cross_cutting_handoff_gates,
    countBy(
      handoff.cross_cutting_handoff_gates,
      (item) => item.handoff_gate_status === "blocked_not_accepted",
    ),
    "summary blocked cross gate count",
  );
  assertEqual(
    handoff.summary.deferred_cross_cutting_handoff_gates,
    countBy(
      handoff.cross_cutting_handoff_gates,
      (item) => item.handoff_gate_status === "deferred_not_accepted",
    ),
    "summary deferred cross gate count",
  );
  for (const key of [
    "runtime_harness_8_2_trigger_count",
    "evidence_carried_forward_trigger_count",
    "explicitly_deferred_trigger_count",
  ]) {
    assertEqual(
      handoff.summary[key],
      sourcePlan.summary[key],
      `summary ${key}`,
    );
  }
  assertEqual(
    handoff.summary.phase_conformance_accepted_items,
    0,
    "summary A8 accepted",
  );
  assertEqual(
    handoff.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    handoff.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    handoff.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.229"],
    "next recommended slices",
  );
}

function validateA4A8RoutedPackageFollowUpHandoff(options = {}) {
  const actualHandoffPath = options.handoffPath ?? handoffPath;
  const actualSourcePlanPath =
    options.needsFollowupPlanPath ?? needsFollowupPlanPath;
  const handoff = readJson(actualHandoffPath);
  const sourcePlan = readJson(actualSourcePlanPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );
  const adr0012Text = readText(options.adr0012Path ?? adr0012Path);

  validateA4A8RoutedPackageNeedsFollowupPlan({
    needsFollowupPlanPath: actualSourcePlanPath,
    readinessLedgerPath: options.readinessLedgerPath ?? readinessLedgerPath,
    desktopPackagePath: options.desktopPackagePath ?? desktopPackagePath,
    adr0012Path: options.adr0012Path ?? adr0012Path,
  });

  assertSanitizedJson(handoff, "A4/A8 routed package follow-up handoff");
  assertEqual(handoff.schema_version, "0.1.0", "schema version");
  assertEqual(handoff.milestone, "M1.5", "milestone");
  assertEqual(handoff.slice, "W1.5.228", "slice id");
  assertEqual(
    handoff.handoff_status,
    "a4_a8_routed_package_follow_up_handoff_prepared_not_accepted",
    "handoff status",
  );
  assertEqual(handoff.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(handoff.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertEqual(sourcePlan.slice, "W1.5.227", "source plan slice");
  assertEqual(
    sourcePlan.plan_status,
    "a4_a8_routed_package_needs_followup_plan_prepared_not_implemented",
    "source plan status",
  );
  assertEqual(sourcePlan.summary.accepted_items, 0, "source accepted");
  assertEqual(sourcePlan.summary.implemented_items, 0, "source implemented");
  assertEqual(
    sourcePlan.summary.planned_not_implemented_items,
    14,
    "source planned count",
  );
  assertEqual(
    handoff.handoff_contract.handoff_packages_must_remain_not_accepted,
    true,
    "handoff package guard",
  );

  validateLedgerAndPackageWiring(handoff, readinessLedger, desktopPackage);
  validateHandoffPackages(handoff, sourcePlan);
  validateHandoffItems(handoff, sourcePlan);
  validateCrossCuttingGates(handoff, sourcePlan, adr0012Text);
  validateA8Handoff(handoff, sourcePlan);
  validateExcludedItems(handoff);
  validateSummary(handoff, sourcePlan);

  return {
    status: handoff.handoff_status,
    exitP1_1Status: handoff.exit_p1_1_status,
    exitP1_10Status: handoff.exit_p1_10_status,
    handoffPackageCount: handoff.summary.handoff_package_count,
    routedBlockerHandoffItemCount:
      handoff.summary.routed_blocker_handoff_item_count,
    totalHandoffRecordCount: handoff.summary.total_handoff_record_count,
    streamHandoffPackageCount: handoff.summary.stream_handoff_packages,
    runtimeUxHandoffPackageCount: handoff.summary.runtime_ux_handoff_packages,
    gitHistoryHandoffPackageCount: handoff.summary.git_history_handoff_packages,
    streamRoutedBlockerHandoffItemCount:
      handoff.summary.stream_routed_blocker_handoff_items,
    runtimeUxRoutedBlockerHandoffItemCount:
      handoff.summary.runtime_ux_routed_blocker_handoff_items,
    gitHistoryRoutedBlockerHandoffItemCount:
      handoff.summary.git_history_routed_blocker_handoff_items,
    acceptedItemCount: handoff.summary.accepted_items,
    implementedItemCount: handoff.summary.implemented_items,
    handoffPreparedNotAcceptedRecordCount:
      handoff.summary.handoff_prepared_not_accepted_records,
    pendingReviewerDecisionRecordCount:
      handoff.summary.pending_reviewer_decision_records,
    crossCuttingHandoffGateCount:
      handoff.summary.cross_cutting_handoff_gate_count,
    blockedCrossCuttingHandoffGateCount:
      handoff.summary.blocked_cross_cutting_handoff_gates,
    deferredCrossCuttingHandoffGateCount:
      handoff.summary.deferred_cross_cutting_handoff_gates,
    runtimeHarness8_2TriggerCount:
      handoff.summary.runtime_harness_8_2_trigger_count,
    evidenceCarriedForwardTriggerCount:
      handoff.summary.evidence_carried_forward_trigger_count,
    explicitlyDeferredTriggerCount:
      handoff.summary.explicitly_deferred_trigger_count,
    phaseConformanceAcceptedItemCount:
      handoff.summary.phase_conformance_accepted_items,
    handoffPackageIds: handoff.handoff_packages.map((item) => item.id),
    excludedFrIds: handoff.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: handoff.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4A8RoutedPackageFollowUpHandoff();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4A8RoutedPackageFollowUpHandoff,
};
