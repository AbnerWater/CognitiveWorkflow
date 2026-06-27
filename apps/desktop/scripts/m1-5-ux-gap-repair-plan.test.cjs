const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
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
  "m1.5-ux-gap-repair-plan.json",
);
const dependencyGatePath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-dependency-gate-proposal.json",
);
const desktopPackagePath = path.join(packageRoot, "package.json");

const expectedTracksByReadiness = new Map([
  ["candidate_evidence_needs_a4_review", "TRACK-A4-CANDIDATE-EVIDENCE"],
  ["partial_requires_ui_evidence", "TRACK-LOCAL-UI-EVIDENCE"],
  ["partial_requires_runtime_flow", "TRACK-RUNTIME-FLOW-REPAIR"],
  ["backend_only_requires_desktop_flow", "TRACK-DESKTOP-RUNTIME-BRIDGE"],
  ["blocked_by_dependency_gate", "TRACK-REACT-FLOW-DEPENDENCY"],
  ["missing_implementation", "TRACK-REFERENCE-MANAGEMENT"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function countItems(items, predicate) {
  return items.filter(predicate).length;
}

function mapById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

test("M1.5 UX gap repair plan keeps acceptance conservative", () => {
  const repairPlan = readJson(repairPlanPath);
  const evidenceMap = readJson(evidenceMapPath);

  assert.equal(repairPlan.schema_version, "0.1.0");
  assert.equal(repairPlan.milestone, "M1.5");
  assert.equal(repairPlan.slice, "W1.5.174");
  assert.equal(repairPlan.plan_status, "repair_plan_not_implemented");
  assert.equal(repairPlan.exit_criterion, "EXIT-P1-1");
  assert.equal(repairPlan.exit_p1_1_status, "not_ready");
  assert.equal(repairPlan.superseded_by?.slice, "W1.5.186");
  assert.match(repairPlan.superseded_by?.reason ?? "", /no longer mirrors/u);
  assert.equal(evidenceMap.exit_p1_1_status, "not_ready");
  assert.equal(
    repairPlan.source.fr_evidence_map,
    "docs/04_runbook/m1.5-fr-evidence-map.json",
  );
  assert.match(
    repairPlan.guardrails.join(" "),
    /does not implement missing FR behavior/u,
  );
  assert.equal(repairPlan.track_summary.accepted_items, 0);
});

test("M1.5 UX gap repair plan assigns every FR exactly once", () => {
  const repairPlan = readJson(repairPlanPath);
  const evidenceMap = readJson(evidenceMapPath);
  const allMappedIds = evidenceMap.fr_evidence_items.map((item) => item.id);
  const allTrackIds = repairPlan.repair_tracks.flatMap((track) => track.fr_ids);

  assert.deepEqual(sorted(allTrackIds), sorted(allMappedIds));
  assert.equal(new Set(allTrackIds).size, allTrackIds.length);

  const tracksByReadiness = new Map(
    repairPlan.repair_tracks.map((track) => [
      track.source_acceptance_readiness,
      track,
    ]),
  );

  for (const [readiness, expectedTrackId] of expectedTracksByReadiness) {
    const track = tracksByReadiness.get(readiness);
    assert.ok(track);
    assert.equal(track.id, expectedTrackId);
    assert.equal(track.fr_ids.length > 0, true);
    assert.equal(Array.isArray(track.planned_repair_steps), true);
    assert.equal(track.planned_repair_steps.length > 0, true);
    assert.equal(Array.isArray(track.planned_verification), true);
    assert.equal(track.planned_verification.length > 0, true);
    assert.equal(typeof track.next_slice, "string");
  }

  assert.equal(
    countItems(
      evidenceMap.fr_evidence_items,
      (item) => item.acceptance_readiness === "runtime_bridge_needs_a4_review",
    ),
    5,
  );
  assert.equal(
    countItems(
      evidenceMap.fr_evidence_items,
      (item) =>
        item.acceptance_readiness ===
        "partial_runtime_bridge_requires_followup",
    ),
    4,
  );
});

test("M1.5 UX gap repair plan summary is derived from tracks and evidence map", () => {
  const repairPlan = readJson(repairPlanPath);
  const evidenceMap = readJson(evidenceMapPath);
  const tracksById = mapById(repairPlan.repair_tracks);
  const summary = repairPlan.track_summary;

  assert.equal(summary.total_fr_items, evidenceMap.fr_evidence_items.length);
  assert.equal(summary.repair_track_count, repairPlan.repair_tracks.length);
  assert.equal(
    summary.candidate_evidence_items,
    tracksById.get("TRACK-A4-CANDIDATE-EVIDENCE").fr_ids.length,
  );
  assert.equal(
    summary.local_ui_evidence_items,
    tracksById.get("TRACK-LOCAL-UI-EVIDENCE").fr_ids.length,
  );
  assert.equal(
    summary.runtime_flow_items,
    tracksById.get("TRACK-RUNTIME-FLOW-REPAIR").fr_ids.length,
  );
  assert.equal(
    summary.desktop_runtime_bridge_items,
    tracksById.get("TRACK-DESKTOP-RUNTIME-BRIDGE").fr_ids.length,
  );
  assert.equal(
    summary.dependency_gated_items,
    tracksById.get("TRACK-REACT-FLOW-DEPENDENCY").fr_ids.length,
  );
  assert.equal(
    summary.missing_implementation_items,
    tracksById.get("TRACK-REFERENCE-MANAGEMENT").fr_ids.length,
  );
  assert.equal(
    summary.accepted_items,
    countItems(
      evidenceMap.fr_evidence_items,
      (item) => item.acceptance_readiness === "accepted",
    ),
  );
  assert.equal(summary.exit_p1_1_status, "not_ready");
});

test("M1.5 UX gap repair plan preserves dependency gates and package boundary", () => {
  const repairPlan = readJson(repairPlanPath);
  const dependencyGate = readJson(dependencyGatePath);
  const desktopPackage = readJson(desktopPackagePath);
  const dependencies = {
    ...desktopPackage.dependencies,
    ...desktopPackage.devDependencies,
  };
  const proposedPackageNames = dependencyGate.dependency_gates.flatMap((gate) =>
    gate.proposed_packages.map((proposedPackage) => proposedPackage.name),
  );
  const reactFlowGate = dependencyGate.dependency_gates.find(
    (gate) => gate.id === "DEP-REACT-FLOW",
  );
  const reactFlowTrack = repairPlan.repair_tracks.find(
    (track) => track.id === "TRACK-REACT-FLOW-DEPENDENCY",
  );

  assert.equal(reactFlowGate?.status, "pending_human_approval");
  assert.equal(reactFlowTrack?.status, "blocked_pending_human_approval");
  assert.deepEqual(reactFlowTrack?.fr_ids, ["FR-004", "FR-019"]);
  assert.deepEqual(reactFlowTrack?.blocked_by_dependency_gates, [
    "DEP-REACT-FLOW",
  ]);
  for (const packageName of proposedPackageNames) {
    assert.equal(Object.hasOwn(dependencies, packageName), false);
  }
});

test("M1.5 UX gap repair plan orders follow-up slices without claiming implementation", () => {
  const repairPlan = readJson(repairPlanPath);
  const orderedTrackIds = repairPlan.implementation_sequence.map(
    (item) => item.track_id,
  );
  const knownTrackIds = new Set(
    repairPlan.repair_tracks.map((track) => track.id),
  );

  assert.equal(
    orderedTrackIds.every((trackId) => knownTrackIds.has(trackId)),
    true,
  );
  assert.deepEqual(
    repairPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.175", "W1.5.176", "W1.5.177"],
  );
  assert.equal(
    repairPlan.repair_tracks.some((track) => track.status === "implemented"),
    false,
  );
  assert.equal(repairPlan.exit_p1_1_status, "not_ready");
});
