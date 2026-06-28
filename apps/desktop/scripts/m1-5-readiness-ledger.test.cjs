const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const ledgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const roadmapPath = path.join(repoRoot, "docs", "roadmap.md");
const desktopPackagePath = path.join(packageRoot, "package.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function collectDesktopPackageVersions(packageJson) {
  return new Map([
    ...Object.entries(packageJson.dependencies ?? {}),
    ...Object.entries(packageJson.devDependencies ?? {}),
  ]);
}

test("M1.5 readiness ledger keeps phase status conservative", () => {
  const ledger = readJson(ledgerPath);
  const roadmap = fs.readFileSync(roadmapPath, { encoding: "utf8" });

  assert.equal(ledger.schema_version, "0.1.0");
  assert.equal(ledger.milestone, "M1.5");
  assert.equal(ledger.slice, "W1.5.213");
  assert.equal(ledger.status, "in_progress");
  assert.match(roadmap, /Electron Forge \+ Vite \+ React 18/u);
  assert.match(roadmap, /React Flow Canvas/u);
  assert.match(roadmap, /electron-updater/u);
  assert.match(roadmap, /EXIT-P1-1/u);

  const phaseExitStatuses = new Set(
    ledger.phase_1_exit_readiness.map((item) => item.status),
  );
  const phaseExitIds = ledger.phase_1_exit_readiness.map((item) => item.id);
  assert.equal(ledger.phase_1_exit_readiness.length, 12);
  assert.deepEqual(phaseExitIds, [
    "EXIT-P1-1",
    "EXIT-P1-2",
    "EXIT-P1-3",
    "EXIT-P1-4",
    "EXIT-P1-5",
    "EXIT-P1-6",
    "EXIT-P1-7",
    "EXIT-P1-8",
    "EXIT-P1-9",
    "EXIT-P1-10",
    "EXIT-P1-11",
    "EXIT-P1-12",
  ]);
  assert.equal(phaseExitStatuses.has("ready"), false);
  assert.equal(phaseExitStatuses.has("verified"), false);
  assert.equal(
    ledger.phase_1_exit_readiness.every(
      (item) =>
        item.status === "not_ready" ||
        item.status === "deferred_to_m1_6" ||
        item.status === "blocked_by_dependency_gate",
    ),
    true,
  );
});

test("M1.5 readiness ledger matches the approved desktop dependency boundary", () => {
  const ledger = readJson(ledgerPath);
  const desktopPackage = readJson(desktopPackagePath);
  const desktopPackageVersions = collectDesktopPackageVersions(desktopPackage);

  for (const dependency of ledger.dependency_boundary.approved_minimal_group) {
    assert.equal(
      desktopPackage[dependency.package_json_section]?.[dependency.name],
      dependency.version,
      `${dependency.name} must stay pinned in ${dependency.package_json_section}`,
    );
  }

  const gatedPackages =
    ledger.dependency_boundary.requires_separate_gate.flatMap(
      (gate) => gate.packages,
    );
  for (const packageName of gatedPackages) {
    assert.equal(
      desktopPackageVersions.has(packageName),
      false,
      `${packageName} must not be installed before its dependency gate`,
    );
  }

  assert.deepEqual(
    ledger.dependency_boundary.requires_separate_gate.map((gate) => gate.id),
    ["DEP-FORGE", "DEP-TAILWIND", "DEP-REACT-FLOW", "DEP-UPDATER"],
  );
});

test("M1.5 readiness ledger records roadmap item gaps without claiming exit readiness", () => {
  const ledger = readJson(ledgerPath);
  const roadmapItemsById = new Map(
    ledger.m1_5_roadmap_items.map((item) => [item.id, item]),
  );
  const exitItemsById = new Map(
    ledger.phase_1_exit_readiness.map((item) => [item.id, item]),
  );

  assert.equal(roadmapItemsById.get("M1.5-R2")?.status, "verified");
  assert.equal(roadmapItemsById.get("M1.5-R3")?.status, "verified");
  assert.equal(
    roadmapItemsById.get("M1.5-R4")?.status,
    "blocked_by_dependency_gate",
  );
  assert.equal(
    roadmapItemsById.get("M1.5-R8")?.status,
    "blocked_by_dependency_gate",
  );
  assert.match(
    roadmapItemsById.get("M1.5-R7")?.verified_evidence.join(" ") ?? "",
    /W1\.5\.213/u,
  );
  assert.match(
    roadmapItemsById.get("M1.5-R7")?.remaining_gap.join(" ") ?? "",
    /needs_followup/u,
  );
  assert.match(
    roadmapItemsById.get("M1.5-R7")?.remaining_gap.join(" ") ?? "",
    /restore-to-snapshot/u,
  );
  assert.equal(exitItemsById.get("EXIT-P1-1")?.status, "not_ready");
  assert.equal(
    exitItemsById.get("EXIT-P1-7")?.status,
    "blocked_by_dependency_gate",
  );
  assert.equal(
    exitItemsById.get("EXIT-P1-12")?.status,
    "blocked_by_dependency_gate",
  );

  for (const item of ledger.m1_5_roadmap_items) {
    assert.equal(typeof item.requirement, "string");
    assert.notEqual(item.requirement.trim(), "");
    assert.equal(Array.isArray(item.verified_evidence), true);
    assert.equal(Array.isArray(item.remaining_gap), true);
    if (item.status === "verified") {
      assert.equal(item.remaining_gap.length, 0);
    } else {
      assert.ok(item.remaining_gap.length > 0);
    }
  }

  assert.deepEqual(
    ledger.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.214"],
  );
});
