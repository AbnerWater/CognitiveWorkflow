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
    assert.equal(connectionRegistry.get(projectRoot), null);
    await assert.rejects(readFile(session.lock.lockPath, "utf8"), {
      code: "ENOENT",
    });
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
