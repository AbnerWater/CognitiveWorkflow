import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  RuntimeIpcChannel,
  RuntimeIpcShutdownStatusResponse,
  RuntimeIpcStartupStatusResponse,
} from "../shared/runtime-ipc.js";
import {
  buildContentSecurityPolicy,
  getDesktopWindowSecurity,
} from "./security.js";
import {
  createRuntimeMainLifecycleShutdownStatusBroadcaster,
  createRuntimeMainLifecycleShutdownWindowBroadcaster,
  createRuntimeMainLifecycleStartupStatusBroadcaster,
  createRuntimeMainLifecycleStartupWindowBroadcaster,
  installRuntimeMainWithLifecycleShutdown,
  type CwMainBeforeQuitListener,
  type CwMainIpcInvokeHandler,
  type CwMainWindowCloseListener,
  type InstalledRuntimeMainWithLifecycleShutdown,
} from "./bootstrap.js";
import type { RuntimeIpcStartupControllerStarter } from "./runtime-ipc-main-factory.js";
import type { StartRuntimeWithLifecycleOptions } from "./runtime-startup-controller.js";

export const DEFAULT_DESKTOP_RENDERER_INDEX = "index.html";
export const DEFAULT_DESKTOP_RENDERER_DIST_DIR = "dist-renderer";

export interface CwElectronIpcMain {
  readonly handle: (
    channel: RuntimeIpcChannel,
    listener: CwMainIpcInvokeHandler,
  ) => void;
  readonly removeHandler: (channel: RuntimeIpcChannel) => void;
}

export interface CwElectronApp {
  readonly whenReady: () => Promise<void>;
  readonly getAppPath: () => string;
  readonly isPackaged: boolean;
  on(event: "before-quit", listener: CwMainBeforeQuitListener): void;
  on(event: "activate" | "window-all-closed", listener: () => void): void;
  off(event: "before-quit", listener: CwMainBeforeQuitListener): void;
  readonly quit: () => void;
}

export interface CwElectronWebRequestHeadersReceivedDetails {
  readonly responseHeaders?: Record<string, string[] | string>;
}

export interface CwElectronWebRequestHeadersReceivedResponse {
  readonly responseHeaders: Record<string, string[] | string>;
}

export type CwElectronWebRequestHeadersReceivedCallback = (
  response: CwElectronWebRequestHeadersReceivedResponse,
) => void;

export type CwElectronWebRequestHeadersReceivedListener = (
  details: CwElectronWebRequestHeadersReceivedDetails,
  callback: CwElectronWebRequestHeadersReceivedCallback,
) => void;

export interface CwElectronWebRequest {
  readonly onHeadersReceived: (
    listener: CwElectronWebRequestHeadersReceivedListener,
  ) => void;
}

export interface CwElectronSession {
  readonly webRequest: CwElectronWebRequest;
}

export interface CwElectronWindowOpenHandlerResult {
  readonly action: "allow" | "deny";
}

export interface CwElectronNavigationEvent {
  readonly preventDefault: () => void;
}

export type CwElectronNavigationListener = (
  event: CwElectronNavigationEvent,
  url: string,
  isInPlace?: boolean,
  isMainFrame?: boolean,
  frameProcessId?: number,
  frameRoutingId?: number,
) => void;

export interface CwElectronWebContents {
  readonly session: CwElectronSession;
  readonly send: (
    channel: RuntimeIpcChannel,
    payload: RuntimeIpcStartupStatusResponse | RuntimeIpcShutdownStatusResponse,
  ) => void;
  readonly isDestroyed?: () => boolean;
  readonly setWindowOpenHandler?: (
    handler: () => CwElectronWindowOpenHandlerResult,
  ) => void;
  on(event: "will-navigate", listener: CwElectronNavigationListener): void;
  on(event: "will-redirect", listener: CwElectronNavigationListener): void;
  off(event: "will-navigate", listener: CwElectronNavigationListener): void;
  off(event: "will-redirect", listener: CwElectronNavigationListener): void;
}

export interface CwElectronBrowserWindow {
  readonly webContents: CwElectronWebContents;
  readonly loadURL: (url: string) => Promise<void>;
  readonly loadFile: (filePath: string) => Promise<void>;
  on(event: "close", listener: CwMainWindowCloseListener): void;
  on(event: "closed", listener: () => void): void;
  off(event: "close", listener: CwMainWindowCloseListener): void;
  off(event: "closed", listener: () => void): void;
  readonly close: () => void;
  readonly isDestroyed?: () => boolean;
}

export interface CwElectronBrowserWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly show: boolean;
  readonly title: string;
  readonly webPreferences: {
    readonly preload: string;
    readonly contextIsolation: true;
    readonly sandbox: true;
    readonly nodeIntegration: false;
    readonly webSecurity: true;
    readonly allowRunningInsecureContent: false;
  };
}

export interface CwElectronBrowserWindowConstructor {
  new (options: CwElectronBrowserWindowOptions): CwElectronBrowserWindow;
  readonly getAllWindows: () => readonly CwElectronBrowserWindow[];
}

export type DesktopRendererSource =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly filePath: string };

export interface ResolveDesktopRendererSourceOptions {
  readonly appPath: string;
  readonly rendererDevServerUrl?: string;
  readonly rendererDistDir?: string;
}

export interface CreateCwDesktopElectronWindowOptions {
  readonly app: Pick<CwElectronApp, "off" | "on" | "quit">;
  readonly BrowserWindow: CwElectronBrowserWindowConstructor;
  readonly ipcMain: CwElectronIpcMain;
  readonly preloadPath: string;
  readonly rendererSource: DesktopRendererSource;
  readonly startup: StartRuntimeWithLifecycleOptions;
  readonly starter?: RuntimeIpcStartupControllerStarter;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly allowDevLoopbackWebSocket?: boolean;
  readonly onClosed?: () => void;
  readonly onError?: (error: unknown) => void;
}

export interface CwDesktopElectronWindowSession {
  readonly window: CwElectronBrowserWindow;
  readonly runtime: InstalledRuntimeMainWithLifecycleShutdown;
  readonly rendererSource: DesktopRendererSource;
  readonly dispose: () => CwDesktopElectronWindowDisposeResult;
}

export interface CwDesktopElectronWindowDisposeResult {
  readonly ipcChannels: readonly RuntimeIpcChannel[];
  readonly lifecycle: ReturnType<
    InstalledRuntimeMainWithLifecycleShutdown["lifecycle"]["unregister"]
  >;
  readonly startupWindow: boolean;
  readonly shutdownWindow: boolean;
  readonly startupFanout: boolean;
  readonly shutdownFanout: boolean;
  readonly navigation: boolean;
  readonly closed: boolean;
}

export interface StartCwDesktopElectronAppOptions {
  readonly app: CwElectronApp;
  readonly BrowserWindow: CwElectronBrowserWindowConstructor;
  readonly ipcMain: CwElectronIpcMain;
  readonly platform: NodeJS.Platform;
  readonly preloadPath: string;
  readonly startup: StartRuntimeWithLifecycleOptions;
  readonly starter?: RuntimeIpcStartupControllerStarter;
  readonly rendererDevServerUrl?: string;
  readonly rendererDistDir?: string;
  readonly onError?: (error: unknown) => void;
}

export interface CwDesktopElectronAppSession {
  readonly getWindowSession: () => CwDesktopElectronWindowSession | null;
}

export function resolveDesktopRendererSource(
  options: ResolveDesktopRendererSourceOptions,
): DesktopRendererSource {
  if (options.rendererDevServerUrl !== undefined) {
    return {
      kind: "url",
      url: normalizeDesktopRendererDevServerUrl(options.rendererDevServerUrl),
    };
  }
  return {
    kind: "file",
    filePath: path.join(
      normalizePathSegment(options.appPath, "Electron app path"),
      options.rendererDistDir ?? DEFAULT_DESKTOP_RENDERER_DIST_DIR,
      DEFAULT_DESKTOP_RENDERER_INDEX,
    ),
  };
}

export function createCwDesktopElectronWindow(
  options: CreateCwDesktopElectronWindowOptions,
): CwDesktopElectronWindowSession {
  const window = new options.BrowserWindow({
    width: options.width ?? 1280,
    height: options.height ?? 800,
    minWidth: options.minWidth ?? 960,
    minHeight: options.minHeight ?? 640,
    show: true,
    title: options.title ?? "CognitiveWorkflow",
    webPreferences: {
      preload: normalizePathSegment(options.preloadPath, "Electron preload"),
      ...getDesktopWindowSecurity(),
    },
  });
  installDesktopWindowContentSecurityPolicy(
    window.webContents,
    options.allowDevLoopbackWebSocket === undefined
      ? {}
      : { allowDevLoopbackWebSocket: options.allowDevLoopbackWebSocket },
  );
  denyDesktopWindowOpen(window.webContents);
  const unregisterNavigationGuard = installDesktopWindowNavigationGuard(
    window.webContents,
    options.rendererSource,
  );

  const startupStatusBroadcaster =
    createRuntimeMainLifecycleStartupStatusBroadcaster({
      ...(options.onError !== undefined
        ? { onListenerError: options.onError }
        : {}),
    });
  const startupWindowBroadcaster =
    createRuntimeMainLifecycleStartupWindowBroadcaster({
      ...(options.onError !== undefined
        ? { onSendError: options.onError }
        : {}),
    });
  const shutdownStatusBroadcaster =
    createRuntimeMainLifecycleShutdownStatusBroadcaster({
      ...(options.onError !== undefined
        ? { onListenerError: options.onError }
        : {}),
    });
  const shutdownWindowBroadcaster =
    createRuntimeMainLifecycleShutdownWindowBroadcaster({
      ...(options.onError !== undefined
        ? { onSendError: options.onError }
        : {}),
    });

  const unregisterStartupFanout = startupStatusBroadcaster.subscribe(
    startupWindowBroadcaster.onStatus,
  );
  const unregisterShutdownFanout = shutdownStatusBroadcaster.subscribe(
    shutdownWindowBroadcaster.onStatus,
  );
  const unregisterStartupWindow =
    startupWindowBroadcaster.registerWindow(window);
  const unregisterShutdownWindow =
    shutdownWindowBroadcaster.registerWindow(window);

  const runtime = installRuntimeMainWithLifecycleShutdown({
    app: options.app,
    window,
    ipcMain: options.ipcMain,
    startup: options.startup,
    ...(options.starter !== undefined ? { starter: options.starter } : {}),
    onStatus: startupStatusBroadcaster.onStatus,
    onShutdownStatus: shutdownStatusBroadcaster.onStatus,
  });

  void runtime.ipc.startupHandlers.getStartupResult().catch((error) => {
    try {
      options.onError?.(error);
    } catch {
      // Startup diagnostics must not crash the main process.
    }
  });
  void loadDesktopRenderer(window, options.rendererSource).catch((error) => {
    try {
      options.onError?.(error);
    } catch {
      // Startup diagnostics must not crash the main process.
    }
  });

  let disposed = false;
  const closedListener = (): void => {
    dispose();
    try {
      options.onClosed?.();
    } catch {
      // Window-close diagnostics must not affect Electron lifecycle cleanup.
    }
  };
  window.on("closed", closedListener);

  const dispose = (): CwDesktopElectronWindowDisposeResult => {
    if (disposed) {
      return {
        ipcChannels: [],
        lifecycle: { app: false, window: false },
        startupWindow: false,
        shutdownWindow: false,
        startupFanout: false,
        shutdownFanout: false,
        navigation: false,
        closed: false,
      };
    }
    disposed = true;
    const ipcChannels = runtime.ipc.unregister();
    const lifecycle = runtime.lifecycle.unregister();
    const startupWindow = unregisterStartupWindow();
    const shutdownWindow = unregisterShutdownWindow();
    const startupFanout = unregisterStartupFanout();
    const shutdownFanout = unregisterShutdownFanout();
    const navigation = unregisterNavigationGuard();
    window.off("closed", closedListener);
    return {
      ipcChannels,
      lifecycle,
      startupWindow,
      shutdownWindow,
      startupFanout,
      shutdownFanout,
      navigation,
      closed: true,
    };
  };

  return {
    window,
    runtime,
    rendererSource: options.rendererSource,
    dispose,
  };
}

export async function startCwDesktopElectronApp(
  options: StartCwDesktopElectronAppOptions,
): Promise<CwDesktopElectronAppSession> {
  let windowSession: CwDesktopElectronWindowSession | null = null;
  const createWindow = (): CwDesktopElectronWindowSession => {
    windowSession?.dispose();
    let nextSession: CwDesktopElectronWindowSession | undefined;
    nextSession = createCwDesktopElectronWindow({
      app: options.app,
      BrowserWindow: options.BrowserWindow,
      ipcMain: options.ipcMain,
      preloadPath: options.preloadPath,
      rendererSource: resolveDesktopRendererSource({
        appPath: options.app.getAppPath(),
        ...(options.rendererDevServerUrl !== undefined
          ? { rendererDevServerUrl: options.rendererDevServerUrl }
          : {}),
        ...(options.rendererDistDir !== undefined
          ? { rendererDistDir: options.rendererDistDir }
          : {}),
      }),
      startup: options.startup,
      ...(options.starter !== undefined ? { starter: options.starter } : {}),
      allowDevLoopbackWebSocket: options.rendererDevServerUrl !== undefined,
      onClosed: () => {
        if (windowSession === nextSession) {
          windowSession = null;
        }
      },
      ...(options.onError !== undefined ? { onError: options.onError } : {}),
    });
    windowSession = nextSession;
    return windowSession;
  };

  await options.app.whenReady();
  createWindow();

  options.app.on("activate", () => {
    if (options.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  options.app.on("window-all-closed", () => {
    if (options.platform !== "darwin") {
      options.app.quit();
    }
  });

  return {
    getWindowSession: () => windowSession,
  };
}

export function installDesktopWindowContentSecurityPolicy(
  webContents: Pick<CwElectronWebContents, "session">,
  options: { readonly allowDevLoopbackWebSocket?: boolean } = {},
): void {
  const csp = buildContentSecurityPolicy({
    ...(options.allowDevLoopbackWebSocket !== undefined
      ? { allowDevLoopbackWebSocket: options.allowDevLoopbackWebSocket }
      : {}),
  });
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        "Content-Security-Policy": [csp],
      },
    });
  });
}

export function installDesktopWindowNavigationGuard(
  webContents: Pick<CwElectronWebContents, "off" | "on">,
  source: DesktopRendererSource,
): () => boolean {
  const listener: CwElectronNavigationListener = (event, url) => {
    if (!isDesktopRendererNavigationAllowed(source, url)) {
      event.preventDefault();
    }
  };
  webContents.on("will-navigate", listener);
  webContents.on("will-redirect", listener);
  let registered = true;
  return () => {
    if (!registered) {
      return false;
    }
    registered = false;
    webContents.off("will-navigate", listener);
    webContents.off("will-redirect", listener);
    return true;
  };
}

export function isDesktopRendererNavigationAllowed(
  source: DesktopRendererSource,
  nextUrl: string,
): boolean {
  if (nextUrl.trim() !== nextUrl || /[\r\n]/u.test(nextUrl)) {
    return false;
  }
  let parsedNextUrl: URL;
  try {
    parsedNextUrl = new URL(nextUrl);
  } catch {
    return false;
  }

  if (source.kind === "url") {
    const rendererUrl = new URL(source.url);
    return (
      parsedNextUrl.protocol === rendererUrl.protocol &&
      parsedNextUrl.hostname === rendererUrl.hostname &&
      parsedNextUrl.port === rendererUrl.port
    );
  }

  return parsedNextUrl.href === pathToFileURL(source.filePath).href;
}

export async function loadDesktopRenderer(
  window: Pick<CwElectronBrowserWindow, "loadFile" | "loadURL">,
  source: DesktopRendererSource,
): Promise<void> {
  switch (source.kind) {
    case "url":
      await window.loadURL(source.url);
      return;
    case "file":
      await window.loadFile(source.filePath);
      return;
  }
}

function denyDesktopWindowOpen(
  webContents: Pick<CwElectronWebContents, "setWindowOpenHandler">,
): void {
  webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
}

function normalizeDesktopRendererDevServerUrl(url: string): string {
  if (url.trim() !== url || /[\r\n]/u.test(url)) {
    throw new Error("Desktop renderer dev server URL must be a clean URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error("Desktop renderer dev server URL is invalid", {
      cause: error,
    });
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port.length === 0
  ) {
    throw new Error(
      "Desktop renderer dev server URL must be http://127.0.0.1:<port>",
    );
  }
  return parsed.toString();
}

function normalizePathSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || /[\r\n]/u.test(normalized)) {
    throw new Error(`${label} must be a non-empty path`);
  }
  return normalized;
}
