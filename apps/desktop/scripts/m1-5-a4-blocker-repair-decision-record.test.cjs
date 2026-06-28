const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4BlockerRepairDecisionRecord,
} = require("./m1-5-a4-blocker-repair-decision-record.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const blockerDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-blocker-repair-decision-record.json",
);
const streamRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-acceptance-blocker-repair.json",
);
const runtimeUxRepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-ux-acceptance-blocker-repair.json",
);
const a8RepairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-blocker-repair.json",
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedDecisionRecord(mutator) {
  const record = readJson(blockerDecisionRecordPath);
  mutator(record);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-a4-blocker-decision-"),
  );
  const mutatedRecordPath = path.join(tempDir, "decision-record.json");
  fs.writeFileSync(mutatedRecordPath, JSON.stringify(record, null, 2));
  return mutatedRecordPath;
}

test("M1.5 A4 blocker repair decision record returns a conservative summary", () => {
  const summary = validateA4BlockerRepairDecisionRecord();

  assert.equal(
    summary.status,
    "a4_blocker_repair_reviewer_decisions_recorded_needs_followup",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.decisionItemCount, 11);
  assert.equal(summary.streamRepairDecisionItemCount, 3);
  assert.equal(summary.runtimeUxRepairDecisionItemCount, 7);
  assert.equal(summary.gitHistoryConformanceDecisionItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.rejectedItemCount, 0);
  assert.equal(summary.needsFollowupItemCount, 11);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.sourceExecutedNotAcceptedItemCount, 11);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.219"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 blocker repair decision record mirrors W1.5.215 through W1.5.217 repair handoffs", () => {
  const record = readJson(blockerDecisionRecordPath);
  const streamRepair = readJson(streamRepairPath);
  const runtimeRepair = readJson(runtimeUxRepairPath);
  const a8Repair = readJson(a8RepairPath);

  assert.equal(record.slice, "W1.5.218");
  assert.equal(streamRepair.slice, "W1.5.215");
  assert.equal(runtimeRepair.slice, "W1.5.216");
  assert.equal(a8Repair.slice, "W1.5.217");
  assert.deepEqual(
    sorted(
      record.blocker_repair_decision_items
        .filter((item) => item.review_group === "stream_acceptance_repair")
        .map((item) => item.source_repair_item_id),
    ),
    sorted(streamRepair.repair_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(
      record.blocker_repair_decision_items
        .filter((item) => item.review_group === "runtime_ux_repair")
        .map((item) => item.source_repair_item_id),
    ),
    sorted(runtimeRepair.repair_items.map((item) => item.id)),
  );
  assert.deepEqual(
    record.blocker_repair_decision_items
      .filter((item) => item.review_group === "git_history_conformance_repair")
      .map((item) => item.source_repair_item_id),
    [a8Repair.repair_items[0].id],
  );
});

test("M1.5 A4 blocker repair decision record keeps all decisions as needs_followup", () => {
  const record = readJson(blockerDecisionRecordPath);

  assert.equal(record.summary.accepted_items, 0);
  assert.equal(record.summary.rejected_items, 0);
  assert.equal(record.summary.needs_followup_items, 11);
  assert.equal(record.summary.implemented_items, 0);
  assert.equal(record.summary.post_repair_reviewed_items, 11);
  assert.equal(
    record.blocker_repair_decision_items.every(
      (item) =>
        item.decision === "needs_followup" &&
        item.decision_status === "reviewed_needs_followup_not_accepted" &&
        item.accepted === false &&
        item.implemented === false &&
        item.follow_up_required === true &&
        item.evidence_reviewed === true,
    ),
    true,
  );
});

test("M1.5 A4 blocker repair decision record preserves FR groups and excludes FR-015", () => {
  const record = readJson(blockerDecisionRecordPath);

  assert.deepEqual(
    sorted(
      record.blocker_repair_decision_items
        .filter((item) => item.review_group === "stream_acceptance_repair")
        .map((item) => item.fr_id),
    ),
    sorted(expectedStreamFrIds),
  );
  assert.deepEqual(
    sorted(
      record.blocker_repair_decision_items
        .filter((item) => item.review_group === "runtime_ux_repair")
        .map((item) => item.fr_id),
    ),
    sorted(expectedRuntimeUxFrIds),
  );
  assert.deepEqual(
    record.blocker_repair_decision_items
      .filter((item) => item.review_group === "git_history_conformance_repair")
      .map((item) => item.fr_id),
    ["FR-012"],
  );
  assert.equal(
    record.blocker_repair_decision_items.some(
      (item) => item.fr_id === "FR-015",
    ),
    false,
  );
  assert.equal(
    record.excluded_items.some((item) => item.fr_id === "FR-015"),
    true,
  );
});

test("M1.5 A4 blocker repair decision record rejects accepted or implemented drift", () => {
  const mutatedRecordPath = writeMutatedDecisionRecord((record) => {
    record.blocker_repair_decision_items[0].decision = "accepted";
    record.blocker_repair_decision_items[0].accepted = true;
    record.blocker_repair_decision_items[0].implemented = true;
    record.summary.accepted_items = 1;
    record.summary.implemented_items = 1;
    record.exit_p1_1_status = "ready";
  });

  assert.throws(
    () =>
      validateA4BlockerRepairDecisionRecord({
        blockerDecisionRecordPath: mutatedRecordPath,
      }),
    /EXIT-P1-1|decision|accepted|implemented/u,
  );
});

test("M1.5 A4 blocker repair decision record rejects source repair mapping drift", () => {
  const mutatedRecordPath = writeMutatedDecisionRecord((record) => {
    record.blocker_repair_decision_items[0].source_repair_item_id =
      "STREAM-BLOCKER-REPAIR-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA4BlockerRepairDecisionRecord({
        blockerDecisionRecordPath: mutatedRecordPath,
      }),
    /source repair/u,
  );
});

test("M1.5 A4 blocker repair decision record rejects FR-015 or wrong group drift", () => {
  const fr015Path = writeMutatedDecisionRecord((record) => {
    record.blocker_repair_decision_items[0].fr_id = "FR-015";
  });
  const wrongGroupPath = writeMutatedDecisionRecord((record) => {
    record.blocker_repair_decision_items[0].review_group = "runtime_ux_repair";
  });

  assert.throws(
    () =>
      validateA4BlockerRepairDecisionRecord({
        blockerDecisionRecordPath: fr015Path,
      }),
    /decision FR ids|FR-015/u,
  );
  assert.throws(
    () =>
      validateA4BlockerRepairDecisionRecord({
        blockerDecisionRecordPath: wrongGroupPath,
      }),
    /review group/u,
  );
});

test("M1.5 A4 blocker repair decision record rejects missing blockers or evidence", () => {
  const missingBlockerPath = writeMutatedDecisionRecord((record) => {
    record.blocker_repair_decision_items[0].remaining_acceptance_blockers = [];
  });
  const missingEvidencePath = writeMutatedDecisionRecord((record) => {
    record.blocker_repair_decision_items[0].evidence_refs = [];
  });

  assert.throws(
    () =>
      validateA4BlockerRepairDecisionRecord({
        blockerDecisionRecordPath: missingBlockerPath,
      }),
    /remaining acceptance blockers/u,
  );
  assert.throws(
    () =>
      validateA4BlockerRepairDecisionRecord({
        blockerDecisionRecordPath: missingEvidencePath,
      }),
    /evidence ref/u,
  );
});

test("M1.5 A4 blocker repair decision record test is wired into desktop package gates", () => {
  const record = readJson(blockerDecisionRecordPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-blocker-repair-decision-record\.test\.cjs/u,
  );
  assert.equal(
    record.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-blocker-repair-decision-record.test.cjs",
  );
  assert.equal(
    record.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-blocker-repair-decision-record.cjs --check",
  );
  assert.deepEqual(
    record.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.219"],
  );
});
