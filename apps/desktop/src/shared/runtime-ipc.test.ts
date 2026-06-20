import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_IPC_CHANNELS,
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  assertRuntimeIpcChannel,
  assertRuntimeIpcRequestPath,
  buildRuntimeIpcFetchRequest,
  isRuntimeIpcChannel,
  type RuntimeIpcMethod,
} from "./runtime-ipc.js";

test("defines stable runtime IPC channels", () => {
  assert.deepEqual(RUNTIME_IPC_CHANNELS, [
    "cw:runtime:connection-info",
    "cw:runtime:fetch",
  ]);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_CONNECTION_INFO_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_FETCH_CHANNEL), true);
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
