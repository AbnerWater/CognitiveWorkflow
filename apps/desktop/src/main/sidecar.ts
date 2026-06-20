import {
  spawn as nodeSpawn,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  buildRuntimeConnectionInfo,
  normalizeRuntimeAuthToken,
  parseRuntimeReadyLine,
  type RuntimeConnectionInfo,
  type RuntimeReady,
} from "./runtime.js";

export const RUNTIME_AUTH_TOKEN_ENV = "CW_RUNTIME_AUTH_TOKEN" as const;
export const RUNTIME_HTTP_PORT_ARG = "--http-port=0" as const;
export const RUNTIME_AUTH_TOKEN_BYTES = 16;
export const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 15_000;

export interface RuntimeSidecarSpawnOptions {
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly windowsHide: true;
  readonly stdio: readonly ["ignore", "pipe", "pipe"];
}

export interface RuntimeSidecarProcess {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  off(event: "error", listener: (error: Error) => void): this;
  off(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export type RuntimeSidecarSpawn = (
  command: string,
  args: readonly string[],
  options: RuntimeSidecarSpawnOptions,
) => RuntimeSidecarProcess;

export interface StartRuntimeSidecarOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly readyTimeoutMs?: number;
  readonly spawn?: RuntimeSidecarSpawn;
  readonly tokenFactory?: () => string;
}

export interface RuntimeSidecarSession {
  readonly process: RuntimeSidecarProcess;
  readonly ready: RuntimeReady;
  readonly connection: RuntimeConnectionInfo;
  stop(signal?: NodeJS.Signals): boolean;
}

export function generateRuntimeAuthToken(
  byteLength = RUNTIME_AUTH_TOKEN_BYTES,
): string {
  if (!Number.isInteger(byteLength) || byteLength < RUNTIME_AUTH_TOKEN_BYTES) {
    throw new RangeError(
      `Runtime auth token must contain at least ${RUNTIME_AUTH_TOKEN_BYTES} random bytes`,
    );
  }

  return randomBytes(byteLength).toString("base64");
}

export function buildRuntimeSidecarArgs(
  args: readonly string[] = [],
): readonly string[] {
  if (
    args.some((arg) => arg === "--http-port" || arg.startsWith("--http-port="))
  ) {
    throw new Error(
      "Desktop main process owns --http-port=0 for runtime sidecar spawn",
    );
  }

  return [...args, RUNTIME_HTTP_PORT_ARG];
}

export function buildRuntimeSidecarEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  token: string,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    [RUNTIME_AUTH_TOKEN_ENV]: normalizeRuntimeAuthToken(token),
  };
}

export async function startRuntimeSidecar(
  options: StartRuntimeSidecarOptions,
): Promise<RuntimeSidecarSession> {
  if (options.command.trim().length === 0) {
    throw new Error("Runtime sidecar command must be non-empty");
  }

  const readyTimeoutMs =
    options.readyTimeoutMs ?? DEFAULT_RUNTIME_READY_TIMEOUT_MS;
  if (!Number.isInteger(readyTimeoutMs) || readyTimeoutMs <= 0) {
    throw new RangeError(
      "Runtime sidecar ready timeout must be a positive integer",
    );
  }

  const token = normalizeRuntimeAuthToken(
    options.tokenFactory === undefined
      ? generateRuntimeAuthToken()
      : options.tokenFactory(),
  );
  const args = buildRuntimeSidecarArgs(options.args);
  const env = buildRuntimeSidecarEnvironment(options.env ?? process.env, token);
  const spawnOptions = buildRuntimeSidecarSpawnOptions(env, options.cwd);
  const spawn = options.spawn ?? spawnRuntimeSidecarProcess;
  const processHandle = spawn(options.command, args, spawnOptions);

  return waitForRuntimeReady(processHandle, token, readyTimeoutMs);
}

function buildRuntimeSidecarSpawnOptions(
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
): RuntimeSidecarSpawnOptions {
  const options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    windowsHide: true;
    stdio: readonly ["ignore", "pipe", "pipe"];
  } = {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  };

  if (cwd !== undefined) {
    options.cwd = cwd;
  }

  return options;
}

function spawnRuntimeSidecarProcess(
  command: string,
  args: readonly string[],
  options: RuntimeSidecarSpawnOptions,
): RuntimeSidecarProcess {
  const spawnOptions: SpawnOptionsWithoutStdio = {
    env: options.env,
    windowsHide: options.windowsHide,
  };
  if (options.cwd !== undefined) {
    spawnOptions.cwd = options.cwd;
  }

  return nodeSpawn(command, [...args], {
    ...spawnOptions,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForRuntimeReady(
  processHandle: RuntimeSidecarProcess,
  token: string,
  readyTimeoutMs: number,
): Promise<RuntimeSidecarSession> {
  const stdout = processHandle.stdout;
  if (stdout === null) {
    processHandle.kill("SIGTERM");
    return Promise.reject(new Error("Runtime sidecar stdout pipe is required"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let pendingStdout = "";

    const cleanup = (): void => {
      clearTimeout(timeout);
      stdout.off("data", onStdoutData);
      processHandle.off("error", onError);
      processHandle.off("exit", onExit);
    };

    const fail = (error: Error, killProcess: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (killProcess) {
        processHandle.kill("SIGTERM");
      }
      reject(error);
    };

    const succeed = (ready: RuntimeReady): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        process: processHandle,
        ready,
        connection: buildRuntimeConnectionInfo(ready, token),
        stop: (signal: NodeJS.Signals = "SIGTERM") =>
          processHandle.kill(signal),
      });
    };

    const consumeLine = (line: string): void => {
      const ready = parseRuntimeReadyLine(line);
      if (ready !== null) {
        succeed(ready);
      }
    };

    const onStdoutData = (chunk: string | Buffer): void => {
      pendingStdout += chunk.toString();
      const lines = pendingStdout.split(/\r?\n/u);
      pendingStdout = lines.pop() ?? "";
      for (const line of lines) {
        consumeLine(line);
        if (settled) {
          return;
        }
      }
    };

    const onError = (error: Error): void => {
      fail(
        new Error(`Runtime sidecar failed before READY: ${error.name}`),
        false,
      );
    };

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      const reason =
        signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
      fail(new Error(`Runtime sidecar exited before READY: ${reason}`), false);
    };

    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Runtime sidecar did not emit READY within ${readyTimeoutMs}ms`,
        ),
        true,
      );
    }, readyTimeoutMs);

    stdout.on("data", onStdoutData);
    processHandle.once("error", onError);
    processHandle.once("exit", onExit);
  });
}
