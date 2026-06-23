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
  createRuntimeLifecyclePanelPresenter,
  type RuntimeLifecyclePanelTimelineItem,
} from "../renderer/runtime-lifecycle-panel-presenter.js";
import { createRuntimeLifecyclePanelControllerFactory } from "../renderer/runtime-lifecycle-panel-controller.js";
import { createRuntimeLifecyclePanelHookAdapterFactory } from "../renderer/runtime-lifecycle-panel-hook-adapter.js";
import {
  createRuntimeLifecyclePanelViewModel,
  type RuntimeLifecyclePanelTimelineFilter,
} from "../renderer/runtime-lifecycle-panel-view-model.js";
import {
  createRuntimeLifecyclePanelInteraction,
  type RuntimeLifecyclePanelInteractionCommand,
  type RuntimeLifecyclePanelInteractionSnapshot,
} from "../renderer/runtime-lifecycle-panel-interaction.js";
import {
  createRuntimeLifecyclePanelSessionController,
  createRuntimeLifecyclePanelSessionFactory,
} from "../renderer/runtime-lifecycle-panel-session.js";
import {
  createRuntimeWorkbenchSession,
  type RuntimeWorkbenchPanelId,
} from "../renderer/runtime-workbench-session.js";
import {
  createRuntimeWorkbenchInteraction,
  type RuntimeWorkbenchInteractionCommand,
  type RuntimeWorkbenchInteractionCommandId,
} from "../renderer/runtime-workbench-interaction.js";
import {
  createRuntimeWorkbenchShortcutController,
  type RuntimeWorkbenchShortcutId,
  type RuntimeWorkbenchShortcutKeyEvent,
} from "../renderer/runtime-workbench-shortcuts.js";
import { createRuntimeWorkbenchHostSession } from "../renderer/runtime-workbench-host-session.js";
import {
  buildRuntimeWorkbenchShellSnapshot,
  createRuntimeWorkbenchShellPresenter,
  type RuntimeWorkbenchShellAction,
  type RuntimeWorkbenchShellShortcutHint,
} from "../renderer/runtime-workbench-shell-presenter.js";
import {
  createRuntimeWorkbenchShellAdapter,
  createRuntimeWorkbenchShellAdapterFactory,
} from "../renderer/runtime-workbench-shell-adapter.js";
import {
  bindRuntimeWorkbenchShellKeyboardTarget,
  type RuntimeWorkbenchShellKeyboardEvent,
  type RuntimeWorkbenchShellKeyboardEventListener,
} from "../renderer/runtime-workbench-shell-keyboard-binding.js";
import { bindRuntimeWorkbenchShellKeyboardDomTarget } from "../renderer/runtime-workbench-shell-keyboard-dom-adapter.js";
import { createRuntimeWorkbenchShellDomSession } from "../renderer/runtime-workbench-shell-dom-session.js";
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
  type RuntimeStreamInteractionCommand,
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

test("renderer runtime lifecycle panel presenter projects shell snapshots", async () => {
  const sensitiveReason =
    "token_abc base_url=http://127.0.0.1:51234/cw/v1 prompt model output";
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const session = createRuntimeLifecycleShellSession({
    runtime: runtime.runtime,
  });
  const presenter = createRuntimeLifecyclePanelPresenter({ session });

  const idle = presenter.snapshot();
  assert.equal(idle.statusLabel, "Idle");
  assert.equal(idle.ariaLive, "off");
  assert.equal(idle.emptyState?.title, "No lifecycle activity");
  assert.equal(idle.primaryCommand?.id, "start_runtime");
  assert.equal(idle.primaryCommand.enabled, true);
  assert.deepEqual(
    idle.secondaryCommands.map((command) => command.id),
    ["refresh_status"],
  );

  const started = await presenter.invoke("start_runtime");
  assert.equal(started.started, true);
  assert.equal(started.primaryCommand?.id, "start_runtime");

  const busy = await presenter.invoke("refresh_status");
  assert.equal(busy.readiness, "busy");
  assert.equal(busy.statusLabel, "Starting");
  assert.equal(busy.primaryCommand?.id, "wait");
  assert.equal(busy.primaryCommand.enabled, false);
  assert.equal(busy.primaryCommand.busy, true);
  assert.deepEqual(
    busy.secondaryCommands.map((command) => command.id),
    ["refresh_status", "stop_runtime"],
  );
  assert.deepEqual(
    busy.timelineItems.map((item) => [
      item.id,
      item.sourceLabel,
      item.statusLabel,
    ]),
    [
      ["startup:0:starting_sidecar", "Startup", "Starting"],
      ["shutdown:1:registered", "Shutdown", "Idle"],
    ],
  );

  runtime.emitStartup([createStartupStatus("runtime_ready")]);
  const ready = presenter.snapshot();
  assert.equal(ready.readiness, "ready");
  assert.equal(ready.statusLabel, "Ready");
  assert.equal(ready.runtimeReady, true);
  assert.equal(ready.primaryCommand, null);
  assert.equal(ready.ariaLive, "polite");

  runtime.emitShutdown([
    { ...createShutdownStatus("shutdown_failed"), reason: sensitiveReason },
  ]);
  const attention = presenter.snapshot();
  assert.equal(attention.readiness, "attention_required");
  assert.equal(attention.statusLabel, "Needs attention");
  assert.equal(attention.primaryCommand?.id, "retry_startup");
  assert.equal(attention.primaryCommand.enabled, true);
  assert.equal(attention.primaryCommand.tone, "accent");
  assert.equal(attention.ariaLive, "assertive");
  assert.deepEqual(attention.timelineItems.at(-1)?.badges, [
    "shutdown",
    "complete",
    "action_required",
    "retryable",
  ]);

  const visibleText = [
    attention.title,
    attention.summary,
    attention.primaryCommand?.label ?? "",
    ...attention.secondaryCommands.flatMap((command) => [
      command.label,
      command.title,
    ]),
    ...attention.timelineItems.flatMap((item) => [
      item.title,
      item.summary,
      item.sourceLabel,
      item.statusLabel,
    ]),
  ].join("\n");
  assert.doesNotMatch(visibleText, /token_abc/u);
  assert.doesNotMatch(visibleText, /base_url/u);
  assert.doesNotMatch(visibleText, /prompt/u);
  assert.doesNotMatch(visibleText, /model output/u);

  const retried = await presenter.invoke("retry_startup");
  assert.equal(retried.started, true);
  assert.equal(session.isStarted(), true);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.equal(runtime.startupListenerCount(), 1);
  assert.equal(runtime.shutdownListenerCount(), 1);

  assert.equal(presenter.dispose(), true);
  assert.equal(session.dispose(), true);
});

test("renderer runtime lifecycle panel presenter invokes commands and isolates listeners", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const session = createRuntimeLifecycleShellSession({
    runtime: runtime.runtime,
  });
  const presenter = createRuntimeLifecyclePanelPresenter({
    session,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly readiness: string;
    readonly primaryLabel: string | null;
    readonly itemTotal: number;
    readonly started: boolean;
  }> = [];

  const unsubscribeThrowing = presenter.subscribe((snapshot) => {
    const mutableItems =
      snapshot.timelineItems as RuntimeLifecyclePanelTimelineItem[];
    mutableItems.push({
      id: "mutated",
      source: "shutdown",
      sourceLabel: "Mutated",
      kind: "shutdown_failed",
      phase: "failed",
      tone: "error",
      statusLabel: "Mutated",
      title: "Mutated",
      summary: "Mutated",
      badges: ["shutdown"],
    });
    if (snapshot.primaryCommand !== null) {
      const mutableCommand = snapshot.primaryCommand as { label: string };
      mutableCommand.label = "Mutated";
    }
    throw new Error("lifecycle panel presenter listener failed");
  });
  const unsubscribeObserved = presenter.subscribe((snapshot) => {
    observed.push({
      readiness: snapshot.readiness,
      primaryLabel: snapshot.primaryCommand?.label ?? null,
      itemTotal: snapshot.timelineItems.length,
      started: snapshot.started,
    });
  });

  await presenter.invoke("start_runtime");
  await presenter.invoke("refresh_status");
  assert.deepEqual(observed, [
    {
      readiness: "idle",
      primaryLabel: "Start runtime",
      itemTotal: 0,
      started: true,
    },
    {
      readiness: "busy",
      primaryLabel: "Working",
      itemTotal: 2,
      started: true,
    },
  ]);
  assert.equal(errors.length, 2);
  assert.deepEqual(
    presenter.snapshot().timelineItems.map((item) => item.title),
    ["Starting runtime", "Runtime shutdown registered"],
  );
  assert.equal(presenter.snapshot().primaryCommand?.label, "Working");

  const stopped = await presenter.invoke("stop_runtime");
  assert.equal(stopped.started, false);
  assert.equal(observed.at(-1)?.started, false);
  assert.equal(errors.length, 3);

  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), true);
  assert.equal(presenter.listenerCount(), 0);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.viewState.listenerCount(), 0);
  assert.equal(presenter.dispose(), true);
  assert.equal(presenter.dispose(), false);
  assert.equal(presenter.isDisposed(), true);
  assert.equal(session.isDisposed(), false);
  assert.equal(presenter.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => presenter.invoke("refresh_status"),
    /lifecycle panel presenter is disposed/u,
  );
  assert.equal(session.dispose(), true);
});

test("renderer runtime lifecycle panel presenter isolates throwing onError and active dispose", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const session = createRuntimeLifecycleShellSession({
    runtime: runtime.runtime,
  });
  const presenter = createRuntimeLifecyclePanelPresenter({
    session,
    onError: () => {
      throw new Error("presenter onError failed");
    },
  });
  const observed: string[] = [];

  const unsubscribeThrowing = presenter.subscribe(() => {
    throw new Error("lifecycle panel listener failed");
  });
  const unsubscribeObserved = presenter.subscribe((snapshot) => {
    observed.push(snapshot.readiness);
  });

  await presenter.invoke("start_runtime");
  await presenter.invoke("refresh_status");
  assert.deepEqual(observed, ["idle", "busy"]);
  assert.equal(presenter.listenerCount(), 2);
  assert.equal(session.listenerCount(), 1);
  assert.equal(session.viewState.listenerCount(), 1);

  assert.equal(presenter.dispose(), true);
  assert.equal(presenter.listenerCount(), 0);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.viewState.listenerCount(), 0);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(presenter.dispose(), false);
  assert.equal(session.dispose(), true);
});

test("renderer runtime lifecycle panel controller factory owns hook state", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const factory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const controller = factory.createController();
  const observed: Array<{
    readonly readiness: string;
    readonly started: boolean;
    readonly disposed: boolean;
    readonly itemTotal: number;
  }> = [];

  assert.equal(Object.hasOwn(controller, "session"), false);
  assert.equal(Object.hasOwn(controller, "presenter"), false);
  const initialSnapshot = controller.getSnapshot();
  assert.strictEqual(controller.snapshot(), initialSnapshot);
  assert.strictEqual(controller.getSnapshot(), initialSnapshot);
  assert.equal(initialSnapshot.panel.readiness, "idle");
  assert.equal(initialSnapshot.panel.primaryCommand?.id, "start_runtime");
  assert.equal(initialSnapshot.disposed, false);

  const unsubscribe = controller.subscribe((snapshot) => {
    observed.push({
      readiness: snapshot.panel.readiness,
      started: snapshot.panel.started,
      disposed: snapshot.disposed,
      itemTotal: snapshot.panel.timelineItems.length,
    });
  });
  assert.equal(controller.listenerCount(), 1);

  const started = await controller.invoke("start_runtime");
  assert.notStrictEqual(started, initialSnapshot);
  assert.strictEqual(controller.getSnapshot(), started);
  assert.strictEqual(controller.snapshot(), started);
  assert.equal(started.panel.started, true);
  assert.equal(runtime.startupListenerCount(), 1);
  assert.equal(runtime.shutdownListenerCount(), 1);
  assert.deepEqual(observed, [
    { readiness: "idle", started: true, disposed: false, itemTotal: 0 },
  ]);

  const busy = await controller.invoke("refresh_status");
  assert.notStrictEqual(busy, started);
  assert.strictEqual(controller.getSnapshot(), busy);
  assert.strictEqual(controller.snapshot(), busy);
  assert.equal(busy.panel.readiness, "busy");
  assert.equal(busy.panel.primaryCommand?.id, "wait");
  assert.deepEqual(observed.at(-1), {
    readiness: "busy",
    started: true,
    disposed: false,
    itemTotal: 2,
  });

  const beforeReady = controller.getSnapshot();
  runtime.emitStartup([createStartupStatus("runtime_ready")]);
  const ready = controller.getSnapshot();
  assert.notStrictEqual(ready, beforeReady);
  assert.strictEqual(controller.snapshot(), ready);
  assert.equal(ready.panel.readiness, "ready");
  assert.deepEqual(observed.at(-1), {
    readiness: "ready",
    started: true,
    disposed: false,
    itemTotal: 3,
  });

  const unbindPageLifecycle = controller.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);
  const beforePagehide = controller.getSnapshot();
  pageLifecycle.emit("pagehide");
  const stopped = controller.getSnapshot();
  assert.notStrictEqual(stopped, beforePagehide);
  assert.strictEqual(controller.snapshot(), stopped);
  assert.equal(stopped.panel.started, false);
  assert.deepEqual(observed.at(-1), {
    readiness: "ready",
    started: false,
    disposed: false,
    itemTotal: 3,
  });
  const afterPagehideObservedCount = observed.length;
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(observed.length, afterPagehideObservedCount);
  assert.equal(unbindPageLifecycle(), false);
  assert.equal(pageLifecycle.listenerCount("pagehide"), 0);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(controller.listenerCount(), 0);
  const beforeDispose = controller.getSnapshot();
  assert.equal(controller.dispose(), true);
  const disposedSnapshot = controller.getSnapshot();
  assert.notStrictEqual(disposedSnapshot, beforeDispose);
  assert.strictEqual(controller.snapshot(), disposedSnapshot);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.isDisposed(), true);
  assert.strictEqual(controller.getSnapshot(), disposedSnapshot);
  assert.equal(disposedSnapshot.disposed, true);
  assert.equal(disposedSnapshot.panel.disposed, true);
  assert.equal(controller.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => controller.invoke("refresh_status"),
    /lifecycle panel controller is disposed/u,
  );
});

test("renderer runtime lifecycle panel controller isolates listeners and active dispose", async () => {
  const factoryErrors: unknown[] = [];
  const overrideErrors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const factory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
    onError: (error) => {
      factoryErrors.push(error);
    },
  });
  const controller = factory.createController({
    onError: (error) => {
      overrideErrors.push(error);
    },
  });
  const observed: Array<{
    readonly readiness: string;
    readonly primaryLabel: string | null;
    readonly itemTotal: number;
  }> = [];

  const unsubscribeThrowing = controller.subscribe((snapshot) => {
    const mutableItems = snapshot.panel
      .timelineItems as RuntimeLifecyclePanelTimelineItem[];
    mutableItems.push({
      id: "mutated",
      source: "shutdown",
      sourceLabel: "Mutated",
      kind: "shutdown_failed",
      phase: "failed",
      tone: "error",
      statusLabel: "Mutated",
      title: "Mutated",
      summary: "Mutated",
      badges: ["shutdown"],
    });
    if (snapshot.panel.primaryCommand !== null) {
      const mutableCommand = snapshot.panel.primaryCommand as {
        label: string;
      };
      mutableCommand.label = "Mutated";
    }
    throw new Error("lifecycle panel controller listener failed");
  });
  const unsubscribeObserved = controller.subscribe((snapshot) => {
    observed.push({
      readiness: snapshot.panel.readiness,
      primaryLabel: snapshot.panel.primaryCommand?.label ?? null,
      itemTotal: snapshot.panel.timelineItems.length,
    });
  });

  await controller.invoke("start_runtime");
  await controller.invoke("refresh_status");
  assert.deepEqual(observed, [
    { readiness: "idle", primaryLabel: "Start runtime", itemTotal: 0 },
    { readiness: "busy", primaryLabel: "Working", itemTotal: 2 },
  ]);
  assert.equal(factoryErrors.length, 0);
  assert.equal(overrideErrors.length, 2);
  assert.deepEqual(
    controller.snapshot().panel.timelineItems.map((item) => item.title),
    ["Starting runtime", "Runtime shutdown registered"],
  );
  assert.equal(controller.snapshot().panel.primaryCommand?.label, "Working");

  assert.equal(controller.dispose(), true);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(controller.dispose(), false);
});

test("renderer runtime lifecycle panel hook adapter exposes external store contract", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const hookFactory = createRuntimeLifecyclePanelHookAdapterFactory({
    controllerFactory,
  });
  const adapter = hookFactory.createAdapter();
  const notifications: Array<{
    readonly readiness: string;
    readonly started: boolean;
    readonly disposed: boolean;
    readonly itemTotal: number;
  }> = [];

  assert.equal(Object.hasOwn(adapter, "controller"), false);
  assert.equal(Object.hasOwn(adapter, "session"), false);
  assert.equal(Object.hasOwn(adapter, "presenter"), false);
  const initialSnapshot = adapter.getSnapshot();
  assert.strictEqual(adapter.getSnapshot(), initialSnapshot);
  assert.strictEqual(adapter.getServerSnapshot(), initialSnapshot);
  assert.equal(Object.isFrozen(initialSnapshot), true);
  assert.equal(Object.isFrozen(initialSnapshot.panel), true);
  assert.equal(Object.isFrozen(initialSnapshot.panel.primaryCommand), true);
  assert.equal(Object.isFrozen(initialSnapshot.panel.secondaryCommands), true);
  assert.equal(Object.isFrozen(initialSnapshot.panel.timelineItems), true);
  assert.throws(() => {
    const mutableCommand = initialSnapshot.panel.primaryCommand as {
      label: string;
    };
    mutableCommand.label = "Mutated";
  }, /Cannot assign|read only/u);
  assert.equal(initialSnapshot.panel.primaryCommand?.label, "Start runtime");

  const unsubscribe = adapter.subscribe(() => {
    const snapshot = adapter.getSnapshot();
    notifications.push({
      readiness: snapshot.panel.readiness,
      started: snapshot.panel.started,
      disposed: snapshot.disposed,
      itemTotal: snapshot.panel.timelineItems.length,
    });
  });
  assert.equal(adapter.listenerCount(), 1);

  const started = await adapter.invoke("start_runtime");
  assert.notStrictEqual(started, initialSnapshot);
  assert.strictEqual(adapter.getSnapshot(), started);
  assert.strictEqual(adapter.getServerSnapshot(), started);
  assert.equal(started.panel.started, true);
  assert.deepEqual(notifications, [
    { readiness: "idle", started: true, disposed: false, itemTotal: 0 },
  ]);

  const busy = await adapter.invoke("refresh_status");
  assert.notStrictEqual(busy, started);
  assert.strictEqual(adapter.getSnapshot(), busy);
  assert.equal(busy.panel.readiness, "busy");
  assert.deepEqual(notifications.at(-1), {
    readiness: "busy",
    started: true,
    disposed: false,
    itemTotal: 2,
  });

  const beforeReady = adapter.getSnapshot();
  runtime.emitStartup([createStartupStatus("runtime_ready")]);
  const ready = adapter.getSnapshot();
  assert.notStrictEqual(ready, beforeReady);
  assert.strictEqual(adapter.getServerSnapshot(), ready);
  assert.equal(ready.panel.readiness, "ready");
  assert.deepEqual(notifications.at(-1), {
    readiness: "ready",
    started: true,
    disposed: false,
    itemTotal: 3,
  });

  const unbindPageLifecycle = adapter.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);
  const beforePagehide = adapter.getSnapshot();
  pageLifecycle.emit("pagehide");
  const stopped = adapter.getSnapshot();
  assert.notStrictEqual(stopped, beforePagehide);
  assert.equal(stopped.panel.started, false);
  assert.deepEqual(notifications.at(-1), {
    readiness: "ready",
    started: false,
    disposed: false,
    itemTotal: 3,
  });
  const afterPagehideNotifications = notifications.length;
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(unbindPageLifecycle(), false);
  assert.equal(notifications.length, afterPagehideNotifications);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(adapter.listenerCount(), 0);
  const beforeDispose = adapter.getSnapshot();
  assert.equal(adapter.dispose(), true);
  const disposedSnapshot = adapter.getSnapshot();
  assert.notStrictEqual(disposedSnapshot, beforeDispose);
  assert.strictEqual(adapter.getServerSnapshot(), disposedSnapshot);
  assert.equal(adapter.dispose(), false);
  assert.equal(adapter.isDisposed(), true);
  assert.equal(disposedSnapshot.disposed, true);
  assert.equal(disposedSnapshot.panel.disposed, true);
  assert.equal(adapter.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => adapter.invoke("refresh_status"),
    /lifecycle panel hook adapter is disposed/u,
  );
});

test("renderer runtime lifecycle panel hook adapter isolates listeners and active dispose", async () => {
  const factoryErrors: unknown[] = [];
  const overrideErrors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
    onError: (error) => {
      factoryErrors.push(error);
    },
  });
  const hookFactory = createRuntimeLifecyclePanelHookAdapterFactory({
    controllerFactory,
    onError: (error) => {
      factoryErrors.push(error);
    },
  });
  const adapter = hookFactory.createAdapter({
    onError: (error) => {
      overrideErrors.push(error);
    },
  });
  const observed: Array<{
    readonly readiness: string;
    readonly primaryLabel: string | null;
    readonly itemTotal: number;
  }> = [];

  const unsubscribeThrowing = adapter.subscribe(() => {
    const snapshot = adapter.getSnapshot();
    const mutableItems = snapshot.panel
      .timelineItems as RuntimeLifecyclePanelTimelineItem[];
    mutableItems.push({
      id: "mutated",
      source: "shutdown",
      sourceLabel: "Mutated",
      kind: "shutdown_failed",
      phase: "failed",
      tone: "error",
      statusLabel: "Mutated",
      title: "Mutated",
      summary: "Mutated",
      badges: ["shutdown"],
    });
  });
  const unsubscribeObserved = adapter.subscribe(() => {
    const snapshot = adapter.getSnapshot();
    observed.push({
      readiness: snapshot.panel.readiness,
      primaryLabel: snapshot.panel.primaryCommand?.label ?? null,
      itemTotal: snapshot.panel.timelineItems.length,
    });
  });

  await adapter.invoke("start_runtime");
  await adapter.invoke("refresh_status");
  assert.deepEqual(observed, [
    { readiness: "idle", primaryLabel: "Start runtime", itemTotal: 0 },
    { readiness: "busy", primaryLabel: "Working", itemTotal: 2 },
  ]);
  assert.equal(factoryErrors.length, 0);
  assert.equal(overrideErrors.length, 2);
  assert.deepEqual(
    adapter.getSnapshot().panel.timelineItems.map((item) => item.title),
    ["Starting runtime", "Runtime shutdown registered"],
  );
  assert.equal(adapter.getSnapshot().panel.primaryCommand?.label, "Working");

  assert.equal(adapter.dispose(), true);
  assert.equal(adapter.listenerCount(), 0);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(adapter.dispose(), false);
});

test("renderer runtime lifecycle panel view model filters and selects timeline", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const hookFactory = createRuntimeLifecyclePanelHookAdapterFactory({
    controllerFactory,
  });
  const viewModel = createRuntimeLifecyclePanelViewModel({
    adapter: hookFactory.createAdapter(),
  });
  const notifications: Array<{
    readonly filter: string;
    readonly visible: number;
    readonly selected: string | null;
    readonly started: boolean;
  }> = [];

  assert.equal(Object.hasOwn(viewModel, "adapter"), false);
  assert.equal(Object.hasOwn(viewModel, "controller"), false);
  assert.equal(Object.hasOwn(viewModel, "session"), false);
  assert.equal(viewModel.snapshot().timelineFilter, "all");
  assert.equal(viewModel.snapshot().visibleTimelineItemCount, 0);
  assert.equal(Object.isFrozen(viewModel.snapshot()), true);
  assert.equal(
    Object.isFrozen(viewModel.snapshot().timelineFilterOptions),
    true,
  );
  assert.equal(
    Object.isFrozen(viewModel.snapshot().visibleTimelineItems),
    true,
  );

  const unsubscribe = viewModel.subscribe((snapshot) => {
    notifications.push({
      filter: snapshot.timelineFilter,
      visible: snapshot.visibleTimelineItemCount,
      selected: snapshot.selectedTimelineItemId,
      started: snapshot.panel.started,
    });
  });

  await viewModel.invoke("start_runtime");
  const busy = await viewModel.invoke("refresh_status");
  assert.equal(busy.totalTimelineItems, 2);
  assert.equal(busy.visibleTimelineItemCount, 2);
  assert.equal(busy.hiddenTimelineItemCount, 0);
  assert.deepEqual(
    busy.timelineFilterOptions.map((option) => [
      option.id,
      option.count,
      option.active,
    ]),
    [
      ["all", 2, true],
      ["startup", 1, false],
      ["shutdown", 1, false],
      ["action_required", 0, false],
      ["retryable", 0, false],
      ["error", 0, false],
    ],
  );
  assert.deepEqual(notifications.at(-1), {
    filter: "all",
    visible: 2,
    selected: null,
    started: true,
  });

  const shutdownOnly = viewModel.setTimelineFilter("shutdown");
  assert.equal(shutdownOnly.timelineFilter, "shutdown");
  assert.equal(shutdownOnly.visibleTimelineItemCount, 1);
  assert.equal(shutdownOnly.hiddenTimelineItemCount, 1);
  assert.equal(shutdownOnly.visibleTimelineItems[0]?.source, "shutdown");
  assert.equal(
    shutdownOnly.timelineFilterOptions.find(
      (option) => option.id === "shutdown",
    )?.active,
    true,
  );

  const selected = viewModel.selectTimelineItem(
    shutdownOnly.visibleTimelineItems[0]?.id ?? "",
  );
  assert.equal(selected.selectedTimelineItem?.source, "shutdown");
  assert.equal(
    selected.selectedTimelineItemId,
    selected.selectedTimelineItem?.id,
  );
  assert.equal(Object.isFrozen(selected.selectedTimelineItem), true);
  assert.equal(Object.isFrozen(selected.selectedTimelineItem?.badges), true);
  assert.throws(() => {
    const mutableItems =
      selected.visibleTimelineItems as RuntimeLifecyclePanelTimelineItem[];
    mutableItems.push({
      id: "mutated",
      source: "startup",
      sourceLabel: "Mutated",
      kind: "starting_sidecar",
      phase: "starting",
      tone: "info",
      statusLabel: "Mutated",
      title: "Mutated",
      summary: "Mutated",
      badges: ["startup"],
    });
  }, /Cannot add|object is not extensible|read only/u);

  const startupOnly = viewModel.setTimelineFilter("startup");
  assert.equal(startupOnly.timelineFilter, "startup");
  assert.equal(startupOnly.visibleTimelineItemCount, 1);
  assert.equal(startupOnly.selectedTimelineItemId, null);
  assert.equal(startupOnly.selectedTimelineItem, null);
  assert.throws(
    () => viewModel.selectTimelineItem(selected.selectedTimelineItemId ?? ""),
    /timeline item is not visible/u,
  );
  assert.throws(
    () =>
      viewModel.setTimelineFilter(
        "unknown" as RuntimeLifecyclePanelTimelineFilter,
      ),
    /unexpected|Invalid|undefined/u,
  );
  assert.throws(
    () => viewModel.selectTimelineItem("../unsafe item"),
    /Invalid runtime lifecycle panel timeline item id/u,
  );

  const allAgain = viewModel.setTimelineFilter("all");
  assert.equal(allAgain.visibleTimelineItemCount, 2);
  const unbindPageLifecycle = viewModel.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  pageLifecycle.emit("pagehide");
  assert.equal(viewModel.snapshot().panel.started, false);
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(unbindPageLifecycle(), false);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(viewModel.listenerCount(), 0);
  assert.equal(viewModel.dispose(), true);
  assert.equal(viewModel.dispose(), false);
  assert.equal(viewModel.isDisposed(), true);
  assert.equal(viewModel.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => viewModel.invoke("refresh_status"),
    /lifecycle panel view model is disposed/u,
  );
});

test("renderer runtime lifecycle panel view model isolates listeners and active dispose", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const hookFactory = createRuntimeLifecyclePanelHookAdapterFactory({
    controllerFactory,
    onError: (error) => {
      errors.push(error);
    },
  });
  const viewModel = createRuntimeLifecyclePanelViewModel({
    adapter: hookFactory.createAdapter({
      onError: (error) => {
        errors.push(error);
      },
    }),
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly filter: string;
    readonly visible: number;
    readonly selected: string | null;
  }> = [];

  const unsubscribeThrowing = viewModel.subscribe((snapshot) => {
    const mutableItems =
      snapshot.visibleTimelineItems as RuntimeLifecyclePanelTimelineItem[];
    mutableItems.push({
      id: "mutated",
      source: "shutdown",
      sourceLabel: "Mutated",
      kind: "shutdown_failed",
      phase: "failed",
      tone: "error",
      statusLabel: "Mutated",
      title: "Mutated",
      summary: "Mutated",
      badges: ["shutdown"],
    });
  });
  const unsubscribeObserved = viewModel.subscribe((snapshot) => {
    observed.push({
      filter: snapshot.timelineFilter,
      visible: snapshot.visibleTimelineItemCount,
      selected: snapshot.selectedTimelineItemId,
    });
  });

  await viewModel.invoke("start_runtime");
  await viewModel.invoke("refresh_status");
  const shutdownOnly = viewModel.setTimelineFilter("shutdown");
  viewModel.selectTimelineItem(shutdownOnly.visibleTimelineItems[0]?.id ?? "");
  assert.deepEqual(observed, [
    { filter: "all", visible: 0, selected: null },
    { filter: "all", visible: 2, selected: null },
    { filter: "shutdown", visible: 1, selected: null },
    {
      filter: "shutdown",
      visible: 1,
      selected: shutdownOnly.visibleTimelineItems[0]?.id ?? null,
    },
  ]);
  assert.equal(errors.length, 4);
  assert.deepEqual(
    viewModel.snapshot().visibleTimelineItems.map((item) => item.title),
    ["Runtime shutdown registered"],
  );

  assert.equal(viewModel.dispose(), true);
  assert.equal(viewModel.listenerCount(), 0);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(viewModel.dispose(), false);
});

test("renderer runtime lifecycle panel interaction dispatches keyboard commands", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const hookFactory = createRuntimeLifecyclePanelHookAdapterFactory({
    controllerFactory,
  });
  const viewModel = createRuntimeLifecyclePanelViewModel({
    adapter: hookFactory.createAdapter(),
  });
  const interaction = createRuntimeLifecyclePanelInteraction({
    viewModel,
  });
  const notifications: Array<{
    readonly focusTarget: string | null;
    readonly command: string | null;
    readonly item: string | null;
    readonly selected: string | null;
    readonly started: boolean;
  }> = [];

  assert.equal(Object.hasOwn(interaction, "viewModel"), false);
  assert.equal(Object.hasOwn(interaction, "adapter"), false);
  assert.equal(Object.hasOwn(interaction, "controller"), false);
  assert.equal(Object.hasOwn(interaction, "session"), false);
  assert.equal(interaction.snapshot().focusTarget, null);
  assert.deepEqual(interaction.snapshot().availableCommandIds, [
    "start_runtime",
    "refresh_status",
  ]);
  assert.deepEqual(interaction.snapshot().enabledCommandIds, [
    "start_runtime",
    "refresh_status",
  ]);
  assert.equal(Object.isFrozen(interaction.snapshot()), true);
  assert.equal(
    Object.isFrozen(interaction.snapshot().availableCommandIds),
    true,
  );
  assert.equal(Object.isFrozen(interaction.snapshot().enabledCommandIds), true);

  const unsubscribe = interaction.subscribe((snapshot) => {
    notifications.push({
      focusTarget: snapshot.focusTarget,
      command: snapshot.focusedCommandId,
      item: snapshot.focusedTimelineItemId,
      selected: snapshot.view.selectedTimelineItemId,
      started: snapshot.view.panel.started,
    });
  });

  const focusedPrimary = await interaction.dispatch("focus_primary_command");
  assert.equal(focusedPrimary.focusedCommandId, "start_runtime");
  assert.equal(focusedPrimary.focusTarget, "command");
  assert.equal(focusedPrimary.canActivateFocusedCommand, true);

  const started = await interaction.dispatch("activate_focused_command");
  assert.equal(started.view.panel.started, true);
  assert.equal(started.availableCommandIds.includes("refresh_status"), true);
  assert.equal(started.availableCommandIds.includes("stop_runtime"), true);
  assert.equal(started.enabledCommandIds.includes("refresh_status"), true);
  assert.equal(started.enabledCommandIds.includes("stop_runtime"), true);

  const refreshed = await interaction.dispatch("refresh_status");
  assert.equal(refreshed.view.visibleTimelineItemCount, 2);
  assert.equal(refreshed.view.totalTimelineItems, 2);
  assert.equal(refreshed.availableCommandIds.includes("wait"), true);
  const focusedWait = interaction.focusCommand("wait");
  assert.equal(focusedWait.canActivateFocusedCommand, false);
  const disabledNoOp = await interaction.dispatch("activate_focused_command");
  assert.equal(disabledNoOp.focusedCommandId, "wait");
  assert.equal(disabledNoOp.view.panel.started, true);
  await assert.rejects(
    async () => interaction.invokeCommand("wait"),
    /command is not enabled/u,
  );

  const focusedTimeline = await interaction.dispatch(
    "focus_next_timeline_item",
  );
  assert.equal(focusedTimeline.focusTarget, "timeline_item");
  assert.equal(focusedTimeline.canSelectFocusedTimelineItem, true);
  assert.equal(
    focusedTimeline.focusedTimelineItemId?.startsWith("startup:"),
    true,
  );

  const selected = await interaction.dispatch("select_focused_timeline_item");
  assert.equal(
    selected.view.selectedTimelineItemId,
    focusedTimeline.focusedTimelineItemId,
  );
  assert.equal(selected.view.selectedTimelineItem?.source, "startup");

  const shutdownOnly = viewModel.setTimelineFilter("shutdown");
  assert.equal(shutdownOnly.selectedTimelineItemId, null);
  assert.equal(interaction.snapshot().focusedTimelineItemId, null);
  const shutdownFocused = await interaction.dispatch(
    "focus_previous_timeline_item",
  );
  assert.equal(
    shutdownFocused.focusedTimelineItemId?.startsWith("shutdown:"),
    true,
  );
  const shutdownSelected = await interaction.dispatch(
    "select_focused_timeline_item",
  );
  assert.equal(shutdownSelected.view.selectedTimelineItem?.source, "shutdown");

  const stopped = await interaction.dispatch("stop_runtime");
  assert.equal(stopped.view.panel.started, false);
  assert.equal(stopped.availableCommandIds.includes("refresh_status"), true);
  assert.equal(stopped.availableCommandIds.includes("stop_runtime"), false);
  assert.equal(
    interaction.focusCommand("refresh_status").focusedCommandId,
    "refresh_status",
  );
  assert.equal(
    interaction.focusTimelineItem(
      stopped.view.visibleTimelineItems[0]?.id ?? "",
    ).focusedTimelineItemId,
    stopped.view.visibleTimelineItems[0]?.id ?? null,
  );
  assert.equal(interaction.clearSelection().view.selectedTimelineItemId, null);

  const unbindPageLifecycle = interaction.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(unbindPageLifecycle(), false);
  assert.equal(pageLifecycle.listenerCount("pagehide"), 0);
  const disposePageLifecycle =
    createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const disposeUnbind = interaction.bindPageLifecycle(disposePageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(disposePageLifecycle.listenerCount("pagehide"), 1);

  await assert.rejects(
    async () =>
      interaction.dispatch(
        "unknown" as RuntimeLifecyclePanelInteractionCommand,
      ),
    /Invalid runtime lifecycle panel interaction command/u,
  );
  assert.throws(
    () => interaction.focusCommand("none"),
    /command is not available/u,
  );
  assert.throws(
    () => interaction.focusTimelineItem("../unsafe item"),
    /Invalid runtime lifecycle panel timeline item id/u,
  );
  assert.ok(notifications.length > 0);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(interaction.listenerCount(), 0);
  assert.equal(interaction.dispose(), true);
  assert.equal(disposePageLifecycle.listenerCount("pagehide"), 0);
  assert.equal(disposeUnbind(), false);
  assert.equal(viewModel.isDisposed(), false);
  assert.equal(interaction.dispose(), false);
  assert.equal(interaction.isDisposed(), true);
  assert.equal(interaction.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => interaction.dispatch("refresh_status"),
    /lifecycle panel interaction is disposed/u,
  );
  assert.equal(viewModel.dispose(), true);
});

test("renderer runtime lifecycle panel interaction isolates listeners and active dispose", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const hookFactory = createRuntimeLifecyclePanelHookAdapterFactory({
    controllerFactory,
    onError: (error) => {
      errors.push(error);
    },
  });
  const viewModel = createRuntimeLifecyclePanelViewModel({
    adapter: hookFactory.createAdapter({
      onError: (error) => {
        errors.push(error);
      },
    }),
    onError: (error) => {
      errors.push(error);
    },
  });
  const interaction = createRuntimeLifecyclePanelInteraction({
    viewModel,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly focusTarget: string | null;
    readonly command: string | null;
    readonly item: string | null;
    readonly selected: string | null;
  }> = [];

  const unsubscribeThrowing = interaction.subscribe((snapshot) => {
    const mutableCommandIds =
      snapshot.availableCommandIds as RuntimeLifecyclePanelInteractionCommand[];
    mutableCommandIds.push("refresh_status");
  });
  const unsubscribeObserved = interaction.subscribe((snapshot) => {
    observed.push({
      focusTarget: snapshot.focusTarget,
      command: snapshot.focusedCommandId,
      item: snapshot.focusedTimelineItemId,
      selected: snapshot.view.selectedTimelineItemId,
    });
  });

  await interaction.dispatch("focus_primary_command");
  await interaction.dispatch("activate_focused_command");
  await interaction.dispatch("refresh_status");
  await interaction.dispatch("focus_next_timeline_item");
  await interaction.dispatch("select_focused_timeline_item");

  assert.equal(errors.length, 5);
  assert.deepEqual(interaction.snapshot().availableCommandIds, [
    "wait",
    "refresh_status",
    "stop_runtime",
  ]);
  assert.equal(
    observed.some(
      (snapshot) =>
        snapshot.focusTarget === "timeline_item" &&
        snapshot.selected?.startsWith("startup:"),
    ),
    true,
  );

  assert.equal(interaction.dispose(), true);
  assert.equal(interaction.listenerCount(), 0);
  assert.equal(runtime.startupUnsubscribeCount(), 0);
  assert.equal(runtime.shutdownUnsubscribeCount(), 0);
  assert.equal(viewModel.isDisposed(), false);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(interaction.dispose(), false);
  assert.equal(viewModel.dispose(), true);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
});

test("renderer runtime lifecycle panel session composes external store contract", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const sessionFactory = createRuntimeLifecyclePanelSessionFactory({
    controllerFactory,
    onError: (error) => {
      errors.push(error);
    },
  });
  const session = sessionFactory.createSession();
  const notifications: Array<{
    readonly filter: string;
    readonly focusedCommand: string | null;
    readonly focusedItem: string | null;
    readonly selected: string | null;
    readonly started: boolean;
    readonly visible: number;
  }> = [];

  assert.equal(Object.hasOwn(session, "adapter"), false);
  assert.equal(Object.hasOwn(session, "controller"), false);
  assert.equal(Object.hasOwn(session, "viewModel"), false);
  assert.equal(Object.hasOwn(session, "interaction"), false);
  const initialSnapshot = session.getSnapshot();
  assert.strictEqual(session.getServerSnapshot(), initialSnapshot);
  assert.strictEqual(session.snapshot(), initialSnapshot);
  assert.equal(initialSnapshot.interaction.view.timelineFilter, "all");
  assert.equal(initialSnapshot.interaction.view.visibleTimelineItemCount, 0);
  assert.equal(Object.isFrozen(initialSnapshot), true);

  const unsubscribe = session.subscribe(() => {
    const snapshot = session.getSnapshot();
    notifications.push({
      filter: snapshot.interaction.view.timelineFilter,
      focusedCommand: snapshot.interaction.focusedCommandId,
      focusedItem: snapshot.interaction.focusedTimelineItemId,
      selected: snapshot.interaction.view.selectedTimelineItemId,
      started: snapshot.interaction.view.panel.started,
      visible: snapshot.interaction.view.visibleTimelineItemCount,
    });
  });

  const focused = await session.dispatch("focus_primary_command");
  assert.equal(focused.interaction.focusedCommandId, "start_runtime");
  assert.notStrictEqual(session.getSnapshot(), initialSnapshot);

  const started = await session.dispatch("activate_focused_command");
  assert.equal(started.interaction.view.panel.started, true);
  const refreshed = await session.dispatch("refresh_status");
  assert.equal(refreshed.interaction.view.visibleTimelineItemCount, 2);
  assert.equal(
    refreshed.interaction.availableCommandIds.includes("wait"),
    true,
  );

  const waitFocused = session.focusCommand("wait");
  assert.equal(waitFocused.interaction.canActivateFocusedCommand, false);
  const beforeNoOpCount = notifications.length;
  const beforeNoOpSnapshot = session.getSnapshot();
  const disabledNoOp = await session.dispatch("activate_focused_command");
  assert.strictEqual(session.getSnapshot(), beforeNoOpSnapshot);
  assert.equal(disabledNoOp.interaction.focusedCommandId, "wait");
  assert.equal(notifications.length, beforeNoOpCount);
  await assert.rejects(
    async () => session.invokeCommand("wait"),
    /command is not enabled/u,
  );

  const shutdownOnly = session.setTimelineFilter("shutdown");
  assert.equal(shutdownOnly.interaction.view.timelineFilter, "shutdown");
  assert.equal(shutdownOnly.interaction.view.visibleTimelineItemCount, 1);
  const focusedTimeline = session.focusTimelineItem(
    shutdownOnly.interaction.view.visibleTimelineItems[0]?.id ?? "",
  );
  assert.equal(
    focusedTimeline.interaction.focusedTimelineItemId?.startsWith("shutdown:"),
    true,
  );
  const selected = await session.dispatch("select_focused_timeline_item");
  assert.equal(
    selected.interaction.view.selectedTimelineItem?.source,
    "shutdown",
  );
  assert.equal(
    session.clearSelection().interaction.view.selectedTimelineItemId,
    null,
  );

  const unbindPageLifecycle = session.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);
  assert.equal(unbindPageLifecycle(), true);
  assert.equal(unbindPageLifecycle(), false);
  assert.equal(pageLifecycle.listenerCount("pagehide"), 0);

  assert.equal(errors.length, 0);
  assert.ok(notifications.length >= 6);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.dispose(), true);
  assert.equal(session.dispose(), false);
  assert.equal(session.isDisposed(), true);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.equal(session.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => session.dispatch("refresh_status"),
    /lifecycle panel session is disposed/u,
  );
  assert.throws(
    () => session.setTimelineFilter("all"),
    /lifecycle panel session is disposed/u,
  );
});

test("renderer runtime lifecycle panel session isolates listeners and active dispose", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const pageLifecycle = createFakeRuntimeLifecycleStatusPageLifecycleTarget();
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const sessionFactory = createRuntimeLifecyclePanelSessionFactory({
    controllerFactory,
    onError: (error) => {
      errors.push(error);
    },
  });
  const session = sessionFactory.createSession({
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly focusedCommand: string | null;
    readonly selected: string | null;
    readonly visible: number;
  }> = [];

  const disposeUnbind = session.bindPageLifecycle(pageLifecycle, {
    eventType: "pagehide",
  });
  assert.equal(pageLifecycle.listenerCount("pagehide"), 1);

  const unsubscribeThrowing = session.subscribe(() => {
    const mutableCommandIds = session.getSnapshot().interaction
      .availableCommandIds as RuntimeLifecyclePanelInteractionCommand[];
    mutableCommandIds.push("refresh_status");
  });
  const unsubscribeObserved = session.subscribe(() => {
    const snapshot = session.getSnapshot();
    observed.push({
      focusedCommand: snapshot.interaction.focusedCommandId,
      selected: snapshot.interaction.view.selectedTimelineItemId,
      visible: snapshot.interaction.view.visibleTimelineItemCount,
    });
  });

  await session.dispatch("focus_primary_command");
  await session.dispatch("activate_focused_command");
  await session.dispatch("refresh_status");
  await session.dispatch("focus_next_timeline_item");
  await session.dispatch("select_focused_timeline_item");

  assert.equal(errors.length, observed.length);
  assert.equal(
    observed.some(
      (snapshot) =>
        snapshot.visible === 2 && snapshot.selected?.startsWith("startup:"),
    ),
    true,
  );
  assert.deepEqual(session.getSnapshot().interaction.availableCommandIds, [
    "wait",
    "refresh_status",
    "stop_runtime",
  ]);

  assert.equal(session.dispose(), true);
  assert.equal(session.listenerCount(), 0);
  assert.equal(pageLifecycle.listenerCount("pagehide"), 0);
  assert.equal(disposeUnbind(), false);
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(session.dispose(), false);
});

test("renderer runtime lifecycle panel session controller replaces active sessions", async () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const sessionFactory = createRuntimeLifecyclePanelSessionFactory({
    controllerFactory,
  });
  const controller = createRuntimeLifecyclePanelSessionController({
    factory: sessionFactory,
  });

  assert.equal(Object.hasOwn(controller, "factory"), false);
  assert.equal(Object.hasOwn(controller, "session"), false);
  assert.deepEqual(controller.getSnapshot(), {
    activeSession: null,
    disposed: false,
  });
  assert.strictEqual(controller.getServerSnapshot(), controller.getSnapshot());

  const startupSession = controller.openSession({
    timelineFilter: "startup",
  });
  assert.equal(controller.activeSession(), startupSession);
  assert.equal(
    controller.getSnapshot().activeSession?.interaction.view.timelineFilter,
    "startup",
  );
  await startupSession.dispatch("focus_primary_command");
  await startupSession.dispatch("activate_focused_command");
  await startupSession.dispatch("refresh_status");
  assert.equal(
    controller.getSnapshot().activeSession?.interaction.view
      .visibleTimelineItemCount,
    1,
  );

  const shutdownSession = controller.openSession({
    timelineFilter: "shutdown",
    focusedCommandId: "refresh_status",
  });
  assert.equal(controller.activeSession(), shutdownSession);
  assert.equal(startupSession.dispose(), false);
  assert.equal(startupSession.isDisposed(), true);
  assert.equal(
    controller.snapshot().activeSession?.interaction.view.timelineFilter,
    "shutdown",
  );
  assert.equal(
    controller.snapshot().activeSession?.interaction.focusedCommandId,
    "refresh_status",
  );
  assert.equal(runtime.startupUnsubscribeCount(), 1);
  assert.equal(runtime.shutdownUnsubscribeCount(), 1);

  assert.equal(controller.disposeActiveSession(), true);
  assert.equal(shutdownSession.dispose(), false);
  assert.equal(controller.activeSession(), null);
  assert.deepEqual(controller.snapshot(), {
    activeSession: null,
    disposed: false,
  });
  assert.equal(controller.disposeActiveSession(), false);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.isDisposed(), true);
  assert.throws(
    () => controller.openSession(),
    /lifecycle panel session controller is disposed/u,
  );
});

test("renderer runtime lifecycle panel session controller keeps active session on create failure", () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const sessionFactory = createRuntimeLifecyclePanelSessionFactory({
    controllerFactory,
  });
  const controller = createRuntimeLifecyclePanelSessionController({
    factory: sessionFactory,
  });
  const session = controller.openSession({
    timelineFilter: "startup",
  });

  assert.throws(
    () =>
      controller.openSession({
        timelineFilter: "not_a_filter" as RuntimeLifecyclePanelTimelineFilter,
      }),
    /Invalid runtime lifecycle panel timeline filter/u,
  );
  assert.equal(controller.activeSession(), session);
  assert.equal(
    controller.snapshot().activeSession?.interaction.view.timelineFilter,
    "startup",
  );
  assert.equal(controller.disposeActiveSession(), true);
  assert.equal(session.dispose(), false);
});

test("renderer runtime lifecycle panel session controller publishes active session snapshots", async () => {
  const errors: unknown[] = [];
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const sessionFactory = createRuntimeLifecyclePanelSessionFactory({
    controllerFactory,
  });
  const controller = createRuntimeLifecyclePanelSessionController({
    factory: sessionFactory,
    onError: (error) => {
      errors.push(error);
    },
  });
  const published: Array<ReturnType<typeof controller.snapshot>> = [];
  const unsubscribeThrowing = controller.subscribe(() => {
    const mutableCommandIds = controller.getSnapshot().activeSession
      ?.interaction.availableCommandIds as
      | RuntimeLifecyclePanelInteractionCommand[]
      | undefined;
    mutableCommandIds?.push("refresh_status");
  });
  const unsubscribeObserved = controller.subscribe(() => {
    published.push(controller.getSnapshot());
  });

  assert.equal(controller.listenerCount(), 2);
  const initialSnapshot = controller.getSnapshot();
  assert.strictEqual(controller.getServerSnapshot(), initialSnapshot);
  assert.equal(Object.isFrozen(initialSnapshot), true);

  const startupSession = controller.openSession({
    timelineFilter: "startup",
  });
  assert.equal(errors.length, 1);
  assert.equal(published.length, 1);
  assert.equal(startupSession.listenerCount(), 1);
  assert.equal(
    published[0]?.activeSession?.interaction.view.timelineFilter,
    "startup",
  );
  assert.deepEqual(
    controller.getSnapshot().activeSession?.interaction.availableCommandIds,
    ["start_runtime", "refresh_status"],
  );

  await startupSession.dispatch("focus_primary_command");
  await startupSession.dispatch("activate_focused_command");
  await startupSession.dispatch("refresh_status");
  assert.equal(
    published.at(-1)?.activeSession?.interaction.view.visibleTimelineItemCount,
    1,
  );
  assert.equal(
    published.some(
      (snapshot) =>
        snapshot.activeSession?.interaction.view.panel.started === true,
    ),
    true,
  );
  assert.equal(errors.length >= 3, true);

  const shutdownSession = controller.openSession({
    timelineFilter: "shutdown",
  });
  assert.equal(startupSession.listenerCount(), 0);
  assert.equal(shutdownSession.listenerCount(), 1);
  assert.equal(startupSession.dispose(), false);
  assert.equal(
    published.at(-1)?.activeSession?.interaction.view.timelineFilter,
    "shutdown",
  );

  const afterReplacePublishCount = published.length;
  await assert.rejects(
    async () => startupSession.dispatch("refresh_status"),
    /lifecycle panel session is disposed/u,
  );
  assert.equal(published.length, afterReplacePublishCount);

  assert.equal(unsubscribeObserved(), true);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(controller.listenerCount(), 1);
  assert.equal(shutdownSession.listenerCount(), 1);
  assert.equal(unsubscribeThrowing(), true);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(shutdownSession.listenerCount(), 0);
  assert.equal(controller.dispose(), true);
});

test("renderer runtime lifecycle panel session controller publishes active disposal", () => {
  const runtime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const controllerFactory = createRuntimeLifecyclePanelControllerFactory({
    runtime: runtime.runtime,
  });
  const sessionFactory = createRuntimeLifecyclePanelSessionFactory({
    controllerFactory,
  });
  const controller = createRuntimeLifecyclePanelSessionController({
    factory: sessionFactory,
  });
  const published: Array<ReturnType<typeof controller.snapshot>> = [];
  controller.subscribe(() => {
    published.push(controller.getSnapshot());
  });
  const session = controller.openSession();

  assert.equal(session.listenerCount(), 1);
  assert.equal(controller.disposeActiveSession(), true);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.dispose(), false);
  assert.deepEqual(published.at(-1), {
    activeSession: null,
    disposed: false,
  });

  assert.equal(controller.dispose(), true);
  assert.equal(controller.listenerCount(), 0);
  assert.equal(controller.snapshot().disposed, true);
  assert.equal(published.at(-1)?.disposed, true);
  assert.equal(controller.subscribe(() => undefined)(), false);
});

test("renderer runtime workbench session composes lifecycle and stream stores", async () => {
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const streamRuntime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_workbench",
    }),
  };
  const lifecycleSessionFactory = createRuntimeLifecyclePanelSessionFactory({
    controllerFactory: createRuntimeLifecyclePanelControllerFactory({
      runtime: lifecycleRuntime.runtime,
    }),
  });
  const streamSessionFactory = createRuntimeStreamInteractionSessionFactory({
    runtime: streamRuntime,
    eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
  });
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: lifecycleSessionFactory,
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: streamSessionFactory,
    });
  const workbench = createRuntimeWorkbenchSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const published: Array<ReturnType<typeof workbench.snapshot>> = [];

  assert.equal(Object.hasOwn(workbench, "lifecyclePanelController"), false);
  assert.equal(Object.hasOwn(workbench, "runtimeStreamController"), false);
  assert.equal(Object.hasOwn(workbench, "factory"), false);
  const initialSnapshot = workbench.getSnapshot();
  assert.deepEqual(initialSnapshot, {
    activePanel: "lifecycle",
    lifecyclePanel: {
      activeSession: null,
      disposed: false,
    },
    runtimeStream: {
      activeChannel: null,
      activeSession: null,
      disposed: false,
    },
    disposed: false,
  });
  assert.strictEqual(workbench.getServerSnapshot(), initialSnapshot);
  assert.strictEqual(workbench.snapshot(), initialSnapshot);
  assert.equal(Object.isFrozen(initialSnapshot), true);

  const unsubscribe = workbench.subscribe(() => {
    published.push(workbench.getSnapshot());
  });
  const lifecycleSession = workbench.openLifecyclePanelSession({
    timelineFilter: "startup",
  });
  assert.equal(workbench.activePanel(), "lifecycle");
  assert.equal(lifecyclePanelController.activeSession(), lifecycleSession);
  assert.equal(lifecycleSession.listenerCount(), 1);
  assert.equal(runtimeStreamController.listenerCount(), 1);
  assert.equal(
    workbench.snapshot().lifecyclePanel.activeSession?.interaction.view
      .timelineFilter,
    "startup",
  );

  await lifecycleSession.dispatch("focus_primary_command");
  await lifecycleSession.dispatch("activate_focused_command");
  await lifecycleSession.dispatch("refresh_status");
  assert.equal(
    published.at(-1)?.lifecyclePanel.activeSession?.interaction.view
      .visibleTimelineItemCount,
    1,
  );

  const streamSession = workbench.openRuntimeStreamSession({
    channel: { kind: "run", runId: "run_workbench" },
    clientFactory: streamClientFactory.factory,
    eventTypes: ["model.text_delta"],
  });
  assert.equal(workbench.activePanel(), "stream");
  assert.notEqual(runtimeStreamController.activeSession(), streamSession);
  assert.equal(Object.hasOwn(streamSession, "store"), false);
  assert.equal(Object.hasOwn(streamSession, "viewModel"), false);
  assert.equal(Object.hasOwn(streamSession, "interaction"), false);
  assert.deepEqual(streamSession.eventTypes, ["model.text_delta"]);
  assert.equal(Object.isFrozen(streamSession), true);
  assert.equal(Object.isFrozen(streamSession.eventTypes), true);
  assert.deepEqual(workbench.snapshot().runtimeStream.activeChannel, {
    kind: "run",
    runId: "run_workbench",
  });
  assert.equal(streamSession.listenerCount(), 1);

  await streamSession.start();
  const streamClient = streamClientFactory.clients[0];
  assert.ok(streamClient !== undefined);
  streamClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_workbench_stream",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Workbench stream",
      content: "stream content",
      expandable: true,
      created_at: "2026-06-21T00:00:00.008Z",
    }),
  );
  streamClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_workbench_stream_child",
      parent_event_id: "evt_workbench_stream",
      seq: 2,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Workbench stream child",
      content: "stream child content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.009Z",
    }),
  );
  assert.equal(
    workbench.snapshot().runtimeStream.activeSession?.store.totalEvents,
    2,
  );
  const searchedStream = streamSession.dispatch({
    type: "set_search_query",
    query: "stream",
  });
  assert.equal(searchedStream.interaction.search.query, "stream");
  assert.equal(
    searchedStream.interaction.search.activeEventId,
    "evt_workbench_stream",
  );
  const selectedStream = streamSession.dispatch({
    type: "select_active_search_match",
  });
  assert.equal(
    selectedStream.interaction.selectedEventId,
    "evt_workbench_stream",
  );
  const expandedStream = await workbench.dispatchRuntimeStreamCommand({
    type: "toggle_expanded",
    eventId: "evt_workbench_stream",
  });
  assert.equal(
    expandedStream.runtimeStream.activeSession?.interaction.view
      .timelineItems[0]?.expanded,
    true,
  );

  const beforeNoOpPanel = workbench.getSnapshot();
  const noOpPanel = workbench.setActivePanel("stream");
  assert.strictEqual(noOpPanel, beforeNoOpPanel);
  const lifecycleActive = workbench.setActivePanel("lifecycle");
  assert.equal(lifecycleActive.activePanel, "lifecycle");
  assert.throws(
    () => workbench.setActivePanel("invalid" as RuntimeWorkbenchPanelId),
    /Invalid runtime workbench panel id/u,
  );
  assert.equal(workbench.activePanel(), "lifecycle");

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(workbench.listenerCount(), 0);
  assert.equal(lifecyclePanelController.listenerCount(), 0);
  assert.equal(runtimeStreamController.listenerCount(), 0);
  assert.equal(workbench.dispose(), true);
  assert.equal(workbench.dispose(), false);
  assert.equal(workbench.isDisposed(), true);
  assert.equal(lifecycleSession.dispose(), false);
  assert.equal(streamSession.dispose(), false);
  assert.equal(lifecyclePanelController.isDisposed(), true);
  assert.equal(runtimeStreamController.isDisposed(), true);
  assert.equal(workbench.subscribe(() => undefined)(), false);
  assert.throws(
    () => workbench.openLifecyclePanelSession(),
    /Runtime workbench session is disposed/u,
  );
  assert.throws(
    () => workbench.setActivePanel("stream"),
    /Runtime workbench session is disposed/u,
  );
});

test("renderer runtime workbench session keeps state on open failure and isolates listeners", async () => {
  const errors: unknown[] = [];
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const streamRuntime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_workbench",
    }),
  };
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: streamRuntime,
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const workbench = createRuntimeWorkbenchSession({
    lifecyclePanelController,
    runtimeStreamController,
    activePanel: "stream",
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly activePanel: string;
    readonly hasLifecycle: boolean;
    readonly streamTotal: number;
    readonly disposed: boolean;
  }> = [];
  const unsubscribeThrowing = workbench.subscribe(() => {
    throw new Error("workbench listener failed");
  });
  const unsubscribeObserved = workbench.subscribe(() => {
    const snapshot = workbench.getSnapshot();
    observed.push({
      activePanel: snapshot.activePanel,
      hasLifecycle: snapshot.lifecyclePanel.activeSession !== null,
      streamTotal: snapshot.runtimeStream.activeSession?.store.totalEvents ?? 0,
      disposed: snapshot.disposed,
    });
  });

  const lifecycleSession = workbench.openLifecyclePanelSession();
  assert.equal(errors.length, 1);
  assert.equal(workbench.activePanel(), "lifecycle");
  assert.equal(lifecyclePanelController.activeSession(), lifecycleSession);

  assert.throws(
    () =>
      workbench.openRuntimeStreamSession({
        channel: { kind: "run", runId: "run_invalid_workbench" },
        eventTypes: ["model.fake" as RuntimeStreamKnownEventType],
      }),
    /StreamEvent spec/u,
  );
  assert.equal(workbench.activePanel(), "lifecycle");
  assert.equal(lifecyclePanelController.activeSession(), lifecycleSession);
  assert.equal(runtimeStreamController.activeSession(), null);

  const streamSession = workbench.openRuntimeStreamSession({
    channel: { kind: "run", runId: "run_observed_workbench" },
    clientFactory: streamClientFactory.factory,
    eventTypes: ["model.text_delta"],
  });
  await streamSession.start();
  const streamClient = streamClientFactory.clients[0];
  assert.ok(streamClient !== undefined);
  streamClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_workbench_observed",
      seq: 2,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Workbench observed",
      content: "observed content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.009Z",
    }),
  );
  assert.equal(
    observed.some(
      (snapshot) =>
        snapshot.activePanel === "stream" &&
        snapshot.hasLifecycle &&
        snapshot.streamTotal === 1,
    ),
    true,
  );
  assert.equal(errors.length >= observed.length, true);

  assert.equal(workbench.disposeRuntimeStreamSession(), true);
  assert.equal(streamSession.dispose(), false);
  assert.equal(workbench.snapshot().runtimeStream.activeSession, null);
  const beforeNoOpStreamDisposeCount = observed.length;
  const beforeNoOpStreamDisposeSnapshot = workbench.getSnapshot();
  assert.equal(workbench.disposeRuntimeStreamSession(), false);
  assert.equal(observed.length, beforeNoOpStreamDisposeCount);
  assert.strictEqual(workbench.getSnapshot(), beforeNoOpStreamDisposeSnapshot);
  assert.equal(workbench.disposeLifecyclePanelSession(), true);
  assert.equal(lifecycleSession.dispose(), false);
  assert.equal(workbench.snapshot().lifecyclePanel.activeSession, null);
  const beforeNoOpLifecycleDisposeCount = observed.length;
  const beforeNoOpLifecycleDisposeSnapshot = workbench.getSnapshot();
  assert.equal(workbench.disposeLifecyclePanelSession(), false);
  assert.equal(observed.length, beforeNoOpLifecycleDisposeCount);
  assert.strictEqual(
    workbench.getSnapshot(),
    beforeNoOpLifecycleDisposeSnapshot,
  );

  assert.equal(workbench.dispose(), true);
  assert.equal(observed.at(-1)?.disposed, true);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(workbench.listenerCount(), 0);
});

test("renderer runtime workbench interaction routes UI commands", async () => {
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const streamRuntime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_workbench_interaction",
    }),
  };
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: streamRuntime,
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const workbench = createRuntimeWorkbenchSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const interaction = createRuntimeWorkbenchInteraction({ workbench });
  const observed: Array<ReturnType<typeof interaction.snapshot>> = [];

  assert.equal(Object.hasOwn(interaction, "workbench"), false);
  assert.equal(Object.hasOwn(interaction, "lifecyclePanelController"), false);
  assert.equal(Object.hasOwn(interaction, "runtimeStreamController"), false);
  const initialSnapshot = interaction.getSnapshot();
  assert.equal(initialSnapshot.activePanel, "lifecycle");
  assert.deepEqual(initialSnapshot.availableCommandIds, [
    "show_canvas_panel",
    "show_lifecycle_panel",
    "show_stream_panel",
    "open_lifecycle_panel_session",
    "dispose_lifecycle_panel_session",
    "open_runtime_stream_session",
    "dispose_runtime_stream_session",
    "dispatch_lifecycle_panel",
    "dispatch_runtime_stream",
  ]);
  assert.deepEqual(initialSnapshot.enabledCommandIds, [
    "show_canvas_panel",
    "show_stream_panel",
    "open_lifecycle_panel_session",
    "open_runtime_stream_session",
  ]);
  assert.equal(Object.isFrozen(initialSnapshot), true);
  assert.equal(Object.isFrozen(initialSnapshot.availableCommandIds), true);
  assert.equal(Object.isFrozen(initialSnapshot.enabledCommandIds), true);
  assert.strictEqual(interaction.getServerSnapshot(), initialSnapshot);
  assert.strictEqual(interaction.snapshot(), initialSnapshot);

  const unsubscribe = interaction.subscribe((snapshot) => {
    observed.push(snapshot);
  });

  const lifecycleOpened = await interaction.dispatch({
    type: "open_lifecycle_panel_session",
    options: { timelineFilter: "startup" },
  });
  assert.equal(lifecycleOpened.activePanel, "lifecycle");
  assert.equal(
    lifecycleOpened.workbench.lifecyclePanel.activeSession?.interaction.view
      .timelineFilter,
    "startup",
  );
  assert.equal(
    lifecycleOpened.enabledCommandIds.includes("dispatch_lifecycle_panel"),
    true,
  );

  const focusedPrimary = await interaction.dispatch({
    type: "dispatch_lifecycle_panel",
    command: "focus_primary_command",
  });
  assert.equal(
    focusedPrimary.workbench.lifecyclePanel.activeSession?.interaction
      .focusedCommandId,
    "start_runtime",
  );
  const started = await interaction.dispatch({
    type: "dispatch_lifecycle_panel",
    command: "activate_focused_command",
  });
  assert.equal(
    started.workbench.lifecyclePanel.activeSession?.interaction.view.panel
      .started,
    true,
  );
  const refreshed = await interaction.dispatch({
    type: "dispatch_lifecycle_panel",
    command: "refresh_status",
  });
  assert.equal(
    refreshed.workbench.lifecyclePanel.activeSession?.interaction.view
      .visibleTimelineItemCount,
    1,
  );
  const beforeInvalidNestedCommand = interaction.getSnapshot();
  await assert.rejects(
    async () =>
      interaction.dispatch({
        type: "dispatch_lifecycle_panel",
        command:
          "unknown" as unknown as RuntimeLifecyclePanelInteractionCommand,
      }),
    /Invalid runtime lifecycle panel interaction command/u,
  );
  assert.strictEqual(interaction.getSnapshot(), beforeInvalidNestedCommand);

  const streamOpened = await interaction.dispatch({
    type: "open_runtime_stream_session",
    options: {
      channel: { kind: "run", runId: "run_workbench_interaction" },
      clientFactory: streamClientFactory.factory,
      eventTypes: ["model.text_delta"],
    },
  });
  assert.equal(streamOpened.activePanel, "stream");
  assert.deepEqual(streamOpened.workbench.runtimeStream.activeChannel, {
    kind: "run",
    runId: "run_workbench_interaction",
  });
  assert.equal(
    streamOpened.enabledCommandIds.includes("dispose_runtime_stream_session"),
    true,
  );
  assert.equal(
    streamOpened.enabledCommandIds.includes("dispatch_runtime_stream"),
    true,
  );

  const canvasShown = await interaction.dispatch({
    type: "show_canvas_panel",
  });
  assert.equal(canvasShown.activePanel, "canvas");
  assert.deepEqual(
    canvasShown.enabledCommandIds.filter((commandId) =>
      commandId.startsWith("show_"),
    ),
    ["show_lifecycle_panel", "show_stream_panel"],
  );
  const streamReopened = await interaction.dispatch({
    type: "show_stream_panel",
  });
  assert.equal(streamReopened.activePanel, "stream");

  const activeStreamSession = runtimeStreamController.activeSession();
  assert.ok(activeStreamSession !== null);
  await activeStreamSession.start();
  const streamClient = streamClientFactory.clients[0];
  assert.ok(streamClient !== undefined);
  streamClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_workbench_interaction",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Workbench interaction stream",
      content: "interaction stream content",
      expandable: true,
      created_at: "2026-06-21T00:00:00.010Z",
    }),
  );
  streamClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_workbench_interaction_child",
      parent_event_id: "evt_workbench_interaction",
      seq: 2,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Workbench interaction stream child",
      content: "interaction stream child content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.011Z",
    }),
  );
  assert.equal(
    interaction.snapshot().workbench.runtimeStream.activeSession?.store
      .totalEvents,
    2,
  );
  const streamSearched = await interaction.dispatch({
    type: "dispatch_runtime_stream",
    command: { type: "set_search_query", query: "interaction" },
  });
  assert.equal(
    streamSearched.workbench.runtimeStream.activeSession?.interaction.search
      .query,
    "interaction",
  );
  assert.equal(
    streamSearched.workbench.runtimeStream.activeSession?.interaction.search
      .activeEventId,
    "evt_workbench_interaction",
  );
  const streamSelected = await interaction.dispatch({
    type: "dispatch_runtime_stream",
    command: { type: "select_active_search_match" },
  });
  assert.equal(
    streamSelected.workbench.runtimeStream.activeSession?.interaction
      .selectedEventId,
    "evt_workbench_interaction",
  );
  const streamExpanded = await interaction.dispatch({
    type: "dispatch_runtime_stream",
    command: { type: "toggle_expanded", eventId: "evt_workbench_interaction" },
  });
  assert.equal(
    streamExpanded.workbench.runtimeStream.activeSession?.interaction.view
      .timelineItems[0]?.expanded,
    true,
  );
  const streamMarkedRead = await interaction.dispatch({
    type: "dispatch_runtime_stream",
    command: { type: "mark_all_read" },
  });
  assert.equal(
    streamMarkedRead.workbench.runtimeStream.activeSession?.interaction.read
      .unreadCount,
    0,
  );
  const beforeInvalidStreamCommand = interaction.getSnapshot();
  await assert.rejects(
    async () =>
      interaction.dispatch({
        type: "dispatch_runtime_stream",
        command: {
          type: "set_search_query",
          query: "\u0000",
        } satisfies RuntimeStreamInteractionCommand,
      }),
    /control characters/u,
  );
  assert.strictEqual(interaction.getSnapshot(), beforeInvalidStreamCommand);

  const beforeNoOpPanelCount = observed.length;
  const beforeNoOpPanelSnapshot = interaction.getSnapshot();
  const sameStreamPanel = await interaction.dispatch({
    type: "show_stream_panel",
  });
  assert.strictEqual(sameStreamPanel, beforeNoOpPanelSnapshot);
  assert.equal(observed.length, beforeNoOpPanelCount);

  const lifecycleShown = await interaction.dispatch({
    type: "show_lifecycle_panel",
  });
  assert.equal(lifecycleShown.activePanel, "lifecycle");
  const streamDisposed = await interaction.dispatch({
    type: "dispose_runtime_stream_session",
  });
  assert.equal(streamDisposed.workbench.runtimeStream.activeSession, null);
  const lifecycleDisposed = await interaction.dispatch({
    type: "dispose_lifecycle_panel_session",
  });
  assert.equal(lifecycleDisposed.workbench.lifecyclePanel.activeSession, null);

  const stableSnapshot = interaction.getSnapshot();
  await assert.rejects(
    async () =>
      interaction.dispatch({
        type: "unknown",
      } as unknown as RuntimeWorkbenchInteractionCommand),
    /Invalid runtime workbench interaction command/u,
  );
  assert.strictEqual(interaction.getSnapshot(), stableSnapshot);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(interaction.listenerCount(), 0);
  assert.equal(interaction.dispose(), true);
  assert.equal(workbench.dispose(), true);
});

test("renderer runtime workbench interaction isolates listeners and active dispose", async () => {
  const errors: unknown[] = [];
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const streamRuntime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_workbench_interaction_error",
    }),
  };
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: streamRuntime,
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const workbench = createRuntimeWorkbenchSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const interaction = createRuntimeWorkbenchInteraction({
    workbench,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly activePanel: string;
    readonly hasLifecycle: boolean;
    readonly hasStream: boolean;
    readonly disposed: boolean;
  }> = [];

  await assert.rejects(
    async () =>
      interaction.dispatch({
        type: "dispatch_lifecycle_panel",
        command: "refresh_status",
      }),
    /lifecycle panel session is not active/u,
  );
  await assert.rejects(
    async () =>
      interaction.dispatch({
        type: "dispatch_runtime_stream",
        command: { type: "clear_search" },
      }),
    /stream session is not active/u,
  );

  const unsubscribeThrowing = interaction.subscribe((snapshot) => {
    const mutableCommandIds =
      snapshot.enabledCommandIds as RuntimeWorkbenchInteractionCommandId[];
    mutableCommandIds.push("show_stream_panel");
  });
  const unsubscribeObserved = interaction.subscribe((snapshot) => {
    observed.push({
      activePanel: snapshot.activePanel,
      hasLifecycle: snapshot.workbench.lifecyclePanel.activeSession !== null,
      hasStream: snapshot.workbench.runtimeStream.activeSession !== null,
      disposed: snapshot.disposed,
    });
  });

  await interaction.dispatch({
    type: "open_lifecycle_panel_session",
  });
  assert.equal(errors.length, 1);
  assert.equal(observed.at(-1)?.hasLifecycle, true);
  assert.equal(workbench.listenerCount(), 1);

  await assert.rejects(
    async () =>
      interaction.dispatch({
        type: "open_runtime_stream_session",
        options: {
          channel: { kind: "run", runId: "run_invalid_interaction" },
          clientFactory: streamClientFactory.factory,
          eventTypes: ["model.fake" as RuntimeStreamKnownEventType],
        },
      }),
    /StreamEvent spec/u,
  );
  assert.equal(interaction.snapshot().activePanel, "lifecycle");
  assert.equal(runtimeStreamController.activeSession(), null);

  await interaction.dispatch({
    type: "open_runtime_stream_session",
    options: {
      channel: { kind: "run", runId: "run_interaction_dispose" },
      clientFactory: streamClientFactory.factory,
      eventTypes: ["model.text_delta"],
    },
  });
  assert.equal(observed.at(-1)?.activePanel, "stream");
  assert.equal(observed.at(-1)?.hasStream, true);

  assert.equal(interaction.dispose(), true);
  assert.equal(observed.at(-1)?.disposed, true);
  assert.equal(interaction.dispose(), false);
  assert.equal(interaction.isDisposed(), true);
  assert.equal(workbench.isDisposed(), false);
  assert.equal(workbench.listenerCount(), 0);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(interaction.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () =>
      interaction.dispatch({
        type: "show_lifecycle_panel",
      }),
    /Runtime workbench interaction is disposed/u,
  );

  assert.equal(workbench.dispose(), true);
});

test("renderer runtime workbench shortcuts map key events to commands", async () => {
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const streamRuntime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_workbench_shortcuts",
    }),
  };
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: streamRuntime,
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const workbench = createRuntimeWorkbenchSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const interaction = createRuntimeWorkbenchInteraction({ workbench });
  const shortcuts = createRuntimeWorkbenchShortcutController({ interaction });
  const observed: Array<ReturnType<typeof shortcuts.snapshot>> = [];
  let preventDefaultCount = 0;
  const key = (
    event: Omit<RuntimeWorkbenchShortcutKeyEvent, "preventDefault">,
  ): RuntimeWorkbenchShortcutKeyEvent => ({
    ...event,
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });

  assert.equal(Object.hasOwn(shortcuts, "interaction"), false);
  assert.equal(Object.hasOwn(shortcuts, "workbench"), false);
  const initialSnapshot = shortcuts.getSnapshot();
  assert.equal(initialSnapshot.workbench.activePanel, "lifecycle");
  assert.equal(
    initialSnapshot.availableShortcutIds.includes("show_stream_panel"),
    true,
  );
  assert.deepEqual(initialSnapshot.enabledShortcutIds, [
    "show_canvas_panel",
    "show_stream_panel",
  ]);
  assert.equal(Object.isFrozen(initialSnapshot), true);
  assert.equal(Object.isFrozen(initialSnapshot.availableShortcutIds), true);
  assert.equal(Object.isFrozen(initialSnapshot.enabledShortcutIds), true);
  assert.strictEqual(shortcuts.getServerSnapshot(), initialSnapshot);
  assert.strictEqual(shortcuts.snapshot(), initialSnapshot);
  assert.equal(
    shortcuts.resolveKeyEvent(key({ key: "0", ctrlKey: true }))?.shortcutId,
    "show_canvas_panel",
  );
  assert.equal(
    shortcuts.resolveKeyEvent(key({ key: "2", ctrlKey: true }))?.shortcutId,
    "show_stream_panel",
  );

  const unsubscribe = shortcuts.subscribe((snapshot) => {
    observed.push(snapshot);
  });

  const canvasShown = await shortcuts.handleKeyEvent(
    key({ key: "0", ctrlKey: true }),
  );
  assert.equal(canvasShown.workbench.activePanel, "canvas");
  assert.equal(canvasShown.lastHandledShortcutId, "show_canvas_panel");
  assert.equal(preventDefaultCount, 1);
  assert.equal(observed.length, 1);

  const streamShown = await shortcuts.handleKeyEvent(
    key({ key: "2", ctrlKey: true }),
  );
  assert.equal(streamShown.workbench.activePanel, "stream");
  assert.equal(streamShown.lastHandledShortcutId, "show_stream_panel");
  assert.equal(preventDefaultCount, 2);
  assert.equal(observed.length, 2);

  const beforeIgnoredRepeatCount = observed.length;
  const beforeIgnoredRepeatSnapshot = shortcuts.getSnapshot();
  const ignoredRepeat = await shortcuts.handleKeyEvent(
    key({ key: "1", ctrlKey: true, repeat: true }),
  );
  assert.strictEqual(ignoredRepeat, beforeIgnoredRepeatSnapshot);
  assert.equal(observed.length, beforeIgnoredRepeatCount);
  assert.equal(preventDefaultCount, 2);

  const beforeEditableCount = observed.length;
  const beforeEditableSnapshot = shortcuts.getSnapshot();
  const ignoredEditable = await shortcuts.handleKeyEvent(
    key({
      key: "1",
      ctrlKey: true,
      target: { tagName: "input", type: "text" },
    }),
  );
  assert.strictEqual(ignoredEditable, beforeEditableSnapshot);
  assert.equal(observed.length, beforeEditableCount);
  assert.equal(preventDefaultCount, 2);

  const lifecycleShown = await shortcuts.handleKeyEvent(
    key({ key: "1", ctrlKey: true }),
  );
  assert.equal(lifecycleShown.workbench.activePanel, "lifecycle");
  assert.equal(lifecycleShown.lastHandledShortcutId, "show_lifecycle_panel");
  assert.equal(preventDefaultCount, 3);
  assert.equal(observed.length, 3);

  await interaction.dispatch({
    type: "open_lifecycle_panel_session",
    options: { timelineFilter: "startup" },
  });
  assert.equal(observed.length, 4);
  assert.equal(
    shortcuts
      .snapshot()
      .enabledShortcutIds.includes("focus_lifecycle_primary_command"),
    true,
  );

  const primaryFocused = await shortcuts.handleKeyEvent(
    key({ key: "Home", altKey: true }),
  );
  assert.equal(
    primaryFocused.workbench.workbench.lifecyclePanel.activeSession?.interaction
      .focusedCommandId,
    "start_runtime",
  );
  assert.equal(
    primaryFocused.lastHandledShortcutId,
    "focus_lifecycle_primary_command",
  );

  const started = await shortcuts.handleKeyEvent(key({ key: "Enter" }));
  assert.equal(
    started.workbench.workbench.lifecyclePanel.activeSession?.interaction.view
      .panel.started,
    true,
  );
  assert.equal(
    started.lastHandledShortcutId,
    "activate_lifecycle_focused_command",
  );

  const refreshed = await shortcuts.handleKeyEvent(key({ key: "F5" }));
  assert.equal(refreshed.lastHandledShortcutId, "refresh_lifecycle_status");
  assert.equal(
    refreshed.workbench.workbench.lifecyclePanel.activeSession?.interaction.view
      .visibleTimelineItemCount,
    1,
  );

  const timelineFocused = await shortcuts.handleKeyEvent(
    key({ key: "ArrowDown", altKey: true }),
  );
  assert.equal(
    timelineFocused.workbench.workbench.lifecyclePanel.activeSession
      ?.interaction.focusTarget,
    "timeline_item",
  );
  assert.equal(
    timelineFocused.lastHandledShortcutId,
    "focus_next_lifecycle_timeline_item",
  );

  const timelineSelected = await shortcuts.handleKeyEvent(
    key({ key: "Enter" }),
  );
  assert.equal(
    timelineSelected.workbench.workbench.lifecyclePanel.activeSession
      ?.interaction.view.selectedTimelineItem?.source,
    "startup",
  );
  assert.equal(
    timelineSelected.lastHandledShortcutId,
    "select_lifecycle_timeline_item",
  );

  const selectionCleared = await shortcuts.handleKeyEvent(
    key({ key: "Escape" }),
  );
  assert.equal(
    selectionCleared.workbench.workbench.lifecyclePanel.activeSession
      ?.interaction.view.selectedTimelineItemId,
    null,
  );
  assert.equal(
    selectionCleared.lastHandledShortcutId,
    "clear_lifecycle_selection",
  );

  await interaction.dispatch({
    type: "open_runtime_stream_session",
    options: {
      channel: { kind: "run", runId: "run_shortcuts" },
      clientFactory: streamClientFactory.factory,
      eventTypes: ["model.text_delta"],
    },
  });
  const streamDisposed = await shortcuts.handleKeyEvent(
    key({ key: "Escape", shiftKey: true }),
  );
  assert.equal(
    streamDisposed.workbench.workbench.runtimeStream.activeSession,
    null,
  );
  assert.equal(
    streamDisposed.lastHandledShortcutId,
    "dispose_runtime_stream_session",
  );

  const beforeDefaultPreventedCount = observed.length;
  const beforeDefaultPreventedSnapshot = shortcuts.getSnapshot();
  const ignoredDefaultPrevented = await shortcuts.handleKeyEvent(
    key({ key: "1", ctrlKey: true, defaultPrevented: true }),
  );
  assert.strictEqual(ignoredDefaultPrevented, beforeDefaultPreventedSnapshot);
  assert.equal(observed.length, beforeDefaultPreventedCount);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(shortcuts.listenerCount(), 0);
  assert.equal(shortcuts.dispose(), true);
  assert.equal(interaction.dispose(), true);
  assert.equal(workbench.dispose(), true);
});

test("renderer runtime workbench shortcuts isolate listeners and active dispose", async () => {
  const errors: unknown[] = [];
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: {
          connectionInfo: async () => ({
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_workbench_shortcuts_isolation",
          }),
        },
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const workbench = createRuntimeWorkbenchSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const interaction = createRuntimeWorkbenchInteraction({ workbench });
  const shortcuts = createRuntimeWorkbenchShortcutController({
    interaction,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly panel: string;
    readonly lastHandledShortcutId: string | null;
    readonly disposed: boolean;
  }> = [];

  const unsubscribeThrowing = shortcuts.subscribe((snapshot) => {
    const mutableShortcutIds =
      snapshot.enabledShortcutIds as RuntimeWorkbenchShortcutId[];
    mutableShortcutIds.push("show_stream_panel");
  });
  const unsubscribeObserved = shortcuts.subscribe((snapshot) => {
    observed.push({
      panel: snapshot.workbench.activePanel,
      lastHandledShortcutId: snapshot.lastHandledShortcutId,
      disposed: snapshot.disposed,
    });
  });

  await shortcuts.handleKeyEvent({
    key: "2",
    ctrlKey: true,
  });
  assert.equal(errors.length, 1);
  assert.equal(observed.at(-1)?.panel, "stream");
  assert.equal(observed.at(-1)?.lastHandledShortcutId, "show_stream_panel");
  assert.equal(interaction.listenerCount(), 1);

  const stableSnapshot = shortcuts.getSnapshot();
  await assert.rejects(
    async () =>
      shortcuts.handleKeyEvent({
        key: "",
      } as unknown as RuntimeWorkbenchShortcutKeyEvent),
    /Invalid runtime workbench shortcut key event/u,
  );
  assert.strictEqual(shortcuts.getSnapshot(), stableSnapshot);

  assert.equal(shortcuts.dispose(), true);
  assert.equal(observed.at(-1)?.disposed, true);
  assert.equal(shortcuts.dispose(), false);
  assert.equal(shortcuts.isDisposed(), true);
  assert.equal(interaction.isDisposed(), false);
  assert.equal(interaction.listenerCount(), 0);
  assert.equal(workbench.isDisposed(), false);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(shortcuts.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => shortcuts.handleKeyEvent({ key: "1", ctrlKey: true }),
    /Runtime workbench shortcut controller is disposed/u,
  );

  assert.equal(interaction.dispose(), true);
  assert.equal(workbench.dispose(), true);
});

test("renderer runtime workbench host session composes interaction and shortcuts", async () => {
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const streamRuntime = {
    connectionInfo: async () => ({
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_workbench_host",
    }),
  };
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: streamRuntime,
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const observed: Array<ReturnType<typeof host.snapshot>> = [];
  let preventDefaultCount = 0;
  const key = (
    event: Omit<RuntimeWorkbenchShortcutKeyEvent, "preventDefault">,
  ): RuntimeWorkbenchShortcutKeyEvent => ({
    ...event,
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });

  assert.equal(Object.hasOwn(host, "workbench"), false);
  assert.equal(Object.hasOwn(host, "interaction"), false);
  assert.equal(Object.hasOwn(host, "shortcuts"), false);
  assert.equal(Object.hasOwn(host, "lifecyclePanelController"), false);
  assert.equal(Object.hasOwn(host, "runtimeStreamController"), false);
  const initialSnapshot = host.getSnapshot();
  assert.equal(initialSnapshot.activePanel, "lifecycle");
  assert.equal(Object.hasOwn(initialSnapshot, "workbench"), false);
  assert.equal(Object.hasOwn(initialSnapshot, "interaction"), false);
  assert.equal(Object.hasOwn(initialSnapshot, "shortcuts"), false);
  assert.deepEqual(initialSnapshot.lifecyclePanel, {
    active: false,
    disposed: false,
    activeSession: null,
  });
  assert.deepEqual(initialSnapshot.runtimeStream, {
    active: false,
    activeChannel: null,
    disposed: false,
  });
  assert.deepEqual(initialSnapshot.enabledCommandIds, [
    "show_canvas_panel",
    "show_stream_panel",
    "open_lifecycle_panel_session",
    "open_runtime_stream_session",
  ]);
  assert.deepEqual(initialSnapshot.enabledShortcutIds, [
    "show_canvas_panel",
    "show_stream_panel",
  ]);
  assert.equal(Object.isFrozen(initialSnapshot), true);
  assert.equal(Object.isFrozen(initialSnapshot.lifecyclePanel), true);
  assert.equal(Object.isFrozen(initialSnapshot.runtimeStream), true);
  assert.equal(Object.isFrozen(initialSnapshot.enabledCommandIds), true);
  assert.equal(Object.isFrozen(initialSnapshot.enabledShortcutIds), true);
  assert.strictEqual(host.getServerSnapshot(), initialSnapshot);
  assert.strictEqual(host.snapshot(), initialSnapshot);
  assert.equal(
    host.resolveKeyEvent(key({ key: "0", ctrlKey: true }))?.shortcutId,
    "show_canvas_panel",
  );
  assert.equal(
    host.resolveKeyEvent(key({ key: "2", ctrlKey: true }))?.shortcutId,
    "show_stream_panel",
  );

  const unsubscribe = host.subscribe(() => {
    observed.push(host.getSnapshot());
  });
  assert.equal(lifecyclePanelController.listenerCount(), 1);
  assert.equal(runtimeStreamController.listenerCount(), 1);

  const canvasShown = await host.handleKeyEvent(
    key({ key: "0", ctrlKey: true }),
  );
  assert.equal(canvasShown.activePanel, "canvas");
  assert.equal(canvasShown.lastHandledShortcutId, "show_canvas_panel");
  assert.equal(preventDefaultCount, 1);
  assert.equal(observed.length, 1);

  const streamShown = await host.handleKeyEvent(
    key({ key: "2", ctrlKey: true }),
  );
  assert.equal(streamShown.activePanel, "stream");
  assert.equal(streamShown.lastHandledShortcutId, "show_stream_panel");
  assert.equal(preventDefaultCount, 2);
  assert.equal(observed.length, 2);

  const beforeIgnoredRepeatCount = observed.length;
  const beforeIgnoredRepeatSnapshot = host.getSnapshot();
  const ignoredRepeat = await host.handleKeyEvent(
    key({ key: "1", ctrlKey: true, repeat: true }),
  );
  assert.strictEqual(ignoredRepeat, beforeIgnoredRepeatSnapshot);
  assert.equal(observed.length, beforeIgnoredRepeatCount);
  assert.equal(preventDefaultCount, 2);

  const beforeEditableCount = observed.length;
  const beforeEditableSnapshot = host.getSnapshot();
  const ignoredEditable = await host.handleKeyEvent(
    key({
      key: "1",
      ctrlKey: true,
      target: { tagName: "input", type: "text" },
    }),
  );
  assert.strictEqual(ignoredEditable, beforeEditableSnapshot);
  assert.equal(observed.length, beforeEditableCount);
  assert.equal(preventDefaultCount, 2);

  const lifecycleShown = await host.handleKeyEvent(
    key({ key: "1", ctrlKey: true }),
  );
  assert.equal(lifecycleShown.activePanel, "lifecycle");
  assert.equal(lifecycleShown.lastHandledShortcutId, "show_lifecycle_panel");
  assert.equal(preventDefaultCount, 3);
  assert.equal(observed.length, 3);

  const lifecycleOpened = await host.dispatch({
    type: "open_lifecycle_panel_session",
    options: { timelineFilter: "startup" },
  });
  assert.equal(lifecycleOpened.lifecyclePanel.active, true);
  assert.equal(lifecycleOpened.lifecyclePanel.disposed, false);
  assert.equal(
    lifecycleOpened.lifecyclePanel.activeSession?.interaction.view
      .timelineFilter,
    "startup",
  );
  assert.equal(
    lifecycleOpened.enabledShortcutIds.includes(
      "focus_lifecycle_primary_command",
    ),
    true,
  );
  assert.equal(observed.length, 4);

  const primaryFocused = await host.handleKeyEvent(
    key({ key: "Home", altKey: true }),
  );
  assert.equal(
    lifecyclePanelController.activeSession()?.snapshot().interaction
      .focusedCommandId,
    "start_runtime",
  );
  assert.equal(
    primaryFocused.lastHandledShortcutId,
    "focus_lifecycle_primary_command",
  );

  const started = await host.handleKeyEvent(key({ key: "Enter" }));
  assert.equal(
    lifecyclePanelController.activeSession()?.snapshot().interaction.view.panel
      .started,
    true,
  );
  assert.equal(
    started.lastHandledShortcutId,
    "activate_lifecycle_focused_command",
  );

  const streamOpened = await host.dispatch({
    type: "open_runtime_stream_session",
    options: {
      channel: { kind: "run", runId: "run_workbench_host" },
      clientFactory: streamClientFactory.factory,
      eventTypes: ["model.text_delta"],
    },
  });
  assert.equal(streamOpened.activePanel, "stream");
  assert.deepEqual(streamOpened.runtimeStream, {
    active: true,
    activeChannel: { kind: "run", runId: "run_workbench_host" },
    disposed: false,
  });
  assert.equal(
    streamOpened.enabledShortcutIds.includes("dispose_runtime_stream_session"),
    true,
  );

  const activeStreamSession = runtimeStreamController.activeSession();
  assert.ok(activeStreamSession !== null);
  await activeStreamSession.start();
  const streamClient = streamClientFactory.clients[0];
  assert.ok(streamClient !== undefined);
  streamClient.emit(
    createRuntimeStreamViewModelEvent({
      event_id: "evt_workbench_host_stream",
      seq: 1,
      type: "model.text_delta",
      category: "model",
      display_level: "default",
      severity: "info",
      title: "Workbench host stream",
      content: "host stream content",
      expandable: false,
      created_at: "2026-06-21T00:00:00.011Z",
    }),
  );
  assert.equal(
    runtimeStreamController.activeSession()?.snapshot().store.totalEvents,
    1,
  );

  const streamDisposed = await host.handleKeyEvent(
    key({ key: "Escape", shiftKey: true }),
  );
  assert.deepEqual(streamDisposed.runtimeStream, {
    active: false,
    activeChannel: null,
    disposed: false,
  });
  assert.equal(runtimeStreamController.activeSession(), null);
  assert.equal(
    streamDisposed.lastHandledShortcutId,
    "dispose_runtime_stream_session",
  );

  const beforeDefaultPreventedCount = observed.length;
  const beforeDefaultPreventedSnapshot = host.getSnapshot();
  const ignoredDefaultPrevented = await host.handleKeyEvent(
    key({ key: "1", ctrlKey: true, defaultPrevented: true }),
  );
  assert.strictEqual(ignoredDefaultPrevented, beforeDefaultPreventedSnapshot);
  assert.equal(observed.length, beforeDefaultPreventedCount);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(host.listenerCount(), 0);
  assert.equal(lifecyclePanelController.listenerCount(), 0);
  assert.equal(runtimeStreamController.listenerCount(), 0);
  assert.equal(host.dispose(), true);
  assert.equal(host.dispose(), false);
  assert.equal(host.isDisposed(), true);
  assert.equal(lifecyclePanelController.isDisposed(), true);
  assert.equal(runtimeStreamController.isDisposed(), true);
  assert.equal(host.subscribe(() => undefined)(), false);
  await assert.rejects(
    async () => host.dispatch({ type: "show_lifecycle_panel" }),
    /Runtime workbench host session is disposed/u,
  );
});

test("renderer runtime workbench host session isolates listeners and active dispose", async () => {
  const errors: unknown[] = [];
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: {
          connectionInfo: async () => ({
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_workbench_host_isolation",
          }),
        },
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly panel: string;
    readonly lastHandledShortcutId: string | null;
    readonly disposed: boolean;
  }> = [];

  const unsubscribeThrowing = host.subscribe(() => {
    const mutableShortcutIds = host.getSnapshot()
      .enabledShortcutIds as RuntimeWorkbenchShortcutId[];
    mutableShortcutIds.push("show_stream_panel");
  });
  const unsubscribeObserved = host.subscribe(() => {
    const snapshot = host.getSnapshot();
    observed.push({
      panel: snapshot.activePanel,
      lastHandledShortcutId: snapshot.lastHandledShortcutId,
      disposed: snapshot.disposed,
    });
  });

  await host.handleKeyEvent({
    key: "2",
    ctrlKey: true,
  });
  assert.equal(errors.length, 1);
  assert.equal(observed.at(-1)?.panel, "stream");
  assert.equal(observed.at(-1)?.lastHandledShortcutId, "show_stream_panel");
  assert.equal(lifecyclePanelController.listenerCount(), 1);
  assert.equal(runtimeStreamController.listenerCount(), 1);

  const stableSnapshot = host.getSnapshot();
  await assert.rejects(
    async () =>
      host.handleKeyEvent({
        key: "",
      } as unknown as RuntimeWorkbenchShortcutKeyEvent),
    /Invalid runtime workbench shortcut key event/u,
  );
  assert.strictEqual(host.getSnapshot(), stableSnapshot);

  assert.equal(host.dispose(), true);
  assert.equal(errors.length, 2);
  assert.equal(observed.at(-1)?.disposed, true);
  assert.equal(host.dispose(), false);
  assert.equal(host.isDisposed(), true);
  assert.equal(lifecyclePanelController.isDisposed(), true);
  assert.equal(runtimeStreamController.isDisposed(), true);
  assert.equal(lifecyclePanelController.listenerCount(), 0);
  assert.equal(runtimeStreamController.listenerCount(), 0);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(host.subscribe(() => undefined)(), false);
  assert.equal(host.resolveKeyEvent({ key: "1", ctrlKey: true }), null);
  await assert.rejects(
    async () => host.handleKeyEvent({ key: "1", ctrlKey: true }),
    /Runtime workbench host session is disposed/u,
  );
});

test("renderer runtime workbench shell presenter projects host snapshots", () => {
  const lifecycleTimelineItem: RuntimeLifecyclePanelTimelineItem =
    Object.freeze({
      id: "lifecycle_evt_shell",
      source: "startup",
      sourceLabel: "Startup",
      kind: "starting_sidecar",
      phase: "starting",
      tone: "info",
      statusLabel: "Starting",
      title: "Lifecycle active event",
      summary: "Lifecycle panel event is projected into the shell snapshot.",
      badges: Object.freeze(["startup", "retryable"] as const),
    });
  const activeLifecyclePanelInteraction: RuntimeLifecyclePanelInteractionSnapshot =
    Object.freeze({
      view: Object.freeze({
        panel: Object.freeze({
          readiness: "busy",
          tone: "info",
          statusLabel: "Starting",
          title: "Lifecycle active",
          summary: "Runtime lifecycle is starting.",
          runtimeReady: false,
          busy: true,
          terminal: false,
          lifecycleComplete: false,
          userActionRequired: false,
          retryable: true,
          startupTotal: 1,
          shutdownTotal: 0,
          started: true,
          disposed: false,
          ariaLive: "polite",
          primaryCommand: Object.freeze({
            id: "refresh_status",
            role: "primary",
            label: "Refresh",
            title: "Refresh runtime status.",
            enabled: true,
            busy: false,
            tone: "accent",
          }),
          secondaryCommands: Object.freeze([
            Object.freeze({
              id: "stop_runtime",
              role: "secondary",
              label: "Stop",
              title: "Stop runtime.",
              enabled: true,
              busy: false,
              tone: "danger",
            }),
          ]),
          timelineItems: Object.freeze([lifecycleTimelineItem]),
          emptyState: null,
        }),
        disposed: false,
        timelineFilter: "all",
        timelineFilterOptions: Object.freeze([
          Object.freeze({
            id: "all",
            label: "All",
            count: 1,
            active: true,
          }),
        ]),
        visibleTimelineItems: Object.freeze([lifecycleTimelineItem]),
        selectedTimelineItemId: lifecycleTimelineItem.id,
        selectedTimelineItem: lifecycleTimelineItem,
        totalTimelineItems: 1,
        visibleTimelineItemCount: 1,
        hiddenTimelineItemCount: 0,
      }),
      disposed: false,
      focusTarget: "timeline_item",
      focusedCommandId: null,
      focusedTimelineItemId: lifecycleTimelineItem.id,
      availableCommandIds: Object.freeze([
        "refresh_status",
        "stop_runtime",
      ] as const),
      enabledCommandIds: Object.freeze([
        "refresh_status",
        "stop_runtime",
      ] as const),
      canActivateFocusedCommand: false,
      canSelectFocusedTimelineItem: true,
    });
  const availableCommandIds: RuntimeWorkbenchInteractionCommandId[] = [
    "show_canvas_panel",
    "show_lifecycle_panel",
    "show_stream_panel",
    "open_lifecycle_panel_session",
    "dispose_lifecycle_panel_session",
    "open_runtime_stream_session",
    "dispose_runtime_stream_session",
    "dispatch_lifecycle_panel",
    "dispatch_runtime_stream",
  ];
  const availableShortcutIds: RuntimeWorkbenchShortcutId[] = [
    "show_canvas_panel",
    "show_lifecycle_panel",
    "show_stream_panel",
    "dispose_runtime_stream_session",
  ];
  const snapshot = buildRuntimeWorkbenchShellSnapshot({
    activePanel: "stream",
    lifecyclePanel: {
      active: true,
      disposed: false,
      activeSession: null,
    },
    runtimeStream: {
      active: true,
      activeChannel: { kind: "run", runId: "run_shell" },
      disposed: false,
    },
    runtimeStreamPanel: {
      status: "running",
      totalEvents: 2,
      bufferedEventCount: 2,
      matchingEventCount: 1,
      visibleEventCount: 1,
      hiddenEventCount: 1,
      foldedChildCount: 0,
      read: {
        lastSeenTotalEvents: 1,
        unreadCount: 1,
      },
      search: {
        query: "shell",
        matchCount: 1,
        activeMatchIndex: 0,
        activeEventId: "evt_shell",
      },
      summaryItems: [],
      timelineItems: [
        {
          id: "evt_shell",
          seq: 3,
          parentEventId: null,
          type: "model.text_delta",
          category: "model",
          displayLevel: "default",
          severity: "info",
          title: "Shell stream event",
          summary: "Projected without raw data",
          content: "stream content",
          expandable: false,
          expanded: false,
          childCount: 0,
          children: [],
          createdAt: "2026-06-22T02:00:00.000Z",
        },
      ],
      selectedEvent: {
        id: "evt_shell",
        seq: 3,
        parentEventId: null,
        type: "model.text_delta",
        category: "model",
        displayLevel: "default",
        severity: "info",
        title: "Shell stream event",
        summary: "Projected without raw data",
        content: "stream content",
        expandable: false,
        expanded: false,
        childCount: 0,
        children: [],
        createdAt: "2026-06-22T02:00:00.000Z",
      },
      fullReload: null,
    },
    availableCommandIds,
    enabledCommandIds: [
      "show_canvas_panel",
      "show_lifecycle_panel",
      "open_lifecycle_panel_session",
      "open_runtime_stream_session",
      "dispose_runtime_stream_session",
      "dispatch_lifecycle_panel",
      "dispatch_runtime_stream",
    ],
    availableShortcutIds,
    enabledShortcutIds: [
      "show_canvas_panel",
      "show_lifecycle_panel",
      "dispose_runtime_stream_session",
    ],
    lastHandledShortcutId: "show_stream_panel",
    disposed: false,
  });
  const actionById = (
    id: RuntimeWorkbenchShellAction["id"],
  ): RuntimeWorkbenchShellAction => {
    const action = snapshot.actions.find((candidate) => candidate.id === id);
    assert.ok(action !== undefined);
    return action;
  };
  const shortcutById = (
    id: RuntimeWorkbenchShortcutId,
  ): RuntimeWorkbenchShellShortcutHint => {
    const shortcut = snapshot.shortcutHints.find(
      (candidate) => candidate.id === id,
    );
    assert.ok(shortcut !== undefined);
    return shortcut;
  };

  assert.equal(snapshot.activePanel, "stream");
  assert.equal(snapshot.activePanelLabel, "Stream");
  assert.equal(snapshot.lifecyclePanelStatus, "active");
  assert.equal(snapshot.runtimeStreamStatus, "active");
  assert.equal(snapshot.runtimeStreamChannelLabel, "Run run_shell");
  assert.equal(snapshot.runtimeStreamPanel?.totalEvents, 2);
  assert.equal(snapshot.runtimeStreamPanel?.read.unreadCount, 1);
  assert.equal(snapshot.runtimeStreamPanel?.search.query, "shell");
  assert.equal(
    snapshot.runtimeStreamPanel?.timelineItems[0]?.title,
    "Shell stream event",
  );
  assert.equal(snapshot.runtimeStreamPanel?.selectedEvent?.id, "evt_shell");
  assert.equal(
    Object.hasOwn(snapshot.runtimeStreamPanel ?? {}, "store"),
    false,
  );
  assert.equal(
    Object.hasOwn(snapshot.runtimeStreamPanel ?? {}, "interaction"),
    false,
  );
  assert.equal(
    Object.hasOwn(
      snapshot.runtimeStreamPanel?.timelineItems[0] ?? {},
      "payload",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      snapshot.runtimeStreamPanel?.timelineItems[0] ?? {},
      "rawData",
    ),
    false,
  );
  assert.equal(snapshot.lastHandledShortcutLabel, "Show stream");
  assert.equal(Object.hasOwn(snapshot, "host"), false);
  assert.equal(Object.hasOwn(snapshot, "workbench"), false);
  assert.equal(Object.hasOwn(snapshot, "interaction"), false);
  assert.equal(Object.hasOwn(snapshot, "shortcuts"), false);
  assert.equal(Object.hasOwn(snapshot, "delegatedCommandIds"), false);
  assert.deepEqual(
    snapshot.chrome.dockItems.map((item) => ({
      id: item.id,
      active: item.active,
      enabled: item.enabled,
      status: item.status,
      targetPanel: item.targetPanel,
    })),
    [
      {
        id: "workflow_canvas",
        active: false,
        enabled: true,
        status: "active",
        targetPanel: "canvas",
      },
      {
        id: "lifecycle_panel",
        active: false,
        enabled: true,
        status: "active",
        targetPanel: "lifecycle",
      },
      {
        id: "runtime_stream",
        active: true,
        enabled: true,
        status: "active",
        targetPanel: "stream",
      },
      {
        id: "task_drawer",
        active: false,
        enabled: false,
        status: "active",
        targetPanel: null,
      },
    ],
  );
  assert.equal(snapshot.chrome.fileTree.title, "File Tree");
  assert.equal(snapshot.chrome.fileTree.summary, "Stream focus anchors");
  assert.deepEqual(
    snapshot.chrome.fileTree.nodes.map((node) => [
      node.id,
      node.pathLabel,
      node.statusLabel,
      node.depth,
      node.active,
      node.tone,
    ]),
    [
      ["workspace_root", "workspace root", "Open", 0, false, "success"],
      [
        "workflow_graph",
        "specs/schemas/workflow_graph.md",
        "Spec",
        1,
        false,
        "neutral",
      ],
      ["runtime_stream", "Run run_shell", "Active", 1, true, "success"],
      ["reviews", "docs/reviews", "M1.5", 1, false, "accent"],
      ["accepted_specs", "specs", "Read-only", 1, false, "neutral"],
    ],
  );
  assert.equal(snapshot.chrome.versionSnapshots.title, "Version Snapshots");
  assert.equal(
    snapshot.chrome.versionSnapshots.summary,
    "Stream scaffold history",
  );
  assert.deepEqual(
    snapshot.chrome.versionSnapshots.items.map((item) => [
      item.id,
      item.value,
      item.statusLabel,
      item.active,
      item.tone,
    ]),
    [
      ["draft", "v0", "Read-only", false, "neutral"],
      ["validation", "1 visible", "Active", false, "success"],
      ["runtime", "Run run_shell", "Active", true, "success"],
      ["git_snapshot", "Not created", "Future", false, "neutral"],
    ],
  );
  assert.equal(snapshot.chrome.workflowCanvas.title, "Workflow Canvas");
  assert.equal(snapshot.chrome.workflowCanvas.summary, "Stream graph scaffold");
  assert.equal(snapshot.chrome.workflowCanvas.statusLabel, "Read-only");
  assert.deepEqual(
    snapshot.chrome.workflowCanvas.nodes.map((node) => [
      node.nodeId,
      node.type,
      node.title,
      node.statusLabel,
      node.position,
      node.active,
      node.tone,
    ]),
    [
      ["start", "start", "Start", "manual", { x: 16, y: 44 }, false, "success"],
      [
        "context_task",
        "execution_task",
        "Collect context",
        "execution_task",
        { x: 32, y: 28 },
        true,
        "accent",
      ],
      [
        "review_task",
        "evaluation_task",
        "Review result",
        "evaluation_task",
        { x: 56, y: 44 },
        false,
        "warning",
      ],
      [
        "repair_task",
        "repair_task",
        "Repair loop",
        "repair_task",
        { x: 56, y: 78 },
        false,
        "warning",
      ],
      ["end", "end", "End", "archive", { x: 84, y: 44 }, false, "success"],
    ],
  );
  assert.deepEqual(
    snapshot.chrome.workflowCanvas.edges.map((edge) => [
      edge.edgeId,
      edge.sourceNodeId,
      edge.targetNodeId,
      edge.type,
      edge.label,
      edge.tone,
    ]),
    [
      [
        "start_to_context",
        "start",
        "context_task",
        "normal",
        "start",
        "neutral",
      ],
      [
        "context_to_review",
        "context_task",
        "review_task",
        "normal",
        "output",
        "accent",
      ],
      ["review_to_end", "review_task", "end", "pass", "pass", "success"],
      [
        "review_to_repair",
        "review_task",
        "repair_task",
        "fail",
        "fail",
        "warning",
      ],
      [
        "repair_to_context",
        "repair_task",
        "context_task",
        "repair",
        "repair",
        "warning",
      ],
    ],
  );
  assert.equal(snapshot.chrome.taskDrawer.title, "Task Drawer");
  assert.equal(snapshot.chrome.taskDrawer.summary, "Stream focus");
  assert.equal(
    snapshot.chrome.taskDrawer.collapsedSummary,
    "Stream focus, 1 visible, 1 unread",
  );
  assert.equal(snapshot.chrome.taskDrawer.collapsible, true);
  assert.equal(snapshot.chrome.taskDrawer.defaultCollapsed, false);
  assert.equal(snapshot.chrome.taskDrawer.expandLabel, "Expand drawer");
  assert.equal(snapshot.chrome.taskDrawer.collapseLabel, "Collapse drawer");
  assert.deepEqual(
    snapshot.chrome.taskDrawer.items.map((item) => [
      item.id,
      item.value,
      item.tone,
    ]),
    [
      ["active_panel", "Stream", "neutral"],
      ["lifecycle_panel", "Active", "success"],
      ["runtime_stream", "Run run_shell", "success"],
      ["visible_items", "1", "neutral"],
      ["unread_events", "1", "accent"],
    ],
  );
  assert.equal(snapshot.chrome.chatBox.title, "Chat Box");
  assert.equal(snapshot.chrome.chatBox.enabled, false);
  assert.equal(
    snapshot.chrome.chatBox.collapsedSummary,
    "Stream focus, chat idle",
  );
  assert.equal(snapshot.chrome.chatBox.collapsible, true);
  assert.equal(snapshot.chrome.chatBox.defaultCollapsed, false);
  assert.equal(snapshot.chrome.chatBox.expandLabel, "Expand chat");
  assert.equal(snapshot.chrome.chatBox.collapseLabel, "Collapse chat");
  assert.equal(Object.hasOwn(snapshot.chrome, "host"), false);
  assert.equal(Object.hasOwn(snapshot.chrome, "workbench"), false);
  assert.equal(Object.hasOwn(snapshot.chrome, "interaction"), false);
  assert.equal(Object.hasOwn(snapshot, "lifecyclePanel"), true);
  assert.equal(snapshot.lifecyclePanel, null);
  assert.equal(
    Object.hasOwn(snapshot.lifecyclePanel ?? {}, "controller"),
    false,
  );
  assert.equal(Object.hasOwn(snapshot, "runtimeStream"), false);
  assert.deepEqual(
    snapshot.panels.map((panel) => ({
      id: panel.id,
      active: panel.active,
      status: panel.status,
      badgeLabel: panel.badgeLabel,
    })),
    [
      {
        id: "canvas",
        active: false,
        status: "active",
        badgeLabel: "Active",
      },
      {
        id: "lifecycle",
        active: false,
        status: "active",
        badgeLabel: "Active",
      },
      {
        id: "stream",
        active: true,
        status: "active",
        badgeLabel: "Active",
      },
    ],
  );
  assert.deepEqual(snapshot.enabledActionIds, [
    "show_canvas_panel",
    "show_lifecycle_panel",
    "open_lifecycle_panel_session",
    "open_runtime_stream_session",
    "dispose_runtime_stream_session",
  ]);
  assert.deepEqual(actionById("open_runtime_stream_session"), {
    id: "open_runtime_stream_session",
    label: "Open stream",
    title: "Open a runtime stream session.",
    slot: "primary",
    tone: "accent",
    targetPanel: "stream",
    enabled: true,
    requiresOptions: true,
    shortcutIds: [],
  });
  assert.deepEqual(actionById("dispose_runtime_stream_session").shortcutIds, [
    "dispose_runtime_stream_session",
  ]);
  assert.deepEqual(shortcutById("show_lifecycle_panel").keys, ["Ctrl", "1"]);
  assert.deepEqual(shortcutById("show_canvas_panel").keys, ["Ctrl", "0"]);
  assert.equal(shortcutById("show_stream_panel").enabled, false);
  assert.deepEqual(
    snapshot.statusItems.map((item) => [item.id, item.value, item.tone]),
    [
      ["active_panel", "Stream", "neutral"],
      ["lifecycle_panel", "Active", "success"],
      ["runtime_stream", "Run run_shell", "success"],
      ["last_shortcut", "Show stream", "accent"],
    ],
  );
  assert.equal(snapshot.ariaLive, "polite");
  assert.equal(snapshot.emptyState, null);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.panels), true);
  assert.equal(Object.isFrozen(snapshot.panels[0]), true);
  assert.equal(Object.isFrozen(snapshot.actions), true);
  assert.equal(Object.isFrozen(snapshot.actions[0]), true);
  assert.equal(Object.isFrozen(snapshot.actions[0]?.shortcutIds), true);
  assert.equal(Object.isFrozen(snapshot.shortcutHints), true);
  assert.equal(Object.isFrozen(snapshot.shortcutHints[0]), true);
  assert.equal(Object.isFrozen(snapshot.shortcutHints[0]?.keys), true);
  assert.equal(Object.isFrozen(snapshot.statusItems), true);
  assert.equal(Object.isFrozen(snapshot.chrome), true);
  assert.equal(Object.isFrozen(snapshot.chrome.dockItems), true);
  assert.equal(Object.isFrozen(snapshot.chrome.dockItems[0]), true);
  assert.equal(Object.isFrozen(snapshot.chrome.fileTree), true);
  assert.equal(Object.isFrozen(snapshot.chrome.fileTree.nodes), true);
  assert.equal(Object.isFrozen(snapshot.chrome.fileTree.nodes[0]), true);
  assert.equal(Object.isFrozen(snapshot.chrome.versionSnapshots), true);
  assert.equal(Object.isFrozen(snapshot.chrome.versionSnapshots.items), true);
  assert.equal(
    Object.isFrozen(snapshot.chrome.versionSnapshots.items[0]),
    true,
  );
  assert.equal(Object.isFrozen(snapshot.chrome.workflowCanvas), true);
  assert.equal(Object.isFrozen(snapshot.chrome.workflowCanvas.nodes), true);
  assert.equal(Object.isFrozen(snapshot.chrome.workflowCanvas.nodes[0]), true);
  assert.equal(
    Object.isFrozen(snapshot.chrome.workflowCanvas.nodes[0]?.position),
    true,
  );
  assert.equal(Object.isFrozen(snapshot.chrome.workflowCanvas.edges), true);
  assert.equal(Object.isFrozen(snapshot.chrome.workflowCanvas.edges[0]), true);
  assert.equal(Object.isFrozen(snapshot.chrome.taskDrawer), true);
  assert.equal(Object.isFrozen(snapshot.chrome.taskDrawer.items), true);
  assert.equal(Object.isFrozen(snapshot.chrome.taskDrawer.items[0]), true);
  assert.equal(Object.isFrozen(snapshot.chrome.chatBox), true);
  assert.equal(Object.isFrozen(snapshot.runtimeStreamPanel), true);
  assert.equal(Object.isFrozen(snapshot.runtimeStreamPanel?.read), true);
  assert.equal(Object.isFrozen(snapshot.runtimeStreamPanel?.search), true);
  assert.equal(
    Object.isFrozen(snapshot.runtimeStreamPanel?.timelineItems),
    true,
  );
  assert.equal(
    Object.isFrozen(snapshot.runtimeStreamPanel?.timelineItems[0]),
    true,
  );
  assert.equal(Object.isFrozen(snapshot.availableActionIds), true);
  assert.equal(Object.isFrozen(snapshot.enabledActionIds), true);

  const emptySnapshot = buildRuntimeWorkbenchShellSnapshot({
    activePanel: "lifecycle",
    lifecyclePanel: { active: false, disposed: false, activeSession: null },
    runtimeStream: { active: false, activeChannel: null, disposed: false },
    runtimeStreamPanel: null,
    availableCommandIds: ["show_canvas_panel", "show_stream_panel"],
    enabledCommandIds: ["show_canvas_panel", "show_stream_panel"],
    availableShortcutIds: ["show_canvas_panel", "show_stream_panel"],
    enabledShortcutIds: ["show_canvas_panel", "show_stream_panel"],
    lastHandledShortcutId: null,
    disposed: false,
  });
  assert.equal(emptySnapshot.emptyState?.title, "No active session");
  assert.equal(emptySnapshot.ariaLive, "off");

  const activeLifecycleSnapshot = buildRuntimeWorkbenchShellSnapshot({
    activePanel: "lifecycle",
    lifecyclePanel: {
      active: true,
      disposed: false,
      activeSession: Object.freeze({
        interaction: activeLifecyclePanelInteraction,
        disposed: false,
      }),
    },
    runtimeStream: { active: false, activeChannel: null, disposed: false },
    runtimeStreamPanel: null,
    availableCommandIds: [
      "show_canvas_panel",
      "show_lifecycle_panel",
      "dispatch_lifecycle_panel",
    ],
    enabledCommandIds: [
      "show_canvas_panel",
      "show_lifecycle_panel",
      "dispatch_lifecycle_panel",
    ],
    availableShortcutIds: ["show_canvas_panel", "show_lifecycle_panel"],
    enabledShortcutIds: ["show_canvas_panel", "show_lifecycle_panel"],
    lastHandledShortcutId: null,
    disposed: false,
  });
  assert.ok(activeLifecycleSnapshot.lifecyclePanel !== null);
  const activeLifecyclePanel = activeLifecycleSnapshot.lifecyclePanel;
  assert.notEqual(activeLifecyclePanel, activeLifecyclePanelInteraction);
  assert.notEqual(
    activeLifecyclePanel.view,
    activeLifecyclePanelInteraction.view,
  );
  assert.notEqual(
    activeLifecyclePanel.view.panel,
    activeLifecyclePanelInteraction.view.panel,
  );
  assert.equal(activeLifecyclePanel.view.panel.title, "Lifecycle active");
  assert.equal(
    activeLifecyclePanel.view.visibleTimelineItems[0]?.id,
    lifecycleTimelineItem.id,
  );
  assert.notEqual(
    activeLifecyclePanel.view.visibleTimelineItems[0],
    lifecycleTimelineItem,
  );
  assert.notEqual(
    activeLifecyclePanel.view.selectedTimelineItem,
    lifecycleTimelineItem,
  );
  assert.equal(Object.hasOwn(activeLifecyclePanel, "controller"), false);
  assert.equal(Object.hasOwn(activeLifecyclePanel, "adapter"), false);
  assert.equal(Object.hasOwn(activeLifecyclePanel, "runtime"), false);
  assert.equal(Object.isFrozen(activeLifecyclePanel), true);
  assert.equal(Object.isFrozen(activeLifecyclePanel.view), true);
  assert.equal(Object.isFrozen(activeLifecyclePanel.view.panel), true);
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.panel.primaryCommand),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.panel.secondaryCommands),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.panel.secondaryCommands[0]),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.panel.timelineItems),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.panel.timelineItems[0]),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.panel.timelineItems[0]?.badges),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.timelineFilterOptions),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.timelineFilterOptions[0]),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.visibleTimelineItems),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.visibleTimelineItems[0]),
    true,
  );
  assert.equal(
    Object.isFrozen(activeLifecyclePanel.view.selectedTimelineItem),
    true,
  );
  assert.equal(Object.isFrozen(activeLifecyclePanel.availableCommandIds), true);
  assert.equal(Object.isFrozen(activeLifecyclePanel.enabledCommandIds), true);

  const disposedSnapshot = buildRuntimeWorkbenchShellSnapshot(
    {
      activePanel: "lifecycle",
      lifecyclePanel: { active: false, disposed: true, activeSession: null },
      runtimeStream: { active: false, activeChannel: null, disposed: true },
      runtimeStreamPanel: null,
      availableCommandIds: ["show_canvas_panel", "show_stream_panel"],
      enabledCommandIds: ["show_canvas_panel", "show_stream_panel"],
      availableShortcutIds: ["show_canvas_panel", "show_stream_panel"],
      enabledShortcutIds: ["show_canvas_panel", "show_stream_panel"],
      lastHandledShortcutId: null,
      disposed: true,
    },
    true,
  );
  assert.deepEqual(disposedSnapshot.enabledActionIds, []);
  assert.deepEqual(
    disposedSnapshot.panels.map((panel) => ({
      id: panel.id,
      enabled: panel.enabled,
      status: panel.status,
    })),
    [
      { id: "canvas", enabled: false, status: "disposed" },
      { id: "lifecycle", enabled: false, status: "disposed" },
      { id: "stream", enabled: false, status: "disposed" },
    ],
  );
  assert.equal(disposedSnapshot.runtimeStreamChannelLabel, null);
  assert.equal(disposedSnapshot.lastHandledShortcutLabel, null);
  assert.deepEqual(
    disposedSnapshot.statusItems.map((item) => [
      item.id,
      item.value,
      item.tone,
    ]),
    [
      ["active_panel", "Lifecycle", "danger"],
      ["lifecycle_panel", "Disposed", "danger"],
      ["runtime_stream", "Disposed", "danger"],
      ["last_shortcut", "None", "neutral"],
    ],
  );
  assert.equal(disposedSnapshot.shortcutHints[0]?.enabled, false);
  assert.equal(disposedSnapshot.ariaLive, "assertive");
  assert.equal(
    disposedSnapshot.chrome.fileTree.nodes[0]?.statusLabel,
    "Disposed",
  );
  assert.deepEqual(
    disposedSnapshot.chrome.versionSnapshots.items.map((item) => [
      item.id,
      item.statusLabel,
      item.tone,
    ]),
    [
      ["draft", "Read-only", "neutral"],
      ["validation", "Disposed", "danger"],
      ["runtime", "Disposed", "danger"],
      ["git_snapshot", "Future", "danger"],
    ],
  );
  assert.equal(disposedSnapshot.chrome.workflowCanvas.statusLabel, "Disposed");
  assert.deepEqual(
    disposedSnapshot.chrome.workflowCanvas.nodes.map((node) => [
      node.nodeId,
      node.tone,
    ]),
    [
      ["start", "danger"],
      ["context_task", "danger"],
      ["review_task", "danger"],
      ["repair_task", "danger"],
      ["end", "danger"],
    ],
  );
  assert.equal(disposedSnapshot.chrome.chatBox.statusLabel, "Disposed");
  assert.equal(
    disposedSnapshot.chrome.chatBox.collapsedSummary,
    "Lifecycle focus, chat disposed",
  );
  assert.equal(disposedSnapshot.chrome.dockItems[1]?.enabled, false);
  assert.equal(disposedSnapshot.chrome.dockItems[1]?.status, "disposed");
});

test("renderer runtime workbench shell presenter composes host actions", async () => {
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: {
          connectionInfo: async () => ({
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_workbench_shell",
          }),
        },
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const presenter = createRuntimeWorkbenchShellPresenter({ host });
  const observed: Array<ReturnType<typeof presenter.snapshot>> = [];
  let preventDefaultCount = 0;
  const key = (
    event: Omit<RuntimeWorkbenchShortcutKeyEvent, "preventDefault">,
  ): RuntimeWorkbenchShortcutKeyEvent => ({
    ...event,
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });
  const actionById = (
    snapshot: ReturnType<typeof presenter.snapshot>,
    id: RuntimeWorkbenchShellAction["id"],
  ): RuntimeWorkbenchShellAction => {
    const action = snapshot.actions.find((candidate) => candidate.id === id);
    assert.ok(action !== undefined);
    return action;
  };

  assert.equal(Object.hasOwn(presenter, "host"), false);
  const initialSnapshot = presenter.getSnapshot();
  assert.equal(Object.hasOwn(initialSnapshot, "host"), false);
  assert.equal(Object.hasOwn(initialSnapshot, "workbench"), false);
  assert.equal(Object.hasOwn(initialSnapshot, "interaction"), false);
  assert.equal(Object.hasOwn(initialSnapshot, "shortcuts"), false);
  assert.equal(initialSnapshot.activePanel, "lifecycle");
  assert.equal(initialSnapshot.emptyState?.title, "No active session");
  assert.equal(actionById(initialSnapshot, "show_stream_panel").enabled, true);
  assert.equal(
    initialSnapshot.shortcutHints.find(
      (shortcut) => shortcut.id === "show_stream_panel",
    )?.enabled,
    true,
  );
  assert.strictEqual(presenter.getServerSnapshot(), initialSnapshot);
  assert.strictEqual(presenter.snapshot(), initialSnapshot);

  const unsubscribe = presenter.subscribe(() => {
    observed.push(presenter.getSnapshot());
  });
  assert.equal(presenter.listenerCount(), 1);
  assert.equal(host.listenerCount(), 1);
  assert.equal(lifecyclePanelController.listenerCount(), 1);
  assert.equal(runtimeStreamController.listenerCount(), 1);

  const streamShown = presenter.setActivePanel("stream");
  assert.equal(streamShown.activePanel, "stream");
  assert.equal(actionById(streamShown, "show_lifecycle_panel").enabled, true);
  assert.equal(observed.length, 1);
  const noOpStream = presenter.setActivePanel("stream");
  assert.strictEqual(noOpStream, streamShown);
  assert.equal(observed.length, 1);

  const lifecycleOpened = await presenter.dispatch({
    type: "open_lifecycle_panel_session",
  });
  assert.equal(lifecycleOpened.activePanel, "lifecycle");
  assert.equal(lifecycleOpened.lifecyclePanelStatus, "active");
  assert.equal(
    actionById(lifecycleOpened, "dispose_lifecycle_panel_session").enabled,
    true,
  );
  assert.equal(observed.length, 2);

  const streamByKey = await presenter.handleKeyEvent(
    key({ key: "2", ctrlKey: true }),
  );
  assert.equal(streamByKey.activePanel, "stream");
  assert.equal(streamByKey.lastHandledShortcutLabel, "Show stream");
  assert.equal(preventDefaultCount, 1);
  assert.equal(observed.length, 3);

  const streamOpened = await presenter.dispatch({
    type: "open_runtime_stream_session",
    options: {
      channel: { kind: "run", runId: "run_shell_presenter" },
      clientFactory: streamClientFactory.factory,
      eventTypes: ["model.text_delta"],
    },
  });
  assert.equal(streamOpened.runtimeStreamStatus, "active");
  assert.equal(
    streamOpened.runtimeStreamChannelLabel,
    "Run run_shell_presenter",
  );
  assert.equal(
    actionById(streamOpened, "dispose_runtime_stream_session").enabled,
    true,
  );
  assert.equal(
    presenter.resolveKeyEvent(key({ key: "Escape", shiftKey: true }))
      ?.shortcutId,
    "dispose_runtime_stream_session",
  );

  const streamDisposed = await presenter.handleKeyEvent(
    key({ key: "Escape", shiftKey: true }),
  );
  assert.equal(streamDisposed.runtimeStreamStatus, "empty");
  assert.equal(streamDisposed.runtimeStreamChannelLabel, null);
  assert.equal(runtimeStreamController.activeSession(), null);

  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(presenter.listenerCount(), 0);
  assert.equal(host.listenerCount(), 0);
  assert.equal(lifecyclePanelController.listenerCount(), 0);
  assert.equal(runtimeStreamController.listenerCount(), 0);
  assert.equal(presenter.dispose(), true);
  assert.equal(presenter.dispose(), false);
  assert.equal(presenter.isDisposed(), true);
  assert.equal(host.isDisposed(), false);
  const disposedSnapshot = presenter.getSnapshot();
  assert.deepEqual(
    disposedSnapshot.panels.map((panel) => ({
      id: panel.id,
      enabled: panel.enabled,
      status: panel.status,
    })),
    [
      { id: "canvas", enabled: false, status: "disposed" },
      { id: "lifecycle", enabled: false, status: "disposed" },
      { id: "stream", enabled: false, status: "disposed" },
    ],
  );
  assert.deepEqual(disposedSnapshot.enabledActionIds, []);
  assert.equal(
    disposedSnapshot.shortcutHints.every((shortcut) => !shortcut.enabled),
    true,
  );
  assert.equal(disposedSnapshot.runtimeStreamChannelLabel, null);
  assert.equal(disposedSnapshot.lastHandledShortcutLabel, null);
  assert.equal(disposedSnapshot.ariaLive, "assertive");
  assert.equal(presenter.subscribe(() => undefined)(), false);
  assert.equal(presenter.resolveKeyEvent({ key: "1", ctrlKey: true }), null);
  assert.throws(
    () => presenter.setActivePanel("lifecycle"),
    /Runtime workbench shell presenter is disposed/u,
  );
  assert.equal(host.dispose(), true);
  assert.equal(lifecyclePanelController.isDisposed(), true);
  assert.equal(runtimeStreamController.isDisposed(), true);
});

test("renderer runtime workbench shell presenter isolates listeners and active dispose", async () => {
  const errors: unknown[] = [];
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: {
          connectionInfo: async () => ({
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_workbench_shell_isolation",
          }),
        },
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const presenter = createRuntimeWorkbenchShellPresenter({
    host,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly activePanel: RuntimeWorkbenchPanelId;
    readonly disposed: boolean;
  }> = [];

  const unsubscribeThrowing = presenter.subscribe(() => {
    const mutableActions = presenter.getSnapshot()
      .actions as RuntimeWorkbenchShellAction[];
    const firstAction = presenter.getSnapshot().actions[0];
    assert.ok(firstAction !== undefined);
    mutableActions.push(firstAction);
  });
  const unsubscribeObserved = presenter.subscribe(() => {
    const snapshot = presenter.getSnapshot();
    observed.push({
      activePanel: snapshot.activePanel,
      disposed: snapshot.disposed,
    });
  });

  presenter.setActivePanel("stream");
  assert.equal(errors.length, 1);
  assert.equal(observed.at(-1)?.activePanel, "stream");
  assert.equal(presenter.listenerCount(), 2);
  assert.equal(host.listenerCount(), 1);

  const stableSnapshot = presenter.getSnapshot();
  await assert.rejects(
    async () =>
      presenter.handleKeyEvent({
        key: "",
      } as unknown as RuntimeWorkbenchShortcutKeyEvent),
    /Invalid runtime workbench shortcut key event/u,
  );
  assert.strictEqual(presenter.getSnapshot(), stableSnapshot);

  assert.equal(presenter.dispose(), true);
  assert.equal(errors.length, 2);
  assert.equal(observed.at(-1)?.disposed, true);
  assert.equal(presenter.dispose(), false);
  assert.equal(presenter.isDisposed(), true);
  assert.equal(host.isDisposed(), false);
  assert.equal(host.listenerCount(), 0);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(presenter.subscribe(() => undefined)(), false);
  assert.equal(presenter.resolveKeyEvent({ key: "1", ctrlKey: true }), null);
  await assert.rejects(
    async () => presenter.dispatch({ type: "show_lifecycle_panel" }),
    /Runtime workbench shell presenter is disposed/u,
  );
  assert.equal(host.dispose(), true);
});

test("renderer runtime workbench shell adapter exposes external store contract", async () => {
  const errors: unknown[] = [];
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const streamClientFactory = createFakeRuntimeStreamEventStoreClientFactory();
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: {
          connectionInfo: async () => ({
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_workbench_shell_adapter",
          }),
        },
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const presenter = createRuntimeWorkbenchShellPresenter({
    host,
    onError: (error) => {
      errors.push(error);
    },
  });
  const adapter = createRuntimeWorkbenchShellAdapter({
    presenter,
    onError: (error) => {
      errors.push(error);
    },
  });
  const observed: Array<{
    readonly activePanel: RuntimeWorkbenchPanelId;
    readonly lifecyclePanelStatus: string;
    readonly runtimeStreamStatus: string;
    readonly disposed: boolean;
  }> = [];
  let preventDefaultCount = 0;
  const key = (
    event: Omit<RuntimeWorkbenchShortcutKeyEvent, "preventDefault">,
  ): RuntimeWorkbenchShortcutKeyEvent => ({
    ...event,
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });
  const forbiddenShellAdapterKeys = [
    "presenter",
    "host",
    "workbench",
    "interaction",
    "shortcuts",
    "controller",
    "session",
    "factory",
    "viewModel",
    "store",
    "stream",
  ] as const;

  for (const key of forbiddenShellAdapterKeys) {
    assert.equal(Object.hasOwn(adapter, key), false);
  }
  const initialSnapshot = adapter.getSnapshot();
  assert.strictEqual(adapter.getSnapshot(), initialSnapshot);
  assert.strictEqual(adapter.getServerSnapshot(), initialSnapshot);
  for (const key of forbiddenShellAdapterKeys) {
    assert.equal(Object.hasOwn(initialSnapshot, key), false);
  }
  assert.equal(initialSnapshot.activePanel, "lifecycle");
  assert.equal(initialSnapshot.emptyState?.title, "No active session");
  assert.equal(Object.isFrozen(initialSnapshot), true);
  assert.equal(Object.isFrozen(initialSnapshot.panels), true);
  assert.equal(Object.isFrozen(initialSnapshot.panels[0]), true);
  assert.equal(Object.isFrozen(initialSnapshot.actions), true);
  assert.equal(Object.isFrozen(initialSnapshot.actions[0]), true);
  assert.equal(Object.isFrozen(initialSnapshot.actions[0]?.shortcutIds), true);
  assert.equal(Object.isFrozen(initialSnapshot.shortcutHints), true);
  assert.equal(Object.isFrozen(initialSnapshot.shortcutHints[0]), true);
  assert.equal(Object.isFrozen(initialSnapshot.shortcutHints[0]?.keys), true);
  assert.equal(Object.isFrozen(initialSnapshot.statusItems), true);
  assert.equal(Object.isFrozen(initialSnapshot.availableActionIds), true);
  assert.equal(Object.isFrozen(initialSnapshot.enabledActionIds), true);
  assert.throws(() => {
    const mutableActions =
      initialSnapshot.actions as RuntimeWorkbenchShellAction[];
    const firstAction = initialSnapshot.actions[0];
    assert.ok(firstAction !== undefined);
    mutableActions.push(firstAction);
  }, /Cannot add property|object is not extensible|read only/u);

  const unsubscribe = adapter.subscribe(() => {
    const snapshot = adapter.getSnapshot();
    observed.push({
      activePanel: snapshot.activePanel,
      lifecyclePanelStatus: snapshot.lifecyclePanelStatus,
      runtimeStreamStatus: snapshot.runtimeStreamStatus,
      disposed: snapshot.disposed,
    });
  });
  assert.equal(adapter.listenerCount(), 1);
  assert.equal(presenter.listenerCount(), 1);
  assert.equal(host.listenerCount(), 1);
  assert.equal(lifecyclePanelController.listenerCount(), 1);
  assert.equal(runtimeStreamController.listenerCount(), 1);

  const streamShown = adapter.setActivePanel("stream");
  assert.equal(streamShown.activePanel, "stream");
  assert.strictEqual(adapter.getSnapshot(), streamShown);
  assert.deepEqual(observed.at(-1), {
    activePanel: "stream",
    lifecyclePanelStatus: "empty",
    runtimeStreamStatus: "empty",
    disposed: false,
  });
  const beforeNoOpCount = observed.length;
  const noOpStream = adapter.setActivePanel("stream");
  assert.strictEqual(noOpStream, streamShown);
  assert.equal(observed.length, beforeNoOpCount);

  const lifecycleOpened = await adapter.dispatch({
    type: "open_lifecycle_panel_session",
  });
  assert.equal(lifecycleOpened.activePanel, "lifecycle");
  assert.equal(lifecycleOpened.lifecyclePanelStatus, "active");
  assert.deepEqual(observed.at(-1), {
    activePanel: "lifecycle",
    lifecyclePanelStatus: "active",
    runtimeStreamStatus: "empty",
    disposed: false,
  });

  const streamByKey = await adapter.handleKeyEvent(
    key({ key: "2", ctrlKey: true }),
  );
  assert.equal(streamByKey.activePanel, "stream");
  assert.equal(streamByKey.lastHandledShortcutLabel, "Show stream");
  assert.equal(preventDefaultCount, 1);

  const streamOpened = await adapter.dispatch({
    type: "open_runtime_stream_session",
    options: {
      channel: { kind: "run", runId: "run_shell_adapter" },
      clientFactory: streamClientFactory.factory,
      eventTypes: ["model.text_delta"],
    },
  });
  assert.equal(streamOpened.runtimeStreamStatus, "active");
  assert.equal(streamOpened.runtimeStreamChannelLabel, "Run run_shell_adapter");
  assert.equal(
    adapter.resolveKeyEvent(key({ key: "Escape", shiftKey: true }))?.shortcutId,
    "dispose_runtime_stream_session",
  );

  assert.equal(errors.length, 0);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(adapter.listenerCount(), 0);
  assert.equal(presenter.listenerCount(), 0);
  assert.equal(host.listenerCount(), 0);
  assert.equal(lifecyclePanelController.listenerCount(), 0);
  assert.equal(runtimeStreamController.listenerCount(), 0);
  const beforeDispose = adapter.getSnapshot();
  assert.equal(adapter.dispose(), true);
  const disposedSnapshot = adapter.getSnapshot();
  assert.notStrictEqual(disposedSnapshot, beforeDispose);
  assert.strictEqual(adapter.getServerSnapshot(), disposedSnapshot);
  assert.equal(adapter.dispose(), false);
  assert.equal(adapter.isDisposed(), true);
  assert.equal(presenter.isDisposed(), true);
  assert.equal(host.isDisposed(), false);
  assert.deepEqual(disposedSnapshot.enabledActionIds, []);
  assert.equal(disposedSnapshot.runtimeStreamChannelLabel, null);
  assert.equal(disposedSnapshot.lastHandledShortcutLabel, null);
  assert.equal(disposedSnapshot.ariaLive, "assertive");
  assert.equal(adapter.subscribe(() => undefined)(), false);
  assert.equal(adapter.resolveKeyEvent({ key: "1", ctrlKey: true }), null);
  assert.throws(
    () => adapter.setActivePanel("lifecycle"),
    /Runtime workbench shell adapter is disposed/u,
  );
  await assert.rejects(
    async () => adapter.dispatch({ type: "show_lifecycle_panel" }),
    /Runtime workbench shell adapter is disposed/u,
  );
  await assert.rejects(
    async () => adapter.handleKeyEvent({ key: "1", ctrlKey: true }),
    /Runtime workbench shell adapter is disposed/u,
  );
  assert.equal(host.dispose(), true);
});

test("renderer runtime workbench shell adapter factory creates isolated adapters", () => {
  const factoryErrors: unknown[] = [];
  const overrideErrors: unknown[] = [];
  const hosts: ReturnType<typeof createRuntimeWorkbenchHostSession>[] = [];
  const factory = createRuntimeWorkbenchShellAdapterFactory({
    createPresenter: (options) => {
      const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
        [createStartupStatus("starting_sidecar")],
        [createShutdownStatus("registered")],
      );
      const lifecyclePanelController =
        createRuntimeLifecyclePanelSessionController({
          factory: createRuntimeLifecyclePanelSessionFactory({
            controllerFactory: createRuntimeLifecyclePanelControllerFactory({
              runtime: lifecycleRuntime.runtime,
            }),
          }),
        });
      const runtimeStreamController =
        createRuntimeStreamInteractionSessionController({
          factory: createRuntimeStreamInteractionSessionFactory({
            runtime: {
              connectionInfo: async () => ({
                base_url: "http://127.0.0.1:51234/cw/v1",
                token: `token_workbench_shell_factory_${hosts.length}`,
              }),
            },
            eventSourceFactory: () =>
              createFakeRuntimeStreamEventSource().source,
          }),
        });
      const host = createRuntimeWorkbenchHostSession({
        lifecyclePanelController,
        runtimeStreamController,
      });
      hosts.push(host);
      return createRuntimeWorkbenchShellPresenter({ host, ...options });
    },
    onError: (error) => {
      factoryErrors.push(error);
    },
  });
  const firstAdapter = factory.createAdapter();
  const secondAdapter = factory.createAdapter({
    onError: (error) => {
      overrideErrors.push(error);
    },
  });

  for (const key of [
    "presenter",
    "host",
    "workbench",
    "interaction",
    "shortcuts",
    "controller",
    "session",
    "factory",
    "viewModel",
    "store",
    "stream",
  ] as const) {
    assert.equal(Object.hasOwn(firstAdapter, key), false);
    assert.equal(Object.hasOwn(firstAdapter.getSnapshot(), key), false);
  }
  assert.equal(hosts.length, 2);
  assert.equal(firstAdapter.getSnapshot().activePanel, "lifecycle");
  assert.equal(secondAdapter.getSnapshot().activePanel, "lifecycle");

  firstAdapter.setActivePanel("stream");
  assert.equal(firstAdapter.getSnapshot().activePanel, "stream");
  assert.equal(secondAdapter.getSnapshot().activePanel, "lifecycle");

  const firstObserved: RuntimeWorkbenchPanelId[] = [];
  const secondObserved: RuntimeWorkbenchPanelId[] = [];
  const unsubscribeFirst = firstAdapter.subscribe(() => {
    firstObserved.push(firstAdapter.getSnapshot().activePanel);
  });
  const unsubscribeSecond = secondAdapter.subscribe(() => {
    secondObserved.push(secondAdapter.getSnapshot().activePanel);
  });

  firstAdapter.setActivePanel("lifecycle");
  secondAdapter.setActivePanel("stream");
  assert.deepEqual(firstObserved, ["lifecycle"]);
  assert.deepEqual(secondObserved, ["stream"]);
  assert.equal(factoryErrors.length, 0);
  assert.equal(overrideErrors.length, 0);

  assert.equal(firstAdapter.dispose(), true);
  assert.equal(firstAdapter.isDisposed(), true);
  assert.equal(hosts[0]?.isDisposed(), false);
  assert.equal(secondAdapter.isDisposed(), false);
  assert.equal(
    secondAdapter.setActivePanel("lifecycle").activePanel,
    "lifecycle",
  );
  assert.equal(unsubscribeFirst(), false);
  assert.equal(unsubscribeSecond(), true);
  assert.equal(secondAdapter.dispose(), true);
  assert.equal(hosts[1]?.isDisposed(), false);
  for (const host of hosts) {
    assert.equal(host.dispose(), true);
  }
});

test("renderer runtime workbench shell adapter isolates listeners and active dispose", async () => {
  const onErrorInputs: unknown[] = [];
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: {
          connectionInfo: async () => ({
            base_url: "http://127.0.0.1:51234/cw/v1",
            token: "token_workbench_shell_adapter_isolation",
          }),
        },
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const presenter = createRuntimeWorkbenchShellPresenter({ host });
  const adapter = createRuntimeWorkbenchShellAdapter({
    presenter,
    onError: (error) => {
      onErrorInputs.push(error);
      throw new Error("adapter onError failed");
    },
  });
  const observed: Array<{
    readonly activePanel: RuntimeWorkbenchPanelId;
    readonly disposed: boolean;
  }> = [];

  const unsubscribeThrowing = adapter.subscribe(() => {
    const mutableActions = adapter.getSnapshot()
      .actions as RuntimeWorkbenchShellAction[];
    const firstAction = adapter.getSnapshot().actions[0];
    assert.ok(firstAction !== undefined);
    mutableActions.push(firstAction);
  });
  const unsubscribeObserved = adapter.subscribe(() => {
    const snapshot = adapter.getSnapshot();
    observed.push({
      activePanel: snapshot.activePanel,
      disposed: snapshot.disposed,
    });
  });

  adapter.setActivePanel("stream");
  assert.equal(onErrorInputs.length, 1);
  assert.equal(observed.at(-1)?.activePanel, "stream");
  assert.equal(adapter.listenerCount(), 2);
  assert.equal(presenter.listenerCount(), 1);
  assert.equal(host.listenerCount(), 1);

  const stableSnapshot = adapter.getSnapshot();
  await assert.rejects(
    async () =>
      adapter.handleKeyEvent({
        key: "",
      } as unknown as RuntimeWorkbenchShortcutKeyEvent),
    /Invalid runtime workbench shortcut key event/u,
  );
  assert.strictEqual(adapter.getSnapshot(), stableSnapshot);

  assert.equal(adapter.dispose(), true);
  assert.equal(onErrorInputs.length, 2);
  assert.equal(observed.at(-1)?.disposed, true);
  assert.equal(adapter.listenerCount(), 0);
  assert.equal(presenter.isDisposed(), true);
  assert.equal(host.isDisposed(), false);
  assert.equal(host.listenerCount(), 0);
  assert.equal(unsubscribeObserved(), false);
  assert.equal(unsubscribeThrowing(), false);
  assert.equal(adapter.dispose(), false);
  assert.equal(adapter.subscribe(() => undefined)(), false);
  assert.equal(adapter.resolveKeyEvent({ key: "1", ctrlKey: true }), null);
  await assert.rejects(
    async () => adapter.dispatch({ type: "show_lifecycle_panel" }),
    /Runtime workbench shell adapter is disposed/u,
  );
  assert.equal(host.dispose(), true);
});

test("renderer runtime workbench shell keyboard binding routes target events", async () => {
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_keyboard_binding",
  );
  const target = createFakeRuntimeWorkbenchShellKeyboardTarget();
  const observed: RuntimeWorkbenchPanelId[] = [];
  let preventDefaultCount = 0;
  const unsubscribeAdapter = harness.adapter.subscribe(() => {
    observed.push(harness.adapter.getSnapshot().activePanel);
  });
  const unbind = bindRuntimeWorkbenchShellKeyboardTarget(
    harness.adapter,
    target,
  );

  assert.equal(target.listenerCount("keydown"), 1);
  await target.emit("keydown", {
    key: "0",
    ctrlKey: true,
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });
  assert.equal(harness.adapter.getSnapshot().activePanel, "canvas");
  assert.deepEqual(observed, ["canvas"]);
  assert.equal(preventDefaultCount, 1);

  await target.emit("keydown", {
    key: "2",
    ctrlKey: true,
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.deepEqual(observed, ["canvas", "stream"]);
  assert.equal(preventDefaultCount, 2);

  await target.emit("keydown", {
    key: "1",
    ctrlKey: true,
    target: { tagName: "input" },
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.deepEqual(observed, ["canvas", "stream"]);
  assert.equal(preventDefaultCount, 2);

  assert.equal(unbind(), true);
  assert.equal(target.listenerCount("keydown"), 0);
  await target.emit("keydown", { key: "1", ctrlKey: true });
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(unbind(), false);

  assert.equal(unsubscribeAdapter(), true);
  harness.dispose();
});

test("renderer runtime workbench shell keyboard binding sanitizes target snapshots", async () => {
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_keyboard_target_snapshot",
  );
  const target = createFakeRuntimeWorkbenchShellKeyboardTarget();
  const handledEvents: RuntimeWorkbenchShortcutKeyEvent[] = [];
  let preventDefaultCount = 0;
  const originalTarget: {
    tagName?: string | null;
    role?: string | null;
    type?: string | null;
    isContentEditable?: boolean | null;
  } = {
    tagName: "DIV",
    role: null,
    type: null,
    isContentEditable: null,
  };
  const adapter = {
    handleKeyEvent: async (event: RuntimeWorkbenchShortcutKeyEvent) => {
      handledEvents.push(event);
      return await harness.adapter.handleKeyEvent(event);
    },
    isDisposed: () => harness.adapter.isDisposed(),
  };
  const unbind = bindRuntimeWorkbenchShellKeyboardTarget(adapter, target);

  await target.emit("keydown", {
    key: "2",
    ctrlKey: true,
    target: originalTarget,
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(preventDefaultCount, 1);
  assert.equal(handledEvents.length, 1);
  assert.notStrictEqual(handledEvents[0]?.target, originalTarget);
  assert.deepEqual(handledEvents[0]?.target, { tagName: "DIV" });

  originalTarget.tagName = "INPUT";
  originalTarget.role = "textbox";
  originalTarget.type = "text";
  originalTarget.isContentEditable = true;
  assert.deepEqual(handledEvents[0]?.target, { tagName: "DIV" });

  await target.emit("keydown", {
    key: "1",
    ctrlKey: true,
    target: {
      tagName: "INPUT",
      role: null,
      type: "text",
      isContentEditable: null,
    },
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(preventDefaultCount, 1);
  assert.equal(handledEvents.length, 2);
  assert.deepEqual(handledEvents[1]?.target, {
    tagName: "INPUT",
    type: "text",
  });

  assert.equal(unbind(), true);
  harness.dispose();
});

test("renderer runtime workbench shell keyboard binding isolates handler errors", async () => {
  const handlerErrors: unknown[] = [];
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_keyboard_errors",
  );
  const target = createFakeRuntimeWorkbenchShellKeyboardTarget();
  const observed: RuntimeWorkbenchPanelId[] = [];
  harness.adapter.subscribe(() => {
    observed.push(harness.adapter.getSnapshot().activePanel);
  });
  const unbind = bindRuntimeWorkbenchShellKeyboardTarget(
    harness.adapter,
    target,
    {
      onError: (error) => {
        handlerErrors.push(error);
        throw new Error("keyboard binding onError failed");
      },
    },
  );

  const stableSnapshot = harness.adapter.getSnapshot();
  await target.emit("keydown", {
    key: "",
  } as unknown as RuntimeWorkbenchShellKeyboardEvent);
  assert.equal(handlerErrors.length, 1);
  assert.strictEqual(harness.adapter.getSnapshot(), stableSnapshot);

  await target.emit("keydown", {
    key: "2",
    ctrlKey: true,
  });
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.deepEqual(observed, ["stream"]);
  assert.equal(handlerErrors.length, 1);

  assert.equal(harness.adapter.dispose(), true);
  const afterDisposeObservedCount = observed.length;
  await target.emit("keydown", {
    key: "1",
    ctrlKey: true,
  });
  assert.deepEqual(observed, ["stream", "stream"]);
  assert.equal(observed.length, afterDisposeObservedCount);
  assert.equal(handlerErrors.length, 1);
  assert.equal(unbind(), true);
  harness.host.dispose();
});

test("renderer runtime workbench shell keyboard binding validates target lifecycle", () => {
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_keyboard_lifecycle",
  );
  const target = createFakeRuntimeWorkbenchShellKeyboardTarget();

  assert.throws(
    () =>
      bindRuntimeWorkbenchShellKeyboardTarget(harness.adapter, target, {
        eventType: "bad\nevent",
      }),
    /Invalid runtime workbench shell keyboard event type/u,
  );
  assert.equal(target.listenerCount("bad\nevent"), 0);

  assert.equal(harness.adapter.dispose(), true);
  const noOpUnbind = bindRuntimeWorkbenchShellKeyboardTarget(
    harness.adapter,
    target,
  );
  assert.equal(target.listenerCount("keydown"), 0);
  assert.equal(noOpUnbind(), false);
  harness.host.dispose();
});

test("renderer runtime workbench shell keyboard DOM adapter routes KeyboardEvent targets", async () => {
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_keyboard_dom",
  );
  const target = createFakeRuntimeWorkbenchShellDomEventTarget();
  const listenerOptions = { capture: true, passive: false };
  let preventDefaultCount = 0;
  const handledEvents: RuntimeWorkbenchShortcutKeyEvent[] = [];
  const adapter = {
    handleKeyEvent: async (event: RuntimeWorkbenchShortcutKeyEvent) => {
      handledEvents.push(event);
      return await harness.adapter.handleKeyEvent(event);
    },
    isDisposed: () => harness.adapter.isDisposed(),
  };
  const unbind = bindRuntimeWorkbenchShellKeyboardDomTarget(adapter, target, {
    listenerOptions,
  });

  assert.equal(target.listenerCount("keydown"), 1);
  assert.deepEqual(target.listenerOptions("keydown"), [listenerOptions]);

  target.emit(
    "keydown",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "2",
      code: "Digit2",
      altKey: true,
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
      repeat: true,
      defaultPrevented: true,
      target: {
        tagName: "DIV",
        role: null,
        type: null,
        isContentEditable: null,
      },
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(harness.adapter.getSnapshot().activePanel, "lifecycle");
  assert.equal(preventDefaultCount, 0);
  assert.deepEqual(handledEvents[0], {
    key: "2",
    code: "Digit2",
    altKey: true,
    ctrlKey: true,
    metaKey: true,
    shiftKey: true,
    repeat: true,
    defaultPrevented: true,
    target: { tagName: "DIV" },
    preventDefault: handledEvents[0]?.preventDefault,
  });
  assert.equal(typeof handledEvents[0]?.preventDefault, "function");

  target.emit(
    "keydown",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "2",
      code: "Digit2",
      ctrlKey: true,
      target: {
        tagName: "DIV",
        role: null,
        type: null,
        isContentEditable: null,
      },
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(preventDefaultCount, 1);
  assert.deepEqual(handledEvents[1]?.target, { tagName: "DIV" });

  target.emit(
    "keydown",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "1",
      ctrlKey: true,
      target: {
        tagName: "INPUT",
        role: null,
        type: "text",
        isContentEditable: null,
      },
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(preventDefaultCount, 1);
  assert.deepEqual(handledEvents[2]?.target, {
    tagName: "INPUT",
    type: "text",
  });

  target.emit("keydown", {
    preventDefault: () => {
      preventDefaultCount += 1;
    },
    target: { tagName: "DIV" },
  } as unknown as Event);
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(preventDefaultCount, 1);
  assert.equal(handledEvents.length, 3);

  assert.equal(unbind(), true);
  assert.equal(target.listenerCount("keydown"), 0);
  assert.deepEqual(target.removedListenerOptions("keydown"), [listenerOptions]);
  assert.strictEqual(
    target.removedListenerOptions("keydown")[0],
    listenerOptions,
  );
  target.emit(
    "keydown",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "1",
      ctrlKey: true,
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(unbind(), false);
  harness.dispose();
});

test("renderer runtime workbench shell keyboard DOM adapter validates lifecycle", async () => {
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_keyboard_dom_lifecycle",
  );
  const target = createFakeRuntimeWorkbenchShellDomEventTarget();

  assert.throws(
    () =>
      bindRuntimeWorkbenchShellKeyboardDomTarget(harness.adapter, target, {
        eventType: "bad\nevent",
      }),
    /Invalid runtime workbench shell keyboard event type/u,
  );
  assert.equal(target.listenerCount("bad\nevent"), 0);

  const unbindKeyup = bindRuntimeWorkbenchShellKeyboardDomTarget(
    harness.adapter,
    target,
    { eventType: "keyup" },
  );
  assert.equal(target.listenerCount("keydown"), 0);
  assert.equal(target.listenerCount("keyup"), 1);
  target.emit(
    "keydown",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "2",
      ctrlKey: true,
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(harness.adapter.getSnapshot().activePanel, "lifecycle");
  target.emit(
    "keyup",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "2",
      ctrlKey: true,
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(harness.adapter.getSnapshot().activePanel, "stream");
  assert.equal(unbindKeyup(), true);

  assert.equal(harness.adapter.dispose(), true);
  const noOpUnbind = bindRuntimeWorkbenchShellKeyboardDomTarget(
    harness.adapter,
    target,
  );
  assert.equal(target.listenerCount("keydown"), 0);
  assert.equal(noOpUnbind(), false);
  harness.host.dispose();
});

test("renderer runtime workbench shell DOM session manages keyboard target lifecycle", async () => {
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_dom_session",
  );
  const firstTarget = createFakeRuntimeWorkbenchShellDomEventTarget();
  const secondTarget = createFakeRuntimeWorkbenchShellDomEventTarget();
  const firstListenerOptions = { capture: true };
  const secondListenerOptions = { capture: false };
  let preventDefaultCount = 0;
  const session = createRuntimeWorkbenchShellDomSession({
    adapter: harness.adapter,
    keyboardTarget: firstTarget,
    keyboardOptions: { listenerOptions: firstListenerOptions },
  });

  assert.equal(session.getSnapshot(), harness.adapter.getSnapshot());
  assert.equal(session.isKeyboardTargetBound(), true);
  assert.equal(firstTarget.listenerCount("keydown"), 1);
  assert.deepEqual(firstTarget.listenerOptions("keydown"), [
    firstListenerOptions,
  ]);

  firstTarget.emit(
    "keydown",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "2",
      ctrlKey: true,
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(session.getSnapshot().activePanel, "stream");
  assert.equal(preventDefaultCount, 1);

  assert.equal(
    session.bindKeyboardTarget(secondTarget, {
      eventType: "keyup",
      listenerOptions: secondListenerOptions,
    }),
    true,
  );
  assert.equal(firstTarget.listenerCount("keydown"), 0);
  assert.strictEqual(
    firstTarget.removedListenerOptions("keydown")[0],
    firstListenerOptions,
  );
  assert.equal(secondTarget.listenerCount("keydown"), 0);
  assert.equal(secondTarget.listenerCount("keyup"), 1);
  assert.equal(session.isKeyboardTargetBound(), true);

  secondTarget.emit(
    "keydown",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "1",
      ctrlKey: true,
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(session.getSnapshot().activePanel, "stream");

  secondTarget.emit(
    "keyup",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "1",
      ctrlKey: true,
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(session.getSnapshot().activePanel, "lifecycle");
  assert.equal(preventDefaultCount, 2);

  assert.equal(session.unbindKeyboardTarget(), true);
  assert.equal(secondTarget.listenerCount("keyup"), 0);
  assert.strictEqual(
    secondTarget.removedListenerOptions("keyup")[0],
    secondListenerOptions,
  );
  assert.equal(session.isKeyboardTargetBound(), false);
  assert.equal(session.unbindKeyboardTarget(), false);

  secondTarget.emit(
    "keyup",
    createFakeRuntimeWorkbenchShellDomKeyboardEvent({
      key: "2",
      ctrlKey: true,
    }),
  );
  await flushRuntimeWorkbenchShellKeyboardDomBinding();
  assert.equal(session.getSnapshot().activePanel, "lifecycle");

  assert.equal(session.dispose(), true);
  assert.equal(session.dispose(), false);
  assert.equal(session.isDisposed(), true);
  harness.host.dispose();
});

test("renderer runtime workbench shell DOM session fails closed after dispose", async () => {
  const harness = createRuntimeWorkbenchShellAdapterHarness(
    "token_workbench_shell_dom_session_disposed",
  );
  const target = createFakeRuntimeWorkbenchShellDomEventTarget();
  const session = createRuntimeWorkbenchShellDomSession({
    adapter: harness.adapter,
    keyboardTarget: target,
  });

  assert.equal(target.listenerCount("keydown"), 1);
  assert.equal(session.dispose(), true);
  assert.equal(target.listenerCount("keydown"), 0);
  assert.equal(harness.adapter.isDisposed(), true);
  assert.equal(harness.host.isDisposed(), false);
  assert.equal(session.subscribe(() => undefined)(), false);
  assert.equal(session.bindKeyboardTarget(target), false);
  assert.equal(target.listenerCount("keydown"), 0);
  assert.equal(session.unbindKeyboardTarget(), false);
  assert.throws(
    () => session.setActivePanel("stream"),
    /Runtime workbench shell adapter is disposed/u,
  );
  await assert.rejects(async () => {
    await session.dispatch({ type: "show_stream_panel" });
  }, /Runtime workbench shell adapter is disposed/u);
  await assert.rejects(async () => {
    await session.handleKeyEvent({ key: "2", ctrlKey: true });
  }, /Runtime workbench shell adapter is disposed/u);
  harness.host.dispose();
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
  const commandSearched = interaction.dispatch({
    type: "set_search_query",
    query: "ready",
  });
  assert.equal(commandSearched.search.activeEventId, "evt_system_ready");
  assert.equal(
    interaction.dispatch({ type: "select_active_search_match" })
      .selectedEventId,
    "evt_system_ready",
  );
  assert.equal(interaction.dispatch({ type: "clear_search" }).search.query, "");
  assert.equal(
    interaction.dispatch({
      type: "set_expanded",
      eventId: "evt_tool_start",
      expanded: false,
    }).view.timelineItems[0]?.expanded,
    false,
  );
  assert.equal(
    interaction.dispatch({
      type: "select_event",
      eventId: null,
    }).selectedEventId,
    null,
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
  const publishedBeforeDispatch = published.length;
  const errorsBeforeDispatch = errors.length;
  session.dispatch({ type: "set_search_query", query: "published" });
  assert.equal(published.length, publishedBeforeDispatch + 1);
  assert.equal(errors.length, errorsBeforeDispatch + 1);
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

function createRuntimeWorkbenchShellAdapterHarness(token: string): {
  readonly adapter: ReturnType<typeof createRuntimeWorkbenchShellAdapter>;
  readonly host: ReturnType<typeof createRuntimeWorkbenchHostSession>;
  readonly dispose: () => void;
} {
  const lifecycleRuntime = createFakeRuntimeLifecycleStatusRuntime(
    [createStartupStatus("starting_sidecar")],
    [createShutdownStatus("registered")],
  );
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: lifecycleRuntime.runtime,
        }),
      }),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: {
          connectionInfo: async () => ({
            base_url: "http://127.0.0.1:51234/cw/v1",
            token,
          }),
        },
        eventSourceFactory: () => createFakeRuntimeStreamEventSource().source,
      }),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
  });
  const presenter = createRuntimeWorkbenchShellPresenter({ host });
  const adapter = createRuntimeWorkbenchShellAdapter({ presenter });
  return {
    adapter,
    host,
    dispose: () => {
      adapter.dispose();
      host.dispose();
    },
  };
}

function createFakeRuntimeWorkbenchShellKeyboardTarget(): {
  readonly addEventListener: (
    eventType: string,
    listener: RuntimeWorkbenchShellKeyboardEventListener,
  ) => void;
  readonly removeEventListener: (
    eventType: string,
    listener: RuntimeWorkbenchShellKeyboardEventListener,
  ) => void;
  readonly emit: (
    eventType: string,
    event: RuntimeWorkbenchShellKeyboardEvent,
  ) => Promise<void>;
  readonly listenerCount: (eventType: string) => number;
} {
  const listeners = new Map<
    string,
    Set<RuntimeWorkbenchShellKeyboardEventListener>
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
    emit: async (eventType, event) => {
      for (const listener of [...(listeners.get(eventType) ?? [])]) {
        await listener(event);
      }
    },
    listenerCount: (eventType) => listeners.get(eventType)?.size ?? 0,
  };
}

function createFakeRuntimeWorkbenchShellDomEventTarget(): {
  readonly addEventListener: (
    eventType: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  readonly removeEventListener: (
    eventType: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) => void;
  readonly emit: (eventType: string, event: Event) => void;
  readonly listenerCount: (eventType: string) => number;
  readonly listenerOptions: (
    eventType: string,
  ) => readonly (boolean | AddEventListenerOptions | undefined)[];
  readonly removedListenerOptions: (
    eventType: string,
  ) => readonly (boolean | EventListenerOptions | undefined)[];
} {
  const listeners = new Map<
    string,
    Array<{
      readonly listener: EventListener;
      readonly options?: boolean | AddEventListenerOptions;
    }>
  >();
  const removed = new Map<
    string,
    Array<boolean | EventListenerOptions | undefined>
  >();
  return {
    addEventListener: (eventType, listener, options) => {
      const eventListeners = listeners.get(eventType) ?? [];
      eventListeners.push(
        options !== undefined ? { listener, options } : { listener },
      );
      listeners.set(eventType, eventListeners);
    },
    removeEventListener: (eventType, listener, options) => {
      const eventListeners = listeners.get(eventType) ?? [];
      listeners.set(
        eventType,
        eventListeners.filter((entry) => entry.listener !== listener),
      );
      const removedOptions = removed.get(eventType) ?? [];
      removedOptions.push(options);
      removed.set(eventType, removedOptions);
    },
    emit: (eventType, event) => {
      for (const { listener } of [...(listeners.get(eventType) ?? [])]) {
        listener(event);
      }
    },
    listenerCount: (eventType) => listeners.get(eventType)?.length ?? 0,
    listenerOptions: (eventType) =>
      (listeners.get(eventType) ?? []).map((entry) => entry.options),
    removedListenerOptions: (eventType) => removed.get(eventType) ?? [],
  };
}

function createFakeRuntimeWorkbenchShellDomKeyboardEvent(options: {
  readonly key: string;
  readonly code?: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
  readonly defaultPrevented?: boolean;
  readonly target?: Record<string, unknown> | null;
  readonly preventDefault?: () => void;
}): Event {
  return {
    key: options.key,
    ...(options.code !== undefined ? { code: options.code } : {}),
    ...(options.altKey !== undefined ? { altKey: options.altKey } : {}),
    ...(options.ctrlKey !== undefined ? { ctrlKey: options.ctrlKey } : {}),
    ...(options.metaKey !== undefined ? { metaKey: options.metaKey } : {}),
    ...(options.shiftKey !== undefined ? { shiftKey: options.shiftKey } : {}),
    ...(options.repeat !== undefined ? { repeat: options.repeat } : {}),
    ...(options.defaultPrevented !== undefined
      ? { defaultPrevented: options.defaultPrevented }
      : {}),
    ...(options.target !== undefined ? { target: options.target } : {}),
    preventDefault: options.preventDefault ?? (() => undefined),
  } as unknown as Event;
}

async function flushRuntimeWorkbenchShellKeyboardDomBinding(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
