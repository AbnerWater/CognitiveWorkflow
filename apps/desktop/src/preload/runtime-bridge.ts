import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  parseRuntimeIpcFetchRequestPayload,
  type RuntimeIpcChannel,
  type RuntimeIpcShutdownStatusResponse,
  type RuntimeIpcStartupStatusResponse,
} from "../shared/runtime-ipc.js";
import type {
  RuntimeBridge,
  RuntimeConnectionInfo,
  RuntimeRequestInit,
  RuntimeRequestPath,
  RuntimeResponse,
  RuntimeShutdownStatus,
  RuntimeShutdownStatusUnsubscribe,
  RuntimeStartupStatus,
  RuntimeStartupStatusUnsubscribe,
} from "./contract.js";

export type RuntimePreloadIpcInvoke = <TResult>(
  channel: RuntimeIpcChannel,
  payload?: unknown,
) => Promise<TResult>;

export type RuntimePreloadIpcPayloadListener = (payload: unknown) => void;

export type RuntimePreloadIpcSubscribe = (
  channel: RuntimeIpcChannel,
  listener: RuntimePreloadIpcPayloadListener,
) => RuntimeStartupStatusUnsubscribe;

export interface CreateRuntimePreloadBridgeOptions {
  readonly invoke: RuntimePreloadIpcInvoke;
  readonly subscribe: RuntimePreloadIpcSubscribe;
}

export function createRuntimePreloadBridge(
  options: CreateRuntimePreloadBridgeOptions,
): RuntimeBridge {
  return {
    startupStatus: async () => {
      const statuses = await options.invoke<RuntimeIpcStartupStatusResponse>(
        RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
      );
      return statuses.map((status) => ({
        ...status,
      })) satisfies readonly RuntimeStartupStatus[];
    },
    onStartupStatus: (listener) =>
      options.subscribe(RUNTIME_IPC_STARTUP_STATUS_CHANNEL, (payload) => {
        const statuses = cloneRuntimeStartupStatusPayload(payload);
        try {
          listener(statuses);
        } catch {
          // Renderer callbacks must not break the preload IPC listener chain.
        }
      }),
    shutdownStatus: async () => {
      const statuses = await options.invoke<RuntimeIpcShutdownStatusResponse>(
        RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
      );
      return statuses.map((status) => ({
        ...status,
      })) satisfies readonly RuntimeShutdownStatus[];
    },
    onShutdownStatus: (listener) =>
      options.subscribe(RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL, (payload) => {
        const statuses = cloneRuntimeShutdownStatusPayload(payload);
        try {
          listener(statuses);
        } catch {
          // Renderer callbacks must not break the preload IPC listener chain.
        }
      }),
    connectionInfo: () =>
      options.invoke<RuntimeConnectionInfo>(
        RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
      ),
    fetch: async <TBody = unknown>(
      path: RuntimeRequestPath,
      init?: RuntimeRequestInit,
    ): Promise<RuntimeResponse<TBody>> =>
      options.invoke<RuntimeResponse<TBody>>(
        RUNTIME_IPC_FETCH_CHANNEL,
        parseRuntimeIpcFetchRequestPayload(
          init === undefined ? { path } : { path, init },
        ),
      ),
  };
}

function cloneRuntimeStartupStatusPayload(
  payload: unknown,
): readonly RuntimeStartupStatus[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .filter(isRecord)
    .map((status) => ({ ...status }) as unknown as RuntimeStartupStatus);
}

function cloneRuntimeShutdownStatusPayload(
  payload: unknown,
): readonly RuntimeShutdownStatus[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .filter(isRecord)
    .map((status) => ({ ...status }) as unknown as RuntimeShutdownStatus);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
