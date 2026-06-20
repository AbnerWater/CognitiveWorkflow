import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_RUNTIME_LOCK_STALE_MS,
  RUNTIME_LOCK_FILENAME,
  decideRuntimeLockAction,
  inspectRuntimeLock,
  parseRuntimeLockContent,
  resolveRuntimeLockPath,
} from "./runtime-lock.js";

const ACQUIRED_AT = "2026-06-20T05:00:00Z";
const ACQUIRED_AT_MS = Date.parse(ACQUIRED_AT);

test("resolves runtime.lock under the project .agent-workflow locks directory", () => {
  const projectRoot = path.join("C:", "CW", "project");

  assert.equal(
    resolveRuntimeLockPath(projectRoot),
    path.join(projectRoot, ".agent-workflow", "locks", RUNTIME_LOCK_FILENAME),
  );
});

test("parses the current Python runtime.lock key-value format", () => {
  assert.deepEqual(
    parseRuntimeLockContent(`pid=1234\nacquired_at=${ACQUIRED_AT}\n`),
    {
      pid: 1234,
      acquired_at: ACQUIRED_AT,
      acquiredAtMs: ACQUIRED_AT_MS,
      raw: {
        pid: "1234",
        acquired_at: ACQUIRED_AT,
      },
    },
  );
});

test("accepts the spec adapter_id field when present", () => {
  const record = parseRuntimeLockContent(
    `pid=1234\nacquired_at=${ACQUIRED_AT}\nadapter_id=desktop-main\n`,
  );

  assert.equal(record.adapter_id, "desktop-main");
  assert.equal(record.raw.adapter_id, "desktop-main");
});

test("rejects corrupt runtime.lock content", () => {
  assert.throws(
    () => parseRuntimeLockContent(`acquired_at=${ACQUIRED_AT}\n`),
    /pid/u,
  );
  assert.throws(
    () => parseRuntimeLockContent(`pid=0\nacquired_at=${ACQUIRED_AT}\n`),
    /pid/u,
  );
  assert.throws(
    () => parseRuntimeLockContent("pid=123\nacquired_at=not-a-date\n"),
    /acquired_at/u,
  );
  assert.throws(
    () =>
      parseRuntimeLockContent(`pid=123\npid=456\nacquired_at=${ACQUIRED_AT}\n`),
    /duplicated/u,
  );
});

test("classifies a missing runtime.lock as startable", async () => {
  const inspection = await inspectRuntimeLock({
    projectRoot: path.join("C:", "CW", "project"),
    readText: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
  });

  assert.equal(inspection.status, "missing");
  assert.equal(decideRuntimeLockAction(inspection), "start_sidecar");
});

test("classifies a fresh runtime.lock as active", async () => {
  const inspection = await inspectRuntimeLock({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + 10_000,
    readText: async () => `pid=1234\nacquired_at=${ACQUIRED_AT}\n`,
  });

  assert.equal(inspection.status, "active");
  assert.equal(inspection.ageMs, 10_000);
  assert.equal(inspection.record?.pid, 1234);
  assert.equal(decideRuntimeLockAction(inspection), "reuse_existing_or_wait");
});

test("classifies an old runtime.lock as stale cleanup before start", async () => {
  const inspection = await inspectRuntimeLock({
    projectRoot: path.join("C:", "CW", "project"),
    nowMs: ACQUIRED_AT_MS + DEFAULT_RUNTIME_LOCK_STALE_MS + 1,
    readText: async () => `pid=1234\nacquired_at=${ACQUIRED_AT}\n`,
  });

  assert.equal(inspection.status, "stale");
  assert.equal(decideRuntimeLockAction(inspection), "cleanup_then_start");
});

test("classifies unreadable or invalid runtime.lock as fail-closed", async () => {
  const unreadable = await inspectRuntimeLock({
    projectRoot: path.join("C:", "CW", "project"),
    readText: async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    },
  });
  const invalid = await inspectRuntimeLock({
    projectRoot: path.join("C:", "CW", "project"),
    readText: async () => "pid=abc\n",
  });

  assert.equal(unreadable.status, "corrupt");
  assert.equal(invalid.status, "corrupt");
  assert.equal(decideRuntimeLockAction(unreadable), "block_startup");
  assert.equal(decideRuntimeLockAction(invalid), "block_startup");
});
