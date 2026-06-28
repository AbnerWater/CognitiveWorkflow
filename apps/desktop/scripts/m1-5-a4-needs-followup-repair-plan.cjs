const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
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
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);

const forbiddenFragments = [
  "Review repair plan now",
  "Confirm workflow handoff",
  "Resume local request",
  "AppData",
  "outputDir",
  "outputPath",
  "jsonPath",
  "token=",
  "#hash",
  "rawPrompt",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
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

function assertSanitizedJson(value, label) {
  const text = JSON.stringify(value);
  for (const fragment of forbiddenFragments) {
    assertCondition(
      !text.includes(fragment),
      `${label} must not contain forbidden fragment ${fragment}`,
    );
  }
}

function validateA4NeedsFollowupRepairPlan(options = {}) {
  const repairPlan = readJson(options.repairPlanPath ?? repairPlanPath);
  const decisionRecord = readJson(
    options.decisionRecordPath ?? decisionRecordPath,
  );
  const readinessLedger = readJson(
    options.readinessLedgerPath ?? readinessLedgerPath,
  );

  assertSanitizedJson(repairPlan, "A4 needs-followup repair plan");
  assertEqual(repairPlan.schema_version, "0.1.0", "schema version");
  assertEqual(repairPlan.milestone, "M1.5", "milestone");
  assertEqual(repairPlan.slice, "W1.5.209", "slice id");
  assertEqual(
    repairPlan.plan_status,
    "a4_needs_followup_repair_plan_prepared_not_implemented",
    "plan status",
  );
  assertEqual(repairPlan.exit_p1_1_status, "not_ready", "EXIT-P1-1 status");

  assertEqual(decisionRecord.slice, "W1.5.208", "decision record source slice");
  assertEqual(
    decisionRecord.summary.needs_followup_items,
    decisionRecord.decision_items.length,
    "source needs-followup item count",
  );
  assertEqual(
    decisionRecord.summary.accepted_items,
    0,
    "source accepted item count",
  );
  assertEqual(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
    "readiness ledger EXIT-P1-1 status",
  );

  const sourceDecisionItemsById = new Map(
    decisionRecord.decision_items.map((item) => [item.id, item]),
  );
  const tracksById = new Map(
    repairPlan.repair_tracks.map((track) => [track.id, track]),
  );
  const trackItemCounts = new Map(
    repairPlan.repair_tracks.map((track) => [track.id, 0]),
  );

  assertEqual(
    repairPlan.repair_items.length,
    decisionRecord.decision_items.length,
    "repair item count",
  );
  assertDeepEqual(
    sorted(repairPlan.repair_items.map((item) => item.source_decision_id)),
    sorted(decisionRecord.decision_items.map((item) => item.id)),
    "source decision ids",
  );
  assertEqual(
    repairPlan.excluded_items.some((item) => item.fr_id === "FR-015"),
    true,
    "FR-015 excluded item",
  );
  assertEqual(
    repairPlan.repair_items.some((item) => item.fr_id === "FR-015"),
    false,
    "FR-015 repair item absence",
  );

  for (const track of repairPlan.repair_tracks) {
    assertEqual(track.status, "planned_not_implemented", `${track.id} status`);
    assertCondition(track.fr_ids.length > 0, `${track.id} FR ids`);
    assertCondition(
      typeof track.entry_slice === "string" && track.entry_slice.length > 0,
      `${track.id} entry slice`,
    );
  }

  for (const repairItem of repairPlan.repair_items) {
    const sourceDecision = sourceDecisionItemsById.get(
      repairItem.source_decision_id,
    );
    const track = tracksById.get(repairItem.track_id);

    assertCondition(
      Boolean(sourceDecision),
      `${repairItem.id} source decision exists`,
    );
    assertCondition(Boolean(track), `${repairItem.id} track exists`);
    assertEqual(
      repairItem.fr_id,
      sourceDecision.fr_id,
      `${repairItem.id} source FR id`,
    );
    assertEqual(
      repairItem.source_decision,
      "needs_followup",
      `${repairItem.id} source decision`,
    );
    assertEqual(
      sourceDecision.decision,
      "needs_followup",
      `${repairItem.id} source record decision`,
    );
    assertEqual(
      repairItem.implementation_status,
      "planned_not_implemented",
      `${repairItem.id} implementation status`,
    );
    assertCondition(
      track.fr_ids.includes(repairItem.fr_id),
      `${repairItem.id} track FR membership`,
    );
    assertDeepEqual(
      repairItem.acceptance_blockers,
      sourceDecision.acceptance_blockers,
      `${repairItem.id} acceptance blockers`,
    );
    assertCondition(
      repairItem.required_actions.length > 0,
      `${repairItem.id} required actions`,
    );
    assertCondition(
      repairItem.verification_commands.length > 0,
      `${repairItem.id} verification commands`,
    );
    trackItemCounts.set(
      repairItem.track_id,
      (trackItemCounts.get(repairItem.track_id) ?? 0) + 1,
    );
  }

  assertEqual(
    repairPlan.summary.repair_item_count,
    repairPlan.repair_items.length,
    "summary repair item count",
  );
  assertEqual(
    repairPlan.summary.stream_phase_capture_items,
    trackItemCounts.get("TRACK-A4-STREAM-PHASE-CAPTURE"),
    "summary stream phase capture count",
  );
  assertEqual(
    repairPlan.summary.runtime_bridge_capture_items,
    trackItemCounts.get("TRACK-A4-RUNTIME-BRIDGE-CAPTURE"),
    "summary runtime bridge capture count",
  );
  assertEqual(
    repairPlan.summary.git_history_prereq_items,
    trackItemCounts.get("TRACK-A8-GIT-HISTORY-PREREQ"),
    "summary git history prereq count",
  );
  assertEqual(repairPlan.summary.accepted_items, 0, "summary accepted items");
  assertEqual(
    repairPlan.summary.implemented_items,
    0,
    "summary implemented items",
  );
  assertEqual(
    repairPlan.summary.planned_not_implemented_items,
    repairPlan.repair_items.length,
    "summary planned item count",
  );
  assertEqual(
    repairPlan.summary.excluded_items,
    repairPlan.excluded_items.length,
    "summary excluded item count",
  );
  assertEqual(
    repairPlan.summary.source_needs_followup_items,
    decisionRecord.summary.needs_followup_items,
    "summary source needs-followup count",
  );
  assertEqual(
    repairPlan.summary.exit_p1_1_status,
    "not_ready",
    "summary EXIT-P1-1 status",
  );
  assertDeepEqual(
    repairPlan.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.210"],
    "next recommended slices",
  );

  return {
    status: repairPlan.plan_status,
    exitP1_1Status: repairPlan.exit_p1_1_status,
    repairItemCount: repairPlan.repair_items.length,
    trackIds: repairPlan.repair_tracks.map((track) => track.id),
    frIds: repairPlan.repair_items.map((item) => item.fr_id),
    acceptedItemCount: repairPlan.summary.accepted_items,
    implementedItemCount: repairPlan.summary.implemented_items,
    plannedNotImplementedItemCount:
      repairPlan.summary.planned_not_implemented_items,
    excludedFrIds: repairPlan.excluded_items.map((item) => item.fr_id),
    nextRecommendedSlices: repairPlan.next_recommended_slices.map(
      (slice) => slice.id,
    ),
  };
}

if (require.main === module) {
  const summary = validateA4NeedsFollowupRepairPlan();
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

module.exports = {
  repairPlanPath,
  validateA4NeedsFollowupRepairPlan,
};
