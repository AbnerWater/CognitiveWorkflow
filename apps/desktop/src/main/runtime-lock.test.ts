import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_RUNTIME_LOCK_ADAPTER_ID,
  DEFAULT_RUNTIME_LOCK_STALE_MS,
  RUNTIME_LOCK_FILENAME,
  RUNTIME_LOCK_MUTATION_GUARD_SUFFIX,
  acquireRuntimeLock,
  buildRuntimeLockContent,
  decideRuntimeLockAction,
  inspectRuntimeLock,
  parseRuntimeLockContent,
  resolveRuntimeLockPath,
} from "./runtime-lock.js";

const ACQUIRED_AT = "2026-06-20T05:00:00Z";
const ACQUIRED_AT_MS = Date.parse(ACQUIRED_AT);
const NEXT_ACQUIRED_AT = "2026-06-20T05:01:01Z";
const NEXT_ACQUIRED_AT_MS = Date.parse(NEXT_ACQUIRED_AT);

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

test("builds desktop runtime.lock content with adapter ownership", () => {
  assert.equal(
    buildRuntimeLockContent({
      pid: 1234,
      nowMs: ACQUIRED_AT_MS,
      adapterId: DEFAULT_RUNTIME_LOCK_ADAPTER_ID,
    }),
    `pid=1234\nacquired_at=${ACQUIRED_AT}\nadapter_id=desktop-main\n`,
  );

  assert.throws(
    () => buildRuntimeLockContent({ pid: 0, nowMs: ACQUIRED_AT_MS }),
    /pid/u,
  );
  assert.throws(
    () =>
      buildRuntimeLockContent({
        pid: 1234,
        nowMs: ACQUIRED_AT_MS,
        adapterId: "desktop main",
      }),
    /adapter_id/u,
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

test("acquires and releases a missing runtime.lock", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lease = await acquireRuntimeLock({
      projectRoot,
      pid: 1234,
      nowMs: ACQUIRED_AT_MS,
      adapterId: DEFAULT_RUNTIME_LOCK_ADAPTER_ID,
    });

    assert.equal(lease.record.pid, 1234);
    assert.equal(lease.record.adapter_id, DEFAULT_RUNTIME_LOCK_ADAPTER_ID);
    assert.equal(
      await readFile(lease.lockPath, "utf8"),
      `pid=1234\nacquired_at=${ACQUIRED_AT}\nadapter_id=desktop-main\n`,
    );

    await lease.release();
    await assert.rejects(readFile(lease.lockPath, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("refuses to acquire an active runtime.lock before timeout", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    const activeContent = `pid=1234\nacquired_at=${ACQUIRED_AT}\n`;
    await writeLockFile(lockPath, activeContent);

    await assert.rejects(
      acquireRuntimeLock({
        projectRoot,
        pid: 4321,
        nowMs: ACQUIRED_AT_MS + 1_000,
        timeoutMs: 1,
        retryMs: 1,
      }),
      /Timed out acquiring runtime\.lock/u,
    );
    assert.equal(await readFile(lockPath, "utf8"), activeContent);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("cleans stale runtime.lock before acquiring", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    await writeLockFile(lockPath, `pid=1234\nacquired_at=${ACQUIRED_AT}\n`);

    const lease = await acquireRuntimeLock({
      projectRoot,
      pid: 4321,
      nowMs: NEXT_ACQUIRED_AT_MS,
      staleMs: DEFAULT_RUNTIME_LOCK_STALE_MS,
    });

    assert.equal(lease.record.pid, 4321);
    assert.equal(lease.record.acquired_at, NEXT_ACQUIRED_AT);
    assert.equal(lease.record.adapter_id, DEFAULT_RUNTIME_LOCK_ADAPTER_ID);
    assert.equal(await readFile(lockPath, "utf8"), lease.content);

    await lease.release();
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("cleans stale runtime.lock mutation guard before stale lock cleanup", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    const guardPath = `${lockPath}${RUNTIME_LOCK_MUTATION_GUARD_SUFFIX}`;
    await writeLockFile(lockPath, `pid=1234\nacquired_at=${ACQUIRED_AT}\n`);
    await writeLockFile(
      guardPath,
      `pid=9999\nacquired_at=${ACQUIRED_AT}\nadapter_id=desktop-main.mutation\n`,
    );

    const lease = await acquireRuntimeLock({
      projectRoot,
      pid: 4321,
      nowMs: NEXT_ACQUIRED_AT_MS,
      staleMs: DEFAULT_RUNTIME_LOCK_STALE_MS,
    });

    assert.equal(lease.record.pid, 4321);
    assert.equal(await readFile(lockPath, "utf8"), lease.content);
    await assert.rejects(readFile(guardPath, "utf8"), { code: "ENOENT" });

    await lease.release();
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("waits on a fresh runtime.lock mutation guard", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    const guardPath = `${lockPath}${RUNTIME_LOCK_MUTATION_GUARD_SUFFIX}`;
    const freshGuardContent = `pid=9999\nacquired_at=${NEXT_ACQUIRED_AT}\nadapter_id=desktop-main.mutation\n`;
    await writeLockFile(lockPath, `pid=1234\nacquired_at=${ACQUIRED_AT}\n`);
    await writeLockFile(guardPath, freshGuardContent);

    await assert.rejects(
      acquireRuntimeLock({
        projectRoot,
        pid: 4321,
        nowMs: NEXT_ACQUIRED_AT_MS + 1_000,
        timeoutMs: 1,
        retryMs: 1,
      }),
      /Timed out acquiring runtime\.lock mutation guard/u,
    );
    assert.equal(await readFile(guardPath, "utf8"), freshGuardContent);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("fails closed on corrupt runtime.lock mutation guard", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    const guardPath = `${lockPath}${RUNTIME_LOCK_MUTATION_GUARD_SUFFIX}`;
    const corruptGuardContent = "pid=abc\n";
    await writeLockFile(lockPath, `pid=1234\nacquired_at=${ACQUIRED_AT}\n`);
    await writeLockFile(guardPath, corruptGuardContent);

    await assert.rejects(
      acquireRuntimeLock({
        projectRoot,
        pid: 4321,
        nowMs: NEXT_ACQUIRED_AT_MS + 1_000,
      }),
      /mutation guard is corrupt/u,
    );
    assert.equal(await readFile(guardPath, "utf8"), corruptGuardContent);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("fails closed on unreadable runtime.lock mutation guard", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    const guardPath = `${lockPath}${RUNTIME_LOCK_MUTATION_GUARD_SUFFIX}`;
    await writeLockFile(lockPath, `pid=1234\nacquired_at=${ACQUIRED_AT}\n`);

    await assert.rejects(
      acquireRuntimeLock({
        projectRoot,
        pid: 4321,
        nowMs: NEXT_ACQUIRED_AT_MS + 1_000,
        writeTextExclusive: async (targetPath, content) => {
          if (targetPath === guardPath) {
            throw Object.assign(new Error("exists"), { code: "EEXIST" });
          }
          await writeFile(targetPath, content, {
            encoding: "utf8",
            flag: "wx",
          });
        },
        readText: async (targetPath) => {
          if (targetPath === guardPath) {
            throw Object.assign(new Error("denied"), { code: "EACCES" });
          }
          return readFile(targetPath, "utf8");
        },
      }),
      /mutation guard could not be read/u,
    );
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("rechecks stale runtime.lock under mutation guard before deletion", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    const replacementContent = `pid=7777\nacquired_at=${NEXT_ACQUIRED_AT}\n`;
    let replacedBeforeGuardedCleanup = false;
    await writeLockFile(lockPath, `pid=1234\nacquired_at=${ACQUIRED_AT}\n`);

    await assert.rejects(
      acquireRuntimeLock({
        projectRoot,
        pid: 4321,
        nowMs: NEXT_ACQUIRED_AT_MS + 1_000,
        timeoutMs: 1,
        retryMs: 1,
        writeTextExclusive: async (targetPath, content) => {
          await writeFile(targetPath, content, {
            encoding: "utf8",
            flag: "wx",
          });
          if (
            targetPath === `${lockPath}${RUNTIME_LOCK_MUTATION_GUARD_SUFFIX}` &&
            !replacedBeforeGuardedCleanup
          ) {
            replacedBeforeGuardedCleanup = true;
            await writeFile(lockPath, replacementContent, "utf8");
          }
        },
      }),
      /Timed out acquiring runtime\.lock/u,
    );

    assert.equal(replacedBeforeGuardedCleanup, true);
    assert.equal(await readFile(lockPath, "utf8"), replacementContent);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("cleans stale runtime.lock mutation guard before release", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lease = await acquireRuntimeLock({
      projectRoot,
      pid: 1234,
      nowMs: NEXT_ACQUIRED_AT_MS,
    });
    const guardPath = `${lease.lockPath}${RUNTIME_LOCK_MUTATION_GUARD_SUFFIX}`;
    await writeLockFile(
      guardPath,
      `pid=9999\nacquired_at=${ACQUIRED_AT}\nadapter_id=desktop-main.mutation\n`,
    );

    await lease.release();

    await assert.rejects(readFile(lease.lockPath, "utf8"), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(guardPath, "utf8"), { code: "ENOENT" });
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("blocks acquisition on corrupt runtime.lock content", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lockPath = resolveRuntimeLockPath(projectRoot);
    await writeLockFile(lockPath, "pid=abc\n");

    await assert.rejects(
      acquireRuntimeLock({
        projectRoot,
        pid: 4321,
        nowMs: NEXT_ACQUIRED_AT_MS,
      }),
      /Runtime lock acquisition blocked/u,
    );
    assert.equal(await readFile(lockPath, "utf8"), "pid=abc\n");
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("refuses to release a lock that is no longer owned by the lease", async () => {
  const projectRoot = await makeTempProject();
  try {
    const lease = await acquireRuntimeLock({
      projectRoot,
      pid: 1234,
      nowMs: ACQUIRED_AT_MS,
    });
    const otherContent = `pid=9999\nacquired_at=${NEXT_ACQUIRED_AT}\n`;
    await writeFile(lease.lockPath, otherContent, "utf8");

    await assert.rejects(lease.release(), /lock content changed/u);
    assert.equal(await readFile(lease.lockPath, "utf8"), otherContent);
  } finally {
    await removeTempProject(projectRoot);
  }
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

async function makeTempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cw-desktop-runtime-lock-"));
}

async function removeTempProject(projectRoot: string): Promise<void> {
  if (!path.basename(projectRoot).startsWith("cw-desktop-runtime-lock-")) {
    throw new Error(
      `Refusing to remove unexpected temp project: ${projectRoot}`,
    );
  }
  await rm(projectRoot, { recursive: true, force: true });
}

async function writeLockFile(lockPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, content, { encoding: "utf8", flag: "wx" });
}
