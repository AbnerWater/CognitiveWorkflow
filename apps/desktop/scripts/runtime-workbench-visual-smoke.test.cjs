const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const smokeScriptPath = path.join(
  __dirname,
  "runtime-workbench-visual-smoke.cjs",
);
const invalidSmokeUrl =
  "not-a-url?token=single-smoke-secret#single-smoke-hash-secret";

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
    throw new Error("electron module was required before visual smoke preflight completed");
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
