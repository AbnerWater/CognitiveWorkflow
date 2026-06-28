const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4StreamAcceptanceFollowUpPackage,
} = require("./m1-5-a4-stream-acceptance-follow-up-package.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const followUpPackagePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-follow-up-package.json",
);
const followUpPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-follow-up-plan.json",
);
const streamRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-blocker-repair.json",
);
const streamCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-phase-capture-execution.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];

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
    "cw-a4-stream-followup-",
    "stream-follow-up-package.json",
    followUpPackage,
  );
}

function writeMutatedStreamCapture(mutator) {
  const streamCapture = readJson(streamCapturePath);
  mutator(streamCapture);
  return writeJsonTemp(
    "cw-a4-stream-followup-capture-",
    "stream-capture.json",
    streamCapture,
  );
}

function writeMutatedDesktopPackage(mutator) {
  const desktopPackage = readJson(desktopPackagePath);
  mutator(desktopPackage);
  return writeJsonTemp(
    "cw-a4-stream-followup-package-json-",
    "package.json",
    desktopPackage,
  );
}

test("M1.5 A4 stream acceptance follow-up package returns a conservative summary", () => {
  const summary = validateA4StreamAcceptanceFollowUpPackage();

  assert.equal(
    summary.status,
    "a4_stream_acceptance_follow_up_package_packaged_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.packageItemCount, 3);
  assert.equal(summary.streamAcceptancePackageItemCount, 3);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.packagedNotAcceptedItemCount, 3);
  assert.equal(summary.pendingA4DecisionItemCount, 3);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedStreamFrIds));
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.221"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 stream acceptance follow-up package mirrors W1.5.219 stream follow-up items", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const followUpPlan = readJson(followUpPlanPath);
  const sourceStreamItems = followUpPlan.follow_up_items.filter(
    (item) => item.track_id === "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
  );

  assert.equal(followUpPackage.slice, "W1.5.220");
  assert.equal(followUpPlan.slice, "W1.5.219");
  assert.deepEqual(
    sorted(
      followUpPackage.package_items.map(
        (item) => item.source_follow_up_item_id,
      ),
    ),
    sorted(sourceStreamItems.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(followUpPackage.package_items.map((item) => item.fr_id)),
    sorted(expectedStreamFrIds),
  );
  assert.equal(
    followUpPackage.package_items.every(
      (item) =>
        item.package_status === "packaged_not_accepted" &&
        item.source_follow_up_status === "planned_not_implemented" &&
        item.source_decision === "needs_followup" &&
        item.source_repair_status === "executed_not_accepted" &&
        item.accepted === false &&
        item.implemented === false,
    ),
    true,
  );
});

test("M1.5 A4 stream acceptance follow-up package mirrors stream repair source ids", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const streamRepair = readJson(streamRepairPath);

  assert.deepEqual(
    sorted(
      followUpPackage.package_items.map((item) => item.source_repair_item_id),
    ),
    sorted(streamRepair.repair_items.map((item) => item.id)),
  );
  assert.equal(
    followUpPackage.track_execution.source_track_id,
    "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
  );
  assert.deepEqual(
    sorted(followUpPackage.track_execution.fr_ids),
    sorted(expectedStreamFrIds),
  );
});

test("M1.5 A4 stream acceptance follow-up package rejects accepted or implemented drift", () => {
  const mutatedPackagePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].accepted = true;
    followUpPackage.package_items[0].implemented = true;
    followUpPackage.summary.accepted_items = 1;
    followUpPackage.summary.implemented_items = 1;
    followUpPackage.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: mutatedPackagePath,
      }),
    /EXIT-P1-1|accepted|implemented/u,
  );
});

test("M1.5 A4 stream acceptance follow-up package rejects source mapping drift", () => {
  const mutatedPackagePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].source_follow_up_item_id =
      "FOLLOW-UP-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: mutatedPackagePath,
      }),
    /source follow-up item ids|source follow-up/u,
  );
});

test("M1.5 A4 stream acceptance follow-up package rejects runtime or FR-015 drift", () => {
  const fr015Path = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].fr_id = "FR-015";
  });
  const runtimePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].review_group = "runtime_ux_repair";
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: fr015Path,
      }),
    /package FR ids|FR-015/u,
  );
  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: runtimePath,
      }),
    /review group/u,
  );
});

test("M1.5 A4 stream acceptance follow-up package rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].remaining_acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: missingBlockerPath,
      }),
    /remaining acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4 stream acceptance follow-up package rejects raw metadata leak markers", () => {
  const rawMetadataPath = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].custom_value = "unsafe";
    followUpPackage.package_items[0].instruction_text = "unsafe";
    followUpPackage.package_items[0].destination_path = "unsafe";
    followUpPackage.package_items[0].cache_path = "unsafe";
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: rawMetadataPath,
      }),
    /forbidden fragment/u,
  );
});

test("M1.5 A4 stream acceptance follow-up package rejects slash-form local path values", () => {
  const localPathValue = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].package_actions_executed.push(
      "C:/Users/admin/secret-output/file.md",
    );
  });
  const cachePathValue = writeMutatedFollowUpPackage((followUpPackage) => {
    followUpPackage.package_items[0].package_actions_executed.push(
      "cache/private/file",
    );
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: localPathValue,
      }),
    /forbidden pattern/u,
  );
  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamFollowUpPackagePath: cachePathValue,
      }),
    /forbidden pattern/u,
  );
});

test("M1.5 A4 stream acceptance follow-up package rejects missing W1.5.210 source capture mapping", () => {
  const missingCapturePath = writeMutatedStreamCapture((streamCapture) => {
    streamCapture.phase_capture_items = [];
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        streamCapturePath: missingCapturePath,
      }),
    /stream phase capture source/u,
  );
});

test("M1.5 A4 stream acceptance follow-up package tolerates future ledger slices with retained evidence", () => {
  const readinessLedger = readJson(readinessLedgerPath);
  readinessLedger.slice = "W1.5.221";
  readinessLedger.next_recommended_slices = [
    {
      id: "W1.5.222",
      title: "future slice",
      reason: "W1.5.220 evidence retained while later ledger advances.",
    },
  ];
  const mutatedLedgerPath = writeJsonTemp(
    "cw-a4-stream-followup-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );

  const summary = validateA4StreamAcceptanceFollowUpPackage({
    readinessLedgerPath: mutatedLedgerPath,
  });

  assert.equal(summary.packageItemCount, 3);
});

test("M1.5 A4 stream acceptance follow-up package test is wired into desktop package gates", () => {
  const followUpPackage = readJson(followUpPackagePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-stream-acceptance-follow-up-package\.test\.cjs/u,
  );
  assert.equal(
    followUpPackage.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-stream-acceptance-follow-up-package.test.cjs",
  );
  assert.deepEqual(
    followUpPackage.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.221"],
  );
});

test("M1.5 A4 stream acceptance follow-up package validator rejects missing package gate wiring", () => {
  const missingWiringPath = writeMutatedDesktopPackage((desktopPackage) => {
    desktopPackage.scripts.test = desktopPackage.scripts.test.replace(
      " scripts/m1-5-a4-stream-acceptance-follow-up-package.test.cjs",
      "",
    );
  });

  assert.throws(
    () =>
      validateA4StreamAcceptanceFollowUpPackage({
        desktopPackagePath: missingWiringPath,
      }),
    /desktop package gate wiring/u,
  );
});
