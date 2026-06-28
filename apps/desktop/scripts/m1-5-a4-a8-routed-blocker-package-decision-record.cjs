const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-routed-blocker-package-decision-record.json",
);
const routingPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-remaining-blocker-package-routing.json",
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

const expectedRoutePackageIds = [
  "ROUTE-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
  "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
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

function optionalEqual(actual, expected, actualKey, expectedKey, message) {
  const sourceKey = expectedKey ?? actualKey;
  if (expected[sourceKey] !== undefined) {
    assertEqual(
      actual[actualKey],
      expected[sourceKey],
      `${message} ${actualKey}`,
    );
  } else {
    assertEqual(actual[actualKey], undefined, `${message} ${actualKey}`);
  }
}

function routedPackageDecisionId(routePackageId) {
  return routePackageId.replace("ROUTE-PACKAGE-", "ROUTED-PACKAGE-DECISION-");
}

function routedBlockerDecisionId(routedItemId) {
  return routedItemId.replace("ROUTED-BLOCKER-", "ROUTED-BLOCKER-DECISION-");
}

function crossRouteDecisionId(routeId) {
  return routeId.replace("CROSS-ROUTE-", "CROSS-ROUTE-DECISION-");
}

function validateLedgerAndPackageWiring(
  decisionRecord,
  readinessLedger,
  desktopPackage,
) {
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.226",
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
  if (readinessLedger.slice === "W1.5.226") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.227"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.226"),
      "future readiness ledger must retain W1.5.226 evidence",
    );
  }
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-routed-blocker-package-decision-record.test.cjs",
    ),
    "desktop package gate wiring",
  );
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-remaining-blocker-package-routing.test.cjs",
    ),
    "source routing package gate wiring",
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
    "apps/desktop/scripts/m1-5-a4-a8-routed-blocker-package-decision-record.cjs",
    "runner script",
  );
  assertEqual(
    decisionRecord.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-a8-routed-blocker-package-decision-record.cjs --check",
    "focused check",
  );
  assertEqual(
    decisionRecord.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-a8-routed-blocker-package-decision-record.test.cjs",
    "focused test",
  );
}

function validateSourceRouting(routingArtifact) {
  assertEqual(routingArtifact.slice, "W1.5.225", "source routing slice");
  assertEqual(
    routingArtifact.package_routing_status,
    "a4_a8_remaining_blocker_package_routing_prepared_not_accepted",
    "source routing status",
  );
  assertEqual(routingArtifact.summary.accepted_items, 0, "source accepted");
  assertEqual(
    routingArtifact.summary.implemented_items,
    0,
    "source implemented",
  );
  assertEqual(
    routingArtifact.summary.route_packages_not_accepted,
    3,
    "source not accepted packages",
  );
  assertEqual(
    routingArtifact.summary.routed_not_accepted_items,
    11,
    "source not accepted routed items",
  );
}

function validateRoutePackageDecisions(decisionRecord, routingArtifact) {
  const sourcePackages = routingArtifact.target_route_packages;
  const sourcePackagesById = mapById(sourcePackages);
  const decisions = decisionRecord.route_package_decision_items;

  assertDeepEqual(
    sorted(decisions.map((item) => item.source_route_package_id)),
    sorted(sourcePackages.map((item) => item.id)),
    "route package source ids",
  );
  assertDeepEqual(
    sorted(sourcePackages.map((item) => item.id)),
    sorted(expectedRoutePackageIds),
    "source route package ids",
  );

  for (const decision of decisions) {
    const source = sourcePackagesById.get(decision.source_route_package_id);
    assertCondition(Boolean(source), `${decision.id} source route package`);
    assertEqual(
      decision.id,
      routedPackageDecisionId(source.id),
      `${decision.id} decision id`,
    );
    assertEqual(
      decision.source_route_package_slice,
      "W1.5.225",
      `${decision.id} source slice`,
    );
    for (const key of [
      "source_track_id",
      "source_track_status",
      "route_group",
      "target_reviewer",
      "target_package_kind",
      "planned_package_artifact",
      "source_item_count",
    ]) {
      const sourceKey = key.replace(/^source_/, "");
      const expected =
        key === "source_item_count"
          ? source.source_item_count
          : (source[sourceKey] ?? source[key]);
      assertEqual(decision[key], expected, `${decision.id} ${key}`);
    }
    assertEqual(
      decision.source_package_status,
      source.package_status,
      `${decision.id} source package status`,
    );
    assertEqual(
      decision.source_route_status,
      source.route_status,
      `${decision.id} source route status`,
    );
    assertEqual(decision.decision, "needs_followup", `${decision.id} decision`);
    assertEqual(
      decision.decision_status,
      "reviewed_routed_package_needs_followup_not_accepted",
      `${decision.id} decision status`,
    );
    assertEqual(decision.accepted, false, `${decision.id} accepted`);
    assertEqual(decision.implemented, false, `${decision.id} implemented`);
    assertEqual(
      decision.route_package_reviewed,
      true,
      `${decision.id} reviewed`,
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
      sorted(decision.routed_item_ids),
      sorted(source.routed_item_ids),
      `${decision.id} routed item ids`,
    );
    assertCondition(
      decision.remaining_package_blockers.length > 0,
      `${decision.id} package blockers`,
    );
    assertCondition(
      decision.evidence_refs.some((ref) =>
        ref.includes(decision.source_route_package_id),
      ),
      `${decision.id} route package evidence ref`,
    );
    for (const routedItemId of decision.routed_item_ids) {
      assertCondition(
        decision.evidence_refs.some((ref) => ref.includes(routedItemId)),
        `${decision.id} routed item evidence ref ${routedItemId}`,
      );
    }
  }
}

function validateRoutedBlockerDecisions(decisionRecord, routingArtifact) {
  const decisions = decisionRecord.routed_blocker_decision_items;
  const sourceItems = routingArtifact.routed_blocker_items;
  const sourceItemsById = mapById(sourceItems);

  assertDeepEqual(
    sorted(decisions.map((item) => item.source_routed_blocker_item_id)),
    sorted(sourceItems.map((item) => item.id)),
    "source routed blocker item ids",
  );
  assertCondition(
    !decisions.some((item) => item.fr_id === "FR-015"),
    "FR-015 must stay out of routed blocker decisions",
  );

  for (const decision of decisions) {
    const source = sourceItemsById.get(decision.source_routed_blocker_item_id);
    assertCondition(Boolean(source), `${decision.id} source routed blocker`);
    assertEqual(
      decision.id,
      routedBlockerDecisionId(source.id),
      `${decision.id} decision id`,
    );
    assertEqual(decision.fr_id, source.fr_id, `${decision.id} FR id`);
    assertEqual(
      decision.route_package_id,
      source.route_package_id,
      `${decision.id} route package`,
    );
    assertEqual(
      decision.route_package_decision_id,
      routedPackageDecisionId(source.route_package_id),
      `${decision.id} package decision id`,
    );
    assertEqual(
      decision.source_route_status,
      source.route_status,
      `${decision.id} source route status`,
    );
    assertEqual(
      decision.source_package_status,
      source.package_status,
      `${decision.id} source package status`,
    );
    for (const key of [
      "target_reviewer",
      "source_remaining_blocker_plan_artifact",
      "source_remaining_blocker_plan_slice",
      "source_remaining_blocker_item_id",
      "source_track_id",
      "source_blocker_status",
      "source_packaged_follow_up_decision_id",
      "source_decision",
      "source_decision_status",
      "source_package_artifact",
      "source_package_slice",
      "source_package_item_id",
      "source_follow_up_item_id",
      "source_blocker_repair_decision_id",
      "source_repair_item_id",
      "source_follow_up_status",
      "source_repair_status",
      "review_group",
      "decision_owner",
    ]) {
      assertEqual(decision[key], source[key], `${decision.id} ${key}`);
    }
    assertEqual(
      decision.source_package_item_status,
      source.source_package_status,
      `${decision.id} source package item status`,
    );
    optionalEqual(
      decision,
      source,
      "source_runtime_bridge_capture_item_id",
      undefined,
      decision.id,
    );
    optionalEqual(
      decision,
      source,
      "source_capture_status",
      undefined,
      decision.id,
    );
    optionalEqual(
      decision,
      source,
      "source_prerequisite_item_id",
      undefined,
      decision.id,
    );
    optionalEqual(
      decision,
      source,
      "source_prerequisite_status",
      undefined,
      decision.id,
    );
    assertEqual(decision.decision, "needs_followup", `${decision.id} decision`);
    assertEqual(
      decision.decision_status,
      "reviewed_routed_blocker_needs_followup_not_accepted",
      `${decision.id} decision status`,
    );
    assertEqual(decision.accepted, false, `${decision.id} accepted`);
    assertEqual(decision.implemented, false, `${decision.id} implemented`);
    assertEqual(
      decision.route_package_reviewed,
      true,
      `${decision.id} route package reviewed`,
    );
    assertEqual(
      decision.routed_item_reviewed,
      true,
      `${decision.id} routed item reviewed`,
    );
    assertDeepEqual(
      decision.remaining_acceptance_blockers,
      source.acceptance_blockers,
      `${decision.id} blockers`,
    );
    assertCondition(
      decision.remaining_acceptance_blockers.length > 0,
      `${decision.id} remaining blockers present`,
    );
    assertCondition(
      decision.evidence_refs.some((ref) => ref.includes(source.id)),
      `${decision.id} source routed evidence ref`,
    );
    assertCondition(
      decision.evidence_refs.some((ref) =>
        ref.includes(source.source_remaining_blocker_item_id),
      ),
      `${decision.id} source blocker evidence ref`,
    );
  }
}

function validateCrossCuttingDecisions(
  decisionRecord,
  routingArtifact,
  adr0012Text,
) {
  const decisions = decisionRecord.cross_cutting_decision_items;
  const sourceRoutesById = mapById(routingArtifact.cross_cutting_routes);
  assertDeepEqual(
    sorted(decisions.map((item) => item.source_cross_cutting_route_id)),
    sorted(routingArtifact.cross_cutting_routes.map((item) => item.id)),
    "cross-cutting source route ids",
  );

  for (const decision of decisions) {
    const source = sourceRoutesById.get(decision.source_cross_cutting_route_id);
    assertCondition(Boolean(source), `${decision.id} source cross route`);
    assertEqual(
      decision.id,
      crossRouteDecisionId(source.id),
      `${decision.id} cross decision id`,
    );
    assertEqual(
      decision.source_route_status,
      source.route_status,
      `${decision.id} route status`,
    );
    assertEqual(
      decision.source_blocker_status,
      source.blocker_status,
      `${decision.id} blocker status`,
    );
    assertEqual(decision.accepted, false, `${decision.id} accepted`);
    assertEqual(decision.implemented, false, `${decision.id} implemented`);
    assertDeepEqual(
      decision.evidence_refs,
      source.evidence_refs,
      `${decision.id} evidence refs`,
    );
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

function validateA8DecisionContext(decisionRecord, routingArtifact) {
  const context = decisionRecord.a8_phase_conformance_decision_context;
  const source = routingArtifact.a8_phase_conformance_routing;
  assertEqual(
    context.source_route_package_id,
    source.route_package_id,
    "A8 source route package",
  );
  assertEqual(context.decision, "needs_followup", "A8 decision");
  assertEqual(
    context.decision_status,
    "reviewed_routed_package_needs_followup_not_accepted",
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
    assertEqual(row.decision, "needs_followup", `${row.id} decision`);
    assertEqual(
      row.decision_status,
      "reviewed_routed_package_needs_followup_not_accepted",
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

function validateSummary(decisionRecord, routingArtifact) {
  const packageDecisions = decisionRecord.route_package_decision_items;
  const blockerDecisions = decisionRecord.routed_blocker_decision_items;
  const crossDecisions = decisionRecord.cross_cutting_decision_items;
  const acceptedItems = [...packageDecisions, ...blockerDecisions].filter(
    (item) => item.accepted === true || item.decision === "accepted",
  );
  const rejectedItems = [...packageDecisions, ...blockerDecisions].filter(
    (item) => item.decision === "rejected",
  );
  const implementedItems = [...packageDecisions, ...blockerDecisions].filter(
    (item) => item.implemented === true,
  );

  assertEqual(
    decisionRecord.summary.route_package_decision_count,
    packageDecisions.length,
    "summary package decisions",
  );
  assertEqual(
    decisionRecord.summary.routed_blocker_decision_count,
    blockerDecisions.length,
    "summary blocker decisions",
  );
  assertEqual(
    decisionRecord.summary.stream_routed_blocker_decision_items,
    countBy(
      blockerDecisions,
      (item) =>
        item.route_package_id === "ROUTE-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
    ),
    "summary stream blocker decisions",
  );
  assertEqual(
    decisionRecord.summary.runtime_ux_routed_blocker_decision_items,
    countBy(
      blockerDecisions,
      (item) =>
        item.route_package_id ===
        "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
    ),
    "summary runtime blocker decisions",
  );
  assertEqual(
    decisionRecord.summary.git_history_routed_blocker_decision_items,
    countBy(
      blockerDecisions,
      (item) => item.route_package_id === "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
    ),
    "summary Git-history blocker decisions",
  );
  assertEqual(
    decisionRecord.summary.accepted_items,
    acceptedItems.length,
    "summary accepted",
  );
  assertEqual(
    decisionRecord.summary.rejected_items,
    rejectedItems.length,
    "summary rejected",
  );
  assertEqual(
    decisionRecord.summary.implemented_items,
    implementedItems.length,
    "summary implemented",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_route_package_decisions,
    countBy(packageDecisions, (item) => item.decision === "needs_followup"),
    "summary package needs-followup",
  );
  assertEqual(
    decisionRecord.summary.needs_followup_routed_blocker_decisions,
    countBy(blockerDecisions, (item) => item.decision === "needs_followup"),
    "summary blocker needs-followup",
  );
  assertEqual(
    decisionRecord.summary.source_route_packages,
    routingArtifact.target_route_packages.length,
    "summary source packages",
  );
  assertEqual(
    decisionRecord.summary.source_routed_blocker_items,
    routingArtifact.routed_blocker_items.length,
    "summary source routed items",
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
    routingArtifact.summary.runtime_harness_8_2_trigger_count,
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
    ["W1.5.227"],
    "next recommended slices",
  );
}

function validateA4A8RoutedBlockerPackageDecisionRecord(options = {}) {
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const routingArtifact = readJson(options.routingPath ?? routingPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );
  const adr0012Text = readText(options.adr0012Path ?? adr0012Path);

  assertSanitizedJson(
    decisionRecord,
    "A4/A8 routed blocker package decision record",
  );
  assertEqual(decisionRecord.schema_version, "0.1.0", "schema version");
  assertEqual(decisionRecord.milestone, "M1.5", "milestone");
  assertEqual(decisionRecord.slice, "W1.5.226", "slice id");
  assertEqual(
    decisionRecord.decision_record_status,
    "a4_a8_routed_blocker_package_decisions_recorded_needs_followup_not_accepted",
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
    decisionRecord.reviewer_contract.allowed_package_decisions,
    ["accepted", "rejected", "needs_followup"],
    "allowed package decisions",
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

  validateSourceRouting(routingArtifact);
  validateLedgerAndPackageWiring(
    decisionRecord,
    readinessLedger,
    desktopPackage,
  );
  validateRoutePackageDecisions(decisionRecord, routingArtifact);
  validateRoutedBlockerDecisions(decisionRecord, routingArtifact);
  validateCrossCuttingDecisions(decisionRecord, routingArtifact, adr0012Text);
  validateA8DecisionContext(decisionRecord, routingArtifact);
  validateSummary(decisionRecord, routingArtifact);

  return {
    status: decisionRecord.decision_record_status,
    exitP1_1Status: decisionRecord.exit_p1_1_status,
    exitP1_10Status: decisionRecord.exit_p1_10_status,
    routePackageDecisionCount:
      decisionRecord.summary.route_package_decision_count,
    routedBlockerDecisionCount:
      decisionRecord.summary.routed_blocker_decision_count,
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
    needsFollowupRoutePackageDecisionCount:
      decisionRecord.summary.needs_followup_route_package_decisions,
    needsFollowupRoutedBlockerDecisionCount:
      decisionRecord.summary.needs_followup_routed_blocker_decisions,
    implementedItemCount: decisionRecord.summary.implemented_items,
    reviewedRoutePackageCount: decisionRecord.summary.reviewed_route_packages,
    reviewedRoutedBlockerItemCount:
      decisionRecord.summary.reviewed_routed_blocker_items,
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
    sourceRoutePackageIds: decisionRecord.route_package_decision_items.map(
      (item) => item.source_route_package_id,
    ),
    sourceRoutedBlockerItemIds:
      decisionRecord.routed_blocker_decision_items.map(
        (item) => item.source_routed_blocker_item_id,
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
  const summary = validateA4A8RoutedBlockerPackageDecisionRecord();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4A8RoutedBlockerPackageDecisionRecord,
};
