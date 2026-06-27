const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateRuntimeFlowContractAcceptanceGate,
} = require("./m1-5-runtime-flow-contract-acceptance-gate.cjs");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const gatePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-runtime-flow-contract-acceptance-gate.json",
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function writeTempJson(value) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-runtime-flow-contract-gate-"),
  );
  const tempPath = path.join(tempDir, "gate.json");
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  return tempPath;
}

function writeTempText(fileName, value) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-runtime-flow-contract-text-"),
  );
  const tempPath = path.join(tempDir, fileName);
  fs.writeFileSync(tempPath, value);
  return tempPath;
}

test("M1.5 runtime-flow contract gate returns accepted contract summary", () => {
  const summary = validateRuntimeFlowContractAcceptanceGate();

  assert.equal(summary.status, "accepted_contract_delta_ready");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.deepEqual(summary.frIds, ["FR-008", "FR-017"]);
  assert.equal(summary.acceptedItemCount, 4);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingHumanDecisionCount, 0);
  assert.equal(summary.blockedFrItemCount, 2);
  assert.equal(summary.adrStatus, "Accepted");
  assert.equal(summary.acceptedSpecChangesAllowed, true);
  assert.equal(summary.implementationAllowed, true);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.195"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("artifactBody" in summary, false);
});

test("M1.5 runtime-flow contract gate records consumed human acceptance", () => {
  const gate = readJson(gatePath);

  assert.equal(gate.current_decision_state.human_confirmation_required, false);
  assert.equal(gate.current_decision_state.adr_0011_status, "Accepted");
  assert.equal(gate.current_decision_state.accepted_spec_changes_allowed, true);
  assert.equal(
    gate.current_decision_state.runtime_or_desktop_implementation_allowed,
    true,
  );
  assert.equal(gate.required_human_decision.accepted_at, "2026-06-27");
  assert.equal(gate.required_human_decision.consumed_by_slice, "W1.5.194");
  assert.equal(gate.summary.accepted_items, 4);
  assert.equal(gate.summary.implemented_items, 0);
  assert.equal(gate.summary.exit_p1_1_status, "not_ready");
});

test("M1.5 runtime-flow contract gate rejects stale Proposed ADR state", () => {
  const mutated = readJson(gatePath);
  mutated.current_decision_state.adr_0011_status = "Proposed";
  const mutatedPath = writeTempJson(mutated);

  assert.throws(
    () => validateRuntimeFlowContractAcceptanceGate({ gatePath: mutatedPath }),
    /declared ADR status: expected Accepted, got Proposed/u,
  );
});

test("M1.5 runtime-flow contract gate rejects missing API endpoint contract", () => {
  const apiSpecPath = writeTempText(
    "http_sse.md",
    "POST   /{run_id}/nodes/{node_id}:run-once\nRuntimeInstructionRequest\nArtifactActionResult.destination_kind\n",
  );

  assert.throws(
    () => validateRuntimeFlowContractAcceptanceGate({ apiSpecPath }),
    /accepted API spec must contain run submit-instruction endpoint/u,
  );
});

test("M1.5 runtime-flow contract gate rejects missing runtime action schema", () => {
  const runtimeActionsSpecPath = writeTempText(
    "runtime_actions.md",
    "| Status | Accepted |\nRuntimeInstructionRequest\n",
  );

  assert.throws(
    () => validateRuntimeFlowContractAcceptanceGate({ runtimeActionsSpecPath }),
    /runtime actions spec must define ArtifactActionResult/u,
  );
});

test("M1.5 runtime-flow contract gate rejects missing generated types", () => {
  const generatedSchemaDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-runtime-flow-contract-generated-"),
  );
  fs.mkdirSync(path.join(generatedSchemaDir, "json-schema"));

  assert.throws(
    () => validateRuntimeFlowContractAcceptanceGate({ generatedSchemaDir }),
    /generated TS type missing: RuntimeInstructionRequest.ts/u,
  );
});

test("M1.5 runtime-flow contract gate is wired into desktop package tests", () => {
  const packageJson = readJson(path.join(packageRoot, "package.json"));

  assert.equal(
    packageJson.scripts.test.includes(
      "scripts/m1-5-runtime-flow-contract-acceptance-gate.test.cjs",
    ),
    true,
  );
});
