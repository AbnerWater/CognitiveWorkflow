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
const alternateMatrixUrl =
  "http://127.0.0.1:5176/matrix-smoke.html?matrix=matrix-secret#matrix-hash-secret";
const alternateLegacyUrl =
  "http://127.0.0.1:5175/legacy-smoke.html?legacy=legacy-secret#legacy-hash-secret";
const validFakeElectronCliBody = `
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
if (
  process.env.CW_FAKE_EXPECTED_TARGET_ORIGIN !== undefined &&
  targetUrl.origin !== process.env.CW_FAKE_EXPECTED_TARGET_ORIGIN
) {
  urlFailures.push("case URL origin did not use expected target");
}
if (
  process.env.CW_FAKE_EXPECTED_TARGET_PATHNAME !== undefined &&
  targetUrl.pathname !== process.env.CW_FAKE_EXPECTED_TARGET_PATHNAME
) {
  urlFailures.push("case URL pathname did not use expected target");
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
`;

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

async function runMatrix(tempDir, fakeElectronCliPath, options = {}) {
  const {
    urlMode = "matrix",
    readManifest = true,
    matrixUrlValue = matrixUrl,
    legacyUrlValue = matrixUrl,
    extraEnv = {},
  } = options;
  const outputDir = path.join(tempDir, "matrix-output");
  const childEnv = {
    ...process.env,
    ...extraEnv,
    CW_VISUAL_SMOKE_ELECTRON_CLI: fakeElectronCliPath,
    CW_VISUAL_SMOKE_MATRIX_OUTPUT_DIR: outputDir,
  };
  delete childEnv.CW_VISUAL_SMOKE_MATRIX_URL;
  delete childEnv.CW_VISUAL_SMOKE_URL;
  if (urlMode === "matrix") {
    childEnv.CW_VISUAL_SMOKE_MATRIX_URL = matrixUrlValue;
  } else if (urlMode === "legacy") {
    childEnv.CW_VISUAL_SMOKE_URL = legacyUrlValue;
  } else if (urlMode === "both") {
    childEnv.CW_VISUAL_SMOKE_MATRIX_URL = matrixUrlValue;
    childEnv.CW_VISUAL_SMOKE_URL = legacyUrlValue;
  } else if (urlMode !== "none") {
    throw new Error(`Unknown URL mode: ${String(urlMode)}`);
  }
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [matrixScriptPath], {
      cwd: packageRoot,
      env: childEnv,
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
  const manifestPath = path.join(outputDir, "matrix.json");
  if (!readManifest) {
    return { ...result, manifestPath };
  }
  const manifest = JSON.parse(
    await fs.readFile(manifestPath, {
      encoding: "utf8",
    }),
  );
  return { ...result, manifest, manifestPath };
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
      validFakeElectronCliBody,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath);
    const caseByName = new Map(
      result.manifest.cases.map((testCase) => [testCase.name, testCase]),
    );
    const knownDesktop = caseByName.get("known-desktop");
    const knownMobile = caseByName.get("known-mobile");
    const unknownDesktop = caseByName.get("unknown-desktop");
    const unknownScroll = caseByName.get("unknown-mobile-scroll-1440");

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.equal(result.manifest.failures.length, 0);
    assert.equal(result.manifest.cases.length, 6);
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
    assert.equal(knownMobile?.mode, "known");
    assert.deepEqual(knownMobile?.requestedViewport, {
      width: 390,
      height: 844,
      scrollY: 0,
    });
    assert.deepEqual(knownMobile?.observedViewport, {
      width: 390,
      height: 844,
    });
    assert.deepEqual(knownMobile?.failures, []);
    assert.equal(unknownDesktop?.mode, "unknown");
    assert.deepEqual(unknownDesktop?.failures, []);
    assert.equal(unknownScroll?.observedScroll.y, 1440);
    assert.equal(unknownScroll?.observedScroll.maxY, 2000);
    assert.deepEqual(
      result.manifest.cases.map((testCase) => testCase.failures),
      [[], [], [], [], [], []],
    );
    assertSafeOutput(result, ["query-secret", "hash-secret"]);
  });
});

test("visual smoke matrix prefers matrix URL over legacy URL", async () => {
  await withTempDir("cw-visual-smoke-matrix-url-priority-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      validFakeElectronCliBody,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath, {
      urlMode: "both",
      matrixUrlValue: alternateMatrixUrl,
      legacyUrlValue: alternateLegacyUrl,
      extraEnv: {
        CW_FAKE_EXPECTED_TARGET_ORIGIN: "http://127.0.0.1:5176",
        CW_FAKE_EXPECTED_TARGET_PATHNAME: "/matrix-smoke.html",
      },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.equal(result.manifest.failures.length, 0);
    assert.equal(result.manifest.cases.length, 6);
    assert.equal(
      result.manifest.targetLocation.origin,
      "http://127.0.0.1:5176",
    );
    assert.equal(result.manifest.targetLocation.pathname, "/matrix-smoke.html");
    assert.deepEqual(
      result.manifest.cases.map((testCase) => testCase.failures),
      [[], [], [], [], [], []],
    );
    assertSafeOutput(result, [
      "matrix-secret",
      "matrix-hash-secret",
      "legacy-secret",
      "legacy-hash-secret",
    ]);
  });
});

test("visual smoke matrix accepts legacy single-case URL fallback", async () => {
  await withTempDir("cw-visual-smoke-matrix-legacy-url-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      validFakeElectronCliBody,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath, {
      urlMode: "legacy",
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.equal(result.manifest.failures.length, 0);
    assert.equal(result.manifest.cases.length, 6);
    assert.deepEqual(
      result.manifest.cases.map((testCase) => [
        testCase.name,
        testCase.mode,
        testCase.requestedViewport.width,
        testCase.requestedViewport.height,
        testCase.requestedViewport.scrollY,
      ]),
      [
        ["known-desktop", "known", 1280, 720, 0],
        ["known-mobile", "known", 390, 844, 0],
        ["unknown-desktop", "unknown", 1280, 720, 0],
        ["unknown-mobile", "unknown", 390, 844, 0],
        ["unknown-mobile-scroll-900", "unknown", 390, 844, 900],
        ["unknown-mobile-scroll-1440", "unknown", 390, 844, 1440],
      ],
    );
    assert.equal(
      result.manifest.targetLocation.origin,
      "http://127.0.0.1:5174",
    );
    assert.equal(result.manifest.targetLocation.pathname, "/visual-smoke.html");
    assertSafeOutput(result, ["query-secret", "hash-secret"]);
  });
});

test("visual smoke matrix requires a target URL before running cases", async () => {
  await withTempDir("cw-visual-smoke-matrix-missing-url-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      `process.stdout.write("fake-cli-should-not-run-secret");`,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath, {
      urlMode: "none",
      readManifest: false,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /CW_VISUAL_SMOKE_MATRIX_URL or CW_VISUAL_SMOKE_URL is required/u,
    );
    assert.equal(
      result.stderr.includes("fake-cli-should-not-run-secret"),
      false,
    );
    assert.equal(result.stderr.includes("query-secret"), false);
    assert.equal(result.stderr.includes("hash-secret"), false);
    await assert.rejects(fs.access(result.manifestPath), {
      code: "ENOENT",
    });
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
    assert.equal(result.manifest.cases.length, 6);
    assert.equal(result.manifest.failures.length, 6);
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
    assert.equal(result.manifest.cases.length, 6);
    assert.equal(result.manifest.failures.length, 6);
    assert.deepEqual(firstCase.failures, ["case JSON root was not an object"]);
    assert.equal(firstCase.process.exitCode, 0);
    assert.equal(firstCase.process.stdoutLength, 1);
    assert.equal(firstCase.process.stderrLength, 0);
    assert.equal(firstCase.targetLocation, null);
    assert.equal(firstCase.messageCount, null);
  });
});

test("visual smoke matrix summarizes missing JSON without raw output", async () => {
  await withTempDir("cw-visual-smoke-matrix-missing-json-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      `
process.stdout.write("missing-json-stdout-secret");
process.stderr.write("missing-json-stderr-secret");
`,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath);
    const firstCase = result.manifest.cases[0];

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.manifest.cases.length, 6);
    assert.equal(result.manifest.failures.length, 6);
    assert.equal(firstCase.process.exitCode, 0);
    assert.equal(
      firstCase.process.stdoutLength,
      "missing-json-stdout-secret".length,
    );
    assert.equal(
      firstCase.process.stderrLength,
      "missing-json-stderr-secret".length,
    );
    assert.match(
      firstCase.failures.join("\n"),
      /case JSON was not readable \(ENOENT\)/u,
    );
    assert.match(
      firstCase.failures.join("\n"),
      /case process wrote stderr bytes: \d+/u,
    );
    assert.equal(firstCase.targetLocation, null);
    assert.equal(firstCase.messageCount, null);
    assertSafeOutput(result, [
      "missing-json-stdout-secret",
      "missing-json-stderr-secret",
      "query-secret",
      "hash-secret",
    ]);
  });
});

test("visual smoke matrix summarizes nonzero child exits without raw output", async () => {
  await withTempDir("cw-visual-smoke-matrix-child-exit-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      `
process.stdout.write("child-exit-stdout-secret");
process.stderr.write("child-exit-stderr-secret");
process.exit(7);
`,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath);
    const firstCase = result.manifest.cases[0];

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.manifest.cases.length, 6);
    assert.equal(result.manifest.failures.length, 6);
    assert.equal(firstCase.process.exitCode, 7);
    assert.equal(
      firstCase.process.stdoutLength,
      "child-exit-stdout-secret".length,
    );
    assert.equal(
      firstCase.process.stderrLength,
      "child-exit-stderr-secret".length,
    );
    assert.match(
      firstCase.failures.join("\n"),
      /case process exited with code 7/u,
    );
    assert.match(
      firstCase.failures.join("\n"),
      /case JSON was not readable \(ENOENT\)/u,
    );
    assert.match(
      firstCase.failures.join("\n"),
      /case process wrote stderr bytes: \d+/u,
    );
    assert.equal(firstCase.targetLocation, null);
    assert.equal(firstCase.messageCount, null);
    assertSafeOutput(result, [
      "child-exit-stdout-secret",
      "child-exit-stderr-secret",
      "query-secret",
      "hash-secret",
    ]);
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
      assert.equal(result.manifest.cases.length, 6);
      assert.equal(result.manifest.failures.length, 6);
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
