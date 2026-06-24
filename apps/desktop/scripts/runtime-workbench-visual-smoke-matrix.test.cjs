const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const matrixScriptPath = path.join(
  __dirname,
  "runtime-workbench-visual-smoke-matrix.cjs",
);
const matrixUrl =
  "http://127.0.0.1:5174/visual-smoke.html?token=query-secret#hash-secret";

async function withTempDir(prefix, run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeFakeElectronCli(tempDir, body) {
  const fakeCliPath = path.join(tempDir, "fake-electron-cli.cjs");
  await fs.writeFile(fakeCliPath, body, { encoding: "utf8" });
  return fakeCliPath;
}

async function runMatrix(tempDir, fakeElectronCliPath) {
  const outputDir = path.join(tempDir, "matrix-output");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [matrixScriptPath], {
      cwd: packageRoot,
      env: {
        ...process.env,
        CW_VISUAL_SMOKE_ELECTRON_CLI: fakeElectronCliPath,
        CW_VISUAL_SMOKE_MATRIX_OUTPUT_DIR: outputDir,
        CW_VISUAL_SMOKE_MATRIX_URL: matrixUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr, outputDir });
    });
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(outputDir, "matrix.json"), {
      encoding: "utf8",
    }),
  );
  return { ...result, manifest };
}

function assertSafeOutput(result, forbiddenFragments) {
  const manifestText = JSON.stringify(result.manifest);
  for (const fragment of forbiddenFragments) {
    assert.equal(result.stdout.includes(fragment), false);
    assert.equal(result.stderr.includes(fragment), false);
    assert.equal(manifestText.includes(fragment), false);
  }
}

test("visual smoke matrix accepts valid known and unknown evidence", async () => {
  await withTempDir("cw-visual-smoke-matrix-valid-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      `
const fs = require("node:fs");
const targetUrl = new URL(process.env.CW_VISUAL_SMOKE_URL);
const mode = targetUrl.searchParams.get("streamEvent") === "unknown"
  ? "unknown"
  : "known";
const urlFailures = [];
if (targetUrl.hash !== "") {
  urlFailures.push("case URL hash was not stripped");
}
if (mode === "known" && targetUrl.search !== "") {
  urlFailures.push("known case URL search was not stripped");
}
if (mode === "unknown" && targetUrl.search !== "?streamEvent=unknown") {
  urlFailures.push("unknown case URL search was not normalized");
}
const width = Number(process.env.CW_VISUAL_SMOKE_WIDTH);
const height = Number(process.env.CW_VISUAL_SMOKE_HEIGHT);
const scrollY = Number(process.env.CW_VISUAL_SMOKE_SCROLL_Y);
const maxY = 2000;
const knownType = mode === "unknown" ? "false" : "true";
const knownText = mode === "unknown" ? "Unknown event type" : "Known event type";
const result = {
  streamEventMode: mode,
  targetLocation: { streamEventMode: mode },
  requestedViewport: { width, height, scrollY },
  captureSize: { width, height },
  metrics: {
    viewport: { width, height },
    scroll: { x: 0, y: Math.min(scrollY, maxY), maxY },
    horizontalOverflow: 0,
  },
  streamEventExpandedMetrics: {
    streamEventDetailKnownType: knownType,
    streamEventDetailText: knownText,
  },
  streamSelectionMetadataExpandedMetrics: {
    streamSelectionMetadataKnownType: knownType,
    streamSelectionMetadataText: knownText,
  },
  failures: urlFailures,
  messages: [],
};
fs.writeFileSync(
  \`\${process.env.CW_VISUAL_SMOKE_OUTPUT}.json\`,
  JSON.stringify(result),
);
`,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath);
    const caseByName = new Map(
      result.manifest.cases.map((testCase) => [testCase.name, testCase]),
    );
    const knownDesktop = caseByName.get("known-desktop");
    const unknownDesktop = caseByName.get("unknown-desktop");
    const unknownScroll = caseByName.get("unknown-mobile-scroll-1440");

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.equal(result.manifest.failures.length, 0);
    assert.equal(result.manifest.cases.length, 5);
    assert.equal(
      result.manifest.targetLocation.origin,
      "http://127.0.0.1:5174",
    );
    assert.equal(result.manifest.targetLocation.pathname, "/visual-smoke.html");
    assert.equal(knownDesktop?.mode, "known");
    assert.equal(knownDesktop?.process.exitCode, 0);
    assert.equal(knownDesktop?.process.stderrLength, 0);
    assert.equal(knownDesktop?.messageCount, 0);
    assert.deepEqual(knownDesktop?.failures, []);
    assert.equal(unknownDesktop?.mode, "unknown");
    assert.deepEqual(unknownDesktop?.failures, []);
    assert.equal(unknownScroll?.observedScroll.y, 1440);
    assert.equal(unknownScroll?.observedScroll.maxY, 2000);
    assert.deepEqual(
      result.manifest.cases.map((testCase) => testCase.failures),
      [[], [], [], [], []],
    );
    assertSafeOutput(result, ["query-secret", "hash-secret"]);
  });
});

test("visual smoke matrix sanitizes invalid JSON failures", async () => {
  await withTempDir("cw-visual-smoke-matrix-invalid-json-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      `
const fs = require("node:fs");
fs.writeFileSync(
  \`\${process.env.CW_VISUAL_SMOKE_OUTPUT}.json\`,
  '{ "secret": "raw-json-secret" ',
);
process.stdout.write("raw-child-stdout-secret");
process.stderr.write("raw-child-stderr-secret");
`,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath);
    const firstCase = result.manifest.cases[0];

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.manifest.cases.length, 5);
    assert.equal(result.manifest.failures.length, 5);
    assert.equal(
      result.manifest.targetLocation.origin,
      "http://127.0.0.1:5174",
    );
    assert.equal(result.manifest.targetLocation.pathname, "/visual-smoke.html");
    assert.equal(firstCase.process.exitCode, 0);
    assert.equal(
      firstCase.process.stdoutLength,
      "raw-child-stdout-secret".length,
    );
    assert.equal(
      firstCase.process.stderrLength,
      "raw-child-stderr-secret".length,
    );
    assert.match(
      firstCase.failures.join("\n"),
      /case JSON was not valid JSON/u,
    );
    assert.match(
      firstCase.failures.join("\n"),
      /case process wrote stderr bytes: \d+/u,
    );
    assertSafeOutput(result, [
      "raw-json-secret",
      "raw-child-stdout-secret",
      "raw-child-stderr-secret",
      "query-secret",
      "hash-secret",
    ]);
  });
});

test("visual smoke matrix rejects non-object JSON roots", async () => {
  await withTempDir("cw-visual-smoke-matrix-null-root-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      `
const fs = require("node:fs");
fs.writeFileSync(\`\${process.env.CW_VISUAL_SMOKE_OUTPUT}.json\`, "null");
process.stdout.write("\\n");
`,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath);
    const firstCase = result.manifest.cases[0];

    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.cases.length, 5);
    assert.equal(result.manifest.failures.length, 5);
    assert.deepEqual(firstCase.failures, ["case JSON root was not an object"]);
    assert.equal(firstCase.process.exitCode, 0);
    assert.equal(firstCase.process.stdoutLength, 1);
    assert.equal(firstCase.process.stderrLength, 0);
    assert.equal(firstCase.targetLocation, null);
    assert.equal(firstCase.messageCount, null);
  });
});

test("visual smoke matrix summarizes console messages without values", async () => {
  await withTempDir(
    "cw-visual-smoke-matrix-console-messages-",
    async (tempDir) => {
      const fakeElectronCliPath = await writeFakeElectronCli(
        tempDir,
        `
const fs = require("node:fs");
const targetUrl = new URL(process.env.CW_VISUAL_SMOKE_URL);
const mode = targetUrl.searchParams.get("streamEvent") === "unknown"
  ? "unknown"
  : "known";
const width = Number(process.env.CW_VISUAL_SMOKE_WIDTH);
const height = Number(process.env.CW_VISUAL_SMOKE_HEIGHT);
const scrollY = Number(process.env.CW_VISUAL_SMOKE_SCROLL_Y);
const maxY = 2000;
const knownType = mode === "unknown" ? "false" : "true";
const knownText = mode === "unknown" ? "Unknown event type" : "Known event type";
const result = {
  streamEventMode: mode,
  targetLocation: { streamEventMode: mode },
  requestedViewport: { width, height, scrollY },
  captureSize: { width, height },
  metrics: {
    viewport: { width, height },
    scroll: { x: 0, y: Math.min(scrollY, maxY), maxY },
    horizontalOverflow: 0,
  },
  streamEventExpandedMetrics: {
    streamEventDetailKnownType: knownType,
    streamEventDetailText: knownText,
  },
  streamSelectionMetadataExpandedMetrics: {
    streamSelectionMetadataKnownType: knownType,
    streamSelectionMetadataText: knownText,
  },
  failures: [],
  messages: ["raw-console-secret-one", "raw-console-secret-two"],
};
fs.writeFileSync(
  \`\${process.env.CW_VISUAL_SMOKE_OUTPUT}.json\`,
  JSON.stringify(result),
);
`,
      );

      const result = await runMatrix(tempDir, fakeElectronCliPath);
      const firstCase = result.manifest.cases[0];

      assert.equal(result.exitCode, 1);
      assert.equal(result.manifest.cases.length, 5);
      assert.equal(result.manifest.failures.length, 5);
      assert.equal(firstCase.messageCount, 2);
      assert.deepEqual(firstCase.failures, [
        "expected no console warning/error messages, got 2",
      ]);
      assertSafeOutput(result, [
        "raw-console-secret-one",
        "raw-console-secret-two",
      ]);
    },
  );
});
