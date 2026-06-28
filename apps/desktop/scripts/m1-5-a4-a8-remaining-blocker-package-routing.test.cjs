const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4A8RemainingBlockerPackageRouting,
} = require("./m1-5-a4-a8-remaining-blocker-package-routing.cjs");

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
const expectedDeferredTriggerIds = [
  "human_gate_resolved",
  "memory_json_write",
  "repair_patch_applied",
  "workflow_draft_instantiated",
  "workflow_manual_edit_saved",
  "workflow_patch_applied_draft",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeJsonTemp(prefix, fileName, value) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const tempPath = path.join(tempDir, fileName);
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  return tempPath;
}

function writeMutatedRouting(mutator) {
  const routing = readJson(routingPath);
  mutator(routing);
  return writeJsonTemp("cw-a4-a8-routing-", "routing.json", routing);
}

function writeMutatedSourcePlan(mutator) {
  const sourcePlan = readJson(sourcePlanPath);
  mutator(sourcePlan);
  return writeJsonTemp(
    "cw-a4-a8-routing-source-",
    "source-plan.json",
    sourcePlan,
  );
}

function writeMutatedReadinessLedger(mutator) {
  const readinessLedger = readJson(readinessLedgerPath);
  mutator(readinessLedger);
  return writeJsonTemp(
    "cw-a4-a8-routing-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a4-a8-routing-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A4/A8 remaining blocker package routing returns a conservative summary", () => {
  const summary = validateA4A8RemainingBlockerPackageRouting();

  assert.equal(
    summary.status,
    "a4_a8_remaining_blocker_package_routing_prepared_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.routePackageCount, 3);
  assert.equal(summary.routedBlockerItemCount, 11);
  assert.equal(summary.streamRouteItemCount, 3);
  assert.equal(summary.runtimeUxRouteItemCount, 7);
  assert.equal(summary.gitHistoryRouteItemCount, 1);
  assert.equal(summary.routePackagesNotAcceptedCount, 3);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.routedNotAcceptedItemCount, 11);
  assert.equal(summary.crossCuttingRouteCount, 3);
  assert.equal(summary.blockedNotRoutedRouteCount, 2);
  assert.equal(summary.deferredNotRoutedRouteCount, 1);
  assert.equal(summary.runtimeHarness8_2TriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItemCount, 0);
  assert.deepEqual(
    sorted(summary.routePackageIds),
    sorted(expectedRoutePackageIds),
  );
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.226"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4/A8 remaining blocker package routing maps every W1.5.224 blocker item", () => {
  const routing = readJson(routingPath);
  const sourcePlan = readJson(sourcePlanPath);

  assert.equal(routing.slice, "W1.5.225");
  assert.equal(sourcePlan.slice, "W1.5.224");
  assert.deepEqual(
    sorted(
      routing.routed_blocker_items.map(
        (item) => item.source_remaining_blocker_item_id,
      ),
    ),
    sorted(sourcePlan.remaining_blocker_items.map((item) => item.id)),
  );
  assert.equal(
    routing.routed_blocker_items.every(
      (item) =>
        item.route_status === "routed_to_reviewer_package_not_accepted" &&
        item.package_status === "route_prepared_not_accepted" &&
        item.accepted === false &&
        item.implemented === false &&
        item.package_required === true,
    ),
    true,
  );
});

test("M1.5 A4/A8 remaining blocker package routing preserves target package groups", () => {
  const routing = readJson(routingPath);
  const packagesById = new Map(
    routing.target_route_packages.map((item) => [item.id, item]),
  );

  assert.deepEqual(
    sorted(routing.target_route_packages.map((item) => item.id)),
    sorted(expectedRoutePackageIds),
  );
  assert.deepEqual(
    sorted(packagesById.get("ROUTE-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE").fr_ids),
    ["FR-009", "FR-010", "FR-016"],
  );
  assert.deepEqual(
    sorted(
      packagesById.get("ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE").fr_ids,
    ),
    ["FR-007", "FR-008", "FR-011", "FR-013", "FR-014", "FR-017", "FR-018"],
  );
  assert.deepEqual(
    packagesById.get("ROUTE-PACKAGE-A8-PHASE-CONFORMANCE").fr_ids,
    ["FR-012"],
  );
  assert.equal(
    routing.routed_blocker_items.some((item) => item.fr_id === "FR-015"),
    false,
  );
});

test("M1.5 A4/A8 remaining blocker package routing preserves A8 trigger routing", () => {
  const routing = readJson(routingPath);
  const sourcePlan = readJson(sourcePlanPath);
  const a8 = routing.a8_phase_conformance_routing;

  assert.equal(a8.route_package_id, "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE");
  assert.equal(a8.runtime_harness_8_2_trigger_count, 10);
  assert.equal(a8.evidence_carried_forward_trigger_count, 4);
  assert.equal(a8.explicitly_deferred_trigger_count, 6);
  assert.equal(a8.phase_conformance_accepted_items, 0);
  assert.deepEqual(
    a8.trigger_rows.map((row) => row.id),
    sourcePlan.a8_phase_conformance_plan.trigger_rows.map((row) => row.id),
  );
  assert.deepEqual(sorted(a8.deferred_trigger_ids), expectedDeferredTriggerIds);
  assert.equal(
    a8.trigger_rows.every(
      (row) =>
        row.accepted === false &&
        row.implemented === false &&
        row.route_package_id === "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
    ),
    true,
  );
});

test("M1.5 A4/A8 remaining blocker package routing preserves cross-cutting gates", () => {
  const routing = readJson(routingPath);
  const routesById = new Map(
    routing.cross_cutting_routes.map((item) => [item.id, item]),
  );

  assert.deepEqual(
    routesById.get("CROSS-ROUTE-DEPENDENCY-GATED-DESKTOP-SURFACES")
      .dependency_gate_ids,
    expectedDependencyGateIds,
  );
  assert.equal(
    routesById.get("CROSS-ROUTE-DEPENDENCY-GATED-DESKTOP-SURFACES")
      .route_status,
    "blocked_not_routed",
  );
  assert.equal(
    routesById.get("CROSS-ROUTE-FR-015-CONTRACT-GATE").current_adr_status,
    "Proposed",
  );
  assert.equal(
    routesById.get("CROSS-ROUTE-FR-015-CONTRACT-GATE").route_status,
    "blocked_not_routed",
  );
  assert.equal(
    routesById.get("CROSS-ROUTE-M1-6-DEMO-EVIDENCE").route_status,
    "deferred_not_routed",
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects accepted or implemented drift", () => {
  const mutatedPath = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].accepted = true;
    routing.routed_blocker_items[0].implemented = true;
    routing.target_route_packages[0].package_status = "accepted";
    routing.summary.accepted_items = 1;
    routing.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: mutatedPath,
      }),
    /EXIT-P1-1|accepted|implemented|package status/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects source mapping drift", () => {
  const mutatedPath = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].source_remaining_blocker_item_id =
      "REMAINING-BLOCKER-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: mutatedPath,
      }),
    /source remaining blocker item ids|source item/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects FR-015 or wrong package drift", () => {
  const fr015Path = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].fr_id = "FR-015";
  });
  const wrongPackagePath = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].route_package_id =
      "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE";
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: fr015Path,
      }),
    /FR-015|FR id/u,
  );
  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: wrongPackagePath,
      }),
    /package by source track|FR ids/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: missingBlockerPath,
      }),
    /acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects A8 trigger drift", () => {
  const acceptedRowPath = writeMutatedRouting((routing) => {
    routing.a8_phase_conformance_routing.trigger_rows[0].accepted = true;
  });
  const missingRowPath = writeMutatedRouting((routing) => {
    routing.a8_phase_conformance_routing.trigger_rows.pop();
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: acceptedRowPath,
      }),
    /accepted/u,
  );
  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: missingRowPath,
      }),
    /trigger row order/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects cross-cutting drift", () => {
  const missingDependencyPath = writeMutatedRouting((routing) => {
    routing.cross_cutting_routes = routing.cross_cutting_routes.filter(
      (item) => item.id !== "CROSS-ROUTE-DEPENDENCY-GATED-DESKTOP-SURFACES",
    );
  });
  const wrongFr015Path = writeMutatedRouting((routing) => {
    routing.cross_cutting_routes.find(
      (item) => item.id === "CROSS-ROUTE-FR-015-CONTRACT-GATE",
    ).route_status = "routed_not_accepted";
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: missingDependencyPath,
      }),
    /dependency route|cross route count/u,
  );
  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: wrongFr015Path,
      }),
    /FR-015 route status/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects unsafe metadata and dependency bypass", () => {
  const rawMetadataPath = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].raw_file_content = "unsafe";
    routing.routed_blocker_items[0].custom_value = "unsafe";
  });
  const pathValue = writeMutatedRouting((routing) => {
    routing.routed_blocker_items[0].next_action_refs.push(
      "C:/Users/admin/secret-output/file.md",
    );
  });
  const dependencyBypassPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.dependencies["@xyflow/react"] = "12.0.0";
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: rawMetadataPath,
      }),
    /forbidden fragment/u,
  );
  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        routingPath: pathValue,
      }),
    /forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        desktopPackagePath: dependencyBypassPath,
      }),
    /must stay out of package\.json before dependency gate/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing rejects source plan acceptance drift", () => {
  const sourcePlanPath = writeMutatedSourcePlan((sourcePlan) => {
    sourcePlan.remaining_blocker_items[0].accepted = true;
    sourcePlan.summary.accepted_items = 1;
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        sourcePlanPath,
      }),
    /source accepted items|accepted/u,
  );
});

test("M1.5 A4/A8 remaining blocker package routing tolerates future ledger slices with retained evidence", () => {
  const futureLedgerPath = writeMutatedReadinessLedger((readinessLedger) => {
    readinessLedger.slice = "W1.5.226";
    readinessLedger.next_recommended_slices = [
      {
        id: "W1.5.227",
        title: "future slice",
        reason: "W1.5.225 evidence retained while later ledger advances.",
      },
    ];
  });

  const summary = validateA4A8RemainingBlockerPackageRouting({
    readinessLedgerPath: futureLedgerPath,
  });

  assert.equal(summary.routedBlockerItemCount, 11);
});

test("M1.5 A4/A8 remaining blocker package routing validator rejects missing package gate wiring", () => {
  const missingWiringPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.scripts.test = desktopPackage.scripts.test.replace(
      " scripts/m1-5-a4-a8-remaining-blocker-package-routing.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA4A8RemainingBlockerPackageRouting({
        desktopPackagePath: missingWiringPath,
      }),
    /desktop package gate wiring/u,
  );
});
