const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4NeedsFollowupRepairPlan,
} = require("./m1-5-a4-needs-followup-repair-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const repairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-needs-followup-repair-plan.json",
);
const decisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-flow-decision-record.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedFrIds = [
  "FR-007",
  "FR-008",
  "FR-009",
  "FR-010",
  "FR-011",
  "FR-012",
  "FR-013",
  "FR-014",
  "FR-016",
  "FR-017",
  "FR-018",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedRepairPlan(mutator) {
  const repairPlan = readJson(repairPlanPath);
  mutator(repairPlan);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-a4-repair-"));
  const mutatedRepairPlanPath = path.join(tempDir, "repair-plan.json");
  fs.writeFileSync(mutatedRepairPlanPath, JSON.stringify(repairPlan, null, 2));
  return mutatedRepairPlanPath;
}

test("M1.5 A4 needs-followup repair plan returns a conservative summary", () => {
  const summary = validateA4NeedsFollowupRepairPlan();

  assert.equal(
    summary.status,
    "a4_needs_followup_repair_plan_prepared_not_implemented",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.repairItemCount, 11);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedFrIds));
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.plannedNotImplementedItemCount, 11);
  assert.deepEqual(summary.excludedFrIds, ["FR-015"]);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.210"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 needs-followup repair plan mirrors the decision record", () => {
  const repairPlan = readJson(repairPlanPath);
  const decisionRecord = readJson(decisionRecordPath);

  assert.equal(repairPlan.slice, "W1.5.209");
  assert.equal(decisionRecord.slice, "W1.5.208");
  assert.deepEqual(
    sorted(repairPlan.repair_items.map((item) => item.source_decision_id)),
    sorted(decisionRecord.decision_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(repairPlan.repair_items.map((item) => item.fr_id)),
    sorted(expectedFrIds),
  );
  assert.equal(
    repairPlan.repair_items.every(
      (item) =>
        item.source_decision === "needs_followup" &&
        item.implementation_status === "planned_not_implemented",
    ),
    true,
  );
});

test("M1.5 A4 needs-followup repair plan groups every item into a planned track", () => {
  const repairPlan = readJson(repairPlanPath);
  const tracksById = new Map(
    repairPlan.repair_tracks.map((track) => [track.id, track]),
  );

  assert.deepEqual(
    sorted([...tracksById.keys()]),
    sorted([
      "TRACK-A4-STREAM-PHASE-CAPTURE",
      "TRACK-A4-RUNTIME-BRIDGE-CAPTURE",
      "TRACK-A8-GIT-HISTORY-PREREQ",
    ]),
  );
  for (const repairItem of repairPlan.repair_items) {
    const track = tracksById.get(repairItem.track_id);
    assert.ok(track, `${repairItem.id} track exists`);
    assert.equal(track.fr_ids.includes(repairItem.fr_id), true);
  }
});

test("M1.5 A4 needs-followup repair plan rejects accepted item drift", () => {
  const mutatedRepairPlanPath = writeMutatedRepairPlan((repairPlan) => {
    repairPlan.summary.accepted_items = 1;
  });

  assert.throws(
    () =>
      validateA4NeedsFollowupRepairPlan({
        repairPlanPath: mutatedRepairPlanPath,
      }),
    /summary accepted items/u,
  );
});

test("M1.5 A4 needs-followup repair plan rejects implemented item drift", () => {
  const mutatedRepairPlanPath = writeMutatedRepairPlan((repairPlan) => {
    repairPlan.repair_items[0].implementation_status = "implemented";
  });

  assert.throws(
    () =>
      validateA4NeedsFollowupRepairPlan({
        repairPlanPath: mutatedRepairPlanPath,
      }),
    /implementation status/u,
  );
});

test("M1.5 A4 needs-followup repair plan rejects FR-015 repair drift", () => {
  const mutatedRepairPlanPath = writeMutatedRepairPlan((repairPlan) => {
    repairPlan.repair_items.push({
      ...repairPlan.repair_items[0],
      id: "REPAIR-A4-FR-015-SNAPSHOT-RESTORE",
      fr_id: "FR-015",
      source_decision_id: "DECISION-A4-FR-015-SNAPSHOT-RESTORE",
    });
    repairPlan.summary.repair_item_count += 1;
    repairPlan.summary.planned_not_implemented_items += 1;
  });

  assert.throws(
    () =>
      validateA4NeedsFollowupRepairPlan({
        repairPlanPath: mutatedRepairPlanPath,
      }),
    /repair item count|source decision ids|FR-015 repair item absence/u,
  );
});

test("M1.5 A4 needs-followup repair plan test is wired into desktop package gates", () => {
  const repairPlan = readJson(repairPlanPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-needs-followup-repair-plan\.test\.cjs/u,
  );
  assert.deepEqual(
    repairPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.210"],
  );
});
