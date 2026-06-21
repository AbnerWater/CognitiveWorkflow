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
  type RuntimeBridge,
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
  bindRuntimeStartupStatusStoreToPageLifecycle,
  createRuntimeStartupStatusStore,
  type RuntimeStartupStatusPageLifecycleEvent,
  type RuntimeStartupStatusPageLifecycleListener,
} from "../renderer/startup-status-client.js";
import {
  buildRuntimeStartupStatusViewModelSnapshot,
  createRuntimeStartupStatusViewModel,
  type RuntimeStartupStatusViewModelStore,
} from "../renderer/startup-status-view-model.js";
import { createRuntimeStartupStatusSession } from "../renderer/startup-status-session.js";
import {
  createRuntimeLifecycleStatusController,
  type RuntimeLifecycleStatusPageLifecycleEvent,
  type RuntimeLifecycleStatusPageLifecycleListener,
} from "../renderer/runtime-lifecycle-status-controller.js";
import {
  createRuntimeLifecycleViewState,
  type RuntimeLifecycleViewStateItem,
} from "../renderer/runtime-lifecycle-view-state.js";
import { createRuntimeLifecycleShellSession } from "../renderer/runtime-lifecycle-shell-session.js";
import {
  bindRuntimeShutdownStatusStoreToPageLifecycle,
  createRuntimeShutdownStatusStore,
  type RuntimeShutdownStatusPageLifecycleEvent,
  type RuntimeShutdownStatusPageLifecycleListener,
} from "../renderer/shutdown-status-client.js";
import {
  buildRuntimeStreamConnectionRequest,
  createRuntimeStreamReplayState,
  isRuntimeStreamReplayNotFoundFailure,
  type OpenRuntimeStreamReconnectingClientOptions,
  openRuntimeStreamClient,
  openRuntimeStreamReconnectingClient,
  RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
  type RuntimeStreamConnectionRequest,
  type RuntimeStreamEvent,
  type RuntimeStreamEventSource,
  type RuntimeStreamFullReloadDecision,
  type RuntimeStreamReconnectingClient,
  type RuntimeStreamReconnectScheduler,
  type RuntimeStreamSourceEvent,
  type RuntimeStreamSourceListener,
} from "../renderer/runtime-stream-client.js";
import {
  bindRuntimeStreamEventStoreToPageLifecycle,
  createRuntimeStreamEventStore,
  type RuntimeStreamEventStorePageLifecycleEvent,
  type RuntimeStreamEventStorePageLifecycleListener,
  type RuntimeStreamEventStoreSnapshot,
} from "../renderer/runtime-stream-store.js";
import {
  createRuntimeStreamViewModel,
  type RuntimeStreamViewCategory,
  type RuntimeStreamViewDisplayLevel,
  type RuntimeStreamViewModelSnapshot,
} from "../renderer/runtime-stream-view-model.js";
import {
  createRuntimeStreamInteraction,
  type RuntimeStreamInteractionSnapshot,
} from "../renderer/runtime-stream-interaction.js";
import {
  RUNTIME_STREAM_ALL_EVENT_TYPES,
  createRuntimeStreamInteractionSessionController,
  createRuntimeStreamInteractionSessionFactory,
  createRuntimeStreamInteractionSession,
  defaultRuntimeStreamSessionEventTypes,
  type RuntimeStreamKnownEventType,
} from "../renderer/runtime-stream-session.js";

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

test("preload runtime bridge subscribes to startup status events", () => {
  const ipc = createFakeRuntimePreloadSubscribe();
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
  const bridge = createRuntimePreloadBridge({
    invoke: async () => {
      throw new Error("invoke should not be called");
    },
    subscribe: ipc.subscribe,
  });
  const firstKinds: Array<RuntimeIpcStartupStatus["kind"] | undefined> = [];
  const secondKinds: Array<RuntimeIpcStartupStatus["kind"] | undefined> = [];
  const unsubscribeFirst = bridge.onStartupStatus((statuses) => {
    firstKinds.push(statuses[0]?.kind);
    const mutableStatuses =
      statuses as RuntimeIpcStartupStatusResponse extends readonly (infer TStatus)[]
        ? TStatus[]
        : never;
    const [status] = mutableStatuses;
    assert.ok(status);
    mutableStatuses[0] = {
      ...status,
      kind: "startup_blocked",
      action: "block_startup",
    };
  });
  bridge.onStartupStatus(() => {
    throw new Error("renderer listener failed");
  });
  const unsubscribeSecond = bridge.onStartupStatus((statuses) => {
    secondKinds.push(statuses[0]?.kind);
  });

  assert.equal(ipc.listenerCount(RUNTIME_IPC_STARTUP_STATUS_CHANNEL), 3);
  assert.doesNotThrow(() =>
    ipc.emit(RUNTIME_IPC_STARTUP_STATUS_CHANNEL, [waitingStatus]),
  );
  assert.deepEqual(firstKinds, ["waiting_for_existing"]);
  assert.deepEqual(secondKinds, ["waiting_for_existing"]);
  assert.deepEqual(ipc.lastPayload(RUNTIME_IPC_STARTUP_STATUS_CHANNEL), [
    waitingStatus,
  ]);

  ipc.emit(RUNTIME_IPC_STARTUP_STATUS_CHANNEL, { invalid: true });
  assert.deepEqual(firstKinds, ["waiting_for_existing", undefined]);
  assert.deepEqual(secondKinds, ["waiting_for_existing", undefined]);
  assert.equal(unsubscribeFirst(), true);
  assert.equal(unsubscribeFirst(), false);
  assert.equal(unsubscribeSecond(), true);
  assert.equal(ipc.listenerCount(RUNTIME_IPC_STARTUP_STATUS_CHANNEL), 1);
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
  assert.equal(typeof api.runtime.onStartupStatus, "function");
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
  const liveStartupStatusPayloads: Array<readonly RuntimeIpcStartupStatus[]> =
    [];
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
  const unsubscribeStartupStatus = api.runtime.onStartupStatus(
    (liveStatuses) => {
      liveStartupStatusPayloads.push(liveStatuses);
    },
  );
  ipcListeners.get(RUNTIME_IPC_STARTUP_STATUS_CHANNEL)?.(
    { sender: "main" },
    statuses,
  );
  assert.equal(unsubscribeStartupStatus(), true);
  assert.equal(unsubscribeStartupStatus(), false);
  assert.equal(ipcListeners.has(RUNTIME_IPC_STARTUP_STATUS_CHANNEL), false);
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
  assert.deepEqual(liveStartupStatusPayloads, [statuses]);
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

test("renderer startup status store refreshes and appends live updates", async () => {
  const errors: unknown[] = [];
  const firstObservedKinds: Array<RuntimeIpcStartupStatus["kind"]> = [];
  const secondObservedKinds: Array<RuntimeIpcStartupStatus["kind"]> = [];
  let liveListener:
    | ((statuses: readonly RuntimeIpcStartupStatus[]) => void)
    | undefined;
  let startupStatusSnapshot: readonly RuntimeIpcStartupStatus[] = [
    createStartupStatus("starting_sidecar"),
  ];
  const store = createRuntimeStartupStatusStore({
    runtime: {
      startupStatus: async () => startupStatusSnapshot,
      onStartupStatus: (listener) => {
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
    const mutableStatuses = statuses as RuntimeIpcStartupStatus[];
    mutableStatuses[0] = createStartupStatus("startup_blocked");
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
  assert.deepEqual(await store.refresh(), [
    createStartupStatus("starting_sidecar"),
  ]);
  assert.deepEqual(firstObservedKinds, ["starting_sidecar"]);
  assert.deepEqual(secondObservedKinds, ["starting_sidecar"]);
  assert.equal(errors.length, 1);

  liveListener?.([createStartupStatus("runtime_ready")]);
  assert.deepEqual(store.snapshot(), [
    createStartupStatus("starting_sidecar"),
    createStartupStatus("runtime_ready"),
  ]);
  assert.deepEqual(firstObservedKinds, [
    "starting_sidecar",
    "starting_sidecar",
  ]);
  assert.deepEqual(secondObservedKinds, [
    "starting_sidecar",
    "starting_sidecar",
  ]);
  assert.equal(errors.length, 2);

  startupStatusSnapshot = [createStartupStatus("startup_blocked")];
  assert.deepEqual(await store.refresh(), [
    createStartupStatus("startup_blocked"),
  ]);
  assert.equal(unsubscribeFirst(), true);
  assert.equal(unsubscribeFirst(), false);
  assert.equal(unsubscribeSecond(), true);
  assert.equal(store.listenerCount(), 1);
  assert.equal(store.stop(), true);
  assert.equal(store.stop(), false);
  assert.equal(store.isStarted(), false);
});

test("renderer startup status store ignores stale refresh after live update", async () => {
  let liveListener:
    | ((statuses: readonly RuntimeIpcStartupStatus[]) => void)
    | undefined;
  let resolveStartupStatus:
    | ((statuses: readonly RuntimeIpcStartupStatus[]) => void)
    | undefined;
  const store = createRuntimeStartupStatusStore({
    runtime: {
      startupStatus: async () =>
        new Promise<readonly RuntimeIpcStartupStatus[]>((resolve) => {
          resolveStartupStatus = resolve;
        }),
      onStartupStatus: (listener) => {
        liveListener = listener;
        return () => true;
      },
    },
  });

  assert.equal(store.start(), true);
  const refreshPromise = store.refresh();
  liveListener?.([createStartupStatus("runtime_ready")]);
  resolveStartupStatus?.([createStartupStatus("starting_sidecar")]);

  assert.deepEqual(await refreshPromise, [
    createStartupStatus("runtime_ready"),
  ]);
  assert.deepEqual(store.snapshot(), [createStartupStatus("runtime_ready")]);
});

test("renderer startup status page lifecycle binding stops and disposes once", () => {
  const events = new Map<
    RuntimeStartupStatusPageLifecycleEvent,
    RuntimeStartupStatusPageLifecycleListener
  >();
  let stopCalls = 0;
  const dispose = bindRuntimeStartupStatusStoreToPageLifecycle(
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

test("renderer startup status view model projects panel snapshots", () => {
  assert.deepEqual(buildRuntimeStartupStatusViewModelSnapshot([]), {
    phase: "idle",
    tone: "info",
    title: "Runtime startup is idle",
    summary: "No runtime startup status has been received.",
    latestStatus: null,
    items: [],
    totalStatuses: 0,
    lifecycleComplete: false,
    userActionRequired: false,
    retryable: false,
  });

  const snapshot = buildRuntimeStartupStatusViewModelSnapshot([
    createStartupStatus("starting_sidecar"),
    createStartupStatus("runtime_ready"),
  ]);

  assert.equal(snapshot.phase, "ready");
  assert.equal(snapshot.tone, "success");
  assert.equal(snapshot.title, "Runtime ready");
  assert.equal(snapshot.summary, "Runtime sidecar is ready.");
  assert.equal(snapshot.totalStatuses, 2);
  assert.equal(snapshot.lifecycleComplete, true);
  assert.equal(snapshot.userActionRequired, false);
  assert.equal(snapshot.retryable, false);
  assert.deepEqual(
    snapshot.items.map((item) => item.title),
    ["Starting runtime", "Runtime ready"],
  );

  const blockedSnapshot = buildRuntimeStartupStatusViewModelSnapshot([
    createStartupStatus("startup_blocked"),
  ]);
  assert.equal(blockedSnapshot.phase, "blocked");
  assert.equal(blockedSnapshot.tone, "error");
  assert.equal(blockedSnapshot.userActionRequired, true);
  assert.equal(blockedSnapshot.retryable, false);
  assert.match(blockedSnapshot.summary, /runtime lock is corrupt/u);

  const timedOutSnapshot = buildRuntimeStartupStatusViewModelSnapshot([
    createStartupStatus("startup_timed_out"),
  ]);
  assert.equal(timedOutSnapshot.phase, "timed_out");
  assert.equal(timedOutSnapshot.tone, "error");
  assert.equal(timedOutSnapshot.userActionRequired, true);
  assert.equal(timedOutSnapshot.retryable, true);
  assert.match(timedOutSnapshot.summary, /before timeout/u);
});

test("renderer startup status view model subscribes and isolates snapshots", () => {
  const errors: unknown[] = [];
  const store = createFakeRuntimeStartupStatusViewModelStore([
    createStartupStatus("starting_sidecar"),
  ]);
  const viewModel = createRuntimeStartupStatusViewModel({
    store: store.store,
    onError: (error) => {
      errors.push(error);
    },
  });
  const firstObservedPhases: string[] = [];
  const secondObservedPhases: string[] = [];
  const secondObservedTitles: string[] = [];

  const unsubscribeFirst = viewModel.subscribe((snapshot) => {
    firstObservedPhases.push(snapshot.phase);
    const mutableItems = snapshot.items as Array<
      (typeof snapshot.items)[number]
    >;
    const [item] = mutableItems;
    assert.ok(item);
    mutableItems[0] = {
      ...item,
      kind: "startup_blocked",
      title: "Mutated",
    };
  });
  viewModel.subscribe(() => {
    throw new Error("view listener failed");
  });
  const unsubscribeSecond = viewModel.subscribe((snapshot) => {
    secondObservedPhases.push(snapshot.phase);
    const [item] = snapshot.items;
    assert.ok(item);
    secondObservedTitles.push(item.title);
  });

  assert.equal(viewModel.listenerCount(), 3);
  assert.equal(store.listenerCount(), 1);
  assert.equal(viewModel.snapshot().phase, "starting");

  store.emit([createStartupStatus("waiting_for_existing")]);
  assert.deepEqual(firstObservedPhases, ["waiting"]);
  assert.deepEqual(secondObservedPhases, ["waiting"]);
  assert.deepEqual(secondObservedTitles, ["Waiting for existing runtime"]);
  assert.equal(errors.length, 1);
  assert.equal(viewModel.snapshot().latestStatus?.kind, "waiting_for_existing");

  store.emit([createStartupStatus("runtime_ready")]);
  assert.deepEqual(firstObservedPhases, ["waiting", "ready"]);
  assert.deepEqual(secondObservedPhases, ["waiting", "ready"]);
  assert.deepEqual(secondObservedTitles, [
    "Waiting for existing runtime",
    "Runtime ready",
  ]);
  assert.equal(errors.length, 2);
  assert.equal(viewModel.snapshot().latestStatus?.kind, "runtime_ready");
  assert.equal(unsubscribeFirst(), true);
  assert.equal(unsubscribeFirst(), false);
  assert.equal(unsubscribeSecond(), true);
  assert.equal(viewModel.listenerCount(), 1);
  assert.equal(viewModel.dispose(), true);
  assert.equal(viewModel.dispose(), false);
  assert.equal(viewModel.listenerCount(), 0);
  assert.equal(store.listenerCount(), 0);
  assert.equal(viewModel.subscribe(() => undefined)(), false);
});

test("renderer startup status session composes store and view model", async () => {
  const runtime = createFakeRuntimeStartupStatusRuntime([
    createStartupStatus("starting_sidecar"),
  ]);
  const session = createRuntimeStartupStatusSession({
    runtime: runtime.runtime,
  });
  const published: Array<{
    readonly phase: string;
    readonly started: boolean;
    readonly total: number;
  }> = [];

  assert.equal(session.store.listenerCount(), 1);
  assert.equal(session.viewModel.listenerCount(), 0);
  assert.equal(session.isStarted(), false);
  assert.equal(session.snapshot().view.phase, "idle");

  const unsubscribe = session.subscribe((snapshot) => {
    published.push({
      phase: snapshot.view.phase,
      started: snapshot.started,
      total: snapshot.statuses.length,
    });
  });
  assert.equal(session.listenerCount(), 1);
  assert.equal(session.viewModel.listenerCount(), 1);

  const started = session.start();
  assert.equal(started.started, true);
  assert.equal(runtime.listenerCount(), 1);
  assert.deepEqual(published, [{ phase: "idle", started: true, total: 0 }]);

  const refreshed = await session.refresh();
  assert.equal(refreshed.view.phase, "starting");
  assert.equal(refreshed.statuses.length, 1);
  assert.deepEqual(published.at(-1), {
    phase: "starting",
    started: true,
    total: 1,
  });

  runtime.emit([createStartupStatus("runtime_ready")]);
  assert.equal(session.snapshot().view.phase, "ready");
  assert.equal(session.snapshot().statuses.length, 2);
  assert.deepEqual(published.at(-1), {
    phase: "ready",
    started: true,
    total: 2,
  });

  assert.equal(session.stop(), true);
  assert.equal(runtime.unsubscribeCount(), 1);
  assert.equal(session.isStarted(), false);
  assert.deepEqual(published.at(-1), {
    phase: "ready",
    started: false,
    total: 2,
  });
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(session.viewModel.listenerCount(), 0);
  assert.equal(session.dispose(), true);
});

test("renderer startup status session isolates listeners and cleans up", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeStartupStatusRuntime([
    createStartupStatus("starting_sidecar"),
  ]);
  const pageLifecycle = createFakeRuntimeStartupStatusPageLifecycleTarget();
  const session = createRuntimeStartupStatusSession({
    runtime: runtime.runtime,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly phase: string;
    readonly started: boolean;
    readonly total: number;
  }> = [];

  const unsubscribeThrowing = session.subscribe((snapshot) => {
    const mutableStatuses = snapshot.statuses as RuntimeIpcStartupStatus[];
    mutableStatuses.push(createStartupStatus("startup_blocked"));
    throw new Error("startup session listener failed");
  });
  const unsubscribeObserved = session.subscribe((snapshot) => {
    observed.push({
      phase: snapshot.view.phase,
      started: snapshot.started,
      total: snapshot.statuses.length,
    });
  });

  assert.equal(session.listenerCount(), 2);
  assert.equal(session.viewModel.listenerCount(), 1);
  session.start();
  await session.refresh();

  assert.deepEqual(observed, [
    { phase: "idle", started: true, total: 0 },
    { phase: "starting", started: true, total: 1 },
  ]);
  assert.equal(errors.length, 2);
  assert.deepEqual(session.snapshot().statuses, [
    createStartupStatus("starting_sidecar"),
  ]);

  const unbindPageLifecycle = session.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);
  pageLifecycle.emit("pagehide");
  assert.equal(session.isStarted(), false);
  assert.equal(runtime.unsubscribeCount(), 1);
  assert.deepEqual(observed.at(-1), {
    phase: "starting",
    started: false,
    total: 1,
  });
  assert.equal(observed.length, 3);
  assert.equal(errors.length, 3);
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(observed.length, 3);
  assert.equal(errors.length, 3);
  assert.equal(unbindPageLifecycle(), false);
  assert.equal(pageLifecycle.listenerCount("pagehide"), 0);

  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), true);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.viewModel.listenerCount(), 0);
  assert.equal(session.dispose(), true);
  assert.equal(session.dispose(), false);
  assert.equal(session.store.listenerCount(), 0);
  assert.equal(session.viewModel.listenerCount(), 0);
  assert.equal(session.isDisposed(), true);
  assert.equal(session.subscribe(() => undefined)(), false);
  assert.throws(() => session.start(), /startup status session is disposed/u);
  await assert.rejects(
    async () => session.refresh(),
    /startup status session is disposed/u,
  );
  assert.equal(session.stop(), false);
});

test("renderer runtime lifecycle status controller composes startup and shutdown status", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controller = createRuntimeLifecycleStatusController({
    runtime: runtime.runtime,
  });
  const published: Array<{
    readonly phase: string;
    readonly startupStarted: boolean;
    readonly shutdownStarted: boolean;
    readonly startupTotal: number;
    readonly shutdownTotal: number;
  }> = [];

  assert.equal(controller.isStarted(), false);
  assert.equal(controller.snapshot().phase, "idle");
  assert.equal(controller.snapshot().shutdownStatuses.length, 0);

  const unsubscribe = controller.subscribe((snapshot) => {
    published.push({
      phase: snapshot.phase,
      startupStarted: snapshot.startupStarted,
      shutdownStarted: snapshot.shutdownStarted,
      startupTotal: snapshot.startup.statuses.length,
      shutdownTotal: snapshot.shutdownStatuses.length,
    });
  });
  assert.equal(controller.listenerCount(), 1);
  assert.equal(controller.startupSession.listenerCount(), 1);
  assert.equal(controller.shutdownStore.listenerCount(), 1);

  const started = controller.start();
  assert.equal(started.startupStarted, true);
  assert.equal(started.shutdownStarted, true);
  assert.equal(controller.isStarted(), true);
  assert.equal(runtime.startupListenerCount(), 1);
  assert.equal(runtime.shutdownListenerCount(), 1);
  assert.deepEqual(published, [
    {
      phase: "idle",
      startupStarted: true,
      shutdownStarted: true,
      startupTotal: 0,
      shutdownTotal: 0,
    },
  ]);

  const refreshed = await controller.refresh();
  assert.equal(refreshed.phase, "starting");
  assert.equal(refreshed.shutdownStatuses.length, 1);
  assert.deepEqual(published.at(-1), {
    phase: "starting",
    startupStarted: true,
    shutdownStarted: true,
    startupTotal: 1,
    shutdownTotal: 1,
  });

  runtime.emitStartup([createStartupStatus("runtime_ready")]);
  assert.equal(controller.snapshot().phase, "ready");
  assert.deepEqual(published.at(-1), {
    phase: "ready",
    startupStarted: true,
    shutdownStarted: true,
    startupTotal: 2,
    shutdownTotal: 1,
  });

  runtime.emitShutdown([createShutdownStatus("shutting_down")]);
  assert.equal(controller.snapshot().phase, "shutting_down");
  assert.deepEqual(published.at(-1), {
    phase: "shutting_down",
    startupStarted: true,
    shutdownStarted: true,
    startupTotal: 2,
    shutdownTotal: 2,
  });

  runtime.setStartupSnapshot([
    createStartupStatus("starting_sidecar"),
    createStartupStatus("runtime_ready"),
  ]);
  runtime.setShutdownSnapshot([createShutdownStatus("shutdown_complete")]);
  const stoppedSnapshot = await controller.refresh();
  assert.equal(stoppedSnapshot.phase, "stopped");
  assert.equal(stoppedSnapshot.tone, "success");
  assert.equal(stoppedSnapshot.lifecycleComplete, true);
  assert.deepEqual(published.at(-1), {
    phase: "stopped",
    startupStarted: true,
    shutdownStarted: true,
    startupTotal: 2,
    shutdownTotal: 1,
  });

  runtime.emitShutdown([createShutdownStatus("shutdown_failed")]);
  const failedSnapshot = controller.snapshot();
  assert.equal(failedSnapshot.phase, "failed");
  assert.equal(failedSnapshot.tone, "error");
  assert.equal(failedSnapshot.lifecycleComplete, true);
  assert.equal(failedSnapshot.userActionRequired, true);
  assert.equal(failedSnapshot.retryable, true);
  assert.equal(failedSnapshot.latestShutdownStatus?.state, "failed");
  assert.deepEqual(published.at(-1), {
    phase: "failed",
    startupStarted: true,
    shutdownStarted: true,
    startupTotal: 2,
    shutdownTotal: 2,
  });

  runtime.emitShutdown([createShutdownStatus("unregistered")]);
  const unregisteredSnapshot = controller.snapshot();
  assert.equal(unregisteredSnapshot.phase, "stopped");
  assert.equal(unregisteredSnapshot.tone, "success");
  assert.equal(unregisteredSnapshot.lifecycleComplete, true);
  assert.equal(unregisteredSnapshot.userActionRequired, false);
  assert.equal(unregisteredSnapshot.retryable, false);
  assert.equal(
    unregisteredSnapshot.latestShutdownStatus?.state,
    "unregistered",
  );
  assert.deepEqual(published.at(-1), {
    phase: "stopped",
    startupStarted: true,
    shutdownStarted: true,
    startupTotal: 2,
    shutdownTotal: 3,
  });

  assert.equal(controller.stop(), true);
  assert.equal(controller.isStarted(), false);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.deepEqual(published.at(-1), {
    phase: "stopped",
    startupStarted: false,
    shutdownStarted: false,
    startupTotal: 2,
    shutdownTotal: 3,
  });
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(controller.startupSession.listenerCount(), 0);
  assert.equal(controller.shutdownStore.listenerCount(), 0);
  assert.equal(controller.dispose(), true);
});

test("renderer runtime lifecycle status controller isolates listeners and disposes", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const controller = createRuntimeLifecycleStatusController({
    runtime: runtime.runtime,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly phase: string;
    readonly shutdownTotal: number;
  }> = [];

  const unsubscribeThrowing = controller.subscribe((snapshot) => {
    const mutableShutdownStatuses =
      snapshot.shutdownStatuses as RuntimeIpcShutdownStatus[];
    mutableShutdownStatuses.push(createShutdownStatus("shutdown_failed"));
    throw new Error("lifecycle listener failed");
  });
  const unsubscribeObserved = controller.subscribe((snapshot) => {
    observed.push({
      phase: snapshot.phase,
      shutdownTotal: snapshot.shutdownStatuses.length,
    });
  });

  controller.start();
  await controller.refresh();
  assert.deepEqual(observed, [
    { phase: "idle", shutdownTotal: 0 },
    { phase: "starting", shutdownTotal: 1 },
  ]);
  assert.equal(errors.length, 2);
  assert.deepEqual(controller.snapshot().shutdownStatuses, [
    createShutdownStatus("registered"),
  ]);

  const unbindPageLifecycle = controller.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);
  pageLifecycle.emit("pagehide");
  assert.equal(controller.isStarted(), false);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.deepEqual(observed.at(-1), {
    phase: "starting",
    shutdownTotal: 1,
  });
  assert.equal(observed.length, 3);
  assert.equal(errors.length, 3);
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(observed.length, 3);
  assert.equal(errors.length, 3);
  assert.equal(unbindPageLifecycle(), false);
  assert.equal(pageLifecycle.listenerCount("pagehide"), 0);

  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), true);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(controller.startupSession.listenerCount(), 0);
  assert.equal(controller.shutdownStore.listenerCount(), 0);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.isDisposed(), true);
  assert.equal(controller.startupSession.isDisposed(), true);
  assert.equal(controller.subscribe(() => undefined)(), false);
  assert.throws(
    () => controller.start(),
    /lifecycle status controller is disposed/u,
  );
  await assert.rejects(
    async () => controller.refresh(),
    /lifecycle status controller is disposed/u,
  );
  assert.equal(controller.stop(), false);
});

test("renderer runtime lifecycle view state projects shell readiness", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controller = createRuntimeLifecycleStatusController({
    runtime: runtime.runtime,
  });
  const viewState = createRuntimeLifecycleViewState({ controller });
  const observed: Array<{
    readonly readiness: string;
    readonly primaryAction: string;
    readonly title: string;
  }> = [];

  assert.equal(controller.listenerCount(), 1);
  assert.equal(viewState.snapshot().readiness, "idle");
  assert.equal(viewState.snapshot().primaryAction, "start_runtime");
  assert.equal(viewState.snapshot().runtimeReady, false);
  assert.equal(viewState.snapshot().items.length, 0);

  const unsubscribe = viewState.subscribe((snapshot) => {
    observed.push({
      readiness: snapshot.readiness,
      primaryAction: snapshot.primaryAction,
      title: snapshot.title,
    });
  });

  controller.start();
  await controller.refresh();
  assert.equal(viewState.snapshot().phase, "starting");
  assert.equal(viewState.snapshot().readiness, "busy");
  assert.equal(viewState.snapshot().primaryAction, "wait");
  assert.equal(viewState.snapshot().busy, true);
  assert.equal(viewState.snapshot().runtimeReady, false);
  assert.equal(viewState.snapshot().latestItem?.source, "startup");
  assert.deepEqual(
    viewState.snapshot().items.map((item) => item.source),
    ["startup", "shutdown"],
  );

  runtime.emitStartup([createStartupStatus("runtime_ready")]);
  assert.equal(viewState.snapshot().readiness, "ready");
  assert.equal(viewState.snapshot().runtimeReady, true);
  assert.equal(viewState.snapshot().primaryAction, "none");
  assert.equal(viewState.snapshot().title, "Runtime ready");

  runtime.emitShutdown([createShutdownStatus("shutting_down")]);
  assert.equal(viewState.snapshot().readiness, "shutting_down");
  assert.equal(viewState.snapshot().runtimeReady, false);
  assert.equal(viewState.snapshot().primaryAction, "wait");
  assert.equal(viewState.snapshot().latestItem?.source, "shutdown");
  assert.equal(viewState.snapshot().title, "Runtime shutting down");

  runtime.emitShutdown([createShutdownStatus("shutdown_failed")]);
  assert.equal(viewState.snapshot().readiness, "attention_required");
  assert.equal(viewState.snapshot().primaryAction, "retry_startup");
  assert.equal(viewState.snapshot().userActionRequired, true);
  assert.equal(viewState.snapshot().retryable, true);
  assert.equal(viewState.snapshot().title, "Runtime shutdown failed");

  runtime.emitShutdown([createShutdownStatus("unregistered")]);
  assert.equal(viewState.snapshot().readiness, "stopped");
  assert.equal(viewState.snapshot().primaryAction, "start_runtime");
  assert.equal(viewState.snapshot().terminal, true);
  assert.equal(viewState.snapshot().title, "Runtime shutdown unregistered");
  assert.equal(viewState.snapshot().shutdownTotal, 4);
  assert.deepEqual(
    observed.map((snapshot) => snapshot.readiness),
    ["idle", "busy", "ready", "shutting_down", "attention_required", "stopped"],
  );

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(viewState.dispose(), true);
  assert.equal(controller.listenerCount(), 0);
});

test("renderer runtime lifecycle view state strips raw reason details", async () => {
  const sensitiveReason =
    "token_abc base_url=http://127.0.0.1:51234/cw/v1 prompt model output";
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [{ ...createStartupStatus("startup_blocked"), reason: sensitiveReason }],
    [{ ...createShutdownStatus("shutdown_failed"), reason: sensitiveReason }],
  );
  const controller = createRuntimeLifecycleStatusController({
    runtime: runtime.runtime,
  });
  const viewState = createRuntimeLifecycleViewState({ controller });

  controller.start();
  await controller.refresh();

  const snapshot = viewState.snapshot();
  const visibleText = [
    snapshot.title,
    snapshot.summary,
    snapshot.latestItem?.title ?? "",
    snapshot.latestItem?.summary ?? "",
    ...snapshot.items.flatMap((item) => [item.title, item.summary]),
  ].join("\n");

  assert.equal(snapshot.readiness, "attention_required");
  assert.equal(snapshot.latestItem?.source, "shutdown");
  assert.equal(snapshot.summary, "Runtime shutdown failed.");
  assert.doesNotMatch(visibleText, /token_abc/u);
  assert.doesNotMatch(visibleText, /base_url/u);
  assert.doesNotMatch(visibleText, /prompt/u);
  assert.doesNotMatch(visibleText, /model output/u);
  assert.equal(
    snapshot.items.some((item) => Object.hasOwn(item, "reason")),
    false,
  );
  assert.equal(viewState.dispose(), true);
});

test("renderer runtime lifecycle view state isolates listeners and disposes", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controller = createRuntimeLifecycleStatusController({
    runtime: runtime.runtime,
  });
  const viewState = createRuntimeLifecycleViewState({
    controller,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly readiness: string;
    readonly itemTotal: number;
    readonly latestTitle: string | null;
  }> = [];

  const unsubscribeThrowing = viewState.subscribe((snapshot) => {
    const mutableItems = snapshot.items as RuntimeLifecycleViewStateItem[];
    mutableItems.push({
      source: "shutdown",
      kind: "shutdown_failed",
      phase: "failed",
      tone: "error",
      title: "Mutated",
      summary: "Mutated",
      lifecycleComplete: true,
      userActionRequired: true,
      retryable: true,
    });
    if (snapshot.latestItem !== null) {
      const mutableLatest = snapshot.latestItem as { title: string };
      mutableLatest.title = "Mutated";
    }
    throw new Error("lifecycle view listener failed");
  });
  const unsubscribeObserved = viewState.subscribe((snapshot) => {
    observed.push({
      readiness: snapshot.readiness,
      itemTotal: snapshot.items.length,
      latestTitle: snapshot.latestItem?.title ?? null,
    });
  });

  controller.start();
  await controller.refresh();
  assert.deepEqual(observed, [
    { readiness: "idle", itemTotal: 0, latestTitle: null },
    {
      readiness: "busy",
      itemTotal: 2,
      latestTitle: "Starting runtime",
    },
  ]);
  assert.equal(errors.length, 2);
  assert.deepEqual(
    viewState.snapshot().items.map((item) => item.title),
    ["Starting runtime", "Runtime shutdown registered"],
  );
  assert.equal(viewState.snapshot().latestItem?.title, "Starting runtime");

  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), true);
  assert.equal(viewState.listenerCount(), 0);
  assert.equal(controller.listenerCount(), 1);
  assert.equal(viewState.dispose(), true);
  assert.equal(viewState.dispose(), false);
  assert.equal(viewState.isDisposed(), true);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(viewState.snapshot().disposed, true);
  assert.equal(viewState.snapshot().primaryAction, "none");
  assert.equal(viewState.subscribe(() => undefined)(), false);
});

test("renderer runtime lifecycle shell session composes controller and view state", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const session = createRuntimeLifecycleShellSession({
    runtime: runtime.runtime,
  });
  const published: Array<{
    readonly readiness: string;
    readonly primaryAction: string;
    readonly started: boolean;
    readonly runtimeReady: boolean;
    readonly itemTotal: number;
  }> = [];

  assert.equal(session.isStarted(), false);
  assert.equal(session.snapshot().view.readiness, "idle");
  assert.equal(session.snapshot().view.primaryAction, "start_runtime");
  assert.equal(session.snapshot().view.runtimeReady, false);
  assert.equal(session.snapshot().started, false);
  assert.equal(session.snapshot().disposed, false);

  const unsubscribe = session.subscribe((snapshot) => {
    published.push({
      readiness: snapshot.view.readiness,
      primaryAction: snapshot.view.primaryAction,
      started: snapshot.started,
      runtimeReady: snapshot.view.runtimeReady,
      itemTotal: snapshot.view.items.length,
    });
  });
  assert.equal(session.listenerCount(), 1);
  assert.equal(session.viewState.listenerCount(), 1);

  const started = session.start();
  assert.equal(started.started, true);
  assert.equal(started.view.readiness, "idle");
  assert.equal(session.isStarted(), true);
  assert.equal(runtime.startupListenerCount(), 1);
  assert.equal(runtime.shutdownListenerCount(), 1);
  assert.deepEqual(published, [
    {
      readiness: "idle",
      primaryAction: "start_runtime",
      started: true,
      runtimeReady: false,
      itemTotal: 0,
    },
  ]);

  const refreshed = await session.refresh();
  assert.equal(refreshed.view.readiness, "busy");
  assert.equal(refreshed.view.primaryAction, "wait");
  assert.equal(refreshed.view.items.length, 2);
  assert.deepEqual(published.at(-1), {
    readiness: "busy",
    primaryAction: "wait",
    started: true,
    runtimeReady: false,
    itemTotal: 2,
  });

  runtime.emitStartup([createStartupStatus("runtime_ready")]);
  assert.equal(session.snapshot().view.readiness, "ready");
  assert.equal(session.snapshot().view.runtimeReady, true);
  assert.equal(session.snapshot().view.primaryAction, "none");
  assert.deepEqual(published.at(-1), {
    readiness: "ready",
    primaryAction: "none",
    started: true,
    runtimeReady: true,
    itemTotal: 3,
  });

  runtime.emitShutdown([createShutdownStatus("shutting_down")]);
  assert.equal(session.snapshot().view.readiness, "shutting_down");
  assert.equal(session.snapshot().view.primaryAction, "wait");
  assert.deepEqual(published.at(-1), {
    readiness: "shutting_down",
    primaryAction: "wait",
    started: true,
    runtimeReady: false,
    itemTotal: 4,
  });

  assert.equal(session.stop(), true);
  assert.equal(session.isStarted(), false);
  assert.deepEqual(published.at(-1), {
    readiness: "shutting_down",
    primaryAction: "wait",
    started: false,
    runtimeReady: false,
    itemTotal: 4,
  });
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.viewState.listenerCount(), 0);
  assert.equal(session.dispose(), true);
});

test("renderer runtime lifecycle shell session isolates listeners and disposes", async () => {
  const errors: unknown[] = [];
  const sensitiveReason =
    "token_abc base_url=http://127.0.0.1:51234/cw/v1 prompt model output";
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [{ ...createStartupStatus("startup_blocked"), reason: sensitiveReason }],
    [{ ...createShutdownStatus("shutdown_failed"), reason: sensitiveReason }],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const session = createRuntimeLifecycleShellSession({
    runtime: runtime.runtime,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly readiness: string;
    readonly itemTotal: number;
    readonly latestTitle: string | null;
    readonly started: boolean;
  }> = [];

  const unsubscribeThrowing = session.subscribe((snapshot) => {
    const mutableItems = snapshot.view.items as RuntimeLifecycleViewStateItem[];
    mutableItems.push({
      source: "shutdown",
      kind: "shutdown_failed",
      phase: "failed",
      tone: "error",
      title: "Mutated",
      summary: "Mutated",
      lifecycleComplete: true,
      userActionRequired: true,
      retryable: true,
    });
    if (snapshot.view.latestItem !== null) {
      const mutableLatest = snapshot.view.latestItem as { title: string };
      mutableLatest.title = "Mutated";
    }
    const mutableSnapshot = snapshot as { started: boolean };
    mutableSnapshot.started = false;
    throw new Error("lifecycle shell session listener failed");
  });
  const unsubscribeObserved = session.subscribe((snapshot) => {
    observed.push({
      readiness: snapshot.view.readiness,
      itemTotal: snapshot.view.items.length,
      latestTitle: snapshot.view.latestItem?.title ?? null,
      started: snapshot.started,
    });
  });

  session.start();
  await session.refresh();
  assert.deepEqual(observed, [
    { readiness: "idle", itemTotal: 0, latestTitle: null, started: true },
    {
      readiness: "attention_required",
      itemTotal: 2,
      latestTitle: "Runtime shutdown failed",
      started: true,
    },
  ]);
  assert.equal(errors.length, 2);
  assert.equal(
    session.snapshot().view.latestItem?.title,
    "Runtime shutdown failed",
  );
  assert.deepEqual(
    session.snapshot().view.items.map((item) => item.title),
    ["Startup blocked", "Runtime shutdown failed"],
  );
  assert.equal(
    session.snapshot().view.items.some((item) => Object.hasOwn(item, "reason")),
    false,
  );
  const visibleText = [
    session.snapshot().view.title,
    session.snapshot().view.summary,
    session.snapshot().view.latestItem?.title ?? "",
    session.snapshot().view.latestItem?.summary ?? "",
    ...session
      .snapshot()
      .view.items.flatMap((item) => [item.title, item.summary]),
  ].join("\n");
  assert.doesNotMatch(visibleText, /token_abc/u);
  assert.doesNotMatch(visibleText, /base_url/u);
  assert.doesNotMatch(visibleText, /prompt/u);
  assert.doesNotMatch(visibleText, /model output/u);

  const unbindPageLifecycle = session.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);
  pageLifecycle.emit("pagehide");
  assert.equal(session.isStarted(), false);
  assert.deepEqual(observed.at(-1), {
    readiness: "attention_required",
    itemTotal: 2,
    latestTitle: "Runtime shutdown failed",
    started: false,
  });
  assert.equal(observed.length, 3);
  assert.equal(errors.length, 3);
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(observed.length, 3);
  assert.equal(errors.length, 3);
  assert.equal(unbindPageLifecycle(), false);
  assert.equal(pageLifecycle.listenerCount("pagehide"), 0);

  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), true);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.viewState.listenerCount(), 0);
  assert.equal(session.dispose(), true);
  assert.equal(session.dispose(), false);
  assert.equal(session.isDisposed(), true);
  assert.equal(session.viewState.isDisposed(), true);
  assert.equal(session.controller.isDisposed(), true);
  assert.equal(session.snapshot().disposed, true);
  assert.equal(session.snapshot().view.disposed, true);
  assert.equal(session.snapshot().view.primaryAction, "none");
  assert.equal(session.subscribe(() => undefined)(), false);
  assert.throws(() => session.start(), /lifecycle shell session is disposed/u);
  await assert.rejects(
    async () => session.refresh(),
    /lifecycle shell session is disposed/u,
  );
  assert.equal(session.stop(), false);
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

test("renderer runtime stream builds spec endpoints and authenticated headers", () => {
  assert.deepEqual(
    buildRuntimeStreamConnectionRequest(
      {
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      },
      {
        channel: { kind: "run", runId: "run_01J" },
        filters: {
          level: ["default", "detailed"],
          category: ["lifecycle", "model", "system"],
          sinceSeq: 2,
          untilSeq: 5,
        },
        projectId: "prj_123",
        lastEventId: "evt_01J9N5_tool",
      },
    ),
    {
      url: "http://127.0.0.1:51234/cw/v1/runs/run_01J/stream?level=default%2Cdetailed&category=lifecycle%2Cmodel%2Csystem&since_seq=2&until_seq=5",
      headers: {
        Authorization: "Bearer token_abc123",
        "X-Cw-Client": "electron-renderer",
        "X-Project-Id": "prj_123",
        Accept: "text/event-stream",
        "Last-Event-ID": "evt_01J9N5_tool",
      },
      withCredentials: false,
    },
  );
  assert.equal(
    buildRuntimeStreamConnectionRequest(
      {
        base_url: "http://127.0.0.1:51234/cw/v1/",
        token: "token_abc123",
      },
      {
        channel: { kind: "planning", sessionId: "ps_01J" },
        filters: { category: ["planning", "system"] },
      },
    ).url,
    "http://127.0.0.1:51234/cw/v1/workflow-planning/sessions/ps_01J/stream?category=planning%2Csystem",
  );

  assert.throws(
    () =>
      buildRuntimeStreamConnectionRequest(
        {
          base_url: "http://localhost:51234/cw/v1",
          token: "token_abc123",
        },
        { channel: { kind: "run", runId: "run_01J" } },
      ),
    /127\.0\.0\.1/u,
  );
  assert.throws(
    () =>
      buildRuntimeStreamConnectionRequest(
        {
          base_url: "http://127.0.0.1:51234/cw/v1",
          token: "token_abc123",
        },
        { channel: { kind: "run", runId: "../run_01J" } },
      ),
    /path segment/u,
  );
  assert.throws(
    () =>
      buildRuntimeStreamConnectionRequest(
        {
          base_url: "http://127.0.0.1:51234/cw/v1",
          token: "token_abc123",
        },
        {
          channel: { kind: "run", runId: "run_01J" },
          filters: { sinceSeq: 8, untilSeq: 3 },
        },
      ),
    /until_seq/u,
  );
  assert.throws(
    () =>
      buildRuntimeStreamConnectionRequest(
        {
          base_url: "http://127.0.0.1:51234/cw/v1",
          token: "token_abc123",
        },
        {
          channel: { kind: "planning", sessionId: "ps_01J" },
          filters: { category: "model" },
        },
      ),
    /planning stream/u,
  );
});

test("renderer runtime stream client dispatches parsed events with isolated payloads", async () => {
  const eventSource = createFakeRuntimeStreamEventSource();
  const requests: RuntimeStreamConnectionRequest[] = [];
  const eventErrors: unknown[] = [];
  const connectionErrors: unknown[] = [];
  const firstTitles: Array<string | undefined> = [];
  const secondTitles: Array<string | undefined> = [];
  const client = await openRuntimeStreamClient({
    runtime: {
      connectionInfo: async () => ({
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      }),
    },
    channel: { kind: "run", runId: "run_01J" },
    filters: { category: "model" },
    eventSourceFactory: (request) => {
      requests.push(request);
      return eventSource.source;
    },
    onEventError: (error) => {
      eventErrors.push(error);
    },
    onConnectionError: (error) => {
      connectionErrors.push(error);
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1:51234/cw/v1/runs/run_01J/stream?category=model",
  );
  const unsubscribeFirst = client.subscribe<{
    event_id: string;
    type: string;
    title: string;
  }>("model.text_delta", (event) => {
    firstTitles.push(event.data.title);
    event.data.title = "mutated";
  });
  const unsubscribeSecond = client.subscribe<{
    event_id: string;
    type: string;
    title: string;
  }>("model.text_delta", (event) => {
    secondTitles.push(event.data.title);
    assert.equal(event.id, "evt_1");
    assert.equal(event.type, "model.text_delta");
  });
  assert.equal(eventSource.listenerCount("model.text_delta"), 2);

  eventSource.emit("model.text_delta", {
    data: JSON.stringify({
      event_id: "evt_1",
      type: "model.text_delta",
      title: "Original",
    }),
    lastEventId: "evt_fallback",
  });
  assert.deepEqual(firstTitles, ["Original"]);
  assert.deepEqual(secondTitles, ["Original"]);

  eventSource.emit("model.text_delta", { data: "{bad-json" });
  eventSource.emit("model.text_delta", {
    data: JSON.stringify({
      event_id: "evt_2",
      type: "tool.call_started",
      title: "Mismatch",
    }),
  });
  eventSource.emit("error", { data: "transport failed" });
  assert.equal(eventErrors.length, 4);
  assert.equal(connectionErrors.length, 1);
  assert.equal(unsubscribeFirst(), true);
  assert.equal(unsubscribeFirst(), false);
  assert.equal(unsubscribeSecond(), true);
  assert.equal(eventSource.listenerCount("model.text_delta"), 0);
  assert.equal(client.close(), true);
  assert.equal(client.close(), false);
  assert.equal(eventSource.closeCount(), 1);
  assert.equal(client.isClosed(), true);
});

test("renderer runtime stream client rejects unsafe event subscriptions", async () => {
  const eventSource = createFakeRuntimeStreamEventSource();
  const client = await openRuntimeStreamClient({
    runtime: {
      connectionInfo: async () => ({
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      }),
    },
    channel: { kind: "run", runId: "run_01J" },
    eventSourceFactory: () => eventSource.source,
  });

  assert.throws(
    () => client.subscribe("model text delta", () => undefined),
    /event type/u,
  );
  assert.equal(client.close(), true);
  assert.equal(client.subscribe("model.text_delta", () => undefined)(), false);
});

test("renderer runtime stream replay state tracks Last-Event-ID for reconnect", () => {
  const replayState = createRuntimeStreamReplayState({
    defaultRetryMs: 3000,
  });

  assert.deepEqual(replayState.snapshot(), {
    mode: "ready",
    lastEventId: null,
    reconnectAttempt: 0,
  });
  assert.deepEqual(replayState.recordEvent({ id: "evt_1" }), {
    mode: "ready",
    lastEventId: "evt_1",
    reconnectAttempt: 0,
  });
  assert.deepEqual(replayState.recordEvent({ id: "evt_2" }), {
    mode: "ready",
    lastEventId: "evt_2",
    reconnectAttempt: 0,
  });
  assert.deepEqual(
    replayState.handleConnectionFailure({ reason: "network closed" }),
    {
      action: "reconnect",
      lastEventId: "evt_2",
      attempt: 1,
      retryAfterMs: 3000,
    },
  );
  assert.deepEqual(replayState.snapshot(), {
    mode: "reconnect_pending",
    lastEventId: "evt_2",
    reconnectAttempt: 1,
    retryAfterMs: 3000,
    reason: "network closed",
  });
  assert.deepEqual(
    replayState.handleConnectionFailure({ retryAfterMs: 1500 }),
    {
      action: "reconnect",
      lastEventId: "evt_2",
      attempt: 2,
      retryAfterMs: 1500,
    },
  );
  const reconnectLastEventId = replayState.snapshot().lastEventId;
  assert.ok(reconnectLastEventId);
  assert.equal(
    buildRuntimeStreamConnectionRequest(
      {
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      },
      {
        channel: { kind: "run", runId: "run_01J" },
        lastEventId: reconnectLastEventId,
      },
    ).headers["Last-Event-ID"],
    "evt_2",
  );
  assert.deepEqual(replayState.recordEvent({ id: "evt_3" }), {
    mode: "ready",
    lastEventId: "evt_3",
    reconnectAttempt: 0,
  });
});

test("renderer runtime stream replay state maps replay miss to full reload", () => {
  const replayState = createRuntimeStreamReplayState({
    initialLastEventId: "evt_5",
  });

  assert.equal(
    isRuntimeStreamReplayNotFoundFailure({
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    }),
    true,
  );
  assert.deepEqual(
    replayState.handleConnectionFailure({
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
      reason: "Last-Event-ID was not found",
    }),
    {
      action: "full_reload",
      lastEventId: "evt_5",
      reason: "Last-Event-ID was not found",
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  );
  assert.deepEqual(replayState.snapshot(), {
    mode: "full_reload_required",
    lastEventId: "evt_5",
    reconnectAttempt: 0,
    reason: "Last-Event-ID was not found",
  });
  assert.deepEqual(replayState.reset(), {
    mode: "ready",
    lastEventId: null,
    reconnectAttempt: 0,
  });
});

test("renderer runtime stream replay state rejects unsafe replay inputs", () => {
  assert.throws(
    () => createRuntimeStreamReplayState({ defaultRetryMs: -1 }),
    /defaultRetryMs/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamReplayState({
        initialLastEventId: "evt_1\ninjected",
      }),
    /Last-Event-ID/u,
  );
  const replayState = createRuntimeStreamReplayState();
  assert.throws(() => replayState.recordEvent({ id: "" }), /Last-Event-ID/u);
  assert.throws(
    () => replayState.handleConnectionFailure({ retryAfterMs: 1.5 }),
    /retryAfterMs/u,
  );
});

test("renderer runtime stream reconnecting client replays tracked Last-Event-ID", async () => {
  const streamFactory = createFakeRuntimeStreamEventSourceFactory();
  const scheduler = createFakeRuntimeStreamReconnectScheduler();
  const decisions: unknown[] = [];
  const receivedEventIds: string[] = [];
  const client = await openRuntimeStreamReconnectingClient({
    runtime: {
      connectionInfo: async () => ({
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      }),
    },
    channel: { kind: "run", runId: "run_01J" },
    eventSourceFactory: streamFactory.factory,
    scheduler: scheduler.scheduler,
    onReplayDecision: (decision) => {
      decisions.push(decision);
    },
  });

  client.subscribe("model.text_delta", (event) => {
    receivedEventIds.push(event.id ?? "missing");
  });

  const source0 = streamFactory.sources.at(0);
  assert.ok(source0);
  source0.emit("model.text_delta", {
    data: JSON.stringify({
      type: "model.text_delta",
      event_id: "evt_1",
      content: "hello",
    }),
  });
  assert.deepEqual(receivedEventIds, ["evt_1"]);
  assert.deepEqual(client.replaySnapshot(), {
    mode: "ready",
    lastEventId: "evt_1",
    reconnectAttempt: 0,
  });

  source0.emit("error", {
    data: JSON.stringify({ reason: "network closed" }),
  });

  assert.equal(source0.closeCount(), 1);
  assert.deepEqual(decisions, [
    {
      action: "reconnect",
      lastEventId: "evt_1",
      attempt: 1,
      retryAfterMs: 3000,
    },
  ]);
  assert.deepEqual(client.replaySnapshot(), {
    mode: "reconnect_pending",
    lastEventId: "evt_1",
    reconnectAttempt: 1,
    retryAfterMs: 3000,
    reason: "network closed",
  });
  assert.equal(streamFactory.requests.length, 1);

  const scheduledReconnect = scheduler.scheduled.at(0);
  assert.ok(scheduledReconnect);
  assert.equal(scheduledReconnect.delayMs, 3000);
  assert.equal(scheduledReconnect.run(), true);
  await flushRuntimeStreamReconnect();

  assert.equal(streamFactory.requests.length, 2);
  const reconnectRequest = streamFactory.requests.at(1);
  assert.ok(reconnectRequest);
  assert.equal(reconnectRequest.headers["Last-Event-ID"], "evt_1");

  const source1 = streamFactory.sources.at(1);
  assert.ok(source1);
  source1.emit("model.text_delta", {
    data: JSON.stringify({
      type: "model.text_delta",
      event_id: "evt_2",
      content: "again",
    }),
  });
  assert.deepEqual(receivedEventIds, ["evt_1", "evt_2"]);
  assert.deepEqual(client.replaySnapshot(), {
    mode: "ready",
    lastEventId: "evt_2",
    reconnectAttempt: 0,
  });
  assert.equal(client.activeRequest()?.headers["Last-Event-ID"], "evt_1");
});

test("renderer runtime stream reconnecting client closes pending reconnects", async () => {
  const streamFactory = createFakeRuntimeStreamEventSourceFactory();
  const scheduler = createFakeRuntimeStreamReconnectScheduler();
  const client = await openRuntimeStreamReconnectingClient({
    runtime: {
      connectionInfo: async () => ({
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      }),
    },
    channel: { kind: "run", runId: "run_01J" },
    eventSourceFactory: streamFactory.factory,
    scheduler: scheduler.scheduler,
  });

  const source0 = streamFactory.sources.at(0);
  assert.ok(source0);
  source0.emit("error", { data: "temporary disconnect" });

  const scheduledReconnect = scheduler.scheduled.at(0);
  assert.ok(scheduledReconnect);
  assert.equal(client.close(), true);
  assert.equal(client.isClosed(), true);
  assert.equal(scheduledReconnect.cancelled, true);
  assert.equal(scheduledReconnect.run(), false);
  await flushRuntimeStreamReconnect();

  assert.equal(streamFactory.requests.length, 1);
  assert.equal(client.activeRequest(), null);
  assert.equal(client.close(), false);
});

test("renderer runtime stream reconnecting client maps replay miss to full reload", async () => {
  const streamFactory = createFakeRuntimeStreamEventSourceFactory();
  const scheduler = createFakeRuntimeStreamReconnectScheduler();
  const fullReloads: RuntimeStreamFullReloadDecision[] = [];
  const eventErrors: unknown[] = [];
  const client = await openRuntimeStreamReconnectingClient({
    runtime: {
      connectionInfo: async () => ({
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      }),
    },
    channel: { kind: "run", runId: "run_01J" },
    eventSourceFactory: streamFactory.factory,
    scheduler: scheduler.scheduler,
    onFullReloadRequired: (decision) => {
      fullReloads.push(decision);
      throw new Error("renderer reload hook failed");
    },
    onEventError: (error) => {
      eventErrors.push(error);
    },
  });

  const unsubscribe = client.subscribe("model.text_delta", () => undefined);

  const source0 = streamFactory.sources.at(0);
  assert.ok(source0);
  source0.emit("model.text_delta", {
    data: JSON.stringify({
      type: "model.text_delta",
      event_id: "evt_5",
      content: "before replay miss",
    }),
  });
  source0.emit("error", {
    data: JSON.stringify({
      status: 412,
      error_code: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
      reason: "Last-Event-ID was not found",
    }),
  });

  assert.equal(client.isClosed(), true);
  assert.equal(client.activeRequest(), null);
  assert.equal(source0.closeCount(), 1);
  assert.deepEqual(fullReloads, [
    {
      action: "full_reload",
      lastEventId: "evt_5",
      reason: "Last-Event-ID was not found",
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  ]);
  assert.equal(eventErrors.length, 1);
  assert.equal(scheduler.scheduled.length, 0);
  assert.deepEqual(client.replaySnapshot(), {
    mode: "full_reload_required",
    lastEventId: "evt_5",
    reconnectAttempt: 0,
    reason: "Last-Event-ID was not found",
  });
  assert.equal(unsubscribe(), false);
  assert.equal(client.close(), false);
});

test("renderer runtime stream event store records capped isolated snapshots", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const errors: unknown[] = [];
  const snapshots: RuntimeStreamEventStoreSnapshot[] = [];
  const store = createRuntimeStreamEventStore({
    clientOptions: createRuntimeStreamEventStoreClientOptions(),
    eventTypes: ["model.text_delta", "tool.call_started", "model.text_delta"],
    maxEvents: 2,
    clientFactory: clientFactory.factory,
    onError: (error) => {
      errors.push(error);
    },
  });

  assert.deepEqual(store.snapshot(), {
    status: "idle",
    events: [],
    totalEvents: 0,
  });
  const unsubscribeStore = store.subscribe((snapshot) => {
    snapshots.push(snapshot);
    if (snapshot.totalEvents === 2) {
      throw new Error("listener failed");
    }
  });

  assert.deepEqual(await store.start(), {
    status: "running",
    events: [],
    totalEvents: 0,
  });
  const client = clientFactory.clients.at(0);
  assert.ok(client);
  assert.equal(client.listenerCount("model.text_delta"), 1);
  assert.equal(client.listenerCount("tool.call_started"), 1);

  client.emit({
    id: "evt_1",
    type: "model.text_delta",
    data: { content: "one" },
    rawData: JSON.stringify({ event_id: "evt_1" }),
  });
  client.emit({
    id: "evt_2",
    type: "tool.call_started",
    data: { tool_name: "search" },
    rawData: JSON.stringify({ event_id: "evt_2" }),
  });
  const mutablePayload: Record<string, unknown> = { content: "three" };
  client.emit({
    id: "evt_3",
    type: "model.text_delta",
    data: mutablePayload,
    rawData: JSON.stringify({ event_id: "evt_3" }),
  });
  mutablePayload.content = "mutated source";

  const snapshot = store.snapshot();
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.totalEvents, 3);
  assert.deepEqual(
    snapshot.events.map((event) => event.id),
    ["evt_2", "evt_3"],
  );
  assert.notEqual(store.snapshot().events, store.snapshot().events);
  const snapshotPayload = snapshot.events.at(-1)?.data;
  assertRecordData(snapshotPayload);
  snapshotPayload.content = "mutated snapshot";
  assert.deepEqual(store.snapshot().events.at(-1)?.data, {
    content: "three",
  });
  assert.equal(errors.length, 1);
  assert.ok(snapshots.length >= 4);

  assert.equal(unsubscribeStore(), true);
  assert.equal(unsubscribeStore(), false);
  assert.equal(store.stop(), true);
  assert.equal(store.snapshot().status, "stopped");
  assert.equal(store.isStarted(), false);
  assert.equal(client.closeCount(), 1);
  assert.equal(client.listenerCount("model.text_delta"), 0);
  assert.equal(client.listenerCount("tool.call_started"), 0);
  assert.equal(store.stop(), false);
});

test("renderer runtime stream event store handles full reload terminal cleanup", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const upstreamReloads: RuntimeStreamFullReloadDecision[] = [];
  const errors: unknown[] = [];
  const store = createRuntimeStreamEventStore({
    clientOptions: createRuntimeStreamEventStoreClientOptions({
      onFullReloadRequired: (decision) => {
        upstreamReloads.push(decision);
        throw new Error("upstream full reload hook failed");
      },
    }),
    eventTypes: ["model.text_delta"],
    clientFactory: clientFactory.factory,
    onError: (error) => {
      errors.push(error);
    },
  });

  await store.start();
  const client = clientFactory.clients.at(0);
  assert.ok(client);
  client.emit({
    id: "evt_5",
    type: "model.text_delta",
    data: { content: "before reload" },
    rawData: JSON.stringify({ event_id: "evt_5" }),
  });
  client.fullReload({
    action: "full_reload",
    lastEventId: "evt_5",
    reason: "Last-Event-ID was not found",
    status: 412,
    errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
  });

  assert.equal(client.closeCount(), 1);
  assert.equal(client.listenerCount("model.text_delta"), 0);
  assert.deepEqual(upstreamReloads, [
    {
      action: "full_reload",
      lastEventId: "evt_5",
      reason: "Last-Event-ID was not found",
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  ]);
  assert.equal(errors.length, 1);
  assert.deepEqual(store.snapshot(), {
    status: "full_reload_required",
    events: [
      {
        id: "evt_5",
        type: "model.text_delta",
        data: { content: "before reload" },
        rawData: JSON.stringify({ event_id: "evt_5" }),
      },
    ],
    totalEvents: 1,
    fullReloadDecision: {
      action: "full_reload",
      lastEventId: "evt_5",
      reason: "Last-Event-ID was not found",
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  });
  assert.equal(store.isStarted(), false);
  assert.equal(store.stop(), false);

  const blockedRestart = await store.start();
  assert.equal(blockedRestart.status, "full_reload_required");
  assert.equal(clientFactory.clients.length, 1);

  const resetSnapshot = store.resetFullReloadRequired();
  assert.deepEqual(resetSnapshot, {
    status: "idle",
    events: [],
    totalEvents: 0,
  });
  assert.deepEqual(store.resetFullReloadRequired(), resetSnapshot);

  const restarted = await store.start();
  assert.equal(restarted.status, "running");
  assert.equal(clientFactory.clients.length, 2);
  const restartedClient = clientFactory.clients.at(1);
  assert.ok(restartedClient);
  assert.equal(restartedClient.listenerCount("model.text_delta"), 1);
  assert.equal(store.stop(), true);
});

test("renderer runtime stream event store stops on page lifecycle", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const lifecycle = createFakeRuntimeStreamEventStorePageLifecycleTarget();
  const store = createRuntimeStreamEventStore({
    clientOptions: createRuntimeStreamEventStoreClientOptions(),
    eventTypes: ["model.text_delta"],
    clientFactory: clientFactory.factory,
  });

  await store.start();
  const client = clientFactory.clients.at(0);
  assert.ok(client);
  const dispose = bindRuntimeStreamEventStoreToPageLifecycle(store, lifecycle, {
    eventType: "pagehide",
  });
  assert.equal(lifecycle.listenerCount("pagehide"), 1);
  lifecycle.emit("pagehide");

  assert.equal(store.snapshot().status, "stopped");
  assert.equal(client.closeCount(), 1);
  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.equal(lifecycle.listenerCount("pagehide"), 0);
});

test("renderer runtime stream event store rejects unsafe options", () => {
  assert.throws(
    () =>
      createRuntimeStreamEventStore({
        clientOptions: createRuntimeStreamEventStoreClientOptions(),
        eventTypes: [],
      }),
    /at least one event type/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamEventStore({
        clientOptions: createRuntimeStreamEventStoreClientOptions(),
        eventTypes: ["bad type"],
      }),
    /event type/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamEventStore({
        clientOptions: createRuntimeStreamEventStoreClientOptions(),
        eventTypes: ["model.text_delta"],
        maxEvents: 0,
      }),
    /maxEvents/u,
  );
});

test("renderer runtime stream view model folds children and filters spec fields", () => {
  const store = createFakeRuntimeStreamViewModelStore({
    status: "running",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_tool_start",
        seq: 1,
        type: "tool.call_started",
        category: "tool",
        display_level: "default",
        severity: "info",
        title: "Calling tool",
        summary: "evidence_lookup",
        expandable: true,
        payload: { tool_name: "evidence_lookup" },
        artifact_refs: [],
        created_at: "2026-06-21T00:00:00.001Z",
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_tool_done",
        seq: 2,
        parent_event_id: "evt_tool_start",
        type: "tool.call_completed",
        category: "tool",
        display_level: "detailed",
        severity: "success",
        title: "Tool completed",
        expandable: true,
        payload: { output_size: 42 },
        created_at: "2026-06-21T00:00:00.002Z",
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_model_delta",
        seq: 3,
        type: "model.text_delta",
        category: "model",
        display_level: "minimal",
        severity: "info",
        title: "Model text",
        content: "hello",
        expandable: false,
        payload: { content: "hello" },
        created_at: "2026-06-21T00:00:00.003Z",
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_orphan_eval",
        seq: 4,
        parent_event_id: "evt_missing",
        type: "evaluation.completed",
        category: "evaluation",
        display_level: "default",
        severity: "success",
        title: "Evaluation completed",
        expandable: false,
        payload: { passed: true },
        created_at: "2026-06-21T00:00:00.004Z",
      }),
    ],
    totalEvents: 4,
  });
  const viewModel = createRuntimeStreamViewModel({ store: store.store });

  const initial = viewModel.snapshot();
  assert.equal(initial.status, "running");
  assert.equal(initial.bufferedEventCount, 4);
  assert.equal(initial.matchingEventCount, 4);
  assert.equal(initial.visibleEventCount, 3);
  assert.equal(initial.foldedChildCount, 1);
  assert.equal(initial.summaryItems.length, 1);
  assert.equal(initial.summaryItems[0]?.id, "evt_model_delta");
  assert.equal(initial.timelineItems.length, 2);
  assert.equal(initial.timelineItems[0]?.id, "evt_tool_start");
  assert.equal(initial.timelineItems[0]?.childCount, 1);
  assert.equal(initial.timelineItems[0]?.children.length, 0);
  assert.equal(initial.timelineItems[1]?.id, "evt_orphan_eval");

  const expanded = viewModel.toggleExpanded("evt_tool_start");
  assert.equal(expanded.timelineItems[0]?.expanded, true);
  assert.equal(expanded.timelineItems[0]?.children.length, 1);
  assert.equal(expanded.timelineItems[0]?.children[0]?.id, "evt_tool_done");
  assert.equal(expanded.visibleEventCount, 4);
  assert.equal(expanded.foldedChildCount, 0);

  const filtered = viewModel.setFilters({
    categories: ["tool"],
    displayLevels: ["default"],
  });
  assert.deepEqual(filtered.filters, {
    categories: ["tool"],
    displayLevels: ["default"],
  });
  assert.equal(filtered.summaryItems.length, 0);
  assert.equal(filtered.timelineItems.length, 1);
  assert.equal(filtered.timelineItems[0]?.id, "evt_tool_start");
  assert.equal(filtered.timelineItems[0]?.childCount, 0);
  assert.equal(filtered.hiddenEventCount, 3);
});

test("renderer runtime stream view model publishes isolated snapshots and full reload state", () => {
  const errors: unknown[] = [];
  const published: RuntimeStreamViewModelSnapshot[] = [];
  const store = createFakeRuntimeStreamViewModelStore({
    status: "running",
    events: [],
    totalEvents: 0,
  });
  const viewModel = createRuntimeStreamViewModel({
    store: store.store,
    onError: (error) => {
      errors.push(error);
    },
  });
  const unsubscribe = viewModel.subscribe((snapshot) => {
    published.push(snapshot);
    throw new Error("view listener failed");
  });

  store.emit({
    status: "full_reload_required",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_replay_miss",
        seq: 5,
        type: "system.runtime_ready",
        category: "system",
        display_level: "default",
        severity: "warning",
        title: "Replay point missing",
        expandable: true,
        payload: { reason: "Last-Event-ID was not found" },
        created_at: "2026-06-21T00:00:00.005Z",
      }),
    ],
    totalEvents: 5,
    fullReloadDecision: {
      action: "full_reload",
      lastEventId: "evt_replay_miss",
      reason: "Last-Event-ID was not found",
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  });

  assert.equal(errors.length, 1);
  assert.equal(published.length, 1);
  const snapshot = viewModel.snapshot();
  assert.equal(snapshot.fullReloadRequired, true);
  assert.deepEqual(snapshot.fullReloadDecision, {
    action: "full_reload",
    lastEventId: "evt_replay_miss",
    reason: "Last-Event-ID was not found",
    status: 412,
    errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
  });
  const payload = snapshot.timelineItems[0]?.payload;
  assertRecordData(payload);
  payload.reason = "mutated snapshot";
  assert.deepEqual(viewModel.snapshot().timelineItems[0]?.payload, {
    reason: "Last-Event-ID was not found",
  });
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
});

test("renderer runtime stream view model disposes and rejects unsafe options", () => {
  const store = createFakeRuntimeStreamViewModelStore({
    status: "running",
    events: [],
    totalEvents: 0,
  });
  const viewModel = createRuntimeStreamViewModel({ store: store.store });
  let publishCount = 0;
  viewModel.subscribe(() => {
    publishCount += 1;
  });
  assert.equal(store.listenerCount(), 1);
  assert.equal(viewModel.dispose(), true);
  assert.equal(viewModel.dispose(), false);
  assert.equal(store.listenerCount(), 0);

  store.emit({
    status: "running",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_after_dispose",
        type: "model.text_delta",
        category: "model",
        display_level: "minimal",
        severity: "info",
        title: "After dispose",
        expandable: false,
      }),
    ],
    totalEvents: 1,
  });
  assert.equal(publishCount, 0);
  assert.equal(viewModel.subscribe(() => undefined)(), false);

  assert.throws(
    () =>
      createRuntimeStreamViewModel({
        store: store.store,
        filters: {
          displayLevels: ["verbose" as RuntimeStreamViewDisplayLevel],
        },
      }),
    /display level/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamViewModel({
        store: store.store,
        filters: {
          categories: ["unsafe" as RuntimeStreamViewCategory],
        },
      }),
    /category/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamViewModel({
        store: store.store,
        filters: {
          categories: ["evidence" as RuntimeStreamViewCategory],
        },
      }),
    /category/u,
  );
  assert.throws(() => viewModel.toggleExpanded("bad id"), /event id/u);
});

test("renderer runtime stream interaction searches and selects visible events", () => {
  const store = createFakeRuntimeStreamViewModelStore({
    status: "running",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_tool_start",
        seq: 1,
        type: "tool.call_started",
        category: "tool",
        display_level: "default",
        severity: "info",
        title: "Calling tool",
        summary: "evidence_lookup",
        expandable: true,
        payload: { tool_name: "evidence_lookup" },
        artifact_refs: [],
        created_at: "2026-06-21T00:00:00.001Z",
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_tool_done",
        seq: 2,
        parent_event_id: "evt_tool_start",
        type: "tool.call_completed",
        category: "tool",
        display_level: "detailed",
        severity: "success",
        title: "Tool completed",
        content: "Completed after approval",
        expandable: true,
        payload: { output_size: 42 },
        created_at: "2026-06-21T00:00:00.002Z",
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_system_ready",
        seq: 3,
        type: "system.runtime_ready",
        category: "system",
        display_level: "default",
        severity: "info",
        title: "Runtime ready",
        content: "Tool subscriptions are ready",
        expandable: false,
        created_at: "2026-06-21T00:00:00.003Z",
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_metric_snapshot",
        seq: 4,
        type: "metric.snapshot",
        category: "metric",
        display_level: "default",
        severity: "info",
        title: "Metrics updated",
        expandable: false,
        payload: { hidden_search_text: "payload-only-secret" },
        created_at: "2026-06-21T00:00:00.004Z",
      }),
    ],
    totalEvents: 4,
  });
  const viewModel = createRuntimeStreamViewModel({ store: store.store });
  const interaction = createRuntimeStreamInteraction({
    viewModel,
  });

  const searched = interaction.setSearchQuery("tool");
  assert.equal(searched.search.query, "tool");
  assert.deepEqual(
    searched.search.matches.map((match) => match.eventId),
    ["evt_tool_start", "evt_system_ready"],
  );
  assert.deepEqual(searched.search.matches[0]?.fields, [
    "id",
    "type",
    "category",
    "title",
  ]);
  assert.equal(searched.search.activeEventId, "evt_tool_start");

  const selected = interaction.selectActiveSearchMatch();
  assert.equal(selected.selectedEventId, "evt_tool_start");
  assert.equal(
    interaction.setSearchQuery("payload-only-secret").search.matches.length,
    0,
  );

  const next = interaction.nextSearchMatch();
  assert.equal(next.search.activeMatchIndex, null);
  assert.equal(next.search.activeEventId, null);
  interaction.setSearchQuery("tool");
  assert.equal(
    interaction.nextSearchMatch().search.activeEventId,
    "evt_system_ready",
  );
  const previous = interaction.previousSearchMatch();
  assert.equal(previous.search.activeMatchIndex, 0);
  assert.equal(previous.search.activeEventId, "evt_tool_start");

  assert.equal(
    interaction.setSearchQuery("completed").search.matches.length,
    0,
  );
  const expanded = interaction.toggleExpanded("evt_tool_start");
  assert.equal(expanded.view.timelineItems[0]?.expanded, true);
  assert.deepEqual(
    interaction
      .setSearchQuery("completed")
      .search.matches.map((match) => match.eventId),
    ["evt_tool_done"],
  );
});

test("renderer runtime stream interaction tracks unread events and full reload acknowledgement", () => {
  const store = createFakeRuntimeStreamViewModelStore({
    status: "running",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_run_started",
        seq: 1,
        type: "run.started",
        category: "lifecycle",
        display_level: "default",
        severity: "info",
        title: "Run started",
        expandable: false,
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_model_delta",
        seq: 2,
        type: "model.text_delta",
        category: "model",
        display_level: "minimal",
        severity: "info",
        title: "Model text",
        content: "hello",
        expandable: false,
      }),
    ],
    totalEvents: 2,
  });
  const viewModel = createRuntimeStreamViewModel({ store: store.store });
  const interaction = createRuntimeStreamInteraction({ viewModel });

  assert.deepEqual(interaction.snapshot().read, {
    lastSeenTotalEvents: 2,
    unreadCount: 0,
  });

  store.emit({
    status: "running",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_run_started",
        seq: 1,
        type: "run.started",
        category: "lifecycle",
        display_level: "default",
        severity: "info",
        title: "Run started",
        expandable: false,
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_model_delta",
        seq: 2,
        type: "model.text_delta",
        category: "model",
        display_level: "minimal",
        severity: "info",
        title: "Model text",
        content: "hello",
        expandable: false,
      }),
      createRuntimeStreamViewModelEvent({
        event_id: "evt_tool_start",
        seq: 3,
        type: "tool.call_started",
        category: "tool",
        display_level: "default",
        severity: "info",
        title: "Calling tool",
        expandable: true,
      }),
    ],
    totalEvents: 5,
  });
  assert.deepEqual(interaction.snapshot().read, {
    lastSeenTotalEvents: 2,
    unreadCount: 3,
  });
  assert.deepEqual(interaction.markAllRead().read, {
    lastSeenTotalEvents: 5,
    unreadCount: 0,
  });

  store.emit({
    status: "full_reload_required",
    events: [],
    totalEvents: 5,
    fullReloadDecision: {
      action: "full_reload",
      lastEventId: "evt_missing",
      reason: "Last-Event-ID was not found",
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  });
  assert.equal(interaction.snapshot().fullReloadAcknowledged, false);
  assert.equal(
    interaction.acknowledgeFullReload().fullReloadAcknowledged,
    true,
  );

  store.emit({
    status: "full_reload_required",
    events: [],
    totalEvents: 6,
    fullReloadDecision: {
      action: "full_reload",
      lastEventId: "evt_new_missing",
      reason: "Last-Event-ID was not found",
      status: 412,
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  });
  assert.equal(interaction.snapshot().fullReloadAcknowledged, false);
});

test("renderer runtime stream interaction isolates listener errors and rejects unsafe inputs", () => {
  const errors: unknown[] = [];
  const published: RuntimeStreamInteractionSnapshot[] = [];
  const store = createFakeRuntimeStreamViewModelStore({
    status: "running",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_system_ready",
        seq: 1,
        type: "system.runtime_ready",
        category: "system",
        display_level: "default",
        severity: "info",
        title: "Runtime ready",
        expandable: false,
      }),
    ],
    totalEvents: 1,
  });
  const viewModel = createRuntimeStreamViewModel({ store: store.store });
  const interaction = createRuntimeStreamInteraction({
    viewModel,
    onError: (error) => {
      errors.push(error);
    },
  });
  interaction.subscribe((snapshot) => {
    published.push(snapshot);
    throw new Error("interaction listener failed");
  });

  assert.equal(viewModel.listenerCount(), 1);
  interaction.setSearchQuery("ready");
  assert.equal(errors.length, 1);
  assert.equal(published.length, 1);
  assert.throws(() => interaction.setSearchQuery("bad\nquery"), /query/u);
  assert.throws(
    () => interaction.setSearchQuery("x".repeat(201)),
    /at most 200/u,
  );
  assert.throws(() => interaction.selectEvent("bad id"), /event id/u);
  assert.throws(() => interaction.selectEvent("evt_missing"), /not visible/u);
  assert.throws(
    () =>
      createRuntimeStreamInteraction({
        viewModel,
        selectedEventId: "evt_missing",
      }),
    /not visible/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamInteraction({
        viewModel,
        lastSeenTotalEvents: -1,
      }),
    /lastSeenTotalEvents/u,
  );

  assert.equal(interaction.dispose(), true);
  assert.equal(interaction.dispose(), false);
  assert.equal(viewModel.listenerCount(), 0);
  assert.equal(interaction.subscribe(() => undefined)(), false);

  store.emit({
    status: "running",
    events: [
      createRuntimeStreamViewModelEvent({
        event_id: "evt_after_dispose",
        seq: 2,
        type: "system.heartbeat",
        category: "system",
        display_level: "minimal",
        severity: "info",
        title: "Heartbeat",
        expandable: false,
      }),
    ],
    totalEvents: 2,
  });
  assert.equal(published.length, 1);
});

test("renderer runtime stream session composes store view model and interaction", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const session = createRuntimeStreamInteractionSession({
    clientOptions: createRuntimeStreamEventStoreClientOptions(),
    clientFactory: clientFactory.factory,
    eventTypes: ["model.text_delta", "tool.call_started", "model.text_delta"],
    searchQuery: "hello",
  });

  assert.deepEqual(session.eventTypes, [
    "model.text_delta",
    "tool.call_started",
  ]);
  assert.equal(session.store.listenerCount(), 1);
  assert.equal(session.viewModel.listenerCount(), 1);
  assert.equal(session.interaction.listenerCount(), 0);

  const started = await session.start();
  assert.equal(started.store.status, "running");
  const client = clientFactory.clients[0];
  assert.ok(client !== undefined);
  assert.equal(client.listenerCount("model.text_delta"), 1);
  assert.equal(client.listenerCount("tool.call_started"), 1);

  client.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_model_delta",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Model text",
      content: "hello world",
      expandable: false,
      payload: { hidden_search_text: "payload-only-secret" },
      artifact_refs: [],
      created_at: "2026-06-21T00:00:00.001Z",
    }),
  );

  const snapshot = session.snapshot();
  assert.equal(snapshot.store.totalEvents, 1);
  assert.equal(snapshot.interaction.view.visibleEventCount, 1);
  assert.deepEqual(
    snapshot.interaction.search.matches.map((match) => match.eventId),
    ["evt_model_delta"],
  );
  assert.equal(snapshot.interaction.search.activeEventId, "evt_model_delta");
  assert.equal(
    session.interaction.selectActiveSearchMatch().selectedEventId,
    "evt_model_delta",
  );
  assert.equal(
    session.interaction.setSearchQuery("payload-only-secret").search.matches
      .length,
    0,
  );

  assert.equal(session.dispose(), true);
});

test("renderer runtime stream session publishes unified snapshots", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const errors: unknown[] = [];
  const session = createRuntimeStreamInteractionSession({
    clientOptions: createRuntimeStreamEventStoreClientOptions(),
    clientFactory: clientFactory.factory,
    eventTypes: ["model.text_delta"],
    onError: (error) => {
      errors.push(error);
    },
  });
  const published: number[] = [];

  assert.equal(session.listenerCount(), 0);
  assert.equal(session.interaction.listenerCount(), 0);
  const unsubscribeThrowing = session.subscribe(() => {
    throw new Error("session listener failed");
  });
  const unsubscribe = session.subscribe((snapshot) => {
    published.push(snapshot.store.totalEvents);
  });
  assert.equal(session.listenerCount(), 2);
  assert.equal(session.interaction.listenerCount(), 1);

  await session.start();
  const client = clientFactory.clients[0];
  assert.ok(client !== undefined);
  client.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_session_publish",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Session publish",
      content: "published content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.003Z",
    }),
  );

  assert.ok(published.includes(1));
  assert.equal(errors.length > 0, true);
  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(session.listenerCount(), 1);
  assert.equal(session.interaction.listenerCount(), 1);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.interaction.listenerCount(), 0);
  assert.equal(session.dispose(), true);
  assert.equal(session.subscribe(() => undefined)(), false);
});

test("renderer runtime stream session factory builds runtime-backed sessions", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const eventSourceFactory = () => createFakeRuntimeStreamEventSource().source;
  const runtime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_factory",
    }),
  };
  const sessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime,
    eventSourceFactory,
    projectId: "project_default",
    filters: { category: "model" },
  });

  const session = sessionFactory.createSession({
    channel: { kind: "planning", sessionId: "wps_01J" },
    projectId: "project_planning",
    filters: { category: "planning", level: ["default", "detailed"] },
    clientFactory: clientFactory.factory,
    eventTypes: ["planning.session_started"],
    searchQuery: "draft",
  });

  assert.deepEqual(session.eventTypes, ["planning.session_started"]);
  await session.start();
  const clientOptions = clientFactory.options[0];
  assert.ok(clientOptions !== undefined);
  assert.equal(clientOptions.runtime, runtime);
  assert.equal(clientOptions.eventSourceFactory, eventSourceFactory);
  assert.deepEqual(clientOptions.channel, {
    kind: "planning",
    sessionId: "wps_01J",
  });
  assert.equal(clientOptions.projectId, "project_planning");
  assert.deepEqual(clientOptions.filters, {
    category: "planning",
    level: ["default", "detailed"],
  });
  assert.equal(session.snapshot().interaction.search.query, "draft");
  assert.equal(session.dispose(), true);

  assert.throws(
    () =>
      sessionFactory.createSession({
        channel: { kind: "run", runId: "run_01J" },
        eventTypes: ["model.fake" as RuntimeStreamKnownEventType],
      }),
    /StreamEvent spec/u,
  );
});

test("renderer runtime stream session factory applies default stream controls", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const scheduler = createFakeRuntimeStreamReconnectScheduler();
  const eventSourceFactory = () => createFakeRuntimeStreamEventSource().source;
  const runtime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_factory",
    }),
  };
  const eventErrors: unknown[] = [];
  const connectionErrors: unknown[] = [];
  const replayDecisions: unknown[] = [];
  const fullReloads: RuntimeStreamFullReloadDecision[] = [];
  const sessionErrors: unknown[] = [];
  const onEventError = (error: unknown) => {
    eventErrors.push(error);
  };
  const onConnectionError = (error: unknown) => {
    connectionErrors.push(error);
  };
  const onReplayDecision = (decision: unknown) => {
    replayDecisions.push(decision);
  };
  const onFullReloadRequired = (decision: RuntimeStreamFullReloadDecision) => {
    fullReloads.push(decision);
  };
  const sessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime,
    eventSourceFactory,
    projectId: "project_default",
    filters: { category: ["model", "tool"], level: "detailed", sinceSeq: 7 },
    scheduler: scheduler.scheduler,
    onEventError,
    onConnectionError,
    onReplayDecision,
    onFullReloadRequired,
    onError: (error) => {
      sessionErrors.push(error);
    },
  });

  const session = sessionFactory.createSession({
    channel: { kind: "run", runId: "run_01J" },
    clientFactory: clientFactory.factory,
    eventTypes: ["model.text_delta"],
  });

  await session.start();
  const clientOptions = clientFactory.options[0];
  assert.ok(clientOptions !== undefined);
  assert.equal(clientOptions.runtime, runtime);
  assert.equal(clientOptions.eventSourceFactory, eventSourceFactory);
  assert.deepEqual(clientOptions.channel, { kind: "run", runId: "run_01J" });
  assert.equal(clientOptions.projectId, "project_default");
  assert.deepEqual(clientOptions.filters, {
    category: ["model", "tool"],
    level: "detailed",
    sinceSeq: 7,
  });
  assert.equal(clientOptions.scheduler, scheduler.scheduler);
  assert.equal(clientOptions.replayState, undefined);
  assert.equal(clientOptions.onEventError, onEventError);
  assert.equal(clientOptions.onConnectionError, onConnectionError);
  assert.equal(clientOptions.onReplayDecision, onReplayDecision);

  clientOptions.onEventError?.(new Error("default event hook"));
  clientOptions.onConnectionError?.(new Error("default connection hook"));
  clientOptions.onReplayDecision?.({
    action: "reconnect",
    lastEventId: "evt_factory_default",
    attempt: 1,
    retryAfterMs: 3000,
  });
  assert.equal(eventErrors.length, 1);
  assert.equal(connectionErrors.length, 1);
  assert.deepEqual(replayDecisions, [
    {
      action: "reconnect",
      lastEventId: "evt_factory_default",
      attempt: 1,
      retryAfterMs: 3000,
    },
  ]);

  session.subscribe(() => {
    throw new Error("default onError failed");
  });
  const client = clientFactory.clients[0];
  assert.ok(client !== undefined);
  client.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_factory_default_emit",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Factory default emit",
      content: "default",
      expandable: false,
      created_at: "2026-06-21T00:00:00.004Z",
    }),
  );
  assert.equal(sessionErrors.length, 1);

  client.fullReload({
    action: "full_reload",
    lastEventId: "evt_factory_default_emit",
    reason: "replay point missing",
    status: 412,
  });
  assert.deepEqual(fullReloads, [
    {
      action: "full_reload",
      lastEventId: "evt_factory_default_emit",
      reason: "replay point missing",
      status: 412,
    },
  ]);
  assert.equal(session.snapshot().store.status, "full_reload_required");
  assert.equal(session.dispose(), true);
});

test("renderer runtime stream session factory lets sessions override stream controls", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const factoryScheduler = createFakeRuntimeStreamReconnectScheduler();
  const sessionScheduler = createFakeRuntimeStreamReconnectScheduler();
  const sessionReplayState = createRuntimeStreamReplayState({
    initialLastEventId: "evt_session_override",
  });
  const eventSourceFactory = () => createFakeRuntimeStreamEventSource().source;
  const runtime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_factory",
    }),
  };
  const factorySessionErrors: unknown[] = [];
  const sessionErrors: unknown[] = [];
  const sessionEventErrors: unknown[] = [];
  const sessionConnectionErrors: unknown[] = [];
  const sessionReplayDecisions: unknown[] = [];
  const sessionFullReloads: RuntimeStreamFullReloadDecision[] = [];
  const sessionOnEventError = (error: unknown) => {
    sessionEventErrors.push(error);
  };
  const sessionOnConnectionError = (error: unknown) => {
    sessionConnectionErrors.push(error);
  };
  const sessionOnReplayDecision = (decision: unknown) => {
    sessionReplayDecisions.push(decision);
  };
  const sessionOnFullReloadRequired = (
    decision: RuntimeStreamFullReloadDecision,
  ) => {
    sessionFullReloads.push(decision);
  };
  const sessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime,
    eventSourceFactory,
    projectId: "project_default",
    filters: { category: "model" },
    scheduler: factoryScheduler.scheduler,
    onEventError: () => {
      throw new Error("factory event hook should be overridden");
    },
    onConnectionError: () => {
      throw new Error("factory connection hook should be overridden");
    },
    onReplayDecision: () => {
      throw new Error("factory replay hook should be overridden");
    },
    onFullReloadRequired: () => {
      throw new Error("factory reload hook should be overridden");
    },
    onError: (error) => {
      factorySessionErrors.push(error);
    },
  });

  const session = sessionFactory.createSession({
    channel: { kind: "planning", sessionId: "wps_override" },
    projectId: "project_session",
    filters: { category: "planning", untilSeq: 99 },
    clientFactory: clientFactory.factory,
    eventTypes: ["planning.phase_changed"],
    replayState: sessionReplayState,
    scheduler: sessionScheduler.scheduler,
    onEventError: sessionOnEventError,
    onConnectionError: sessionOnConnectionError,
    onReplayDecision: sessionOnReplayDecision,
    onFullReloadRequired: sessionOnFullReloadRequired,
    onError: (error) => {
      sessionErrors.push(error);
    },
  });

  await session.start();
  const clientOptions = clientFactory.options[0];
  assert.ok(clientOptions !== undefined);
  assert.deepEqual(clientOptions.channel, {
    kind: "planning",
    sessionId: "wps_override",
  });
  assert.equal(clientOptions.projectId, "project_session");
  assert.deepEqual(clientOptions.filters, {
    category: "planning",
    untilSeq: 99,
  });
  assert.equal(clientOptions.scheduler, sessionScheduler.scheduler);
  assert.equal(clientOptions.replayState, sessionReplayState);
  assert.equal(clientOptions.onEventError, sessionOnEventError);
  assert.equal(clientOptions.onConnectionError, sessionOnConnectionError);
  assert.equal(clientOptions.onReplayDecision, sessionOnReplayDecision);

  clientOptions.onEventError?.(new Error("session event hook"));
  clientOptions.onConnectionError?.(new Error("session connection hook"));
  clientOptions.onReplayDecision?.({
    action: "reconnect",
    lastEventId: "evt_session_override",
    attempt: 2,
    retryAfterMs: 1500,
  });
  assert.equal(sessionEventErrors.length, 1);
  assert.equal(sessionConnectionErrors.length, 1);
  assert.deepEqual(sessionReplayDecisions, [
    {
      action: "reconnect",
      lastEventId: "evt_session_override",
      attempt: 2,
      retryAfterMs: 1500,
    },
  ]);

  session.subscribe(() => {
    throw new Error("session onError failed");
  });
  const client = clientFactory.clients[0];
  assert.ok(client !== undefined);
  client.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_session_override_emit",
      seq: 1,
      type: "planning.phase_changed",
      category: "planning",
      display_level: "default",
      severity: "info",
      title: "Session override emit",
      expandable: false,
      created_at: "2026-06-21T00:00:00.005Z",
    }),
  );
  assert.equal(sessionErrors.length, 1);
  assert.equal(factorySessionErrors.length, 0);

  client.fullReload({
    action: "full_reload",
    lastEventId: "evt_session_override_emit",
    reason: "session replay point missing",
    errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
  });
  assert.deepEqual(sessionFullReloads, [
    {
      action: "full_reload",
      lastEventId: "evt_session_override_emit",
      reason: "session replay point missing",
      errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
    },
  ]);
  assert.equal(session.snapshot().store.status, "full_reload_required");
  assert.equal(session.dispose(), true);
});

test("renderer runtime stream session controller replaces active sessions", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const eventSourceFactory = () => createFakeRuntimeStreamEventSource().source;
  const runtime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_controller",
    }),
  };
  const sessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime,
    eventSourceFactory,
    projectId: "project_controller",
  });
  const controller = createRuntimeStreamInteractionSessionController({
    factory: sessionFactory,
  });
  const runChannel: { kind: "run"; runId: string } = {
    kind: "run",
    runId: "run_controller",
  };
  const runSession = controller.openSession({
    channel: runChannel,
    clientFactory: clientFactory.factory,
    eventTypes: ["model.text_delta"],
  });

  assert.equal(controller.activeSession(), runSession);
  assert.deepEqual(controller.activeChannel(), {
    kind: "run",
    runId: "run_controller",
  });
  runChannel.runId = "run_mutated";
  assert.deepEqual(controller.activeChannel(), {
    kind: "run",
    runId: "run_controller",
  });
  await runSession.start();
  const runClient = clientFactory.clients[0];
  assert.ok(runClient !== undefined);
  assert.equal(runClient.listenerCount("model.text_delta"), 1);
  assert.equal(runClient.closeCount(), 0);

  const planningChannel: { kind: "planning"; sessionId: string } = {
    kind: "planning",
    sessionId: "wps_controller",
  };
  const planningSession = controller.openSession({
    channel: planningChannel,
    clientFactory: clientFactory.factory,
    eventTypes: ["planning.session_started"],
    searchQuery: "draft",
  });

  assert.equal(controller.activeSession(), planningSession);
  assert.deepEqual(controller.activeChannel(), {
    kind: "planning",
    sessionId: "wps_controller",
  });
  planningChannel.sessionId = "wps_mutated";
  assert.deepEqual(controller.activeChannel(), {
    kind: "planning",
    sessionId: "wps_controller",
  });
  assert.equal(runSession.dispose(), false);
  assert.equal(runClient.closeCount(), 1);

  await planningSession.start();
  const planningClientOptions = clientFactory.options[1];
  assert.ok(planningClientOptions !== undefined);
  assert.deepEqual(planningClientOptions.channel, {
    kind: "planning",
    sessionId: "wps_controller",
  });
  assert.equal(planningSession.snapshot().interaction.search.query, "draft");

  assert.equal(controller.disposeActiveSession(), true);
  assert.equal(planningSession.dispose(), false);
  assert.equal(controller.activeSession(), null);
  assert.equal(controller.activeChannel(), null);
  assert.equal(controller.disposeActiveSession(), false);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.isDisposed(), true);
  assert.throws(
    () =>
      controller.openSession({
        channel: { kind: "run", runId: "run_after_dispose" },
      }),
    /controller is disposed/u,
  );
});

test("renderer runtime stream session controller keeps active session on create failure", () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const eventSourceFactory = () => createFakeRuntimeStreamEventSource().source;
  const runtime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_controller",
    }),
  };
  const sessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime,
    eventSourceFactory,
  });
  const controller = createRuntimeStreamInteractionSessionController({
    factory: sessionFactory,
  });
  const runSession = controller.openSession({
    channel: { kind: "run", runId: "run_stable" },
    clientFactory: clientFactory.factory,
    eventTypes: ["model.text_delta"],
  });

  assert.throws(
    () =>
      controller.openSession({
        channel: { kind: "run", runId: "run_invalid" },
        eventTypes: ["model.fake" as RuntimeStreamKnownEventType],
      }),
    /StreamEvent spec/u,
  );
  assert.equal(controller.activeSession(), runSession);
  assert.deepEqual(controller.activeChannel(), {
    kind: "run",
    runId: "run_stable",
  });
  assert.equal(controller.disposeActiveSession(), true);
  assert.equal(runSession.dispose(), false);
});

test("renderer runtime stream session controller publishes active session snapshots", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const eventSourceFactory = () => createFakeRuntimeStreamEventSource().source;
  const runtime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_controller",
    }),
  };
  const sessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime,
    eventSourceFactory,
  });
  const errors: unknown[] = [];
  const controller = createRuntimeStreamInteractionSessionController({
    factory: sessionFactory,
    onError: (error) => {
      errors.push(error);
    },
  });
  const published: Array<ReturnType<typeof controller.snapshot>> = [];
  const unsubscribeThrowing = controller.subscribe(() => {
    throw new Error("controller listener failed");
  });
  const unsubscribe = controller.subscribe((snapshot) => {
    published.push(snapshot);
  });

  assert.equal(controller.listenerCount(), 2);
  assert.deepEqual(controller.snapshot(), {
    activeChannel: null,
    activeSession: null,
    disposed: false,
  });

  const runSession = controller.openSession({
    channel: { kind: "run", runId: "run_observed" },
    clientFactory: clientFactory.factory,
    eventTypes: ["model.text_delta"],
  });

  assert.equal(errors.length, 1);
  assert.equal(published.length, 1);
  assert.equal(runSession.listenerCount(), 1);
  assert.deepEqual(published[0]?.activeChannel, {
    kind: "run",
    runId: "run_observed",
  });
  assert.equal(published[0]?.activeSession?.store.status, "idle");

  await runSession.start();
  const runClient = clientFactory.clients[0];
  assert.ok(runClient !== undefined);
  runClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_controller_observed",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Controller observed",
      content: "observed content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.006Z",
    }),
  );

  assert.equal(published.at(-1)?.activeSession?.store.totalEvents, 1);
  assert.equal(
    published.at(-1)?.activeSession?.interaction.read.unreadCount,
    1,
  );
  assert.equal(errors.length >= 2, true);

  const planningSession = controller.openSession({
    channel: { kind: "planning", sessionId: "wps_observed" },
    clientFactory: clientFactory.factory,
    eventTypes: ["planning.session_started"],
  });
  assert.equal(runSession.listenerCount(), 0);
  assert.equal(runClient.listenerCount("model.text_delta"), 0);
  assert.equal(planningSession.listenerCount(), 1);
  assert.deepEqual(published.at(-1)?.activeChannel, {
    kind: "planning",
    sessionId: "wps_observed",
  });

  const afterReplacePublishCount = published.length;
  runClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_controller_old_session",
      seq: 2,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Old session",
      content: "should not publish",
      expandable: false,
      created_at: "2026-06-21T00:00:00.007Z",
    }),
  );
  assert.equal(published.length, afterReplacePublishCount);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(controller.listenerCount(), 1);
  assert.equal(planningSession.listenerCount(), 1);
  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(planningSession.listenerCount(), 0);
  assert.equal(controller.dispose(), true);
});

test("renderer runtime stream session controller publishes active disposal", () => {
  const eventSourceFactory = () => createFakeRuntimeStreamEventSource().source;
  const runtime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_controller",
    }),
  };
  const sessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime,
    eventSourceFactory,
  });
  const controller = createRuntimeStreamInteractionSessionController({
    factory: sessionFactory,
  });
  const published: Array<ReturnType<typeof controller.snapshot>> = [];
  controller.subscribe((snapshot) => {
    published.push(snapshot);
  });
  const session = controller.openSession({
    channel: { kind: "run", runId: "run_dispose_observed" },
    eventTypes: ["model.text_delta"],
  });

  assert.equal(session.listenerCount(), 1);
  assert.equal(controller.disposeActiveSession(), true);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.dispose(), false);
  assert.deepEqual(published.at(-1), {
    activeChannel: null,
    activeSession: null,
    disposed: false,
  });

  assert.equal(controller.dispose(), true);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(controller.snapshot().disposed, true);
  assert.equal(controller.subscribe(() => undefined)(), false);
});

test("renderer runtime stream session uses spec channel defaults and lifecycle stop", async () => {
  assert.equal(
    new Set(RUNTIME_STREAM_ALL_EVENT_TYPES).size,
    RUNTIME_STREAM_ALL_EVENT_TYPES.length,
  );
  const runDefaults = defaultRuntimeStreamSessionEventTypes({
    kind: "run",
    runId: "run_01J",
  });
  assertRuntimeStreamEventTypesEqualNoDuplicates(runDefaults, [
    "run.started",
    "run.paused",
    "run.resumed",
    "run.completed",
    "run.failed",
    "run.cancelled",
    "node.state_changed",
    "attempt.started",
    "attempt.completed",
    "attempt.failed",
    "model.request_started",
    "model.thinking_delta",
    "model.thought_completed",
    "model.text_delta",
    "model.text_completed",
    "model.request_completed",
    "model.request_failed",
    "model.escalated",
    "tool.call_started",
    "tool.call_completed",
    "tool.call_failed",
    "tool.approval_required",
    "tool.approved",
    "tool.rejected",
    "context.build_started",
    "context.build_completed",
    "context.compression_applied",
    "context.over_budget_failed",
    "evidence.build_completed",
    "evidence.conflict_detected",
    "evidence.feedback_written",
    "evaluation.started",
    "evaluation.criterion_passed",
    "evaluation.criterion_failed",
    "evaluation.completed",
    "evaluation.judge_disagreement",
    "repair.started",
    "repair.patch_proposed",
    "repair.patch_rejected",
    "repair.patch_applied",
    "repair.patch_reverted",
    "repair.escalation_to_human",
    "human.gate_required",
    "human.gate_resolved",
    "human.gate_timeout",
    "artifact.written",
    "artifact.deleted",
    "git.snapshot_created",
    "git.tag_created",
    "export.completed",
    "metric.snapshot",
    "usage.delta",
    "error.exception",
    "error.network",
    "error.budget_exhausted",
    "system.heartbeat",
  ]);

  const planningDefaults = defaultRuntimeStreamSessionEventTypes({
    kind: "planning",
    sessionId: "wps_01J",
  });
  assertRuntimeStreamEventTypesEqualNoDuplicates(planningDefaults, [
    "planning.session_started",
    "planning.phase_changed",
    "planning.context_built",
    "planning.understanding_completed",
    "planning.clarification_question",
    "planning.clarification_answered",
    "planning.draft_generated",
    "planning.draft_validation",
    "planning.draft_repaired",
    "planning.workflow_patch_proposed",
    "planning.workflow_instantiated",
    "system.heartbeat",
  ]);
  for (const eventType of [...runDefaults, ...planningDefaults]) {
    assert.equal(RUNTIME_STREAM_ALL_EVENT_TYPES.includes(eventType), true);
  }
  assert.equal(
    RUNTIME_STREAM_ALL_EVENT_TYPES.includes("system.runtime_ready"),
    true,
  );
  assert.equal(
    RUNTIME_STREAM_ALL_EVENT_TYPES.includes("system.runtime_shutting_down"),
    true,
  );

  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const lifecycle = createFakeRuntimeStreamEventStorePageLifecycleTarget();
  const session = createRuntimeStreamInteractionSession({
    clientOptions: createRuntimeStreamEventStoreClientOptions(),
    clientFactory: clientFactory.factory,
  });

  await session.start();
  const client = clientFactory.clients[0];
  assert.ok(client !== undefined);
  assert.equal(client.listenerCount("model.text_delta"), 1);
  assert.equal(client.listenerCount("planning.session_started"), 0);
  assert.equal(client.listenerCount("system.heartbeat"), 1);
  assert.equal(client.listenerCount("system.runtime_ready"), 0);

  const unbind = session.bindPageLifecycle(lifecycle, {
    eventType: "pagehide",
  });
  assert.equal(lifecycle.listenerCount("pagehide"), 1);
  lifecycle.emit("pagehide");
  assert.equal(session.snapshot().store.status, "stopped");
  assert.equal(session.isStarted(), false);
  assert.equal(client.closeCount(), 1);
  assert.equal(lifecycle.listenerCount("pagehide"), 1);
  assert.equal(unbind(), true);
  assert.equal(lifecycle.listenerCount("pagehide"), 0);
  assert.equal(unbind(), false);
  assert.equal(session.dispose(), true);
});

test("renderer runtime stream session resets full reload latch before restart", async () => {
  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const session = createRuntimeStreamInteractionSession({
    clientOptions: createRuntimeStreamEventStoreClientOptions(),
    clientFactory: clientFactory.factory,
    eventTypes: ["model.text_delta"],
  });

  await session.start();
  const client = clientFactory.clients[0];
  assert.ok(client !== undefined);
  client.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_before_reload",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Before reload",
      content: "stale buffered content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.001Z",
    }),
  );
  assert.equal(session.interaction.markAllRead().read.lastSeenTotalEvents, 1);
  client.fullReload({
    action: "full_reload",
    lastEventId: "evt_before_reload",
    reason: "Last-Event-ID was not found",
    status: 412,
    errorCode: RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE,
  });

  const reloadSnapshot = session.snapshot();
  assert.equal(reloadSnapshot.store.status, "full_reload_required");
  assert.equal(reloadSnapshot.interaction.view.fullReloadRequired, true);
  assert.equal(client.listenerCount("model.text_delta"), 0);
  assert.equal(client.closeCount(), 1);

  const blockedRestart = await session.start();
  assert.equal(blockedRestart.store.status, "full_reload_required");
  assert.equal(clientFactory.clients.length, 1);

  const resetSnapshot = session.resetFullReloadRequired();
  assert.equal(resetSnapshot.store.status, "idle");
  assert.equal(resetSnapshot.store.totalEvents, 0);
  assert.deepEqual(resetSnapshot.store.events, []);
  assert.equal(resetSnapshot.interaction.view.fullReloadRequired, false);
  assert.equal(resetSnapshot.interaction.view.fullReloadDecision, null);
  assert.equal(resetSnapshot.interaction.read.lastSeenTotalEvents, 0);
  assert.equal(resetSnapshot.interaction.read.unreadCount, 0);

  const restarted = await session.start();
  assert.equal(restarted.store.status, "running");
  assert.equal(clientFactory.clients.length, 2);
  const restartedClient = clientFactory.clients[1];
  assert.ok(restartedClient !== undefined);
  assert.equal(restartedClient.listenerCount("model.text_delta"), 1);
  restartedClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_after_reload",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "After reload",
      content: "fresh content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.002Z",
    }),
  );
  assert.equal(session.snapshot().interaction.read.unreadCount, 1);
  assert.equal(session.dispose(), true);
});

test("renderer runtime stream session disposes and rejects unsafe options", async () => {
  assert.throws(
    () =>
      createRuntimeStreamInteractionSession({
        clientOptions: createRuntimeStreamEventStoreClientOptions(),
        eventTypes: [],
      }),
    /requires at least one event type/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamInteractionSession({
        clientOptions: createRuntimeStreamEventStoreClientOptions(),
        eventTypes: ["bad type" as RuntimeStreamKnownEventType],
      }),
    /event type/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamInteractionSession({
        clientOptions: createRuntimeStreamEventStoreClientOptions(),
        eventTypes: ["model.fake" as RuntimeStreamKnownEventType],
      }),
    /StreamEvent spec/u,
  );
  assert.throws(
    () =>
      createRuntimeStreamInteractionSession({
        clientOptions: createRuntimeStreamEventStoreClientOptions(),
        selectedEventId: "evt_missing",
      }),
    /not visible/u,
  );

  const clientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const session = createRuntimeStreamInteractionSession({
    clientOptions: createRuntimeStreamEventStoreClientOptions(),
    clientFactory: clientFactory.factory,
    eventTypes: ["system.heartbeat"],
  });
  await session.start();
  assert.equal(session.store.listenerCount(), 1);
  assert.equal(session.viewModel.listenerCount(), 1);
  assert.equal(session.dispose(), true);
  assert.equal(session.store.listenerCount(), 0);
  assert.equal(session.viewModel.listenerCount(), 0);
  assert.equal(session.interaction.listenerCount(), 0);
  const disposedSnapshot = session.snapshot();
  assert.equal(disposedSnapshot.store.status, "stopped");
  assert.equal(disposedSnapshot.interaction.view.status, "stopped");
  assert.equal(session.dispose(), false);
  await assert.rejects(
    async () => session.start(),
    /interaction session is disposed/u,
  );
});

function assertRuntimeStreamEventTypesEqualNoDuplicates(
  actual: readonly string[],
  expected: readonly string[],
): void {
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
}

function createNoopSubscribe(): RuntimePreloadIpcSubscribe {
  return () => () => false;
}

function createStartupStatus(
  kind: RuntimeIpcStartupStatus["kind"],
): RuntimeIpcStartupStatus {
  switch (kind) {
    case "starting_sidecar":
      return {
        kind,
        action: "start_sidecar",
        attempt: 1,
        lockStatus: "missing",
        severity: "info",
        message: "Starting runtime sidecar.",
        lifecycleComplete: false,
        userActionRequired: false,
        retryable: false,
      };
    case "cleaning_stale_lock":
      return {
        kind,
        action: "cleanup_then_start",
        attempt: 1,
        lockStatus: "stale",
        severity: "warning",
        message: "Cleaning stale runtime lock.",
        lifecycleComplete: false,
        userActionRequired: false,
        retryable: true,
      };
    case "waiting_for_existing":
      return {
        kind,
        action: "wait_for_existing",
        attempt: 1,
        lockStatus: "active",
        severity: "info",
        message: "Waiting for existing runtime sidecar.",
        lifecycleComplete: false,
        userActionRequired: false,
        retryable: false,
      };
    case "runtime_ready":
      return {
        kind,
        action: "reuse_existing",
        attempt: 1,
        lockStatus: "active",
        severity: "info",
        message: "Runtime sidecar is ready.",
        lifecycleComplete: true,
        userActionRequired: false,
        retryable: false,
      };
    case "startup_blocked":
      return {
        kind,
        action: "block_startup",
        attempt: 1,
        lockStatus: "corrupt",
        severity: "error",
        message: "Runtime startup is blocked.",
        lifecycleComplete: true,
        userActionRequired: true,
        retryable: false,
        reason: "runtime lock is corrupt",
      };
    case "startup_timed_out":
      return {
        kind,
        action: "timeout_waiting_for_existing",
        attempt: 1,
        lockStatus: "active",
        severity: "error",
        message: "Timed out waiting for existing runtime sidecar.",
        lifecycleComplete: true,
        userActionRequired: true,
        retryable: true,
        reason: "runtime did not become ready before timeout",
      };
  }
}

function createFakeRuntimeStartupStatusRuntime(
  initialStatuses: readonly RuntimeIpcStartupStatus[],
): {
  readonly runtime: Pick<RuntimeBridge, "startupStatus" | "onStartupStatus">;
  readonly setSnapshot: (statuses: readonly RuntimeIpcStartupStatus[]) => void;
  readonly emit: (statuses: readonly RuntimeIpcStartupStatus[]) => void;
  readonly listenerCount: () => number;
  readonly unsubscribeCount: () => number;
} {
  let statuses = cloneStartupStatuses(initialStatuses);
  let unsubscribeCount = 0;
  const listeners = new Set<
    (statuses: readonly RuntimeIpcStartupStatus[]) => void
  >();

  return {
    runtime: {
      startupStatus: async () => cloneStartupStatuses(statuses),
      onStartupStatus: (listener) => {
        listeners.add(listener);
        let subscribed = true;
        return () => {
          if (!subscribed) {
            return false;
          }
          subscribed = false;
          const deleted = listeners.delete(listener);
          if (deleted) {
            unsubscribeCount += 1;
          }
          return deleted;
        };
      },
    },
    setSnapshot: (nextStatuses) => {
      statuses = cloneStartupStatuses(nextStatuses);
    },
    emit: (nextStatuses) => {
      for (const listener of [...listeners]) {
        listener(cloneStartupStatuses(nextStatuses));
      }
    },
    listenerCount: () => listeners.size,
    unsubscribeCount: () => unsubscribeCount,
  };
}

function createFakeRuntimeStartupStatusPageLifecycleTarget(): {
  readonly addEventListener: (
    eventType: RuntimeStartupStatusPageLifecycleEvent,
    listener: RuntimeStartupStatusPageLifecycleListener,
  ) => void;
  readonly removeEventListener: (
    eventType: RuntimeStartupStatusPageLifecycleEvent,
    listener: RuntimeStartupStatusPageLifecycleListener,
  ) => void;
  readonly emit: (eventType: RuntimeStartupStatusPageLifecycleEvent) => void;
  readonly listenerCount: (
    eventType: RuntimeStartupStatusPageLifecycleEvent,
  ) => number;
} {
  const listeners = new Map<
    RuntimeStartupStatusPageLifecycleEvent,
    Set<RuntimeStartupStatusPageLifecycleListener>
  >();
  return {
    addEventListener: (eventType, listener) => {
      const eventListeners = listeners.get(eventType) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventType, eventListeners);
    },
    removeEventListener: (eventType, listener) => {
      listeners.get(eventType)?.delete(listener);
    },
    emit: (eventType) => {
      for (const listener of [...(listeners.get(eventType) ?? [])]) {
        listener();
      }
    },
    listenerCount: (eventType) => listeners.get(eventType)?.size ?? 0,
  };
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

function createFakeRuntimeLifecycleStatusRuntime(
  initialStartupStatuses: readonly RuntimeIpcStartupStatus[],
  initialShutdownStatuses: readonly RuntimeIpcShutdownStatus[],
): {
  readonly runtime: Pick<
    RuntimeBridge,
    "startupStatus" | "onStartupStatus" | "shutdownStatus" | "onShutdownStatus"
  >;
  readonly setStartupSnapshot: (
    statuses: readonly RuntimeIpcStartupStatus[],
  ) => void;
  readonly setShutdownSnapshot: (
    statuses: readonly RuntimeIpcShutdownStatus[],
  ) => void;
  readonly emitStartup: (statuses: readonly RuntimeIpcStartupStatus[]) => void;
  readonly emitShutdown: (
    statuses: readonly RuntimeIpcShutdownStatus[],
  ) => void;
  readonly startupListenerCount: () => number;
  readonly shutdownListenerCount: () => number;
  readonly startupUnsubscribeCount: () => number;
  readonly shutdownUnsubscribeCount: () => number;
} {
  let startupStatuses = cloneStartupStatuses(initialStartupStatuses);
  let shutdownStatuses = cloneShutdownStatuses(initialShutdownStatuses);
  let startupUnsubscribeCount = 0;
  let shutdownUnsubscribeCount = 0;
  const startupListeners = new Set<
    (statuses: readonly RuntimeIpcStartupStatus[]) => void
  >();
  const shutdownListeners = new Set<
    (statuses: readonly RuntimeIpcShutdownStatus[]) => void
  >();

  return {
    runtime: {
      startupStatus: async () => cloneStartupStatuses(startupStatuses),
      onStartupStatus: (listener) => {
        startupListeners.add(listener);
        let subscribed = true;
        return () => {
          if (!subscribed) {
            return false;
          }
          subscribed = false;
          const deleted = startupListeners.delete(listener);
          if (deleted) {
            startupUnsubscribeCount += 1;
          }
          return deleted;
        };
      },
      shutdownStatus: async () => cloneShutdownStatuses(shutdownStatuses),
      onShutdownStatus: (listener) => {
        shutdownListeners.add(listener);
        let subscribed = true;
        return () => {
          if (!subscribed) {
            return false;
          }
          subscribed = false;
          const deleted = shutdownListeners.delete(listener);
          if (deleted) {
            shutdownUnsubscribeCount += 1;
          }
          return deleted;
        };
      },
    },
    setStartupSnapshot: (nextStatuses) => {
      startupStatuses = cloneStartupStatuses(nextStatuses);
    },
    setShutdownSnapshot: (nextStatuses) => {
      shutdownStatuses = cloneShutdownStatuses(nextStatuses);
    },
    emitStartup: (nextStatuses) => {
      for (const listener of [...startupListeners]) {
        listener(cloneStartupStatuses(nextStatuses));
      }
    },
    emitShutdown: (nextStatuses) => {
      for (const listener of [...shutdownListeners]) {
        listener(cloneShutdownStatuses(nextStatuses));
      }
    },
    startupListenerCount: () => startupListeners.size,
    shutdownListenerCount: () => shutdownListeners.size,
    startupUnsubscribeCount: () => startupUnsubscribeCount,
    shutdownUnsubscribeCount: () => shutdownUnsubscribeCount,
  };
}

function createFakeRuntimeLifecycleStatusPageLifecycleTarget(): {
  readonly addEventListener: (
    eventType: RuntimeLifecycleStatusPageLifecycleEvent,
    listener: RuntimeLifecycleStatusPageLifecycleListener,
  ) => void;
  readonly removeEventListener: (
    eventType: RuntimeLifecycleStatusPageLifecycleEvent,
    listener: RuntimeLifecycleStatusPageLifecycleListener,
  ) => void;
  readonly emit: (eventType: RuntimeLifecycleStatusPageLifecycleEvent) => void;
  readonly listenerCount: (
    eventType: RuntimeLifecycleStatusPageLifecycleEvent,
  ) => number;
} {
  const listeners = new Map<
    RuntimeLifecycleStatusPageLifecycleEvent,
    Set<RuntimeLifecycleStatusPageLifecycleListener>
  >();
  return {
    addEventListener: (eventType, listener) => {
      const eventListeners = listeners.get(eventType) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventType, eventListeners);
    },
    removeEventListener: (eventType, listener) => {
      listeners.get(eventType)?.delete(listener);
    },
    emit: (eventType) => {
      for (const listener of [...(listeners.get(eventType) ?? [])]) {
        listener();
      }
    },
    listenerCount: (eventType) => listeners.get(eventType)?.size ?? 0,
  };
}

function createFakeRuntimeStartupStatusViewModelStore(
  initialStatuses: readonly RuntimeIpcStartupStatus[],
): {
  readonly store: RuntimeStartupStatusViewModelStore;
  readonly emit: (statuses: readonly RuntimeIpcStartupStatus[]) => void;
  readonly listenerCount: () => number;
} {
  let statuses = cloneStartupStatuses(initialStatuses);
  const listeners = new Set<
    (statuses: readonly RuntimeIpcStartupStatus[]) => void
  >();

  return {
    store: {
      snapshot: () => cloneStartupStatuses(statuses),
      subscribe: (listener) => {
        listeners.add(listener);
        let subscribed = true;
        return () => {
          if (!subscribed) {
            return false;
          }
          subscribed = false;
          return listeners.delete(listener);
        };
      },
    },
    emit: (nextStatuses) => {
      statuses = cloneStartupStatuses(nextStatuses);
      for (const listener of [...listeners]) {
        listener(cloneStartupStatuses(statuses));
      }
    },
    listenerCount: () => listeners.size,
  };
}

function cloneStartupStatuses(
  statuses: readonly RuntimeIpcStartupStatus[],
): RuntimeIpcStartupStatus[] {
  return statuses.map((status) => ({ ...status }));
}

function cloneShutdownStatuses(
  statuses: readonly RuntimeIpcShutdownStatus[],
): RuntimeIpcShutdownStatus[] {
  return statuses.map((status) => ({ ...status }));
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

function createFakeRuntimeStreamEventSource(): {
  readonly source: RuntimeStreamEventSource;
  readonly emit: (
    type: string,
    event: Omit<RuntimeStreamSourceEvent, "type">,
  ) => void;
  readonly listenerCount: (type: string) => number;
  readonly closeCount: () => number;
} {
  const listeners = new Map<string, Set<RuntimeStreamSourceListener>>();
  let closed = 0;

  return {
    source: {
      addEventListener: (type, listener) => {
        const typeListeners = listeners.get(type) ?? new Set();
        typeListeners.add(listener);
        listeners.set(type, typeListeners);
      },
      removeEventListener: (type, listener) => {
        listeners.get(type)?.delete(listener);
      },
      close: () => {
        closed += 1;
      },
    },
    emit: (type, event) => {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener({ ...event, type });
      }
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
    closeCount: () => closed,
  };
}

function createFakeRuntimeStreamEventSourceFactory(): {
  readonly factory: (
    request: RuntimeStreamConnectionRequest,
  ) => RuntimeStreamEventSource;
  readonly requests: RuntimeStreamConnectionRequest[];
  readonly sources: ReturnType<typeof createFakeRuntimeStreamEventSource>[];
} {
  const requests: RuntimeStreamConnectionRequest[] = [];
  const sources: ReturnType<typeof createFakeRuntimeStreamEventSource>[] = [];
  return {
    factory: (request) => {
      requests.push(request);
      const source = createFakeRuntimeStreamEventSource();
      sources.push(source);
      return source.source;
    },
    requests,
    sources,
  };
}

interface FakeRuntimeStreamScheduledReconnect {
  readonly delayMs: number;
  cancelled: boolean;
  readonly run: () => boolean;
}

function createFakeRuntimeStreamReconnectScheduler(): {
  readonly scheduler: RuntimeStreamReconnectScheduler;
  readonly scheduled: FakeRuntimeStreamScheduledReconnect[];
} {
  const scheduled: FakeRuntimeStreamScheduledReconnect[] = [];
  return {
    scheduler: (delayMs, reconnect) => {
      const scheduledReconnect: FakeRuntimeStreamScheduledReconnect = {
        delayMs,
        cancelled: false,
        run: () => {
          if (scheduledReconnect.cancelled) {
            return false;
          }
          scheduledReconnect.cancelled = true;
          reconnect();
          return true;
        },
      };
      scheduled.push(scheduledReconnect);
      return {
        cancel: () => {
          if (scheduledReconnect.cancelled) {
            return false;
          }
          scheduledReconnect.cancelled = true;
          return true;
        },
      };
    },
    scheduled,
  };
}

async function flushRuntimeStreamReconnect(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createRuntimeStreamEventStoreClientOptions(
  overrides: Partial<OpenRuntimeStreamReconnectingClientOptions> = {},
): OpenRuntimeStreamReconnectingClientOptions {
  return {
    runtime: {
      connectionInfo: async () => ({
        base_url: "http://127.0.0.1:51234/cw/v1",
        token: "token_abc123",
      }),
    },
    channel: { kind: "run", runId: "run_01J" },
    eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
    ...overrides,
  };
}

function createFakeRuntimeStreamEventStoreClientFactory(): {
  readonly factory: (
    options: OpenRuntimeStreamReconnectingClientOptions,
  ) => Promise<RuntimeStreamReconnectingClient>;
  readonly clients: ReturnType<
    typeof createFakeRuntimeStreamReconnectingClient
  >[];
  readonly options: OpenRuntimeStreamReconnectingClientOptions[];
} {
  const clients: ReturnType<
    typeof createFakeRuntimeStreamReconnectingClient
  >[] = [];
  const capturedOptions: OpenRuntimeStreamReconnectingClientOptions[] = [];
  return {
    factory: async (options) => {
      capturedOptions.push(options);
      const client = createFakeRuntimeStreamReconnectingClient(options);
      clients.push(client);
      return client.client;
    },
    clients,
    options: capturedOptions,
  };
}

function createFakeRuntimeStreamReconnectingClient(
  options: OpenRuntimeStreamReconnectingClientOptions,
): {
  readonly client: RuntimeStreamReconnectingClient;
  readonly emit: (event: RuntimeStreamEvent<unknown>) => void;
  readonly fullReload: (decision: RuntimeStreamFullReloadDecision) => void;
  readonly listenerCount: (eventType: string) => number;
  readonly closeCount: () => number;
} {
  const listeners = new Map<
    string,
    Set<(event: RuntimeStreamEvent<unknown>) => void>
  >();
  let closed = false;
  let closeCount = 0;
  return {
    client: {
      subscribe: (eventType, listener) => {
        if (closed) {
          return () => false;
        }
        const unknownListener = listener as (
          event: RuntimeStreamEvent<unknown>,
        ) => void;
        const eventListeners = listeners.get(eventType) ?? new Set();
        eventListeners.add(unknownListener);
        listeners.set(eventType, eventListeners);
        let subscribed = true;
        return () => {
          if (!subscribed) {
            return false;
          }
          subscribed = false;
          return eventListeners.delete(unknownListener);
        };
      },
      close: () => {
        if (closed) {
          return false;
        }
        closed = true;
        closeCount += 1;
        listeners.clear();
        return true;
      },
      isClosed: () => closed,
      activeRequest: () => null,
      replaySnapshot: () => ({
        mode: "ready",
        lastEventId: null,
        reconnectAttempt: 0,
      }),
    },
    emit: (event) => {
      for (const listener of [...(listeners.get(event.type) ?? [])]) {
        listener(event);
      }
    },
    fullReload: (decision) => {
      options.onFullReloadRequired?.(decision);
    },
    listenerCount: (eventType) => listeners.get(eventType)?.size ?? 0,
    closeCount: () => closeCount,
  };
}

function createFakeRuntimeStreamEventStorePageLifecycleTarget(): {
  readonly addEventListener: (
    eventType: RuntimeStreamEventStorePageLifecycleEvent,
    listener: RuntimeStreamEventStorePageLifecycleListener,
  ) => void;
  readonly removeEventListener: (
    eventType: RuntimeStreamEventStorePageLifecycleEvent,
    listener: RuntimeStreamEventStorePageLifecycleListener,
  ) => void;
  readonly emit: (eventType: RuntimeStreamEventStorePageLifecycleEvent) => void;
  readonly listenerCount: (
    eventType: RuntimeStreamEventStorePageLifecycleEvent,
  ) => number;
} {
  const listeners = new Map<
    RuntimeStreamEventStorePageLifecycleEvent,
    Set<RuntimeStreamEventStorePageLifecycleListener>
  >();
  return {
    addEventListener: (eventType, listener) => {
      const eventListeners = listeners.get(eventType) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventType, eventListeners);
    },
    removeEventListener: (eventType, listener) => {
      listeners.get(eventType)?.delete(listener);
    },
    emit: (eventType) => {
      for (const listener of [...(listeners.get(eventType) ?? [])]) {
        listener();
      }
    },
    listenerCount: (eventType) => listeners.get(eventType)?.size ?? 0,
  };
}

function createFakeRuntimeStreamViewModelStore(
  initialSnapshot: RuntimeStreamEventStoreSnapshot,
): {
  readonly store: {
    readonly snapshot: () => RuntimeStreamEventStoreSnapshot;
    readonly subscribe: (
      listener: (snapshot: RuntimeStreamEventStoreSnapshot) => void,
    ) => () => boolean;
  };
  readonly emit: (snapshot: RuntimeStreamEventStoreSnapshot) => void;
  readonly listenerCount: () => number;
} {
  const listeners = new Set<
    (snapshot: RuntimeStreamEventStoreSnapshot) => void
  >();
  let snapshot = cloneRuntimeStreamEventStoreSnapshotForTest(initialSnapshot);
  return {
    store: {
      snapshot: () => cloneRuntimeStreamEventStoreSnapshotForTest(snapshot),
      subscribe: (listener) => {
        listeners.add(listener);
        let subscribed = true;
        return () => {
          if (!subscribed) {
            return false;
          }
          subscribed = false;
          return listeners.delete(listener);
        };
      },
    },
    emit: (nextSnapshot) => {
      snapshot = cloneRuntimeStreamEventStoreSnapshotForTest(nextSnapshot);
      for (const listener of [...listeners]) {
        listener(cloneRuntimeStreamEventStoreSnapshotForTest(snapshot));
      }
    },
    listenerCount: () => listeners.size,
  };
}

function createRuntimeStreamViewModelEvent(
  data: Readonly<Record<string, unknown>>,
): RuntimeStreamEvent<unknown> {
  const eventId = typeof data.event_id === "string" ? data.event_id : null;
  const eventType =
    typeof data.type === "string" ? data.type : "system.runtime_ready";
  return {
    id: eventId,
    type: eventType,
    data: structuredClone(data),
    rawData: JSON.stringify(data),
  };
}

function cloneRuntimeStreamEventStoreSnapshotForTest(
  snapshot: RuntimeStreamEventStoreSnapshot,
): RuntimeStreamEventStoreSnapshot {
  const cloned: {
    status: RuntimeStreamEventStoreSnapshot["status"];
    events: RuntimeStreamEvent<unknown>[];
    totalEvents: number;
    fullReloadDecision?: RuntimeStreamFullReloadDecision;
  } = {
    status: snapshot.status,
    events: snapshot.events.map((event) => ({
      id: event.id,
      type: event.type,
      data: structuredClone(event.data),
      rawData: event.rawData,
    })),
    totalEvents: snapshot.totalEvents,
  };
  if (snapshot.fullReloadDecision !== undefined) {
    cloned.fullReloadDecision = {
      action: "full_reload",
      lastEventId: snapshot.fullReloadDecision.lastEventId,
      reason: snapshot.fullReloadDecision.reason,
      ...(snapshot.fullReloadDecision.status !== undefined
        ? { status: snapshot.fullReloadDecision.status }
        : {}),
      ...(snapshot.fullReloadDecision.errorCode !== undefined
        ? { errorCode: snapshot.fullReloadDecision.errorCode }
        : {}),
    };
  }
  return cloned;
}

function assertRecordData(
  value: unknown,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
}
