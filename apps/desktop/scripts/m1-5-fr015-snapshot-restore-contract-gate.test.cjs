const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateFr015SnapshotRestoreContractGate,
} = require("./m1-5-fr015-snapshot-restore-contract-gate.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const gatePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-fr015-snapshot-restore-contract-gate.json",
);
const checklistPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-ux-acceptance-checklist.json",
);
const evidenceMapPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-fr-evidence-map.json",
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function writeTempJson(value) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-fr015-snapshot-restore-gate-"),
  );
  const tempPath = path.join(tempDir, "gate.json");
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  return tempPath;
}

function writeTempText(fileName, value) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-fr015-snapshot-restore-text-"),
  );
  const tempPath = path.join(tempDir, fileName);
  fs.writeFileSync(tempPath, value);
  return tempPath;
}

function acceptedApiSpecWith(extraLines) {
  return [
    "POST   /{workflow_id}/snapshot                    \u2192 \u663e\u5f0f git snapshot",
    "GET    /{workflow_id}/history                     \u2192 workflow_history.json",
    ...extraLines,
  ].join("\n");
}

test("M1.5 FR-015 snapshot restore gate returns pending contract summary", () => {
  const summary = validateFr015SnapshotRestoreContractGate();

  assert.equal(summary.status, "pending_human_confirmation");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.deepEqual(summary.frIds, ["FR-015"]);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingHumanDecisionCount, 1);
  assert.equal(summary.blockedFrItemCount, 1);
  assert.equal(summary.adrStatus, "Proposed");
  assert.equal(summary.acceptedSpecChangesAllowed, false);
  assert.equal(summary.implementationAllowed, false);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.206"]);
  assert.equal("rawRefs" in summary, false);
  assert.equal("responseBody" in summary, false);
});

test("M1.5 FR-015 snapshot restore gate records unconsumed human acceptance", () => {
  const gate = readJson(gatePath);

  assert.equal(gate.current_decision_state.human_confirmation_required, true);
  assert.equal(gate.current_decision_state.adr_0012_status, "Proposed");
  assert.equal(
    gate.current_decision_state.accepted_spec_changes_allowed,
    false,
  );
  assert.equal(
    gate.current_decision_state.runtime_or_desktop_implementation_allowed,
    false,
  );
  assert.equal(gate.required_human_decision.accepted_at, null);
  assert.equal(gate.required_human_decision.consumed_by_slice, null);
  assert.equal(gate.summary.accepted_items, 0);
  assert.equal(gate.summary.implemented_items, 0);
  assert.equal(gate.summary.exit_p1_1_status, "not_ready");
});

test("M1.5 FR-015 snapshot restore gate rejects premature Accepted ADR state", () => {
  const mutated = readJson(gatePath);
  mutated.current_decision_state.adr_0012_status = "Accepted";
  const mutatedPath = writeTempJson(mutated);

  assert.throws(
    () => validateFr015SnapshotRestoreContractGate({ gatePath: mutatedPath }),
    /declared ADR status: expected Proposed, got Accepted/u,
  );
});

test("M1.5 FR-015 snapshot restore gate rejects premature accepted API endpoint", () => {
  const apiSpecPath = writeTempText(
    "http_sse.md",
    acceptedApiSpecWith([
      "GET    /{workflow_id}/snapshots                   \u2192 snapshots/snapshots.jsonl",
    ]),
  );

  assert.throws(
    () => validateFr015SnapshotRestoreContractGate({ apiSpecPath }),
    /accepted API spec must not contain premature snapshot ledger projection endpoint/u,
  );
});

test("M1.5 FR-015 snapshot restore gate rejects full snapshot and restore routes", () => {
  const fullSnapshotApiSpecPath = writeTempText(
    "http_sse.md",
    acceptedApiSpecWith(["GET /cw/v1/workflows/{workflow_id}/snapshots"]),
  );

  assert.throws(
    () =>
      validateFr015SnapshotRestoreContractGate({
        apiSpecPath: fullSnapshotApiSpecPath,
      }),
    /accepted API spec must not contain premature snapshot ledger projection endpoint/u,
  );

  const fullRestoreApiSpecPath = writeTempText(
    "http_sse.md",
    acceptedApiSpecWith([
      "POST /cw/v1/workflows/{workflow_id}/snapshots/{snapshot_id}:restore",
    ]),
  );

  assert.throws(
    () =>
      validateFr015SnapshotRestoreContractGate({
        apiSpecPath: fullRestoreApiSpecPath,
      }),
    /accepted API spec must not contain premature restore-to-snapshot endpoint/u,
  );
});

test("M1.5 FR-015 snapshot restore gate rejects accepted FR-015 drift", () => {
  const checklist = readJson(checklistPath);
  const fr015 = checklist.fr_acceptance_items.find(
    (item) => item.id === "FR-015",
  );
  fr015.current_evidence_status = "accepted";
  const mutatedChecklistPath = writeTempJson(checklist);

  assert.throws(
    () =>
      validateFr015SnapshotRestoreContractGate({
        checklistPath: mutatedChecklistPath,
      }),
    /FR-015 checklist status: expected partial_runtime_bridge_evidence, got accepted/u,
  );

  const evidenceMap = readJson(evidenceMapPath);
  const evidenceItem = evidenceMap.fr_evidence_items.find(
    (item) => item.id === "FR-015",
  );
  evidenceItem.acceptance_readiness = "accepted";
  const mutatedEvidencePath = writeTempJson(evidenceMap);

  assert.throws(
    () =>
      validateFr015SnapshotRestoreContractGate({
        evidenceMapPath: mutatedEvidencePath,
      }),
    /FR-015 acceptance readiness: expected partial_runtime_bridge_requires_followup, got accepted/u,
  );
});

test("M1.5 FR-015 snapshot restore gate is wired into desktop package tests", () => {
  const packageJson = readJson(path.join(packageRoot, "package.json"));

  assert.equal(
    packageJson.scripts.test.includes(
      "scripts/m1-5-fr015-snapshot-restore-contract-gate.test.cjs",
    ),
    true,
  );
});
