import type { CwDesktopApi, RuntimeBridge } from "./contract.js";
import {
  createRuntimePreloadBridge,
  type RuntimePreloadIpcInvoke,
  type RuntimePreloadIpcSubscribe,
} from "./runtime-bridge.js";

export const CW_PRELOAD_API_KEY = "cw" as const;

export interface CreateCwDesktopApiOptions {
  readonly invoke: RuntimePreloadIpcInvoke;
  readonly subscribe: RuntimePreloadIpcSubscribe;
}

export function createCwDesktopApi(
  options: CreateCwDesktopApiOptions,
): CwDesktopApi {
  return freezeCwDesktopApi({
    runtime: createRuntimePreloadBridge({
      invoke: options.invoke,
      subscribe: options.subscribe,
    }),
  });
}

export function freezeCwDesktopApi(api: CwDesktopApi): CwDesktopApi {
  return Object.freeze({
    runtime: freezeRuntimeBridge(api.runtime),
  });
}

function freezeRuntimeBridge(runtime: RuntimeBridge): RuntimeBridge {
  return Object.freeze({
    startupStatus: runtime.startupStatus,
    shutdownStatus: runtime.shutdownStatus,
    onShutdownStatus: runtime.onShutdownStatus,
    connectionInfo: runtime.connectionInfo,
    fetch: runtime.fetch,
  });
}
