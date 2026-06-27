import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_IPC_ARTIFACT_ACTION_CHANNEL,
  RUNTIME_IPC_CHANNELS,
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  assertRuntimeIpcChannel,
  assertRuntimeIpcRequestPath,
  buildRuntimeIpcFetchRequest,
  buildRuntimeIpcRequestHeaders,
  isRuntimeIpcChannel,
  parseRuntimeIpcArtifactActionRequestPayload,
  parseRuntimeIpcFetchRequestPayload,
  type RuntimeIpcMethod,
} from "./runtime-ipc.js";

test("defines stable runtime IPC channels", () => {
  assert.deepEqual(RUNTIME_IPC_CHANNELS, [
    "cw:runtime:connection-info",
    "cw:runtime:fetch",
    "cw:runtime:artifact-action",
    "cw:runtime:startup-status",
    "cw:runtime:shutdown-status",
  ]);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_ARTIFACT_ACTION_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_CONNECTION_INFO_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_FETCH_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_STARTUP_STATUS_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL), true);
  assert.equal(isRuntimeIpcChannel("cw:runtime:spawn"), false);
  assert.throws(
    () => assertRuntimeIpcChannel("cw:runtime:spawn"),
    /Unsupported runtime IPC channel/u,
  );
});

test("parses runtime IPC artifact action payloads without mutating input", () => {
  const payload = {
    schema_version: "0.1.0",
    artifact_id: "artifact_report",
    action: "open",
    run_id: "run_123",
    node_id: "node_456",
    intent: "ask",
    requested_destination_kind: "native_shell",
    artifact_sensitivity: "project",
    allow_sensitive_export: false,
    correlation_id: "trace_789",
  };

  const parsed = parseRuntimeIpcArtifactActionRequestPayload(payload);

  assert.deepEqual(parsed, payload);
  assert.notEqual(parsed, payload);
  assert.throws(
    () =>
      parseRuntimeIpcArtifactActionRequestPayload({
        artifact_id: "artifact\rreport",
        action: "open",
      }),
    /artifact_id/u,
  );
  assert.throws(
    () =>
      parseRuntimeIpcArtifactActionRequestPayload({
        artifact_id: "artifact_report",
        action: "delete",
      }),
    /artifact action/u,
  );
  assert.throws(
    () =>
      parseRuntimeIpcArtifactActionRequestPayload({
        artifact_id: "artifact_report",
        action: "open",
        artifact_sensitivity: "secret",
      }),
    /sensitivity/u,
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

  assert.deepEqual(
    buildRuntimeIpcFetchRequest("/projects/prj_123/references", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=cw_boundary",
      },
      bodyBase64: "cmVmZXJlbmNlLWJ5dGVz",
    }),
    {
      path: "/projects/prj_123/references",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=cw_boundary",
        },
        bodyBase64: "cmVmZXJlbmNlLWJ5dGVz",
      },
    },
  );
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
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("/projects/prj_123/references", {
        method: "POST",
        bodyBase64: "not base64",
      }),
    /bodyBase64/u,
  );
  assert.throws(
    () =>
      buildRuntimeIpcFetchRequest("/projects/prj_123/references", {
        method: "POST",
        body: "plain",
        bodyBase64: "cGxhaW4=",
      }),
    /mutually exclusive/u,
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
  assert.throws(
    () =>
      parseRuntimeIpcFetchRequestPayload({
        path: "/projects/prj_123/references",
        init: {
          method: "POST",
          bodyBase64: "not base64",
        },
      }),
    /bodyBase64/u,
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
