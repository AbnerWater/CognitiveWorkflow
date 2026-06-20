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
  type RuntimeIpcMainHandlerOptions,
} from "./runtime-ipc-handlers.js";
import {
  DEFAULT_RUNTIME_CONNECTION_REGISTRY,
  type RuntimeConnectionRegistry,
} from "./runtime-connection-registry.js";
import type { RuntimeIpcMainHandlers } from "../shared/runtime-ipc.js";

export interface RuntimeOrchestrationLockOptions extends Omit<
  AcquireRuntimeLockOptions,
  "projectRoot"
> {}

export interface StartRuntimeOrchestrationOptions {
  readonly projectRoot: string;
  readonly command: ResolveRuntimeCommandOptions;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly readyTimeoutMs?: number;
  readonly spawn?: RuntimeSidecarSpawn;
  readonly tokenFactory?: () => string;
  readonly fetchImpl?: RuntimeIpcMainHandlerOptions["fetchImpl"];
  readonly connectionRegistry?: RuntimeConnectionRegistry;
  readonly lock?: RuntimeOrchestrationLockOptions;
}

export interface RuntimeOrchestrationSession {
  readonly projectRoot: string;
  readonly command: RuntimeCommand;
  readonly lock: RuntimeLockLease;
  readonly sidecar: RuntimeSidecarSession;
  readonly handlers: RuntimeIpcMainHandlers;
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
  });

  let lockReleased = false;
  let stopped = false;
  const releaseLockOnce = async (): Promise<void> => {
    if (lockReleased) {
      return;
    }
    await lock.release();
    lockReleased = true;
  };

  return {
    projectRoot: options.projectRoot,
    command,
    lock,
    sidecar,
    handlers,
    stop: async (signal: NodeJS.Signals = "SIGTERM"): Promise<boolean> => {
      if (stopped) {
        return false;
      }
      const sidecarStopped = sidecar.stop(signal);
      connectionRegistry.unregister(options.projectRoot, sidecar.connection);
      await releaseLockOnce();
      stopped = true;
      return sidecarStopped;
    },
  };
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
