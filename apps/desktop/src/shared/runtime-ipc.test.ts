import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_IPC_CHANNELS,
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  assertRuntimeIpcChannel,
  assertRuntimeIpcRequestPath,
  buildRuntimeIpcFetchRequest,
  buildRuntimeIpcRequestHeaders,
  isRuntimeIpcChannel,
  parseRuntimeIpcFetchRequestPayload,
  type RuntimeIpcMethod,
} from "./runtime-ipc.js";

test("defines stable runtime IPC channels", () => {
  assert.deepEqual(RUNTIME_IPC_CHANNELS, [
    "cw:runtime:connection-info",
    "cw:runtime:fetch",
    "cw:runtime:startup-status",
  ]);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_CONNECTION_INFO_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_FETCH_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_STARTUP_STATUS_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel("cw:runtime:spawn"), false);
  assert.throws(
    () => assertRuntimeIpcChannel("cw:runtime:spawn"),
    /Unsupported runtime IPC channel/u,
  );
});

test("accepts only relative runtime API paths for IPC fetch", () => {
  assert.doesNotThrow(() => assertRuntimeIpcRequestPath("/system/info"));
  assert.doesNotThrow(() =>
    buildRuntimeIpcFetchRequest("/runs/run_123/stream"),
  );
  assert.throws(
    () => buildRuntimeIpcFetchRequest("system/info"),
    /absolute API path/u,
  );
  assert.throws(
    () => buildRuntimeIpcFetchRequest("//evil.test/system/info"),
    /absolute API path/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("http://127.0.0.1:8080/cw/v1/system/info"),
    /absolute API path/u,
  );
  assert.throws(
    () => buildRuntimeIpcFetchRequest("/../secure/secrets"),
    /absolute API path/u,
  );
});

test("normalizes runtime IPC fetch request payloads without mutating input", () => {
  const headers = { Accept: "application/json" };
  const request = buildRuntimeIpcFetchRequest("/runs/run_123", {
    method: "POST",
    projectId: "prj_123",
    idempotencyKey: "7a94974e-7c24-4ddb-884b-7a07acfcf0ca",
    headers,
    body: '{"ok":true}',
  });

  assert.deepEqual(request, {
    path: "/runs/run_123",
    init: {
      method: "POST",
      projectId: "prj_123",
      idempotencyKey: "7a94974e-7c24-4ddb-884b-7a07acfcf0ca",
      headers: { Accept: "application/json" },
      body: '{"ok":true}',
    },
  });
  assert.notEqual(request.init?.headers, headers);
});

test("rejects unsupported IPC methods and unsafe header payloads", () => {
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("/system/info", {
        method: "TRACE" as RuntimeIpcMethod,
      }),
    /method is not supported/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("/system/info", {
        projectId: "prj\r123",
      }),
    /X-Project-Id/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("/system/info", {
        headers: { Authorization: "Bearer attacker" },
      }),
    /reserved/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("/system/info", {
        headers: { "Bad Header": "value" },
      }),
    /header name/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("/system/info", {
        headers: { Accept: "text/plain\napplication/json" },
      }),
    /Accept/u,
  );
});

test("parses unknown runtime IPC fetch payloads before main handler dispatch", () => {
  assert.deepEqual(
    parseRuntimeIpcFetchRequestPayload({
      path: "/system/info",
      init: {
        method: "GET",
        projectId: "prj_123",
        headers: { Accept: "application/json" },
      },
    }),
    {
      path: "/system/info",
      init: {
        method: "GET",
        projectId: "prj_123",
        headers: { Accept: "application/json" },
      },
    },
  );

  assert.throws(
    () => parseRuntimeIpcFetchRequestPayload(null),
    /payload must be an object/u,
  );
  assert.throws(
    () => parseRuntimeIpcFetchRequestPayload({ path: 42 }),
    /path must be a string/u,
  );
  assert.throws(
    () =>
      parseRuntimeIpcFetchRequestPayload({
        path: "/system/info",
        init: { headers: { Accept: 42 } },
      }),
    /Accept value must be a string/u,
  );
  assert.throws(
    () =>
      parseRuntimeIpcFetchRequestPayload({
        path: "/system/info",
        init: { headers: { Authorization: "Bearer attacker" } },
      }),
    /reserved/u,
  );
});

test("builds authenticated runtime IPC request headers", () => {
  assert.deepEqual(
    buildRuntimeIpcRequestHeaders({
      token: " token_abc123 ",
      projectId: "prj_123",
      idempotencyKey: "idem_123",
      extraHeaders: { Accept: "application/json" },
    }),
    {
      Authorization: "Bearer token_abc123",
      "X-Cw-Client": "electron-renderer",
      "X-Project-Id": "prj_123",
      "Idempotency-Key": "idem_123",
      Accept: "application/json",
    },
  );
});

test("rejects unsafe runtime IPC request headers", () => {
  assert.throws(
    () => buildRuntimeIpcRequestHeaders({ token: "token abc" }),
    /Authorization token/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcRequestHeaders({
        token: "token_abc123",
        extraHeaders: { "Bad Header": "value" },
      }),
    /header name/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcRequestHeaders({
        token: "token_abc123",
        extraHeaders: { "X-Cw-Client": "spoof" },
      }),
    /reserved/u,
  );
});
