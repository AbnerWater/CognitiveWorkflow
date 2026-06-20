import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  RUNTIME_HTTP_PORT_ARG,
  type RuntimeSidecarProcess,
} from "./sidecar.js";
import { createRuntimeBaseUrl } from "./runtime.js";
import { resolveRuntimeConnectionHandoff } from "./runtime-handoff.js";
import { startRuntimeOrchestration } from "./runtime-orchestration.js";
import { resolveRuntimeLockPath } from "./runtime-lock.js";
import { createRuntimeConnectionRegistry } from "./runtime-connection-registry.js";

class FakeSidecarProcess extends EventEmitter implements RuntimeSidecarProcess {
  readonly pid: number | undefined = 24_680;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedSignals: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killedSignals.push(signal);
    return true;
  }
}

test("starts runtime sidecar under runtime.lock and exposes IPC handlers", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();
  const captured: {
    command: string | undefined;
    args: readonly string[] | undefined;
    cwd: string | undefined;
    token: string | undefined;
  } = {
    command: undefined,
    args: undefined,
    cwd: undefined,
    token: undefined,
  };

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: {
        devCommand: "cw-runtime",
        devArgs: ["--dev"],
      },
      cwd: projectRoot,
      env: { PATH: "C:\\runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: (command, args, options) => {
        captured.command = command;
        captured.args = args;
        captured.cwd = options.cwd;
        captured.token = options.env.CW_RUNTIME_AUTH_TOKEN;
        queueMicrotask(() => fake.stdout.write("READY 51234\n"));
        return fake;
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ ready: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    assert.equal(captured.command, "cw-runtime");
    assert.deepEqual(captured.args, ["--dev", RUNTIME_HTTP_PORT_ARG]);
    assert.equal(captured.cwd, projectRoot);
    assert.equal(captured.token, "token_abc123");
    assert.equal(session.command.source, "dev");
    assert.equal(session.lock.lockPath, resolveRuntimeLockPath(projectRoot));
    assert.match(await readFile(session.lock.lockPath, "utf8"), /adapter_id=/u);
    assert.deepEqual(await session.handlers.connectionInfo(), {
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_abc123",
    });
    assert.deepEqual(connectionRegistry.get(projectRoot), {
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_abc123",
    });

    const handoff = await resolveRuntimeConnectionHandoff({
      projectRoot,
      nowMs: Date.now(),
      connectionInfo: connectionRegistry.resolver(projectRoot),
    });
    assert.equal(handoff.action, "reuse_existing");
    assert.deepEqual(await session.handlers.fetch({ path: "/system/info" }), {
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ready: true },
    });

    assert.equal(await session.stop(), true);
    assert.deepEqual(fake.killedSignals, ["SIGTERM"]);
    await session.closed;
    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(session.lock.lockPath, "utf8"), {
      code: "ENOENT",
    });
    assert.equal(await session.stop(), false);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("requests graceful runtime shutdown before signal fallback", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();
  const capturedRequests: Array<{
    readonly url: string;
    readonly init: RequestInit | undefined;
  }> = [];

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: { devCommand: "cw-runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: () => {
        queueMicrotask(() => fake.stdout.write("READY 51234\n"));
        return fake;
      },
      fetchImpl: async (input, init) => {
        capturedRequests.push({ url: String(input), init });
        if (String(input).endsWith("/system/shutdown")) {
          queueMicrotask(() => fake.emit("exit", 0, null));
          return new Response(null, { status: 202 });
        }
        return new Response(null, { status: 204 });
      },
    });

    assert.equal(await session.stop("SIGTERM"), true);
    await session.closed;
    assert.deepEqual(fake.killedSignals, []);
    assert.deepEqual(capturedRequests, [
      {
        url: "http://127.0.0.1:51234/cw/v1/system/shutdown",
        init: {
          method: "POST",
          headers: {
            Authorization: "Bearer token_abc123",
            "X-Cw-Client": "electron-renderer",
          },
        },
      },
    ]);
    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(session.lock.lockPath, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("falls back to sidecar signal when runtime shutdown is not accepted", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: { devCommand: "cw-runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: () => {
        queueMicrotask(() => fake.stdout.write("READY 51234\n"));
        return fake;
      },
      fetchImpl: async () => new Response(null, { status: 503 }),
    });

    assert.equal(await session.stop("SIGINT"), true);
    await session.closed;
    assert.deepEqual(fake.killedSignals, ["SIGINT"]);
    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(session.lock.lockPath, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("falls back to sidecar signal when runtime shutdown request fails", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();
  let shutdownRequests = 0;

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: { devCommand: "cw-runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: () => {
        queueMicrotask(() => fake.stdout.write("READY 51234\n"));
        return fake;
      },
      shutdown: {
        request: () => {
          shutdownRequests += 1;
          throw new Error("shutdown request failed");
        },
      },
    });

    assert.equal(await session.stop("SIGINT"), true);
    await session.closed;
    assert.equal(shutdownRequests, 1);
    assert.deepEqual(fake.killedSignals, ["SIGINT"]);
    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(session.lock.lockPath, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("falls back to sidecar signal when accepted shutdown does not exit before timeout", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();
  let shutdownRequests = 0;

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: { devCommand: "cw-runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: () => {
        queueMicrotask(() => fake.stdout.write("READY 51234\n"));
        return fake;
      },
      shutdown: {
        timeoutMs: 1,
        request: async () => {
          shutdownRequests += 1;
          return { status: 202 };
        },
        sleep: async () => undefined,
      },
    });

    assert.equal(await session.stop("SIGTERM"), true);
    await session.closed;
    assert.equal(shutdownRequests, 1);
    assert.deepEqual(fake.killedSignals, ["SIGTERM"]);
    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(session.lock.lockPath, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("cleans runtime ownership when sidecar exits after READY", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();
  const lockPath = resolveRuntimeLockPath(projectRoot);

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: { devCommand: "cw-runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: () => {
        queueMicrotask(() => fake.stdout.write("READY 51234\n"));
        return fake;
      },
    });

    assert.deepEqual(connectionRegistry.get(projectRoot), {
      base_url: "http://127.0.0.1:51234/cw/v1",
      token: "token_abc123",
    });
    assert.match(await readFile(lockPath, "utf8"), /adapter_id=/u);

    fake.emit("exit", 0, null);
    await session.closed;

    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
    assert.equal(await session.stop(), false);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("cleans runtime ownership when sidecar exits in the READY transition", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();
  const lockPath = resolveRuntimeLockPath(projectRoot);

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: { devCommand: "cw-runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: () => {
        queueMicrotask(() => {
          fake.stdout.write("READY 51234\n");
          fake.emit("exit", 0, null);
        });
        return fake;
      },
    });

    await session.closed;
    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
    assert.equal(await session.stop(), false);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("sidecar exit does not unregister a newer registry connection", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const connectionRegistry = createRuntimeConnectionRegistry();

  try {
    const session = await startRuntimeOrchestration({
      projectRoot,
      command: { devCommand: "cw-runtime" },
      readyTimeoutMs: 100,
      tokenFactory: () => "token_abc123",
      connectionRegistry,
      spawn: () => {
        queueMicrotask(() => fake.stdout.write("READY 51234\n"));
        return fake;
      },
    });
    const newerConnection = {
      base_url: createRuntimeBaseUrl(51235),
      token: "token_def456",
    };
    connectionRegistry.register({
      projectRoot,
      connection: newerConnection,
    });

    fake.emit("exit", 0, null);
    await session.closed;

    assert.deepEqual(connectionRegistry.get(projectRoot), newerConnection);
    assert.equal(await session.stop(), false);
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("releases runtime.lock when sidecar exits before READY", async () => {
  const projectRoot = await makeTempProject();
  const fake = new FakeSidecarProcess();
  const lockPath = resolveRuntimeLockPath(projectRoot);

  try {
    await assert.rejects(
      startRuntimeOrchestration({
        projectRoot,
        command: { devCommand: "cw-runtime" },
        readyTimeoutMs: 100,
        tokenFactory: () => "token_abc123",
        spawn: () => {
          queueMicrotask(() => fake.emit("exit", 2, null));
          return fake;
        },
      }),
      /exited before READY/u,
    );
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
  } finally {
    await removeTempProject(projectRoot);
  }
});

test("releases runtime.lock when sidecar args fail validation", async () => {
  const projectRoot = await makeTempProject();
  const lockPath = resolveRuntimeLockPath(projectRoot);
  let spawnCalled = false;

  try {
    await assert.rejects(
      startRuntimeOrchestration({
        projectRoot,
        command: {
          devCommand: "cw-runtime",
          devArgs: ["--http-port=8080"],
        },
        tokenFactory: () => "token_abc123",
        spawn: () => {
          spawnCalled = true;
          return new FakeSidecarProcess();
        },
      }),
      /owns --http-port=0/u,
    );
    assert.equal(spawnCalled, false);
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
  } finally {
    await removeTempProject(projectRoot);
  }
});

async function makeTempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cw-desktop-orchestration-"));
}

async function removeTempProject(projectRoot: string): Promise<void> {
  if (!path.basename(projectRoot).startsWith("cw-desktop-orchestration-")) {
    throw new Error(
      `Refusing to remove unexpected temp project: ${projectRoot}`,
    );
  }
  await rm(projectRoot, { recursive: true, force: true });
}
