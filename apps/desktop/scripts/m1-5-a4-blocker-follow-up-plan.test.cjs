const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4BlockerFollowUpPlan,
} = require("./m1-5-a4-blocker-follow-up-plan.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const followUpPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-follow-up-plan.json",
);
const blockerDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-repair-decision-record.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
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

function writeJsonTemp(prefix, fileName, value) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const tempPath = path.join(tempDir, fileName);
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  return tempPath;
}

function writeMutatedFollowUpPlan(mutator) {
  const followUpPlan = readJson(followUpPlanPath);
  mutator(followUpPlan);
  return writeJsonTemp(
    "cw-a4-blocker-followup-",
    "follow-up-plan.json",
    followUpPlan,
  );
}

test("M1.5 A4 blocker follow-up plan returns a conservative summary", () => {
  const summary = validateA4BlockerFollowUpPlan();

  assert.equal(
    summary.status,
    "a4_blocker_follow_up_plan_prepared_not_implemented",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.followUpItemCount, 11);
  assert.equal(summary.streamAcceptanceFollowUpItemCount, 3);
  assert.equal(summary.runtimeUxAcceptanceFollowUpItemCount, 7);
  assert.equal(summary.gitHistoryConformanceFollowUpItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.plannedNotImplementedItemCount, 11);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedFrIds));
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.220"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 blocker follow-up plan mirrors W1.5.218 decisions", () => {
  const followUpPlan = readJson(followUpPlanPath);
  const decisionRecord = readJson(blockerDecisionRecordPath);

  assert.equal(followUpPlan.slice, "W1.5.219");
  assert.equal(decisionRecord.slice, "W1.5.218");
  assert.deepEqual(
    sorted(
      followUpPlan.follow_up_items.map(
        (item) => item.source_blocker_repair_decision_id,
      ),
    ),
    sorted(decisionRecord.blocker_repair_decision_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(followUpPlan.follow_up_items.map((item) => item.fr_id)),
    sorted(expectedFrIds),
  );
  assert.equal(
    followUpPlan.follow_up_items.every(
      (item) =>
        item.source_decision === "needs_followup" &&
        item.source_repair_status === "executed_not_accepted" &&
        item.follow_up_status === "planned_not_implemented" &&
        item.accepted === false &&
        item.implemented === false,
    ),
    true,
  );
});

test("M1.5 A4 blocker follow-up plan groups every item into a planned track", () => {
  const followUpPlan = readJson(followUpPlanPath);
  const tracksById = new Map(
    followUpPlan.follow_up_tracks.map((track) => [track.id, track]),
  );

  assert.deepEqual(
    sorted([...tracksById.keys()]),
    sorted([
      "TRACK-A4-STREAM-ACCEPTANCE-FOLLOWUP",
      "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP",
      "TRACK-A8-GIT-HISTORY-CONFORMANCE-FOLLOWUP",
    ]),
  );
  for (const followUpItem of followUpPlan.follow_up_items) {
    const track = tracksById.get(followUpItem.track_id);
    assert.ok(track, `${followUpItem.id} track exists`);
    assert.equal(track.fr_ids.includes(followUpItem.fr_id), true);
  }
});

test("M1.5 A4 blocker follow-up plan rejects accepted or implemented drift", () => {
  const mutatedFollowUpPlanPath = writeMutatedFollowUpPlan((followUpPlan) => {
    followUpPlan.follow_up_items[0].accepted = true;
    followUpPlan.follow_up_items[0].implemented = true;
    followUpPlan.summary.accepted_items = 1;
    followUpPlan.summary.implemented_items = 1;
    followUpPlan.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4BlockerFollowUpPlan({
        followUpPlanPath: mutatedFollowUpPlanPath,
      }),
    /EXIT-P1-1|accepted|implemented/u,
  );
});

test("M1.5 A4 blocker follow-up plan rejects source mapping drift", () => {
  const mutatedFollowUpPlanPath = writeMutatedFollowUpPlan((followUpPlan) => {
    followUpPlan.follow_up_items[0].source_blocker_repair_decision_id =
      "BLOCKER-REPAIR-DECISION-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA4BlockerFollowUpPlan({
        followUpPlanPath: mutatedFollowUpPlanPath,
      }),
    /source blocker repair decision ids|source item/u,
  );
});

test("M1.5 A4 blocker follow-up plan rejects FR-015 or wrong track drift", () => {
  const fr015Path = writeMutatedFollowUpPlan((followUpPlan) => {
    followUpPlan.follow_up_items[0].fr_id = "FR-015";
  });
  const wrongTrackPath = writeMutatedFollowUpPlan((followUpPlan) => {
    followUpPlan.follow_up_items[0].track_id =
      "TRACK-A4-RUNTIME-UX-ACCEPTANCE-FOLLOWUP";
  });

  assert.throws(
    () =>
      validateA4BlockerFollowUpPlan({
        followUpPlanPath: fr015Path,
      }),
    /follow-up FR ids|FR-015/u,
  );
  assert.throws(
    () =>
      validateA4BlockerFollowUpPlan({
        followUpPlanPath: wrongTrackPath,
      }),
    /track/u,
  );
});

test("M1.5 A4 blocker follow-up plan rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedFollowUpPlan((followUpPlan) => {
    followUpPlan.follow_up_items[0].acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedFollowUpPlan((followUpPlan) => {
    followUpPlan.follow_up_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4BlockerFollowUpPlan({
        followUpPlanPath: missingBlockerPath,
      }),
    /acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4BlockerFollowUpPlan({
        followUpPlanPath: missingEvidencePath,
      }),
    /evidence refs|evidence ref/u,
  );
});

test("M1.5 A4 blocker follow-up plan tolerates future ledger slices with retained W1.5.219 evidence", () => {
  const readinessLedger = readJson(readinessLedgerPath);
  readinessLedger.slice = "W1.5.220";
  readinessLedger.next_recommended_slices = [
    {
      id: "W1.5.221",
      title: "future slice",
      reason: "W1.5.219 evidence retained while later ledger advances.",
    },
  ];
  const mutatedLedgerPath = writeJsonTemp(
    "cw-a4-blocker-followup-ledger-",
    "readiness-ledger.json",
    readinessLedger,
  );

  const summary = validateA4BlockerFollowUpPlan({
    readinessLedgerPath: mutatedLedgerPath,
  });

  assert.equal(summary.followUpItemCount, 11);
});

test("M1.5 A4 blocker follow-up plan test is wired into desktop package gates", () => {
  const followUpPlan = readJson(followUpPlanPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-blocker-follow-up-plan\.test\.cjs/u,
  );
  assert.deepEqual(
    followUpPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.220"],
  );
});
