import type { RuntimeIpcChannel } from "../shared/runtime-ipc.js";
import { createCwDesktopApi, CW_PRELOAD_API_KEY } from "./api.js";
import type { CwDesktopApi } from "./contract.js";
import type {
  RuntimePreloadIpcInvoke,
  RuntimePreloadIpcPayloadListener,
  RuntimePreloadIpcSubscribe,
} from "./runtime-bridge.js";

export interface CwPreloadContextBridge {
  readonly exposeInMainWorld: (apiKey: string, api: CwDesktopApi) => void;
}

export interface CwPreloadIpcRenderer {
  readonly invoke: (
    channel: RuntimeIpcChannel,
    payload?: unknown,
  ) => Promise<unknown>;
  readonly on: (
    channel: RuntimeIpcChannel,
    listener: CwPreloadIpcRendererEventListener,
  ) => void;
  readonly off: (
    channel: RuntimeIpcChannel,
    listener: CwPreloadIpcRendererEventListener,
  ) => void;
}

export type CwPreloadIpcRendererEventListener = (
  event: unknown,
  payload?: unknown,
) => void;

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

export function createRuntimeIpcRendererSubscribe(
  ipcRenderer: CwPreloadIpcRenderer,
): RuntimePreloadIpcSubscribe {
  return (
    channel: RuntimeIpcChannel,
    listener: RuntimePreloadIpcPayloadListener,
  ) => {
    const wrappedListener: CwPreloadIpcRendererEventListener = (
      _event,
      payload,
    ) => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrappedListener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return false;
      }
      subscribed = false;
      ipcRenderer.off(channel, wrappedListener);
      return true;
    };
  };
}

export function installCwPreloadApi(
  options: InstallCwPreloadApiOptions,
): CwDesktopApi {
  const api = createCwDesktopApi({
    invoke: createRuntimeIpcRendererInvoke(options.ipcRenderer),
    subscribe: createRuntimeIpcRendererSubscribe(options.ipcRenderer),
  });
  options.contextBridge.exposeInMainWorld(CW_PRELOAD_API_KEY, api);
  return api;
}
