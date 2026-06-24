const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parseTargetLocation,
  resolveVisualSmokePreflight,
  summarizeOutputPath,
} = require("./runtime-workbench-visual-smoke-preflight.cjs");

const packageRoot = path.resolve(__dirname, "..");
const smokeScriptPath = path.join(
  __dirname,
  "runtime-workbench-visual-smoke.cjs",
);
const knownSmokeUrl =
  "http://127.0.0.1:5174/visual-smoke.html?token=query-secret#hash-secret";
const unknownSmokeUrl =
  "http://127.0.0.1:5174/visual-smoke.html?streamEvent=unknown&token=query-secret#hash-secret";
const invalidSmokeUrl =
  "not-a-url?token=single-smoke-secret#single-smoke-hash-secret";
const invalidViewportSecret = "viewport-secret-value";
const invalidHeightSecret = "height-secret-value";
const invalidScrollSecret = "scroll-secret-value";
const outputPathSecret = "output-path-secret";

async function withTempDir(prefix, run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeElectronRequireGuard(tempDir) {
  const guardPath = path.join(tempDir, "electron-require-guard.cjs");
  await fs.writeFile(
    guardPath,
    `
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function guardedLoad(request, parent, isMain) {
  if (request === "electron") {
    throw new Error("electron module was required by visual smoke runner");
  }
  return originalLoad.apply(this, arguments);
};
`,
    { encoding: "utf8" },
  );
  return guardPath;
}

async function runSmokePreflight(tempDir, envPatch = {}) {
  const guardPath = await writeElectronRequireGuard(tempDir);
  const childEnv = {
    ...process.env,
    NODE_OPTIONS: `--require ${JSON.stringify(guardPath)}`,
  };
  delete childEnv.CW_VISUAL_SMOKE_URL;
  delete childEnv.CW_VISUAL_SMOKE_OUTPUT;
  for (const [name, value] of Object.entries(envPatch)) {
    if (value === undefined) {
      delete childEnv[name];
    } else {
      childEnv[name] = value;
    }
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [smokeScriptPath], {
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
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

test("visual smoke preflight summarizes known URLs without query or hash", () => {
  const preflight = resolveVisualSmokePreflight({
    CW_VISUAL_SMOKE_URL: knownSmokeUrl,
    CW_VISUAL_SMOKE_OUTPUT: "visual-smoke.png",
  });

  assert.equal(preflight.targetUrl, knownSmokeUrl);
  assert.equal(preflight.outputPath, "visual-smoke.png");
  assert.equal(preflight.width, 1280);
  assert.equal(preflight.height, 720);
  assert.equal(preflight.scrollY, 0);
  assert.deepEqual(preflight.outputEvidence, {
    outputFileName: "visual-smoke.png",
    jsonFileName: "visual-smoke.png.json",
  });
  assert.deepEqual(preflight.targetLocation, {
    origin: "http://127.0.0.1:5174",
    pathname: "/visual-smoke.html",
    streamEventMode: "known",
  });
  assert.equal(preflight.streamEventMode, "known");
  assert.equal(
    JSON.stringify(preflight.targetLocation).includes("query-secret"),
    false,
  );
  assert.equal(
    JSON.stringify(preflight.targetLocation).includes("hash-secret"),
    false,
  );
});

test("visual smoke preflight keeps unknown stream event mode", () => {
  const preflight = resolveVisualSmokePreflight({
    CW_VISUAL_SMOKE_URL: unknownSmokeUrl,
    CW_VISUAL_SMOKE_OUTPUT: "visual-smoke.png",
    CW_VISUAL_SMOKE_WIDTH: "390",
    CW_VISUAL_SMOKE_HEIGHT: "844",
    CW_VISUAL_SMOKE_SCROLL_Y: "900",
  });

  assert.equal(preflight.width, 390);
  assert.equal(preflight.height, 844);
  assert.equal(preflight.scrollY, 900);
  assert.deepEqual(preflight.targetLocation, {
    origin: "http://127.0.0.1:5174",
    pathname: "/visual-smoke.html",
    streamEventMode: "unknown",
  });
  assert.equal(preflight.streamEventMode, "unknown");
});

test("visual smoke preflight rejects missing env", () => {
  assert.throws(
    () => resolveVisualSmokePreflight({}),
    /CW_VISUAL_SMOKE_URL and CW_VISUAL_SMOKE_OUTPUT are required/u,
  );
});

test("visual smoke preflight rejects invalid URLs without echoing input", () => {
  assert.throws(
    () => parseTargetLocation(invalidSmokeUrl),
    (error) =>
      error instanceof Error &&
      error.message === "CW_VISUAL_SMOKE_URL must be a valid URL" &&
      !error.message.includes("single-smoke-secret") &&
      !error.message.includes("single-smoke-hash-secret"),
  );
});

test("visual smoke preflight summarizes output path without directory values", () => {
  const outputPath = path.join(
    os.tmpdir(),
    outputPathSecret,
    "visual-smoke.png",
  );
  const summary = summarizeOutputPath(outputPath);

  assert.deepEqual(summary, {
    outputFileName: "visual-smoke.png",
    jsonFileName: "visual-smoke.png.json",
  });
  assert.equal(JSON.stringify(summary).includes(outputPathSecret), false);
  assert.equal(JSON.stringify(summary).includes(os.tmpdir()), false);
});

test("visual smoke preflight rejects invalid viewport env without echoing input", () => {
  assert.throws(
    () =>
      resolveVisualSmokePreflight({
        CW_VISUAL_SMOKE_URL: knownSmokeUrl,
        CW_VISUAL_SMOKE_OUTPUT: "visual-smoke.png",
        CW_VISUAL_SMOKE_WIDTH: invalidViewportSecret,
      }),
    (error) =>
      error instanceof Error &&
      error.message === "CW_VISUAL_SMOKE_WIDTH must be a positive integer" &&
      !error.message.includes(invalidViewportSecret),
  );
  assert.throws(
    () =>
      resolveVisualSmokePreflight({
        CW_VISUAL_SMOKE_URL: knownSmokeUrl,
        CW_VISUAL_SMOKE_OUTPUT: "visual-smoke.png",
        CW_VISUAL_SMOKE_HEIGHT: "0",
      }),
    (error) =>
      error instanceof Error &&
      error.message === "CW_VISUAL_SMOKE_HEIGHT must be a positive integer" &&
      !error.message.includes("0"),
  );
  assert.throws(
    () =>
      resolveVisualSmokePreflight({
        CW_VISUAL_SMOKE_URL: knownSmokeUrl,
        CW_VISUAL_SMOKE_OUTPUT: "visual-smoke.png",
        CW_VISUAL_SMOKE_SCROLL_Y: "-1",
      }),
    (error) =>
      error instanceof Error &&
      error.message ===
        "CW_VISUAL_SMOKE_SCROLL_Y must be a non-negative integer" &&
      !error.message.includes("-1"),
  );
});

test("visual smoke requires URL and output before loading Electron", async () => {
  await withTempDir("cw-visual-smoke-missing-env-", async (tempDir) => {
    const result = await runSmokePreflight(tempDir);

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /CW_VISUAL_SMOKE_URL and CW_VISUAL_SMOKE_OUTPUT are required/u,
    );
    assert.equal(
      result.stderr.includes("Cannot find module 'electron'"),
      false,
    );
    assert.equal(result.stderr.includes("module was required"), false);
    assert.equal(result.stderr.includes("single-smoke-secret"), false);
  });
});

test("visual smoke rejects invalid viewport env before loading Electron", async () => {
  const cases = [
    {
      envName: "CW_VISUAL_SMOKE_WIDTH",
      secret: invalidViewportSecret,
      errorPattern: /CW_VISUAL_SMOKE_WIDTH must be a positive integer/u,
    },
    {
      envName: "CW_VISUAL_SMOKE_HEIGHT",
      secret: invalidHeightSecret,
      errorPattern: /CW_VISUAL_SMOKE_HEIGHT must be a positive integer/u,
    },
    {
      envName: "CW_VISUAL_SMOKE_SCROLL_Y",
      secret: invalidScrollSecret,
      errorPattern: /CW_VISUAL_SMOKE_SCROLL_Y must be a non-negative integer/u,
    },
  ];

  for (const testCase of cases) {
    await withTempDir("cw-visual-smoke-invalid-viewport-", async (tempDir) => {
      const outputPath = path.join(tempDir, "visual-smoke.png");
      const result = await runSmokePreflight(tempDir, {
        CW_VISUAL_SMOKE_URL: knownSmokeUrl,
        CW_VISUAL_SMOKE_OUTPUT: outputPath,
        [testCase.envName]: testCase.secret,
      });

      assert.equal(result.exitCode, 1);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, testCase.errorPattern);
      assert.equal(result.stderr.includes(testCase.secret), false);
      assert.equal(
        result.stderr.includes("Cannot find module 'electron'"),
        false,
      );
      assert.equal(result.stderr.includes("module was required"), false);
      await assert.rejects(fs.access(outputPath), {
        code: "ENOENT",
      });
      await assert.rejects(fs.access(`${outputPath}.json`), {
        code: "ENOENT",
      });
    });
  }
});

test("visual smoke valid env reaches Electron import after preflight", async () => {
  await withTempDir("cw-visual-smoke-valid-handoff-", async (tempDir) => {
    const outputPath = path.join(tempDir, "visual-smoke.png");
    const result = await runSmokePreflight(tempDir, {
      CW_VISUAL_SMOKE_URL: knownSmokeUrl,
      CW_VISUAL_SMOKE_OUTPUT: outputPath,
      CW_VISUAL_SMOKE_WIDTH: "1280",
      CW_VISUAL_SMOKE_HEIGHT: "720",
      CW_VISUAL_SMOKE_SCROLL_Y: "0",
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /electron module was required by visual smoke runner/u,
    );
    assert.equal(
      result.stderr.includes(
        "CW_VISUAL_SMOKE_URL and CW_VISUAL_SMOKE_OUTPUT are required",
      ),
      false,
    );
    assert.equal(result.stderr.includes("must be a valid URL"), false);
    assert.equal(result.stderr.includes("must be a positive integer"), false);
    assert.equal(
      result.stderr.includes("must be a non-negative integer"),
      false,
    );
    assert.equal(result.stderr.includes("query-secret"), false);
    assert.equal(result.stderr.includes("hash-secret"), false);
    await assert.rejects(fs.access(outputPath), {
      code: "ENOENT",
    });
    await assert.rejects(fs.access(`${outputPath}.json`), {
      code: "ENOENT",
    });
  });
});

test("visual smoke rejects invalid target URLs without leaking input", async () => {
  await withTempDir("cw-visual-smoke-invalid-url-", async (tempDir) => {
    const outputPath = path.join(tempDir, "visual-smoke.png");
    const result = await runSmokePreflight(tempDir, {
      CW_VISUAL_SMOKE_URL: invalidSmokeUrl,
      CW_VISUAL_SMOKE_OUTPUT: outputPath,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /CW_VISUAL_SMOKE_URL must be a valid URL/u);
    assert.equal(result.stderr.includes("single-smoke-secret"), false);
    assert.equal(result.stderr.includes("single-smoke-hash-secret"), false);
    assert.equal(
      result.stderr.includes("Cannot find module 'electron'"),
      false,
    );
    assert.equal(result.stderr.includes("module was required"), false);
    await assert.rejects(fs.access(outputPath), {
      code: "ENOENT",
    });
    await assert.rejects(fs.access(`${outputPath}.json`), {
      code: "ENOENT",
    });
  });
});
