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

const outputDir =
  process.env.CW_VISUAL_SMOKE_MATRIX_OUTPUT_DIR ??
  path.join(os.tmpdir(), `cw-visual-smoke-matrix-${Date.now()}`);

const electronCliPath =
  process.env.CW_VISUAL_SMOKE_ELECTRON_CLI ??
  path.join(packageRoot, "node_modules", "electron", "cli.js");

function parseSafeLocation(url) {
  const parsedUrl = new URL(url);
  return {
    origin: parsedUrl.origin,
    pathname: parsedUrl.pathname,
  };
}

function buildCaseUrl(mode) {
  const parsedUrl = new URL(baseUrl);
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

function summarizeCase(testCase, outputPath, result, failures) {
  return {
    name: testCase.name,
    mode: testCase.mode,
    targetLocation: result.targetLocation,
    requestedViewport: result.requestedViewport,
    captureSize: result.captureSize,
    observedViewport: result.metrics?.viewport,
    observedScroll: result.metrics?.scroll,
    horizontalOverflow: result.metrics?.horizontalOverflow,
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

  return new Promise((resolve, reject) => {
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
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `visual smoke case ${testCase.name} exited with code ${String(code)}`,
        ),
      );
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
    await runSmoke(testCase, outputPath);
    const result = JSON.parse(
      await fs.readFile(`${outputPath}.json`, { encoding: "utf8" }),
    );
    const failures = collectCaseFailures(testCase, result);
    if (failures.length > 0) {
      matrixFailures.push(`${testCase.name}: ${failures.join("; ")}`);
    }
    caseSummaries.push(summarizeCase(testCase, outputPath, result, failures));
  }

  const manifestPath = path.join(outputDir, "matrix.json");
  const manifest = {
    targetLocation: parseSafeLocation(baseUrl),
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
