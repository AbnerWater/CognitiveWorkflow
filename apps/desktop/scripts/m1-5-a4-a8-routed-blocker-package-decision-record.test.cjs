const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4A8RoutedBlockerPackageDecisionRecord,
} = require("./m1-5-a4-a8-routed-blocker-package-decision-record.cjs");

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
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedRoutePackageIds = [
  "ROUTE-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
  "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  "ROUTE-PACKAGE-A8-PHASE-CONFORMANCE",
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

function writeMutatedDecisionRecord(mutator) {
  const decisionRecord = readJson(decisionRecordPath);
  mutator(decisionRecord);
  return writeJsonTemp(
    "cw-a4-a8-routed-decision-",
    "decision-record.json",
    decisionRecord,
  );
}

function writeMutatedRouting(mutator) {
  const routing = readJson(routingPath);
  mutator(routing);
  return writeJsonTemp("cw-a4-a8-routed-source-", "routing.json", routing);
}

function writeMutatedReadinessLedger(mutator) {
  const readinessLedger = readJson(readinessLedgerPath);
  mutator(readinessLedger);
  return writeJsonTemp(
    "cw-a4-a8-routed-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a4-a8-routed-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A4/A8 routed blocker package decision record returns a conservative summary", () => {
  const summary = validateA4A8RoutedBlockerPackageDecisionRecord();

  assert.equal(
    summary.status,
    "a4_a8_routed_blocker_package_decisions_recorded_needs_followup_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.routePackageDecisionCount, 3);
  assert.equal(summary.routedBlockerDecisionCount, 11);
  assert.equal(summary.streamPackageDecisionItemCount, 1);
  assert.equal(summary.runtimeUxPackageDecisionItemCount, 1);
  assert.equal(summary.gitHistoryPackageDecisionItemCount, 1);
  assert.equal(summary.streamRoutedBlockerDecisionItemCount, 3);
  assert.equal(summary.runtimeUxRoutedBlockerDecisionItemCount, 7);
  assert.equal(summary.gitHistoryRoutedBlockerDecisionItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.rejectedItemCount, 0);
  assert.equal(summary.needsFollowupRoutePackageDecisionCount, 3);
  assert.equal(summary.needsFollowupRoutedBlockerDecisionCount, 11);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.reviewedRoutePackageCount, 3);
  assert.equal(summary.reviewedRoutedBlockerItemCount, 11);
  assert.equal(summary.crossCuttingDecisionCount, 3);
  assert.equal(summary.blockedCrossCuttingDecisionCount, 2);
  assert.equal(summary.deferredCrossCuttingDecisionCount, 1);
  assert.equal(summary.runtimeHarness8_2TriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItemCount, 0);
  assert.deepEqual(
    sorted(summary.sourceRoutePackageIds),
    sorted(expectedRoutePackageIds),
  );
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.227"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4/A8 routed blocker package decision record maps W1.5.225 packages and blockers", () => {
  const record = readJson(decisionRecordPath);
  const routing = readJson(routingPath);

  assert.equal(record.slice, "W1.5.226");
  assert.equal(routing.slice, "W1.5.225");
  assert.deepEqual(
    sorted(
      record.route_package_decision_items.map(
        (item) => item.source_route_package_id,
      ),
    ),
    sorted(routing.target_route_packages.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(
      record.routed_blocker_decision_items.map(
        (item) => item.source_routed_blocker_item_id,
      ),
    ),
    sorted(routing.routed_blocker_items.map((item) => item.id)),
  );
});

test("M1.5 A4/A8 routed blocker package decision record keeps decisions as needs_followup", () => {
  const record = readJson(decisionRecordPath);

  assert.equal(
    record.route_package_decision_items.every(
      (item) =>
        item.decision === "needs_followup" &&
        item.decision_status ===
          "reviewed_routed_package_needs_followup_not_accepted" &&
        item.accepted === false &&
        item.implemented === false &&
        item.route_package_reviewed === true,
    ),
    true,
  );
  assert.equal(
    record.routed_blocker_decision_items.every(
      (item) =>
        item.decision === "needs_followup" &&
        item.decision_status ===
          "reviewed_routed_blocker_needs_followup_not_accepted" &&
        item.accepted === false &&
        item.implemented === false &&
        item.routed_item_reviewed === true,
    ),
    true,
  );
});

test("M1.5 A4/A8 routed blocker package decision record preserves cross-cutting decisions", () => {
  const record = readJson(decisionRecordPath);
  const decisionsById = new Map(
    record.cross_cutting_decision_items.map((item) => [item.id, item]),
  );

  assert.equal(
    decisionsById.get("CROSS-ROUTE-DECISION-DEPENDENCY-GATED-DESKTOP-SURFACES")
      .decision,
    "blocked",
  );
  assert.equal(
    decisionsById.get("CROSS-ROUTE-DECISION-FR-015-CONTRACT-GATE")
      .current_adr_status,
    "Proposed",
  );
  assert.equal(
    decisionsById.get("CROSS-ROUTE-DECISION-FR-015-CONTRACT-GATE").decision,
    "blocked",
  );
  assert.equal(
    decisionsById.get("CROSS-ROUTE-DECISION-M1-6-DEMO-EVIDENCE").decision,
    "deferred",
  );
});

test("M1.5 A4/A8 routed blocker package decision record preserves A8 trigger context", () => {
  const record = readJson(decisionRecordPath);
  const routing = readJson(routingPath);
  const context = record.a8_phase_conformance_decision_context;

  assert.equal(context.runtime_harness_8_2_trigger_count, 10);
  assert.equal(context.evidence_carried_forward_trigger_count, 4);
  assert.equal(context.explicitly_deferred_trigger_count, 6);
  assert.equal(context.phase_conformance_accepted_items, 0);
  assert.deepEqual(
    sorted(context.deferred_trigger_ids),
    expectedDeferredTriggerIds,
  );
  assert.deepEqual(
    context.trigger_rows.map((row) => row.id),
    routing.a8_phase_conformance_routing.trigger_rows.map((row) => row.id),
  );
  assert.equal(
    context.trigger_rows.every(
      (row) =>
        row.accepted === false &&
        row.implemented === false &&
        row.decision === "needs_followup",
    ),
    true,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects accepted or implemented drift", () => {
  const mutatedRecordPath = writeMutatedDecisionRecord((record) => {
    record.route_package_decision_items[0].decision = "accepted";
    record.route_package_decision_items[0].accepted = true;
    record.routed_blocker_decision_items[0].implemented = true;
    record.a8_phase_conformance_decision_context.trigger_rows[0].accepted = true;
    record.summary.accepted_items = 1;
    record.summary.implemented_items = 1;
    record.summary.phase_conformance_accepted_items = 1;
    record.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: mutatedRecordPath,
      }),
    /EXIT-P1-1|decision|accepted|implemented/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects source package mapping drift", () => {
  const mutatedRecordPath = writeMutatedDecisionRecord((record) => {
    record.route_package_decision_items[0].source_route_package_id =
      "ROUTE-PACKAGE-MISSING";
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: mutatedRecordPath,
      }),
    /source route package|route package source ids/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects source blocker mapping drift", () => {
  const mutatedRecordPath = writeMutatedDecisionRecord((record) => {
    record.routed_blocker_decision_items[0].source_routed_blocker_item_id =
      "ROUTED-BLOCKER-MISSING";
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: mutatedRecordPath,
      }),
    /source routed blocker|source routed blocker item ids/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects FR-015 or wrong package drift", () => {
  const fr015Path = writeMutatedDecisionRecord((record) => {
    record.routed_blocker_decision_items[0].fr_id = "FR-015";
  });
  const wrongPackagePath = writeMutatedDecisionRecord((record) => {
    record.routed_blocker_decision_items[0].route_package_id =
      "ROUTE-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE";
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: fr015Path,
      }),
    /FR-015|FR id/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: wrongPackagePath,
      }),
    /route package/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedDecisionRecord((record) => {
    record.routed_blocker_decision_items[0].remaining_acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedDecisionRecord((record) => {
    record.route_package_decision_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: missingBlockerPath,
      }),
    /blockers/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects A8 trigger drift", () => {
  const acceptedRowPath = writeMutatedDecisionRecord((record) => {
    record.a8_phase_conformance_decision_context.trigger_rows[0].accepted = true;
  });
  const missingRowPath = writeMutatedDecisionRecord((record) => {
    record.a8_phase_conformance_decision_context.trigger_rows.pop();
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: acceptedRowPath,
      }),
    /accepted/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: missingRowPath,
      }),
    /trigger row order/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects cross-cutting drift", () => {
  const fr015AcceptedPath = writeMutatedDecisionRecord((record) => {
    record.cross_cutting_decision_items.find(
      (item) => item.fr_id === "FR-015",
    ).decision = "accepted";
  });
  const missingDependencyPath = writeMutatedDecisionRecord((record) => {
    record.cross_cutting_decision_items =
      record.cross_cutting_decision_items.filter(
        (item) =>
          item.id !== "CROSS-ROUTE-DECISION-DEPENDENCY-GATED-DESKTOP-SURFACES",
      );
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: fr015AcceptedPath,
      }),
    /FR-015 decision|decision/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: missingDependencyPath,
      }),
    /cross-cutting source route ids|dependency/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects unsafe metadata and dependency bypass", () => {
  const rawMetadataPath = writeMutatedDecisionRecord((record) => {
    record.routed_blocker_decision_items[0].raw_file_content = "unsafe";
    record.routed_blocker_decision_items[0].custom_value = "unsafe";
  });
  const pathValue = writeMutatedDecisionRecord((record) => {
    record.route_package_decision_items[0].next_action_refs.push(
      "C:/Users/admin/secret-output/file.md",
    );
  });
  const dependencyBypassPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.dependencies["@xyflow/react"] = "12.0.0";
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: rawMetadataPath,
      }),
    /forbidden fragment/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        decisionRecordPath: pathValue,
      }),
    /forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        desktopPackagePath: dependencyBypassPath,
      }),
    /must stay out of package\.json before dependency gate/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record rejects source routing acceptance drift", () => {
  const routingAcceptedPath = writeMutatedRouting((routing) => {
    routing.target_route_packages[0].accepted = true;
    routing.routed_blocker_items[0].accepted = true;
    routing.summary.accepted_items = 1;
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        routingPath: routingAcceptedPath,
      }),
    /source accepted|source not accepted/u,
  );
});

test("M1.5 A4/A8 routed blocker package decision record tolerates future ledger slices with retained evidence", () => {
  const futureLedgerPath = writeMutatedReadinessLedger((readinessLedger) => {
    readinessLedger.slice = "W1.5.227";
    readinessLedger.next_recommended_slices = [
      {
        id: "W1.5.228",
        title: "future slice",
        reason: "W1.5.226 evidence retained while later ledger advances.",
      },
    ];
  });

  const summary = validateA4A8RoutedBlockerPackageDecisionRecord({
    readinessLedgerPath: futureLedgerPath,
  });

  assert.equal(summary.routedBlockerDecisionCount, 11);
});

test("M1.5 A4/A8 routed blocker package decision record test is wired into desktop package gates", () => {
  const record = readJson(decisionRecordPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-a8-routed-blocker-package-decision-record\.test\.cjs/u,
  );
  assert.equal(
    record.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-a8-routed-blocker-package-decision-record.test.cjs",
  );
  assert.deepEqual(
    record.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.227"],
  );
});

test("M1.5 A4/A8 routed blocker package decision record validator rejects missing package gate wiring", () => {
  const missingWiringPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.scripts.test = desktopPackage.scripts.test.replace(
      " scripts/m1-5-a4-a8-routed-blocker-package-decision-record.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA4A8RoutedBlockerPackageDecisionRecord({
        desktopPackagePath: missingWiringPath,
      }),
    /desktop package gate wiring/u,
  );
});
