import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeBaseUrl, type RuntimeConnectionInfo } from "./runtime.js";
import { createRuntimeConnectionRegistry } from "./runtime-connection-registry.js";

const PROJECT_ROOT = path.join("C:", "CW", "project");

test("registers normalized runtime connections in memory by project root", () => {
  const registry = createRuntimeConnectionRegistry({ nowMs: () => 42 });
  const entry = registry.register({
    projectRoot: PROJECT_ROOT,
    connection: {
      base_url: createRuntimeBaseUrl(51234),
      token: " token_abc123 ",
    },
  });

  assert.equal(entry.projectRoot, path.resolve(PROJECT_ROOT));
  assert.equal(entry.registeredAtMs, 42);
  assert.deepEqual(entry.connection, {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });
  assert.deepEqual(registry.get(PROJECT_ROOT), entry.connection);
  assert.deepEqual(registry.snapshot(), [entry]);
});

test("builds a handoff resolver without reading connection data from disk", async () => {
  const registry = createRuntimeConnectionRegistry({ nowMs: () => 42 });
  const connection: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };
  registry.register({ projectRoot: PROJECT_ROOT, connection });

  const resolved = await registry.resolver(PROJECT_ROOT)({
    status: "active",
    lockPath: path.join(
      PROJECT_ROOT,
      ".agent-workflow",
      "locks",
      "runtime.lock",
    ),
  });

  assert.deepEqual(resolved, connection);
});

test("replaces a project connection and unregisters only the matching session", () => {
  const registry = createRuntimeConnectionRegistry();
  const first: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };
  const second: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51235),
    token: "token_def456",
  };

  registry.register({ projectRoot: PROJECT_ROOT, connection: first });
  registry.register({ projectRoot: PROJECT_ROOT, connection: second });

  assert.deepEqual(registry.get(PROJECT_ROOT), second);
  assert.equal(registry.snapshot().length, 1);
  assert.equal(registry.unregister(PROJECT_ROOT, first), false);
  assert.deepEqual(registry.get(PROJECT_ROOT), second);
  assert.equal(registry.unregister(PROJECT_ROOT, second), true);
  assert.equal(registry.get(PROJECT_ROOT), null);
});

test("matches project roots case-insensitively when configured", () => {
  const registry = createRuntimeConnectionRegistry({
    projectRootCaseSensitivity: "case_insensitive",
  });
  const mixedCaseProjectRoot = path.join("C:", "CW", "Project");
  const lowerCaseProjectRoot = mixedCaseProjectRoot.toLowerCase();
  const upperCaseProjectRoot = mixedCaseProjectRoot.toUpperCase();
  const connection: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };

  const entry = registry.register({
    projectRoot: mixedCaseProjectRoot,
    connection,
  });

  assert.equal(entry.projectRoot, path.resolve(mixedCaseProjectRoot));
  assert.deepEqual(registry.get(lowerCaseProjectRoot), connection);
  assert.deepEqual(registry.snapshot(), [entry]);
  assert.equal(registry.unregister(upperCaseProjectRoot, connection), true);
  assert.equal(registry.get(mixedCaseProjectRoot), null);
});

test("keeps project roots case-sensitive when configured", () => {
  const registry = createRuntimeConnectionRegistry({
    projectRootCaseSensitivity: "case_sensitive",
  });
  const mixedCaseProjectRoot = path.join("C:", "CW", "Project");
  const lowerCaseProjectRoot = mixedCaseProjectRoot.toLowerCase();
  const connection: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };

  registry.register({ projectRoot: mixedCaseProjectRoot, connection });

  assert.equal(registry.get(lowerCaseProjectRoot), null);
  assert.equal(registry.unregister(lowerCaseProjectRoot, connection), false);
  assert.deepEqual(registry.get(mixedCaseProjectRoot), connection);
});

test("matches symlink and junction aliases with realpath canonicalization", () => {
  const symlinkProjectRoot = path.join("C:", "CW", "project-link");
  const targetProjectRoot = path.join("C:", "CW", "project-target");
  const targetRealpath = path.resolve(targetProjectRoot);
  const registry = createRuntimeConnectionRegistry({
    projectRootCaseSensitivity: "case_sensitive",
    projectRootRealpath: (projectRoot) => {
      const resolvedProjectRoot = path.resolve(projectRoot);
      if (
        resolvedProjectRoot === path.resolve(symlinkProjectRoot) ||
        resolvedProjectRoot === targetRealpath
      ) {
        return targetRealpath;
      }

      return undefined;
    },
  });
  const connection: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };

  const entry = registry.register({
    projectRoot: symlinkProjectRoot,
    connection,
  });

  assert.equal(entry.projectRoot, path.resolve(symlinkProjectRoot));
  assert.deepEqual(registry.get(targetProjectRoot), connection);
  assert.deepEqual(registry.snapshot(), [entry]);
  assert.equal(registry.unregister(targetProjectRoot, connection), true);
  assert.equal(registry.get(symlinkProjectRoot), null);
});

test("falls back to resolved project root when realpath is unavailable", () => {
  const registry = createRuntimeConnectionRegistry({
    projectRootCaseSensitivity: "case_sensitive",
    projectRootRealpath: () => {
      throw new Error("realpath unavailable");
    },
  });
  const symlinkProjectRoot = path.join("C:", "CW", "project-link");
  const targetProjectRoot = path.join("C:", "CW", "project-target");
  const connection: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };

  registry.register({ projectRoot: symlinkProjectRoot, connection });

  assert.deepEqual(registry.get(symlinkProjectRoot), connection);
  assert.equal(registry.get(targetProjectRoot), null);
  assert.equal(registry.unregister(targetProjectRoot, connection), false);
});

test("allows callers to disable realpath lookup explicitly", () => {
  const registry = createRuntimeConnectionRegistry({
    projectRootRealpath: false,
  });
  const symlinkProjectRoot = path.join("C:", "CW", "project-link");
  const targetProjectRoot = path.join("C:", "CW", "project-target");
  const connection: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };

  registry.register({ projectRoot: symlinkProjectRoot, connection });

  assert.deepEqual(registry.get(symlinkProjectRoot), connection);
  assert.equal(registry.get(targetProjectRoot), null);
  assert.equal(registry.unregister(targetProjectRoot, connection), false);
});

test("matches real filesystem directory aliases with default realpath", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "cw-runtime-registry-realpath-"),
  );
  const linkedProjectRoot = path.join(tempRoot, "project-link");
  const targetProjectRoot = path.join(tempRoot, "project-target");
  const connection: RuntimeConnectionInfo = {
    base_url: createRuntimeBaseUrl(51234),
    token: "token_abc123",
  };

  try {
    await mkdir(targetProjectRoot, { recursive: true });

    try {
      await symlink(
        targetProjectRoot,
        linkedProjectRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      t.skip(`filesystem directory alias creation unavailable: ${message}`);
      return;
    }

    const registry = createRuntimeConnectionRegistry({
      projectRootCaseSensitivity: "case_sensitive",
    });

    const entry = registry.register({
      projectRoot: linkedProjectRoot,
      connection,
    });

    assert.equal(entry.projectRoot, path.resolve(linkedProjectRoot));
    assert.deepEqual(registry.get(targetProjectRoot), connection);
    assert.deepEqual(registry.snapshot(), [entry]);
    assert.equal(registry.unregister(targetProjectRoot, connection), true);
    assert.equal(registry.get(linkedProjectRoot), null);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects unsafe project roots and connection payloads", () => {
  const registry = createRuntimeConnectionRegistry();

  assert.throws(
    () =>
      registry.register({
        projectRoot: " ",
        connection: {
          base_url: createRuntimeBaseUrl(51234),
          token: "token_abc123",
        },
      }),
    /projectRoot/u,
  );
  assert.throws(
    () =>
      registry.register({
        projectRoot: PROJECT_ROOT,
        connection: {
          base_url:
            "http://localhost:51234/cw/v1" as RuntimeConnectionInfo["base_url"],
          token: "token_abc123",
        },
      }),
    /loopback/u,
  );
  assert.throws(
    () =>
      registry.register({
        projectRoot: PROJECT_ROOT,
        connection: {
          base_url: createRuntimeBaseUrl(51234),
          token: "token abc",
        },
      }),
    /Runtime auth token/u,
  );

  assert.throws(
    () =>
      createRuntimeConnectionRegistry({
        projectRootRealpath: () => " ",
      }).register({
        projectRoot: PROJECT_ROOT,
        connection: {
          base_url: createRuntimeBaseUrl(51234),
          token: "token_abc123",
        },
      }),
    /realpath/u,
  );
});
