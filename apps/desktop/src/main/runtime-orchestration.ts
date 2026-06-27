import {
  resolveRuntimeCommand,
  type ResolveRuntimeCommandOptions,
  type RuntimeCommand,
} from "./runtime-command.js";
import {
  acquireRuntimeLock,
  type AcquireRuntimeLockOptions,
  type RuntimeLockLease,
} from "./runtime-lock.js";
import {
  startRuntimeSidecar,
  type RuntimeSidecarSession,
  type RuntimeSidecarSpawn,
} from "./sidecar.js";
import {
  createRuntimeIpcMainHandlers,
  requestRuntimeShutdown,
  type RuntimeIpcMainHandlerOptions,
} from "./runtime-ipc-handlers.js";
import {
  DEFAULT_RUNTIME_CONNECTION_REGISTRY,
  type RuntimeConnectionRegistry,
} from "./runtime-connection-registry.js";
import type { RuntimeIpcMainHandlers } from "../shared/runtime-ipc.js";

export const DEFAULT_RUNTIME_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2_000;

export type RuntimeOrchestrationShutdownSleep = (
  delayMs: number,
) => Promise<void>;

export type RuntimeOrchestrationShutdownRequest = (
  handlers: Pick<RuntimeIpcMainHandlers, "fetch">,
) => Promise<unknown>;

export interface RuntimeOrchestrationLockOptions extends Omit<
  AcquireRuntimeLockOptions,
  "projectRoot"
> {}

export interface RuntimeOrchestrationShutdownOptions {
  readonly timeoutMs?: number;
  readonly sleep?: RuntimeOrchestrationShutdownSleep;
  readonly request?: RuntimeOrchestrationShutdownRequest;
}

export interface StartRuntimeOrchestrationOptions {
  readonly projectRoot: string;
  readonly command: ResolveRuntimeCommandOptions;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly readyTimeoutMs?: number;
  readonly spawn?: RuntimeSidecarSpawn;
  readonly tokenFactory?: () => string;
  readonly fetchImpl?: RuntimeIpcMainHandlerOptions["fetchImpl"];
  readonly artifactOpenPath?: RuntimeIpcMainHandlerOptions["artifactOpenPath"];
  readonly artifactTempDir?: RuntimeIpcMainHandlerOptions["artifactTempDir"];
  readonly connectionRegistry?: RuntimeConnectionRegistry;
  readonly lock?: RuntimeOrchestrationLockOptions;
  readonly shutdown?: RuntimeOrchestrationShutdownOptions;
}

export interface RuntimeOrchestrationSession {
  readonly projectRoot: string;
  readonly command: RuntimeCommand;
  readonly lock: RuntimeLockLease;
  readonly sidecar: RuntimeSidecarSession;
  readonly handlers: RuntimeIpcMainHandlers;
  readonly closed: Promise<void>;
  stop(signal?: NodeJS.Signals): Promise<boolean>;
}

export async function startRuntimeOrchestration(
  options: StartRuntimeOrchestrationOptions,
): Promise<RuntimeOrchestrationSession> {
  const command = resolveRuntimeCommand(options.command);
  const lock = await acquireRuntimeLock({
    projectRoot: options.projectRoot,
    ...(options.lock ?? {}),
  });
  const connectionRegistry =
    options.connectionRegistry ?? DEFAULT_RUNTIME_CONNECTION_REGISTRY;

  let sidecar: RuntimeSidecarSession | undefined;
  try {
    sidecar = await startRuntimeSidecar({
      command: command.command,
      args: command.args,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.readyTimeoutMs !== undefined
        ? { readyTimeoutMs: options.readyTimeoutMs }
        : {}),
      ...(options.spawn !== undefined ? { spawn: options.spawn } : {}),
      ...(options.tokenFactory !== undefined
        ? { tokenFactory: options.tokenFactory }
        : {}),
    });
    connectionRegistry.register({
      projectRoot: options.projectRoot,
      connection: sidecar.connection,
    });
  } catch (error) {
    sidecar?.stop("SIGTERM");
    await releaseRuntimeLockAfterStartupFailure(lock, error);
    throw error;
  }

  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => sidecar.connection,
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
    ...(options.artifactOpenPath !== undefined
      ? { artifactOpenPath: options.artifactOpenPath }
      : {}),
    ...(options.artifactTempDir !== undefined
      ? { artifactTempDir: options.artifactTempDir }
      : {}),
  });

  let lockReleased = false;
  let connectionUnregistered = false;
  let stopped = false;
  let ownershipCleanup: Promise<void> | undefined;
  let resolveClosed: (() => void) | undefined;
  let rejectClosed: ((reason: unknown) => void) | undefined;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  closed.catch(() => undefined);

  const releaseLockOnce = async (): Promise<void> => {
    if (lockReleased) {
      return;
    }
    await lock.release();
    lockReleased = true;
  };
  const unregisterConnectionOnce = (): void => {
    if (connectionUnregistered) {
      return;
    }
    connectionRegistry.unregister(options.projectRoot, sidecar.connection);
    connectionUnregistered = true;
  };
  const cleanupRuntimeOwnership = (): Promise<void> => {
    if (ownershipCleanup !== undefined) {
      return ownershipCleanup;
    }

    ownershipCleanup = (async (): Promise<void> => {
      try {
        unregisterConnectionOnce();
        await releaseLockOnce();
        resolveClosed?.();
      } catch (error) {
        rejectClosed?.(error);
        throw error;
      }
    })();
    return ownershipCleanup;
  };
  const onSidecarClosed = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    void cleanupRuntimeOwnership().catch(() => undefined);
  };
  void sidecar.closed.then(onSidecarClosed);

  return {
    projectRoot: options.projectRoot,
    command,
    lock,
    sidecar,
    handlers,
    closed,
    stop: async (signal: NodeJS.Signals = "SIGTERM"): Promise<boolean> => {
      if (stopped) {
        return false;
      }
      stopped = true;
      if (
        await requestRuntimeGracefulShutdown({
          handlers,
          closed: sidecar.closed,
          ...(options.shutdown !== undefined
            ? { shutdown: options.shutdown }
            : {}),
        })
      ) {
        await cleanupRuntimeOwnership();
        return true;
      }
      const sidecarStopped = sidecar.stop(signal);
      await cleanupRuntimeOwnership();
      return sidecarStopped;
    },
  };
}

async function requestRuntimeGracefulShutdown(options: {
  readonly handlers: Pick<RuntimeIpcMainHandlers, "fetch">;
  readonly closed: Promise<unknown>;
  readonly shutdown?: RuntimeOrchestrationShutdownOptions;
}): Promise<boolean> {
  const shutdown = options.shutdown ?? {};
  const timeoutMs =
    shutdown.timeoutMs ?? DEFAULT_RUNTIME_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  assertPositiveInteger(timeoutMs, "runtime graceful shutdown timeoutMs");
  const sleep = shutdown.sleep ?? sleepMs;
  const request = shutdown.request ?? requestRuntimeShutdown;
  const response = await raceRuntimeShutdownTimeout(
    Promise.resolve().then(() => request(options.handlers)),
    timeoutMs,
    sleep,
  );
  if (response.timedOut || !isAcceptedRuntimeShutdownResponse(response.value)) {
    return false;
  }

  const closed = await raceRuntimeShutdownTimeout(
    options.closed,
    timeoutMs,
    sleep,
  );
  return !closed.timedOut;
}

async function raceRuntimeShutdownTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  sleep: RuntimeOrchestrationShutdownSleep,
): Promise<
  { readonly timedOut: false; readonly value: T } | { readonly timedOut: true }
> {
  let settled = false;
  const observed = promise.then(
    (value) => {
      settled = true;
      return { timedOut: false, value } as const;
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  const timedOut = sleep(timeoutMs).then(() => ({ timedOut: true }) as const);
  try {
    return await Promise.race([observed, timedOut]);
  } catch {
    return { timedOut: true };
  } finally {
    if (!settled) {
      promise.catch(() => undefined);
    }
  }
}

function isAcceptedRuntimeShutdownResponse(
  response: unknown,
): response is { readonly status: 202 } {
  return (
    typeof response === "object" &&
    response !== null &&
    "status" in response &&
    response.status === 202
  );
}

async function releaseRuntimeLockAfterStartupFailure(
  lock: RuntimeLockLease,
  cause: unknown,
): Promise<void> {
  try {
    await lock.release();
  } catch (releaseError) {
    throw new Error(
      `Runtime sidecar startup failed and runtime.lock release also failed: ${errorName(releaseError)}`,
      { cause },
    );
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.message : typeof error;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

async function sleepMs(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    timeout.unref();
  });
}
