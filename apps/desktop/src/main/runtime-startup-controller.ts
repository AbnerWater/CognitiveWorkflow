import type { RuntimeIpcMainHandlers } from "../shared/runtime-ipc.js";
import type { RuntimeConnectionInfo } from "./runtime.js";
import {
  createRuntimeIpcMainHandlers,
  type RuntimeIpcMainHandlerOptions,
} from "./runtime-ipc-handlers.js";
import {
  DEFAULT_RUNTIME_CONNECTION_REGISTRY,
  type RuntimeConnectionRegistry,
} from "./runtime-connection-registry.js";
import {
  resolveRuntimeStartupLifecycle,
  type ResolveRuntimeStartupLifecycleOptions,
  type RuntimeStartupLifecycleDecision,
} from "./runtime-lifecycle.js";
import {
  startRuntimeOrchestration,
  type RuntimeOrchestrationLockOptions,
  type RuntimeOrchestrationShutdownOptions,
  type RuntimeOrchestrationSession,
  type StartRuntimeOrchestrationOptions,
} from "./runtime-orchestration.js";
import type { RuntimeSidecarSpawn } from "./sidecar.js";

export type RuntimeStartupLifecycleResolver = (
  options: ResolveRuntimeStartupLifecycleOptions,
) => Promise<RuntimeStartupLifecycleDecision>;

export type RuntimeOrchestrationStarter = (
  options: StartRuntimeOrchestrationOptions,
) => Promise<RuntimeOrchestrationSession>;

export interface RuntimeStartupControllerLifecycleOptions extends Omit<
  ResolveRuntimeStartupLifecycleOptions,
  "projectRoot" | "connectionInfo"
> {}

export interface StartRuntimeWithLifecycleOptions {
  readonly projectRoot: string;
  readonly command: StartRuntimeOrchestrationOptions["command"];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly readyTimeoutMs?: number;
  readonly spawn?: RuntimeSidecarSpawn;
  readonly tokenFactory?: () => string;
  readonly fetchImpl?: RuntimeIpcMainHandlerOptions["fetchImpl"];
  readonly connectionRegistry?: RuntimeConnectionRegistry;
  readonly lock?: RuntimeOrchestrationLockOptions;
  readonly shutdown?: RuntimeOrchestrationShutdownOptions;
  readonly lifecycle?: RuntimeStartupControllerLifecycleOptions;
  readonly lifecycleResolver?: RuntimeStartupLifecycleResolver;
  readonly orchestrationStarter?: RuntimeOrchestrationStarter;
}

export type RuntimeStartupControllerResult =
  | {
      readonly action: "started_sidecar";
      readonly lifecycle: RuntimeStartupStartDecision;
      readonly session: RuntimeOrchestrationSession;
      readonly handlers: RuntimeIpcMainHandlers;
      readonly closed: Promise<void>;
      stop(signal?: NodeJS.Signals): Promise<boolean>;
    }
  | {
      readonly action: "reused_existing";
      readonly lifecycle: RuntimeStartupReuseDecision;
      readonly handlers: RuntimeIpcMainHandlers;
      readonly closed: Promise<void>;
      stop(signal?: NodeJS.Signals): Promise<boolean>;
    }
  | {
      readonly action: "blocked";
      readonly lifecycle: RuntimeStartupBlockedDecision;
      readonly reason: string;
    }
  | {
      readonly action: "timed_out";
      readonly lifecycle: RuntimeStartupTimeoutDecision;
      readonly reason: string;
    };

export type RuntimeStartupStartDecision = Extract<
  RuntimeStartupLifecycleDecision,
  { readonly action: "start_sidecar" | "cleanup_then_start" }
>;
export type RuntimeStartupReuseDecision = Extract<
  RuntimeStartupLifecycleDecision,
  { readonly action: "reuse_existing" }
>;
export type RuntimeStartupBlockedDecision = Extract<
  RuntimeStartupLifecycleDecision,
  { readonly action: "block_startup" }
>;
export type RuntimeStartupTimeoutDecision = Extract<
  RuntimeStartupLifecycleDecision,
  { readonly action: "timeout_waiting_for_existing" }
>;

export async function startRuntimeWithLifecycle(
  options: StartRuntimeWithLifecycleOptions,
): Promise<RuntimeStartupControllerResult> {
  const connectionRegistry =
    options.connectionRegistry ?? DEFAULT_RUNTIME_CONNECTION_REGISTRY;
  const lifecycleResolver =
    options.lifecycleResolver ?? resolveRuntimeStartupLifecycle;
  const lifecycle = await lifecycleResolver({
    ...(options.lifecycle ?? {}),
    projectRoot: options.projectRoot,
    connectionInfo: connectionRegistry.resolver(options.projectRoot),
  });

  switch (lifecycle.action) {
    case "start_sidecar":
    case "cleanup_then_start":
      return startOwnedRuntime(options, connectionRegistry, lifecycle);
    case "reuse_existing":
      return reuseExistingRuntime(options, lifecycle);
    case "block_startup":
      return {
        action: "blocked",
        lifecycle,
        reason: lifecycle.reason,
      };
    case "timeout_waiting_for_existing":
      return {
        action: "timed_out",
        lifecycle,
        reason: lifecycle.reason,
      };
  }
}

async function startOwnedRuntime(
  options: StartRuntimeWithLifecycleOptions,
  connectionRegistry: RuntimeConnectionRegistry,
  lifecycle: RuntimeStartupStartDecision,
): Promise<RuntimeStartupControllerResult> {
  const orchestrationStarter =
    options.orchestrationStarter ?? startRuntimeOrchestration;
  const session = await orchestrationStarter({
    projectRoot: options.projectRoot,
    command: options.command,
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.readyTimeoutMs !== undefined
      ? { readyTimeoutMs: options.readyTimeoutMs }
      : {}),
    ...(options.spawn !== undefined ? { spawn: options.spawn } : {}),
    ...(options.tokenFactory !== undefined
      ? { tokenFactory: options.tokenFactory }
      : {}),
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
    connectionRegistry,
    ...(options.lock !== undefined ? { lock: options.lock } : {}),
    ...(options.shutdown !== undefined ? { shutdown: options.shutdown } : {}),
  });

  return {
    action: "started_sidecar",
    lifecycle,
    session,
    handlers: session.handlers,
    closed: session.closed,
    stop: (signal?: NodeJS.Signals): Promise<boolean> => session.stop(signal),
  };
}

function reuseExistingRuntime(
  options: StartRuntimeWithLifecycleOptions,
  lifecycle: RuntimeStartupReuseDecision,
): RuntimeStartupControllerResult {
  const connection = extractReuseConnection(lifecycle);
  const handlers = createRuntimeIpcMainHandlers({
    connectionInfo: () => connection,
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
  });

  return {
    action: "reused_existing",
    lifecycle,
    handlers,
    closed: Promise.resolve(),
    stop: async (): Promise<boolean> => false,
  };
}

function extractReuseConnection(
  lifecycle: RuntimeStartupReuseDecision,
): RuntimeConnectionInfo {
  if (lifecycle.handoff.action !== "reuse_existing") {
    throw new Error(
      "Runtime startup reuse decision must include a reusable connection handoff",
    );
  }

  return lifecycle.handoff.connection;
}
