const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
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
const dependencyGatePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-dependency-gate-proposal.json",
);

const expectedReadinessValues = new Set([
  "candidate_evidence_needs_a4_review",
  "runtime_bridge_needs_a4_review",
  "partial_runtime_bridge_requires_followup",
  "partial_requires_ui_evidence",
  "partial_requires_runtime_flow",
  "backend_only_requires_desktop_flow",
  "blocked_by_dependency_gate",
  "missing_implementation",
]);

const expectedNextSlices = ["W1.5.201"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function countItems(items, predicate) {
  return items.filter(predicate).length;
}

function mapById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

test("M1.5 FR evidence map preserves conservative source authority", () => {
  const evidenceMap = readJson(evidenceMapPath);
  const checklist = readJson(checklistPath);
  const dependencyGate = readJson(dependencyGatePath);

  assert.equal(evidenceMap.schema_version, "0.1.0");
  assert.equal(evidenceMap.milestone, "M1.5");
  assert.equal(evidenceMap.slice, "W1.5.199");
  assert.equal(evidenceMap.map_status, "evidence_refreshed_not_accepted");
  assert.equal(evidenceMap.exit_criterion, "EXIT-P1-1");
  assert.equal(evidenceMap.exit_p1_1_status, "not_ready");
  assert.equal(checklist.exit_p1_1_status, "not_ready");
  assert.equal(
    evidenceMap.source.ux_acceptance_checklist,
    "docs/04_runbook/m1.5-ux-acceptance-checklist.json",
  );
  assert.equal(
    dependencyGate.dependency_gates.find((gate) => gate.id === "DEP-REACT-FLOW")
      ?.status,
    "pending_human_approval",
  );
  assert.match(
    evidenceMap.guardrails.join(" "),
    /does not claim A4 acceptance/u,
  );
});

test("M1.5 FR evidence map mirrors FR-001 through FR-020 checklist ids and statuses", () => {
  const evidenceMap = readJson(evidenceMapPath);
  const checklist = readJson(checklistPath);

  assert.deepEqual(
    evidenceMap.fr_evidence_items.map((item) => item.id),
    checklist.fr_acceptance_items.map((item) => item.id),
  );

  const evidenceById = mapById(evidenceMap.fr_evidence_items);
  for (const checklistItem of checklist.fr_acceptance_items) {
    const mappedItem = evidenceById.get(checklistItem.id);
    assert.ok(mappedItem);
    assert.equal(
      mappedItem.checklist_status,
      checklistItem.current_evidence_status,
    );
    assert.equal(
      expectedReadinessValues.has(mappedItem.acceptance_readiness),
      true,
    );
    assert.equal(Array.isArray(mappedItem.evidence_refs), true);
    assert.equal(mappedItem.evidence_refs.length > 0, true);
    assert.equal(Array.isArray(mappedItem.verification_commands), true);
    assert.equal(Array.isArray(mappedItem.missing_evidence), true);
    assert.equal(mappedItem.missing_evidence.length > 0, true);
    assert.equal(typeof mappedItem.next_action, "string");
    assert.notEqual(mappedItem.acceptance_readiness, "accepted");
  }
});

test("M1.5 FR evidence map summary counts are derived from item statuses", () => {
  const evidenceMap = readJson(evidenceMapPath);
  const checklist = readJson(checklistPath);
  const items = evidenceMap.fr_evidence_items;
  const sourceSummary = evidenceMap.source_status_summary;
  const readinessSummary = evidenceMap.acceptance_readiness_summary;

  assert.deepEqual(sourceSummary, checklist.acceptance_summary);
  assert.equal(sourceSummary.total_fr_items, items.length);
  assert.equal(sourceSummary.accepted_items, 0);
  assert.equal(
    sourceSummary.candidate_evidence_available_items,
    countItems(
      items,
      (item) => item.checklist_status === "candidate_evidence_available",
    ),
  );
  assert.equal(
    sourceSummary.runtime_bridge_evidence_available_items,
    countItems(
      items,
      (item) => item.checklist_status === "runtime_bridge_evidence_available",
    ),
  );
  assert.equal(
    sourceSummary.partial_runtime_bridge_evidence_items,
    countItems(
      items,
      (item) => item.checklist_status === "partial_runtime_bridge_evidence",
    ),
  );
  assert.equal(
    sourceSummary.partial_or_scaffold_items,
    countItems(
      items,
      (item) =>
        item.checklist_status === "partial_evidence" ||
        item.checklist_status === "partial_scaffold",
    ),
  );
  assert.equal(
    sourceSummary.backend_or_schema_only_items,
    countItems(
      items,
      (item) =>
        item.checklist_status === "backend_evidence_only" ||
        item.checklist_status === "backend_or_schema_evidence_only",
    ),
  );
  assert.equal(
    sourceSummary.blocked_by_dependency_gate_items,
    countItems(
      items,
      (item) => item.checklist_status === "blocked_by_dependency_gate",
    ),
  );
  assert.equal(
    sourceSummary.not_started_items,
    countItems(items, (item) => item.checklist_status === "not_started"),
  );
  assert.equal(
    readinessSummary.candidate_evidence_needs_a4_review_items,
    countItems(
      items,
      (item) =>
        item.acceptance_readiness === "candidate_evidence_needs_a4_review",
    ),
  );
  assert.equal(
    readinessSummary.runtime_bridge_needs_a4_review_items,
    countItems(
      items,
      (item) => item.acceptance_readiness === "runtime_bridge_needs_a4_review",
    ),
  );
  assert.equal(
    readinessSummary.partial_runtime_bridge_requires_followup_items,
    countItems(
      items,
      (item) =>
        item.acceptance_readiness ===
        "partial_runtime_bridge_requires_followup",
    ),
  );
  assert.equal(
    readinessSummary.partial_requires_ui_evidence_items,
    countItems(
      items,
      (item) => item.acceptance_readiness === "partial_requires_ui_evidence",
    ),
  );
  assert.equal(
    readinessSummary.partial_requires_runtime_flow_items,
    countItems(
      items,
      (item) => item.acceptance_readiness === "partial_requires_runtime_flow",
    ),
  );
  assert.equal(
    readinessSummary.backend_only_requires_desktop_flow_items,
    countItems(
      items,
      (item) =>
        item.acceptance_readiness === "backend_only_requires_desktop_flow",
    ),
  );
  assert.equal(
    readinessSummary.blocked_by_dependency_gate_items,
    countItems(
      items,
      (item) => item.acceptance_readiness === "blocked_by_dependency_gate",
    ),
  );
  assert.equal(
    readinessSummary.missing_implementation_items,
    countItems(
      items,
      (item) => item.acceptance_readiness === "missing_implementation",
    ),
  );
  assert.equal(readinessSummary.accepted_items, 0);
});

test("M1.5 FR evidence map keeps candidate, bridge, and blocked tracks explicit", () => {
  const evidenceMap = readJson(evidenceMapPath);
  const itemsById = mapById(evidenceMap.fr_evidence_items);

  for (const id of ["FR-009", "FR-010", "FR-016"]) {
    const item = itemsById.get(id);
    assert.equal(
      item?.acceptance_readiness,
      "candidate_evidence_needs_a4_review",
    );
    assert.equal(item.verification_commands.length > 0, true);
  }

  for (const id of ["FR-004", "FR-019"]) {
    const item = itemsById.get(id);
    assert.equal(item?.acceptance_readiness, "blocked_by_dependency_gate");
    assert.match(item.evidence_refs.join(" "), /DEP-REACT-FLOW/u);
    assert.match(item.missing_evidence.join(" "), /DEP-REACT-FLOW/u);
    assert.deepEqual(item.verification_commands, []);
  }

  for (const id of ["FR-007", "FR-008", "FR-012", "FR-013", "FR-017"]) {
    const item = itemsById.get(id);
    assert.equal(item?.acceptance_readiness, "runtime_bridge_needs_a4_review");
    assert.equal(item.verification_commands.length > 0, true);
    assert.match(item.missing_evidence.join(" "), /A4/u);
  }

  for (const id of ["FR-011", "FR-014", "FR-015", "FR-018"]) {
    const item = itemsById.get(id);
    assert.equal(
      item?.acceptance_readiness,
      "partial_runtime_bridge_requires_followup",
    );
    assert.equal(item.verification_commands.length > 0, true);
    assert.match(
      item.missing_evidence.join(" "),
      /A4|not implemented|incomplete/u,
    );
  }

  assert.equal(
    evidenceMap.fr_evidence_items.some(
      (item) => item.acceptance_readiness === "missing_implementation",
    ),
    false,
  );
});

test("M1.5 FR evidence map recommends follow-up slices without marking EXIT-P1-1 ready", () => {
  const evidenceMap = readJson(evidenceMapPath);

  assert.deepEqual(
    evidenceMap.next_recommended_slices.map((slice) => slice.id),
    expectedNextSlices,
  );
  assert.equal(
    evidenceMap.fr_evidence_items.some(
      (item) => item.acceptance_readiness === "accepted",
    ),
    false,
  );
  assert.equal(evidenceMap.exit_p1_1_status, "not_ready");
});
