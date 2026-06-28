const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4RuntimeUxAcceptanceFollowUpPackage,
} = require("./m1-5-a4-runtime-ux-acceptance-follow-up-package.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const followUpPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-follow-up-package.json",
);
const followUpPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-follow-up-plan.json",
);
const runtimeUxRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-blocker-repair.json",
);
const runtimeBridgeCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-bridge-user-path-capture.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedRuntimeUxFrIds = [
  "FR-007",
  "FR-008",
  "FR-011",
  "FR-013",
  "FR-014",
  "FR-017",
  "FR-018",
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
    "cw-a4-runtime-followup-",
    "runtime-follow-up-package.json",
    followUpPackage,
  );
}

function writeMutatedRuntimeBridgeCapture(mutator) {
  const runtimeBridgeCapture = readJson(runtimeBridgeCapturePath);
  mutator(runtimeBridgeCapture);
  return writeJsonTemp(
    "cw-a4-runtime-followup-capture-",
    "runtime-bridge-capture.json",
    runtimeBridgeCapture,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a4-runtime-followup-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A4 runtime UX acceptance follow-up package returns a conservative summary", () => {
  const summary = validateA4RuntimeUxAcceptanceFollowUpPackage();

  assert.equal(
    summary.status,
    "a4_runtime_ux_acceptance_follow_up_package_packaged_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.packageItemCount, 7);
  assert.equal(summary.runtimeUxPackageItemCount, 7);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.packagedNotAcceptedItemCount, 7);
  assert.equal(summary.pendingA4DecisionItemCount, 7);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedRuntimeUxFrIds));
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.222"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 runtime UX acceptance follow-up package mirrors W1.5.219 runtime follow-up items", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const followUpPlan = readJson(followUpPlanPath);
  const sourceRuntimeItems = followUpPlan.follow_up_items.filter(
    (item) => item.track_id === "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP",
  );

  assert.equal(followUpPackage.slice, "W1.5.221");
  assert.equal(followUpPlan.slice, "W1.5.219");
  assert.deepEqual(
    sorted(
      followUpPackage.package_items.map(
        (item) => item.source_follow_up_item_id,
      ),
    ),
    sorted(sourceRuntimeItems.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(followUpPackage.package_items.map((item) => item.fr_id)),
    sorted(expectedRuntimeUxFrIds),
  );
  assert.equal(
    followUpPackage.package_items.every(
      (item) =>
        item.package_status === "packaged_not_accepted" &&
        item.source_follow_up_status === "planned_not_implemented" &&
        item.source_decision === "needs_followup" &&
        item.source_repair_status === "executed_not_accepted" &&
        item.source_capture_status === "executed_not_accepted" &&
        item.accepted === false &&
        item.implemented === false,
    ),
    true,
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package mirrors runtime repair and capture source ids", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const runtimeUxRepair = readJson(runtimeUxRepairPath);
  const runtimeBridgeCapture = readJson(runtimeBridgeCapturePath);

  assert.deepEqual(
    sorted(
      followUpPackage.package_items.map((item) => item.source_repair_item_id),
    ),
    sorted(runtimeUxRepair.repair_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(
      followUpPackage.package_items.map(
        (item) => item.source_runtime_bridge_capture_item_id,
      ),
    ),
    sorted(
      runtimeBridgeCapture.runtime_bridge_capture_items.map((item) => item.id),
    ),
  );
  assert.equal(
    followUpPackage.track_execution.source_track_id,
    "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP",
  );
  assert.deepEqual(
    sorted(followUpPackage.track_execution.fr_ids),
    sorted(expectedRuntimeUxFrIds),
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package rejects accepted or implemented drift", () => {
  const mutatedPackagePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].accepted = true;
    followUpPackage.package_items[0].implemented = true;
    followUpPackage.summary.accepted_items = 1;
    followUpPackage.summary.implemented_items = 1;
    followUpPackage.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: mutatedPackagePath,
      }),
    /EXIT-P1-1|accepted|implemented/u,
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package rejects source mapping drift", () => {
  const mutatedPackagePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].source_follow_up_item_id =
      "FOLLOW-UP-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: mutatedPackagePath,
      }),
    /source follow-up item ids|source follow-up/u,
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package rejects stream or FR-015 drift", () => {
  const fr015Path = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].fr_id = "FR-015";
  });
  const streamPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].review_group = "stream_acceptance_repair";
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: fr015Path,
      }),
    /package FR ids|FR-015/u,
  );
  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: streamPath,
      }),
    /review group/u,
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].remaining_acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: missingBlockerPath,
      }),
    /remaining acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package rejects raw metadata and path leak markers", () => {
  const rawMetadataPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].custom_value = "unsafe";
    followUpPackage.package_items[0].instruction_text = "unsafe";
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
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: rawMetadataPath,
      }),
    /forbidden fragment/u,
  );
  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: pathValue,
      }),
    /forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeUxFollowUpPackagePath: cacheValue,
      }),
    /forbidden pattern/u,
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package rejects missing W1.5.211 capture mapping", () => {
  const missingCapturePath = writeMutatedRuntimeBridgeCapture(
    (runtimeBridgeCapture) => {
      runtimeBridgeCapture.runtime_bridge_capture_items = [];
    },
  );

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        runtimeBridgeCapturePath: missingCapturePath,
      }),
    /runtime bridge capture source/u,
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package tolerates future ledger slices with retained evidence", () => {
  const readinessLedger = readJson(readinessLedgerPath);
  readinessLedger.slice = "W1.5.222";
  readinessLedger.next_recommended_slices = [
    {
      id: "W1.5.223",
      title: "future slice",
      reason: "W1.5.221 evidence retained while later ledger advances.",
    },
  ];
  const mutatedLedgerPath = writeJsonTemp(
    "cw-a4-runtime-followup-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );

  const summary = validateA4RuntimeUxAcceptanceFollowUpPackage({
    readinessLedgerPath: mutatedLedgerPath,
  });

  assert.equal(summary.packageItemCount, 7);
});

test("M1.5 A4 runtime UX acceptance follow-up package test is wired into desktop package gates", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-runtime-ux-acceptance-follow-up-package\.test\.cjs/u,
  );
  assert.equal(
    followUpPackage.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-runtime-ux-acceptance-follow-up-package.test.cjs",
  );
  assert.deepEqual(
    followUpPackage.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.222"],
  );
});

test("M1.5 A4 runtime UX acceptance follow-up package validator rejects missing package gate wiring", () => {
  const missingWiringPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.scripts.test = desktopPackage.scripts.test.replace(
      " scripts/m1-5-a4-runtime-ux-acceptance-follow-up-package.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceFollowUpPackage({
        desktopPackagePath: missingWiringPath,
      }),
    /desktop package gate wiring/u,
  );
});
