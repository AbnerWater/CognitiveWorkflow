const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateA4RuntimeBridgeUserPathCapture,
} = require("./m1-5-a4-runtime-bridge-user-path-capture.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const runtimeCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-runtime-bridge-user-path-capture.json",
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
const sourceCapturePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-a4-capture-execution.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedRuntimeBridgeFrIds = [
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

function writeJsonFixture(prefix, fileName, value) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

test("M1.5 A4 runtime bridge user-path capture returns a conservative summary", () => {
  const summary = validateA4RuntimeBridgeUserPathCapture();

  assert.equal(
    summary.status,
    "a4_runtime_bridge_user_path_capture_executed_not_accepted",
  );
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.equal(summary.runtimeBridgeCaptureItemCount, 7);
  assert.deepEqual(sorted(summary.frIds), sorted(expectedRuntimeBridgeFrIds));
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingA4ReviewItemCount, 7);
  assert.equal(summary.commandEvidenceCount, 6);
  assert.deepEqual(
    sorted(summary.excludedFrIds),
    sorted(["FR-009", "FR-010", "FR-012", "FR-015", "FR-016"]),
  );
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.212"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("outputDir" in summary, false);
});

test("M1.5 A4 runtime bridge user-path capture mirrors W1.5.209 repair track and W1.5.208 decisions", () => {
  const runtimeCapture = readJson(runtimeCapturePath);
  const repairPlan = readJson(repairPlanPath);
  const decisionRecord = readJson(decisionRecordPath);
  const runtimeRepairItems = repairPlan.repair_items.filter(
    (item) => item.track_id === "TRACK-A4-RUNTIME-BRIDGE-CAPTURE",
  );

  assert.equal(runtimeCapture.slice, "W1.5.211");
  assert.equal(repairPlan.slice, "W1.5.209");
  assert.equal(decisionRecord.slice, "W1.5.208");
  assert.deepEqual(
    sorted(
      runtimeCapture.runtime_bridge_capture_items.map((item) => item.fr_id),
    ),
    sorted(runtimeRepairItems.map((item) => item.fr_id)),
  );
  assert.deepEqual(
    sorted(
      runtimeCapture.runtime_bridge_capture_items.map((item) => item.fr_id),
    ),
    sorted(expectedRuntimeBridgeFrIds),
  );

  const decisionById = new Map(
    decisionRecord.decision_items.map((item) => [item.id, item]),
  );
  for (const captureItem of runtimeCapture.runtime_bridge_capture_items) {
    const decision = decisionById.get(captureItem.source_decision_id);
    assert.ok(decision, `${captureItem.id} decision exists`);
    assert.equal(decision.decision, "needs_followup");
    assert.equal(captureItem.source_decision, "needs_followup");
    assert.equal(captureItem.source_repair_status, "planned_not_implemented");
    assert.equal(captureItem.user_path_capture_status, "executed_not_accepted");
    assert.equal(captureItem.accepted, false);
  }
});

test("M1.5 A4 runtime bridge user-path capture reuses source capture evidence and command refs", () => {
  const runtimeCapture = readJson(runtimeCapturePath);
  const sourceCapture = readJson(sourceCapturePath);
  const sourceCapturesById = new Map(
    sourceCapture.review_item_captures.map((item) => [item.id, item]),
  );
  const commandEvidenceById = new Map(
    runtimeCapture.command_execution_evidence.map((item) => [item.id, item]),
  );

  for (const commandEvidence of runtimeCapture.command_execution_evidence) {
    assert.equal(commandEvidence.execution_status, "executed_passed");
    assert.equal(commandEvidence.accepted, false);
    assert.equal(commandEvidence.raw_stdout_stderr_retained, false);
  }

  for (const captureItem of runtimeCapture.runtime_bridge_capture_items) {
    const sourceCaptureItem = sourceCapturesById.get(
      captureItem.source_capture_id,
    );
    assert.ok(sourceCaptureItem, `${captureItem.id} source capture exists`);
    assert.equal(
      captureItem.bridge_command_id,
      sourceCaptureItem.bridge_command_id,
    );
    assert.deepEqual(
      captureItem.observed_a4_evidence_inputs,
      sourceCaptureItem.observed_a4_evidence_inputs,
    );
    for (const commandEvidenceId of captureItem.command_evidence_ids) {
      const commandEvidence = commandEvidenceById.get(commandEvidenceId);
      assert.ok(commandEvidence, `${commandEvidenceId} exists`);
      assert.equal(
        commandEvidence.applies_to_fr_ids.includes(captureItem.fr_id),
        true,
      );
    }
  }
});

test("M1.5 A4 runtime bridge user-path capture rejects accepted item drift", () => {
  const runtimeCapture = readJson(runtimeCapturePath);
  runtimeCapture.runtime_bridge_capture_items[0].accepted = true;
  runtimeCapture.summary.accepted_items = 1;
  const mutatedRuntimeCapturePath = writeJsonFixture(
    "cw-a4-runtime-capture-accepted-",
    "runtime-capture.json",
    runtimeCapture,
  );

  assert.throws(
    () =>
      validateA4RuntimeBridgeUserPathCapture({
        runtimeCapturePath: mutatedRuntimeCapturePath,
      }),
    /accepted flag|summary accepted/u,
  );
});

test("M1.5 A4 runtime bridge user-path capture rejects stream item drift", () => {
  const runtimeCapture = readJson(runtimeCapturePath);
  runtimeCapture.runtime_bridge_capture_items.push({
    ...runtimeCapture.runtime_bridge_capture_items[0],
    id: "USER-PATH-CAPTURE-A4-FR-009-STREAM-COLLAPSED",
    fr_id: "FR-009",
    repair_item_id: "REPAIR-A4-FR-009-STREAM-COLLAPSED",
    source_decision_id: "DECISION-A4-FR-009-STREAM-COLLAPSED",
    source_capture_id: "CAPTURE-A4-FR-009-STREAM-COLLAPSED",
  });
  runtimeCapture.summary.runtime_bridge_capture_item_count += 1;
  const mutatedRuntimeCapturePath = writeJsonFixture(
    "cw-a4-runtime-capture-stream-",
    "runtime-capture.json",
    runtimeCapture,
  );

  assert.throws(
    () =>
      validateA4RuntimeBridgeUserPathCapture({
        runtimeCapturePath: mutatedRuntimeCapturePath,
      }),
    /runtime bridge capture item count|runtime bridge capture FR ids/u,
  );
});

test("M1.5 A4 runtime bridge user-path capture rejects FR-012 and FR-015 drift", () => {
  const runtimeCapture = readJson(runtimeCapturePath);
  runtimeCapture.runtime_bridge_capture_items[0].fr_id = "FR-012";
  const mutatedRuntimeCapturePath = writeJsonFixture(
    "cw-a4-runtime-capture-fr012-",
    "runtime-capture.json",
    runtimeCapture,
  );

  assert.throws(
    () =>
      validateA4RuntimeBridgeUserPathCapture({
        runtimeCapturePath: mutatedRuntimeCapturePath,
      }),
    /runtime bridge capture FR ids|FR-012 runtime bridge capture absence/u,
  );

  runtimeCapture.runtime_bridge_capture_items[0].fr_id = "FR-015";
  const secondMutatedRuntimeCapturePath = writeJsonFixture(
    "cw-a4-runtime-capture-fr015-",
    "runtime-capture.json",
    runtimeCapture,
  );

  assert.throws(
    () =>
      validateA4RuntimeBridgeUserPathCapture({
        runtimeCapturePath: secondMutatedRuntimeCapturePath,
      }),
    /runtime bridge capture FR ids|FR-015 runtime bridge capture absence/u,
  );
});

test("M1.5 A4 runtime bridge user-path capture rejects command failure drift", () => {
  const runtimeCapture = readJson(runtimeCapturePath);
  runtimeCapture.command_execution_evidence[0].execution_status = "failed";
  const mutatedRuntimeCapturePath = writeJsonFixture(
    "cw-a4-runtime-capture-command-",
    "runtime-capture.json",
    runtimeCapture,
  );

  assert.throws(
    () =>
      validateA4RuntimeBridgeUserPathCapture({
        runtimeCapturePath: mutatedRuntimeCapturePath,
      }),
    /execution status/u,
  );
});

test("M1.5 A4 runtime bridge user-path capture test is wired into desktop package gates", () => {
  const runtimeCapture = readJson(runtimeCapturePath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.match(
    desktopPackage.scripts.test,
    /scripts\/m1-5-a4-runtime-bridge-user-path-capture\.test\.cjs/u,
  );
  assert.deepEqual(
    runtimeCapture.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.212"],
  );
});
