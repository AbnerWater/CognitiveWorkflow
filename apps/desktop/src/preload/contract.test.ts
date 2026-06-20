import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRuntimeRequestPath,
  buildRuntimeRequestHeaders,
} from "./contract.js";

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
