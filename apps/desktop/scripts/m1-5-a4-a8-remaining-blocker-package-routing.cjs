const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const routingPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-remaining-blocker-package-routing.json",
);
const sourcePlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-remaining-acceptance-blocker-plan.json",
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
const expectedPackageByTrack = {
  "TRACK-A4-STREAM-FINAL-ACCEPTANCE-BLOCKERS":
    "ROUTE-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
  "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE-BLOCKERS":
    "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  "TRACK-A8-PHASE-CONFORMANCE-BLOCKERS": "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
};
const expectedFrIdsByPackage = {
  "ROUTE-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE": ["FR-009", "FR-010", "FR-016"],
  "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE": [
    "FR-007",
    "FR-008",
    "FR-011",
    "FR-013",
    "FR-014",
    "FR-017",
    "FR-018",
  ],
  "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE": ["FR-012"],
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

function validateLedgerAndPackageWiring(
  routingArtifact,
  readinessLedger,
  desktopPackage,
) {
  assertSliceAtLeast(
    readinessLedger.slice,
    "W1.5.225",
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
  if (readinessLedger.slice === "W1.5.225") {
    assertDeepEqual(
      readinessLedger.next_recommended_slices.map((slice) => slice.id),
      ["W1.5.226"],
      "readiness ledger next recommended slices",
    );
  } else {
    assertCondition(
      JSON.stringify(readinessLedger).includes("W1.5.225"),
      "future readiness ledger must retain W1.5.225 evidence",
    );
  }
  assertCondition(
    desktopPackage.scripts?.test?.includes(
      "scripts/m1-5-a4-a8-remaining-blocker-package-routing.test.cjs",
    ),
    "desktop package gate wiring",
  );
  const desktopPackageVersions = collectDesktopPackageVersions(desktopPackage);
  const dependencyGates =
    readinessLedger.dependency_boundary.requires_separate_gate;
  assertDeepEqual(
    dependencyGates.map((gate) => gate.id),
    expectedDependencyGateIds,
    "dependency gate ids",
  );
  for (const gate of dependencyGates) {
    for (const packageName of gate.packages) {
      assertEqual(
        desktopPackageVersions.has(packageName),
        false,
        `${packageName} must stay out of package.json before dependency gate`,
      );
    }
  }
  assertDeepEqual(
    routingArtifact.routing_contract.reviewers,
    ["A4 ux-acceptance-reviewer", "A8 git-history-auditor"],
    "routing reviewers",
  );
}

function validateTargetRoutePackages(routingArtifact, sourcePlan) {
  const packages = routingArtifact.target_route_packages;
  const packagesById = mapById(packages);
  const sourceTracksById = mapById(sourcePlan.remaining_blocker_tracks);

  assertDeepEqual(
    sorted(packages.map((item) => item.id)),
    sorted(expectedRoutePackageIds),
    "target route package ids",
  );

  for (const routePackage of packages) {
    const sourceTrack = sourceTracksById.get(routePackage.source_track_id);
    const expectedPackageId =
      expectedPackageByTrack[routePackage.source_track_id];
    assertCondition(Boolean(sourceTrack), `${routePackage.id} source track`);
    assertEqual(
      routePackage.id,
      expectedPackageId,
      `${routePackage.id} package by source track`,
    );
    assertEqual(
      routePackage.source_track_status,
      sourceTrack.status,
      `${routePackage.id} source track status`,
    );
    assertEqual(
      routePackage.package_status,
      "route_prepared_not_accepted",
      `${routePackage.id} package status`,
    );
    assertEqual(
      routePackage.route_status,
      "routed_not_accepted",
      `${routePackage.id} route status`,
    );
    assertEqual(routePackage.accepted, false, `${routePackage.id} accepted`);
    assertEqual(
      routePackage.implemented,
      false,
      `${routePackage.id} implemented`,
    );
    assertDeepEqual(
      sorted(routePackage.fr_ids),
      sorted(expectedFrIdsByPackage[routePackage.id]),
      `${routePackage.id} FR ids`,
    );
    assertEqual(
      routePackage.source_item_count,
      routePackage.routed_item_ids.length,
      `${routePackage.id} routed item count`,
    );
    assertCondition(
      routePackage.evidence_refs.some((ref) =>
        ref.includes(routePackage.source_track_id),
      ),
      `${routePackage.id} source track evidence ref`,
    );
    assertCondition(
      routePackage.next_action_refs.length > 0,
      `${routePackage.id} next action refs`,
    );
  }
  assertCondition(
    packagesById.has("ROUTE-PACKAGE-A8-PHASE-CONFORMANCE"),
    "A8 route package present",
  );
}

function validateRoutedBlockerItems(routingArtifact, sourcePlan) {
  const routedItems = routingArtifact.routed_blocker_items;
  const sourceItemsById = mapById(sourcePlan.remaining_blocker_items);
  const packagesById = mapById(routingArtifact.target_route_packages);

  assertEqual(
    routedItems.length,
    sourcePlan.remaining_blocker_items.length,
    "routed item count",
  );
  assertDeepEqual(
    sorted(routedItems.map((item) => item.source_remaining_blocker_item_id)),
    sorted(sourcePlan.remaining_blocker_items.map((item) => item.id)),
    "source remaining blocker item ids",
  );
  assertCondition(
    !routedItems.some((item) => item.fr_id === "FR-015"),
    "FR-015 must stay out of routed blocker items",
  );

  for (const routedItem of routedItems) {
    const sourceItem = sourceItemsById.get(
      routedItem.source_remaining_blocker_item_id,
    );
    const routePackage = packagesById.get(routedItem.route_package_id);
    assertCondition(Boolean(sourceItem), `${routedItem.id} source item`);
    assertCondition(Boolean(routePackage), `${routedItem.id} route package`);
    assertEqual(
      routedItem.source_remaining_blocker_plan_slice,
      "W1.5.224",
      `${routedItem.id} source slice`,
    );
    assertEqual(
      routedItem.route_status,
      "routed_to_reviewer_package_not_accepted",
      `${routedItem.id} route status`,
    );
    assertEqual(
      routedItem.package_status,
      "route_prepared_not_accepted",
      `${routedItem.id} package status`,
    );
    assertEqual(routedItem.accepted, false, `${routedItem.id} accepted`);
    assertEqual(routedItem.implemented, false, `${routedItem.id} implemented`);
    assertEqual(
      routedItem.follow_up_required,
      true,
      `${routedItem.id} follow-up required`,
    );
    assertEqual(
      routedItem.package_required,
      true,
      `${routedItem.id} package required`,
    );
    assertEqual(routedItem.fr_id, sourceItem.fr_id, `${routedItem.id} FR id`);
    assertEqual(
      routedItem.source_track_id,
      sourceItem.track_id,
      `${routedItem.id} source track`,
    );
    assertEqual(
      routedItem.route_package_id,
      expectedPackageByTrack[sourceItem.track_id],
      `${routedItem.id} package by source track`,
    );
    assertEqual(
      routedItem.source_blocker_status,
      sourceItem.blocker_status,
      `${routedItem.id} source blocker status`,
    );
    assertEqual(
      routedItem.source_blocker_status,
      "planned_not_implemented",
      `${routedItem.id} source planned status`,
    );
    for (const key of [
      "source_packaged_follow_up_decision_id",
      "source_decision",
      "source_decision_status",
      "source_package_artifact",
      "source_package_slice",
      "source_package_item_id",
      "source_package_status",
      "source_follow_up_item_id",
      "source_blocker_repair_decision_id",
      "source_repair_item_id",
      "source_follow_up_status",
      "source_repair_status",
      "review_group",
      "decision_owner",
    ]) {
      assertEqual(routedItem[key], sourceItem[key], `${routedItem.id} ${key}`);
    }
    optionalEqual(
      routedItem,
      sourceItem,
      "source_runtime_bridge_capture_item_id",
      routedItem.id,
    );
    optionalEqual(
      routedItem,
      sourceItem,
      "source_capture_status",
      routedItem.id,
    );
    optionalEqual(
      routedItem,
      sourceItem,
      "source_prerequisite_item_id",
      routedItem.id,
    );
    optionalEqual(
      routedItem,
      sourceItem,
      "source_prerequisite_status",
      routedItem.id,
    );
    assertDeepEqual(
      routedItem.acceptance_blockers,
      sourceItem.acceptance_blockers,
      `${routedItem.id} acceptance blockers`,
    );
    assertCondition(
      routedItem.acceptance_blockers.length > 0,
      `${routedItem.id} acceptance blockers present`,
    );
    assertCondition(
      routedItem.required_actions.length > 0,
      `${routedItem.id} required actions`,
    );
    assertCondition(
      routedItem.next_action_refs.length > 0,
      `${routedItem.id} next action refs`,
    );
    assertCondition(
      routedItem.evidence_refs.some((ref) =>
        ref.includes(routedItem.source_remaining_blocker_item_id),
      ),
      `${routedItem.id} source blocker evidence ref`,
    );
    assertCondition(
      routedItem.evidence_refs.some((ref) =>
        ref.includes(routedItem.source_packaged_follow_up_decision_id),
      ),
      `${routedItem.id} source decision evidence ref`,
    );
  }
}

function validateA8Routing(routingArtifact, sourcePlan) {
  const routing = routingArtifact.a8_phase_conformance_routing;
  const source = sourcePlan.a8_phase_conformance_plan;

  assertEqual(
    routing.route_package_id,
    "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
    "A8 route package",
  );
  assertEqual(routing.route_status, "routed_not_accepted", "A8 route status");
  assertEqual(
    routing.phase_exit_decision_status,
    "not_ready",
    "A8 phase exit status",
  );
  assertEqual(
    routing.runtime_harness_8_2_trigger_count,
    source.runtime_harness_8_2_trigger_count,
    "A8 trigger count",
  );
  assertEqual(
    routing.evidence_carried_forward_trigger_count,
    source.evidence_carried_forward_trigger_count,
    "A8 carried-forward count",
  );
  assertEqual(
    routing.explicitly_deferred_trigger_count,
    source.explicitly_deferred_trigger_count,
    "A8 deferred count",
  );
  assertEqual(routing.phase_conformance_accepted_items, 0, "A8 accepted count");
  assertDeepEqual(
    sorted(routing.carried_forward_trigger_ids),
    expectedCarriedForwardTriggerIds,
    "A8 carried-forward ids",
  );
  assertDeepEqual(
    sorted(routing.deferred_trigger_ids),
    expectedDeferredTriggerIds,
    "A8 deferred ids",
  );
  assertDeepEqual(
    routing.trigger_rows.map((row) => row.id),
    source.trigger_rows.map((row) => row.id),
    "A8 trigger row order",
  );
  for (const row of routing.trigger_rows) {
    assertEqual(row.accepted, false, `${row.id} accepted`);
    assertEqual(row.implemented, false, `${row.id} implemented`);
    assertEqual(
      row.route_package_id,
      "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
      `${row.id} route package`,
    );
    if (row.blocker_status === "needs_phase_acceptance") {
      assertEqual(
        row.route_status,
        "routed_for_a8_phase_acceptance_not_accepted",
        `${row.id} carried-forward route status`,
      );
    } else {
      assertEqual(
        row.blocker_status,
        "deferred_not_implemented",
        `${row.id} deferred blocker status`,
      );
      assertEqual(
        row.route_status,
        "routed_for_future_implementation_or_formal_deferral_not_accepted",
        `${row.id} deferred route status`,
      );
    }
  }
}

function validateCrossCuttingRoutes(routingArtifact, sourcePlan, adr0012Text) {
  const routesById = mapById(routingArtifact.cross_cutting_routes);
  const sourceBlockersById = mapById(sourcePlan.cross_cutting_blockers);
  const dependencyRoute = routesById.get(
    "CROSS-ROUTE-DEPENDENCY-GATED-DESKTOP-SURFACES",
  );
  const fr015Route = routesById.get("CROSS-ROUTE-FR-015-CONTRACT-GATE");
  const m16Route = routesById.get("CROSS-ROUTE-M1-6-DEMO-EVIDENCE");

  assertCondition(Boolean(dependencyRoute), "dependency route");
  assertCondition(Boolean(fr015Route), "FR-015 route");
  assertCondition(Boolean(m16Route), "M1.6 route");
  assertEqual(
    dependencyRoute.route_status,
    "blocked_not_routed",
    "dependency route status",
  );
  assertDeepEqual(
    dependencyRoute.dependency_gate_ids,
    expectedDependencyGateIds,
    "dependency route gate ids",
  );
  assertEqual(
    fr015Route.route_status,
    "blocked_not_routed",
    "FR-015 route status",
  );
  assertEqual(
    fr015Route.blocker_status,
    "blocked_by_contract_gate",
    "FR-015 blocker status",
  );
  assertEqual(fr015Route.current_adr_status, "Proposed", "FR-015 ADR status");
  assertCondition(
    /\|\s*Status\s*\|\s*Proposed\s*\|/u.test(adr0012Text),
    "ADR-0012 must remain Proposed for package routing",
  );
  assertEqual(
    m16Route.route_status,
    "deferred_not_routed",
    "M1.6 route status",
  );
  assertDeepEqual(
    m16Route.exit_ids,
    ["EXIT-P1-2", "EXIT-P1-3", "EXIT-P1-11"],
    "M1.6 exit ids",
  );
  for (const route of routingArtifact.cross_cutting_routes) {
    const sourceBlocker = sourceBlockersById.get(
      route.source_cross_cutting_blocker_id,
    );
    assertCondition(Boolean(sourceBlocker), `${route.id} source blocker`);
    assertEqual(route.accepted, false, `${route.id} accepted`);
    assertEqual(route.implemented, false, `${route.id} implemented`);
    assertEqual(
      route.follow_up_required,
      true,
      `${route.id} follow-up required`,
    );
    assertEqual(
      route.source_track_id,
      sourceBlocker.track_id,
      `${route.id} source track`,
    );
    assertCondition(route.evidence_refs.length > 0, `${route.id} evidence`);
    assertCondition(
      route.required_actions.length > 0,
      `${route.id} required actions`,
    );
  }
}

function validateSummary(routingArtifact, sourcePlan) {
  const routePackages = routingArtifact.target_route_packages;
  const routedItems = routingArtifact.routed_blocker_items;
  const crossRoutes = routingArtifact.cross_cutting_routes;

  assertEqual(
    routingArtifact.summary.route_package_count,
    routePackages.length,
    "summary route package count",
  );
  assertEqual(
    routingArtifact.summary.routed_blocker_item_count,
    routedItems.length,
    "summary routed item count",
  );
  assertEqual(
    routingArtifact.summary.stream_route_items,
    countBy(
      routedItems,
      (item) =>
        item.route_package_id === "ROUTE-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
    ),
    "summary stream route count",
  );
  assertEqual(
    routingArtifact.summary.runtime_ux_route_items,
    countBy(
      routedItems,
      (item) =>
        item.route_package_id ===
        "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
    ),
    "summary runtime route count",
  );
  assertEqual(
    routingArtifact.summary.git_history_route_items,
    countBy(
      routedItems,
      (item) => item.route_package_id === "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
    ),
    "summary A8 route count",
  );
  assertEqual(
    routingArtifact.summary.route_packages_not_accepted,
    countBy(
      routePackages,
      (item) => item.package_status === "route_prepared_not_accepted",
    ),
    "summary route package not accepted count",
  );
  assertEqual(routingArtifact.summary.accepted_items, 0, "summary accepted");
  assertEqual(
    routingArtifact.summary.implemented_items,
    0,
    "summary implemented",
  );
  assertEqual(
    routingArtifact.summary.routed_not_accepted_items,
    countBy(
      routedItems,
      (item) => item.route_status === "routed_to_reviewer_package_not_accepted",
    ),
    "summary routed-not-accepted count",
  );
  assertEqual(
    routingArtifact.summary.source_remaining_blocker_items,
    sourcePlan.summary.remaining_blocker_item_count,
    "summary source blocker count",
  );
  assertEqual(
    routingArtifact.summary.source_planned_not_implemented_items,
    sourcePlan.summary.planned_not_implemented_items,
    "summary source planned count",
  );
  assertEqual(
    routingArtifact.summary.source_cross_cutting_blocker_items,
    sourcePlan.summary.cross_cutting_blocker_items,
    "summary source cross-cutting count",
  );
  assertEqual(
    routingArtifact.summary.cross_cutting_routes,
    crossRoutes.length,
    "summary cross route count",
  );
  assertEqual(
    routingArtifact.summary.blocked_not_routed_routes,
    countBy(crossRoutes, (item) => item.route_status === "blocked_not_routed"),
    "summary blocked route count",
  );
  assertEqual(
    routingArtifact.summary.deferred_not_routed_routes,
    countBy(crossRoutes, (item) => item.route_status === "deferred_not_routed"),
    "summary deferred route count",
  );
  assertEqual(
    routingArtifact.summary.runtime_harness_8_2_trigger_count,
    sourcePlan.summary.runtime_harness_8_2_trigger_count,
    "summary A8 trigger count",
  );
  assertEqual(
    routingArtifact.summary.evidence_carried_forward_trigger_count,
    expectedCarriedForwardTriggerIds.length,
    "summary carried-forward count",
  );
  assertEqual(
    routingArtifact.summary.explicitly_deferred_trigger_count,
    expectedDeferredTriggerIds.length,
    "summary deferred count",
  );
  assertEqual(
    routingArtifact.summary.phase_conformance_accepted_items,
    0,
    "summary A8 accepted count",
  );
  assertEqual(
    routingArtifact.summary.excluded_items,
    routingArtifact.excluded_items.length,
    "summary excluded count",
  );
  assertEqual(
    routingArtifact.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1",
  );
  assertEqual(
    routingArtifact.summary.exit_p1_10_status,
    "not_ready",
    "summary EXIT-P1-10",
  );
  assertDeepEqual(
    routingArtifact.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.226"],
    "next recommended slices",
  );
}

function validateA4A8RemainingBlockerPackageRouting(options = {}) {
  const routingArtifact = readJson(options.routingPath ?? routingPath);
  const sourcePlan = readJson(options.sourcePlanPath ?? sourcePlanPath);
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );
  const adr0012Text = readText(options.adr0012Path ?? adr0012Path);

  assertSanitizedJson(routingArtifact, "A4/A8 remaining blocker routing");
  assertEqual(routingArtifact.schema_version, "0.1.0", "schema version");
  assertEqual(routingArtifact.milestone, "M1.5", "milestone");
  assertEqual(routingArtifact.slice, "W1.5.225", "slice id");
  assertEqual(
    routingArtifact.package_routing_status,
    "a4_a8_remaining_blocker_package_routing_prepared_not_accepted",
    "package routing status",
  );
  assertEqual(routingArtifact.exit_p1_1_status, "not_ready", "EXIT-P1-1");
  assertEqual(routingArtifact.exit_p1_10_status, "not_ready", "EXIT-P1-10");
  assertEqual(sourcePlan.slice, "W1.5.224", "source plan slice");
  assertEqual(
    sourcePlan.plan_status,
    "remaining_acceptance_blocker_plan_prepared_not_implemented",
    "source plan status",
  );
  assertEqual(sourcePlan.summary.accepted_items, 0, "source accepted items");
  assertEqual(
    sourcePlan.summary.implemented_items,
    0,
    "source implemented items",
  );
  assertEqual(
    routingArtifact.routing_contract.route_packages_must_remain_not_accepted,
    true,
    "route package guard",
  );
  assertEqual(
    routingArtifact.routing_contract.runner_script,
    "apps/desktop/scripts/m1-5-a4-a8-remaining-blocker-package-routing.cjs",
    "runner script",
  );
  assertEqual(
    routingArtifact.routing_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-a8-remaining-blocker-package-routing.cjs --check",
    "focused check",
  );
  assertEqual(
    routingArtifact.routing_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-a8-remaining-blocker-package-routing.test.cjs",
    "focused test",
  );

  validateLedgerAndPackageWiring(
    routingArtifact,
    readinessLedger,
    desktopPackage,
  );
  validateTargetRoutePackages(routingArtifact, sourcePlan);
  validateRoutedBlockerItems(routingArtifact, sourcePlan);
  validateA8Routing(routingArtifact, sourcePlan);
  validateCrossCuttingRoutes(routingArtifact, sourcePlan, adr0012Text);
  validateSummary(routingArtifact, sourcePlan);

  return {
    status: routingArtifact.package_routing_status,
    exitP1_1Status: routingArtifact.exit_p1_1_status,
    exitP1_10Status: routingArtifact.exit_p1_10_status,
    routePackageCount: routingArtifact.summary.route_package_count,
    routedBlockerItemCount: routingArtifact.summary.routed_blocker_item_count,
    streamRouteItemCount: routingArtifact.summary.stream_route_items,
    runtimeUxRouteItemCount: routingArtifact.summary.runtime_ux_route_items,
    gitHistoryRouteItemCount: routingArtifact.summary.git_history_route_items,
    routePackagesNotAcceptedCount:
      routingArtifact.summary.route_packages_not_accepted,
    acceptedItemCount: routingArtifact.summary.accepted_items,
    implementedItemCount: routingArtifact.summary.implemented_items,
    routedNotAcceptedItemCount:
      routingArtifact.summary.routed_not_accepted_items,
    crossCuttingRouteCount: routingArtifact.summary.cross_cutting_routes,
    blockedNotRoutedRouteCount:
      routingArtifact.summary.blocked_not_routed_routes,
    deferredNotRoutedRouteCount:
      routingArtifact.summary.deferred_not_routed_routes,
    runtimeHarness8_2TriggerCount:
      routingArtifact.summary.runtime_harness_8_2_trigger_count,
    evidenceCarriedForwardTriggerCount:
      routingArtifact.summary.evidence_carried_forward_trigger_count,
    explicitlyDeferredTriggerCount:
      routingArtifact.summary.explicitly_deferred_trigger_count,
    phaseConformanceAcceptedItemCount:
      routingArtifact.summary.phase_conformance_accepted_items,
    routePackageIds: routingArtifact.target_route_packages.map(
      (item) => item.id,
    ),
    crossCuttingRouteIds: routingArtifact.cross_cutting_routes.map(
      (item) => item.id,
    ),
    nextRecommendedSlices: routingArtifact.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4A8RemainingBlockerPackageRouting();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  validateA4A8RemainingBlockerPackageRouting,
};
