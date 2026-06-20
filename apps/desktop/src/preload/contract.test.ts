import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  type RuntimeIpcChannel,
  type RuntimeIpcShutdownStatus,
  type RuntimeIpcShutdownStatusResponse,
  type RuntimeIpcStartupStatus,
  type RuntimeIpcStartupStatusResponse,
} from "../shared/runtime-ipc.js";
import {
  assertRuntimeRequestPath,
  buildRuntimeRequestHeaders,
  type CwDesktopApi,
  type RuntimeRequestInit,
} from "./contract.js";
import { CW_PRELOAD_API_KEY, createCwDesktopApi } from "./api.js";
import {
  installCwPreloadApi,
  type CwPreloadIpcRendererEventListener,
} from "./bootstrap.js";
import {
  createRuntimePreloadBridge,
  type RuntimePreloadIpcPayloadListener,
  type RuntimePreloadIpcSubscribe,
} from "./runtime-bridge.js";
import {
  bindRuntimeShutdownStatusStoreToPageLifecycle,
  createRuntimeShutdownStatusStore,
  type RuntimeShutdownStatusPageLifecycleEvent,
  type RuntimeShutdownStatusPageLifecycleListener,
} from "../renderer/shutdown-status-client.js";

test("accepts only relative runtime API paths", () => {
  assert.doesNotThrow(() => assertRuntimeRequestPath("/system/info"));
  assert.doesNotThrow(() => assertRuntimeRequestPath("/runs/run_123/stream"));
  assert.throws(
    () => assertRuntimeRequestPath("system/info"),
    /absolute API path/u,
  );
  assert.throws(
    () => assertRuntimeRequestPath("//evil.test/system/info"),
    /absolute API path/u,
  );
  assert.throws(
    () => assertRuntimeRequestPath("http://127.0.0.1:8080/cw/v1/system/info"),
    /absolute API path/u,
  );
  assert.throws(
    () => assertRuntimeRequestPath("/../secure/secrets"),
    /absolute API path/u,
  );
});

test("injects runtime auth and client headers", () => {
  assert.deepEqual(
    buildRuntimeRequestHeaders({
      token: "token_abc123",
      projectId: "prj_123",
      idempotencyKey: "7a94974e-7c24-4ddb-884b-7a07acfcf0ca",
      extraHeaders: { Accept: "application/json" },
    }),
    {
      Authorization: "Bearer token_abc123",
      "X-Cw-Client": "electron-renderer",
      "X-Project-Id": "prj_123",
      "Idempotency-Key": "7a94974e-7c24-4ddb-884b-7a07acfcf0ca",
      Accept: "application/json",
    },
  );
});

test("rejects header injection and reserved runtime headers", () => {
  assert.throws(
    () => buildRuntimeRequestHeaders({ token: "token\nabc" }),
    /Authorization token/u,
  );
  assert.throws(
    () => buildRuntimeRequestHeaders({ token: "token abc" }),
    /Authorization token/u,
  );
  assert.throws(
    () => buildRuntimeRequestHeaders({ token: "token", projectId: "prj\r123" }),
    /X-Project-Id/u,
  );
  assert.throws(
    () =>
      buildRuntimeRequestHeaders({
        token: "token",
        extraHeaders: { Authorization: "Bearer attacker" },
      }),
    /reserved/u,
  );
  assert.throws(
    () =>
      buildRuntimeRequestHeaders({
        token: "token",
        extraHeaders: { "X-Cw-Client": "external-mcp" },
      }),
    /reserved/u,
  );
});

test("builds a preload runtime bridge over injected IPC invoke", async () => {
  const calls: Array<{
    readonly channel: RuntimeIpcChannel;
    readonly payload?: unknown;
  }> = [];
  const waitingStatus: RuntimeIpcStartupStatus = {
    kind: "waiting_for_existing",
    action: "wait_for_existing",
    attempt: 1,
    lockStatus: "active",
    severity: "info",
    message: "Waiting for existing runtime sidecar.",
    lifecycleComplete: false,
    userActionRequired: false,
    retryable: false,
  };
  const statuses: RuntimeIpcStartupStatusResponse = [waitingStatus];
  const shuttingDownStatus: RuntimeIpcShutdownStatus = {
    kind: "shutting_down",
    state: "shutting_down",
    severity: "info",
    lifecycleComplete: false,
    retryable: false,
    appQuitRequested: true,
    windowCloseRequested: false,
  };
  const shutdownStatuses: RuntimeIpcShutdownStatusResponse = [
    shuttingDownStatus,
  ];
  const bridge = createRuntimePreloadBridge({
    invoke: async <TResult>(
      channel: RuntimeIpcChannel,
      payload?: unknown,
    ): Promise<TResult> => {
      calls.push(payload === undefined ? { channel } : { channel, payload });
      switch (channel) {
        case RUNTIME_IPC_STARTUP_STATUS_CHANNEL:
          return statuses as TResult;
        case RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL:
          return shutdownStatuses as TResult;
        case RUNTIME_IPC_CONNECTION_INFO_CHANNEL:
          return {
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_abc123",
          } as TResult;
        case RUNTIME_IPC_FETCH_CHANNEL:
          return {
            ok: true,
            status: 200,
            headers: { "content-type": "application/json" },
            body: { ok: true },
          } as TResult;
      }
    },
    subscribe: createNoopSubscribe(),
  });

  assert.deepEqual(await bridge.startupStatus(), statuses);
  const mutableStatuses =
    (await bridge.startupStatus()) as RuntimeIpcStartupStatusResponse extends readonly (infer TStatus)[]
      ? TStatus[]
      : never;
  mutableStatuses[0] = { ...waitingStatus, message: "mutated" };
  assert.deepEqual(await bridge.startupStatus(), statuses);
  assert.deepEqual(await bridge.shutdownStatus(), shutdownStatuses);
  const mutableShutdownStatuses =
    (await bridge.shutdownStatus()) as RuntimeIpcShutdownStatusResponse extends readonly (infer TStatus)[]
      ? TStatus[]
      : never;
  mutableShutdownStatuses[0] = {
    ...shuttingDownStatus,
    kind: "shutdown_complete",
    state: "shutdown_complete",
  };
  assert.deepEqual(await bridge.shutdownStatus(), shutdownStatuses);
  assert.deepEqual(await bridge.connectionInfo(), {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });
  assert.deepEqual(
    await bridge.fetch<{ ok: boolean }>("/system/info", {
      method: "GET",
      projectId: "prj_123",
      headers: { Accept: "application/json" },
    }),
    {
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    },
  );

  assert.deepEqual(calls, [
    { channel: RUNTIME_IPC_STARTUP_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_STARTUP_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_STARTUP_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_CONNECTION_INFO_CHANNEL },
    {
      channel: RUNTIME_IPC_FETCH_CHANNEL,
      payload: {
        path: "/system/info",
        init: {
          method: "GET",
          projectId: "prj_123",
          headers: { Accept: "application/json" },
        },
      },
    },
  ]);
});

test("preload runtime bridge subscribes to shutdown status events", () => {
  const ipc = createFakeRuntimePreloadSubscribe();
  const shuttingDownStatus: RuntimeIpcShutdownStatus = {
    kind: "shutting_down",
    state: "shutting_down",
    severity: "info",
    lifecycleComplete: false,
    retryable: false,
    appQuitRequested: true,
    windowCloseRequested: false,
  };
  const bridge = createRuntimePreloadBridge({
    invoke: async () => {
      throw new Error("invoke should not be called");
    },
    subscribe: ipc.subscribe,
  });
  const firstKinds: Array<RuntimeIpcShutdownStatus["kind"] | undefined> = [];
  const secondKinds: Array<RuntimeIpcShutdownStatus["kind"] | undefined> = [];
  const unsubscribeFirst = bridge.onShutdownStatus((statuses) => {
    firstKinds.push(statuses[0]?.kind);
    const mutableStatuses =
      statuses as RuntimeIpcShutdownStatusResponse extends readonly (infer TStatus)[]
        ? TStatus[]
        : never;
    const [status] = mutableStatuses;
    assert.ok(status);
    mutableStatuses[0] = {
      ...status,
      kind: "shutdown_failed",
      state: "failed",
    };
  });
  bridge.onShutdownStatus(() => {
    throw new Error("renderer listener failed");
  });
  const unsubscribeSecond = bridge.onShutdownStatus((statuses) => {
    secondKinds.push(statuses[0]?.kind);
  });

  assert.equal(ipc.listenerCount(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL), 3);
  assert.doesNotThrow(() =>
    ipc.emit(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL, [shuttingDownStatus]),
  );
  assert.deepEqual(firstKinds, ["shutting_down"]);
  assert.deepEqual(secondKinds, ["shutting_down"]);
  assert.deepEqual(ipc.lastPayload(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL), [
    shuttingDownStatus,
  ]);

  ipc.emit(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL, { invalid: true });
  assert.deepEqual(firstKinds, ["shutting_down", undefined]);
  assert.deepEqual(secondKinds, ["shutting_down", undefined]);
  assert.equal(unsubscribeFirst(), true);
  assert.equal(unsubscribeFirst(), false);
  assert.equal(unsubscribeSecond(), true);
  assert.equal(ipc.listenerCount(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL), 1);
});

test("preload runtime bridge validates fetch payloads before invoke", async () => {
  const calls: RuntimeIpcChannel[] = [];
  const bridge = createRuntimePreloadBridge({
    invoke: async <TResult>(channel: RuntimeIpcChannel): Promise<TResult> => {
      calls.push(channel);
      throw new Error("invoke should not be called");
    },
    subscribe: createNoopSubscribe(),
  });

  await assert.rejects(
    bridge.fetch("system/info" as "/system/info"),
    /absolute API path/u,
  );
  await assert.rejects(
    bridge.fetch("/system/info", {
      headers: { Authorization: "Bearer attacker" },
    }),
    /reserved/u,
  );
  await assert.rejects(
    bridge.fetch("/system/info", "bad-init" as RuntimeRequestInit),
    /init must be an object/u,
  );
  await assert.rejects(
    bridge.fetch("/system/info", {
      method: 42,
    } as unknown as RuntimeRequestInit),
    /method must be a string/u,
  );
  assert.deepEqual(calls, []);
});

test("builds a frozen cw desktop API over injected IPC invoke", async () => {
  const calls: Array<{
    readonly channel: RuntimeIpcChannel;
    readonly payload?: unknown;
  }> = [];
  const waitingStatus: RuntimeIpcStartupStatus = {
    kind: "waiting_for_existing",
    action: "wait_for_existing",
    attempt: 1,
    lockStatus: "active",
    severity: "info",
    message: "Waiting for existing runtime sidecar.",
    lifecycleComplete: false,
    userActionRequired: false,
    retryable: false,
  };
  const statuses: RuntimeIpcStartupStatusResponse = [waitingStatus];
  const shutdownStatuses: RuntimeIpcShutdownStatusResponse = [
    {
      kind: "shutdown_complete",
      state: "shutdown_complete",
      severity: "info",
      lifecycleComplete: true,
      retryable: false,
      appQuitRequested: true,
      windowCloseRequested: true,
    },
  ];
  const api = createCwDesktopApi({
    invoke: async <TResult>(
      channel: RuntimeIpcChannel,
      payload?: unknown,
    ): Promise<TResult> => {
      calls.push(payload === undefined ? { channel } : { channel, payload });
      switch (channel) {
        case RUNTIME_IPC_STARTUP_STATUS_CHANNEL:
          return statuses as TResult;
        case RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL:
          return shutdownStatuses as TResult;
        case RUNTIME_IPC_CONNECTION_INFO_CHANNEL:
          return {
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_abc123",
          } as TResult;
        case RUNTIME_IPC_FETCH_CHANNEL:
          return {
            ok: true,
            status: 200,
            headers: { "content-type": "application/json" },
            body: { ok: true },
          } as TResult;
      }
    },
    subscribe: createNoopSubscribe(),
  });

  assert.equal(CW_PRELOAD_API_KEY, "cw");
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.runtime), true);
  assert.equal(typeof api.runtime.onShutdownStatus, "function");
  assert.deepEqual(await api.runtime.startupStatus(), statuses);
  assert.deepEqual(await api.runtime.shutdownStatus(), shutdownStatuses);
  assert.deepEqual(await api.runtime.connectionInfo(), {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });
  assert.deepEqual(
    await api.runtime.fetch<{ ok: boolean }>("/system/info", {
      method: "GET",
      projectId: "prj_123",
      headers: { Accept: "application/json" },
    }),
    {
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    },
  );
  await assert.rejects(
    api.runtime.fetch("/system/info", "bad-init" as RuntimeRequestInit),
    /init must be an object/u,
  );

  assert.deepEqual(calls, [
    { channel: RUNTIME_IPC_STARTUP_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_CONNECTION_INFO_CHANNEL },
    {
      channel: RUNTIME_IPC_FETCH_CHANNEL,
      payload: {
        path: "/system/info",
        init: {
          method: "GET",
          projectId: "prj_123",
          headers: { Accept: "application/json" },
        },
      },
    },
  ]);
});

test("installs the cw preload API through injected Electron-like bridges", async () => {
  const exposures: Array<{
    readonly apiKey: string;
    readonly api: CwDesktopApi;
  }> = [];
  const ipcCalls: Array<{
    readonly channel: RuntimeIpcChannel;
    readonly payload?: unknown;
  }> = [];
  const liveStatusPayloads: Array<readonly RuntimeIpcShutdownStatus[]> = [];
  const ipcListeners = new Map<
    RuntimeIpcChannel,
    CwPreloadIpcRendererEventListener
  >();
  const waitingStatus: RuntimeIpcStartupStatus = {
    kind: "waiting_for_existing",
    action: "wait_for_existing",
    attempt: 1,
    lockStatus: "active",
    severity: "info",
    message: "Waiting for existing runtime sidecar.",
    lifecycleComplete: false,
    userActionRequired: false,
    retryable: false,
  };
  const statuses: RuntimeIpcStartupStatusResponse = [waitingStatus];
  const shutdownStatuses: RuntimeIpcShutdownStatusResponse = [
    {
      kind: "shutdown_failed",
      state: "failed",
      severity: "error",
      lifecycleComplete: true,
      retryable: true,
      appQuitRequested: true,
      windowCloseRequested: false,
      reason: "runtime shutdown failed",
    },
  ];
  const api = installCwPreloadApi({
    contextBridge: {
      exposeInMainWorld: (apiKey: string, apiValue: CwDesktopApi) => {
        exposures.push({ apiKey, api: apiValue });
      },
    },
    ipcRenderer: {
      invoke: async (
        channel: RuntimeIpcChannel,
        payload?: unknown,
      ): Promise<unknown> => {
        ipcCalls.push(
          payload === undefined ? { channel } : { channel, payload },
        );
        switch (channel) {
          case RUNTIME_IPC_STARTUP_STATUS_CHANNEL:
            return statuses;
          case RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL:
            return shutdownStatuses;
          case RUNTIME_IPC_CONNECTION_INFO_CHANNEL:
            return {
              base_url: "http://127.0.0.1:51234/cw/v1",
              token: "token_abc123",
            };
          case RUNTIME_IPC_FETCH_CHANNEL:
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "application/json" },
              body: { ok: true },
            };
        }
      },
      on: (
        channel: RuntimeIpcChannel,
        listener: CwPreloadIpcRendererEventListener,
      ) => {
        ipcListeners.set(channel, listener);
      },
      off: (
        channel: RuntimeIpcChannel,
        listener: CwPreloadIpcRendererEventListener,
      ) => {
        if (ipcListeners.get(channel) === listener) {
          ipcListeners.delete(channel);
        }
      },
    },
  });

  assert.equal(ipcCalls.length, 0);
  assert.equal(exposures.length, 1);
  const [exposure] = exposures;
  assert.ok(exposure);
  assert.equal(exposure.apiKey, CW_PRELOAD_API_KEY);
  assert.equal(exposure.api, api);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.runtime), true);
  const unsubscribeShutdownStatus = api.runtime.onShutdownStatus(
    (liveStatuses) => {
      liveStatusPayloads.push(liveStatuses);
    },
  );
  ipcListeners.get(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL)?.(
    { sender: "main" },
    shutdownStatuses,
  );
  assert.equal(unsubscribeShutdownStatus(), true);
  assert.equal(unsubscribeShutdownStatus(), false);
  assert.equal(ipcListeners.has(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL), false);
  assert.deepEqual(liveStatusPayloads, [shutdownStatuses]);

  assert.deepEqual(await api.runtime.startupStatus(), statuses);
  assert.deepEqual(await api.runtime.shutdownStatus(), shutdownStatuses);
  assert.deepEqual(await api.runtime.connectionInfo(), {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });
  assert.deepEqual(
    await api.runtime.fetch<{ ok: boolean }>("/system/info", {
      method: "GET",
      projectId: "prj_123",
      headers: { Accept: "application/json" },
    }),
    {
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    },
  );
  await assert.rejects(
    api.runtime.fetch("/system/info", "bad-init" as RuntimeRequestInit),
    /init must be an object/u,
  );

  assert.deepEqual(ipcCalls, [
    { channel: RUNTIME_IPC_STARTUP_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL },
    { channel: RUNTIME_IPC_CONNECTION_INFO_CHANNEL },
    {
      channel: RUNTIME_IPC_FETCH_CHANNEL,
      payload: {
        path: "/system/info",
        init: {
          method: "GET",
          projectId: "prj_123",
          headers: { Accept: "application/json" },
        },
      },
    },
  ]);
});

test("renderer shutdown status store refreshes and appends live updates", async () => {
  const errors: unknown[] = [];
  const firstObservedKinds: Array<RuntimeIpcShutdownStatus["kind"]> = [];
  const secondObservedKinds: Array<RuntimeIpcShutdownStatus["kind"]> = [];
  let liveListener:
    | ((statuses: readonly RuntimeIpcShutdownStatus[]) => void)
    | undefined;
  let shutdownStatusSnapshot: readonly RuntimeIpcShutdownStatus[] = [
    createShutdownStatus("registered"),
  ];
  const store = createRuntimeShutdownStatusStore({
    runtime: {
      shutdownStatus: async () => shutdownStatusSnapshot,
      onShutdownStatus: (listener) => {
        liveListener = listener;
        let subscribed = true;
        return () => {
          if (!subscribed) {
            return false;
          }
          subscribed = false;
          liveListener = undefined;
          return true;
        };
      },
    },
    onError: (error) => {
      errors.push(error);
    },
  });

  const unsubscribeFirst = store.subscribe((statuses) => {
    const [status] = statuses;
    assert.ok(status);
    firstObservedKinds.push(status.kind);
    const mutableStatuses = statuses as RuntimeIpcShutdownStatus[];
    mutableStatuses[0] = createShutdownStatus("shutdown_failed");
  });
  store.subscribe(() => {
    throw new Error("listener failed");
  });
  const unsubscribeSecond = store.subscribe((statuses) => {
    const [status] = statuses;
    assert.ok(status);
    secondObservedKinds.push(status.kind);
  });

  assert.equal(store.isStarted(), false);
  assert.equal(store.start(), true);
  assert.equal(store.start(), false);
  assert.equal(store.isStarted(), true);
  assert.deepEqual(await store.refresh(), [createShutdownStatus("registered")]);
  assert.deepEqual(firstObservedKinds, ["registered"]);
  assert.deepEqual(secondObservedKinds, ["registered"]);
  assert.equal(errors.length, 1);

  liveListener?.([createShutdownStatus("shutting_down")]);
  assert.deepEqual(store.snapshot(), [
    createShutdownStatus("registered"),
    createShutdownStatus("shutting_down"),
  ]);
  assert.deepEqual(firstObservedKinds, ["registered", "registered"]);
  assert.deepEqual(secondObservedKinds, ["registered", "registered"]);
  assert.equal(errors.length, 2);

  shutdownStatusSnapshot = [createShutdownStatus("shutdown_complete")];
  assert.deepEqual(await store.refresh(), [
    createShutdownStatus("shutdown_complete"),
  ]);
  assert.equal(unsubscribeFirst(), true);
  assert.equal(unsubscribeFirst(), false);
  assert.equal(unsubscribeSecond(), true);
  assert.equal(store.listenerCount(), 1);
  assert.equal(store.stop(), true);
  assert.equal(store.stop(), false);
  assert.equal(store.isStarted(), false);
});

test("renderer shutdown status store ignores stale refresh after live update", async () => {
  let liveListener:
    | ((statuses: readonly RuntimeIpcShutdownStatus[]) => void)
    | undefined;
  let resolveShutdownStatus:
    | ((statuses: readonly RuntimeIpcShutdownStatus[]) => void)
    | undefined;
  const store = createRuntimeShutdownStatusStore({
    runtime: {
      shutdownStatus: async () =>
        new Promise<readonly RuntimeIpcShutdownStatus[]>((resolve) => {
          resolveShutdownStatus = resolve;
        }),
      onShutdownStatus: (listener) => {
        liveListener = listener;
        return () => true;
      },
    },
  });

  assert.equal(store.start(), true);
  const refreshPromise = store.refresh();
  liveListener?.([createShutdownStatus("shutting_down")]);
  resolveShutdownStatus?.([createShutdownStatus("registered")]);

  assert.deepEqual(await refreshPromise, [
    createShutdownStatus("shutting_down"),
  ]);
  assert.deepEqual(store.snapshot(), [createShutdownStatus("shutting_down")]);
});

test("renderer shutdown status page lifecycle binding stops and disposes once", () => {
  const events = new Map<
    RuntimeShutdownStatusPageLifecycleEvent,
    RuntimeShutdownStatusPageLifecycleListener
  >();
  let stopCalls = 0;
  const dispose = bindRuntimeShutdownStatusStoreToPageLifecycle(
    {
      stop: () => {
        stopCalls += 1;
        return stopCalls === 1;
      },
    },
    {
      addEventListener: (type, listener) => {
        events.set(type, listener);
      },
      removeEventListener: (type, listener) => {
        if (events.get(type) === listener) {
          events.delete(type);
        }
      },
    },
    { eventType: "pagehide" },
  );

  events.get("pagehide")?.();
  assert.equal(stopCalls, 1);
  assert.equal(events.has("pagehide"), true);
  assert.equal(dispose(), true);
  assert.equal(stopCalls, 1);
  assert.equal(events.has("pagehide"), false);
  assert.equal(dispose(), false);
  assert.equal(stopCalls, 1);
});

function createNoopSubscribe(): RuntimePreloadIpcSubscribe {
  return () => () => false;
}

function createShutdownStatus(
  kind: RuntimeIpcShutdownStatus["kind"],
): RuntimeIpcShutdownStatus {
  switch (kind) {
    case "registered":
      return {
        kind,
        state: "registered",
        severity: "info",
        lifecycleComplete: false,
        retryable: false,
        appQuitRequested: false,
        windowCloseRequested: false,
      };
    case "app_quit_requested":
      return {
        kind,
        state: "shutting_down",
        severity: "info",
        lifecycleComplete: false,
        retryable: false,
        appQuitRequested: true,
        windowCloseRequested: false,
      };
    case "window_close_requested":
      return {
        kind,
        state: "shutting_down",
        severity: "info",
        lifecycleComplete: false,
        retryable: false,
        appQuitRequested: false,
        windowCloseRequested: true,
      };
    case "shutting_down":
      return {
        kind,
        state: "shutting_down",
        severity: "info",
        lifecycleComplete: false,
        retryable: false,
        appQuitRequested: true,
        windowCloseRequested: false,
      };
    case "shutdown_complete":
      return {
        kind,
        state: "shutdown_complete",
        severity: "info",
        lifecycleComplete: true,
        retryable: false,
        appQuitRequested: true,
        windowCloseRequested: false,
      };
    case "shutdown_failed":
      return {
        kind,
        state: "failed",
        severity: "error",
        lifecycleComplete: true,
        retryable: true,
        appQuitRequested: true,
        windowCloseRequested: false,
        reason: "runtime shutdown failed",
      };
    case "unregistered":
      return {
        kind,
        state: "unregistered",
        severity: "info",
        lifecycleComplete: true,
        retryable: false,
        appQuitRequested: false,
        windowCloseRequested: false,
      };
  }
}

function createFakeRuntimePreloadSubscribe(): {
  readonly subscribe: RuntimePreloadIpcSubscribe;
  readonly emit: (channel: RuntimeIpcChannel, payload?: unknown) => void;
  readonly listenerCount: (channel: RuntimeIpcChannel) => number;
  readonly lastPayload: (channel: RuntimeIpcChannel) => unknown;
} {
  const listeners = new Map<
    RuntimeIpcChannel,
    Set<RuntimePreloadIpcPayloadListener>
  >();
  const payloads = new Map<RuntimeIpcChannel, unknown>();

  return {
    subscribe: (channel, listener) => {
      const channelListeners = listeners.get(channel) ?? new Set();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        return channelListeners.delete(listener);
      };
    },
    emit: (channel, payload) => {
      payloads.set(channel, payload);
      for (const listener of [...(listeners.get(channel) ?? [])]) {
        listener(payload);
      }
    },
    listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
    lastPayload: (channel) => payloads.get(channel),
  };
}
