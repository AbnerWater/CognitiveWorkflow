const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4PostCaptureBlockerRepairPlan,
} = require("./m1-5-a4-post-capture-blocker-repair-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const blockerRepairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-blocker-repair-plan.json",
);
const postCaptureDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-decision-record.json",
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
const expectedFrIds = [
  ...expectedStreamFrIds,
  ...expectedRuntimeUxFrIds,
  "FR-012",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedBlockerRepairPlan(mutator) {
  const plan = readJson(blockerRepairPlanPath);
  mutator(plan);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-a4-blockers-"));
  const mutatedPlanPath = path.join(tempDir, "blocker-repair-plan.json");
  fs.writeFileSync(mutatedPlanPath, JSON.stringify(plan, null, 2));
  return mutatedPlanPath;
}

test("M1.5 A4 post-capture blocker repair plan returns a conservative summary", () => {
  const summary = validateA4PostCaptureBlockerRepairPlan();

  assert.equal(
    summary.status,
    "a4_post_capture_blocker_repair_plan_prepared_not_implemented",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.repairItemCount, 11);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedFrIds));
  assert.equal(
    summary.streamFinalAcceptanceItemCount,
    expectedStreamFrIds.length,
  );
  assert.equal(
    summary.runtimeUxFinalAcceptanceItemCount,
    expectedRuntimeUxFrIds.length,
  );
  assert.equal(summary.gitHistoryConformanceItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.plannedNotImplementedItemCount, 11);
  assert.equal(summary.excludedItemCount, 1);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.215"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 post-capture blocker repair plan mirrors W1.5.213 source decisions", () => {
  const plan = readJson(blockerRepairPlanPath);
  const source = readJson(postCaptureDecisionRecordPath);

  assert.equal(plan.slice, "W1.5.214");
  assert.equal(source.slice, "W1.5.213");
  assert.deepEqual(
    sorted(
      plan.repair_items.map((item) => item.source_post_capture_decision_id),
    ),
    sorted(source.post_capture_decision_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(plan.repair_items.map((item) => item.fr_id)),
    sorted(source.post_capture_decision_items.map((item) => item.fr_id)),
  );

  const sourceById = new Map(
    source.post_capture_decision_items.map((item) => [item.id, item]),
  );
  for (const item of plan.repair_items) {
    const sourceItem = sourceById.get(item.source_post_capture_decision_id);
    assert.equal(sourceItem.post_capture_decision, "needs_followup");
    assert.equal(item.source_post_capture_decision, "needs_followup");
    assert.deepEqual(
      item.acceptance_blockers,
      sourceItem.remaining_acceptance_blockers,
    );
  }
});

test("M1.5 A4 post-capture blocker repair plan groups every item into planned tracks", () => {
  const plan = readJson(blockerRepairPlanPath);
  const tracksById = new Map(
    plan.repair_tracks.map((track) => [track.id, track]),
  );

  assert.deepEqual(
    sorted(plan.repair_tracks.map((track) => track.id)),
    sorted([
      "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
      "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
      "TRACK-A8-GIT-HISTORY-CONFORMANCE",
    ]),
  );
  for (const item of plan.repair_items) {
    const track = tracksById.get(item.track_id);
    assert.equal(track.status, "planned_not_implemented");
    assert.equal(track.fr_ids.includes(item.fr_id), true);
    assert.equal(item.implementation_status, "planned_not_implemented");
  }
});

test("M1.5 A4 post-capture blocker repair plan keeps every item unaccepted and unimplemented", () => {
  const plan = readJson(blockerRepairPlanPath);

  assert.equal(plan.summary.accepted_items, 0);
  assert.equal(plan.summary.implemented_items, 0);
  assert.equal(plan.summary.planned_not_implemented_items, 11);
  assert.equal(
    plan.repair_items.every(
      (item) =>
        item.accepted === false &&
        item.implemented === false &&
        item.implementation_status === "planned_not_implemented",
    ),
    true,
  );
});

test("M1.5 A4 post-capture blocker repair plan rejects accepted or implemented drift", () => {
  const mutatedPlanPath = writeMutatedBlockerRepairPlan((plan) => {
    plan.repair_items[0].accepted = true;
    plan.repair_items[0].implemented = true;
  });

  assert.throws(
    () =>
      validateA4PostCaptureBlockerRepairPlan({
        blockerRepairPlanPath: mutatedPlanPath,
      }),
    /accepted/u,
  );
});

test("M1.5 A4 post-capture blocker repair plan rejects FR-015 in repair scope", () => {
  const mutatedPlanPath = writeMutatedBlockerRepairPlan((plan) => {
    plan.repair_items[0].fr_id = "FR-015";
  });

  assert.throws(
    () =>
      validateA4PostCaptureBlockerRepairPlan({
        blockerRepairPlanPath: mutatedPlanPath,
      }),
    /repair item FR ids|FR-015 repair absence/u,
  );
});

test("M1.5 A4 post-capture blocker repair plan rejects missing blockers or commands", () => {
  const missingBlockersPath = writeMutatedBlockerRepairPlan((plan) => {
    plan.repair_items[0].acceptance_blockers = [];
  });
  const missingCommandsPath = writeMutatedBlockerRepairPlan((plan) => {
    plan.repair_items[0].verification_commands = [];
  });

  assert.throws(
    () =>
      validateA4PostCaptureBlockerRepairPlan({
        blockerRepairPlanPath: missingBlockersPath,
      }),
    /acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4PostCaptureBlockerRepairPlan({
        blockerRepairPlanPath: missingCommandsPath,
      }),
    /verification commands/u,
  );
});

test("M1.5 A4 post-capture blocker repair plan test is wired into desktop package gates", () => {
  const plan = readJson(blockerRepairPlanPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-post-capture-blocker-repair-plan\.test\.cjs/u,
  );
  assert.equal(
    plan.next_recommended_slices.map((slice) => slice.id).join(","),
    "W1.5.215",
  );
});
