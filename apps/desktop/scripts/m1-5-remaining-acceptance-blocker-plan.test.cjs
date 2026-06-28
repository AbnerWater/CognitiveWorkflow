const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateRemainingAcceptanceBlockerPlan,
} = require("./m1-5-remaining-acceptance-blocker-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const blockerPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-remaining-acceptance-blocker-plan.json",
);
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-packaged-follow-up-decision-record.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

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

function writeMutatedBlockerPlan(mutator) {
  const blockerPlan = readJson(blockerPlanPath);
  mutator(blockerPlan);
  return writeJsonTemp(
    "cw-remaining-blocker-plan-",
    "blocker-plan.json",
    blockerPlan,
  );
}

function writeMutatedDecisionRecord(mutator) {
  const decisionRecord = readJson(decisionRecordPath);
  mutator(decisionRecord);
  return writeJsonTemp(
    "cw-remaining-blocker-source-",
    "decision-record.json",
    decisionRecord,
  );
}

function writeMutatedReadinessLedger(mutator) {
  const readinessLedger = readJson(readinessLedgerPath);
  mutator(readinessLedger);
  return writeJsonTemp(
    "cw-remaining-blocker-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-remaining-blocker-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 remaining acceptance blocker plan returns a conservative summary", () => {
  const summary = validateRemainingAcceptanceBlockerPlan();

  assert.equal(
    summary.status,
    "remaining_acceptance_blocker_plan_prepared_not_implemented",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.remainingBlockerItemCount, 11);
  assert.equal(summary.streamAcceptanceBlockerItemCount, 3);
  assert.equal(summary.runtimeUxAcceptanceBlockerItemCount, 7);
  assert.equal(summary.gitHistoryConformanceBlockerItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.plannedNotImplementedItemCount, 11);
  assert.equal(summary.crossCuttingBlockerItemCount, 3);
  assert.equal(summary.dependencyGatedTrackCount, 1);
  assert.equal(summary.contractGatedTrackCount, 1);
  assert.equal(summary.m1_6DeferredTrackCount, 1);
  assert.equal(summary.runtimeHarness8_2TriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItemCount, 0);
  assert.deepEqual(summary.dependencyGateIds, expectedDependencyGateIds);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.225"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 remaining acceptance blocker plan mirrors W1.5.223 decisions", () => {
  const blockerPlan = readJson(blockerPlanPath);
  const decisionRecord = readJson(decisionRecordPath);

  assert.equal(blockerPlan.slice, "W1.5.224");
  assert.equal(decisionRecord.slice, "W1.5.223");
  assert.deepEqual(
    sorted(
      blockerPlan.remaining_blocker_items.map(
        (item) => item.source_packaged_follow_up_decision_id,
      ),
    ),
    sorted(
      decisionRecord.packaged_follow_up_decision_items.map((item) => item.id),
    ),
  );
  for (const blockerItem of blockerPlan.remaining_blocker_items) {
    const sourceItem = decisionRecord.packaged_follow_up_decision_items.find(
      (item) => item.id === blockerItem.source_packaged_follow_up_decision_id,
    );
    assert.ok(sourceItem);
    assert.equal(blockerItem.fr_id, sourceItem.fr_id);
    assert.equal(blockerItem.source_decision, "needs_followup");
    assert.equal(
      blockerItem.source_decision_status,
      "reviewed_packaged_follow_up_needs_followup_not_accepted",
    );
    assert.deepEqual(
      blockerItem.acceptance_blockers,
      sourceItem.remaining_acceptance_blockers,
    );
  }
});

test("M1.5 remaining acceptance blocker plan preserves tracks and cross-cutting blockers", () => {
  const blockerPlan = readJson(blockerPlanPath);

  assert.deepEqual(
    sorted(
      blockerPlan.remaining_blocker_items
        .filter(
          (item) =>
            item.track_id === "TRACK-A4-STREAM-FINAL-ACCEPTANCE-BLOCKERS",
        )
        .map((item) => item.fr_id),
    ),
    sorted(expectedStreamFrIds),
  );
  assert.deepEqual(
    sorted(
      blockerPlan.remaining_blocker_items
        .filter(
          (item) =>
            item.track_id === "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE-BLOCKERS",
        )
        .map((item) => item.fr_id),
    ),
    sorted(expectedRuntimeUxFrIds),
  );
  assert.deepEqual(
    blockerPlan.remaining_blocker_items
      .filter((item) => item.track_id === "TRACK-A8-PHASE-CONFORMANCE-BLOCKERS")
      .map((item) => item.fr_id),
    ["FR-012"],
  );
  assert.equal(
    blockerPlan.remaining_blocker_items.some((item) => item.fr_id === "FR-015"),
    false,
  );
  assert.equal(
    blockerPlan.cross_cutting_blockers.some(
      (item) =>
        item.id === "CROSS-BLOCKER-FR-015-CONTRACT-GATE" &&
        item.blocker_status === "blocked_by_contract_gate",
    ),
    true,
  );
  assert.equal(
    blockerPlan.cross_cutting_blockers.some(
      (item) =>
        item.id === "CROSS-BLOCKER-DEPENDENCY-GATED-DESKTOP-SURFACES" &&
        item.blocker_status === "blocked_by_dependency_gate",
    ),
    true,
  );
  assert.equal(
    blockerPlan.cross_cutting_blockers.some(
      (item) =>
        item.id === "CROSS-BLOCKER-M1-6-DEMO-EVIDENCE" &&
        item.blocker_status === "deferred_to_m1_6",
    ),
    true,
  );
});

test("M1.5 remaining acceptance blocker plan mirrors A8 runtime_harness context", () => {
  const blockerPlan = readJson(blockerPlanPath);
  const sourceContext =
    readJson(decisionRecordPath).a8_runtime_harness_8_2_decision_context;
  const planContext = blockerPlan.a8_phase_conformance_plan;

  assert.equal(planContext.runtime_harness_8_2_trigger_count, 10);
  assert.equal(planContext.evidence_carried_forward_trigger_count, 4);
  assert.equal(planContext.explicitly_deferred_trigger_count, 6);
  assert.equal(planContext.phase_conformance_accepted_items, 0);
  assert.deepEqual(
    planContext.trigger_rows.map((row) => row.id),
    sourceContext.trigger_rows.map((row) => row.id),
  );
  assert.deepEqual(
    sorted(planContext.deferred_trigger_ids),
    expectedDeferredTriggerIds,
  );
  assert.equal(
    planContext.trigger_rows.every(
      (row) =>
        row.accepted === false &&
        row.implemented === false &&
        row.decision === "needs_followup",
    ),
    true,
  );
});

test("M1.5 remaining acceptance blocker plan rejects accepted or implemented drift", () => {
  const mutatedPlanPath = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].accepted = true;
    plan.remaining_blocker_items[0].implemented = true;
    plan.remaining_blocker_items[0].blocker_status = "accepted";
    plan.summary.accepted_items = 1;
    plan.summary.implemented_items = 1;
    plan.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: mutatedPlanPath,
      }),
    /EXIT-P1-1|accepted|implemented|blocker status/u,
  );
});

test("M1.5 remaining acceptance blocker plan rejects source decision mapping drift", () => {
  const mutatedPlanPath = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].source_packaged_follow_up_decision_id =
      "PACKAGED-FOLLOW-UP-DECISION-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: mutatedPlanPath,
      }),
    /source item|source packaged decision ids/u,
  );
});

test("M1.5 remaining acceptance blocker plan rejects FR-015 or wrong track drift", () => {
  const fr015Path = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].fr_id = "FR-015";
  });
  const wrongTrackPath = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].track_id =
      "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE-BLOCKERS";
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: fr015Path,
      }),
    /remaining blocker FR ids|FR-015/u,
  );
  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: wrongTrackPath,
      }),
    /track by review group|track FR membership/u,
  );
});

test("M1.5 remaining acceptance blocker plan rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: missingBlockerPath,
      }),
    /acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 remaining acceptance blocker plan rejects raw metadata and path leak markers", () => {
  const rawMetadataPath = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].raw_file_content = "unsafe";
    plan.remaining_blocker_items[0].custom_value = "unsafe";
    plan.remaining_blocker_items[0].destination_path = "unsafe";
    plan.remaining_blocker_items[0].cache_path = "unsafe";
  });
  const pathValue = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].next_action_refs.push(
      "C:/Users/admin/secret-output/file.md",
    );
  });
  const cacheValue = writeMutatedBlockerPlan((plan) => {
    plan.remaining_blocker_items[0].next_action_refs.push("cache/private/file");
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: rawMetadataPath,
      }),
    /forbidden fragment/u,
  );
  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: pathValue,
      }),
    /forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: cacheValue,
      }),
    /forbidden pattern/u,
  );
});

test("M1.5 remaining acceptance blocker plan rejects cross-cutting blocker drift", () => {
  const missingDependencyGatePath = writeMutatedBlockerPlan((plan) => {
    plan.cross_cutting_blockers = plan.cross_cutting_blockers.filter(
      (item) => item.id !== "CROSS-BLOCKER-DEPENDENCY-GATED-DESKTOP-SURFACES",
    );
  });
  const wrongFr015StatusPath = writeMutatedBlockerPlan((plan) => {
    plan.cross_cutting_blockers.find(
      (item) => item.id === "CROSS-BLOCKER-FR-015-CONTRACT-GATE",
    ).blocker_status = "planned_not_implemented";
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: missingDependencyGatePath,
      }),
    /dependency blocker|cross-cutting blocker count/u,
  );
  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        blockerPlanPath: wrongFr015StatusPath,
      }),
    /FR-015 blocker status/u,
  );
});

test("M1.5 remaining acceptance blocker plan rejects dependency gate bypass", () => {
  const installedDependencyPath = writeMutatedDesktopPackage(
    (desktopPackage) => {
      desktopPackage.dependencies["@xyflow/react"] = "12.0.0";
    },
  );

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        desktopPackagePath: installedDependencyPath,
      }),
    /must stay out of package\.json before dependency gate/u,
  );
});

test("M1.5 remaining acceptance blocker plan rejects source decision acceptance drift", () => {
  const acceptedSourcePath = writeMutatedDecisionRecord((decisionRecord) => {
    decisionRecord.packaged_follow_up_decision_items[0].decision = "accepted";
    decisionRecord.summary.accepted_items = 1;
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        decisionRecordPath: acceptedSourcePath,
      }),
    /source accepted items|source decision/u,
  );
});

test("M1.5 remaining acceptance blocker plan tolerates future ledger slices with retained evidence", () => {
  const futureLedgerPath = writeMutatedReadinessLedger((readinessLedger) => {
    readinessLedger.slice = "W1.5.225";
    readinessLedger.next_recommended_slices = [
      {
        id: "W1.5.226",
        title: "future slice",
        reason: "W1.5.224 evidence retained while later ledger advances.",
      },
    ];
  });

  const summary = validateRemainingAcceptanceBlockerPlan({
    readinessLedgerPath: futureLedgerPath,
  });

  assert.equal(summary.remainingBlockerItemCount, 11);
});

test("M1.5 remaining acceptance blocker plan test is wired into desktop package gates", () => {
  const blockerPlan = readJson(blockerPlanPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-remaining-acceptance-blocker-plan\.test\.cjs/u,
  );
  assert.equal(
    blockerPlan.blocker_plan_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-remaining-acceptance-blocker-plan.test.cjs",
  );
  assert.equal(
    blockerPlan.blocker_plan_contract.focused_check,
    "node apps/desktop/scripts/m1-5-remaining-acceptance-blocker-plan.cjs --check",
  );
  assert.deepEqual(
    blockerPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.225"],
  );
});

test("M1.5 remaining acceptance blocker plan validator rejects missing package gate wiring", () => {
  const missingWiringPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.scripts.test = desktopPackage.scripts.test.replace(
      " scripts/m1-5-remaining-acceptance-blocker-plan.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateRemainingAcceptanceBlockerPlan({
        desktopPackagePath: missingWiringPath,
      }),
    /desktop package gate wiring/u,
  );
});
