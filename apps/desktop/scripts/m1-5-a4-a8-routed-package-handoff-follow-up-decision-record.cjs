const fs = require("node:fs");
const path = require("node:path");
const {
  validateA4A8RoutedPackageHandoffFollowUpHandoff,
} = require("./m1-5-a4-a8-routed-package-handoff-follow-up-handoff.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-package-handoff-follow-up-decision-record.json",
);
const handoffPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-package-handoff-follow-up-handoff.json",
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

const expectedHandoffPackageIds = [
  "HANDOFF-FOLLOW-UP-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
  "HANDOFF-FOLLOW-UP-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  "HANDOFF-FOLLOW-UP-PACKAGE-A8-PHASE-CONFORMANCE",
];
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

function handoffPackageDecisionId(handoffPackageId) {
  return handoffPackageId.replace(
    "HANDOFF-FOLLOW-UP-PACKAGE-",
    "HANDOFF-FOLLOW-UP-PACKAGE-DECISION-",
  );
}

function handoffItemDecisionId(handoffItemId) {
  return handoffItemId.replace(
    "HANDOFF-FOLLOW-UP-ITEM-",
    "HANDOFF-FOLLOW-UP-ITEM-DECISION-",
  );
}

function crossHandoffDecisionId(handoffGateId) {
  return handoffGateId.replace(
    "CROSS-HANDOFF-FOLLOW-UP-GATE-",
    "CROSS-HANDOFF-FOLLOW-UP-DECISION-",
  );
}

function validateLedgerAndPackageWiring(
  decisionRecord,
  readinessLedger,
  desktopPackage,
) {
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.232",
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
  if (readinessLedger.slice === "W1.5.232") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.233"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.232"),
      "future readiness ledger must retain W1.5.232 evidence",
    );
  }
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-package-handoff-follow-up-decision-record.test.cjs",
    ),
    "desktop package gate wiring",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-package-handoff-follow-up-handoff.test.cjs",
    ),
    "source handoff package gate wiring",
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
        `${packageName} must stay out of package.json before dependency gate`,
      );
    }
  }
  assertEqual(
    decisionRecord.reviewer_contract.runner_script,
    "apps/desktop/scripts/m1-5-a4-a8-routed-package-handoff-follow-up-decision-record.cjs",
    "runner script",
  );
  assertEqual(
    decisionRecord.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-a8-routed-package-handoff-follow-up-decision-record.cjs --check",
    "focused check",
  );
  assertEqual(
    decisionRecord.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-a8-routed-package-handoff-follow-up-decision-record.test.cjs",
    "focused test",
  );
}

function validateSourceHandoff(sourceHandoff) {
  assertEqual(sourceHandoff.slice, "W1.5.231", "source handoff slice");
  assertEqual(
    sourceHandoff.handoff_status,
    "a4_a8_routed_package_handoff_follow_up_handoff_prepared_not_accepted",
    "source handoff status",
  );
  assertEqual(sourceHandoff.summary.accepted_items, 0, "source accepted");
  assertEqual(sourceHandoff.summary.implemented_items, 0, "source implemented");
  assertEqual(
    sourceHandoff.summary.handoff_package_count,
    3,
    "source handoff packages",
  );
  assertEqual(
    sourceHandoff.summary.routed_blocker_handoff_item_count,
    11,
    "source handoff items",
  );
  assertEqual(
    sourceHandoff.summary.handoff_prepared_not_accepted_records,
    14,
    "source handoff prepared records",
  );
}

function validatePackageDecisions(decisionRecord, sourceHandoff) {
  const decisions = decisionRecord.handoff_package_decision_items;
  const sourcePackages = sourceHandoff.handoff_packages;
  const sourceById = mapById(sourcePackages);

  assertDeepEqual(
    sorted(decisions.map((item) => item.source_handoff_package_id)),
    sorted(sourcePackages.map((item) => item.id)),
    "handoff package source ids",
  );
  assertDeepEqual(
    sorted(sourcePackages.map((item) => item.id)),
    sorted(expectedHandoffPackageIds),
    "source handoff package ids",
  );

  for (const decision of decisions) {
    const source = sourceById.get(decision.source_handoff_package_id);
    assertCondition(Boolean(source), `${decision.id} source handoff package`);
    assertEqual(
      decision.id,
      handoffPackageDecisionId(source.id),
      `${decision.id} decision id`,
    );
    for (const key of [
      "source_route_package_follow_up_id",
      "source_route_package_decision_id",
      "source_route_package_id",
      "source_track_id",
      "track_id",
      "route_group",
      "decision_owner",
      "target_reviewer",
      "handoff_package_kind",
      "source_follow_up_status",
      "source_decision",
      "source_decision_status",
    ]) {
      assertEqual(decision[key], source[key], `${decision.id} ${key}`);
    }
    assertEqual(
      decision.source_handoff_status,
      source.handoff_status,
      `${decision.id} source handoff status`,
    );
    assertEqual(
      decision.source_package_status,
      source.package_status,
      `${decision.id} source package status`,
    );
    assertEqual(
      decision.source_acceptance_decision_status,
      source.acceptance_decision_status,
      `${decision.id} source acceptance decision status`,
    );
    assertEqual(decision.decision, "needs_followup", `${decision.id} decision`);
    assertEqual(
      decision.decision_status,
      "reviewed_handoff_follow_up_package_needs_followup_not_accepted",
      `${decision.id} decision status`,
    );
    assertEqual(decision.accepted, false, `${decision.id} accepted`);
    assertEqual(decision.implemented, false, `${decision.id} implemented`);
    assertEqual(
      decision.handoff_package_reviewed,
      true,
      `${decision.id} handoff package reviewed`,
    );
    assertEqual(
      decision.reviewer_decision_recorded,
      true,
      `${decision.id} reviewer decision recorded`,
    );
    assertEqual(
      decision.follow_up_required,
      true,
      `${decision.id} follow-up required`,
    );
    assertEqual(
      decision.source_accepted,
      source.accepted,
      `${decision.id} source accepted`,
    );
    assertEqual(
      decision.source_implemented,
      source.implemented,
      `${decision.id} source implemented`,
    );
    assertDeepEqual(
      sorted(decision.fr_ids),
      sorted(source.fr_ids),
      `${decision.id} FR ids`,
    );
    assertDeepEqual(
      sorted(decision.source_handoff_item_ids),
      sorted(source.handoff_item_ids),
      `${decision.id} source handoff item ids`,
    );
    assertDeepEqual(
      decision.remaining_acceptance_blockers.slice(
        0,
        source.remaining_acceptance_blockers.length,
      ),
      source.remaining_acceptance_blockers,
      `${decision.id} blockers`,
    );
    assertCondition(
      decision.remaining_acceptance_blockers.length > 0,
      `${decision.id} blockers present`,
    );
    assertCondition(
      decision.evidence_refs.some((ref) => ref.includes(source.id)),
      `${decision.id} source handoff evidence ref`,
    );
    for (const handoffItemId of decision.source_handoff_item_ids) {
      assertCondition(
        decision.evidence_refs.some((ref) => ref.includes(handoffItemId)) ||
          source.evidence_refs.some((ref) => ref.includes(handoffItemId)),
        `${decision.id} handoff item evidence ref ${handoffItemId}`,
      );
    }
  }
}

function validateRoutedBlockerDecisions(decisionRecord, sourceHandoff) {
  const decisions = decisionRecord.routed_blocker_handoff_decision_items;
  const sourceItems = sourceHandoff.routed_blocker_handoff_items;
  const sourceById = mapById(sourceItems);

  assertDeepEqual(
    sorted(decisions.map((item) => item.source_handoff_item_id)),
    sorted(sourceItems.map((item) => item.id)),
    "handoff item source ids",
  );
  assertCondition(
    !decisions.some((item) => item.fr_id === "FR-015"),
    "FR-015 must stay out of handoff item decisions",
  );

  for (const decision of decisions) {
    const source = sourceById.get(decision.source_handoff_item_id);
    assertCondition(Boolean(source), `${decision.id} source handoff item`);
    assertEqual(
      decision.id,
      handoffItemDecisionId(source.id),
      `${decision.id} decision id`,
    );
    for (const key of [
      "source_routed_blocker_follow_up_id",
      "source_routed_blocker_decision_id",
      "source_route_package_decision_id",
      "source_routed_blocker_item_id",
      "source_remaining_blocker_item_id",
      "route_package_id",
      "route_package_follow_up_id",
      "route_package_kind",
      "track_id",
      "source_track_id",
      "review_group",
      "decision_owner",
      "target_reviewer",
      "fr_id",
      "source_decision",
      "source_decision_status",
      "source_route_status",
      "source_blocker_status",
      "source_follow_up_status",
      "source_repair_status",
      "package_required",
    ]) {
      assertEqual(decision[key], source[key], `${decision.id} ${key}`);
    }
    assertEqual(
      decision.source_handoff_package_id,
      source.handoff_follow_up_package_id,
      `${decision.id} source handoff package`,
    );
    assertEqual(
      decision.handoff_package_decision_id,
      handoffPackageDecisionId(source.handoff_follow_up_package_id),
      `${decision.id} package decision id`,
    );
    assertEqual(
      decision.source_handoff_status,
      source.handoff_status,
      `${decision.id} source handoff status`,
    );
    assertEqual(
      decision.source_acceptance_decision_status,
      source.acceptance_decision_status,
      `${decision.id} source acceptance status`,
    );
    assertEqual(decision.decision, "needs_followup", `${decision.id} decision`);
    assertEqual(
      decision.decision_status,
      "reviewed_handoff_follow_up_item_needs_followup_not_accepted",
      `${decision.id} decision status`,
    );
    assertEqual(decision.accepted, false, `${decision.id} accepted`);
    assertEqual(decision.implemented, false, `${decision.id} implemented`);
    assertEqual(
      decision.handoff_item_reviewed,
      true,
      `${decision.id} handoff item reviewed`,
    );
    assertEqual(
      decision.handoff_package_reviewed,
      true,
      `${decision.id} package reviewed`,
    );
    assertEqual(
      decision.reviewer_decision_recorded,
      true,
      `${decision.id} reviewer decision recorded`,
    );
    assertEqual(
      decision.follow_up_required,
      true,
      `${decision.id} follow-up required`,
    );
    assertDeepEqual(
      decision.remaining_acceptance_blockers.slice(
        0,
        source.acceptance_blockers.length,
      ),
      source.acceptance_blockers,
      `${decision.id} blockers`,
    );
    assertCondition(
      decision.remaining_acceptance_blockers.length > 0,
      `${decision.id} remaining blockers present`,
    );
    assertCondition(
      decision.evidence_refs.some((ref) => ref.includes(source.id)),
      `${decision.id} source handoff item evidence ref`,
    );
    assertCondition(
      decision.evidence_refs.some((ref) =>
        ref.includes(source.handoff_follow_up_package_id),
      ),
      `${decision.id} source handoff package evidence ref`,
    );
  }
}

function validateCrossCuttingDecisions(
  decisionRecord,
  sourceHandoff,
  adr0012Text,
) {
  const decisions = decisionRecord.cross_cutting_decision_items;
  const sourceById = mapById(sourceHandoff.cross_cutting_handoff_gates);
  assertDeepEqual(
    sorted(decisions.map((item) => item.source_cross_cutting_handoff_gate_id)),
    sorted(sourceHandoff.cross_cutting_handoff_gates.map((item) => item.id)),
    "cross-cutting source handoff gate ids",
  );

  for (const decision of decisions) {
    const source = sourceById.get(
      decision.source_cross_cutting_handoff_gate_id,
    );
    assertCondition(Boolean(source), `${decision.id} source handoff gate`);
    assertEqual(
      decision.id,
      crossHandoffDecisionId(source.id),
      `${decision.id} cross decision id`,
    );
    assertEqual(
      decision.source_handoff_gate_status,
      source.handoff_gate_status,
      `${decision.id} gate status`,
    );
    assertEqual(decision.accepted, false, `${decision.id} accepted`);
    assertEqual(decision.implemented, false, `${decision.id} implemented`);
    assertCondition(
      decision.evidence_refs.some((ref) => ref.includes(source.id)),
      `${decision.id} source handoff gate evidence ref`,
    );
    for (const ref of source.evidence_refs) {
      assertCondition(
        decision.evidence_refs.includes(ref),
        `${decision.id} retained evidence ref ${ref}`,
      );
    }
  }
  const dependency = decisions.find((item) =>
    item.id.includes("DEPENDENCY-GATED"),
  );
  const fr015 = decisions.find((item) => item.fr_id === "FR-015");
  const m16 = decisions.find((item) => item.id.includes("M1-6-DEMO"));
  assertEqual(dependency.decision, "blocked", "dependency decision");
  assertDeepEqual(
    dependency.dependency_gate_ids,
    expectedDependencyGateIds,
    "dependency gates",
  );
  assertEqual(fr015.decision, "blocked", "FR-015 decision");
  assertEqual(fr015.current_adr_status, "Proposed", "FR-015 ADR status");
  assertCondition(
    /\|\s*Status\s*\|\s*Proposed\s*\|/u.test(adr0012Text),
    "ADR-0012 must remain Proposed",
  );
  assertEqual(m16.decision, "deferred", "M1.6 decision");
  assertDeepEqual(
    m16.exit_ids,
    ["EXIT-P1-2", "EXIT-P1-3", "EXIT-P1-11"],
    "M1.6 exit ids",
  );
}

function validateA8DecisionContext(decisionRecord, sourceHandoff) {
  const context = decisionRecord.a8_phase_conformance_decision_context;
  const source = sourceHandoff.a8_phase_conformance_handoff;
  assertEqual(
    context.source_handoff_package_id,
    source.handoff_follow_up_package_id,
    "A8 source handoff package",
  );
  assertEqual(context.decision, "needs_followup", "A8 decision");
  assertEqual(
    context.decision_status,
    "reviewed_handoff_follow_up_package_needs_followup_not_accepted",
    "A8 decision status",
  );
  assertEqual(context.phase_exit_decision_status, "not_ready", "A8 phase exit");
  for (const key of [
    "runtime_harness_8_2_trigger_count",
    "evidence_carried_forward_trigger_count",
    "explicitly_deferred_trigger_count",
  ]) {
    assertEqual(context[key], source[key], `A8 ${key}`);
  }
  assertEqual(context.phase_conformance_accepted_items, 0, "A8 accepted");
  assertDeepEqual(
    sorted(context.carried_forward_trigger_ids),
    expectedCarriedForwardTriggerIds,
    "A8 carried-forward ids",
  );
  assertDeepEqual(
    sorted(context.deferred_trigger_ids),
    expectedDeferredTriggerIds,
    "A8 deferred ids",
  );
  assertDeepEqual(
    context.trigger_rows.map((row) => row.id),
    source.trigger_rows.map((row) => row.id),
    "A8 trigger row order",
  );
  for (const row of context.trigger_rows) {
    const sourceRow = source.trigger_rows.find((item) => item.id === row.id);
    assertEqual(row.accepted, false, `${row.id} accepted`);
    assertEqual(row.implemented, false, `${row.id} implemented`);
    assertEqual(
      row.source_accepted,
      sourceRow.accepted,
      `${row.id} source accepted`,
    );
    assertEqual(
      row.source_implemented,
      sourceRow.implemented,
      `${row.id} source implemented`,
    );
    assertEqual(row.decision, "needs_followup", `${row.id} decision`);
    assertEqual(
      row.decision_status,
      "reviewed_handoff_follow_up_trigger_needs_followup_not_accepted",
      `${row.id} decision status`,
    );
    assertEqual(row.route_status, sourceRow.route_status, `${row.id} route`);
    assertEqual(
      row.blocker_status,
      sourceRow.blocker_status,
      `${row.id} blocker`,
    );
  }
}

function validateSummary(decisionRecord, sourceHandoff) {
  const packageDecisions = decisionRecord.handoff_package_decision_items;
  const itemDecisions = decisionRecord.routed_blocker_handoff_decision_items;
  const crossDecisions = decisionRecord.cross_cutting_decision_items;
  assertEqual(
    decisionRecord.summary.handoff_package_decision_count,
    packageDecisions.length,
    "summary package decisions",
  );
  assertEqual(
    decisionRecord.summary.routed_blocker_handoff_decision_count,
    itemDecisions.length,
    "summary item decisions",
  );
  assertEqual(
    decisionRecord.summary.total_handoff_decision_record_count,
    packageDecisions.length + itemDecisions.length,
    "summary total decisions",
  );
  assertEqual(
    decisionRecord.summary.stream_package_decision_items,
    countBy(
      packageDecisions,
      (item) => item.route_group === "stream_acceptance_repair",
    ),
    "summary stream package decisions",
  );
  assertEqual(
    decisionRecord.summary.runtime_ux_package_decision_items,
    countBy(
      packageDecisions,
      (item) => item.route_group === "runtime_ux_repair",
    ),
    "summary runtime package decisions",
  );
  assertEqual(
    decisionRecord.summary.git_history_package_decision_items,
    countBy(
      packageDecisions,
      (item) => item.route_group === "git_history_conformance_repair",
    ),
    "summary Git-history package decisions",
  );
  assertEqual(
    decisionRecord.summary.stream_routed_blocker_decision_items,
    countBy(
      itemDecisions,
      (item) =>
        item.source_handoff_package_id ===
        "HANDOFF-FOLLOW-UP-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
    ),
    "summary stream item decisions",
  );
  assertEqual(
    decisionRecord.summary.runtime_ux_routed_blocker_decision_items,
    countBy(
      itemDecisions,
      (item) =>
        item.source_handoff_package_id ===
        "HANDOFF-FOLLOW-UP-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
    ),
    "summary runtime item decisions",
  );
  assertEqual(
    decisionRecord.summary.git_history_routed_blocker_decision_items,
    countBy(
      itemDecisions,
      (item) =>
        item.source_handoff_package_id ===
        "HANDOFF-FOLLOW-UP-PACKAGE-A8-PHASE-CONFORMANCE",
    ),
    "summary Git-history item decisions",
  );
  assertEqual(decisionRecord.summary.accepted_items, 0, "summary accepted");
  assertEqual(decisionRecord.summary.rejected_items, 0, "summary rejected");
  assertEqual(
    decisionRecord.summary.needs_followup_handoff_package_decisions,
    packageDecisions.length,
    "summary package needs-followup",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_routed_blocker_handoff_decisions,
    itemDecisions.length,
    "summary item needs-followup",
  );
  assertEqual(
    decisionRecord.summary.implemented_items,
    0,
    "summary implemented",
  );
  assertEqual(
    decisionRecord.summary.source_handoff_packages,
    sourceHandoff.handoff_packages.length,
    "summary source packages",
  );
  assertEqual(
    decisionRecord.summary.source_routed_blocker_handoff_items,
    sourceHandoff.routed_blocker_handoff_items.length,
    "summary source items",
  );
  assertEqual(
    decisionRecord.summary.source_handoff_prepared_not_accepted_records,
    sourceHandoff.summary.handoff_prepared_not_accepted_records,
    "summary source handoff records",
  );
  assertEqual(
    decisionRecord.summary.cross_cutting_decision_count,
    crossDecisions.length,
    "summary cross decisions",
  );
  assertEqual(
    decisionRecord.summary.blocked_cross_cutting_decisions,
    countBy(crossDecisions, (item) => item.decision === "blocked"),
    "summary blocked cross decisions",
  );
  assertEqual(
    decisionRecord.summary.deferred_cross_cutting_decisions,
    countBy(crossDecisions, (item) => item.decision === "deferred"),
    "summary deferred cross decisions",
  );
  assertEqual(
    decisionRecord.summary.runtime_harness_8_2_trigger_count,
    sourceHandoff.summary.runtime_harness_8_2_trigger_count,
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
    "summary phase accepted",
  );
  assertEqual(
    decisionRecord.summary.excluded_items,
    decisionRecord.excluded_items.length,
    "summary excluded",
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
    ["W1.5.233"],
    "next recommended slices",
  );
}

function validateA4A8RoutedPackageHandoffFollowUpDecisionRecord(options = {}) {
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const sourceHandoff = readJson(options.handoffPath ?? handoffPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );
  const adr0012Text = readText(options.adr0012Path ?? adr0012Path);

  validateA4A8RoutedPackageHandoffFollowUpHandoff({
    handoffPath: options.handoffPath ?? handoffPath,
    readinessLedgerPath: options.readinessLedgerPath ?? readinessLedgerPath,
    desktopPackagePath: options.desktopPackagePath ?? desktopPackagePath,
    adr0012Path: options.adr0012Path ?? adr0012Path,
  });

  assertSanitizedJson(
    decisionRecord,
    "A4/A8 routed package handoff follow-up decision record",
  );
  assertEqual(decisionRecord.schema_version, "0.1.0", "schema version");
  assertEqual(decisionRecord.milestone, "M1.5", "milestone");
  assertEqual(decisionRecord.slice, "W1.5.232", "slice id");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_a8_routed_package_handoff_follow_up_decisions_recorded_needs_followup_not_accepted",
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
    decisionRecord.reviewer_contract.allowed_handoff_decisions,
    ["accepted", "rejected", "needs_followup"],
    "allowed handoff decisions",
  );
  assertDeepEqual(
    decisionRecord.reviewer_contract.allowed_cross_cutting_dispositions,
    ["blocked", "deferred"],
    "allowed cross-cutting dispositions",
  );
  assertEqual(
    decisionRecord.reviewer_contract.accepted_item_count_must_remain_zero,
    true,
    "accepted guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.implemented_item_count_must_remain_zero,
    true,
    "implemented guard",
  );
  assertEqual(
    decisionRecord.reviewer_contract.phase_exit_status_must_remain_not_ready,
    true,
    "phase exit guard",
  );

  validateSourceHandoff(sourceHandoff);
  validateLedgerAndPackageWiring(
    decisionRecord,
    readinessLedger,
    desktopPackage,
  );
  validatePackageDecisions(decisionRecord, sourceHandoff);
  validateRoutedBlockerDecisions(decisionRecord, sourceHandoff);
  validateCrossCuttingDecisions(decisionRecord, sourceHandoff, adr0012Text);
  validateA8DecisionContext(decisionRecord, sourceHandoff);
  validateSummary(decisionRecord, sourceHandoff);

  return {
    status: decisionRecord.decision_record_status,
    exitP1_1Status: decisionRecord.exit_p1_1_status,
    exitP1_10Status: decisionRecord.exit_p1_10_status,
    handoffPackageDecisionCount:
      decisionRecord.summary.handoff_package_decision_count,
    routedBlockerHandoffDecisionCount:
      decisionRecord.summary.routed_blocker_handoff_decision_count,
    totalHandoffDecisionRecordCount:
      decisionRecord.summary.total_handoff_decision_record_count,
    streamPackageDecisionItemCount:
      decisionRecord.summary.stream_package_decision_items,
    runtimeUxPackageDecisionItemCount:
      decisionRecord.summary.runtime_ux_package_decision_items,
    gitHistoryPackageDecisionItemCount:
      decisionRecord.summary.git_history_package_decision_items,
    streamRoutedBlockerDecisionItemCount:
      decisionRecord.summary.stream_routed_blocker_decision_items,
    runtimeUxRoutedBlockerDecisionItemCount:
      decisionRecord.summary.runtime_ux_routed_blocker_decision_items,
    gitHistoryRoutedBlockerDecisionItemCount:
      decisionRecord.summary.git_history_routed_blocker_decision_items,
    acceptedItemCount: decisionRecord.summary.accepted_items,
    rejectedItemCount: decisionRecord.summary.rejected_items,
    needsFollowupHandoffPackageDecisionCount:
      decisionRecord.summary.needs_followup_handoff_package_decisions,
    needsFollowupRoutedBlockerHandoffDecisionCount:
      decisionRecord.summary.needs_followup_routed_blocker_handoff_decisions,
    implementedItemCount: decisionRecord.summary.implemented_items,
    reviewedHandoffPackageCount:
      decisionRecord.summary.reviewed_handoff_packages,
    reviewedHandoffItemCount: decisionRecord.summary.reviewed_handoff_items,
    crossCuttingDecisionCount:
      decisionRecord.summary.cross_cutting_decision_count,
    blockedCrossCuttingDecisionCount:
      decisionRecord.summary.blocked_cross_cutting_decisions,
    deferredCrossCuttingDecisionCount:
      decisionRecord.summary.deferred_cross_cutting_decisions,
    runtimeHarness8_2TriggerCount:
      decisionRecord.summary.runtime_harness_8_2_trigger_count,
    evidenceCarriedForwardTriggerCount:
      decisionRecord.summary.evidence_carried_forward_trigger_count,
    explicitlyDeferredTriggerCount:
      decisionRecord.summary.explicitly_deferred_trigger_count,
    phaseConformanceAcceptedItemCount:
      decisionRecord.summary.phase_conformance_accepted_items,
    sourceHandoffPackageIds: decisionRecord.handoff_package_decision_items.map(
      (item) => item.source_handoff_package_id,
    ),
    sourceHandoffItemIds:
      decisionRecord.routed_blocker_handoff_decision_items.map(
        (item) => item.source_handoff_item_id,
      ),
    excludedFrIds: decisionRecord.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    nextRecommendedSlices: decisionRecord.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4A8RoutedPackageHandoffFollowUpDecisionRecord();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4A8RoutedPackageHandoffFollowUpDecisionRecord,
};
