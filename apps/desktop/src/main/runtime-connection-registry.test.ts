import assert from "node:assert/strict";
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
});
