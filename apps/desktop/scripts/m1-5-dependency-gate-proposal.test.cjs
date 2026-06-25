const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const proposalPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-dependency-gate-proposal.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const roadmapPath = path.join(repoRoot, "docs", "roadmap.md");
const desktopPackagePath = path.join(packageRoot, "package.json");
const rootPackagePath = path.join(repoRoot, "package.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function collectPackageVersions(packageJson) {
  return new Map([
    ...Object.entries(packageJson.dependencies ?? {}),
    ...Object.entries(packageJson.devDependencies ?? {}),
  ]);
}

function flattenProposedPackages(proposal) {
  return proposal.dependency_gates.flatMap((gate) =>
    gate.proposed_packages.map((dependency) => ({
      gateId: gate.id,
      ...dependency,
    })),
  );
}

test("M1.5 dependency gate proposal stays pending human approval", () => {
  const proposal = readJson(proposalPath);
  const readinessLedger = readJson(readinessLedgerPath);
  const roadmap = fs.readFileSync(roadmapPath, { encoding: "utf8" });

  assert.equal(proposal.schema_version, "0.1.0");
  assert.equal(proposal.milestone, "M1.5");
  assert.equal(proposal.slice, "W1.5.171");
  assert.equal(proposal.proposal_status, "pending_human_approval");
  assert.match(roadmap, /Electron Forge \+ Vite \+ React 18/u);
  assert.match(roadmap, /React Flow Canvas/u);
  assert.match(roadmap, /electron-updater/u);
  assert.match(proposal.approval_request.required_before, /package\.json/u);
  assert.match(proposal.approval_request.required_before, /pnpm-lock\.yaml/u);

  assert.deepEqual(
    proposal.dependency_gates.map((gate) => gate.id),
    ["DEP-FORGE", "DEP-TAILWIND", "DEP-REACT-FLOW", "DEP-UPDATER"],
  );
  assert.deepEqual(
    proposal.dependency_gates.map((gate) => gate.status),
    [
      "pending_human_approval",
      "pending_human_approval",
      "pending_human_approval",
      "pending_human_approval",
    ],
  );
  assert.deepEqual(
    proposal.dependency_gates.map((gate) => gate.id),
    readinessLedger.dependency_boundary.requires_separate_gate.map(
      (gate) => gate.id,
    ),
  );
});

test("M1.5 dependency gate proposal pins candidate versions without installing them", () => {
  const proposal = readJson(proposalPath);
  const desktopPackage = readJson(desktopPackagePath);
  const rootPackage = readJson(rootPackagePath);
  const desktopPackageVersions = collectPackageVersions(desktopPackage);
  const rootPackageVersions = collectPackageVersions(rootPackage);
  const proposedPackages = flattenProposedPackages(proposal);

  assert.deepEqual(
    proposedPackages.map((dependency) => [
      dependency.gateId,
      dependency.name,
      dependency.version,
      dependency.package_json_section,
    ]),
    [
      ["DEP-FORGE", "@electron-forge/cli", "7.11.2", "devDependencies"],
      ["DEP-FORGE", "@electron-forge/plugin-vite", "7.11.2", "devDependencies"],
      ["DEP-TAILWIND", "tailwindcss", "3.4.19", "devDependencies"],
      ["DEP-TAILWIND", "postcss", "8.5.15", "devDependencies"],
      ["DEP-TAILWIND", "autoprefixer", "10.5.2", "devDependencies"],
      ["DEP-REACT-FLOW", "@xyflow/react", "12.11.1", "dependencies"],
      ["DEP-UPDATER", "electron-updater", "6.8.9", "dependencies"],
      ["DEP-UPDATER", "electron-builder", "26.15.3", "devDependencies"],
    ],
  );

  for (const dependency of proposedPackages) {
    assert.equal(
      desktopPackageVersions.has(dependency.name),
      false,
      `${dependency.name} must not be installed in @cw/desktop before human approval`,
    );
    assert.equal(
      rootPackageVersions.has(dependency.name),
      false,
      `${dependency.name} must not be installed at the workspace root before human approval`,
    );
    assert.equal(typeof dependency.reason, "string");
    assert.notEqual(dependency.reason.trim(), "");
    assert.match(dependency.registry_check, /^pnpm view /u);
  }
});

test("M1.5 dependency gate proposal preserves approved minimal dependency pins", () => {
  const proposal = readJson(proposalPath);
  const desktopPackage = readJson(desktopPackagePath);

  assert.deepEqual(proposal.current_approved_minimal_group, [
    {
      name: "react",
      version: "18.3.1",
      package_json_section: "dependencies",
    },
    {
      name: "react-dom",
      version: "18.3.1",
      package_json_section: "dependencies",
    },
    {
      name: "electron",
      version: "35.7.5",
      package_json_section: "devDependencies",
    },
    {
      name: "vite",
      version: "5.4.21",
      package_json_section: "devDependencies",
    },
    {
      name: "@vitejs/plugin-react",
      version: "4.7.0",
      package_json_section: "devDependencies",
    },
    {
      name: "@types/react",
      version: "18.3.31",
      package_json_section: "devDependencies",
    },
    {
      name: "@types/react-dom",
      version: "18.3.7",
      package_json_section: "devDependencies",
    },
  ]);

  for (const dependency of proposal.current_approved_minimal_group) {
    assert.equal(
      desktopPackage[dependency.package_json_section]?.[dependency.name],
      dependency.version,
      `${dependency.name} must keep the currently approved W1.5 pin`,
    );
  }
});

test("M1.5 dependency gate proposal keeps implementation slices explicit", () => {
  const proposal = readJson(proposalPath);
  const gatesById = new Map(
    proposal.dependency_gates.map((gate) => [gate.id, gate]),
  );

  assert.match(
    gatesById.get("DEP-TAILWIND")?.proposed_packages[0]?.reason,
    /Tailwind 3\.x/u,
  );
  assert.equal(
    gatesById.get("DEP-REACT-FLOW")?.roadmap_items.includes("EXIT-P1-12"),
    true,
  );
  assert.equal(
    gatesById.get("DEP-UPDATER")?.roadmap_items.includes("EXIT-P1-7"),
    true,
  );

  for (const gate of proposal.dependency_gates) {
    assert.match(gate.install_command_after_approval, /^pnpm /u);
    assert.ok(gate.implementation_sequence.length > 0);
    assert.ok(gate.verification_plan_after_approval.length > 0);
    assert.ok(gate.risks.length > 0);
  }

  assert.deepEqual(
    proposal.next_recommended_slices_after_approval.map((slice) => slice.id),
    ["W1.5.172", "W1.5.173"],
  );
});
