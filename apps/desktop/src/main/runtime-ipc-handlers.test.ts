import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeBaseUrl, type RuntimeConnectionInfo } from "./runtime.js";
import {
  createRuntimeIpcMainHandlers,
  normalizeRuntimeConnectionInfo,
} from "./runtime-ipc-handlers.js";
import { buildRuntimeIpcFetchRequest } from "../shared/runtime-ipc.js";

const CONNECTION: RuntimeConnectionInfo = {
  base_url: createRuntimeBaseUrl(51234),
  token: "token_abc123",
};

test("normalizes runtime connection info before exposing handlers", async () => {
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => ({
      base_url: createRuntimeBaseUrl(51234),
      token: " token_abc123 ",
    }),
  });

  assert.deepEqual(await handlers.connectionInfo(), CONNECTION);
  assert.deepEqual(
    normalizeRuntimeConnectionInfo({
      base_url:
        "http://127.0.0.1:51234/cw/v1" as RuntimeConnectionInfo["base_url"],
      token: "token_abc123",
    }),
    CONNECTION,
  );
});

test("rejects unsafe runtime connection info", async () => {
  const badHost = createRuntimeIpcMainHandlers({
    connectionInfo: () => ({
      base_url:
        "http://localhost:51234/cw/v1" as RuntimeConnectionInfo["base_url"],
      token: "token_abc123",
    }),
  });
  const badToken = createRuntimeIpcMainHandlers({
    connectionInfo: () => ({
      base_url: createRuntimeBaseUrl(51234),
      token: "token abc",
    }),
  });

  await assert.rejects(badHost.connectionInfo(), /loopback \/cw\/v1 HTTP URL/u);
  await assert.rejects(badToken.connectionInfo(), /Runtime auth token/u);
});

test("builds authenticated runtime fetch requests through injected fetch", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Trace-Id": "trace_123",
        },
      });
    },
  });

  const response = await handlers.fetch<{ ok: boolean }>(
    buildRuntimeIpcFetchRequest("/runs/run_123", {
      method: "POST",
      projectId: "prj_123",
      idempotencyKey: "idem_123",
      headers: { Accept: "application/json" },
      body: '{"input":true}',
    }),
  );

  assert.equal(capturedUrl, "http://127.0.0.1:51234/cw/v1/runs/run_123");
  assert.deepEqual(capturedInit, {
    method: "POST",
    headers: {
      Authorization: "Bearer token_abc123",
      "X-Cw-Client": "electron-renderer",
      "X-Project-Id": "prj_123",
      "Idempotency-Key": "idem_123",
      Accept: "application/json",
    },
    body: '{"input":true}',
  });
  assert.deepEqual(response, {
    ok: true,
    status: 201,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-trace-id": "trace_123",
    },
    body: { ok: true },
  });
});

test("returns text and empty runtime fetch responses", async () => {
  const textHandler = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl: async () =>
      new Response("plain response", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
  });
  const emptyHandler = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  assert.deepEqual(await textHandler.fetch<string>({ path: "/system/info" }), {
    ok: true,
    status: 200,
    headers: { "content-type": "text/plain" },
    body: "plain response",
  });
  assert.deepEqual(await emptyHandler.fetch({ path: "/system/info" }), {
    ok: true,
    status: 204,
    headers: {},
    body: null,
  });
});

test("rejects unsafe runtime IPC fetch payloads before fetch", async () => {
  let called = false;
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl: async () => {
      called = true;
      return new Response(null, { status: 204 });
    },
  });

  await assert.rejects(
    handlers.fetch({
      path: "/runs/run_123",
      init: { headers: { Authorization: "Bearer attacker" } },
    }),
    /reserved/u,
  );
  await assert.rejects(
    handlers.fetch({ path: "http://evil.test" as "/http://evil.test" }),
    /absolute API path/u,
  );
  assert.equal(called, false);
});
