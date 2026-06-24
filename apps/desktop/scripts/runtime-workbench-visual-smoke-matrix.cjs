const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

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

function buildCaseUrl(mode) {
  const parsedUrl = new URL(parsedBaseUrl.toString());
  parsedUrl.search = "";
  parsedUrl.hash = "";
  if (mode === "unknown") {
    parsedUrl.searchParams.set("streamEvent", "unknown");
  }
  return parsedUrl.toString();
}

function collectCaseFailures(testCase, result) {
  const failures = [];
  const jsonFailures = Array.isArray(result.failures) ? result.failures : [];
  const messages = Array.isArray(result.messages) ? result.messages : [];

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
    failures.push(`case JSON contains failures: ${jsonFailures.join("; ")}`);
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

function summarizeCase(testCase, outputPath, result, runResult, failures) {
  return {
    name: testCase.name,
    mode: testCase.mode,
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
    outputPath,
    jsonPath: `${outputPath}.json`,
    failures,
  };
}

function runSmoke(testCase, outputPath) {
  const env = {
    ...process.env,
    CW_VISUAL_SMOKE_URL: buildCaseUrl(testCase.mode),
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
    outputDir,
    cases: caseSummaries,
    failures: matrixFailures,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[visual-smoke:matrix] wrote ${manifestPath}`);

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
