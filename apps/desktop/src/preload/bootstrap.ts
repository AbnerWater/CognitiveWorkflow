import type { RuntimeIpcChannel } from "../shared/runtime-ipc.js";
import { createCwDesktopApi, CW_PRELOAD_API_KEY } from "./api.js";
import type { CwDesktopApi } from "./contract.js";
import type { RuntimePreloadIpcInvoke } from "./runtime-bridge.js";

export interface CwPreloadContextBridge {
  readonly exposeInMainWorld: (apiKey: string, api: CwDesktopApi) => void;
}

export interface CwPreloadIpcRenderer {
  readonly invoke: (
    channel: RuntimeIpcChannel,
    payload?: unknown,
  ) => Promise<unknown>;
}

export interface InstallCwPreloadApiOptions {
  readonly contextBridge: CwPreloadContextBridge;
  readonly ipcRenderer: CwPreloadIpcRenderer;
}

export function createRuntimeIpcRendererInvoke(
  ipcRenderer: CwPreloadIpcRenderer,
): RuntimePreloadIpcInvoke {
  return async <TResult>(
    channel: RuntimeIpcChannel,
    payload?: unknown,
  ): Promise<TResult> =>
    (await ipcRenderer.invoke(channel, payload)) as TResult;
}

export function installCwPreloadApi(
  options: InstallCwPreloadApiOptions,
): CwDesktopApi {
  const api = createCwDesktopApi({
    invoke: createRuntimeIpcRendererInvoke(options.ipcRenderer),
  });
  options.contextBridge.exposeInMainWorld(CW_PRELOAD_API_KEY, api);
  return api;
}
