import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createRuntimeBaseUrl, type RuntimeConnectionInfo } from "./runtime.js";
import { resolveRuntimeConnectionHandoff } from "./runtime-handoff.js";

const ACQUIRED_AT = "2026-06-20T05:00:00Z";
const ACQUIRED_AT_MS = Date.parse(ACQUIRED_AT);
const ACTIVE_LOCK = `pid=1234\nacquired_at=${ACQUIRED_AT}\nadapter_id=desktop-main\n`;
const CONNECTION: RuntimeConnectionInfo = {
  base_url: createRuntimeBaseUrl(51234),
  token: "token_abc123",
};

test("reuses an active runtime.lock only through an in-memory connection resolver", async () => {
  let inspectedPid = 0;

  const decision = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 1_000,
    readText: async () => ACTIVE_LOCK,
    connectionInfo: (inspection) => {
      inspectedPid = inspection.record?.pid ?? 0;
      return {
        base_url: createRuntimeBaseUrl(51234),
        token: " token_abc123 ",
      };
    },
  });

  if (decision.action !== "reuse_existing") {
    throw new Error(`Expected reuse_existing, received ${decision.action}`);
  }
  assert.equal(inspectedPid, 1234);
  assert.deepEqual(decision.connection, CONNECTION);
  assert.equal(decision.inspection.status, "active");
});

test("waits when runtime.lock is active but no connection can be handed off", async () => {
  const withoutResolver = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 1_000,
    readText: async () => ACTIVE_LOCK,
  });
  const missingConnection = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 1_000,
    readText: async () => ACTIVE_LOCK,
    connectionInfo: () => null,
  });

  assert.equal(withoutResolver.action, "wait_for_existing");
  assert.match(withoutResolver.reason, /no in-memory connection/u);
  assert.equal(missingConnection.action, "wait_for_existing");
  assert.match(missingConnection.reason, /no reusable runtime connection/u);
});

test("starts or cleans up when runtime.lock is missing or stale", async () => {
  const missing = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    readText: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
  });
  const stale = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 60_001,
    readText: async () => ACTIVE_LOCK,
  });

  assert.equal(missing.action, "start_sidecar");
  assert.equal(stale.action, "cleanup_then_start");
});

test("blocks startup on corrupt lock or invalid handed-off connection", async () => {
  const corrupt = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    readText: async () => "pid=abc\n",
  });
  const invalidConnection = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 1_000,
    readText: async () => ACTIVE_LOCK,
    connectionInfo: () => ({
      base_url:
        "http://localhost:51234/cw/v1" as RuntimeConnectionInfo["base_url"],
      token: "token_abc123",
    }),
  });
  const invalidToken = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 1_000,
    readText: async () => ACTIVE_LOCK,
    connectionInfo: () => ({
      base_url: createRuntimeBaseUrl(51234),
      token: "token abc",
    }),
  });
  const resolverFailure = await resolveRuntimeConnectionHandoff({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 1_000,
    readText: async () => ACTIVE_LOCK,
    connectionInfo: () => {
      throw new Error("registry unavailable");
    },
  });

  assert.equal(corrupt.action, "block_startup");
  assert.match(corrupt.reason, /pid/u);
  assert.equal(invalidConnection.action, "block_startup");
  assert.match(invalidConnection.reason, /loopback/u);
  assert.equal(invalidToken.action, "block_startup");
  assert.match(invalidToken.reason, /Runtime auth token/u);
  assert.equal(resolverFailure.action, "block_startup");
  assert.match(resolverFailure.reason, /registry unavailable/u);
});
