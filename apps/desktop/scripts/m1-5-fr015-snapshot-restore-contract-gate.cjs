const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const gatePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-fr015-snapshot-restore-contract-gate.json",
);
const adrPath = path.join(
  repoRoot,
  "docs",
  "03_decisions",
  "0012-fr015-snapshot-ledger-restore-contract.md",
);
const adrIndexPath = path.join(repoRoot, "docs", "03_decisions", "README.md");
const apiSpecPath = path.join(repoRoot, "specs", "api", "http_sse.md");
const runtimeHarnessPath = path.join(repoRoot, "specs", "runtime_harness.md");
const failureTaxonomyPath = path.join(repoRoot, "specs", "failure_taxonomy.md");
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
const repairPlanPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-runtime-flow-repair-plan.json",
);
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

function assertTextIncludes(text, expected, message) {
  assertCondition(text.includes(expected), message);
}

function assertTextExcludes(text, forbidden, message) {
  assertCondition(!text.includes(forbidden), message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertWorkflowApiRouteAbsent(text, method, routeSuffix, message) {
  const pattern = new RegExp(
    `\\b${escapeRegExp(method)}\\s+(?:/cw/v1/workflows|/workflows)?${escapeRegExp(routeSuffix)}(?:\\b|\\s|$)`,
    "u",
  );
  assertCondition(!pattern.test(text), message);
}

function repoText(sourcePath, options) {
  const overrideText = options.contractTexts?.[sourcePath];
  if (typeof overrideText === "string") {
    return overrideText;
  }
  return readText(path.join(repoRoot, ...sourcePath.split("/")));
}

function findFrItem(items, frId, sourceName) {
  const item = items.find((candidate) => candidate.id === frId);
  assertCondition(Boolean(item), `${sourceName} missing ${frId}`);
  return item;
}

function validateFr015SnapshotRestoreContractGate(options = {}) {
  const gate = readJson(options.gatePath ?? gatePath);
  const adrText = readText(options.adrPath ?? adrPath);
  const adrIndexText = readText(options.adrIndexPath ?? adrIndexPath);
  const apiSpecText = readText(options.apiSpecPath ?? apiSpecPath);
  const runtimeHarnessText = readText(
    options.runtimeHarnessPath ?? runtimeHarnessPath,
  );
  const failureTaxonomyText = readText(
    options.failureTaxonomyPath ?? failureTaxonomyPath,
  );
  const checklist = readJson(options.checklistPath ?? checklistPath);
  const evidenceMap = readJson(options.evidenceMapPath ?? evidenceMapPath);
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const desktopPackage = readJson(
    options.desktopPackagePath ?? desktopPackagePath,
  );

  assertEqual(gate.schema_version, "0.1.0", "schema version");
  assertEqual(gate.milestone, "M1.5", "milestone");
  assertEqual(gate.slice, "W1.5.205", "slice id");
  assertEqual(gate.gate_status, "pending_human_confirmation", "gate status");
  assertEqual(gate.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");
  assertDeepEqual(gate.fr_scope, ["FR-015"], "FR scope");

  assertEqual(
    gate.current_decision_state.adr_0012_status,
    "Proposed",
    "declared ADR status",
  );
  assertEqual(adrStatus(adrText), "Proposed", "actual ADR status");
  assertTextIncludes(
    adrIndexText,
    "| [0012](0012-fr015-snapshot-ledger-restore-contract.md) | FR-015 Snapshot Ledger Restore Contract                       | Proposed | 2026-06-28 |",
    "ADR index must mark ADR-0012 Proposed",
  );
  assertEqual(
    gate.current_decision_state.human_confirmation_required,
    true,
    "human confirmation must be required",
  );
  assertEqual(
    gate.current_decision_state.accepted_spec_changes_allowed,
    false,
    "accepted spec changes must stay blocked",
  );
  assertEqual(
    gate.current_decision_state.runtime_or_desktop_implementation_allowed,
    false,
    "runtime/Desktop implementation must stay blocked",
  );
  assertEqual(
    gate.required_human_decision.accepted_response,
    "ADR-0012 accepted",
    "accepted response",
  );
  assertEqual(
    gate.required_human_decision.accepted_at,
    null,
    "accepted_at must remain null",
  );
  assertEqual(
    gate.required_human_decision.consumed_by_slice,
    null,
    "consumed_by_slice must remain null",
  );

  const projection = gate.proposed_contract_delta.snapshot_ledger_projection;
  assertEqual(projection.fr_id, "FR-015", "projection FR id");
  assertEqual(
    projection.decision_status,
    "proposed_not_accepted",
    "projection decision status",
  );
  assertEqual(
    projection.proposed_endpoint,
    "GET /cw/v1/workflows/{workflow_id}/snapshots",
    "projection endpoint",
  );
  assertEqual(
    projection.source_ledger,
    ".agent-workflow/snapshots/snapshots.jsonl",
    "projection source ledger",
  );
  assertCondition(
    projection.minimum_projected_fields.includes("restorable"),
    "projection must expose restorable metadata",
  );

  const restore = gate.proposed_contract_delta.restore_to_snapshot;
  assertEqual(restore.fr_id, "FR-015", "restore FR id");
  assertEqual(
    restore.decision_status,
    "proposed_not_accepted",
    "restore decision status",
  );
  assertDeepEqual(
    restore.required_lock_boundary,
    ["runtime.lock", "workflow_editor.lock", "git.lock"],
    "restore lock boundary",
  );
  assertCondition(
    restore.continue_semantics.includes("must not automatically continue"),
    "restore must not auto-continue",
  );

  assertTextIncludes(
    apiSpecText,
    "POST   /{workflow_id}/snapshot                    \u2192 \u663e\u5f0f git snapshot",
    "accepted API spec must still define explicit workflow snapshot",
  );
  assertTextIncludes(
    apiSpecText,
    "GET    /{workflow_id}/history                     \u2192 workflow_history.json",
    "accepted API spec must still define workflow history",
  );
  assertWorkflowApiRouteAbsent(
    apiSpecText,
    "GET",
    "/{workflow_id}/snapshots",
    "accepted API spec must not contain premature snapshot ledger projection endpoint",
  );
  assertWorkflowApiRouteAbsent(
    apiSpecText,
    "POST",
    "/{workflow_id}/snapshots/{snapshot_id}:restore",
    "accepted API spec must not contain premature restore-to-snapshot endpoint",
  );
  assertWorkflowApiRouteAbsent(
    apiSpecText,
    "POST",
    "/{workflow_id}/snapshots/{snapshot_id}:continue",
    "accepted API spec must not contain premature continue-after-restore endpoint",
  );

  assertTextIncludes(
    runtimeHarnessText,
    "snapshots/snapshots.jsonl",
    "runtime harness must define snapshot ledger storage",
  );
  assertTextIncludes(
    runtimeHarnessText,
    "locks/git.lock",
    "runtime harness must define git lock boundary",
  );
  assertTextIncludes(
    failureTaxonomyText,
    "`RH_*`",
    "failure taxonomy must define runtime harness namespace",
  );
  assertTextIncludes(
    failureTaxonomyText,
    "`RES_NOT_FOUND`",
    "failure taxonomy must inherit API resource namespace",
  );

  const checklistItem = findFrItem(
    checklist.fr_acceptance_items,
    "FR-015",
    "checklist",
  );
  const evidenceItem = findFrItem(
    evidenceMap.fr_evidence_items,
    "FR-015",
    "evidence map",
  );
  assertEqual(
    checklistItem.current_evidence_status,
    "partial_runtime_bridge_evidence",
    "FR-015 checklist status",
  );
  assertEqual(
    evidenceItem.acceptance_readiness,
    "partial_runtime_bridge_requires_followup",
    "FR-015 acceptance readiness",
  );
  assertCondition(
    checklistItem.remaining_gap.some((gap) =>
      gap.includes("no accepted restore contract exists"),
    ),
    "FR-015 checklist must retain restore contract gap",
  );
  assertCondition(
    evidenceItem.missing_evidence.some((gap) =>
      gap.toLowerCase().includes("restore-to-snapshot"),
    ),
    "FR-015 evidence map must retain restore gap",
  );
  assertDeepEqual(
    repairPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.208"],
    "source repair plan next slice",
  );

  for (const anchor of gate.accepted_contract_anchors) {
    assertTextIncludes(
      repoText(anchor.source, options),
      anchor.pattern,
      `missing accepted anchor ${anchor.pattern} in ${anchor.source}`,
    );
  }
  for (const forbidden of gate.forbidden_premature_changes) {
    assertCondition(
      typeof forbidden === "string" && forbidden.length > 0,
      "forbidden premature change entries must be non-empty",
    );
  }

  assertDeepEqual(
    gate.summary,
    {
      accepted_items: 0,
      implemented_items: 0,
      pending_human_decisions: 1,
      blocked_fr_items: 1,
      exit_p1_1_status: "not_ready",
    },
    "summary",
  );
  assertEqual(
    gate.runner_contract.focused_check,
    "node apps/desktop/scripts/m1-5-fr015-snapshot-restore-contract-gate.cjs --check",
    "focused check",
  );
  assertEqual(
    gate.runner_contract.focused_test,
    "node --test apps/desktop/scripts/m1-5-fr015-snapshot-restore-contract-gate.test.cjs",
    "focused test",
  );
  assertEqual(
    gate.runner_contract.runner_output_contract.sanitized_summary_only,
    true,
    "runner output must be sanitized summary only",
  );
  assertCondition(
    desktopPackage.scripts.test.includes(
      "scripts/m1-5-fr015-snapshot-restore-contract-gate.test.cjs",
    ),
    "desktop package test must include FR-015 contract gate test",
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
  const summary = validateFr015SnapshotRestoreContractGate();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  gatePath,
  validateFr015SnapshotRestoreContractGate,
};
