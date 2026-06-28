const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4A8RoutedPackageNeedsFollowupPlan,
} = require("./m1-5-a4-a8-routed-package-needs-followup-plan.cjs");

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
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedTrackIds = [
  "TRACK-A4-STREAM-ROUTED-PACKAGE-FOLLOWUP",
  "TRACK-A4-RUNTIME-UX-ROUTED-PACKAGE-FOLLOWUP",
  "TRACK-A8-PHASE-CONFORMANCE-ROUTED-PACKAGE-FOLLOWUP",
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

function writeMutatedNeedsFollowupPlan(mutator) {
  const needsFollowupPlan = readJson(needsFollowupPlanPath);
  mutator(needsFollowupPlan);
  return writeJsonTemp(
    "cw-a4-a8-routed-followup-",
    "needs-followup-plan.json",
    needsFollowupPlan,
  );
}

function writeMutatedDecisionRecord(mutator) {
  const decisionRecord = readJson(decisionRecordPath);
  mutator(decisionRecord);
  return writeJsonTemp(
    "cw-a4-a8-routed-followup-source-",
    "decision-record.json",
    decisionRecord,
  );
}

function writeMutatedReadinessLedger(mutator) {
  const readinessLedger = readJson(readinessLedgerPath);
  mutator(readinessLedger);
  return writeJsonTemp(
    "cw-a4-a8-routed-followup-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a4-a8-routed-followup-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A4/A8 routed package needs-followup plan returns a conservative summary", () => {
  const summary = validateA4A8RoutedPackageNeedsFollowupPlan();

  assert.equal(
    summary.status,
    "a4_a8_routed_package_needs_followup_plan_prepared_not_implemented",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.routePackageFollowUpItemCount, 3);
  assert.equal(summary.routedBlockerFollowUpItemCount, 11);
  assert.equal(summary.totalFollowUpItemCount, 14);
  assert.equal(summary.streamPackageFollowUpItemCount, 1);
  assert.equal(summary.runtimeUxPackageFollowUpItemCount, 1);
  assert.equal(summary.gitHistoryPackageFollowUpItemCount, 1);
  assert.equal(summary.streamRoutedBlockerFollowUpItemCount, 3);
  assert.equal(summary.runtimeUxRoutedBlockerFollowUpItemCount, 7);
  assert.equal(summary.gitHistoryRoutedBlockerFollowUpItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.plannedNotImplementedItemCount, 14);
  assert.equal(summary.crossCuttingFollowUpItemCount, 3);
  assert.equal(summary.blockedCrossCuttingFollowUpItemCount, 2);
  assert.equal(summary.deferredCrossCuttingFollowUpItemCount, 1);
  assert.equal(summary.runtimeHarness8_2TriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItemCount, 0);
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.228"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4/A8 routed package needs-followup plan maps W1.5.226 package and blocker decisions", () => {
  const plan = readJson(needsFollowupPlanPath);
  const decisionRecord = readJson(decisionRecordPath);

  assert.equal(plan.slice, "W1.5.227");
  assert.equal(decisionRecord.slice, "W1.5.226");
  assert.deepEqual(
    sorted(
      plan.route_package_follow_up_items.map(
        (item) => item.source_route_package_decision_id,
      ),
    ),
    sorted(decisionRecord.route_package_decision_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(
      plan.routed_blocker_follow_up_items.map(
        (item) => item.source_routed_blocker_decision_id,
      ),
    ),
    sorted(decisionRecord.routed_blocker_decision_items.map((item) => item.id)),
  );
});

test("M1.5 A4/A8 routed package needs-followup plan keeps all follow-ups planned", () => {
  const plan = readJson(needsFollowupPlanPath);

  assert.deepEqual(
    sorted(plan.follow_up_tracks.map((track) => track.id)),
    sorted(expectedTrackIds),
  );
  assert.equal(
    plan.route_package_follow_up_items.every(
      (item) =>
        item.source_decision === "needs_followup" &&
        item.follow_up_status === "planned_not_implemented" &&
        item.accepted === false &&
        item.implemented === false,
    ),
    true,
  );
  assert.equal(
    plan.routed_blocker_follow_up_items.every(
      (item) =>
        item.source_decision === "needs_followup" &&
        item.follow_up_status === "planned_not_implemented" &&
        item.accepted === false &&
        item.implemented === false,
    ),
    true,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan preserves cross-cutting gates", () => {
  const plan = readJson(needsFollowupPlanPath);
  const followUpsById = new Map(
    plan.cross_cutting_follow_up_items.map((item) => [item.id, item]),
  );

  assert.equal(
    followUpsById.get("CROSS-ROUTE-FOLLOW-UP-DEPENDENCY-GATED-DESKTOP-SURFACES")
      .follow_up_status,
    "blocked_not_implemented",
  );
  assert.equal(
    followUpsById.get("CROSS-ROUTE-FOLLOW-UP-FR-015-CONTRACT-GATE")
      .current_adr_status,
    "Proposed",
  );
  assert.equal(
    followUpsById.get("CROSS-ROUTE-FOLLOW-UP-FR-015-CONTRACT-GATE")
      .follow_up_status,
    "blocked_not_implemented",
  );
  assert.equal(
    followUpsById.get("CROSS-ROUTE-FOLLOW-UP-M1-6-DEMO-EVIDENCE")
      .follow_up_status,
    "deferred_not_implemented",
  );
});

test("M1.5 A4/A8 routed package needs-followup plan preserves A8 trigger context", () => {
  const plan = readJson(needsFollowupPlanPath);
  const decisionRecord = readJson(decisionRecordPath);
  const a8 = plan.a8_phase_conformance_follow_up_plan;

  assert.equal(a8.plan_status, "planned_not_implemented");
  assert.equal(a8.runtime_harness_8_2_trigger_count, 10);
  assert.equal(a8.evidence_carried_forward_trigger_count, 4);
  assert.equal(a8.explicitly_deferred_trigger_count, 6);
  assert.equal(a8.phase_conformance_accepted_items, 0);
  assert.deepEqual(
    sorted(a8.deferred_trigger_ids),
    sorted(expectedDeferredTriggerIds),
  );
  assert.deepEqual(
    a8.trigger_rows.map((row) => row.trigger_id),
    decisionRecord.a8_phase_conformance_decision_context.trigger_rows.map(
      (row) => row.trigger_id,
    ),
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects accepted or implemented drift", () => {
  const acceptedPath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.route_package_follow_up_items[0].accepted = true;
    plan.routed_blocker_follow_up_items[0].implemented = true;
    plan.summary.accepted_items = 1;
    plan.summary.implemented_items = 1;
    plan.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: acceptedPath,
      }),
    /EXIT-P1-1|accepted|implemented/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects source mapping drift", () => {
  const packageDriftPath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.route_package_follow_up_items[0].source_route_package_decision_id =
      "ROUTED-PACKAGE-DECISION-A4-MISSING";
  });
  const blockerDriftPath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.routed_blocker_follow_up_items[0].source_routed_blocker_decision_id =
      "ROUTED-BLOCKER-DECISION-A4-MISSING";
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: packageDriftPath,
      }),
    /source route package decision ids|source decision/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: blockerDriftPath,
      }),
    /source routed blocker decision ids|source decision|routed blocker follow-up/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects FR-015 or wrong track drift", () => {
  const fr015Path = writeMutatedNeedsFollowupPlan((plan) => {
    plan.routed_blocker_follow_up_items[0].fr_id = "FR-015";
  });
  const wrongTrackPath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.routed_blocker_follow_up_items[0].track_id =
      "TRACK-A4-RUNTIME-UX-ROUTED-PACKAGE-FOLLOWUP";
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: fr015Path,
      }),
    /FR-015|FR id/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: wrongTrackPath,
      }),
    /track id/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.routed_blocker_follow_up_items[0].acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.route_package_follow_up_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: missingBlockerPath,
      }),
    /acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects A8 trigger drift", () => {
  const missingTriggerPath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.a8_phase_conformance_follow_up_plan.trigger_rows.pop();
  });
  const acceptedPhasePath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.a8_phase_conformance_follow_up_plan.phase_conformance_accepted_items = 1;
    plan.summary.phase_conformance_accepted_items = 1;
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: missingTriggerPath,
      }),
    /A8 trigger row order/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: acceptedPhasePath,
      }),
    /phase_conformance_accepted_items/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects cross-cutting drift", () => {
  const missingFr015Path = writeMutatedNeedsFollowupPlan((plan) => {
    plan.cross_cutting_follow_up_items =
      plan.cross_cutting_follow_up_items.filter(
        (item) => item.fr_id !== "FR-015",
      );
  });
  const acceptedCrossPath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.cross_cutting_follow_up_items[0].follow_up_status =
      "planned_not_implemented";
    plan.cross_cutting_follow_up_items[0].accepted = true;
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: missingFr015Path,
      }),
    /FR-015 cross-cutting|cross-cutting follow-up count/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: acceptedCrossPath,
      }),
    /accepted|follow-up status/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects unsafe metadata and dependency bypass", () => {
  const unsafePath = writeMutatedNeedsFollowupPlan((plan) => {
    plan.route_package_follow_up_items[0].evidence_refs.push(
      "C:/Users/admin/AppData/Local/rawPrompt.txt",
    );
  });
  const dependencyBypassPackagePath = writeMutatedDesktopPackage(
    (packageJson) => {
      packageJson.dependencies["@xyflow/react"] = "12.0.0";
    },
  );

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        needsFollowupPlanPath: unsafePath,
      }),
    /forbidden fragment|forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        desktopPackagePath: dependencyBypassPackagePath,
      }),
    /DEP-REACT-FLOW|dependency/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan rejects source decision acceptance drift", () => {
  const sourceAcceptedPath = writeMutatedDecisionRecord((decisionRecord) => {
    decisionRecord.route_package_decision_items[0].accepted = true;
    decisionRecord.summary.needs_followup_route_package_decisions = 2;
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        decisionRecordPath: sourceAcceptedPath,
      }),
    /source route package needs_followup count|source accepted/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan tolerates future ledger slices with retained evidence", () => {
  const futureLedgerPath = writeMutatedReadinessLedger((ledger) => {
    ledger.slice = "W1.5.228";
    ledger.next_recommended_slices = [
      {
        id: "W1.5.229",
        title: "future",
        reason: "future ledger retaining W1.5.227 evidence",
      },
    ];
  });

  const summary = validateA4A8RoutedPackageNeedsFollowupPlan({
    readinessLedgerPath: futureLedgerPath,
  });

  assert.equal(summary.routePackageFollowUpItemCount, 3);
  assert.equal(summary.routedBlockerFollowUpItemCount, 11);
});

test("M1.5 A4/A8 routed package needs-followup plan test is wired into desktop package gates", () => {
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-a8-routed-package-needs-followup-plan\.test\.cjs/u,
  );
});

test("M1.5 A4/A8 routed package needs-followup plan validator rejects missing package gate wiring", () => {
  const missingGatePackagePath = writeMutatedDesktopPackage((packageJson) => {
    packageJson.scripts.test = packageJson.scripts.test.replace(
      " scripts/m1-5-a4-a8-routed-package-needs-followup-plan.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageNeedsFollowupPlan({
        desktopPackagePath: missingGatePackagePath,
      }),
    /desktop package gate wiring/u,
  );
});
