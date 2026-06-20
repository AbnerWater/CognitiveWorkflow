import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  type RuntimeIpcChannel,
  type RuntimeIpcStartupStatus,
  type RuntimeIpcStartupStatusResponse,
} from "../shared/runtime-ipc.js";
import {
  assertRuntimeRequestPath,
  buildRuntimeRequestHeaders,
  type RuntimeRequestInit,
} from "./contract.js";
import { CW_PRELOAD_API_KEY, createCwDesktopApi } from "./api.js";
import { createRuntimePreloadBridge } from "./runtime-bridge.js";

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
  const bridge = createRuntimePreloadBridge({
    invoke: async <TResult>(
      channel: RuntimeIpcChannel,
      payload?: unknown,
    ): Promise<TResult> => {
      calls.push(payload === undefined ? { channel } : { channel, payload });
      switch (channel) {
        case RUNTIME_IPC_STARTUP_STATUS_CHANNEL:
          return statuses as TResult;
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
  });

  assert.deepEqual(await bridge.startupStatus(), statuses);
  const mutableStatuses =
    (await bridge.startupStatus()) as RuntimeIpcStartupStatusResponse extends readonly (infer TStatus)[]
      ? TStatus[]
      : never;
  mutableStatuses[0] = { ...waitingStatus, message: "mutated" };
  assert.deepEqual(await bridge.startupStatus(), statuses);
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

test("preload runtime bridge validates fetch payloads before invoke", async () => {
  const calls: RuntimeIpcChannel[] = [];
  const bridge = createRuntimePreloadBridge({
    invoke: async <TResult>(channel: RuntimeIpcChannel): Promise<TResult> => {
      calls.push(channel);
      throw new Error("invoke should not be called");
    },
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
  const api = createCwDesktopApi({
    invoke: async <TResult>(
      channel: RuntimeIpcChannel,
      payload?: unknown,
    ): Promise<TResult> => {
      calls.push(payload === undefined ? { channel } : { channel, payload });
      switch (channel) {
        case RUNTIME_IPC_STARTUP_STATUS_CHANNEL:
          return statuses as TResult;
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
  });

  assert.equal(CW_PRELOAD_API_KEY, "cw");
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.runtime), true);
  assert.deepEqual(await api.runtime.startupStatus(), statuses);
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
