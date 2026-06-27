import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  RUNTIME_IPC_ARTIFACT_ACTION_CHANNEL,
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  type RuntimeIpcChannel,
  type RuntimeIpcMainHandlers,
  type RuntimeIpcShutdownStatusResponse,
  type RuntimeIpcStartupStatusResponse,
} from "../shared/runtime-ipc.js";
import type {
  CwMainBeforeQuitEvent,
  CwMainBeforeQuitListener,
  CwMainIpcInvokeHandler,
  CwMainWindowCloseListener,
} from "./bootstrap.js";
import {
  createCwDesktopElectronWindow,
  resolveDesktopRendererSource,
  startCwDesktopElectronApp,
  type CwElectronNavigationEvent,
  type CwElectronNavigationListener,
  type CwElectronApp,
  type CwElectronBrowserWindow,
  type CwElectronBrowserWindowConstructor,
  type CwElectronBrowserWindowOptions,
  type CwElectronWebRequestHeadersReceivedDetails,
  type CwElectronWebRequestHeadersReceivedListener,
  type CwElectronWindowOpenHandlerResult,
} from "./electron-app.js";
import type { RuntimeIpcStartupControllerStarter } from "./runtime-ipc-main-factory.js";
import type { StartRuntimeWithLifecycleOptions } from "./runtime-startup-controller.js";

test("resolves renderer dev URL only for explicit 127.0.0.1 origins", () => {
  assert.deepEqual(
    resolveDesktopRendererSource({
      appPath: path.join("C:", "CW", "desktop"),
      rendererDevServerUrl: "http://127.0.0.1:5173/",
    }),
    { kind: "url", url: "http://127.0.0.1:5173/" },
  );

  assert.throws(() =>
    resolveDesktopRendererSource({
      appPath: path.join("C:", "CW", "desktop"),
      rendererDevServerUrl: "http://localhost:5173/",
    }),
  );
  assert.throws(() =>
    resolveDesktopRendererSource({
      appPath: path.join("C:", "CW", "desktop"),
      rendererDevServerUrl: "https://127.0.0.1:5173/",
    }),
  );
  assert.throws(() =>
    resolveDesktopRendererSource({
      appPath: path.join("C:", "CW", "desktop"),
      rendererDevServerUrl: "http://127.0.0.1/",
    }),
  );
  assert.throws(() =>
    resolveDesktopRendererSource({
      appPath: path.join("C:", "CW", "desktop"),
      rendererDevServerUrl: "http://127.0.0.1:5173/\n",
    }),
  );
});

test("resolves packaged renderer file under app dist-renderer", () => {
  const appPath = path.join("C:", "CW", "desktop");

  assert.deepEqual(resolveDesktopRendererSource({ appPath }), {
    kind: "file",
    filePath: path.join(appPath, "dist-renderer", "index.html"),
  });
  assert.deepEqual(
    resolveDesktopRendererSource({
      appPath,
      rendererDistDir: "custom-renderer",
    }),
    {
      kind: "file",
      filePath: path.join(appPath, "custom-renderer", "index.html"),
    },
  );
  assert.throws(() => resolveDesktopRendererSource({ appPath: "  " }));
});

test("creates BrowserWindow with strict preload security and renderer wiring", async () => {
  FakeBrowserWindow.reset();
  const app = new FakeElectronApp(path.join("C:", "CW", "desktop"));
  const ipcMain = new FakeIpcMain();
  const starter = createFakeRuntimeStarter();
  const session = createCwDesktopElectronWindow({
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    preloadPath: path.join(
      "C:",
      "CW",
      "desktop",
      "dist",
      "preload",
      "electron-preload.js",
    ),
    rendererSource: { kind: "url", url: "http://127.0.0.1:5173/" },
    startup: createFakeRuntimeStartupOptions(),
    starter,
    allowDevLoopbackWebSocket: true,
  });
  await Promise.resolve();

  const window = FakeBrowserWindow.requireLast();
  assert.equal(session.window, window);
  assert.deepEqual(window.options.webPreferences, {
    preload: path.join(
      "C:",
      "CW",
      "desktop",
      "dist",
      "preload",
      "electron-preload.js",
    ),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });
  assert.deepEqual(window.loadedUrls, ["http://127.0.0.1:5173/"]);
  assert.deepEqual(window.loadedFiles, []);
  assert.deepEqual(window.webContents.openHandler?.(), { action: "deny" });
  assert.equal(starter.callCount(), 1);

  const cspResponse = window.webContents.webRequest.emitHeadersReceived({
    responseHeaders: { "X-Test": ["1"] },
  });
  assert.deepEqual(cspResponse.responseHeaders["X-Test"], ["1"]);
  assert.match(
    String(cspResponse.responseHeaders["Content-Security-Policy"]),
    /connect-src 'self' http:\/\/127\.0\.0\.1:\* ws:\/\/127\.0\.0\.1:\*/u,
  );

  assert.deepEqual(ipcMain.registeredChannels(), [
    RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
    RUNTIME_IPC_FETCH_CHANNEL,
    RUNTIME_IPC_ARTIFACT_ACTION_CHANNEL,
    RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
    RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  ]);
  assert.equal(app.beforeQuitListenerCount(), 1);
  assert.equal(window.closeListenerCount(), 1);
  assert.equal(window.closedListenerCount(), 1);
  assert.deepEqual(
    window.webContents.sent.map((event) => event.channel),
    [RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL, RUNTIME_IPC_STARTUP_STATUS_CHANNEL],
  );
  assert.equal(window.webContents.sent[1]?.payload[0]?.kind, "runtime_ready");

  assert.equal(
    window.webContents.emitNavigation(
      "will-navigate",
      "http://127.0.0.1:5173/workbench",
    ),
    false,
  );
  assert.equal(
    window.webContents.emitNavigation(
      "will-navigate",
      "https://example.invalid/",
    ),
    true,
  );
  assert.equal(
    window.webContents.emitNavigation(
      "will-redirect",
      "http://localhost:5173/",
    ),
    true,
  );

  assert.equal(
    window.webContents.sent[0]?.channel,
    RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  );

  const disposed = session.dispose();
  assert.deepEqual(disposed.ipcChannels, [
    RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
    RUNTIME_IPC_FETCH_CHANNEL,
    RUNTIME_IPC_ARTIFACT_ACTION_CHANNEL,
    RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
    RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  ]);
  assert.deepEqual(disposed.lifecycle, { app: true, window: true });
  assert.equal(disposed.startupWindow, true);
  assert.equal(disposed.shutdownWindow, true);
  assert.equal(disposed.startupFanout, true);
  assert.equal(disposed.shutdownFanout, true);
  assert.equal(disposed.navigation, true);
  assert.equal(disposed.closed, true);
  assert.deepEqual(ipcMain.registeredChannels(), []);
  assert.equal(app.beforeQuitListenerCount(), 0);
  assert.equal(window.closeListenerCount(), 0);
  assert.equal(window.closedListenerCount(), 0);
  assert.equal(
    window.webContents.emitNavigation(
      "will-navigate",
      "https://example.invalid/",
    ),
    false,
  );
  assert.equal(session.dispose().closed, false);
});

test("creates BrowserWindow against packaged renderer file", async () => {
  FakeBrowserWindow.reset();
  const app = new FakeElectronApp(path.join("C:", "CW", "desktop"));
  const starter = createFakeRuntimeStarter();
  createCwDesktopElectronWindow({
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: new FakeIpcMain(),
    preloadPath: path.join(
      "C:",
      "CW",
      "desktop",
      "dist",
      "preload",
      "electron-preload.js",
    ),
    rendererSource: {
      kind: "file",
      filePath: path.join("C:", "CW", "desktop", "dist-renderer", "index.html"),
    },
    startup: createFakeRuntimeStartupOptions(),
    starter,
  });
  await Promise.resolve();

  const window = FakeBrowserWindow.requireLast();
  assert.deepEqual(window.loadedUrls, []);
  assert.deepEqual(window.loadedFiles, [
    path.join("C:", "CW", "desktop", "dist-renderer", "index.html"),
  ]);
  assert.equal(starter.callCount(), 1);
  assert.equal(
    window.webContents.emitNavigation(
      "will-navigate",
      pathToFileUrl(
        path.join("C:", "CW", "desktop", "dist-renderer", "index.html"),
      ),
    ),
    false,
  );
  assert.equal(
    window.webContents.emitNavigation(
      "will-navigate",
      "https://example.invalid/",
    ),
    true,
  );
  const cspResponse = window.webContents.webRequest.emitHeadersReceived({});
  assert.doesNotMatch(
    String(cspResponse.responseHeaders["Content-Security-Policy"]),
    /ws:\/\/127\.0\.0\.1/u,
  );
});

test("starts Electron app, recreates windows on activate, and quits non-darwin", async () => {
  FakeBrowserWindow.reset();
  const app = new FakeElectronApp(path.join("C:", "CW", "desktop"));
  const starter = createFakeRuntimeStarter();
  const ipcMain = new FakeIpcMain();
  const session = await startCwDesktopElectronApp({
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    platform: "win32",
    preloadPath: path.join(
      "C:",
      "CW",
      "desktop",
      "dist",
      "preload",
      "electron-preload.js",
    ),
    startup: createFakeRuntimeStartupOptions(),
    starter,
  });
  await Promise.resolve();

  assert.notEqual(session.getWindowSession(), null);
  assert.equal(FakeBrowserWindow.getAllWindows().length, 1);
  assert.equal(ipcMain.registeredChannels().length, 5);
  assert.equal(starter.callCount(), 1);
  FakeBrowserWindow.requireLast().destroy();
  assert.equal(session.getWindowSession(), null);
  assert.deepEqual(ipcMain.registeredChannels(), []);
  app.emit("activate");
  await Promise.resolve();

  assert.equal(FakeBrowserWindow.getAllWindows().length, 1);
  assert.equal(FakeBrowserWindow.createdCount(), 2);
  assert.equal(ipcMain.registeredChannels().length, 5);
  assert.equal(starter.callCount(), 2);
  app.emit("window-all-closed");
  assert.equal(app.quitCount(), 1);
});

test("keeps macOS app alive when all windows are closed", async () => {
  FakeBrowserWindow.reset();
  const app = new FakeElectronApp(path.join("C:", "CW", "desktop"));
  await startCwDesktopElectronApp({
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: new FakeIpcMain(),
    platform: "darwin",
    preloadPath: path.join(
      "C:",
      "CW",
      "desktop",
      "dist",
      "preload",
      "electron-preload.js",
    ),
    startup: createFakeRuntimeStartupOptions(),
    starter: createFakeRuntimeStarter(),
  });

  app.emit("window-all-closed");
  assert.equal(app.quitCount(), 0);
});

function createFakeRuntimeStartupOptions(): StartRuntimeWithLifecycleOptions {
  return {
    projectRoot: path.join("C:", "CW", "project"),
    command: { devCommand: "cw-runtime" },
  };
}

interface FakeRuntimeStarter extends RuntimeIpcStartupControllerStarter {
  readonly callCount: () => number;
}

function createFakeRuntimeStarter(): FakeRuntimeStarter {
  let calls = 0;
  const connection = {
    base_url: "http://127.0.0.1:48123/cw/v1",
    token: "test-runtime-token",
  } as const;
  const handlers: RuntimeIpcMainHandlers = {
    connectionInfo: async () => connection,
    fetch: async <TBody = unknown>() => ({
      ok: true,
      status: 200,
      headers: {},
      body: {} as TBody,
    }),
  };
  const starter: RuntimeIpcStartupControllerStarter = async (options) => {
    calls += 1;
    await options.lifecycle?.onStatus?.({
      kind: "runtime_ready",
      action: "reuse_existing",
      attempt: 1,
      lockStatus: "active",
      severity: "info",
      message: "Runtime sidecar is ready.",
      lifecycleComplete: true,
      userActionRequired: false,
      retryable: false,
    });
    return {
      action: "reused_existing",
      lifecycle: {
        action: "reuse_existing",
        attempts: 1,
        handoff: {
          action: "reuse_existing",
          inspection: {
            status: "active",
            lockPath: path.join(
              "C:",
              "CW",
              "project",
              ".agent-workflow",
              "locks",
              "runtime.lock",
            ),
          },
          connection,
        },
      },
      handlers,
      closed: Promise.resolve(),
      stop: async () => false,
    };
  };
  return Object.assign(starter, { callCount: () => calls });
}

function pathToFileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}

class FakeIpcMain {
  private readonly handlers = new Map<
    RuntimeIpcChannel,
    CwMainIpcInvokeHandler
  >();

  handle(channel: RuntimeIpcChannel, listener: CwMainIpcInvokeHandler): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Duplicate IPC handler registration: ${channel}`);
    }
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: RuntimeIpcChannel): void {
    this.handlers.delete(channel);
  }

  registeredChannels(): readonly RuntimeIpcChannel[] {
    return [...this.handlers.keys()];
  }
}

class FakeElectronApp implements CwElectronApp {
  readonly isPackaged = false;
  private readonly activateListeners = new Set<() => void>();
  private readonly beforeQuitListeners = new Set<CwMainBeforeQuitListener>();
  private readonly windowAllClosedListeners = new Set<() => void>();
  private quitCalls = 0;

  constructor(private readonly appPath: string) {}

  async whenReady(): Promise<void> {
    await Promise.resolve();
  }

  getAppPath(): string {
    return this.appPath;
  }

  on(event: "before-quit", listener: CwMainBeforeQuitListener): void;
  on(event: "activate" | "window-all-closed", listener: () => void): void;
  on(
    event: "activate" | "before-quit" | "window-all-closed",
    listener: (() => void) | CwMainBeforeQuitListener,
  ): void {
    switch (event) {
      case "activate":
        this.activateListeners.add(listener as () => void);
        return;
      case "before-quit":
        this.beforeQuitListeners.add(listener as CwMainBeforeQuitListener);
        return;
      case "window-all-closed":
        this.windowAllClosedListeners.add(listener as () => void);
        return;
    }
  }

  off(event: "before-quit", listener: CwMainBeforeQuitListener): void {
    this.beforeQuitListeners.delete(listener);
  }

  quit(): void {
    this.quitCalls += 1;
  }

  emit(event: "activate" | "window-all-closed"): void {
    const listeners =
      event === "activate"
        ? this.activateListeners
        : this.windowAllClosedListeners;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  emitBeforeQuit(event: CwMainBeforeQuitEvent): void {
    for (const listener of [...this.beforeQuitListeners]) {
      listener(event);
    }
  }

  beforeQuitListenerCount(): number {
    return this.beforeQuitListeners.size;
  }

  quitCount(): number {
    return this.quitCalls;
  }
}

class FakeBrowserWindow implements CwElectronBrowserWindow {
  static readonly instances: FakeBrowserWindow[] = [];
  readonly loadedFiles: string[] = [];
  readonly loadedUrls: string[] = [];
  readonly webContents = new FakeWebContents();
  private readonly closeListeners = new Set<CwMainWindowCloseListener>();
  private readonly closedListeners = new Set<() => void>();
  private destroyed = false;

  constructor(readonly options: CwElectronBrowserWindowOptions) {
    FakeBrowserWindow.instances.push(this);
  }

  static reset(): void {
    FakeBrowserWindow.instances.length = 0;
  }

  static createdCount(): number {
    return FakeBrowserWindow.instances.length;
  }

  static getAllWindows(): readonly CwElectronBrowserWindow[] {
    return FakeBrowserWindow.instances.filter((window) => !window.destroyed);
  }

  static requireLast(): FakeBrowserWindow {
    const window = FakeBrowserWindow.instances.at(-1);
    if (window === undefined) {
      throw new Error("Expected a fake BrowserWindow instance");
    }
    return window;
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
  }

  async loadFile(filePath: string): Promise<void> {
    this.loadedFiles.push(filePath);
  }

  on(event: "close", listener: CwMainWindowCloseListener): void;
  on(event: "closed", listener: () => void): void;
  on(
    event: "close" | "closed",
    listener: CwMainWindowCloseListener | (() => void),
  ): void {
    if (event === "close") {
      this.closeListeners.add(listener as CwMainWindowCloseListener);
      return;
    }
    this.closedListeners.add(listener as () => void);
  }

  off(event: "close", listener: CwMainWindowCloseListener): void;
  off(event: "closed", listener: () => void): void;
  off(
    event: "close" | "closed",
    listener: CwMainWindowCloseListener | (() => void),
  ): void {
    if (event === "close") {
      this.closeListeners.delete(listener as CwMainWindowCloseListener);
      return;
    }
    this.closedListeners.delete(listener as () => void);
  }

  close(): void {
    for (const listener of [...this.closeListeners]) {
      listener({ preventDefault: () => undefined });
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const listener of [...this.closedListeners]) {
      listener();
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  closeListenerCount(): number {
    return this.closeListeners.size;
  }

  closedListenerCount(): number {
    return this.closedListeners.size;
  }
}

class FakeWebContents {
  readonly sent: Array<{
    readonly channel: RuntimeIpcChannel;
    readonly payload:
      | RuntimeIpcStartupStatusResponse
      | RuntimeIpcShutdownStatusResponse;
  }> = [];
  readonly session = { webRequest: new FakeWebRequest() };
  private readonly navigationListeners = new Map<
    "will-navigate" | "will-redirect",
    Set<CwElectronNavigationListener>
  >();
  openHandler: (() => CwElectronWindowOpenHandlerResult) | undefined;

  get webRequest(): FakeWebRequest {
    return this.session.webRequest;
  }

  send(
    channel: RuntimeIpcChannel,
    payload: RuntimeIpcStartupStatusResponse | RuntimeIpcShutdownStatusResponse,
  ): void {
    this.sent.push({ channel, payload });
  }

  setWindowOpenHandler(handler: () => CwElectronWindowOpenHandlerResult): void {
    this.openHandler = handler;
  }

  on(
    event: "will-navigate" | "will-redirect",
    listener: CwElectronNavigationListener,
  ): void {
    const listeners = this.navigationListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.navigationListeners.set(event, listeners);
  }

  off(
    event: "will-navigate" | "will-redirect",
    listener: CwElectronNavigationListener,
  ): void {
    this.navigationListeners.get(event)?.delete(listener);
  }

  emitNavigation(
    event: "will-navigate" | "will-redirect",
    url: string,
  ): boolean {
    let prevented = false;
    const navigationEvent: CwElectronNavigationEvent = {
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const listener of this.navigationListeners.get(event) ?? []) {
      listener(navigationEvent, url);
    }
    return prevented;
  }

  isDestroyed(): boolean {
    return false;
  }
}

class FakeWebRequest {
  private listener: CwElectronWebRequestHeadersReceivedListener | undefined;

  onHeadersReceived(
    listener: CwElectronWebRequestHeadersReceivedListener,
  ): void {
    this.listener = listener;
  }

  emitHeadersReceived(details: CwElectronWebRequestHeadersReceivedDetails): {
    readonly responseHeaders: Record<string, string[] | string>;
  } {
    if (this.listener === undefined) {
      throw new Error("Expected onHeadersReceived listener");
    }
    let response:
      | { readonly responseHeaders: Record<string, string[] | string> }
      | undefined;
    this.listener(details, (nextResponse) => {
      response = nextResponse;
    });
    if (response === undefined) {
      throw new Error("Expected onHeadersReceived callback");
    }
    return response;
  }
}

const _browserWindowConstructorCheck: CwElectronBrowserWindowConstructor =
  FakeBrowserWindow;
