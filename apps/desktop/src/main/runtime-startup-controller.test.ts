import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createRuntimeBaseUrl, type RuntimeConnectionInfo } from "./runtime.js";
import { createRuntimeIpcMainHandlers } from "./runtime-ipc-handlers.js";
import { createRuntimeConnectionRegistry } from "./runtime-connection-registry.js";
import {
  startRuntimeWithLifecycle,
  type RuntimeOrchestrationStarter,
  type RuntimeStartupLifecycleResolver,
} from "./runtime-startup-controller.js";
import type { RuntimeConnectionHandoffDecision } from "./runtime-handoff.js";
import type { RuntimeLockInspection } from "./runtime-lock.js";
import type { RuntimeOrchestrationSession } from "./runtime-orchestration.js";
import type { StartRuntimeSidecarOptions } from "./sidecar.js";

const PROJECT_ROOT = path.join("C:", "CW", "project");
const LOCK_PATH = path.join(
  PROJECT_ROOT,
  ".agent-workflow",
  "locks",
  "runtime.lock",
);
const CONNECTION: RuntimeConnectionInfo = {
  base_url: createRuntimeBaseUrl(51234),
  token: "token_abc123",
};
const ACTIVE_INSPECTION: RuntimeLockInspection = {
  status: "active",
  lockPath: LOCK_PATH,
};

test("starts an owned sidecar when lifecycle decides to start", async () => {
  const connectionRegistry = createRuntimeConnectionRegistry();
  let lifecycleProjectRoot: string | undefined;
  let orchestrationProjectRoot: string | undefined;
  let orchestrationRegistryMatched = false;
  let stopped = false;
  const lifecycleResolver: RuntimeStartupLifecycleResolver = async (
    options,
  ) => {
    lifecycleProjectRoot = options.projectRoot;
    assert.equal(typeof options.connectionInfo, "function");
    return {
      action: "start_sidecar",
      attempts: 1,
      handoff: {
        action: "start_sidecar",
        inspection: { status: "missing", lockPath: LOCK_PATH },
      },
    };
  };
  const orchestrationStarter: RuntimeOrchestrationStarter = async (options) => {
    orchestrationProjectRoot = options.projectRoot;
    orchestrationRegistryMatched =
      options.connectionRegistry === connectionRegistry;
    assert.deepEqual(options.command, { devCommand: "runtime-dev" });
    assert.equal(options.cwd, PROJECT_ROOT);
    assert.equal(options.readyTimeoutMs, 25);
    assert.equal(options.lock?.timeoutMs, 50);
    return createFakeRuntimeOrchestrationSession(() => {
      stopped = true;
    });
  };

  const result = await startRuntimeWithLifecycle({
    projectRoot: PROJECT_ROOT,
    command: { devCommand: "runtime-dev" },
    cwd: PROJECT_ROOT,
    readyTimeoutMs: 25,
    connectionRegistry,
    lock: { timeoutMs: 50 },
    lifecycleResolver,
    orchestrationStarter,
  });

  assert.equal(result.action, "started_sidecar");
  assert.equal(result.lifecycle.action, "start_sidecar");
  assert.equal(lifecycleProjectRoot, PROJECT_ROOT);
  assert.equal(orchestrationProjectRoot, PROJECT_ROOT);
  assert.equal(orchestrationRegistryMatched, true);
  assert.equal(await result.stop("SIGTERM"), true);
  assert.equal(stopped, true);
});

test("reuses existing runtime connection without starting a sidecar", async () => {
  const connectionRegistry = createRuntimeConnectionRegistry();
  connectionRegistry.register({
    projectRoot: PROJECT_ROOT,
    connection: CONNECTION,
  });
  let orchestrationCalled = false;
  const lifecycleResolver: RuntimeStartupLifecycleResolver = async (
    options,
  ) => {
    const connection = await options.connectionInfo?.(ACTIVE_INSPECTION);
    assert.deepEqual(connection, CONNECTION);
    return {
      action: "reuse_existing",
      attempts: 1,
      handoff: {
        action: "reuse_existing",
        inspection: ACTIVE_INSPECTION,
        connection: requireConnection(connection),
      },
    };
  };

  const result = await startRuntimeWithLifecycle({
    projectRoot: PROJECT_ROOT,
    command: { devCommand: "runtime-dev" },
    connectionRegistry,
    lifecycleResolver,
    orchestrationStarter: async () => {
      orchestrationCalled = true;
      throw new Error("unexpected orchestration start");
    },
  });

  assert.equal(result.action, "reused_existing");
  assert.deepEqual(await result.handlers.connectionInfo(), CONNECTION);
  assert.equal(await result.stop("SIGTERM"), false);
  await result.closed;
  assert.equal(orchestrationCalled, false);
});

test("fails closed when lifecycle blocks startup", async () => {
  let orchestrationCalled = false;
  const lifecycleResolver: RuntimeStartupLifecycleResolver = async () => ({
    action: "block_startup",
    attempts: 1,
    reason: "runtime.lock is corrupt",
    handoff: {
      action: "block_startup",
      inspection: {
        status: "corrupt",
        lockPath: LOCK_PATH,
        error: "runtime.lock is corrupt",
      },
      reason: "runtime.lock is corrupt",
    },
  });

  const result = await startRuntimeWithLifecycle({
    projectRoot: PROJECT_ROOT,
    command: { devCommand: "runtime-dev" },
    lifecycleResolver,
    orchestrationStarter: async () => {
      orchestrationCalled = true;
      throw new Error("unexpected orchestration start");
    },
  });

  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "runtime.lock is corrupt");
  assert.equal(orchestrationCalled, false);
});

test("reports timeout without starting a sidecar", async () => {
  let orchestrationCalled = false;
  const lifecycleResolver: RuntimeStartupLifecycleResolver = async () => ({
    action: "timeout_waiting_for_existing",
    attempts: 3,
    reason: "runtime.lock is active",
    handoff: {
      action: "wait_for_existing",
      inspection: ACTIVE_INSPECTION,
      reason: "runtime.lock is active",
    },
  });

  const result = await startRuntimeWithLifecycle({
    projectRoot: PROJECT_ROOT,
    command: { devCommand: "runtime-dev" },
    lifecycleResolver,
    orchestrationStarter: async () => {
      orchestrationCalled = true;
      throw new Error("unexpected orchestration start");
    },
  });

  assert.equal(result.action, "timed_out");
  assert.equal(result.reason, "runtime.lock is active");
  assert.equal(orchestrationCalled, false);
});

test("rejects inconsistent lifecycle reuse decisions", async () => {
  const lifecycleResolver: RuntimeStartupLifecycleResolver = async () => ({
    action: "reuse_existing",
    attempts: 1,
    handoff: {
      action: "wait_for_existing",
      inspection: ACTIVE_INSPECTION,
      reason: "registry not ready",
    },
  });

  await assert.rejects(
    startRuntimeWithLifecycle({
      projectRoot: PROJECT_ROOT,
      command: { devCommand: "runtime-dev" },
      lifecycleResolver,
    }),
    /reusable connection/u,
  );
});

function createFakeRuntimeOrchestrationSession(
  onStop: () => void,
): RuntimeOrchestrationSession {
  return {
    projectRoot: PROJECT_ROOT,
    command: { source: "dev", command: "runtime-dev", args: [] },
    lock: {
      lockPath: LOCK_PATH,
      record: {
        pid: 123,
        acquired_at: "2026-06-20T09:00:00Z",
        acquiredAtMs: 1,
        adapter_id: "desktop-main",
        raw: {
          pid: "123",
          acquired_at: "2026-06-20T09:00:00Z",
          adapter_id: "desktop-main",
        },
      },
      content: "pid=123\nacquired_at=2026-06-20T09:00:00Z\n",
      release: async () => undefined,
    },
    sidecar: {
      process: createFakeRuntimeSidecarProcess(),
      ready: {
        port: 51234,
        base_url: CONNECTION.base_url,
        raw_line: "READY 51234",
      },
      connection: CONNECTION,
      closed: Promise.resolve({ code: 0, signal: null }),
      stop: () => true,
    },
    handlers: createRuntimeIpcMainHandlers({
      connectionInfo: () => CONNECTION,
    }),
    closed: Promise.resolve(),
    stop: async (): Promise<boolean> => {
      onStop();
      return true;
    },
  };
}

function createFakeRuntimeSidecarProcess(): ReturnType<
  NonNullable<StartRuntimeSidecarOptions["spawn"]>
> {
  return {
    pid: 123,
    stdout: null,
    stderr: null,
    kill: () => true,
    once: function once() {
      return this;
    },
    off: function off() {
      return this;
    },
  };
}

function requireConnection(
  connection: RuntimeConnectionInfo | null | undefined,
): RuntimeConnectionInfo {
  if (connection === null || connection === undefined) {
    throw new Error("Expected reusable runtime connection");
  }

  return connection;
}
