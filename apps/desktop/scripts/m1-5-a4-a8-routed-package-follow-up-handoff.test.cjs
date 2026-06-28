const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4A8RoutedPackageFollowUpHandoff,
} = require("./m1-5-a4-a8-routed-package-follow-up-handoff.cjs");

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
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedHandoffPackageIds = [
  "HANDOFF-PACKAGE-A4-STREAM-FINAL-ACCEPTANCE",
  "HANDOFF-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  "HANDOFF-PACKAGE-A8-PHASE-CONFORMANCE",
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

function writeMutatedHandoff(mutator) {
  const handoff = readJson(handoffPath);
  mutator(handoff);
  return writeJsonTemp(
    "cw-a4-a8-routed-handoff-",
    "follow-up-handoff.json",
    handoff,
  );
}

function writeMutatedSourcePlan(mutator) {
  const sourcePlan = readJson(needsFollowupPlanPath);
  mutator(sourcePlan);
  return writeJsonTemp(
    "cw-a4-a8-routed-handoff-source-",
    "needs-followup-plan.json",
    sourcePlan,
  );
}

function writeMutatedReadinessLedger(mutator) {
  const readinessLedger = readJson(readinessLedgerPath);
  mutator(readinessLedger);
  return writeJsonTemp(
    "cw-a4-a8-routed-handoff-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a4-a8-routed-handoff-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A4/A8 routed package follow-up handoff returns a conservative summary", () => {
  const summary = validateA4A8RoutedPackageFollowUpHandoff();

  assert.equal(
    summary.status,
    "a4_a8_routed_package_follow_up_handoff_prepared_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.handoffPackageCount, 3);
  assert.equal(summary.routedBlockerHandoffItemCount, 11);
  assert.equal(summary.totalHandoffRecordCount, 14);
  assert.equal(summary.streamHandoffPackageCount, 1);
  assert.equal(summary.runtimeUxHandoffPackageCount, 1);
  assert.equal(summary.gitHistoryHandoffPackageCount, 1);
  assert.equal(summary.streamRoutedBlockerHandoffItemCount, 3);
  assert.equal(summary.runtimeUxRoutedBlockerHandoffItemCount, 7);
  assert.equal(summary.gitHistoryRoutedBlockerHandoffItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.handoffPreparedNotAcceptedRecordCount, 14);
  assert.equal(summary.pendingReviewerDecisionRecordCount, 14);
  assert.equal(summary.crossCuttingHandoffGateCount, 3);
  assert.equal(summary.blockedCrossCuttingHandoffGateCount, 2);
  assert.equal(summary.deferredCrossCuttingHandoffGateCount, 1);
  assert.equal(summary.runtimeHarness8_2TriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItemCount, 0);
  assert.deepEqual(
    sorted(summary.handoffPackageIds),
    sorted(expectedHandoffPackageIds),
  );
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.229"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4/A8 routed package follow-up handoff maps W1.5.227 packages and blockers", () => {
  const handoff = readJson(handoffPath);
  const sourcePlan = readJson(needsFollowupPlanPath);

  assert.equal(handoff.slice, "W1.5.228");
  assert.equal(sourcePlan.slice, "W1.5.227");
  assert.deepEqual(
    sorted(
      handoff.handoff_packages.map(
        (item) => item.source_route_package_follow_up_id,
      ),
    ),
    sorted(sourcePlan.route_package_follow_up_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(
      handoff.routed_blocker_handoff_items.map(
        (item) => item.source_routed_blocker_follow_up_id,
      ),
    ),
    sorted(sourcePlan.routed_blocker_follow_up_items.map((item) => item.id)),
  );
});

test("M1.5 A4/A8 routed package follow-up handoff keeps all handoff records pending", () => {
  const handoff = readJson(handoffPath);

  assert.equal(
    handoff.handoff_packages.every(
      (item) =>
        item.package_status === "handoff_prepared_not_accepted" &&
        item.handoff_status === "handoff_prepared_not_accepted" &&
        item.acceptance_decision_status === "pending_reviewer_decision" &&
        item.accepted === false &&
        item.implemented === false,
    ),
    true,
  );
  assert.equal(
    handoff.routed_blocker_handoff_items.every(
      (item) =>
        item.package_status === "handoff_prepared_not_accepted" &&
        item.handoff_status === "handoff_prepared_not_accepted" &&
        item.acceptance_decision_status === "pending_reviewer_decision" &&
        item.accepted === false &&
        item.implemented === false,
    ),
    true,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff preserves cross-cutting gates", () => {
  const handoff = readJson(handoffPath);
  const gatesById = new Map(
    handoff.cross_cutting_handoff_gates.map((item) => [item.id, item]),
  );

  assert.equal(
    gatesById.get("CROSS-HANDOFF-GATE-DEPENDENCY-GATED-DESKTOP-SURFACES")
      .handoff_gate_status,
    "blocked_not_accepted",
  );
  assert.equal(
    gatesById.get("CROSS-HANDOFF-GATE-FR-015-CONTRACT-GATE").current_adr_status,
    "Proposed",
  );
  assert.equal(
    gatesById.get("CROSS-HANDOFF-GATE-FR-015-CONTRACT-GATE")
      .handoff_gate_status,
    "blocked_not_accepted",
  );
  assert.equal(
    gatesById.get("CROSS-HANDOFF-GATE-M1-6-DEMO-EVIDENCE").handoff_gate_status,
    "deferred_not_accepted",
  );
});

test("M1.5 A4/A8 routed package follow-up handoff preserves A8 trigger context", () => {
  const handoff = readJson(handoffPath);
  const sourcePlan = readJson(needsFollowupPlanPath);
  const a8 = handoff.a8_phase_conformance_handoff;

  assert.equal(a8.handoff_status, "handoff_prepared_not_accepted");
  assert.equal(a8.runtime_harness_8_2_trigger_count, 10);
  assert.equal(a8.evidence_carried_forward_trigger_count, 4);
  assert.equal(a8.explicitly_deferred_trigger_count, 6);
  assert.equal(a8.phase_conformance_accepted_items, 0);
  assert.deepEqual(
    sorted(a8.deferred_trigger_ids),
    sorted(expectedDeferredTriggerIds),
  );
  assert.deepEqual(
    a8.trigger_rows.map((row) => row.id),
    sourcePlan.a8_phase_conformance_follow_up_plan.trigger_rows.map(
      (row) => row.id,
    ),
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects accepted or implemented drift", () => {
  const acceptedPath = writeMutatedHandoff((handoff) => {
    handoff.handoff_packages[0].accepted = true;
    handoff.routed_blocker_handoff_items[0].implemented = true;
    handoff.summary.accepted_items = 1;
    handoff.summary.implemented_items = 1;
    handoff.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: acceptedPath,
      }),
    /EXIT-P1-1|accepted|implemented/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects source mapping drift", () => {
  const packageDriftPath = writeMutatedHandoff((handoff) => {
    handoff.handoff_packages[0].source_route_package_follow_up_id =
      "ROUTED-PACKAGE-FOLLOW-UP-A4-MISSING";
  });
  const itemDriftPath = writeMutatedHandoff((handoff) => {
    handoff.routed_blocker_handoff_items[0].source_routed_blocker_follow_up_id =
      "ROUTED-BLOCKER-FOLLOW-UP-A4-MISSING";
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: packageDriftPath,
      }),
    /source follow-up id|handoff package/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: itemDriftPath,
      }),
    /source follow-up id|handoff item/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects FR-015 or wrong package drift", () => {
  const fr015Path = writeMutatedHandoff((handoff) => {
    handoff.routed_blocker_handoff_items[0].fr_id = "FR-015";
  });
  const wrongPackagePath = writeMutatedHandoff((handoff) => {
    handoff.routed_blocker_handoff_items[0].handoff_package_id =
      "HANDOFF-PACKAGE-A4-RUNTIME-UX-FINAL-ACCEPTANCE";
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: fr015Path,
      }),
    /FR id|FR-015/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: wrongPackagePath,
      }),
    /handoff package id|handoff item count/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedHandoff((handoff) => {
    handoff.routed_blocker_handoff_items[0].acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedHandoff((handoff) => {
    handoff.handoff_packages[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: missingBlockerPath,
      }),
    /acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects A8 trigger drift", () => {
  const missingTriggerPath = writeMutatedHandoff((handoff) => {
    handoff.a8_phase_conformance_handoff.trigger_rows.pop();
  });
  const acceptedPhasePath = writeMutatedHandoff((handoff) => {
    handoff.a8_phase_conformance_handoff.phase_conformance_accepted_items = 1;
    handoff.summary.phase_conformance_accepted_items = 1;
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: missingTriggerPath,
      }),
    /A8 trigger row order/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: acceptedPhasePath,
      }),
    /phase_conformance_accepted_items|A8 accepted/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects cross-cutting drift", () => {
  const missingFr015Path = writeMutatedHandoff((handoff) => {
    handoff.cross_cutting_handoff_gates =
      handoff.cross_cutting_handoff_gates.filter(
        (item) => item.fr_id !== "FR-015",
      );
  });
  const acceptedCrossPath = writeMutatedHandoff((handoff) => {
    handoff.cross_cutting_handoff_gates[0].handoff_gate_status =
      "handoff_prepared_not_accepted";
    handoff.cross_cutting_handoff_gates[0].accepted = true;
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: missingFr015Path,
      }),
    /FR-015 handoff gate|cross-cutting handoff gate count/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: acceptedCrossPath,
      }),
    /accepted|gate status/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects unsafe metadata and dependency bypass", () => {
  const unsafePath = writeMutatedHandoff((handoff) => {
    handoff.handoff_packages[0].evidence_refs.push(
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
      validateA4A8RoutedPackageFollowUpHandoff({
        handoffPath: unsafePath,
      }),
    /forbidden fragment|forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        desktopPackagePath: dependencyBypassPackagePath,
      }),
    /DEP-REACT-FLOW|dependency/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff rejects source plan acceptance drift", () => {
  const sourceAcceptedPath = writeMutatedSourcePlan((sourcePlan) => {
    sourcePlan.route_package_follow_up_items[0].accepted = true;
    sourcePlan.summary.accepted_items = 1;
    sourcePlan.summary.planned_not_implemented_items = 13;
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        needsFollowupPlanPath: sourceAcceptedPath,
      }),
    /source accepted|accepted|planned/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff tolerates future ledger slices with retained evidence", () => {
  const futureLedgerPath = writeMutatedReadinessLedger((ledger) => {
    ledger.slice = "W1.5.229";
    ledger.next_recommended_slices = [
      {
        id: "W1.5.230",
        title: "future",
        reason: "future ledger retaining W1.5.228 evidence",
      },
    ];
  });

  const summary = validateA4A8RoutedPackageFollowUpHandoff({
    readinessLedgerPath: futureLedgerPath,
  });

  assert.equal(summary.handoffPackageCount, 3);
  assert.equal(summary.routedBlockerHandoffItemCount, 11);
});

test("M1.5 A4/A8 routed package follow-up handoff test is wired into desktop package gates", () => {
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-a8-routed-package-follow-up-handoff\.test\.cjs/u,
  );
});

test("M1.5 A4/A8 routed package follow-up handoff validator rejects missing package gate wiring", () => {
  const missingGatePackagePath = writeMutatedDesktopPackage((packageJson) => {
    packageJson.scripts.test = packageJson.scripts.test.replace(
      " scripts/m1-5-a4-a8-routed-package-follow-up-handoff.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA4A8RoutedPackageFollowUpHandoff({
        desktopPackagePath: missingGatePackagePath,
      }),
    /desktop package gate wiring/u,
  );
});
