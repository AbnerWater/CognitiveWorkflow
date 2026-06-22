import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildElectronRuntimeStartupOptions } from "./electron-runtime-startup-options.js";

test("builds unpackaged Electron runtime startup with workspace Python module", () => {
  const workspaceRoot = path.win32.join("C:", "CW", "repo");
  const projectRoot = path.win32.join("C:", "CW", "project");

  assert.deepEqual(
    buildElectronRuntimeStartupOptions({
      projectRoot,
      resourcesPath: path.win32.join("C:", "CW", "resources"),
      workspaceRoot,
      isPackaged: false,
      platform: "win32",
    }),
    {
      projectRoot,
      cwd: projectRoot,
      command: {
        platform: "win32",
        resourcesPath: path.win32.join("C:", "CW", "resources"),
        devCommand: path.win32.join(
          workspaceRoot,
          ".venv",
          "Scripts",
          "python.exe",
        ),
        devArgs: ["-m", "cw_runtime.cli"],
      },
    },
  );
});

test("uses packaged runtime discovery for packaged Electron apps", () => {
  const workspaceRoot = path.win32.join("C:", "CW", "repo");
  const projectRoot = path.win32.join("C:", "CW", "project");

  assert.deepEqual(
    buildElectronRuntimeStartupOptions({
      projectRoot,
      resourcesPath: path.win32.join("C:", "CW", "resources"),
      workspaceRoot,
      isPackaged: true,
      platform: "win32",
    }),
    {
      projectRoot,
      cwd: projectRoot,
      command: {
        platform: "win32",
        resourcesPath: path.win32.join("C:", "CW", "resources"),
      },
    },
  );
});

test("keeps explicit Electron runtime dev command override", () => {
  const workspaceRoot = path.win32.join("C:", "CW", "repo");
  const projectRoot = path.win32.join("C:", "CW", "project");

  assert.deepEqual(
    buildElectronRuntimeStartupOptions({
      projectRoot,
      resourcesPath: path.win32.join("C:", "CW", "resources"),
      workspaceRoot,
      isPackaged: false,
      platform: "linux",
      runtimeDevCommand: "custom-runtime",
    }),
    {
      projectRoot,
      cwd: projectRoot,
      command: {
        platform: "linux",
        resourcesPath: path.win32.join("C:", "CW", "resources"),
        devCommand: "custom-runtime",
      },
    },
  );
});

test("builds POSIX workspace Python command for unpackaged Electron apps", () => {
  const workspaceRoot = "/cw/repo";
  const projectRoot = "/cw/project";

  assert.deepEqual(
    buildElectronRuntimeStartupOptions({
      projectRoot,
      resourcesPath: "/cw/resources",
      workspaceRoot,
      isPackaged: false,
      platform: "linux",
    }),
    {
      projectRoot,
      cwd: projectRoot,
      command: {
        platform: "linux",
        resourcesPath: "/cw/resources",
        devCommand: "/cw/repo/.venv/bin/python",
        devArgs: ["-m", "cw_runtime.cli"],
      },
    },
  );
});
