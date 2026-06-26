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

test("M1.5 runtime-flow contract acceptance gate returns conservative summary", () => {
  const summary = validateRuntimeFlowContractAcceptanceGate();

  assert.equal(summary.status, "pending_human_confirmation");
  assert.equal(summary.exitP1_1Status, "not_ready");
  assert.deepEqual(summary.frIds, ["FR-008", "FR-017"]);
  assert.equal(summary.acceptedItemCount, 0);
  assert.equal(summary.implementedItemCount, 0);
  assert.equal(summary.pendingHumanDecisionCount, 1);
  assert.equal(summary.blockedFrItemCount, 2);
  assert.equal(summary.adrStatus, "Proposed");
  assert.equal(summary.acceptedSpecChangesAllowed, false);
  assert.equal(summary.implementationAllowed, false);
  assert.deepEqual(summary.nextRecommendedSlices, ["W1.5.194"]);
  assert.equal("rawPrompt" in summary, false);
  assert.equal("artifactBody" in summary, false);
});

test("M1.5 runtime-flow contract gate blocks spec and implementation before human acceptance", () => {
  const gate = readJson(gatePath);

  assert.equal(gate.current_decision_state.human_confirmation_required, true);
  assert.equal(
    gate.current_decision_state.accepted_spec_changes_allowed,
    false,
  );
  assert.equal(
    gate.current_decision_state.runtime_or_desktop_implementation_allowed,
    false,
  );
  assert.equal(gate.summary.accepted_items, 0);
  assert.equal(gate.summary.implemented_items, 0);
  assert.equal(gate.summary.exit_p1_1_status, "not_ready");
  assert.deepEqual(gate.fr_scope, ["FR-008", "FR-017"]);
});

test("M1.5 runtime-flow contract gate rejects accidental accepted drift", () => {
  const mutated = readJson(gatePath);
  mutated.current_decision_state.accepted_spec_changes_allowed = true;
  const mutatedPath = writeTempJson(mutated);

  assert.throws(
    () => validateRuntimeFlowContractAcceptanceGate({ gatePath: mutatedPath }),
    /accepted spec changes must be blocked before confirmation/u,
  );
});

test("M1.5 runtime-flow contract gate rejects implementation drift", () => {
  const mutated = readJson(gatePath);
  mutated.current_decision_state.runtime_or_desktop_implementation_allowed = true;
  const mutatedPath = writeTempJson(mutated);

  assert.throws(
    () => validateRuntimeFlowContractAcceptanceGate({ gatePath: mutatedPath }),
    /implementation must be blocked before confirmation/u,
  );
});

test("M1.5 runtime-flow contract gate rejects premature API endpoint drift", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-runtime-flow-contract-api-"),
  );
  const apiSpecPath = path.join(tempDir, "http_sse.md");
  fs.writeFileSync(
    apiSpecPath,
    "POST   /{run_id}:submit-instruction\nPOST   /{run_id}/nodes/{node_id}:run-once\n",
  );

  assert.throws(
    () => validateRuntimeFlowContractAcceptanceGate({ apiSpecPath }),
    /accepted API spec must not contain unaccepted submit-instruction endpoints/u,
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
