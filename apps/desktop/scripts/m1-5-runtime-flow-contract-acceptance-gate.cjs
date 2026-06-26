const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const gatePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-runtime-flow-contract-acceptance-gate.json",
);
const adrPath = path.join(
  repoRoot,
  "docs",
  "03_decisions",
  "0011-runtime-flow-desktop-actions-contract.md",
);
const adrIndexPath = path.join(repoRoot, "docs", "03_decisions", "README.md");
const apiSpecPath = path.join(repoRoot, "specs", "api", "http_sse.md");
const desktopPackagePath = path.join(packageRoot, "package.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function readText(filePath) {
  return fs.readFileSync(filePath, { encoding: "utf8" });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function adrStatus(adrText) {
  const match = adrText.match(/\|\s*Status\s*\|\s*([^|]+?)\s*\|/u);
  return match?.[1]?.trim() ?? "";
}

function validateRuntimeFlowContractAcceptanceGate(options = {}) {
  const gate = readJson(options.gatePath ?? gatePath);
  const adrText = readText(options.adrPath ?? adrPath);
  const adrIndexText = readText(options.adrIndexPath ?? adrIndexPath);
  const apiSpecText = readText(options.apiSpecPath ?? apiSpecPath);
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );

  assertEqual(gate.schema_version, "0.1.0", "schema version");
  assertEqual(gate.milestone, "M1.5", "milestone");
  assertEqual(gate.slice, "W1.5.193", "slice id");
  assertEqual(gate.gate_status, "pending_human_confirmation", "gate status");
  assertEqual(gate.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertDeepEqual(gate.fr_scope, ["FR-008", "FR-017"], "FR scope");
  assertEqual(
    gate.current_decision_state.adr_0011_status,
    "Proposed",
    "declared ADR status",
  );
  assertEqual(adrStatus(adrText), "Proposed", "actual ADR status");
  assertCondition(
    adrIndexText.includes(
      "| [0011](0011-runtime-flow-desktop-actions-contract.md) | Runtime Flow Desktop Actions Contract                         | Proposed | 2026-06-26 |",
    ),
    "ADR index must keep ADR-0011 Proposed",
  );
  assertEqual(
    gate.current_decision_state.human_confirmation_required,
    true,
    "human confirmation required",
  );
  assertEqual(
    gate.current_decision_state.accepted_spec_changes_allowed,
    false,
    "accepted spec changes must be blocked before confirmation",
  );
  assertEqual(
    gate.current_decision_state.runtime_or_desktop_implementation_allowed,
    false,
    "implementation must be blocked before confirmation",
  );
  assertCondition(
    gate.guardrails.some((guardrail) => guardrail.includes("run-once")),
    "run-once overload guardrail",
  );
  assertCondition(
    gate.guardrails.some((guardrail) => guardrail.includes("metadata-only")),
    "metadata-only evidence guardrail",
  );
  assertEqual(
    gate.required_human_decision.decision_id,
    "HUMAN-ACCEPT-ADR-0011",
    "human decision id",
  );
  assertEqual(
    gate.required_human_decision.accepted_response,
    "ADR-0011 accepted",
    "accepted response",
  );
  assertCondition(
    gate.required_human_decision.on_acceptance_next_steps.some((step) =>
      step.includes("Status to Accepted"),
    ),
    "acceptance must update ADR status",
  );

  const chatDelta = gate.proposed_contract_delta.chat_instruction_command;
  assertEqual(chatDelta.fr_id, "FR-008", "chat FR id");
  assertEqual(chatDelta.decision_status, "not_accepted", "chat decision");
  assertEqual(
    chatDelta.must_not_reuse,
    "POST /cw/v1/runs/{run_id}/nodes/{node_id}:run-once",
    "chat must-not-reuse endpoint",
  );
  assertDeepEqual(
    chatDelta.proposed_endpoints,
    [
      "POST /cw/v1/runs/{run_id}:submit-instruction",
      "POST /cw/v1/runs/{run_id}/nodes/{node_id}:submit-instruction",
    ],
    "chat proposed endpoints",
  );
  assertDeepEqual(
    chatDelta.minimum_request_fields,
    ["schema_version", "scope", "instruction", "intent"],
    "chat minimum fields",
  );
  assertDeepEqual(
    chatDelta.required_headers,
    ["Idempotency-Key", "X-Project-Id"],
    "chat required headers",
  );

  const artifactDelta = gate.proposed_contract_delta.artifact_native_handoff;
  assertEqual(artifactDelta.fr_id, "FR-017", "artifact FR id");
  assertEqual(
    artifactDelta.decision_status,
    "not_accepted",
    "artifact decision",
  );
  assertEqual(
    artifactDelta.content_source,
    "GET /cw/v1/artifacts/{artifact_id}/content",
    "artifact content source",
  );
  assertEqual(
    artifactDelta.required_desktop_boundary,
    "preload/main native handoff",
    "artifact desktop boundary",
  );
  assertDeepEqual(artifactDelta.actions, ["open", "download"], "actions");
  assertCondition(
    artifactDelta.observable_result_fields.includes("destination_kind"),
    "observable result must include sanitized destination kind",
  );

  assertCondition(
    !apiSpecText.includes(":submit-instruction"),
    "accepted API spec must not contain unaccepted submit-instruction endpoints",
  );
  assertCondition(
    apiSpecText.includes("POST   /{run_id}/nodes/{node_id}:run-once"),
    "accepted API spec still owns run-once",
  );
  assertDeepEqual(
    gate.summary,
    {
      accepted_items: 0,
      implemented_items: 0,
      pending_human_decisions: 1,
      blocked_fr_items: 2,
      exit_p1_1_status: "not_ready",
    },
    "summary",
  );
  assertEqual(
    gate.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-runtime-flow-contract-acceptance-gate.cjs --check",
    "focused check",
  );
  assertEqual(
    gate.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-runtime-flow-contract-acceptance-gate.test.cjs",
    "focused test",
  );
  assertEqual(
    gate.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
    "runner output must be sanitized summary only",
  );
  assertCondition(
    desktopPackage.scripts.test.includes(
      "scripts/m1-5-runtime-flow-contract-acceptance-gate.test.cjs",
    ),
    "desktop package test must include acceptance gate test",
  );

  return {
    status: gate.gate_status,
    exitP1_1Status: gate.exit_p1_1_status,
    frIds: gate.fr_scope,
    acceptedItemCount: gate.summary.accepted_items,
    implementedItemCount: gate.summary.implemented_items,
    pendingHumanDecisionCount: gate.summary.pending_human_decisions,
    blockedFrItemCount: gate.summary.blocked_fr_items,
    adrStatus: adrStatus(adrText),
    acceptedSpecChangesAllowed:
      gate.current_decision_state.accepted_spec_changes_allowed,
    implementationAllowed:
      gate.current_decision_state.runtime_or_desktop_implementation_allowed,
    nextRecommendedSlices: gate.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateRuntimeFlowContractAcceptanceGate();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  gatePath,
  validateRuntimeFlowContractAcceptanceGate,
};
