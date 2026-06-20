import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  PACKAGED_RUNTIME_DIRNAME,
  RUNTIME_EXECUTABLE_BASENAME,
  getRuntimeExecutableName,
  resolvePackagedRuntimePath,
  resolveRuntimeCommand,
} from "./runtime-command.js";

test("selects the packaged runtime executable name per platform", () => {
  assert.equal(getRuntimeExecutableName("win32"), "cw-runtime.exe");
  assert.equal(getRuntimeExecutableName("darwin"), "cw-runtime");
  assert.equal(getRuntimeExecutableName("linux"), "cw-runtime");
});

test("resolves packaged runtime path under Electron resources/runtime", () => {
  const resourcesPath = path.join("C:", "CW", "resources");

  assert.equal(
    resolvePackagedRuntimePath(resourcesPath, "win32"),
    path.join(
      resourcesPath,
      PACKAGED_RUNTIME_DIRNAME,
      `${RUNTIME_EXECUTABLE_BASENAME}.exe`,
    ),
  );
});

test("prefers an explicit dev command without probing packaged resources", () => {
  const command = resolveRuntimeCommand({
    devCommand: " uv ",
    devArgs: ["run", "cw-runtime"],
    resourcesPath: path.join("unused", "resources"),
    exists: () => {
      throw new Error("packaged runtime should not be probed in dev mode");
    },
  });

  assert.deepEqual(command, {
    source: "dev",
    command: "uv",
    args: ["run", "cw-runtime"],
  });
});

test("resolves packaged runtime command and verifies existence when requested", () => {
  const resourcesPath = path.join("C:", "CW", "resources");
  const expected = path.join(
    resourcesPath,
    PACKAGED_RUNTIME_DIRNAME,
    "cw-runtime.exe",
  );
  const seenPaths: string[] = [];

  const command = resolveRuntimeCommand({
    resourcesPath,
    platform: "win32",
    exists: (candidatePath) => {
      seenPaths.push(candidatePath);
      return candidatePath === expected;
    },
  });

  assert.deepEqual(command, {
    source: "packaged",
    command: expected,
    args: [],
  });
  assert.deepEqual(seenPaths, [expected]);
});

test("fails closed when packaged runtime resources are unavailable", () => {
  assert.throws(
    () => resolveRuntimeCommand({ platform: "win32" }),
    /resources path is required/u,
  );
  assert.throws(
    () =>
      resolveRuntimeCommand({
        resourcesPath: path.join("C:", "CW", "resources"),
        platform: "win32",
        exists: () => false,
      }),
    /Packaged runtime executable not found/u,
  );
});

test("rejects ambiguous or unsafe command inputs", () => {
  assert.throws(
    () => resolveRuntimeCommand({ devCommand: "  " }),
    /dev command must be non-empty/u,
  );
  assert.throws(
    () => resolveRuntimeCommand({ devCommand: "cw-runtime\n--debug" }),
    /control characters/u,
  );
  assert.throws(
    () => resolveRuntimeCommand({ devArgs: ["--debug"] }),
    /dev args require/u,
  );
  assert.throws(
    () => resolvePackagedRuntimePath("C:\\CW\nresources", "win32"),
    /control characters/u,
  );
});
