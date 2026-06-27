import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeBaseUrl, type RuntimeConnectionInfo } from "./runtime.js";
import {
  createRuntimeIpcMainHandlers,
  normalizeRuntimeConnectionInfo,
  requestRuntimeShutdown,
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

test("decodes base64 runtime fetch request bodies through injected fetch", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  });

  const response = await handlers.fetch(
    buildRuntimeIpcFetchRequest("/projects/prj_123/references", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=cw_boundary",
      },
      bodyBase64: "cmVmZXJlbmNlLWJ5dGVz",
    }),
  );

  assert.equal(
    capturedUrl,
    "http://127.0.0.1:51234/cw/v1/projects/prj_123/references",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(capturedInit?.headers, {
    Authorization: "Bearer token_abc123",
    "X-Cw-Client": "electron-renderer",
    "Content-Type": "multipart/form-data; boundary=cw_boundary",
  });
  assert.ok(Buffer.isBuffer(capturedInit?.body));
  assert.equal(
    (capturedInit?.body as Buffer).toString("utf8"),
    "reference-bytes",
  );
  assert.deepEqual(response, {
    ok: true,
    status: 204,
    headers: {},
    body: null,
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

test("requests authenticated runtime shutdown through the shared fetch path", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(null, { status: 202 });
    },
  });

  assert.deepEqual(await requestRuntimeShutdown(handlers), {
    ok: true,
    status: 202,
    headers: {},
    body: null,
  });
  assert.equal(capturedUrl, "http://127.0.0.1:51234/cw/v1/system/shutdown");
  assert.deepEqual(capturedInit, {
    method: "POST",
    headers: {
      Authorization: "Bearer token_abc123",
      "X-Cw-Client": "electron-renderer",
    },
  });
});

test("opens runtime artifact content through native handoff without exposing paths", async () => {
  const artifactTempDir = await mkdtemp(
    path.join(os.tmpdir(), "cw-artifact-open-"),
  );
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  let openedPath = "";
  try {
    const body = "artifact bytes";
    const handlers = createRuntimeIpcMainHandlers({
      connectionInfo: () => CONNECTION,
      artifactTempDir,
      artifactOpenPath: async (targetPath) => {
        openedPath = targetPath;
        return "";
      },
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        });
      },
    });

    assert.ok(handlers.artifactAction);
    const result = await handlers.artifactAction({
      schema_version: "0.1.0",
      artifact_id: "artifact_report",
      action: "open",
      run_id: "run_artifact",
      intent: "ask",
    });

    assert.equal(
      capturedUrl,
      "http://127.0.0.1:51234/cw/v1/artifacts/artifact_report/content",
    );
    assert.deepEqual(capturedInit?.headers, {
      Authorization: "Bearer token_abc123",
      "X-Cw-Client": "electron-renderer",
    });
    assert.equal(openedPath.startsWith(artifactTempDir), true);
    assert.equal(await readFile(openedPath, "utf8"), body);
    assert.deepEqual(result, {
      schema_version: "0.1.0",
      artifact_id: "artifact_report",
      action: "open",
      status: "succeeded",
      destination_kind: "native_shell",
      content_type: "text/markdown",
      byte_count: Buffer.byteLength(body),
      content_hash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
      sensitive: false,
    });
    assert.equal(Object.hasOwn(result, "destination_path"), false);
    assert.equal(Object.hasOwn(result, "body"), false);
  } finally {
    await rm(artifactTempDir, { force: true, recursive: true });
  }
});

test("blocks sensitive user-selected artifact export before fetching content", async () => {
  let fetched = false;
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => CONNECTION,
    fetchImpl: async () => {
      fetched = true;
      return new Response(null, { status: 204 });
    },
  });

  assert.ok(handlers.artifactAction);
  const result = await handlers.artifactAction({
    schema_version: "0.1.0",
    artifact_id: "artifact_sensitive",
    action: "download",
    artifact_sensitivity: "sensitive",
    requested_destination_kind: "user_selected",
  });

  assert.equal(fetched, false);
  assert.deepEqual(result, {
    schema_version: "0.1.0",
    artifact_id: "artifact_sensitive",
    action: "download",
    status: "blocked",
    destination_kind: "none",
    sensitive: true,
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
