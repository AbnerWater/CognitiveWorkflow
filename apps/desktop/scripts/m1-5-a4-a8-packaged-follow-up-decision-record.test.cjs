const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4A8PackagedFollowUpDecisionRecord,
} = require("./m1-5-a4-a8-packaged-follow-up-decision-record.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-a8-packaged-follow-up-decision-record.json",
);
const streamPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-follow-up-package.json",
);
const runtimeUxPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-follow-up-package.json",
);
const gitHistoryPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-follow-up-package.json",
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
    "cw-a4-a8-packaged-decision-",
    "decision-record.json",
    decisionRecord,
  );
}

function writeMutatedStreamPackage(mutator) {
  const streamPackage = readJson(streamPackagePath);
  mutator(streamPackage);
  return writeJsonTemp(
    "cw-a4-a8-stream-package-",
    "stream-package.json",
    streamPackage,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a4-a8-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A4/A8 packaged follow-up decision record returns a conservative summary", () => {
  const summary = validateA4A8PackagedFollowUpDecisionRecord();

  assert.equal(
    summary.status,
    "a4_a8_packaged_follow_up_reviewer_decisions_recorded_needs_followup",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.decisionItemCount, 11);
  assert.equal(summary.streamPackageDecisionItemCount, 3);
  assert.equal(summary.runtimeUxPackageDecisionItemCount, 7);
  assert.equal(summary.gitHistoryPackageDecisionItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.rejectedItemCount, 0);
  assert.equal(summary.needsFollowupItemCount, 11);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.packagedReviewedItemCount, 11);
  assert.equal(summary.sourcePackagedNotAcceptedItemCount, 11);
  assert.equal(summary.runtimeHarness8_2TriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItemCount, 0);
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.224"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4/A8 packaged follow-up decision record mirrors W1.5.220 through W1.5.222 packages", () => {
  const record = readJson(decisionRecordPath);
  const streamPackage = readJson(streamPackagePath);
  const runtimeUxPackage = readJson(runtimeUxPackagePath);
  const gitHistoryPackage = readJson(gitHistoryPackagePath);

  assert.equal(record.slice, "W1.5.223");
  assert.equal(streamPackage.slice, "W1.5.220");
  assert.equal(runtimeUxPackage.slice, "W1.5.221");
  assert.equal(gitHistoryPackage.slice, "W1.5.222");
  assert.deepEqual(
    sorted(
      record.packaged_follow_up_decision_items
        .filter((item) => item.review_group === "stream_acceptance_repair")
        .map((item) => item.source_package_item_id),
    ),
    sorted(streamPackage.package_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(
      record.packaged_follow_up_decision_items
        .filter((item) => item.review_group === "runtime_ux_repair")
        .map((item) => item.source_package_item_id),
    ),
    sorted(runtimeUxPackage.package_items.map((item) => item.id)),
  );
  assert.deepEqual(
    record.packaged_follow_up_decision_items
      .filter((item) => item.review_group === "git_history_conformance_repair")
      .map((item) => item.source_package_item_id),
    gitHistoryPackage.package_items.map((item) => item.id),
  );
});

test("M1.5 A4/A8 packaged follow-up decision record keeps all decisions as needs_followup", () => {
  const record = readJson(decisionRecordPath);

  assert.equal(record.summary.accepted_items, 0);
  assert.equal(record.summary.rejected_items, 0);
  assert.equal(record.summary.needs_followup_items, 11);
  assert.equal(record.summary.implemented_items, 0);
  assert.equal(
    record.packaged_follow_up_decision_items.every(
      (item) =>
        item.decision === "needs_followup" &&
        item.decision_status ===
          "reviewed_packaged_follow_up_needs_followup_not_accepted" &&
        item.source_package_status === "packaged_not_accepted" &&
        item.accepted === false &&
        item.implemented === false &&
        item.follow_up_required === true &&
        item.evidence_reviewed === true &&
        item.package_reviewed === true,
    ),
    true,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record preserves FR groups and excludes FR-015", () => {
  const record = readJson(decisionRecordPath);

  assert.deepEqual(
    sorted(
      record.packaged_follow_up_decision_items
        .filter((item) => item.review_group === "stream_acceptance_repair")
        .map((item) => item.fr_id),
    ),
    sorted(expectedStreamFrIds),
  );
  assert.deepEqual(
    sorted(
      record.packaged_follow_up_decision_items
        .filter((item) => item.review_group === "runtime_ux_repair")
        .map((item) => item.fr_id),
    ),
    sorted(expectedRuntimeUxFrIds),
  );
  assert.deepEqual(
    record.packaged_follow_up_decision_items
      .filter((item) => item.review_group === "git_history_conformance_repair")
      .map((item) => item.fr_id),
    ["FR-012"],
  );
  assert.equal(
    record.packaged_follow_up_decision_items.some(
      (item) => item.fr_id === "FR-015",
    ),
    false,
  );
  assert.equal(
    record.excluded_items.some((item) => item.fr_id === "FR-015"),
    true,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record mirrors A8 runtime_harness §8.2 context", () => {
  const record = readJson(decisionRecordPath);
  const gitHistoryPackage = readJson(gitHistoryPackagePath);
  const context = record.a8_runtime_harness_8_2_decision_context;

  assert.equal(context.runtime_harness_8_2_trigger_count, 10);
  assert.equal(context.evidence_carried_forward_trigger_count, 4);
  assert.equal(context.explicitly_deferred_trigger_count, 6);
  assert.equal(context.phase_conformance_accepted_items, 0);
  assert.deepEqual(
    sorted(context.carried_forward_trigger_ids),
    expectedCarriedForwardTriggerIds,
  );
  assert.deepEqual(
    sorted(context.deferred_trigger_ids),
    expectedDeferredTriggerIds,
  );
  assert.deepEqual(
    context.trigger_rows.map((row) => row.id),
    gitHistoryPackage.runtime_harness_8_2_follow_up_matrix.map((row) => row.id),
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

test("M1.5 A4/A8 packaged follow-up decision record rejects accepted or implemented drift", () => {
  const mutatedRecordPath = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].decision = "accepted";
    record.packaged_follow_up_decision_items[0].accepted = true;
    record.packaged_follow_up_decision_items[0].implemented = true;
    record.a8_runtime_harness_8_2_decision_context.trigger_rows[0].accepted = true;
    record.summary.accepted_items = 1;
    record.summary.implemented_items = 1;
    record.summary.phase_conformance_accepted_items = 1;
    record.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: mutatedRecordPath,
      }),
    /EXIT-P1-1|decision|accepted|implemented/u,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record rejects source package mapping drift", () => {
  const mutatedRecordPath = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].source_package_item_id =
      "STREAM-FOLLOW-UP-PACKAGE-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: mutatedRecordPath,
      }),
    /source package item/u,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record rejects FR-015 or wrong group drift", () => {
  const fr015Path = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].fr_id = "FR-015";
  });
  const wrongGroupPath = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].review_group =
      "runtime_ux_repair";
  });

  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: fr015Path,
      }),
    /decision FR ids|FR-015/u,
  );
  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: wrongGroupPath,
      }),
    /review group/u,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].remaining_acceptance_blockers =
      [];
  });
  const missingEvidencePath = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: missingBlockerPath,
      }),
    /remaining acceptance blockers|remaining blockers/u,
  );
  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record rejects raw metadata and path leak markers", () => {
  const rawMetadataPath = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].raw_file_content = "unsafe";
    record.packaged_follow_up_decision_items[0].custom_value = "unsafe";
    record.packaged_follow_up_decision_items[0].destination_path = "unsafe";
    record.packaged_follow_up_decision_items[0].cache_path = "unsafe";
  });
  const pathValue = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].next_action_refs.push(
      "C:/Users/admin/secret-output/file.md",
    );
  });
  const cacheValue = writeMutatedDecisionRecord((record) => {
    record.packaged_follow_up_decision_items[0].next_action_refs.push(
      "cache/private/file",
    );
  });

  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: rawMetadataPath,
      }),
    /forbidden fragment/u,
  );
  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: pathValue,
      }),
    /forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        decisionRecordPath: cacheValue,
      }),
    /forbidden pattern/u,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record rejects source package status drift", () => {
  const mutatedStreamPath = writeMutatedStreamPackage((streamPackage) => {
    streamPackage.package_items[0].package_status = "accepted";
  });

  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        streamPackagePath: mutatedStreamPath,
      }),
    /source package status|packaged source status/u,
  );
});

test("M1.5 A4/A8 packaged follow-up decision record tolerates future ledger slices with retained evidence", () => {
  const readinessLedger = readJson(readinessLedgerPath);
  readinessLedger.slice = "W1.5.224";
  readinessLedger.next_recommended_slices = [
    {
      id: "W1.5.225",
      title: "future slice",
      reason: "W1.5.223 evidence retained while later ledger advances.",
    },
  ];
  const mutatedLedgerPath = writeJsonTemp(
    "cw-a4-a8-packaged-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );

  const summary = validateA4A8PackagedFollowUpDecisionRecord({
    readinessLedgerPath: mutatedLedgerPath,
  });

  assert.equal(summary.decisionItemCount, 11);
});

test("M1.5 A4/A8 packaged follow-up decision record test is wired into desktop package gates", () => {
  const record = readJson(decisionRecordPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-a8-packaged-follow-up-decision-record\.test\.cjs/u,
  );
  assert.equal(
    record.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-a8-packaged-follow-up-decision-record.test.cjs",
  );
  assert.equal(
    record.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-a8-packaged-follow-up-decision-record.cjs --check",
  );
  assert.deepEqual(
    record.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.224"],
  );
});

test("M1.5 A4/A8 packaged follow-up decision record validator rejects missing package gate wiring", () => {
  const missingWiringPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.scripts.test = desktopPackage.scripts.test.replace(
      " scripts/m1-5-a4-a8-packaged-follow-up-decision-record.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA4A8PackagedFollowUpDecisionRecord({
        desktopPackagePath: missingWiringPath,
      }),
    /desktop package gate wiring/u,
  );
});
