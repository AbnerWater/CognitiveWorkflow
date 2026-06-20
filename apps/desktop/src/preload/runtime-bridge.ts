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
  RuntimeStartupStatus,
} from "./contract.js";

export type RuntimePreloadIpcInvoke = <TResult>(
  channel: RuntimeIpcChannel,
  payload?: unknown,
) => Promise<TResult>;

export interface CreateRuntimePreloadBridgeOptions {
  readonly invoke: RuntimePreloadIpcInvoke;
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
    shutdownStatus: async () => {
      const statuses = await options.invoke<RuntimeIpcShutdownStatusResponse>(
        RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
      );
      return statuses.map((status) => ({
        ...status,
      })) satisfies readonly RuntimeShutdownStatus[];
    },
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
