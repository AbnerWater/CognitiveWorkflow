import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  RUNTIME_AUTH_TOKEN_ENV,
  RUNTIME_AUTH_TOKEN_BYTES,
  RUNTIME_HTTP_PORT_ARG,
  buildRuntimeSidecarArgs,
  buildRuntimeSidecarEnvironment,
  generateRuntimeAuthToken,
  startRuntimeSidecar,
  type RuntimeSidecarProcess,
  type RuntimeSidecarSpawn,
  type RuntimeSidecarSpawnOptions,
} from "./sidecar.js";

class FakeSidecarProcess extends EventEmitter implements RuntimeSidecarProcess {
  readonly pid: number | undefined = 12_345;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedSignals: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killedSignals.push(signal);
    return true;
  }
}

test("generates 128-bit base64 runtime auth tokens by default", () => {
  const token = generateRuntimeAuthToken();

  assert.equal(
    Buffer.from(token, "base64").byteLength,
    RUNTIME_AUTH_TOKEN_BYTES,
  );
  assert.doesNotMatch(token, /\s/u);
});

test("builds runtime sidecar args with desktop-owned OS selected port", () => {
  assert.deepEqual(buildRuntimeSidecarArgs(["--dev"]), [
    "--dev",
    RUNTIME_HTTP_PORT_ARG,
  ]);
  assert.throws(
    () => buildRuntimeSidecarArgs(["--http-port", "8080"]),
    /owns --http-port=0/u,
  );
  assert.throws(
    () => buildRuntimeSidecarArgs(["--http-port=8080"]),
    /owns --http-port=0/u,
  );
});

test("injects runtime auth token without mutating the base environment", () => {
  const baseEnv: NodeJS.ProcessEnv = { PATH: "C:\\runtime" };
  const env = buildRuntimeSidecarEnvironment(baseEnv, "token_abc123");

  assert.equal(env[RUNTIME_AUTH_TOKEN_ENV], "token_abc123");
  assert.equal(baseEnv[RUNTIME_AUTH_TOKEN_ENV], undefined);
  assert.throws(
    () => buildRuntimeSidecarEnvironment(baseEnv, "token abc"),
    /Runtime auth token/u,
  );
});

test("starts a runtime sidecar with token env and resolves on READY", async () => {
  const fake = new FakeSidecarProcess();
  const captured: {
    args?: readonly string[];
    options?: RuntimeSidecarSpawnOptions;
  } = {};
  const spawn: RuntimeSidecarSpawn = (_command, args, options) => {
    captured.args = args;
    captured.options = options;
    queueMicrotask(() => fake.stdout.write("runtime log\nREADY 51234\n"));
    return fake;
  };

  const session = await startRuntimeSidecar({
    command: "cw-runtime",
    args: ["--dev"],
    env: { PATH: "C:\\runtime" },
    readyTimeoutMs: 100,
    spawn,
    tokenFactory: () => "token_abc123",
  });

  assert.deepEqual(captured.args, ["--dev", RUNTIME_HTTP_PORT_ARG]);
  assert.equal(captured.options?.env[RUNTIME_AUTH_TOKEN_ENV], "token_abc123");
  assert.equal(captured.options?.windowsHide, true);
  assert.deepEqual(session.ready, {
    port: 51234,
    base_url: "http://127.0.0.1:51234/cw/v1",
    raw_line: "READY 51234",
  });
  assert.deepEqual(session.connection, {
    base_url: "http://127.0.0.1:51234/cw/v1",
    token: "token_abc123",
  });
  assert.equal(session.stop(), true);
  assert.deepEqual(fake.killedSignals, ["SIGTERM"]);
});

test("rejects unsafe token factories before spawning", async () => {
  let spawnCalled = false;
  const spawn: RuntimeSidecarSpawn = () => {
    spawnCalled = true;
    return new FakeSidecarProcess();
  };

  await assert.rejects(
    startRuntimeSidecar({
      command: "cw-runtime",
      spawn,
      tokenFactory: () => "token abc",
    }),
    /Runtime auth token/u,
  );
  assert.equal(spawnCalled, false);
});

test("kills the sidecar when READY is not emitted before timeout", async () => {
  const fake = new FakeSidecarProcess();
  const spawn: RuntimeSidecarSpawn = () => fake;

  await assert.rejects(
    startRuntimeSidecar({
      command: "cw-runtime",
      readyTimeoutMs: 5,
      spawn,
      tokenFactory: () => "token_abc123",
    }),
    /did not emit READY/u,
  );
  assert.deepEqual(fake.killedSignals, ["SIGTERM"]);
});

test("rejects when the sidecar exits before READY", async () => {
  const fake = new FakeSidecarProcess();
  const spawn: RuntimeSidecarSpawn = () => {
    queueMicrotask(() => fake.emit("exit", 2, null));
    return fake;
  };

  await assert.rejects(
    startRuntimeSidecar({
      command: "cw-runtime",
      readyTimeoutMs: 100,
      spawn,
      tokenFactory: () => "token_abc123",
    }),
    /exited before READY: exit code 2/u,
  );
  assert.deepEqual(fake.killedSignals, []);
});
