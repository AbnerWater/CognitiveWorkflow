import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  parseRuntimeIpcFetchRequestPayload,
  type RuntimeIpcConnectionInfo,
  type RuntimeIpcFetchRequest,
  type RuntimeIpcMainHandlers,
  type RuntimeIpcResponse,
  type RuntimeIpcStartupStatusResponse,
} from "../shared/runtime-ipc.js";
import {
  startRuntimeWithLifecycle,
  type RuntimeStartupControllerResult,
  type StartRuntimeWithLifecycleOptions,
} from "./runtime-startup-controller.js";
import type { RuntimeStartupStatus } from "./runtime-startup-status.js";

export type RuntimeIpcStartupStatusObserver = (
  status: RuntimeStartupStatus,
) => void | Promise<void>;

export type RuntimeIpcMainChannelRegistration =
  | {
      readonly channel: typeof RUNTIME_IPC_CONNECTION_INFO_CHANNEL;
      readonly handle: () => Promise<RuntimeIpcConnectionInfo>;
    }
  | {
      readonly channel: typeof RUNTIME_IPC_FETCH_CHANNEL;
      readonly handle: (payload: unknown) => Promise<RuntimeIpcResponse>;
    }
  | {
      readonly channel: typeof RUNTIME_IPC_STARTUP_STATUS_CHANNEL;
      readonly handle: () => Promise<RuntimeIpcStartupStatusResponse>;
    };

export type RuntimeIpcStartupControllerStarter = (
  options: StartRuntimeWithLifecycleOptions,
) => Promise<RuntimeStartupControllerResult>;

export type RuntimeIpcStartupHandlerState =
  | "idle"
  | "starting"
  | "ready"
  | "unavailable"
  | "failed";

export interface RuntimeIpcStartupHandlerSnapshot {
  readonly state: RuntimeIpcStartupHandlerState;
  readonly action?: RuntimeStartupControllerResult["action"];
  readonly reason?: string;
}

export interface RuntimeIpcMainChannelRegistrationOptions {
  readonly startupStatus?: () =>
    | RuntimeIpcStartupStatusResponse
    | Promise<RuntimeIpcStartupStatusResponse>;
}

export interface CreateRuntimeIpcStartupHandlersOptions {
  readonly startup: StartRuntimeWithLifecycleOptions;
  readonly starter?: RuntimeIpcStartupControllerStarter;
  readonly onStatus?: RuntimeIpcStartupStatusObserver;
}

export interface RuntimeIpcStartupHandlers {
  readonly handlers: RuntimeIpcMainHandlers;
  readonly registrations: readonly RuntimeIpcMainChannelRegistration[];
  readonly getStartupResult: () => Promise<RuntimeStartupControllerResult>;
  readonly snapshot: () => RuntimeIpcStartupHandlerSnapshot;
  readonly statusHistory: () => readonly RuntimeStartupStatus[];
  readonly closed: () => Promise<void>;
  readonly stop: (signal?: NodeJS.Signals) => Promise<boolean>;
}

type RuntimeStartupReadyResult = Extract<
  RuntimeStartupControllerResult,
  { readonly action: "started_sidecar" | "reused_existing" }
>;

type RuntimeStartupUnavailableResult = Extract<
  RuntimeStartupControllerResult,
  { readonly action: "blocked" | "timed_out" }
>;

type RuntimeIpcStartupState =
  | { readonly state: "idle" }
  | {
      readonly state: "starting";
      readonly promise: Promise<RuntimeStartupControllerResult>;
    }
  | { readonly state: "ready"; readonly result: RuntimeStartupReadyResult }
  | {
      readonly state: "unavailable";
      readonly result: RuntimeStartupUnavailableResult;
    }
  | { readonly state: "failed"; readonly error: unknown };

export class RuntimeStartupUnavailableError extends Error {
  readonly result: RuntimeStartupUnavailableResult;

  constructor(result: RuntimeStartupUnavailableResult) {
    super(`Runtime startup ${result.action}: ${result.reason}`);
    this.name = "RuntimeStartupUnavailableError";
    this.result = result;
  }
}

export function createRuntimeIpcMainChannelRegistrations(
  handlers: RuntimeIpcMainHandlers,
  options?: RuntimeIpcMainChannelRegistrationOptions,
): readonly RuntimeIpcMainChannelRegistration[] {
  const registrations: RuntimeIpcMainChannelRegistration[] = [
    {
      channel: RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
      handle: () => handlers.connectionInfo(),
    },
    {
      channel: RUNTIME_IPC_FETCH_CHANNEL,
      handle: async (payload: unknown) =>
        handlers.fetch(parseRuntimeIpcFetchRequestPayload(payload)),
    },
  ];

  if (options?.startupStatus !== undefined) {
    registrations.push({
      channel: RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
      handle: async () => options.startupStatus?.() ?? [],
    });
  }

  return registrations;
}

export function createRuntimeIpcStartupHandlers(
  options: CreateRuntimeIpcStartupHandlersOptions,
): RuntimeIpcStartupHandlers {
  const starter = options.starter ?? startRuntimeWithLifecycle;
  const statusHistory: RuntimeStartupStatus[] = [];
  let state: RuntimeIpcStartupState = { state: "idle" };

  async function getStartupResult(): Promise<RuntimeStartupControllerResult> {
    switch (state.state) {
      case "idle": {
        const promise = starter(
          withRuntimeIpcStartupStatusObserver(
            options.startup,
            async (status) => {
              statusHistory.push(status);
              await options.onStatus?.(status);
            },
          ),
        );
        state = { state: "starting", promise };
        try {
          const result = await promise;
          if (isRuntimeStartupReadyResult(result)) {
            state = { state: "ready", result };
          } else {
            state = { state: "unavailable", result };
          }
          return result;
        } catch (error) {
          state = { state: "failed", error };
          throw error;
        }
      }
      case "starting":
        return state.promise;
      case "ready":
      case "unavailable":
        return state.result;
      case "failed":
        throw state.error;
    }
  }

  async function requireReadyResult(): Promise<RuntimeStartupReadyResult> {
    const result = await getStartupResult();
    if (!isRuntimeStartupReadyResult(result)) {
      throw new RuntimeStartupUnavailableError(result);
    }
    return result;
  }

  const handlers: RuntimeIpcMainHandlers = {
    connectionInfo: async () => {
      const result = await requireReadyResult();
      return result.handlers.connectionInfo();
    },
    fetch: async <TBody = unknown>(
      request: RuntimeIpcFetchRequest,
    ): Promise<RuntimeIpcResponse<TBody>> => {
      const result = await requireReadyResult();
      return result.handlers.fetch<TBody>(request);
    },
  };

  return {
    handlers,
    registrations: createRuntimeIpcMainChannelRegistrations(handlers, {
      startupStatus: () => statusHistory.slice(),
    }),
    getStartupResult,
    snapshot: () => snapshotRuntimeIpcStartupState(state),
    statusHistory: () => statusHistory.slice(),
    closed: async () => {
      const result = await getRuntimeStartupResultIfStarted(
        getStartupResult,
        state,
      );
      if (result !== undefined && isRuntimeStartupReadyResult(result)) {
        await result.closed;
      }
    },
    stop: async (signal?: NodeJS.Signals) => {
      const result = await getRuntimeStartupResultIfStarted(
        getStartupResult,
        state,
      );
      if (result === undefined || !isRuntimeStartupReadyResult(result)) {
        return false;
      }
      return result.stop(signal);
    },
  };
}

function withRuntimeIpcStartupStatusObserver(
  startup: StartRuntimeWithLifecycleOptions,
  onStatus: RuntimeIpcStartupStatusObserver,
): StartRuntimeWithLifecycleOptions {
  const existingLifecycle = startup.lifecycle;
  const existingOnStatus = existingLifecycle?.onStatus;

  return {
    ...startup,
    lifecycle: {
      ...(existingLifecycle ?? {}),
      onStatus: async (status) => {
        await onStatus(status);
        await existingOnStatus?.(status);
      },
    },
  };
}

function snapshotRuntimeIpcStartupState(
  state: RuntimeIpcStartupState,
): RuntimeIpcStartupHandlerSnapshot {
  switch (state.state) {
    case "idle":
    case "starting":
      return { state: state.state };
    case "ready":
    case "unavailable":
      return {
        state: state.state,
        action: state.result.action,
        ...("reason" in state.result ? { reason: state.result.reason } : {}),
      };
    case "failed":
      return {
        state: "failed",
        reason: errorName(state.error),
      };
  }
}

async function getRuntimeStartupResultIfStarted(
  getStartupResult: () => Promise<RuntimeStartupControllerResult>,
  state: RuntimeIpcStartupState,
): Promise<RuntimeStartupControllerResult | undefined> {
  switch (state.state) {
    case "idle":
    case "failed":
      return undefined;
    case "starting":
    case "ready":
    case "unavailable":
      return getStartupResult();
  }
}

function isRuntimeStartupReadyResult(
  result: RuntimeStartupControllerResult,
): result is RuntimeStartupReadyResult {
  return (
    result.action === "started_sidecar" || result.action === "reused_existing"
  );
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }
  return "Error";
}
