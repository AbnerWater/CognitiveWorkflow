const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  summarizeOutputPath,
} = require("./runtime-workbench-visual-smoke-preflight.cjs");
const {
  collectChatLocalHistoryLayoutFailures,
} = require("./runtime-workbench-visual-smoke-layout.cjs");

const packageRoot = path.resolve(__dirname, "..");
const smokeScriptPath = path.join(
  packageRoot,
  "scripts",
  "runtime-workbench-visual-smoke.cjs",
);

const defaultCases = [
  {
    name: "known-desktop",
    mode: "known",
    width: 1280,
    height: 720,
    scrollY: 0,
  },
  {
    name: "known-mobile",
    mode: "known",
    width: 390,
    height: 844,
    scrollY: 0,
  },
  {
    name: "chat-enabled-desktop",
    mode: "known",
    chatBoxMode: "enabled",
    width: 1280,
    height: 720,
    scrollY: 0,
  },
  {
    name: "chat-enabled-mobile",
    mode: "known",
    chatBoxMode: "enabled",
    width: 390,
    height: 844,
    scrollY: 0,
  },
  {
    name: "unknown-desktop",
    mode: "unknown",
    width: 1280,
    height: 720,
    scrollY: 0,
  },
  {
    name: "unknown-mobile",
    mode: "unknown",
    width: 390,
    height: 844,
    scrollY: 0,
  },
  {
    name: "unknown-mobile-scroll-900",
    mode: "unknown",
    width: 390,
    height: 844,
    scrollY: 900,
  },
  {
    name: "unknown-mobile-scroll-1440",
    mode: "unknown",
    width: 390,
    height: 844,
    scrollY: 1440,
  },
];

const baseUrl =
  process.env.CW_VISUAL_SMOKE_MATRIX_URL ?? process.env.CW_VISUAL_SMOKE_URL;

if (!baseUrl) {
  throw new Error(
    "CW_VISUAL_SMOKE_MATRIX_URL or CW_VISUAL_SMOKE_URL is required",
  );
}

function parseBaseUrl(url) {
  try {
    return new URL(url);
  } catch {
    throw new Error(
      "CW_VISUAL_SMOKE_MATRIX_URL or CW_VISUAL_SMOKE_URL must be a valid URL",
    );
  }
}

const parsedBaseUrl = parseBaseUrl(baseUrl);

const outputDir =
  process.env.CW_VISUAL_SMOKE_MATRIX_OUTPUT_DIR ??
  path.join(os.tmpdir(), `cw-visual-smoke-matrix-${Date.now()}`);

const electronCliPath =
  process.env.CW_VISUAL_SMOKE_ELECTRON_CLI ??
  path.join(packageRoot, "node_modules", "electron", "cli.js");

function parseSafeLocation(url) {
  const parsedUrl = url instanceof URL ? url : parseBaseUrl(url);
  return {
    origin: parsedUrl.origin,
    pathname: parsedUrl.pathname,
  };
}

function getCaseChatBoxMode(testCase) {
  return testCase.chatBoxMode === "enabled" ? "enabled" : "disabled";
}

function buildCaseUrl(testCase) {
  const parsedUrl = new URL(parsedBaseUrl.toString());
  parsedUrl.search = "";
  parsedUrl.hash = "";
  if (testCase.mode === "unknown") {
    parsedUrl.searchParams.set("streamEvent", "unknown");
  }
  if (getCaseChatBoxMode(testCase) === "enabled") {
    parsedUrl.searchParams.set("chatBox", "enabled");
  }
  return parsedUrl.toString();
}

function readMetric(metrics, key) {
  if (!isRecord(metrics)) {
    return null;
  }
  const value = metrics[key];
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return null;
}

function joinMetricList(metrics, key) {
  if (!isRecord(metrics)) {
    return "";
  }
  const value = metrics[key];
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((item) => String(item)).join(",");
}

function summarizeMetricList(metrics, key) {
  if (!isRecord(metrics)) {
    return null;
  }
  const value = metrics[key];
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((item) => String(item));
}

function expectMetric(failures, label, metrics, key, expected) {
  const actual = readMetric(metrics, key);
  if (String(actual) !== String(expected)) {
    failures.push(
      `expected ${label} ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function expectMetricList(failures, label, metrics, key, expected) {
  const actual = joinMetricList(metrics, key);
  if (actual !== expected) {
    failures.push(`expected ${label} ${expected}, got ${actual}`);
  }
}

function normalizeChatLocalSubmitTriggerEvidence(metrics) {
  if (!isRecord(metrics)) {
    return {
      evidence: null,
      failures: ["expected first local chat submission trigger metrics"],
    };
  }
  const evidence = {
    trigger: metrics.trigger === "keyboard" ? "keyboard" : null,
    modifier: metrics.modifier === "ctrl" ? "ctrl" : null,
    keyboardDefaultPrevented:
      metrics.keyboardDefaultPrevented === true ? true : null,
    draftInputFocusedAfterSubmit:
      metrics.draftInputFocusedAfterSubmit === true ? true : null,
  };
  const failures = [];
  if (evidence.trigger !== "keyboard") {
    failures.push("expected first local submission trigger keyboard");
  }
  if (evidence.modifier !== "ctrl") {
    failures.push("expected first local submission modifier ctrl");
  }
  if (evidence.keyboardDefaultPrevented !== true) {
    failures.push(
      "expected first local submission keyboard default prevented true",
    );
  }
  if (evidence.draftInputFocusedAfterSubmit !== true) {
    failures.push(
      "expected first local submission draft input focused after submit true",
    );
  }
  return { evidence, failures };
}

function normalizeChatLocalHistoryClearFocusEvidence(metrics) {
  if (!isRecord(metrics)) {
    return {
      evidence: null,
      failures: ["expected cleared local chat history focus metrics"],
    };
  }
  const evidence = {
    draftInputFocusedAfterClear:
      metrics.chatDraftInputFocused === true ? true : null,
  };
  const failures = [];
  if (evidence.draftInputFocusedAfterClear !== true) {
    failures.push("expected cleared local history draft input focused true");
  }
  return { evidence, failures };
}

function collectEnabledChatBoxFailures(result, requestedWidth) {
  const failures = [];
  const initial = result.chatInitialMetrics;
  const first = result.chatLocalSubmitMetrics;
  const firstTrigger = result.chatLocalSubmitTriggerMetrics;
  const history = result.chatLocalHistoryMetrics;
  const cleared = result.chatLocalHistoryClearedMetrics;
  const resend = result.chatLocalResendMetrics;

  if (!isRecord(initial)) {
    failures.push("expected initial chat focus metrics");
  }
  if (!isRecord(first)) {
    failures.push("expected first local chat submission metrics");
  }
  if (!isRecord(history)) {
    failures.push("expected capped local chat history metrics");
  }
  if (!isRecord(cleared)) {
    failures.push("expected cleared local chat history metrics");
  }
  if (!isRecord(resend)) {
    failures.push("expected local chat resend metrics");
  }

  expectMetric(
    failures,
    "initial chat box expanded",
    initial,
    "chatBoxExpanded",
    "true",
  );
  expectMetric(
    failures,
    "initial chat draft input count",
    initial,
    "chatDraftInputs",
    1,
  );
  expectMetric(
    failures,
    "initial chat draft input focused",
    initial,
    "chatDraftInputFocused",
    true,
  );

  expectMetric(
    failures,
    "first local submission present",
    first,
    "chatLocalSubmissionPresent",
    true,
  );
  expectMetric(
    failures,
    "first local submission sequence",
    first,
    "chatLocalSubmissionSequence",
    "1",
  );
  expectMetric(
    failures,
    "first local submission count",
    first,
    "chatLocalSubmissionCount",
    "1",
  );
  expectMetric(
    failures,
    "first local submission status",
    first,
    "chatLocalSubmissionStatus",
    "queued_local",
  );
  expectMetric(
    failures,
    "first local submission intent",
    first,
    "chatLocalSubmissionIntent",
    "repair",
  );
  expectMetric(
    failures,
    "first local submission target",
    first,
    "chatLocalSubmissionTarget",
    "repair",
  );
  expectMetric(
    failures,
    "first local submission action",
    first,
    "chatLocalSubmissionAction",
    "repair_review",
  );
  expectMetric(
    failures,
    "first local submission characters",
    first,
    "chatLocalSubmissionCharacters",
    "22",
  );
  expectMetric(
    failures,
    "first local submission words",
    first,
    "chatLocalSubmissionWords",
    "4",
  );
  expectMetric(
    failures,
    "first local submission clear count",
    first,
    "chatLocalSubmissionClearCount",
    "1",
  );
  expectMetric(
    failures,
    "first local submission history items",
    first,
    "chatLocalSubmissionHistoryItems",
    1,
  );
  expectMetricList(
    failures,
    "first local submission history ids",
    first,
    "chatLocalSubmissionHistoryItemIds",
    "1",
  );
  failures.push(
    ...normalizeChatLocalSubmitTriggerEvidence(firstTrigger).failures,
  );

  expectMetric(
    failures,
    "capped local history sequence",
    history,
    "chatLocalSubmissionSequence",
    "4",
  );
  expectMetric(
    failures,
    "capped local history count",
    history,
    "chatLocalSubmissionCount",
    "3",
  );
  expectMetric(
    failures,
    "capped local history status",
    history,
    "chatLocalSubmissionStatus",
    "queued_local",
  );
  expectMetric(
    failures,
    "capped local history intent",
    history,
    "chatLocalSubmissionIntent",
    "repair",
  );
  expectMetric(
    failures,
    "capped local history target",
    history,
    "chatLocalSubmissionTarget",
    "repair",
  );
  expectMetric(
    failures,
    "capped local history action",
    history,
    "chatLocalSubmissionAction",
    "repair_review",
  );
  expectMetric(
    failures,
    "capped local history characters",
    history,
    "chatLocalSubmissionCharacters",
    "24",
  );
  expectMetric(
    failures,
    "capped local history words",
    history,
    "chatLocalSubmissionWords",
    "3",
  );
  expectMetric(
    failures,
    "capped local history clear count",
    history,
    "chatLocalSubmissionClearCount",
    "3",
  );
  expectMetric(
    failures,
    "capped local history items",
    history,
    "chatLocalSubmissionHistoryItems",
    3,
  );
  expectMetricList(
    failures,
    "capped local history ids",
    history,
    "chatLocalSubmissionHistoryItemIds",
    "4,3,2",
  );
  expectMetricList(
    failures,
    "capped local history statuses",
    history,
    "chatLocalSubmissionHistoryStatuses",
    "queued_local,queued_local,queued_local",
  );
  failures.push(
    ...collectChatLocalHistoryLayoutFailures({
      chatLocalHistoryMetrics: history,
      requestedWidth,
    }),
  );

  expectMetric(
    failures,
    "cleared local history present",
    cleared,
    "chatLocalSubmissionPresent",
    false,
  );
  expectMetric(
    failures,
    "cleared local history clear buttons",
    cleared,
    "chatLocalSubmissionClearButtons",
    0,
  );
  expectMetric(
    failures,
    "cleared local history items",
    cleared,
    "chatLocalSubmissionHistoryItems",
    0,
  );
  expectMetric(
    failures,
    "cleared local history draft intent",
    cleared,
    "chatDraftIntent",
    "repair",
  );
  expectMetric(
    failures,
    "cleared local history draft send reason",
    cleared,
    "chatDraftSendReason",
    "empty_draft",
  );
  expectMetric(
    failures,
    "cleared local history draft preview state",
    cleared,
    "chatDraftPreviewState",
    "empty",
  );
  failures.push(
    ...normalizeChatLocalHistoryClearFocusEvidence(cleared).failures,
  );

  expectMetric(
    failures,
    "resend local submission sequence",
    resend,
    "chatLocalSubmissionSequence",
    "5",
  );
  expectMetric(
    failures,
    "resend local submission count",
    resend,
    "chatLocalSubmissionCount",
    "1",
  );
  expectMetric(
    failures,
    "resend local submission status",
    resend,
    "chatLocalSubmissionStatus",
    "queued_local",
  );
  expectMetric(
    failures,
    "resend local submission intent",
    resend,
    "chatLocalSubmissionIntent",
    "repair",
  );
  expectMetric(
    failures,
    "resend local submission target",
    resend,
    "chatLocalSubmissionTarget",
    "repair",
  );
  expectMetric(
    failures,
    "resend local submission action",
    resend,
    "chatLocalSubmissionAction",
    "repair_review",
  );
  expectMetric(
    failures,
    "resend local submission characters",
    resend,
    "chatLocalSubmissionCharacters",
    "20",
  );
  expectMetric(
    failures,
    "resend local submission words",
    resend,
    "chatLocalSubmissionWords",
    "3",
  );
  expectMetricList(
    failures,
    "resend local submission history ids",
    resend,
    "chatLocalSubmissionHistoryItemIds",
    "5",
  );

  return failures;
}

function collectCaseFailures(testCase, result) {
  const failures = [];
  const jsonFailures = Array.isArray(result.failures) ? result.failures : [];
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const expectedChatBoxMode = getCaseChatBoxMode(testCase);

  if (result.streamEventMode !== testCase.mode) {
    failures.push(
      `expected mode ${testCase.mode}, got ${String(result.streamEventMode)}`,
    );
  }
  if (result.targetLocation?.streamEventMode !== testCase.mode) {
    failures.push(
      `expected target mode ${testCase.mode}, got ${String(
        result.targetLocation?.streamEventMode,
      )}`,
    );
  }
  if (result.chatBoxMode !== expectedChatBoxMode) {
    failures.push(
      `expected chat mode ${expectedChatBoxMode}, got ${String(
        result.chatBoxMode,
      )}`,
    );
  }
  if (result.targetLocation?.chatBoxMode !== expectedChatBoxMode) {
    failures.push(
      `expected target chat mode ${expectedChatBoxMode}, got ${String(
        result.targetLocation?.chatBoxMode,
      )}`,
    );
  }
  if (result.requestedViewport?.width !== testCase.width) {
    failures.push(
      `expected requested width ${testCase.width}, got ${String(
        result.requestedViewport?.width,
      )}`,
    );
  }
  if (result.requestedViewport?.height !== testCase.height) {
    failures.push(
      `expected requested height ${testCase.height}, got ${String(
        result.requestedViewport?.height,
      )}`,
    );
  }
  if (result.requestedViewport?.scrollY !== testCase.scrollY) {
    failures.push(
      `expected requested scroll ${testCase.scrollY}, got ${String(
        result.requestedViewport?.scrollY,
      )}`,
    );
  }
  const observedMaxScrollY = result.metrics?.scroll?.maxY ?? 0;
  const expectedObservedScrollY = Math.min(
    testCase.scrollY,
    observedMaxScrollY,
  );
  if (result.metrics?.scroll?.y !== expectedObservedScrollY) {
    failures.push(
      `expected observed scroll ${expectedObservedScrollY}, got ${String(
        result.metrics?.scroll?.y,
      )}`,
    );
  }
  if (result.captureSize?.width !== testCase.width) {
    failures.push(
      `expected capture width ${testCase.width}, got ${String(
        result.captureSize?.width,
      )}`,
    );
  }
  if (result.captureSize?.height !== testCase.height) {
    failures.push(
      `expected capture height ${testCase.height}, got ${String(
        result.captureSize?.height,
      )}`,
    );
  }
  if (result.metrics?.viewport?.width !== testCase.width) {
    failures.push(
      `expected observed width ${testCase.width}, got ${String(
        result.metrics?.viewport?.width,
      )}`,
    );
  }
  if (result.metrics?.viewport?.height !== testCase.height) {
    failures.push(
      `expected observed height ${testCase.height}, got ${String(
        result.metrics?.viewport?.height,
      )}`,
    );
  }
  if (result.metrics?.horizontalOverflow !== 0) {
    failures.push(
      `expected horizontal overflow 0, got ${String(
        result.metrics?.horizontalOverflow,
      )}`,
    );
  }
  if (messages.length !== 0) {
    failures.push(
      `expected no console warning/error messages, got ${messages.length}`,
    );
  }
  if (jsonFailures.length > 0) {
    failures.push(`case JSON contains ${jsonFailures.length} failure(s)`);
  }

  const detailText =
    result.streamEventExpandedMetrics?.streamEventDetailText ?? "";
  const detailKnownType =
    result.streamEventExpandedMetrics?.streamEventDetailKnownType;
  const metadataText =
    result.streamSelectionMetadataExpandedMetrics
      ?.streamSelectionMetadataText ?? "";
  const metadataKnownType =
    result.streamSelectionMetadataExpandedMetrics
      ?.streamSelectionMetadataKnownType;

  if (testCase.mode === "unknown") {
    if (detailKnownType !== "false") {
      failures.push(
        `expected unknown detail knownType false, got ${String(
          detailKnownType,
        )}`,
      );
    }
    if (!detailText.includes("Unknown event type")) {
      failures.push("expected unknown detail text");
    }
    if (metadataKnownType !== "false") {
      failures.push(
        `expected unknown metadata knownType false, got ${String(
          metadataKnownType,
        )}`,
      );
    }
    if (!metadataText.includes("Unknown event type")) {
      failures.push("expected unknown metadata text");
    }
  } else {
    if (detailKnownType !== "true") {
      failures.push(
        `expected known detail knownType true, got ${String(detailKnownType)}`,
      );
    }
    if (!detailText.includes("Known event type")) {
      failures.push("expected known detail text");
    }
    if (metadataKnownType !== "true") {
      failures.push(
        `expected known metadata knownType true, got ${String(
          metadataKnownType,
        )}`,
      );
    }
    if (!metadataText.includes("Known event type")) {
      failures.push("expected known metadata text");
    }
  }

  if (expectedChatBoxMode === "enabled") {
    failures.push(...collectEnabledChatBoxFailures(result, testCase.width));
  } else if (
    result.chatLocalSubmitMetrics != null ||
    result.chatLocalSubmitTriggerMetrics != null ||
    result.chatLocalHistoryMetrics != null ||
    result.chatLocalHistoryClearedMetrics != null ||
    result.chatLocalResendMetrics != null
  ) {
    failures.push(
      "expected no local chat submission metrics for disabled chat",
    );
  }

  return failures;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeJsonReadError(error) {
  if (error instanceof Error && "code" in error) {
    return `case JSON was not readable (${String(error.code)})`;
  }
  if (error instanceof SyntaxError) {
    return "case JSON was not valid JSON";
  }
  return "case JSON was not readable";
}

function summarizeProcessErrorCode(error) {
  if (error instanceof Error && "code" in error) {
    return String(error.code);
  }
  return "UNKNOWN";
}

function summarizeChatLocalRecord(metrics) {
  if (!isRecord(metrics)) {
    return null;
  }
  return {
    present: readMetric(metrics, "chatLocalSubmissionPresent"),
    sequence: readMetric(metrics, "chatLocalSubmissionSequence"),
    count: readMetric(metrics, "chatLocalSubmissionCount"),
    status: readMetric(metrics, "chatLocalSubmissionStatus"),
    intent: readMetric(metrics, "chatLocalSubmissionIntent"),
    target: readMetric(metrics, "chatLocalSubmissionTarget"),
    action: readMetric(metrics, "chatLocalSubmissionAction"),
    characters: readMetric(metrics, "chatLocalSubmissionCharacters"),
    words: readMetric(metrics, "chatLocalSubmissionWords"),
    clearButtonCount: readMetric(metrics, "chatLocalSubmissionClearButtons"),
    clearCount: readMetric(metrics, "chatLocalSubmissionClearCount"),
    historyItems: readMetric(metrics, "chatLocalSubmissionHistoryItems"),
    historyItemIds: summarizeMetricList(
      metrics,
      "chatLocalSubmissionHistoryItemIds",
    ),
    historyStatuses: summarizeMetricList(
      metrics,
      "chatLocalSubmissionHistoryStatuses",
    ),
  };
}

function summarizeChatClearedRecord(metrics) {
  if (!isRecord(metrics)) {
    return null;
  }
  return {
    present: readMetric(metrics, "chatLocalSubmissionPresent"),
    clearButtonCount: readMetric(metrics, "chatLocalSubmissionClearButtons"),
    historyItems: readMetric(metrics, "chatLocalSubmissionHistoryItems"),
    draftIntent: readMetric(metrics, "chatDraftIntent"),
    draftSendReason: readMetric(metrics, "chatDraftSendReason"),
    draftPreviewState: readMetric(metrics, "chatDraftPreviewState"),
  };
}

function summarizeChatLocalEvidence(result) {
  if (result?.chatBoxMode !== "enabled") {
    return null;
  }
  return {
    firstSubmission: summarizeChatLocalRecord(result.chatLocalSubmitMetrics),
    cappedHistory: summarizeChatLocalRecord(result.chatLocalHistoryMetrics),
    clearedHistory: summarizeChatClearedRecord(
      result.chatLocalHistoryClearedMetrics,
    ),
    resendAfterClear: summarizeChatLocalRecord(result.chatLocalResendMetrics),
  };
}

function summarizeChatLocalHistoryLayoutEvidence(result, requestedWidth) {
  if (result?.chatBoxMode !== "enabled" || requestedWidth > 520) {
    return null;
  }
  const history = result.chatLocalHistoryMetrics;
  if (!isRecord(history)) {
    return null;
  }
  return {
    columnCount: readMetric(history, "chatLocalSubmissionHistoryColumnCount"),
    clientWidth: readMetric(history, "chatLocalSubmissionHistoryClientWidth"),
    scrollWidth: readMetric(history, "chatLocalSubmissionHistoryScrollWidth"),
  };
}

function summarizeChatLocalSubmitTriggerEvidence(result) {
  if (result?.chatBoxMode !== "enabled") {
    return null;
  }
  return normalizeChatLocalSubmitTriggerEvidence(
    result.chatLocalSubmitTriggerMetrics,
  ).evidence;
}

function summarizeChatLocalHistoryClearFocusEvidence(result) {
  if (result?.chatBoxMode !== "enabled") {
    return null;
  }
  return normalizeChatLocalHistoryClearFocusEvidence(
    result.chatLocalHistoryClearedMetrics,
  ).evidence;
}

function summarizeChatFocusEvidence(result) {
  if (result?.chatBoxMode !== "enabled") {
    return null;
  }
  const initial = result.chatInitialMetrics;
  if (!isRecord(initial)) {
    return null;
  }
  return {
    expandedAfterToggle: readMetric(initial, "chatBoxExpanded"),
    draftInputCount: readMetric(initial, "chatDraftInputs"),
    draftInputFocusedAfterExpand: readMetric(initial, "chatDraftInputFocused"),
  };
}

function summarizeCase(testCase, outputPath, result, runResult, failures) {
  return {
    name: testCase.name,
    mode: testCase.mode,
    chatBoxMode: getCaseChatBoxMode(testCase),
    process: {
      exitCode: runResult.exitCode,
      signal: runResult.signal,
      errorCode: runResult.errorCode,
      stdoutLength: runResult.stdout.length,
      stderrLength: runResult.stderr.length,
    },
    targetLocation: result?.targetLocation ?? null,
    requestedViewport: result?.requestedViewport ?? null,
    captureSize: result?.captureSize ?? null,
    observedViewport: result?.metrics?.viewport ?? null,
    observedScroll: result?.metrics?.scroll ?? null,
    horizontalOverflow: result?.metrics?.horizontalOverflow ?? null,
    messageCount: Array.isArray(result?.messages)
      ? result.messages.length
      : null,
    outputEvidence: summarizeOutputPath(outputPath),
    chatLocalEvidence: summarizeChatLocalEvidence(result),
    chatLocalHistoryLayoutEvidence: summarizeChatLocalHistoryLayoutEvidence(
      result,
      testCase.width,
    ),
    chatLocalSubmitTriggerEvidence:
      summarizeChatLocalSubmitTriggerEvidence(result),
    chatLocalHistoryClearFocusEvidence:
      summarizeChatLocalHistoryClearFocusEvidence(result),
    chatFocusEvidence: summarizeChatFocusEvidence(result),
    failures,
  };
}

function runSmoke(testCase, outputPath) {
  const env = {
    ...process.env,
    CW_VISUAL_SMOKE_URL: buildCaseUrl(testCase),
    CW_VISUAL_SMOKE_OUTPUT: outputPath,
    CW_VISUAL_SMOKE_WIDTH: String(testCase.width),
    CW_VISUAL_SMOKE_HEIGHT: String(testCase.height),
    CW_VISUAL_SMOKE_SCROLL_Y: String(testCase.scrollY),
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (runResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(runResult);
    };
    const child = spawn(process.execPath, [electronCliPath, smokeScriptPath], {
      cwd: packageRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
    });
    child.on("error", (error) => {
      finish({
        exitCode: null,
        signal: null,
        errorCode: summarizeProcessErrorCode(error),
        stdout,
        stderr,
      });
    });
    child.on("close", (code, signal) => {
      finish({
        exitCode: code,
        signal,
        errorCode: null,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const caseSummaries = [];
  const matrixFailures = [];

  for (const testCase of defaultCases) {
    const outputPath = path.join(outputDir, `${testCase.name}.png`);
    console.log(
      `[visual-smoke:matrix] running ${testCase.name} ${testCase.width}x${testCase.height} scroll=${testCase.scrollY}`,
    );
    const runResult = await runSmoke(testCase, outputPath);
    let result = null;
    let parsedJson = false;
    const failures = [];
    if (runResult.errorCode !== null) {
      failures.push(`case process failed to start (${runResult.errorCode})`);
    } else if (runResult.exitCode !== 0) {
      failures.push(
        `case process exited with code ${String(runResult.exitCode)}`,
      );
    }
    if (runResult.stderr.length !== 0) {
      failures.push(
        `case process wrote stderr bytes: ${String(runResult.stderr.length)}`,
      );
    }
    try {
      result = JSON.parse(
        await fs.readFile(`${outputPath}.json`, { encoding: "utf8" }),
      );
      parsedJson = true;
    } catch (error) {
      failures.push(summarizeJsonReadError(error));
    }
    if (parsedJson && !isRecord(result)) {
      failures.push("case JSON root was not an object");
      result = null;
    }
    if (isRecord(result)) {
      failures.push(...collectCaseFailures(testCase, result));
    }
    if (failures.length > 0) {
      matrixFailures.push(`${testCase.name}: ${failures.join("; ")}`);
    }
    caseSummaries.push(
      summarizeCase(testCase, outputPath, result, runResult, failures),
    );
  }

  const manifestPath = path.join(outputDir, "matrix.json");
  const manifest = {
    targetLocation: parseSafeLocation(parsedBaseUrl),
    outputEvidence: {
      manifestFileName: path.basename(manifestPath),
      caseCount: caseSummaries.length,
    },
    cases: caseSummaries,
    failures: matrixFailures,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("[visual-smoke:matrix] wrote matrix.json");

  if (matrixFailures.length > 0) {
    throw new Error(
      `Electron visual smoke matrix failed: ${matrixFailures.join("; ")}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
