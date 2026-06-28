const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA8GitHistoryPrerequisiteEvidence,
} = require("./m1-5-a8-git-history-prerequisite-evidence.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const evidencePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a8-git-history-prerequisite-evidence.json",
);
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function writeJsonFixture(prefix, fileName, value) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

test("M1.5 A8 Git-history prerequisite evidence returns a conservative summary", () => {
  const summary = validateA8GitHistoryPrerequisiteEvidence();

  assert.equal(
    summary.status,
    "a8_git_history_prerequisite_evidence_recorded_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.exitP1_10Status, "not_ready");
  assert.equal(summary.frId, "FR-012");
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.triggerCount, 10);
  assert.equal(summary.triggerEvidenceAvailableCount, 4);
  assert.equal(summary.triggerGapCount, 6);
  assert.equal(summary.commandEvidenceCount, 5);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.213"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A8 Git-history prerequisite evidence mirrors W1.5.209 repair track and W1.5.208 decision", () => {
  const evidence = readJson(evidencePath);
  const repairPlan = readJson(repairPlanPath);
  const decisionRecord = readJson(decisionRecordPath);
  const repairItem = repairPlan.repair_items.find(
    (item) => item.id === "REPAIR-A4-FR-012-MANDATORY-GIT-BRIDGE",
  );
  const decisionItem = decisionRecord.decision_items.find(
    (item) => item.id === "DECISION-A4-FR-012-MANDATORY-GIT-BRIDGE",
  );

  assert.equal(evidence.slice, "W1.5.212");
  assert.equal(repairPlan.slice, "W1.5.209");
  assert.equal(decisionRecord.slice, "W1.5.208");
  assert.equal(
    evidence.track_execution.source_track_id,
    "TRACK-A8-GIT-HISTORY-PREREQ",
  );
  assert.deepEqual(evidence.track_execution.fr_ids, ["FR-012"]);
  assert.equal(repairItem.track_id, "TRACK-A8-GIT-HISTORY-PREREQ");
  assert.equal(repairItem.implementation_status, "planned_not_implemented");
  assert.equal(decisionItem.decision, "needs_followup");
  assert.deepEqual(
    evidence.fr012_prerequisite_item.source_acceptance_blockers,
    decisionItem.acceptance_blockers,
  );
  assert.equal(evidence.fr012_prerequisite_item.accepted, false);
});

test("M1.5 A8 Git-history prerequisite evidence mirrors runtime_harness trigger table", () => {
  const evidence = readJson(evidencePath);
  const triggerRows = evidence.runtime_harness_8_2_trigger_audit.trigger_rows;

  assert.deepEqual(
    triggerRows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      expectedCommitMessage: row.expected_commit_message,
      expectedTag: row.expected_tag,
    })),
    [
      {
        id: "workflow_draft_instantiated",
        trigger: "WorkflowDraft 实例化为正式 Workflow",
        expectedCommitMessage:
          "chore(workflow): instantiate <workflow_id> v<ver>",
        expectedTag: "workflow-<id>-v<ver>",
      },
      {
        id: "workflow_patch_applied_draft",
        trigger: "WorkflowPatch 应用（草案阶段）",
        expectedCommitMessage:
          "chore(planning): apply patch <patch_id> to draft v<n>",
        expectedTag: null,
      },
      {
        id: "workflow_manual_edit_saved",
        trigger: "Workflow 内手动编辑保存",
        expectedCommitMessage: "chore(workflow): manual edit v<ver+0.0.1>",
        expectedTag: "workflow-<id>-v<ver+0.0.1>",
      },
      {
        id: "run_started",
        trigger: "RunStarted",
        expectedCommitMessage:
          "chore(run): start <run_id> on workflow <id> v<ver>",
        expectedTag: null,
      },
      {
        id: "attempt_completed_important_node",
        trigger: "attempt.completed（重要节点）",
        expectedCommitMessage:
          "snapshot(run/<run_id>): node <node_id> attempt <idx>",
        expectedTag: null,
      },
      {
        id: "human_gate_resolved",
        trigger: "human.gate_resolved",
        expectedCommitMessage:
          "chore(human): decision on <human_node_id> by <user>",
        expectedTag: null,
      },
      {
        id: "repair_patch_applied",
        trigger: "repair.patch_applied",
        expectedCommitMessage: "chore(repair): apply <patch_id> on <node_id>",
        expectedTag: null,
      },
      {
        id: "run_terminal",
        trigger: "run.completed / run.failed / run.cancelled",
        expectedCommitMessage: "chore(run): end <run_id> state=<state>",
        expectedTag: "run-<run_id>-<state>",
      },
      {
        id: "memory_json_write",
        trigger: "memory.json 写入",
        expectedCommitMessage: "chore(memory): update v<n> — <topic>",
        expectedTag: null,
      },
      {
        id: "references_manifest_change",
        trigger: "references.manifest.json 变更",
        expectedCommitMessage:
          "chore(refs): import/enable/disable <reference_id>",
        expectedTag: null,
      },
    ],
  );
  assert.deepEqual(
    triggerRows
      .filter((row) => row.evidence_status === "evidence_available")
      .map((row) => row.id)
      .sort(),
    [
      "attempt_completed_important_node",
      "references_manifest_change",
      "run_started",
      "run_terminal",
    ],
  );
  assert.equal(
    triggerRows.filter((row) => row.evidence_status !== "evidence_available")
      .length,
    6,
  );
  assert.equal(evidence.summary.exit_p1_10_status, "not_ready");
});

test("M1.5 A8 Git-history prerequisite evidence rejects accepted and ready drift", () => {
  const evidence = readJson(evidencePath);
  evidence.fr012_prerequisite_item.accepted = true;
  evidence.summary.accepted_items = 1;
  evidence.exit_p1_10_status = "ready";
  const mutatedEvidencePath = writeJsonFixture(
    "cw-a8-git-history-accepted-",
    "evidence.json",
    evidence,
  );

  assert.throws(
    () =>
      validateA8GitHistoryPrerequisiteEvidence({
        evidencePath: mutatedEvidencePath,
      }),
    /EXIT-P1-10 status|accepted flag|summary accepted/u,
  );
});

test("M1.5 A8 Git-history prerequisite evidence rejects missing trigger rows", () => {
  const evidence = readJson(evidencePath);
  evidence.runtime_harness_8_2_trigger_audit.trigger_rows =
    evidence.runtime_harness_8_2_trigger_audit.trigger_rows.filter(
      (row) => row.id !== "human_gate_resolved",
    );
  evidence.summary.runtime_harness_8_2_trigger_count = 9;
  const mutatedEvidencePath = writeJsonFixture(
    "cw-a8-git-history-trigger-",
    "evidence.json",
    evidence,
  );

  assert.throws(
    () =>
      validateA8GitHistoryPrerequisiteEvidence({
        evidencePath: mutatedEvidencePath,
      }),
    /trigger count|trigger order/u,
  );
});

test("M1.5 A8 Git-history prerequisite evidence rejects trigger table drift", () => {
  const evidence = readJson(evidencePath);
  const memoryRow =
    evidence.runtime_harness_8_2_trigger_audit.trigger_rows.find(
      (row) => row.id === "memory_json_write",
    );
  memoryRow.expected_commit_message = "chore(memory): update v<n> - <topic>";
  memoryRow.trigger = "memory.json write";
  const runTerminalRow =
    evidence.runtime_harness_8_2_trigger_audit.trigger_rows.find(
      (row) => row.id === "run_terminal",
    );
  runTerminalRow.expected_tag = null;
  const mutatedEvidencePath = writeJsonFixture(
    "cw-a8-git-history-table-",
    "evidence.json",
    evidence,
  );

  assert.throws(
    () =>
      validateA8GitHistoryPrerequisiteEvidence({
        evidencePath: mutatedEvidencePath,
      }),
    /memory_json_write trigger label|memory_json_write commit message|run_terminal expected tag/u,
  );
});

test("M1.5 A8 Git-history prerequisite evidence rejects wrong FR or track drift", () => {
  const evidence = readJson(evidencePath);
  evidence.fr012_prerequisite_item.fr_id = "FR-011";
  evidence.track_execution.source_track_id = "TRACK-A4-RUNTIME-BRIDGE-CAPTURE";
  const mutatedEvidencePath = writeJsonFixture(
    "cw-a8-git-history-fr-",
    "evidence.json",
    evidence,
  );

  assert.throws(
    () =>
      validateA8GitHistoryPrerequisiteEvidence({
        evidencePath: mutatedEvidencePath,
      }),
    /track execution source track id|summary FR id|FR-012/u,
  );
});

test("M1.5 A8 Git-history prerequisite evidence rejects command failure drift", () => {
  const evidence = readJson(evidencePath);
  evidence.command_execution_evidence[0].execution_status = "failed";
  const mutatedEvidencePath = writeJsonFixture(
    "cw-a8-git-history-command-",
    "evidence.json",
    evidence,
  );

  assert.throws(
    () =>
      validateA8GitHistoryPrerequisiteEvidence({
        evidencePath: mutatedEvidencePath,
      }),
    /execution status/u,
  );
});

test("M1.5 A8 Git-history prerequisite evidence test is wired into desktop package gates", () => {
  const evidence = readJson(evidencePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a8-git-history-prerequisite-evidence\.test\.cjs/u,
  );
  assert.deepEqual(
    evidence.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.213"],
  );
});
