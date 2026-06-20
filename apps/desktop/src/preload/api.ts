import type { CwDesktopApi, RuntimeBridge } from "./contract.js";
import {
  createRuntimePreloadBridge,
  type RuntimePreloadIpcInvoke,
} from "./runtime-bridge.js";

export const CW_PRELOAD_API_KEY = "cw" as const;

export interface CreateCwDesktopApiOptions {
  readonly invoke: RuntimePreloadIpcInvoke;
}

export function createCwDesktopApi(
  options: CreateCwDesktopApiOptions,
): CwDesktopApi {
  return freezeCwDesktopApi({
    runtime: createRuntimePreloadBridge({ invoke: options.invoke }),
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
    connectionInfo: runtime.connectionInfo,
    fetch: runtime.fetch,
  });
}
