import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  buildRuntimeIpcFetchRequest,
} from "../shared/runtime-ipc.js";
import { createRuntimeBaseUrl, type RuntimeConnectionInfo } from "./runtime.js";
import { createRuntimeIpcMainHandlers } from "./runtime-ipc-handlers.js";
import {
  RuntimeStartupUnavailableError,
  createRuntimeIpcStartupHandlers,
  type RuntimeIpcStartupControllerStarter,
} from "./runtime-ipc-main-factory.js";
import type { RuntimeStartupControllerResult } from "./runtime-startup-controller.js";
import type { RuntimeStartupStatus } from "./runtime-startup-status.js";

const CONNECTION: RuntimeConnectionInfo = {
  base_url: createRuntimeBaseUrl(51234),
  token: "token_abc123",
};

test("exposes stable channel registrations without importing Electron", async () => {
  const handlers = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => createReadyStartupResult(),
  });

  assert.deepEqual(
    handlers.registrations.map((registration) => registration.channel),
    [
      "cw:runtime:connection-info",
      "cw:runtime:fetch",
      "cw:runtime:startup-status",
    ],
  );
  assert.equal(handlers.snapshot().state, "idle");
  const startupStatusRegistration = handlers.registrations.find(
    (registration) =>
      registration.channel === RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  );
  assert.equal(
    startupStatusRegistration?.channel,
    RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  );
  assert.deepEqual(await startupStatusRegistration.handle(), []);
  assert.equal(handlers.snapshot().state, "idle");

  const connectionInfoRegistration = handlers.registrations.find(
    (registration) =>
      registration.channel === RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  );
  assert.equal(
    connectionInfoRegistration?.channel,
    RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  );
  assert.deepEqual(await connectionInfoRegistration.handle(), CONNECTION);
  assert.equal(handlers.snapshot().state, "ready");
});

test("starts runtime once for concurrent IPC handler calls", async () => {
  let starterCalls = 0;
  const starter: RuntimeIpcStartupControllerStarter = async () => {
    starterCalls += 1;
    await Promise.resolve();
    return createReadyStartupResult();
  };
  const handlers = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter,
  });

  const [connectionInfo, response] = await Promise.all([
    handlers.handlers.connectionInfo(),
    handlers.handlers.fetch<{ ok: boolean }>(
      buildRuntimeIpcFetchRequest("/system/info"),
    ),
  ]);

  assert.equal(starterCalls, 1);
  assert.deepEqual(connectionInfo, CONNECTION);
  assert.deepEqual(response.body, { ok: true });
  assert.equal((await handlers.getStartupResult()).action, "started_sidecar");
});

test("records and forwards startup lifecycle statuses", async () => {
  let starterCalls = 0;
  const factoryStatuses: RuntimeStartupStatus[] = [];
  const startupStatuses: RuntimeStartupStatus[] = [];
  const waitingStatus = createStartupStatus({
    kind: "waiting_for_existing",
    action: "wait_for_existing",
    lifecycleComplete: false,
  });
  const readyStatus = createStartupStatus({
    kind: "runtime_ready",
    action: "reuse_existing",
    lifecycleComplete: true,
  });
  const handlers = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
      lifecycle: {
        onStatus: (status) => {
          startupStatuses.push(status);
        },
      },
    },
    onStatus: (status) => {
      factoryStatuses.push(status);
    },
    starter: async (options) => {
      starterCalls += 1;
      await options.lifecycle?.onStatus?.(waitingStatus);
      await options.lifecycle?.onStatus?.(readyStatus);
      return createReadyStartupResult();
    },
  });

  assert.deepEqual(handlers.statusHistory(), []);
  const startupStatusRegistration = handlers.registrations.find(
    (registration) =>
      registration.channel === RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  );
  assert.equal(
    startupStatusRegistration?.channel,
    RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  );
  assert.deepEqual(await startupStatusRegistration.handle(), []);
  assert.equal(starterCalls, 0);

  assert.deepEqual(await handlers.handlers.connectionInfo(), CONNECTION);
  assert.equal(starterCalls, 1);
  assert.deepEqual(factoryStatuses, [waitingStatus, readyStatus]);
  assert.deepEqual(startupStatuses, [waitingStatus, readyStatus]);
  assert.deepEqual(handlers.statusHistory(), [waitingStatus, readyStatus]);
  assert.deepEqual(await startupStatusRegistration.handle(), [
    waitingStatus,
    readyStatus,
  ]);

  const mutableHistory = handlers.statusHistory() as RuntimeStartupStatus[];
  mutableHistory.pop();
  const mutableStartupStatus =
    (await startupStatusRegistration.handle()) as RuntimeStartupStatus[];
  mutableStartupStatus.pop();

  assert.deepEqual(handlers.statusHistory(), [waitingStatus, readyStatus]);
  assert.deepEqual(await startupStatusRegistration.handle(), [
    waitingStatus,
    readyStatus,
  ]);
  assert.deepEqual(
    (
      await handlers.handlers.fetch<{ ok: boolean }>(
        buildRuntimeIpcFetchRequest("/system/info"),
      )
    ).body,
    { ok: true },
  );
  assert.equal(starterCalls, 1);
  assert.equal(factoryStatuses.length, 2);
});

test("validates fetch registration payload before forwarding to runtime fetch", async () => {
  let forwarded = false;
  const handlers = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () =>
      createReadyStartupResult({
        fetchImpl: async () => {
          forwarded = true;
          return new Response(null, { status: 204 });
        },
      }),
  });
  const fetchRegistration = handlers.registrations.find(
    (registration) => registration.channel === RUNTIME_IPC_FETCH_CHANNEL,
  );
  assert.equal(fetchRegistration?.channel, RUNTIME_IPC_FETCH_CHANNEL);

  await assert.rejects(
    fetchRegistration.handle({
      path: "/system/info",
      init: { headers: { Authorization: "Bearer attacker" } },
    }),
    /reserved/u,
  );
  assert.equal(forwarded, false);

  const response = await fetchRegistration.handle({ path: "/system/info" });
  assert.equal(response.status, 204);
  assert.equal(forwarded, true);
});

test("fails closed when startup controller blocks or times out", async () => {
  const blocked = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => ({
      action: "blocked",
      reason: "runtime.lock is corrupt",
      lifecycle: {
        action: "block_startup",
        attempts: 1,
        reason: "runtime.lock is corrupt",
        handoff: {
          action: "block_startup",
          inspection: { status: "corrupt", lockPath: "runtime.lock" },
          reason: "runtime.lock is corrupt",
        },
      },
    }),
  });
  const timedOut = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => ({
      action: "timed_out",
      reason: "runtime.lock is active",
      lifecycle: {
        action: "timeout_waiting_for_existing",
        attempts: 3,
        reason: "runtime.lock is active",
        handoff: {
          action: "wait_for_existing",
          inspection: { status: "active", lockPath: "runtime.lock" },
          reason: "runtime.lock is active",
        },
      },
    }),
  });

  await assert.rejects(
    blocked.handlers.connectionInfo(),
    RuntimeStartupUnavailableError,
  );
  assert.deepEqual(blocked.snapshot(), {
    state: "unavailable",
    action: "blocked",
    reason: "runtime.lock is corrupt",
  });
  assert.equal(await blocked.stop(), false);
  await blocked.closed();

  await assert.rejects(
    timedOut.handlers.fetch({ path: "/system/info" }),
    RuntimeStartupUnavailableError,
  );
  assert.deepEqual(timedOut.snapshot(), {
    state: "unavailable",
    action: "timed_out",
    reason: "runtime.lock is active",
  });
  assert.equal(await timedOut.stop(), false);
});

test("does not stop a reused existing runtime through the IPC factory", async () => {
  const handlers = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => ({
      action: "reused_existing",
      lifecycle: {
        action: "reuse_existing",
        attempts: 1,
        handoff: {
          action: "reuse_existing",
          inspection: { status: "active", lockPath: "runtime.lock" },
          connection: CONNECTION,
        },
      },
      handlers: createRuntimeIpcMainHandlers({
        connectionInfo: () => CONNECTION,
      }),
      closed: Promise.resolve(),
      stop: async () => false,
    }),
  });

  assert.deepEqual(await handlers.handlers.connectionInfo(), CONNECTION);
  assert.equal(await handlers.stop("SIGTERM"), false);
  await handlers.closed();
});

test("caches startup failures instead of spawning repeatedly", async () => {
  let starterCalls = 0;
  const handlers = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => {
      starterCalls += 1;
      throw new Error("spawn failed");
    },
  });

  await assert.rejects(handlers.handlers.connectionInfo(), /spawn failed/u);
  await assert.rejects(handlers.handlers.connectionInfo(), /spawn failed/u);
  assert.equal(starterCalls, 1);
  assert.deepEqual(handlers.snapshot(), {
    state: "failed",
    reason: "Error",
  });
  assert.equal(await handlers.stop(), false);
  await handlers.closed();
});

function createReadyStartupResult(options?: {
  readonly fetchImpl?: typeof fetch;
}): RuntimeStartupControllerResult {
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl:
      options?.fetchImpl ??
      (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
  });

  return {
    action: "started_sidecar",
    lifecycle: {
      action: "start_sidecar",
      attempts: 1,
      handoff: {
        action: "start_sidecar",
        inspection: { status: "missing", lockPath: "runtime.lock" },
      },
    },
    session: {
      projectRoot: "C:/CW/project",
      command: { source: "dev", command: "runtime", args: [] },
      lock: {
        lockPath: "runtime.lock",
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
        process: {
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
        },
        ready: {
          port: 51234,
          base_url: CONNECTION.base_url,
          raw_line: "READY 51234",
        },
        connection: CONNECTION,
        closed: Promise.resolve({ code: 0, signal: null }),
        stop: () => true,
      },
      handlers,
      closed: Promise.resolve(),
      stop: async () => true,
    },
    handlers,
    closed: Promise.resolve(),
    stop: async () => true,
  };
}

function createStartupStatus(options: {
  readonly kind: RuntimeStartupStatus["kind"];
  readonly action: RuntimeStartupStatus["action"];
  readonly lifecycleComplete: boolean;
}): RuntimeStartupStatus {
  return {
    kind: options.kind,
    action: options.action,
    attempt: 1,
    lockStatus: "active",
    severity: "info",
    message: "Runtime startup status.",
    lifecycleComplete: options.lifecycleComplete,
    userActionRequired: false,
    retryable: false,
  };
}
