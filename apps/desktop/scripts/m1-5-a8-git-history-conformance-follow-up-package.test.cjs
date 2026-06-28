const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA8GitHistoryConformanceFollowUpPackage,
} = require("./m1-5-a8-git-history-conformance-follow-up-package.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const followUpPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-follow-up-package.json",
);
const followUpPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-follow-up-plan.json",
);
const gitHistoryRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-blocker-repair.json",
);
const gitHistoryPrerequisitePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-prerequisite-evidence.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

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

function writeMutatedFollowUpPackage(mutator) {
  const followUpPackage = readJson(followUpPackagePath);
  mutator(followUpPackage);
  return writeJsonTemp(
    "cw-a8-followup-",
    "git-history-follow-up-package.json",
    followUpPackage,
  );
}

function writeMutatedGitHistoryPrerequisite(mutator) {
  const prerequisite = readJson(gitHistoryPrerequisitePath);
  mutator(prerequisite);
  return writeJsonTemp(
    "cw-a8-followup-prereq-",
    "git-history-prerequisite.json",
    prerequisite,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a8-followup-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A8 Git-history conformance follow-up package returns a conservative summary", () => {
  const summary = validateA8GitHistoryConformanceFollowUpPackage();

  assert.equal(
    summary.status,
    "a8_git_history_conformance_follow_up_package_packaged_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.packageItemCount, 1);
  assert.equal(summary.gitHistoryPackageItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.packagedNotAcceptedItemCount, 1);
  assert.equal(summary.pendingA8DecisionItemCount, 1);
  assert.equal(summary.runtimeHarness8_2TriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItemCount, 0);
  assert.deepEqual(summary.frIds, ["FR-012"]);
  assert.deepEqual(
    sorted(summary.carriedForwardTriggerIds),
    expectedCarriedForwardTriggerIds,
  );
  assert.deepEqual(
    sorted(summary.deferredTriggerIds),
    expectedDeferredTriggerIds,
  );
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.223"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A8 Git-history conformance follow-up package mirrors W1.5.219 A8 follow-up item", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const followUpPlan = readJson(followUpPlanPath);
  const sourceA8Items = followUpPlan.follow_up_items.filter(
    (item) => item.track_id === "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP",
  );

  assert.equal(followUpPackage.slice, "W1.5.222");
  assert.equal(followUpPlan.slice, "W1.5.219");
  assert.deepEqual(
    followUpPackage.package_items.map((item) => item.source_follow_up_item_id),
    sourceA8Items.map((item) => item.id),
  );
  assert.deepEqual(
    followUpPackage.package_items.map((item) => item.fr_id),
    ["FR-012"],
  );
  assert.equal(
    followUpPackage.package_items.every(
      (item) =>
        item.package_status === "packaged_not_accepted" &&
        item.source_follow_up_status === "planned_not_implemented" &&
        item.source_decision === "needs_followup" &&
        item.source_repair_status === "executed_not_accepted" &&
        item.source_prerequisite_status ===
          "audit_evidence_recorded_not_accepted" &&
        item.accepted === false &&
        item.implemented === false &&
        item.phase_exit_decision_status === "not_ready",
    ),
    true,
  );
});

test("M1.5 A8 Git-history conformance follow-up matrix mirrors W1.5.217 and W1.5.212 sources", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const gitHistoryRepair = readJson(gitHistoryRepairPath);
  const gitHistoryPrerequisite = readJson(gitHistoryPrerequisitePath);

  assert.deepEqual(
    followUpPackage.runtime_harness_8_2_follow_up_matrix.map((row) => row.id),
    gitHistoryRepair.runtime_harness_8_2_conformance_matrix.map(
      (row) => row.id,
    ),
  );
  assert.deepEqual(
    followUpPackage.runtime_harness_8_2_follow_up_matrix.map(
      (row) => row.source_evidence_status,
    ),
    gitHistoryPrerequisite.runtime_harness_8_2_trigger_audit.trigger_rows.map(
      (row) => row.evidence_status,
    ),
  );
  assert.deepEqual(
    sorted(
      followUpPackage.runtime_harness_8_2_follow_up_matrix
        .filter(
          (row) =>
            row.conformance_disposition ===
            "evidence_carried_forward_not_phase_accepted",
        )
        .map((row) => row.id),
    ),
    expectedCarriedForwardTriggerIds,
  );
  assert.deepEqual(
    sorted(
      followUpPackage.runtime_harness_8_2_follow_up_matrix
        .filter(
          (row) =>
            row.conformance_disposition ===
            "explicitly_deferred_not_implemented",
        )
        .map((row) => row.id),
    ),
    expectedDeferredTriggerIds,
  );
});

test("M1.5 A8 Git-history conformance follow-up package rejects accepted or implemented drift", () => {
  const mutatedPackagePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].accepted = true;
    followUpPackage.package_items[0].implemented = true;
    followUpPackage.runtime_harness_8_2_follow_up_matrix[0].accepted = true;
    followUpPackage.summary.accepted_items = 1;
    followUpPackage.summary.implemented_items = 1;
    followUpPackage.summary.phase_conformance_accepted_items = 1;
    followUpPackage.exit_p1_10_status = "ready";
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: mutatedPackagePath,
      }),
    /EXIT-P1-10|accepted|implemented/u,
  );
});

test("M1.5 A8 Git-history conformance follow-up package rejects source mapping drift", () => {
  const mutatedPackagePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].source_repair_item_id =
      "A8-BLOCKER-REPAIR-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: mutatedPackagePath,
      }),
    /source A8 repair item|source repair/u,
  );
});

test("M1.5 A8 Git-history conformance follow-up package rejects stream runtime or FR-015 drift", () => {
  const fr015Path = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].fr_id = "FR-015";
  });
  const streamPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].review_group = "stream_acceptance_repair";
  });
  const runtimePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].review_group = "runtime_ux_repair";
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: fr015Path,
      }),
    /package FR ids|FR-015/u,
  );
  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: streamPath,
      }),
    /review group/u,
  );
  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: runtimePath,
      }),
    /review group/u,
  );
});

test("M1.5 A8 Git-history conformance follow-up package rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].remaining_acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: missingBlockerPath,
      }),
    /remaining acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: missingEvidencePath,
      }),
    /package evidence ref/u,
  );
});

test("M1.5 A8 Git-history conformance follow-up package rejects raw metadata and path leak markers", () => {
  const rawMetadataPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].raw_file_content = "unsafe";
    followUpPackage.package_items[0].custom_value = "unsafe";
    followUpPackage.package_items[0].destination_path = "unsafe";
    followUpPackage.package_items[0].cache_path = "unsafe";
  });
  const pathValue = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].package_actions_executed.push(
      "C:/Users/admin/secret-output/file.md",
    );
  });
  const cacheValue = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].package_actions_executed.push(
      "cache/private/file",
    );
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: rawMetadataPath,
      }),
    /forbidden fragment/u,
  );
  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: pathValue,
      }),
    /forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: cacheValue,
      }),
    /forbidden pattern/u,
  );
});

test("M1.5 A8 Git-history conformance follow-up package rejects trigger row drift", () => {
  const missingRowPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.runtime_harness_8_2_follow_up_matrix.pop();
  });
  const missingDeferralPath = writeMutatedFollowUpPackage((followUpPackage) => {
    const deferredRow =
      followUpPackage.runtime_harness_8_2_follow_up_matrix.find(
        (row) =>
          row.conformance_disposition === "explicitly_deferred_not_implemented",
      );
    delete deferredRow.deferred_reason;
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: missingRowPath,
      }),
    /trigger row order/u,
  );
  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryFollowUpPackagePath: missingDeferralPath,
      }),
    /deferred reason/u,
  );
});

test("M1.5 A8 Git-history conformance follow-up package rejects prerequisite trigger status drift", () => {
  const driftedPrerequisitePath = writeMutatedGitHistoryPrerequisite(
    (prerequisite) => {
      prerequisite.runtime_harness_8_2_trigger_audit.trigger_rows[0].evidence_status =
        "evidence_available";
    },
  );

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        gitHistoryPrerequisitePath: driftedPrerequisitePath,
      }),
    /prerequisite evidence status/u,
  );
});

test("M1.5 A8 Git-history conformance follow-up package tolerates future ledger slices with retained evidence", () => {
  const readinessLedger = readJson(readinessLedgerPath);
  readinessLedger.slice = "W1.5.223";
  readinessLedger.next_recommended_slices = [
    {
      id: "W1.5.224",
      title: "future slice",
      reason: "W1.5.222 evidence retained while later ledger advances.",
    },
  ];
  const mutatedLedgerPath = writeJsonTemp(
    "cw-a8-followup-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );

  const summary = validateA8GitHistoryConformanceFollowUpPackage({
    readinessLedgerPath: mutatedLedgerPath,
  });

  assert.equal(summary.packageItemCount, 1);
});

test("M1.5 A8 Git-history conformance follow-up package test is wired into desktop package gates", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a8-git-history-conformance-follow-up-package\.test\.cjs/u,
  );
  assert.equal(
    followUpPackage.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a8-git-history-conformance-follow-up-package.test.cjs",
  );
  assert.deepEqual(
    followUpPackage.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.223"],
  );
});

test("M1.5 A8 Git-history conformance follow-up package validator rejects missing package gate wiring", () => {
  const missingWiringPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.scripts.test = desktopPackage.scripts.test.replace(
      " scripts/m1-5-a8-git-history-conformance-follow-up-package.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceFollowUpPackage({
        desktopPackagePath: missingWiringPath,
      }),
    /desktop package gate wiring/u,
  );
});
