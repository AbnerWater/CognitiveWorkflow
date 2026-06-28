const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4RuntimeUxAcceptanceBlockerRepair,
} = require("./m1-5-a4-runtime-ux-acceptance-blocker-repair.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const runtimeRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-blocker-repair.json",
);
const blockerPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-blocker-repair-plan.json",
);
const postCaptureDecisionPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-decision-record.json",
);
const runtimeBridgeCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-bridge-user-path-capture.json",
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

function writeMutatedRuntimeRepair(mutator) {
  const artifact = readJson(runtimeRepairPath);
  mutator(artifact);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-a4-runtime-ux-repair-"),
  );
  const mutatedPath = path.join(tempDir, "runtime-ux-repair.json");
  fs.writeFileSync(mutatedPath, JSON.stringify(artifact, null, 2));
  return mutatedPath;
}

test("M1.5 A4 runtime UX blocker repair returns a conservative summary", () => {
  const summary = validateA4RuntimeUxAcceptanceBlockerRepair();

  assert.equal(
    summary.status,
    "a4_runtime_ux_acceptance_blocker_repair_executed_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.repairItemCount, 7);
  assert.equal(summary.runtimeUxRepairItemCount, 7);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.executedNotAcceptedItemCount, 7);
  assert.equal(summary.pendingA4DecisionItemCount, 7);
  assert.equal(summary.runtimeBridgeCaptureItemCount, 7);
  assert.equal(summary.commandEvidenceCount, 6);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedRuntimeUxFrIds));
  assert.deepEqual(
    sorted(summary.excludedTrackIds),
    sorted([
      "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
      "TRACK-A8-GIT-HISTORY-CONFORMANCE",
    ]),
  );
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.217"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 runtime UX blocker repair mirrors W1.5.214 runtime blockers", () => {
  const artifact = readJson(runtimeRepairPath);
  const blockerPlan = readJson(blockerPlanPath);
  const sourceRuntimeItems = blockerPlan.repair_items.filter(
    (item) => item.track_id === "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
  );

  assert.equal(artifact.slice, "W1.5.216");
  assert.equal(blockerPlan.slice, "W1.5.214");
  assert.deepEqual(
    sorted(
      artifact.repair_items.map((item) => item.source_blocker_repair_item_id),
    ),
    sorted(sourceRuntimeItems.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(artifact.repair_items.map((item) => item.fr_id)),
    sorted(expectedRuntimeUxFrIds),
  );

  const sourceById = new Map(sourceRuntimeItems.map((item) => [item.id, item]));
  for (const item of artifact.repair_items) {
    const source = sourceById.get(item.source_blocker_repair_item_id);
    assert.equal(source.implementation_status, "planned_not_implemented");
    assert.equal(item.source_implementation_status, "planned_not_implemented");
    assert.deepEqual(
      item.source_acceptance_blockers,
      source.acceptance_blockers,
    );
    assert.equal(item.repair_status, "executed_not_accepted");
  }
});

test("M1.5 A4 runtime UX blocker repair mirrors W1.5.213 and W1.5.211 sources", () => {
  const artifact = readJson(runtimeRepairPath);
  const postCaptureDecision = readJson(postCaptureDecisionPath);
  const runtimeBridgeCapture = readJson(runtimeBridgeCapturePath);
  const postCaptureById = new Map(
    postCaptureDecision.post_capture_decision_items.map((item) => [
      item.id,
      item,
    ]),
  );
  const runtimeCaptureById = new Map(
    runtimeBridgeCapture.runtime_bridge_capture_items.map((item) => [
      item.id,
      item,
    ]),
  );

  assert.equal(postCaptureDecision.slice, "W1.5.213");
  assert.equal(runtimeBridgeCapture.slice, "W1.5.211");
  for (const item of artifact.repair_items) {
    const postCapture = postCaptureById.get(
      item.source_post_capture_decision_id,
    );
    const runtimeCaptureItem = runtimeCaptureById.get(
      item.source_runtime_bridge_capture_item_id,
    );
    assert.equal(postCapture.post_capture_decision, "needs_followup");
    assert.equal(
      runtimeCaptureItem.user_path_capture_status,
      "executed_not_accepted",
    );
    assert.equal(postCapture.fr_id, item.fr_id);
    assert.equal(runtimeCaptureItem.fr_id, item.fr_id);
  }
});

test("M1.5 A4 runtime UX blocker repair excludes stream, A8, and FR-015 scope", () => {
  const artifact = readJson(runtimeRepairPath);

  assert.equal(
    artifact.repair_items.every((item) =>
      expectedRuntimeUxFrIds.includes(item.fr_id),
    ),
    true,
  );
  assert.equal(
    artifact.repair_items.some((item) => item.fr_id === "FR-015"),
    false,
  );
  assert.deepEqual(
    sorted(
      artifact.excluded_items
        .filter((item) => item.track_id !== undefined)
        .map((item) => item.track_id),
    ),
    sorted([
      "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
      "TRACK-A8-GIT-HISTORY-CONFORMANCE",
    ]),
  );
  assert.deepEqual(
    artifact.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    ["FR-015"],
  );
});

test("M1.5 A4 runtime UX blocker repair keeps pending reviewer decisions", () => {
  const artifact = readJson(runtimeRepairPath);

  assert.equal(artifact.summary.accepted_items, 0);
  assert.equal(artifact.summary.implemented_items, 0);
  assert.equal(artifact.summary.pending_a4_decision_items, 7);
  assert.equal(
    artifact.repair_items.every(
      (item) =>
        item.accepted === false &&
        item.implemented === false &&
        item.acceptance_decision_status === "pending_reviewer_decision" &&
        item.reviewer_decision_required === true,
    ),
    true,
  );
});

test("M1.5 A4 runtime UX blocker repair rejects accepted or implemented drift", () => {
  const mutatedPath = writeMutatedRuntimeRepair((artifact) => {
    artifact.repair_items[0].accepted = true;
    artifact.repair_items[0].implemented = true;
    artifact.summary.accepted_items = 1;
    artifact.summary.implemented_items = 1;
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceBlockerRepair({
        runtimeRepairPath: mutatedPath,
      }),
    /accepted|implemented/u,
  );
});

test("M1.5 A4 runtime UX blocker repair rejects non-runtime FR drift", () => {
  const mutatedPath = writeMutatedRuntimeRepair((artifact) => {
    artifact.repair_items[0].fr_id = "FR-009";
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceBlockerRepair({
        runtimeRepairPath: mutatedPath,
      }),
    /repair item FR ids|source blocker FR/u,
  );
});

test("M1.5 A4 runtime UX blocker repair rejects missing blockers or commands", () => {
  const missingBlockersPath = writeMutatedRuntimeRepair((artifact) => {
    artifact.repair_items[0].remaining_acceptance_blockers = [];
  });
  const missingCommandsPath = writeMutatedRuntimeRepair((artifact) => {
    artifact.repair_items[0].verification_commands = [];
  });

  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceBlockerRepair({
        runtimeRepairPath: missingBlockersPath,
      }),
    /remaining acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4RuntimeUxAcceptanceBlockerRepair({
        runtimeRepairPath: missingCommandsPath,
      }),
    /verification commands/u,
  );
});

test("M1.5 A4 runtime UX blocker repair test is wired into desktop package gates", () => {
  const artifact = readJson(runtimeRepairPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-runtime-ux-acceptance-blocker-repair\.test\.cjs/u,
  );
  assert.deepEqual(
    artifact.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.217"],
  );
});
