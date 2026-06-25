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
const invalidMatrixUrl =
  "not-a-url?token=invalid-url-secret#invalid-hash-secret";
const invalidLegacyUrl =
  "legacy-not-a-url?legacy=invalid-legacy-secret#invalid-legacy-hash-secret";
const validFakeElectronCliBody = `
const fs = require("node:fs");
const targetUrl = new URL(process.env.CW_VISUAL_SMOKE_URL);
const mode = targetUrl.searchParams.get("streamEvent") === "unknown"
  ? "unknown"
  : "known";
const chatBoxMode = targetUrl.searchParams.get("chatBox") === "enabled"
  ? "enabled"
  : "disabled";
const urlFailures = [];
if (targetUrl.hash !== "") {
  urlFailures.push("case URL hash was not stripped");
}
const expectedSearchParams = new URLSearchParams();
if (mode === "unknown") {
  expectedSearchParams.set("streamEvent", "unknown");
}
if (chatBoxMode === "enabled") {
  expectedSearchParams.set("chatBox", "enabled");
}
const expectedSearch = expectedSearchParams.toString();
const expectedSearchText = expectedSearch === "" ? "" : "?" + expectedSearch;
if (targetUrl.search !== expectedSearchText) {
  urlFailures.push("case URL search was not normalized");
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
  chatBoxMode,
  targetLocation: { streamEventMode: mode, chatBoxMode },
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
if (chatBoxMode === "enabled") {
  Object.assign(result, {
    chatInitialMetrics: {
      chatBoxExpanded: "true",
      chatDraftInputs: 1,
      chatDraftInputFocused: true,
    },
    chatDraftMetrics: {
      chatDraftValue: "Review repair plan now",
      chatDraftPreviewText: "Review repair plan now raw matrix draft",
    },
    chatLocalSubmitMetrics: {
      chatLocalSubmissionPresent: true,
      chatLocalSubmissionAction: "repair_review",
      chatLocalSubmissionCharacters: "22",
      chatLocalSubmissionClearCount: "1",
      chatLocalSubmissionCount: "1",
      chatLocalSubmissionHistoryItemIds: ["1"],
      chatLocalSubmissionHistoryItems: 1,
      chatLocalSubmissionIntent: "repair",
      chatLocalSubmissionSequence: "1",
      chatLocalSubmissionStatus: "queued_local",
      chatLocalSubmissionTarget: "repair",
      chatLocalSubmissionText: "Review repair plan now raw matrix draft",
      chatLocalSubmissionWords: "4",
    },
    chatLocalHistoryMetrics: {
      chatLocalSubmissionPresent: true,
      chatLocalSubmissionAction: "repair_review",
      chatLocalSubmissionCharacters: "24",
      chatLocalSubmissionClearCount: "3",
      chatLocalSubmissionCount: "3",
      chatLocalSubmissionHistoryItemIds: ["4", "3", "2"],
      chatLocalSubmissionHistoryItems: 3,
      chatLocalSubmissionHistoryStatuses: [
        "queued_local",
        "queued_local",
        "queued_local",
      ],
      chatLocalSubmissionIntent: "repair",
      chatLocalSubmissionSequence: "4",
      chatLocalSubmissionStatus: "queued_local",
      chatLocalSubmissionTarget: "repair",
      chatLocalSubmissionText: "Confirm workflow handoff raw matrix draft",
      chatLocalSubmissionWords: "3",
    },
    chatLocalHistoryClearedMetrics: {
      chatDraftIntent: "repair",
      chatDraftPreviewState: "empty",
      chatDraftSendReason: "empty_draft",
      chatLocalSubmissionClearButtons: 0,
      chatLocalSubmissionHistoryItems: 0,
      chatLocalSubmissionPresent: false,
    },
    chatLocalResendMetrics: {
      chatLocalSubmissionPresent: true,
      chatLocalSubmissionAction: "repair_review",
      chatLocalSubmissionCharacters: "20",
      chatLocalSubmissionCount: "1",
      chatLocalSubmissionHistoryItemIds: ["5"],
      chatLocalSubmissionHistoryItems: 1,
      chatLocalSubmissionIntent: "repair",
      chatLocalSubmissionSequence: "5",
      chatLocalSubmissionStatus: "queued_local",
      chatLocalSubmissionTarget: "repair",
      chatLocalSubmissionText: "Resume local request raw matrix draft",
      chatLocalSubmissionWords: "3",
    },
  });
}
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
    outputDirName = "matrix-output",
    extraEnv = {},
  } = options;
  const outputDir = path.join(tempDir, outputDirName);
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

    const result = await runMatrix(tempDir, fakeElectronCliPath, {
      outputDirName: "matrix-output-secret",
    });
    const caseByName = new Map(
      result.manifest.cases.map((testCase) => [testCase.name, testCase]),
    );
    const knownDesktop = caseByName.get("known-desktop");
    const knownMobile = caseByName.get("known-mobile");
    const chatEnabled = caseByName.get("chat-enabled-desktop");
    const chatEnabledMobile = caseByName.get("chat-enabled-mobile");
    const unknownDesktop = caseByName.get("unknown-desktop");
    const unknownScroll = caseByName.get("unknown-mobile-scroll-1440");

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.equal(result.manifest.failures.length, 0);
    assert.equal(result.manifest.cases.length, 8);
    assert.deepEqual(result.manifest.outputEvidence, {
      manifestFileName: "matrix.json",
      caseCount: 8,
    });
    assert.equal("outputDir" in result.manifest, false);
    assert.equal(
      result.manifest.targetLocation.origin,
      "http://127.0.0.1:5174",
    );
    assert.equal(result.manifest.targetLocation.pathname, "/visual-smoke.html");
    assert.ok(knownDesktop);
    assert.equal(knownDesktop?.mode, "known");
    assert.equal(knownDesktop?.chatBoxMode, "disabled");
    assert.equal(knownDesktop?.process.exitCode, 0);
    assert.equal(knownDesktop?.process.stderrLength, 0);
    assert.equal(knownDesktop?.messageCount, 0);
    assert.deepEqual(knownDesktop?.outputEvidence, {
      outputFileName: "known-desktop.png",
      jsonFileName: "known-desktop.png.json",
    });
    assert.equal("outputPath" in knownDesktop, false);
    assert.equal("jsonPath" in knownDesktop, false);
    assert.deepEqual(knownDesktop?.failures, []);
    assert.equal(knownMobile?.mode, "known");
    assert.equal(knownMobile?.chatBoxMode, "disabled");
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
    assert.equal(chatEnabled?.mode, "known");
    assert.equal(chatEnabled?.chatBoxMode, "enabled");
    assert.deepEqual(chatEnabled?.requestedViewport, {
      width: 1280,
      height: 720,
      scrollY: 0,
    });
    assert.deepEqual(chatEnabled?.targetLocation, {
      streamEventMode: "known",
      chatBoxMode: "enabled",
    });
    assert.deepEqual(chatEnabled?.chatFocusEvidence, {
      expandedAfterToggle: "true",
      draftInputCount: 1,
      draftInputFocusedAfterExpand: true,
    });
    assert.deepEqual(chatEnabled?.chatLocalEvidence, {
      firstSubmission: {
        present: true,
        sequence: "1",
        count: "1",
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
        characters: "22",
        words: "4",
        clearButtonCount: null,
        clearCount: "1",
        historyItems: 1,
        historyItemIds: ["1"],
        historyStatuses: null,
      },
      cappedHistory: {
        present: true,
        sequence: "4",
        count: "3",
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
        characters: "24",
        words: "3",
        clearButtonCount: null,
        clearCount: "3",
        historyItems: 3,
        historyItemIds: ["4", "3", "2"],
        historyStatuses: ["queued_local", "queued_local", "queued_local"],
      },
      clearedHistory: {
        present: false,
        clearButtonCount: 0,
        historyItems: 0,
        draftIntent: "repair",
        draftSendReason: "empty_draft",
        draftPreviewState: "empty",
      },
      resendAfterClear: {
        present: true,
        sequence: "5",
        count: "1",
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
        characters: "20",
        words: "3",
        clearButtonCount: null,
        clearCount: null,
        historyItems: 1,
        historyItemIds: ["5"],
        historyStatuses: null,
      },
    });
    assert.deepEqual(chatEnabled?.failures, []);
    assert.equal(chatEnabledMobile?.mode, "known");
    assert.equal(chatEnabledMobile?.chatBoxMode, "enabled");
    assert.deepEqual(chatEnabledMobile?.requestedViewport, {
      width: 390,
      height: 844,
      scrollY: 0,
    });
    assert.deepEqual(chatEnabledMobile?.observedViewport, {
      width: 390,
      height: 844,
    });
    assert.deepEqual(chatEnabledMobile?.targetLocation, {
      streamEventMode: "known",
      chatBoxMode: "enabled",
    });
    assert.deepEqual(
      chatEnabledMobile?.chatFocusEvidence,
      chatEnabled?.chatFocusEvidence,
    );
    assert.deepEqual(
      chatEnabledMobile?.chatLocalEvidence,
      chatEnabled?.chatLocalEvidence,
    );
    assert.deepEqual(chatEnabledMobile?.failures, []);
    assert.equal(unknownDesktop?.mode, "unknown");
    assert.equal(unknownDesktop?.chatBoxMode, "disabled");
    assert.deepEqual(unknownDesktop?.failures, []);
    assert.equal(unknownScroll?.observedScroll.y, 1440);
    assert.equal(unknownScroll?.observedScroll.maxY, 2000);
    assert.deepEqual(
      result.manifest.cases.map((testCase) => testCase.failures),
      [[], [], [], [], [], [], [], []],
    );
    assertSafeOutput(result, [
      "Review repair plan now",
      "Confirm workflow handoff",
      "Resume local request",
      "query-secret",
      "hash-secret",
      "matrix-output-secret",
      tempDir,
    ]);
  });
});

test("visual smoke matrix rejects unfocused enabled chat evidence", async () => {
  await withTempDir("cw-visual-smoke-matrix-chat-focus-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      validFakeElectronCliBody.replace(
        "chatDraftInputFocused: true",
        "chatDraftInputFocused: false",
      ),
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath, {
      outputDirName: "matrix-output-secret",
    });
    const chatEnabledDesktop = result.manifest.cases.find(
      (testCase) => testCase.name === "chat-enabled-desktop",
    );
    const chatEnabledMobile = result.manifest.cases.find(
      (testCase) => testCase.name === "chat-enabled-mobile",
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.manifest.cases.length, 8);
    assert.equal(result.manifest.failures.length, 2);
    assert.deepEqual(chatEnabledDesktop?.chatFocusEvidence, {
      expandedAfterToggle: "true",
      draftInputCount: 1,
      draftInputFocusedAfterExpand: false,
    });
    assert.deepEqual(chatEnabledMobile?.chatFocusEvidence, {
      expandedAfterToggle: "true",
      draftInputCount: 1,
      draftInputFocusedAfterExpand: false,
    });
    assert.deepEqual(chatEnabledDesktop?.failures, [
      "expected initial chat draft input focused true, got false",
    ]);
    assert.deepEqual(chatEnabledMobile?.failures, [
      "expected initial chat draft input focused true, got false",
    ]);
    assert.deepEqual(
      result.manifest.cases
        .filter((testCase) => testCase.chatBoxMode !== "enabled")
        .map((testCase) => testCase.failures),
      [[], [], [], [], [], []],
    );
    assertSafeOutput(result, [
      "Review repair plan now",
      "Confirm workflow handoff",
      "Resume local request",
      "query-secret",
      "hash-secret",
      "matrix-output-secret",
      tempDir,
    ]);
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
    assert.equal(result.manifest.cases.length, 8);
    assert.equal(
      result.manifest.targetLocation.origin,
      "http://127.0.0.1:5176",
    );
    assert.equal(result.manifest.targetLocation.pathname, "/matrix-smoke.html");
    assert.deepEqual(
      result.manifest.cases.map((testCase) => testCase.failures),
      [[], [], [], [], [], [], [], []],
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
    assert.equal(result.manifest.cases.length, 8);
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
        ["chat-enabled-desktop", "known", 1280, 720, 0],
        ["chat-enabled-mobile", "known", 390, 844, 0],
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

test("visual smoke matrix rejects invalid target URLs without leaking input", async () => {
  await withTempDir("cw-visual-smoke-matrix-invalid-url-", async (tempDir) => {
    const fakeElectronCliPath = await writeFakeElectronCli(
      tempDir,
      `process.stdout.write("invalid-url-fake-cli-secret");`,
    );

    const result = await runMatrix(tempDir, fakeElectronCliPath, {
      matrixUrlValue: invalidMatrixUrl,
      readManifest: false,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /CW_VISUAL_SMOKE_MATRIX_URL or CW_VISUAL_SMOKE_URL must be a valid URL/u,
    );
    assert.equal(result.stderr.includes("invalid-url-fake-cli-secret"), false);
    assert.equal(result.stderr.includes("invalid-url-secret"), false);
    assert.equal(result.stderr.includes("invalid-hash-secret"), false);
    await assert.rejects(fs.access(result.manifestPath), {
      code: "ENOENT",
    });
  });
});

test("visual smoke matrix rejects invalid legacy URL fallback without leaking input", async () => {
  await withTempDir(
    "cw-visual-smoke-matrix-invalid-legacy-url-",
    async (tempDir) => {
      const fakeElectronCliPath = await writeFakeElectronCli(
        tempDir,
        `process.stdout.write("invalid-legacy-url-fake-cli-secret");`,
      );

      const result = await runMatrix(tempDir, fakeElectronCliPath, {
        urlMode: "legacy",
        legacyUrlValue: invalidLegacyUrl,
        readManifest: false,
      });

      assert.equal(result.exitCode, 1);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /CW_VISUAL_SMOKE_MATRIX_URL or CW_VISUAL_SMOKE_URL must be a valid URL/u,
      );
      assert.equal(
        result.stderr.includes("invalid-legacy-url-fake-cli-secret"),
        false,
      );
      assert.equal(result.stderr.includes("invalid-legacy-secret"), false);
      assert.equal(result.stderr.includes("invalid-legacy-hash-secret"), false);
      await assert.rejects(fs.access(result.manifestPath), {
        code: "ENOENT",
      });
    },
  );
});

test("visual smoke matrix rejects invalid matrix URL before valid legacy fallback", async () => {
  await withTempDir(
    "cw-visual-smoke-matrix-invalid-priority-url-",
    async (tempDir) => {
      const fakeElectronCliPath = await writeFakeElectronCli(
        tempDir,
        `process.stdout.write("invalid-priority-url-fake-cli-secret");`,
      );

      const result = await runMatrix(tempDir, fakeElectronCliPath, {
        urlMode: "both",
        matrixUrlValue: invalidMatrixUrl,
        legacyUrlValue: alternateLegacyUrl,
        readManifest: false,
      });

      assert.equal(result.exitCode, 1);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /CW_VISUAL_SMOKE_MATRIX_URL or CW_VISUAL_SMOKE_URL must be a valid URL/u,
      );
      assert.equal(
        result.stderr.includes("invalid-priority-url-fake-cli-secret"),
        false,
      );
      assert.equal(result.stderr.includes("invalid-url-secret"), false);
      assert.equal(result.stderr.includes("invalid-hash-secret"), false);
      assert.equal(result.stderr.includes("legacy-secret"), false);
      assert.equal(result.stderr.includes("legacy-hash-secret"), false);
      await assert.rejects(fs.access(result.manifestPath), {
        code: "ENOENT",
      });
    },
  );
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
    assert.equal(result.manifest.cases.length, 8);
    assert.equal(result.manifest.failures.length, 8);
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

test("visual smoke matrix sanitizes child failure text", async () => {
  await withTempDir(
    "cw-visual-smoke-matrix-child-failures-",
    async (tempDir) => {
      const fakeElectronCliPath = await writeFakeElectronCli(
        tempDir,
        `
const fs = require("node:fs");
const targetUrl = new URL(process.env.CW_VISUAL_SMOKE_URL);
const mode = targetUrl.searchParams.get("streamEvent") === "unknown"
  ? "unknown"
  : "known";
const chatBoxMode = targetUrl.searchParams.get("chatBox") === "enabled"
  ? "enabled"
  : "disabled";
const width = Number(process.env.CW_VISUAL_SMOKE_WIDTH);
const height = Number(process.env.CW_VISUAL_SMOKE_HEIGHT);
const scrollY = Number(process.env.CW_VISUAL_SMOKE_SCROLL_Y);
const maxY = 2000;
const knownType = mode === "unknown" ? "false" : "true";
const knownText = mode === "unknown" ? "Unknown event type" : "Known event type";
const failures = chatBoxMode === "enabled"
  ? ["raw child failure leaked Review repair plan now and Resume local request"]
  : [];
const result = {
  streamEventMode: mode,
  chatBoxMode,
  targetLocation: { streamEventMode: mode, chatBoxMode },
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
  chatInitialMetrics: chatBoxMode === "enabled" ? {
    chatBoxExpanded: "true",
    chatDraftInputs: 1,
    chatDraftInputFocused: true,
  } : null,
  chatLocalSubmitMetrics: chatBoxMode === "enabled" ? {
    chatLocalSubmissionPresent: true,
    chatLocalSubmissionAction: "repair_review",
    chatLocalSubmissionCharacters: "22",
    chatLocalSubmissionClearCount: "1",
    chatLocalSubmissionCount: "1",
    chatLocalSubmissionHistoryItemIds: ["1"],
    chatLocalSubmissionHistoryItems: 1,
    chatLocalSubmissionIntent: "repair",
    chatLocalSubmissionSequence: "1",
    chatLocalSubmissionStatus: "queued_local",
    chatLocalSubmissionTarget: "repair",
    chatLocalSubmissionWords: "4",
  } : null,
  chatLocalHistoryMetrics: chatBoxMode === "enabled" ? {
    chatLocalSubmissionPresent: true,
    chatLocalSubmissionAction: "repair_review",
    chatLocalSubmissionCharacters: "24",
    chatLocalSubmissionClearCount: "3",
    chatLocalSubmissionCount: "3",
    chatLocalSubmissionHistoryItemIds: ["4", "3", "2"],
    chatLocalSubmissionHistoryItems: 3,
    chatLocalSubmissionHistoryStatuses: [
      "queued_local",
      "queued_local",
      "queued_local",
    ],
    chatLocalSubmissionIntent: "repair",
    chatLocalSubmissionSequence: "4",
    chatLocalSubmissionStatus: "queued_local",
    chatLocalSubmissionTarget: "repair",
    chatLocalSubmissionWords: "3",
  } : null,
  chatLocalHistoryClearedMetrics: chatBoxMode === "enabled" ? {
    chatDraftIntent: "repair",
    chatDraftPreviewState: "empty",
    chatDraftSendReason: "empty_draft",
    chatLocalSubmissionClearButtons: 0,
    chatLocalSubmissionHistoryItems: 0,
    chatLocalSubmissionPresent: false,
  } : null,
  chatLocalResendMetrics: chatBoxMode === "enabled" ? {
    chatLocalSubmissionPresent: true,
    chatLocalSubmissionAction: "repair_review",
    chatLocalSubmissionCharacters: "20",
    chatLocalSubmissionCount: "1",
    chatLocalSubmissionHistoryItemIds: ["5"],
    chatLocalSubmissionHistoryItems: 1,
    chatLocalSubmissionIntent: "repair",
    chatLocalSubmissionSequence: "5",
    chatLocalSubmissionStatus: "queued_local",
    chatLocalSubmissionTarget: "repair",
    chatLocalSubmissionWords: "3",
  } : null,
  failures,
  messages: [],
};
fs.writeFileSync(
  \`\${process.env.CW_VISUAL_SMOKE_OUTPUT}.json\`,
  JSON.stringify(result),
);
`,
      );

      const result = await runMatrix(tempDir, fakeElectronCliPath);
      const childFailureDesktop = result.manifest.cases.find(
        (testCase) => testCase.name === "chat-enabled-desktop",
      );
      const childFailureMobile = result.manifest.cases.find(
        (testCase) => testCase.name === "chat-enabled-mobile",
      );

      assert.equal(result.exitCode, 1);
      assert.equal(result.signal, null);
      assert.equal(result.manifest.cases.length, 8);
      assert.equal(result.manifest.failures.length, 2);
      assert.deepEqual(childFailureDesktop?.failures, [
        "case JSON contains 1 failure(s)",
      ]);
      assert.deepEqual(childFailureMobile?.failures, [
        "case JSON contains 1 failure(s)",
      ]);
      assertSafeOutput(result, [
        "raw child failure",
        "Review repair plan now",
        "Resume local request",
        "query-secret",
        "hash-secret",
        tempDir,
      ]);
    },
  );
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
    assert.equal(result.manifest.cases.length, 8);
    assert.equal(result.manifest.failures.length, 8);
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
    assert.equal(result.manifest.cases.length, 8);
    assert.equal(result.manifest.failures.length, 8);
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
    assert.equal(result.manifest.cases.length, 8);
    assert.equal(result.manifest.failures.length, 8);
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
const chatBoxMode = targetUrl.searchParams.get("chatBox") === "enabled"
  ? "enabled"
  : "disabled";
const width = Number(process.env.CW_VISUAL_SMOKE_WIDTH);
const height = Number(process.env.CW_VISUAL_SMOKE_HEIGHT);
const scrollY = Number(process.env.CW_VISUAL_SMOKE_SCROLL_Y);
const maxY = 2000;
const knownType = mode === "unknown" ? "false" : "true";
const knownText = mode === "unknown" ? "Unknown event type" : "Known event type";
const result = {
  streamEventMode: mode,
  chatBoxMode,
  targetLocation: { streamEventMode: mode, chatBoxMode },
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
      assert.equal(result.manifest.cases.length, 8);
      assert.equal(result.manifest.failures.length, 8);
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
