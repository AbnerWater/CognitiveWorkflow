import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_CHANNELS,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  type RuntimeIpcChannel,
  type RuntimeIpcShutdownStatusResponse,
  buildRuntimeIpcFetchRequest,
} from "../shared/runtime-ipc.js";
import {
  installRuntimeAppLifecycleShutdown,
  installRuntimeIpcMainHandlers,
  installRuntimeMainLifecycleShutdown,
  installRuntimeMainWithLifecycleShutdown,
  installRuntimeWindowLifecycleShutdown,
  type CwMainApp,
  type CwMainBeforeQuitEvent,
  type CwMainBeforeQuitListener,
  type CwMainIpcInvokeHandler,
  type CwMainWindow,
  type CwMainWindowCloseEvent,
  type CwMainWindowCloseListener,
  type RuntimeMainLifecycleShutdownStatus,
} from "./bootstrap.js";
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
      "cw:runtime:shutdown-status",
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
  const shutdownStatusRegistration = handlers.registrations.find(
    (registration) =>
      registration.channel === RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  );
  assert.equal(
    shutdownStatusRegistration?.channel,
    RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  );
  assert.deepEqual(await shutdownStatusRegistration.handle(), []);
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

test("exposes shutdown status registration without starting runtime", async () => {
  let starterCalls = 0;
  const shutdownStatuses: RuntimeIpcShutdownStatusResponse = [
    {
      kind: "shutting_down",
      state: "shutting_down",
      severity: "info",
      lifecycleComplete: false,
      retryable: false,
      appQuitRequested: true,
      windowCloseRequested: false,
    },
  ];
  const handlers = createRuntimeIpcStartupHandlers({
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    shutdownStatus: () => shutdownStatuses,
    starter: async () => {
      starterCalls += 1;
      return createReadyStartupResult();
    },
  });
  const shutdownStatusRegistration = handlers.registrations.find(
    (registration) =>
      registration.channel === RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  );
  assert.equal(
    shutdownStatusRegistration?.channel,
    RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  );

  assert.deepEqual(await shutdownStatusRegistration.handle(), shutdownStatuses);
  const mutableShutdownStatus =
    (await shutdownStatusRegistration.handle()) as RuntimeIpcShutdownStatusResponse extends readonly (infer TStatus)[]
      ? TStatus[]
      : never;
  mutableShutdownStatus.pop();

  assert.deepEqual(await shutdownStatusRegistration.handle(), shutdownStatuses);
  assert.equal(starterCalls, 0);
  assert.equal(handlers.snapshot().state, "idle");
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

test("installs runtime IPC handlers through an injected Electron-like ipcMain", async () => {
  let starterCalls = 0;
  const registeredHandlers = new Map<
    RuntimeIpcChannel,
    CwMainIpcInvokeHandler
  >();
  const installed = installRuntimeIpcMainHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        assert.equal(registeredHandlers.has(channel), false);
        registeredHandlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        registeredHandlers.delete(channel);
      },
    },
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => {
      starterCalls += 1;
      return createReadyStartupResult();
    },
  });

  assert.deepEqual(installed.registeredChannels, RUNTIME_IPC_CHANNELS);
  assert.deepEqual([...registeredHandlers.keys()], RUNTIME_IPC_CHANNELS);
  assert.equal(starterCalls, 0);
  assert.equal(installed.startupHandlers.snapshot().state, "idle");

  const startupStatusHandler = registeredHandlers.get(
    RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  );
  assert.ok(startupStatusHandler);
  assert.deepEqual(await startupStatusHandler({ sender: "renderer" }), []);
  assert.equal(starterCalls, 0);
  assert.equal(installed.startupHandlers.snapshot().state, "idle");
  const shutdownStatusHandler = registeredHandlers.get(
    RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  );
  assert.ok(shutdownStatusHandler);
  assert.deepEqual(await shutdownStatusHandler({ sender: "renderer" }), []);
  assert.equal(starterCalls, 0);
  assert.equal(installed.startupHandlers.snapshot().state, "idle");

  const connectionInfoHandler = registeredHandlers.get(
    RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  );
  assert.ok(connectionInfoHandler);
  assert.deepEqual(await connectionInfoHandler({ sender: "renderer" }), {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });
  assert.equal(starterCalls, 1);
  assert.equal(installed.startupHandlers.snapshot().state, "ready");

  const fetchHandler = registeredHandlers.get(RUNTIME_IPC_FETCH_CHANNEL);
  assert.ok(fetchHandler);
  assert.deepEqual(
    await fetchHandler(
      { sender: "renderer" },
      {
        path: "/system/info",
        init: { method: "GET", headers: { Accept: "application/json" } },
      },
    ),
    {
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    },
  );
  assert.equal(starterCalls, 1);

  await assert.rejects(
    fetchHandler(
      { sender: "renderer" },
      {
        path: "/system/info",
        init: { headers: { Authorization: "Bearer attacker" } },
      },
    ),
    /reserved/u,
  );
  assert.equal(starterCalls, 1);
});

test("unregisters installed runtime IPC handlers once without starting runtime", async () => {
  let starterCalls = 0;
  const registeredHandlers = new Map<
    RuntimeIpcChannel,
    CwMainIpcInvokeHandler
  >();
  const removedChannels: RuntimeIpcChannel[] = [];
  const installed = installRuntimeIpcMainHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        registeredHandlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        assert.equal(registeredHandlers.delete(channel), true);
        removedChannels.push(channel);
      },
    },
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => {
      starterCalls += 1;
      return createReadyStartupResult();
    },
  });

  assert.deepEqual([...registeredHandlers.keys()], RUNTIME_IPC_CHANNELS);
  assert.equal(starterCalls, 0);
  assert.equal(installed.startupHandlers.snapshot().state, "idle");
  assert.deepEqual(installed.unregister(), RUNTIME_IPC_CHANNELS);
  assert.deepEqual(removedChannels, RUNTIME_IPC_CHANNELS);
  assert.deepEqual([...registeredHandlers.keys()], []);
  assert.equal(starterCalls, 0);
  assert.equal(installed.startupHandlers.snapshot().state, "idle");
  assert.deepEqual(installed.unregister(), []);
  assert.deepEqual(removedChannels, RUNTIME_IPC_CHANNELS);
});

test("shuts down installed runtime IPC handlers without starting idle runtime", async () => {
  let starterCalls = 0;
  const registeredHandlers = new Map<
    RuntimeIpcChannel,
    CwMainIpcInvokeHandler
  >();
  const removedChannels: RuntimeIpcChannel[] = [];
  const installed = installRuntimeIpcMainHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        registeredHandlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        assert.equal(registeredHandlers.delete(channel), true);
        removedChannels.push(channel);
      },
    },
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => {
      starterCalls += 1;
      return createReadyStartupResult();
    },
  });

  const result = await installed.shutdown("SIGTERM");

  assert.deepEqual(result, {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: false,
  });
  assert.deepEqual(removedChannels, RUNTIME_IPC_CHANNELS);
  assert.deepEqual([...registeredHandlers.keys()], []);
  assert.equal(starterCalls, 0);
  assert.equal(installed.startupHandlers.snapshot().state, "idle");
  assert.deepEqual(await installed.shutdown("SIGINT"), result);
  assert.deepEqual(removedChannels, RUNTIME_IPC_CHANNELS);
  assert.equal(starterCalls, 0);
  assert.deepEqual(installed.unregister(), []);
});

test("shutdown unregisters handlers and stops a started runtime once", async () => {
  let starterCalls = 0;
  const registeredHandlers = new Map<
    RuntimeIpcChannel,
    CwMainIpcInvokeHandler
  >();
  const shutdownEvents: string[] = [];
  const stopSignals: Array<NodeJS.Signals | undefined> = [];
  const installed = installRuntimeIpcMainHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        registeredHandlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        assert.equal(registeredHandlers.delete(channel), true);
        shutdownEvents.push(`remove:${channel}`);
      },
    },
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => {
      starterCalls += 1;
      return createReadyStartupResult({
        stop: async (signal) => {
          shutdownEvents.push(`stop:${signal ?? "default"}`);
          stopSignals.push(signal);
          return true;
        },
      });
    },
  });

  const connectionInfoHandler = registeredHandlers.get(
    RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  );
  assert.ok(connectionInfoHandler);
  assert.deepEqual(await connectionInfoHandler({ sender: "renderer" }), {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });

  const result = await installed.shutdown("SIGINT");

  assert.deepEqual(result, {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: true,
  });
  assert.deepEqual(shutdownEvents, [
    "remove:cw:runtime:connection-info",
    "remove:cw:runtime:fetch",
    "remove:cw:runtime:startup-status",
    "stop:SIGINT",
    "remove:cw:runtime:shutdown-status",
  ]);
  assert.deepEqual(stopSignals, ["SIGINT"]);
  assert.deepEqual([...registeredHandlers.keys()], []);
  assert.equal(starterCalls, 1);
  assert.deepEqual(await installed.shutdown("SIGTERM"), result);
  assert.deepEqual(stopSignals, ["SIGINT"]);
  assert.deepEqual(installed.unregister(), []);
});

test("shutdown after manual unregister does not remove IPC handlers twice", async () => {
  let starterCalls = 0;
  const registeredHandlers = new Map<
    RuntimeIpcChannel,
    CwMainIpcInvokeHandler
  >();
  const shutdownEvents: string[] = [];
  const installed = installRuntimeIpcMainHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        registeredHandlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        assert.equal(registeredHandlers.delete(channel), true);
        shutdownEvents.push(`remove:${channel}`);
      },
    },
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => {
      starterCalls += 1;
      return createReadyStartupResult({
        stop: async (signal) => {
          shutdownEvents.push(`stop:${signal ?? "default"}`);
          return true;
        },
      });
    },
  });
  const connectionInfoHandler = registeredHandlers.get(
    RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  );
  assert.ok(connectionInfoHandler);
  assert.deepEqual(await connectionInfoHandler({ sender: "renderer" }), {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });

  assert.deepEqual(installed.unregister(), RUNTIME_IPC_CHANNELS);
  assert.deepEqual(shutdownEvents, [
    "remove:cw:runtime:connection-info",
    "remove:cw:runtime:fetch",
    "remove:cw:runtime:startup-status",
    "remove:cw:runtime:shutdown-status",
  ]);
  assert.deepEqual(await installed.shutdown("SIGTERM"), {
    unregisteredChannels: [],
    runtimeStopped: true,
  });
  assert.deepEqual(shutdownEvents, [
    "remove:cw:runtime:connection-info",
    "remove:cw:runtime:fetch",
    "remove:cw:runtime:startup-status",
    "remove:cw:runtime:shutdown-status",
    "stop:SIGTERM",
  ]);
  assert.equal(starterCalls, 1);
  assert.deepEqual(installed.unregister(), []);
});

test("composes main lifecycle shutdown history into IPC shutdown status", async () => {
  let starterCalls = 0;
  const app = createFakeMainApp();
  const window = createFakeMainWindow();
  const registeredHandlers = new Map<
    RuntimeIpcChannel,
    CwMainIpcInvokeHandler
  >();
  const shutdownEvents: string[] = [];
  let resolveStop: ((stopped: boolean) => void) | undefined;
  const stopPromise = new Promise<boolean>((resolve) => {
    resolveStop = resolve;
  });
  const installed = installRuntimeMainWithLifecycleShutdown({
    ipcMain: {
      handle: (channel, listener) => {
        registeredHandlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        assert.equal(registeredHandlers.delete(channel), true);
        shutdownEvents.push(`remove:${channel}`);
      },
    },
    app: app.app,
    window: window.window,
    signal: "SIGTERM",
    startup: {
      projectRoot: "C:/CW/project",
      command: { devCommand: "runtime" },
    },
    starter: async () => {
      starterCalls += 1;
      return createReadyStartupResult({
        stop: async (signal) => {
          shutdownEvents.push(`stop:${signal ?? "default"}`);
          return stopPromise;
        },
      });
    },
  });

  const shutdownStatusHandler = registeredHandlers.get(
    RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  );
  assert.ok(shutdownStatusHandler);
  const readShutdownStatusKinds = async (): Promise<readonly string[]> => {
    const statuses = (await shutdownStatusHandler({
      sender: "renderer",
    })) as RuntimeIpcShutdownStatusResponse;
    return statuses.map((status) => status.kind);
  };

  assert.deepEqual(await readShutdownStatusKinds(), ["registered"]);
  assert.deepEqual(
    installed.shutdownStatus().map((status) => status.kind),
    ["registered"],
  );
  assert.equal(starterCalls, 0);

  const connectionInfoHandler = registeredHandlers.get(
    RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  );
  assert.ok(connectionInfoHandler);
  assert.deepEqual(await connectionInfoHandler({ sender: "renderer" }), {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });
  assert.equal(starterCalls, 1);

  const appQuit = app.emitBeforeQuit();
  assert.equal(appQuit.prevented, true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(shutdownEvents, [
    "remove:cw:runtime:connection-info",
    "remove:cw:runtime:fetch",
    "remove:cw:runtime:startup-status",
    "stop:SIGTERM",
  ]);
  assert.equal(
    registeredHandlers.has(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL),
    true,
  );
  assert.deepEqual(await readShutdownStatusKinds(), [
    "registered",
    "app_quit_requested",
    "shutting_down",
  ]);

  const mutableShutdownStatuses = (await shutdownStatusHandler({
    sender: "renderer",
  })) as RuntimeIpcShutdownStatusResponse extends readonly (infer TStatus)[]
    ? TStatus[]
    : never;
  mutableShutdownStatuses.pop();
  assert.deepEqual(await readShutdownStatusKinds(), [
    "registered",
    "app_quit_requested",
    "shutting_down",
  ]);

  resolveStop?.(true);
  assert.deepEqual(await installed.lifecycle.shutdown(), {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: true,
  });
  assert.deepEqual(shutdownEvents, [
    "remove:cw:runtime:connection-info",
    "remove:cw:runtime:fetch",
    "remove:cw:runtime:startup-status",
    "stop:SIGTERM",
    "remove:cw:runtime:shutdown-status",
  ]);
  assert.equal(
    registeredHandlers.has(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL),
    false,
  );
  assert.deepEqual(
    installed.shutdownStatus().map((status) => status.kind),
    ["registered", "app_quit_requested", "shutting_down", "shutdown_complete"],
  );
});

test("app lifecycle shutdown prevents quit until runtime shutdown completes", async () => {
  const app = createFakeMainApp();
  const shutdownResult = {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: true,
  };
  let resolveShutdown: ((result: typeof shutdownResult) => void) | undefined;
  const shutdownPromise = new Promise<typeof shutdownResult>((resolve) => {
    resolveShutdown = resolve;
  });
  const shutdownSignals: Array<NodeJS.Signals | undefined> = [];
  const installed = installRuntimeAppLifecycleShutdown({
    app: app.app,
    signal: "SIGTERM",
    runtime: {
      shutdown: async (signal) => {
        shutdownSignals.push(signal);
        return shutdownPromise;
      },
    },
  });

  assert.deepEqual(installed.snapshot(), { state: "registered" });
  const firstQuit = app.emitBeforeQuit();

  assert.equal(firstQuit.prevented, true);
  assert.deepEqual(installed.snapshot(), { state: "shutting_down" });
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);
  assert.equal(app.quitCalls(), 0);

  const secondQuit = app.emitBeforeQuit();
  assert.equal(secondQuit.prevented, true);
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);

  resolveShutdown?.(shutdownResult);
  assert.deepEqual(await installed.shutdown(), shutdownResult);
  assert.deepEqual(installed.snapshot(), { state: "shutdown_complete" });
  assert.equal(app.quitCalls(), 1);

  const retryQuit = app.emitBeforeQuit();
  assert.equal(retryQuit.prevented, false);
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);
});

test("app lifecycle shutdown unregisters before quit without starting runtime", async () => {
  const app = createFakeMainApp();
  let shutdownCalls = 0;
  const installed = installRuntimeAppLifecycleShutdown({
    app: app.app,
    runtime: {
      shutdown: async () => {
        shutdownCalls += 1;
        return {
          unregisteredChannels: [],
          runtimeStopped: false,
        };
      },
    },
  });

  assert.equal(app.listenerCount(), 1);
  assert.equal(installed.unregister(), true);
  assert.deepEqual(installed.snapshot(), { state: "unregistered" });
  assert.equal(app.listenerCount(), 0);
  assert.equal(installed.unregister(), false);

  const quit = app.emitBeforeQuit();
  assert.equal(quit.prevented, false);
  assert.equal(shutdownCalls, 0);
  assert.equal(app.quitCalls(), 0);
  assert.equal(await installed.shutdown(), undefined);
});

test("app lifecycle shutdown retries quit after runtime shutdown failure", async () => {
  const app = createFakeMainApp();
  const installed = installRuntimeAppLifecycleShutdown({
    app: app.app,
    runtime: {
      shutdown: async () => {
        throw new Error("runtime shutdown failed");
      },
    },
  });

  const quit = app.emitBeforeQuit();

  assert.equal(quit.prevented, true);
  await assert.rejects(installed.shutdown(), /runtime shutdown failed/u);
  assert.deepEqual(installed.snapshot(), {
    state: "failed",
    reason: "runtime shutdown failed",
  });
  assert.equal(app.quitCalls(), 1);

  const retryQuit = app.emitBeforeQuit();
  assert.equal(retryQuit.prevented, false);
});

test("window lifecycle shutdown prevents close until runtime shutdown completes", async () => {
  const window = createFakeMainWindow();
  const shutdownResult = {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: true,
  };
  let resolveShutdown: ((result: typeof shutdownResult) => void) | undefined;
  const shutdownPromise = new Promise<typeof shutdownResult>((resolve) => {
    resolveShutdown = resolve;
  });
  const shutdownSignals: Array<NodeJS.Signals | undefined> = [];
  const installed = installRuntimeWindowLifecycleShutdown({
    window: window.window,
    signal: "SIGTERM",
    runtime: {
      shutdown: async (signal) => {
        shutdownSignals.push(signal);
        return shutdownPromise;
      },
    },
  });

  assert.deepEqual(installed.snapshot(), { state: "registered" });
  const firstClose = window.emitClose();

  assert.equal(firstClose.prevented, true);
  assert.deepEqual(installed.snapshot(), { state: "shutting_down" });
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);
  assert.equal(window.closeCalls(), 0);

  const secondClose = window.emitClose();
  assert.equal(secondClose.prevented, true);
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);

  resolveShutdown?.(shutdownResult);
  assert.deepEqual(await installed.shutdown(), shutdownResult);
  assert.deepEqual(installed.snapshot(), { state: "shutdown_complete" });
  assert.equal(window.closeCalls(), 1);

  const retryClose = window.emitClose();
  assert.equal(retryClose.prevented, false);
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);
});

test("window lifecycle shutdown unregisters before close without starting runtime", async () => {
  const window = createFakeMainWindow();
  let shutdownCalls = 0;
  const installed = installRuntimeWindowLifecycleShutdown({
    window: window.window,
    runtime: {
      shutdown: async () => {
        shutdownCalls += 1;
        return {
          unregisteredChannels: [],
          runtimeStopped: false,
        };
      },
    },
  });

  assert.equal(window.listenerCount(), 1);
  assert.equal(installed.unregister(), true);
  assert.deepEqual(installed.snapshot(), { state: "unregistered" });
  assert.equal(window.listenerCount(), 0);
  assert.equal(installed.unregister(), false);

  const close = window.emitClose();
  assert.equal(close.prevented, false);
  assert.equal(shutdownCalls, 0);
  assert.equal(window.closeCalls(), 0);
  assert.equal(await installed.shutdown(), undefined);
});

test("window lifecycle shutdown retries close after runtime shutdown failure", async () => {
  const window = createFakeMainWindow();
  const installed = installRuntimeWindowLifecycleShutdown({
    window: window.window,
    runtime: {
      shutdown: async () => {
        throw new Error("runtime shutdown failed");
      },
    },
  });

  const close = window.emitClose();

  assert.equal(close.prevented, true);
  await assert.rejects(installed.shutdown(), /runtime shutdown failed/u);
  assert.deepEqual(installed.snapshot(), {
    state: "failed",
    reason: "runtime shutdown failed",
  });
  assert.equal(window.closeCalls(), 1);

  const retryClose = window.emitClose();
  assert.equal(retryClose.prevented, false);
});

test("main lifecycle shutdown shares runtime shutdown across app and window events", async () => {
  const app = createFakeMainApp();
  const window = createFakeMainWindow();
  const shutdownResult = {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: true,
  };
  let resolveShutdown: ((result: typeof shutdownResult) => void) | undefined;
  const shutdownPromise = new Promise<typeof shutdownResult>((resolve) => {
    resolveShutdown = resolve;
  });
  const shutdownSignals: Array<NodeJS.Signals | undefined> = [];
  const installed = installRuntimeMainLifecycleShutdown({
    app: app.app,
    window: window.window,
    signal: "SIGTERM",
    runtime: {
      shutdown: async (signal) => {
        shutdownSignals.push(signal);
        return shutdownPromise;
      },
    },
  });

  assert.deepEqual(installed.snapshot(), { state: "registered" });
  const appQuit = app.emitBeforeQuit();
  const windowClose = window.emitClose();

  assert.equal(appQuit.prevented, true);
  assert.equal(windowClose.prevented, true);
  assert.deepEqual(installed.snapshot(), { state: "shutting_down" });
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);
  assert.equal(app.quitCalls(), 0);
  assert.equal(window.closeCalls(), 0);

  resolveShutdown?.(shutdownResult);
  assert.deepEqual(await installed.shutdown(), shutdownResult);
  assert.deepEqual(installed.snapshot(), { state: "shutdown_complete" });
  assert.equal(app.quitCalls(), 1);
  assert.equal(window.closeCalls(), 1);

  const retryAppQuit = app.emitBeforeQuit();
  const retryWindowClose = window.emitClose();
  assert.equal(retryAppQuit.prevented, false);
  assert.equal(retryWindowClose.prevented, false);
  assert.deepEqual(shutdownSignals, ["SIGTERM"]);
});

test("main lifecycle shutdown reports status history for app and window requests", async () => {
  const app = createFakeMainApp();
  const window = createFakeMainWindow();
  const statuses: RuntimeMainLifecycleShutdownStatus[] = [];
  const shutdownResult = {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: true,
  };
  let resolveShutdown: ((result: typeof shutdownResult) => void) | undefined;
  const shutdownPromise = new Promise<typeof shutdownResult>((resolve) => {
    resolveShutdown = resolve;
  });
  const installed = installRuntimeMainLifecycleShutdown({
    app: app.app,
    window: window.window,
    runtime: {
      shutdown: async () => shutdownPromise,
    },
    onStatus: (status) => {
      statuses.push(status);
    },
  });

  assert.deepEqual(
    statuses.map((status) => status.kind),
    ["registered"],
  );
  assert.notEqual(installed.statusHistory(), installed.statusHistory());
  assert.deepEqual(installed.statusHistory(), statuses);

  const appQuit = app.emitBeforeQuit();
  assert.equal(appQuit.prevented, true);
  assert.deepEqual(
    statuses.map((status) => status.kind),
    ["registered", "app_quit_requested", "shutting_down"],
  );
  assert.deepEqual(statuses.at(-1), {
    kind: "shutting_down",
    state: "shutting_down",
    severity: "info",
    lifecycleComplete: false,
    retryable: false,
    appQuitRequested: true,
    windowCloseRequested: false,
  });

  const windowClose = window.emitClose();
  assert.equal(windowClose.prevented, true);
  assert.deepEqual(
    statuses.map((status) => status.kind),
    [
      "registered",
      "app_quit_requested",
      "shutting_down",
      "window_close_requested",
    ],
  );
  assert.deepEqual(statuses.at(-1), {
    kind: "window_close_requested",
    state: "shutting_down",
    severity: "info",
    lifecycleComplete: false,
    retryable: false,
    appQuitRequested: true,
    windowCloseRequested: true,
  });

  resolveShutdown?.(shutdownResult);
  assert.deepEqual(await installed.shutdown(), shutdownResult);
  assert.deepEqual(statuses.at(-1), {
    kind: "shutdown_complete",
    state: "shutdown_complete",
    severity: "info",
    lifecycleComplete: true,
    retryable: false,
    appQuitRequested: true,
    windowCloseRequested: true,
  });
  assert.deepEqual(
    installed.statusHistory().map((status) => status.kind),
    [
      "registered",
      "app_quit_requested",
      "shutting_down",
      "window_close_requested",
      "shutdown_complete",
    ],
  );

  const retryAppQuit = app.emitBeforeQuit();
  const retryWindowClose = window.emitClose();
  assert.equal(retryAppQuit.prevented, false);
  assert.equal(retryWindowClose.prevented, false);
  assert.equal(statuses.length, 5);
});

test("main lifecycle shutdown unregisters app and window without starting runtime", async () => {
  const app = createFakeMainApp();
  const window = createFakeMainWindow();
  const statuses: RuntimeMainLifecycleShutdownStatus[] = [];
  let shutdownCalls = 0;
  const installed = installRuntimeMainLifecycleShutdown({
    app: app.app,
    window: window.window,
    runtime: {
      shutdown: async () => {
        shutdownCalls += 1;
        return {
          unregisteredChannels: [],
          runtimeStopped: false,
        };
      },
    },
    onStatus: (status) => {
      statuses.push(status);
    },
  });

  assert.equal(app.listenerCount(), 1);
  assert.equal(window.listenerCount(), 1);
  assert.deepEqual(installed.unregister(), { app: true, window: true });
  assert.deepEqual(installed.snapshot(), { state: "unregistered" });
  assert.equal(app.listenerCount(), 0);
  assert.equal(window.listenerCount(), 0);
  assert.deepEqual(installed.unregister(), { app: false, window: false });
  assert.deepEqual(statuses.at(-1), {
    kind: "unregistered",
    state: "unregistered",
    severity: "warning",
    lifecycleComplete: true,
    retryable: false,
    appQuitRequested: false,
    windowCloseRequested: false,
  });
  assert.deepEqual(
    installed.statusHistory().map((status) => status.kind),
    ["registered", "unregistered"],
  );

  const appQuit = app.emitBeforeQuit();
  const windowClose = window.emitClose();
  assert.equal(appQuit.prevented, false);
  assert.equal(windowClose.prevented, false);
  assert.equal(shutdownCalls, 0);
  assert.equal(app.quitCalls(), 0);
  assert.equal(window.closeCalls(), 0);
  assert.equal(await installed.shutdown(), undefined);
});

test("main lifecycle shutdown status observer failures do not block shutdown", async () => {
  const app = createFakeMainApp();
  const window = createFakeMainWindow();
  let observerCalls = 0;
  const installed = installRuntimeMainLifecycleShutdown({
    app: app.app,
    window: window.window,
    runtime: {
      shutdown: async () => ({
        unregisteredChannels: RUNTIME_IPC_CHANNELS,
        runtimeStopped: true,
      }),
    },
    onStatus: () => {
      observerCalls += 1;
      throw new Error("status observer failed");
    },
  });

  const appQuit = app.emitBeforeQuit();
  assert.equal(appQuit.prevented, true);
  assert.deepEqual(await installed.shutdown(), {
    unregisteredChannels: RUNTIME_IPC_CHANNELS,
    runtimeStopped: true,
  });
  assert.deepEqual(installed.snapshot(), { state: "shutdown_complete" });
  assert.equal(app.quitCalls(), 1);
  assert.deepEqual(
    installed.statusHistory().map((status) => status.kind),
    ["registered", "app_quit_requested", "shutting_down", "shutdown_complete"],
  );
  assert.equal(observerCalls, 4);
});

test("main lifecycle shutdown retries requested exits after runtime shutdown failure", async () => {
  const app = createFakeMainApp();
  const window = createFakeMainWindow();
  let shutdownCalls = 0;
  const installed = installRuntimeMainLifecycleShutdown({
    app: app.app,
    window: window.window,
    runtime: {
      shutdown: async () => {
        shutdownCalls += 1;
        throw new Error("runtime shutdown failed");
      },
    },
  });

  const windowClose = window.emitClose();
  const appQuit = app.emitBeforeQuit();

  assert.equal(windowClose.prevented, true);
  assert.equal(appQuit.prevented, true);
  await assert.rejects(installed.shutdown(), /runtime shutdown failed/u);
  assert.deepEqual(installed.snapshot(), {
    state: "failed",
    reason: "runtime shutdown failed",
  });
  assert.deepEqual(installed.statusHistory().at(-1), {
    kind: "shutdown_failed",
    state: "failed",
    severity: "error",
    lifecycleComplete: true,
    retryable: true,
    appQuitRequested: true,
    windowCloseRequested: true,
    reason: "runtime shutdown failed",
  });
  assert.equal(shutdownCalls, 1);
  assert.equal(app.quitCalls(), 1);
  assert.equal(window.closeCalls(), 1);

  const retryAppQuit = app.emitBeforeQuit();
  const retryWindowClose = window.emitClose();
  assert.equal(retryAppQuit.prevented, false);
  assert.equal(retryWindowClose.prevented, false);
});

function createReadyStartupResult(options?: {
  readonly fetchImpl?: typeof fetch;
  readonly stop?: (signal?: NodeJS.Signals) => Promise<boolean>;
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
      stop: options?.stop ?? (async () => true),
    },
    handlers,
    closed: Promise.resolve(),
    stop: options?.stop ?? (async () => true),
  };
}

function createFakeMainApp(): {
  readonly app: CwMainApp;
  readonly emitBeforeQuit: () => { readonly prevented: boolean };
  readonly listenerCount: () => number;
  readonly quitCalls: () => number;
} {
  const listeners = new Set<CwMainBeforeQuitListener>();
  let quitCalls = 0;

  return {
    app: {
      on: (event, listener) => {
        assert.equal(event, "before-quit");
        listeners.add(listener);
      },
      off: (event, listener) => {
        assert.equal(event, "before-quit");
        listeners.delete(listener);
      },
      quit: () => {
        quitCalls += 1;
      },
    },
    emitBeforeQuit: () => {
      let prevented = false;
      const event: CwMainBeforeQuitEvent = {
        preventDefault: () => {
          prevented = true;
        },
      };
      for (const listener of [...listeners]) {
        listener(event);
      }
      return { prevented };
    },
    listenerCount: () => listeners.size,
    quitCalls: () => quitCalls,
  };
}

function createFakeMainWindow(): {
  readonly window: CwMainWindow;
  readonly emitClose: () => { readonly prevented: boolean };
  readonly listenerCount: () => number;
  readonly closeCalls: () => number;
} {
  const listeners = new Set<CwMainWindowCloseListener>();
  let closeCalls = 0;

  return {
    window: {
      on: (event, listener) => {
        assert.equal(event, "close");
        listeners.add(listener);
      },
      off: (event, listener) => {
        assert.equal(event, "close");
        listeners.delete(listener);
      },
      close: () => {
        closeCalls += 1;
      },
    },
    emitClose: () => {
      let prevented = false;
      const event: CwMainWindowCloseEvent = {
        preventDefault: () => {
          prevented = true;
        },
      };
      for (const listener of [...listeners]) {
        listener(event);
      }
      return { prevented };
    },
    listenerCount: () => listeners.size,
    closeCalls: () => closeCalls,
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
