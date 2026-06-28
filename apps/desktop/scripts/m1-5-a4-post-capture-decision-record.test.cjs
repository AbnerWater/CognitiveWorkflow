const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4PostCaptureDecisionRecord,
} = require("./m1-5-a4-post-capture-decision-record.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const postCaptureDecisionRecordPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-post-capture-decision-record.json",
);
const streamCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-stream-phase-capture-execution.json",
);
const runtimeBridgeCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-bridge-user-path-capture.json",
);
const a8EvidencePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-prerequisite-evidence.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedStreamFrIds = ["FR-009", "FR-010", "FR-016"];
const expectedRuntimeBridgeFrIds = [
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
  ...expectedRuntimeBridgeFrIds,
  "FR-012",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedPostCaptureDecisionRecord(mutator) {
  const record = readJson(postCaptureDecisionRecordPath);
  mutator(record);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-a4-post-"));
  const mutatedRecordPath = path.join(tempDir, "post-capture-record.json");
  fs.writeFileSync(mutatedRecordPath, JSON.stringify(record, null, 2));
  return mutatedRecordPath;
}

test("M1.5 A4 post-capture decision record returns a conservative summary", () => {
  const summary = validateA4PostCaptureDecisionRecord();

  assert.equal(
    summary.status,
    "a4_post_capture_reviewer_decisions_recorded_needs_followup",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.decisionItemCount, 11);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedFrIds));
  assert.equal(
    summary.streamPhaseDecisionItemCount,
    expectedStreamFrIds.length,
  );
  assert.equal(
    summary.runtimeBridgeDecisionItemCount,
    expectedRuntimeBridgeFrIds.length,
  );
  assert.equal(summary.gitHistoryPrereqDecisionItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.rejectedItemCount, 0);
  assert.equal(summary.needsFollowupItemCount, 11);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.214"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 post-capture decision record mirrors W1.5.210 through W1.5.212 inputs", () => {
  const record = readJson(postCaptureDecisionRecordPath);
  const streamCapture = readJson(streamCapturePath);
  const runtimeCapture = readJson(runtimeBridgeCapturePath);
  const a8Evidence = readJson(a8EvidencePath);

  assert.equal(record.slice, "W1.5.213");
  assert.equal(streamCapture.slice, "W1.5.210");
  assert.equal(runtimeCapture.slice, "W1.5.211");
  assert.equal(a8Evidence.slice, "W1.5.212");
  assert.deepEqual(
    sorted(
      record.post_capture_decision_items
        .filter((item) => item.review_group === "candidate_stream_evidence")
        .map((item) => item.follow_up_item_id),
    ),
    sorted(streamCapture.phase_capture_items.map((item) => item.id)),
  );
  assert.deepEqual(
    sorted(
      record.post_capture_decision_items
        .filter((item) => item.review_group === "runtime_bridge_evidence")
        .map((item) => item.follow_up_item_id),
    ),
    sorted(runtimeCapture.runtime_bridge_capture_items.map((item) => item.id)),
  );
  assert.deepEqual(
    record.post_capture_decision_items
      .filter((item) => item.review_group === "git_history_prereq_evidence")
      .map((item) => item.follow_up_item_id),
    [a8Evidence.fr012_prerequisite_item.id],
  );
});

test("M1.5 A4 post-capture decision record keeps all decisions as needs_followup", () => {
  const record = readJson(postCaptureDecisionRecordPath);

  assert.equal(record.summary.accepted_items, 0);
  assert.equal(record.summary.rejected_items, 0);
  assert.equal(record.summary.needs_followup_items, 11);
  assert.equal(record.summary.post_capture_reviewed_items, 11);
  assert.equal(
    record.post_capture_decision_items.every(
      (item) =>
        item.post_capture_decision === "needs_followup" &&
        item.accepted === false &&
        item.rejected === false &&
        item.follow_up_required === true &&
        item.evidence_reviewed === true,
    ),
    true,
  );
});

test("M1.5 A4 post-capture decision record rejects accepted drift", () => {
  const mutatedRecordPath = writeMutatedPostCaptureDecisionRecord((record) => {
    record.post_capture_decision_items[0].post_capture_decision = "accepted";
    record.post_capture_decision_items[0].accepted = true;
  });

  assert.throws(
    () =>
      validateA4PostCaptureDecisionRecord({
        postCaptureDecisionRecordPath: mutatedRecordPath,
      }),
    /post-capture decision/u,
  );
});

test("M1.5 A4 post-capture decision record rejects missing follow-up source mapping", () => {
  const mutatedRecordPath = writeMutatedPostCaptureDecisionRecord((record) => {
    record.post_capture_decision_items[0].follow_up_item_id =
      "PHASE-CAPTURE-A4-FR-999-MISSING";
  });

  assert.throws(
    () =>
      validateA4PostCaptureDecisionRecord({
        postCaptureDecisionRecordPath: mutatedRecordPath,
      }),
    /follow-up item/u,
  );
});

test("M1.5 A4 post-capture decision record rejects FR-015 in decision scope", () => {
  const mutatedRecordPath = writeMutatedPostCaptureDecisionRecord((record) => {
    record.post_capture_decision_items[0].fr_id = "FR-015";
  });

  assert.throws(
    () =>
      validateA4PostCaptureDecisionRecord({
        postCaptureDecisionRecordPath: mutatedRecordPath,
      }),
    /post-capture decision FR ids/u,
  );
});

test("M1.5 A4 post-capture decision record rejects missing remaining blockers", () => {
  const mutatedRecordPath = writeMutatedPostCaptureDecisionRecord((record) => {
    record.post_capture_decision_items[0].remaining_acceptance_blockers = [];
  });

  assert.throws(
    () =>
      validateA4PostCaptureDecisionRecord({
        postCaptureDecisionRecordPath: mutatedRecordPath,
      }),
    /remaining acceptance blockers/u,
  );
});

test("M1.5 A4 post-capture decision record test is wired into desktop package gates", () => {
  const record = readJson(postCaptureDecisionRecordPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-post-capture-decision-record\.test\.cjs/u,
  );
  assert.equal(
    record.reviewer_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-a4-post-capture-decision-record.test.cjs",
  );
  assert.equal(
    record.reviewer_contract.focused_check,
    "node apps/desktop/scripts/m1-5-a4-post-capture-decision-record.cjs --check",
  );
});
