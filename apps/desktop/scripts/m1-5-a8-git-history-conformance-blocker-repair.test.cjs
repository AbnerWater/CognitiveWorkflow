const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA8GitHistoryConformanceBlockerRepair,
} = require("./m1-5-a8-git-history-conformance-blocker-repair.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const repairPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-conformance-blocker-repair.json",
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
const prerequisiteEvidencePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-prerequisite-evidence.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function writeMutatedRepair(mutator) {
  const artifact = readJson(repairPath);
  mutator(artifact);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-a8-conformance-repair-"),
  );
  const mutatedPath = path.join(tempDir, "repair.json");
  fs.writeFileSync(mutatedPath, JSON.stringify(artifact, null, 2));
  return mutatedPath;
}

test("M1.5 A8 Git-history conformance blocker repair returns a conservative summary", () => {
  const summary = validateA8GitHistoryConformanceBlockerRepair();

  assert.equal(
    summary.status,
    "a8_git_history_conformance_blocker_repair_executed_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.repairItemCount, 1);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.executedNotAcceptedItemCount, 1);
  assert.equal(summary.runtimeHarnessTriggerCount, 10);
  assert.equal(summary.evidenceCarriedForwardTriggerCount, 4);
  assert.equal(summary.explicitlyDeferredTriggerCount, 6);
  assert.equal(summary.phaseConformanceAcceptedItems, 0);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.218"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A8 Git-history conformance blocker repair mirrors W1.5.214, W1.5.213, and W1.5.212 sources", () => {
  const artifact = readJson(repairPath);
  const blockerPlan = readJson(blockerPlanPath);
  const postCaptureDecision = readJson(postCaptureDecisionPath);
  const prerequisiteEvidence = readJson(prerequisiteEvidencePath);
  const repairItem = artifact.repair_items[0];
  const sourceBlocker = blockerPlan.repair_items.find(
    (item) => item.id === repairItem.source_blocker_repair_item_id,
  );
  const postCapture = postCaptureDecision.post_capture_decision_items.find(
    (item) => item.id === repairItem.source_post_capture_decision_id,
  );

  assert.equal(artifact.slice, "W1.5.217");
  assert.equal(blockerPlan.slice, "W1.5.214");
  assert.equal(postCaptureDecision.slice, "W1.5.213");
  assert.equal(prerequisiteEvidence.slice, "W1.5.212");
  assert.equal(sourceBlocker.fr_id, "FR-012");
  assert.equal(sourceBlocker.track_id, "TRACK-A8-GIT-HISTORY-CONFORMANCE");
  assert.equal(sourceBlocker.implementation_status, "planned_not_implemented");
  assert.equal(postCapture.fr_id, "FR-012");
  assert.equal(postCapture.post_capture_decision, "needs_followup");
  assert.equal(
    repairItem.source_prerequisite_item_id,
    prerequisiteEvidence.fr012_prerequisite_item.id,
  );
  assert.deepEqual(
    repairItem.source_acceptance_blockers,
    sourceBlocker.acceptance_blockers,
  );
});

test("M1.5 A8 Git-history conformance matrix covers every runtime_harness 8.2 row", () => {
  const artifact = readJson(repairPath);
  const prerequisiteEvidence = readJson(prerequisiteEvidencePath);
  const matrix = artifact.runtime_harness_8_2_conformance_matrix;
  const sourceRows =
    prerequisiteEvidence.runtime_harness_8_2_trigger_audit.trigger_rows;

  assert.deepEqual(
    matrix.map((row) => row.id),
    sourceRows.map((row) => row.id),
  );
  assert.equal(matrix.length, 10);
  assert.deepEqual(
    sorted(
      matrix
        .filter(
          (row) =>
            row.conformance_disposition ===
            "evidence_carried_forward_not_phase_accepted",
        )
        .map((row) => row.id),
    ),
    sorted([
      "attempt_completed_important_node",
      "references_manifest_change",
      "run_started",
      "run_terminal",
    ]),
  );
  assert.deepEqual(
    sorted(
      matrix
        .filter(
          (row) =>
            row.conformance_disposition ===
            "explicitly_deferred_not_implemented",
        )
        .map((row) => row.id),
    ),
    sorted([
      "human_gate_resolved",
      "memory_json_write",
      "repair_patch_applied",
      "workflow_draft_instantiated",
      "workflow_manual_edit_saved",
      "workflow_patch_applied_draft",
    ]),
  );
  assert.equal(
    matrix.every((row) => row.accepted === false && row.implemented === false),
    true,
  );
});

test("M1.5 A8 Git-history conformance blocker repair excludes stream, runtime UX, and FR-015 scope", () => {
  const artifact = readJson(repairPath);

  assert.deepEqual(
    artifact.repair_items.map((item) => item.fr_id),
    ["FR-012"],
  );
  assert.deepEqual(
    sorted(
      artifact.excluded_items
        .filter((item) => item.track_id !== undefined)
        .map((item) => item.track_id),
    ),
    sorted([
      "TRACK-A4-STREAM-FINAL-ACCEPTANCE",
      "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE",
    ]),
  );
  assert.deepEqual(
    artifact.excluded_items
      .filter((item) => item.fr_id !== undefined)
      .map((item) => item.fr_id),
    ["FR-015"],
  );
});

test("M1.5 A8 Git-history conformance blocker repair rejects accepted or implemented drift", () => {
  const mutatedPath = writeMutatedRepair((artifact) => {
    artifact.repair_items[0].accepted = true;
    artifact.repair_items[0].implemented = true;
    artifact.summary.accepted_items = 1;
    artifact.summary.implemented_items = 1;
    artifact.exit_p1_10_status = "ready";
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceBlockerRepair({
        repairPath: mutatedPath,
      }),
    /EXIT-P1-10 status|accepted|implemented/u,
  );
});

test("M1.5 A8 Git-history conformance blocker repair rejects trigger row drift", () => {
  const missingRowPath = writeMutatedRepair((artifact) => {
    artifact.runtime_harness_8_2_conformance_matrix =
      artifact.runtime_harness_8_2_conformance_matrix.filter(
        (row) => row.id !== "human_gate_resolved",
      );
    artifact.summary.runtime_harness_8_2_trigger_count = 9;
  });
  const acceptedRowPath = writeMutatedRepair((artifact) => {
    const deferred = artifact.runtime_harness_8_2_conformance_matrix.find(
      (row) => row.id === "workflow_draft_instantiated",
    );
    deferred.conformance_disposition =
      "evidence_carried_forward_not_phase_accepted";
    deferred.evidence_refs = ["fake"];
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceBlockerRepair({
        repairPath: missingRowPath,
      }),
    /matrix row count|matrix row order/u,
  );
  assert.throws(
    () =>
      validateA8GitHistoryConformanceBlockerRepair({
        repairPath: acceptedRowPath,
      }),
    /carried-forward membership|deferred membership|deferred rows/u,
  );
});

test("M1.5 A8 Git-history conformance blocker repair rejects wrong FR or scope drift", () => {
  const mutatedPath = writeMutatedRepair((artifact) => {
    artifact.repair_items[0].fr_id = "FR-011";
    artifact.track_execution.fr_ids = ["FR-011"];
    artifact.track_execution.source_track_id =
      "TRACK-A4-RUNTIME-UX-FINAL-ACCEPTANCE";
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceBlockerRepair({
        repairPath: mutatedPath,
      }),
    /track execution source track|track FR ids|repair item FR/u,
  );
});

test("M1.5 A8 Git-history conformance blocker repair rejects missing deferral reasons", () => {
  const mutatedPath = writeMutatedRepair((artifact) => {
    const deferred = artifact.runtime_harness_8_2_conformance_matrix.find(
      (row) => row.id === "memory_json_write",
    );
    deferred.deferred_reason = "";
  });

  assert.throws(
    () =>
      validateA8GitHistoryConformanceBlockerRepair({
        repairPath: mutatedPath,
      }),
    /deferred reason/u,
  );
});

test("M1.5 A8 Git-history conformance blocker repair test is wired into desktop package gates", () => {
  const artifact = readJson(repairPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a8-git-history-conformance-blocker-repair\.test\.cjs/u,
  );
  assert.deepEqual(
    artifact.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.218"],
  );
});
