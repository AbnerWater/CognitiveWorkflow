import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  type RuntimeIpcChannel,
  type RuntimeIpcShutdownStatus,
  type RuntimeIpcShutdownStatusKind,
  type RuntimeIpcShutdownStatusSeverity,
} from "../shared/runtime-ipc.js";
import {
  createRuntimeIpcStartupHandlers,
  type CreateRuntimeIpcStartupHandlersOptions,
  type RuntimeIpcMainChannelRegistration,
  type RuntimeIpcStartupHandlers,
} from "./runtime-ipc-main-factory.js";

export type CwMainIpcInvokeHandler = (
  event: unknown,
  payload?: unknown,
) => Promise<unknown>;

export interface CwMainIpcMain {
  readonly handle: (
    channel: RuntimeIpcChannel,
    listener: CwMainIpcInvokeHandler,
  ) => void;
  readonly removeHandler: (channel: RuntimeIpcChannel) => void;
}

export interface CwMainBeforeQuitEvent {
  preventDefault(): void;
}

export type CwMainBeforeQuitListener = (event: CwMainBeforeQuitEvent) => void;

export interface CwMainApp {
  readonly on: (
    event: "before-quit",
    listener: CwMainBeforeQuitListener,
  ) => void;
  readonly off: (
    event: "before-quit",
    listener: CwMainBeforeQuitListener,
  ) => void;
  readonly quit: () => void;
}

export interface CwMainWindowCloseEvent {
  preventDefault(): void;
}

export type CwMainWindowCloseListener = (event: CwMainWindowCloseEvent) => void;

export interface CwMainWindow {
  readonly on: (event: "close", listener: CwMainWindowCloseListener) => void;
  readonly off: (event: "close", listener: CwMainWindowCloseListener) => void;
  readonly close: () => void;
}

export interface InstallRuntimeIpcMainHandlersOptions extends CreateRuntimeIpcStartupHandlersOptions {
  readonly ipcMain: CwMainIpcMain;
}

export interface InstalledRuntimeIpcMainHandlers {
  readonly startupHandlers: RuntimeIpcStartupHandlers;
  readonly registeredChannels: readonly RuntimeIpcChannel[];
  readonly unregister: () => readonly RuntimeIpcChannel[];
  readonly shutdown: (
    signal?: NodeJS.Signals,
  ) => Promise<InstalledRuntimeIpcMainHandlersShutdownResult>;
}

export interface InstalledRuntimeIpcMainHandlersShutdownResult {
  readonly unregisteredChannels: readonly RuntimeIpcChannel[];
  readonly runtimeStopped: boolean;
}

export interface InstallRuntimeMainWithLifecycleShutdownOptions extends Omit<
  InstallRuntimeIpcMainHandlersOptions,
  "shutdownStatus"
> {
  readonly app: CwMainApp;
  readonly window: CwMainWindow;
  readonly signal?: NodeJS.Signals;
  readonly onShutdownStatus?: RuntimeMainLifecycleShutdownStatusObserver;
}

export interface InstalledRuntimeMainWithLifecycleShutdown {
  readonly ipc: InstalledRuntimeIpcMainHandlers;
  readonly lifecycle: InstalledRuntimeMainLifecycleShutdown;
  readonly shutdownStatus: () => readonly RuntimeMainLifecycleShutdownStatus[];
}

export type RuntimeAppLifecycleShutdownState =
  | "registered"
  | "shutting_down"
  | "shutdown_complete"
  | "failed"
  | "unregistered";

export interface RuntimeAppLifecycleShutdownSnapshot {
  readonly state: RuntimeAppLifecycleShutdownState;
  readonly reason?: string;
}

export interface InstallRuntimeAppLifecycleShutdownOptions {
  readonly app: CwMainApp;
  readonly runtime: Pick<InstalledRuntimeIpcMainHandlers, "shutdown">;
  readonly signal?: NodeJS.Signals;
}

export interface InstalledRuntimeAppLifecycleShutdown {
  readonly unregister: () => boolean;
  readonly snapshot: () => RuntimeAppLifecycleShutdownSnapshot;
  readonly shutdown: () => Promise<
    InstalledRuntimeIpcMainHandlersShutdownResult | undefined
  >;
}

export type RuntimeWindowLifecycleShutdownState =
  RuntimeAppLifecycleShutdownState;

export type RuntimeWindowLifecycleShutdownSnapshot =
  RuntimeAppLifecycleShutdownSnapshot;

export interface InstallRuntimeWindowLifecycleShutdownOptions {
  readonly window: CwMainWindow;
  readonly runtime: Pick<InstalledRuntimeIpcMainHandlers, "shutdown">;
  readonly signal?: NodeJS.Signals;
}

export interface InstalledRuntimeWindowLifecycleShutdown {
  readonly unregister: () => boolean;
  readonly snapshot: () => RuntimeWindowLifecycleShutdownSnapshot;
  readonly shutdown: () => Promise<
    InstalledRuntimeIpcMainHandlersShutdownResult | undefined
  >;
}

export type RuntimeMainLifecycleShutdownState =
  RuntimeAppLifecycleShutdownState;

export type RuntimeMainLifecycleShutdownSnapshot =
  RuntimeAppLifecycleShutdownSnapshot;

export type RuntimeMainLifecycleShutdownStatusKind =
  RuntimeIpcShutdownStatusKind;

export type RuntimeMainLifecycleShutdownStatusSeverity =
  RuntimeIpcShutdownStatusSeverity;

export type RuntimeMainLifecycleShutdownStatus = RuntimeIpcShutdownStatus;

export type RuntimeMainLifecycleShutdownStatusObserver = (
  status: RuntimeMainLifecycleShutdownStatus,
) => void;

export type RuntimeMainLifecycleShutdownStatusBroadcastListener = (
  status: RuntimeMainLifecycleShutdownStatus,
) => void;

export type RuntimeMainLifecycleShutdownStatusBroadcastUnsubscribe =
  () => boolean;

export interface CreateRuntimeMainLifecycleShutdownStatusBroadcasterOptions {
  readonly onListenerError?: (error: unknown) => void;
}

export interface RuntimeMainLifecycleShutdownStatusBroadcaster {
  readonly onStatus: RuntimeMainLifecycleShutdownStatusObserver;
  readonly subscribe: (
    listener: RuntimeMainLifecycleShutdownStatusBroadcastListener,
  ) => RuntimeMainLifecycleShutdownStatusBroadcastUnsubscribe;
  readonly listenerCount: () => number;
}

export interface InstallRuntimeMainLifecycleShutdownOptions {
  readonly app: CwMainApp;
  readonly window: CwMainWindow;
  readonly runtime: Pick<InstalledRuntimeIpcMainHandlers, "shutdown">;
  readonly signal?: NodeJS.Signals;
  readonly onStatus?: RuntimeMainLifecycleShutdownStatusObserver;
}

export interface RuntimeMainLifecycleShutdownUnregisterResult {
  readonly app: boolean;
  readonly window: boolean;
}

export interface InstalledRuntimeMainLifecycleShutdown {
  readonly unregister: () => RuntimeMainLifecycleShutdownUnregisterResult;
  readonly snapshot: () => RuntimeMainLifecycleShutdownSnapshot;
  readonly statusHistory: () => readonly RuntimeMainLifecycleShutdownStatus[];
  readonly shutdown: () => Promise<
    InstalledRuntimeIpcMainHandlersShutdownResult | undefined
  >;
}

export function installRuntimeIpcMainHandlers(
  options: InstallRuntimeIpcMainHandlersOptions,
): InstalledRuntimeIpcMainHandlers {
  const startupHandlers = createRuntimeIpcStartupHandlers({
    startup: options.startup,
    ...(options.starter !== undefined ? { starter: options.starter } : {}),
    ...(options.onStatus !== undefined ? { onStatus: options.onStatus } : {}),
    ...(options.shutdownStatus !== undefined
      ? { shutdownStatus: options.shutdownStatus }
      : {}),
  });
  const registeredChannels = registerRuntimeIpcMainChannelRegistrations(
    options.ipcMain,
    startupHandlers.registrations,
  );
  let unregistered = false;
  let shutdownPromise:
    | Promise<InstalledRuntimeIpcMainHandlersShutdownResult>
    | undefined;

  const unregister = (): readonly RuntimeIpcChannel[] => {
    if (unregistered) {
      return [];
    }
    unregistered = true;
    return unregisterRuntimeIpcMainChannels(
      options.ipcMain,
      registeredChannels,
    );
  };
  const unregisterForShutdown = (): RuntimeIpcMainShutdownUnregisterPlan => {
    if (unregistered) {
      return {
        beforeStop: [],
        afterStop: () => [],
      };
    }
    unregistered = true;
    const shutdownStatusChannels = registeredChannels.filter(
      (channel) => channel === RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
    );
    return {
      beforeStop: unregisterRuntimeIpcMainChannels(
        options.ipcMain,
        registeredChannels.filter(
          (channel) => channel !== RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
        ),
      ),
      afterStop: () =>
        unregisterRuntimeIpcMainChannels(
          options.ipcMain,
          shutdownStatusChannels,
        ),
    };
  };

  return {
    startupHandlers,
    registeredChannels,
    unregister,
    shutdown: (signal?: NodeJS.Signals) => {
      shutdownPromise ??= shutdownRuntimeIpcMainHandlers({
        unregisterForShutdown,
        stop: startupHandlers.stop,
        ...(signal !== undefined ? { signal } : {}),
      });
      return shutdownPromise;
    },
  };
}

interface RuntimeIpcMainShutdownUnregisterPlan {
  readonly beforeStop: readonly RuntimeIpcChannel[];
  readonly afterStop: () => readonly RuntimeIpcChannel[];
}

async function shutdownRuntimeIpcMainHandlers(options: {
  readonly unregisterForShutdown: () => RuntimeIpcMainShutdownUnregisterPlan;
  readonly stop: (signal?: NodeJS.Signals) => Promise<boolean>;
  readonly signal?: NodeJS.Signals;
}): Promise<InstalledRuntimeIpcMainHandlersShutdownResult> {
  const unregister = options.unregisterForShutdown();
  let runtimeStopped: boolean;
  try {
    runtimeStopped = await options.stop(options.signal);
  } catch (error) {
    unregister.afterStop();
    throw error;
  }
  const unregisteredAfterStop = unregister.afterStop();
  const unregisteredChannels = [
    ...unregister.beforeStop,
    ...unregisteredAfterStop,
  ];
  return { unregisteredChannels, runtimeStopped };
}

export function installRuntimeMainWithLifecycleShutdown(
  options: InstallRuntimeMainWithLifecycleShutdownOptions,
): InstalledRuntimeMainWithLifecycleShutdown {
  const { app, window, signal, onShutdownStatus, ...ipcOptions } = options;
  let lifecycle: InstalledRuntimeMainLifecycleShutdown | undefined;
  const shutdownStatus = (): readonly RuntimeMainLifecycleShutdownStatus[] =>
    lifecycle?.statusHistory() ?? [];
  const ipc = installRuntimeIpcMainHandlers({
    ...ipcOptions,
    shutdownStatus,
  });
  lifecycle = installRuntimeMainLifecycleShutdown({
    app,
    window,
    runtime: ipc,
    ...(signal !== undefined ? { signal } : {}),
    ...(onShutdownStatus !== undefined ? { onStatus: onShutdownStatus } : {}),
  });
  return {
    ipc,
    lifecycle,
    shutdownStatus,
  };
}

export function createRuntimeMainLifecycleShutdownStatusBroadcaster(
  options?: CreateRuntimeMainLifecycleShutdownStatusBroadcasterOptions,
): RuntimeMainLifecycleShutdownStatusBroadcaster {
  const listeners =
    new Set<RuntimeMainLifecycleShutdownStatusBroadcastListener>();

  const reportListenerError = (error: unknown): void => {
    try {
      options?.onListenerError?.(error);
    } catch {
      // Diagnostic hooks must not affect lifecycle status fan-out.
    }
  };

  return {
    onStatus: (status) => {
      const snapshot = [...listeners];
      for (const listener of snapshot) {
        try {
          listener({ ...status });
        } catch (error) {
          reportListenerError(error);
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        return listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
  };
}

export function installRuntimeAppLifecycleShutdown(
  options: InstallRuntimeAppLifecycleShutdownOptions,
): InstalledRuntimeAppLifecycleShutdown {
  let listenerRegistered = true;
  let state: RuntimeAppLifecycleShutdownState = "registered";
  let failureReason: string | undefined;
  let shutdownPromise:
    | Promise<InstalledRuntimeIpcMainHandlersShutdownResult>
    | undefined;

  const beforeQuitListener: CwMainBeforeQuitListener = (event) => {
    if (
      state === "shutdown_complete" ||
      state === "failed" ||
      state === "unregistered"
    ) {
      return;
    }

    event.preventDefault();
    shutdownPromise ??= shutdownRuntimeForAppLifecycle(options, (nextState) => {
      state = nextState.state;
      failureReason = nextState.reason;
    });
    shutdownPromise.catch(() => undefined);
  };

  options.app.on("before-quit", beforeQuitListener);

  return {
    unregister: () => {
      if (!listenerRegistered) {
        return false;
      }
      listenerRegistered = false;
      options.app.off("before-quit", beforeQuitListener);
      if (state === "registered") {
        state = "unregistered";
      }
      return true;
    },
    snapshot: () =>
      failureReason !== undefined
        ? { state, reason: failureReason }
        : { state },
    shutdown: () => shutdownPromise ?? Promise.resolve(undefined),
  };
}

async function shutdownRuntimeForAppLifecycle(
  options: InstallRuntimeAppLifecycleShutdownOptions,
  setState: (state: RuntimeAppLifecycleShutdownSnapshot) => void,
): Promise<InstalledRuntimeIpcMainHandlersShutdownResult> {
  setState({ state: "shutting_down" });
  try {
    const result = await options.runtime.shutdown(options.signal);
    setState({ state: "shutdown_complete" });
    options.app.quit();
    return result;
  } catch (error) {
    setState({ state: "failed", reason: errorName(error) });
    options.app.quit();
    throw error;
  }
}

export function installRuntimeWindowLifecycleShutdown(
  options: InstallRuntimeWindowLifecycleShutdownOptions,
): InstalledRuntimeWindowLifecycleShutdown {
  let listenerRegistered = true;
  let state: RuntimeWindowLifecycleShutdownState = "registered";
  let failureReason: string | undefined;
  let shutdownPromise:
    | Promise<InstalledRuntimeIpcMainHandlersShutdownResult>
    | undefined;

  const closeListener: CwMainWindowCloseListener = (event) => {
    if (
      state === "shutdown_complete" ||
      state === "failed" ||
      state === "unregistered"
    ) {
      return;
    }

    event.preventDefault();
    shutdownPromise ??= shutdownRuntimeForWindowLifecycle(
      options,
      (nextState) => {
        state = nextState.state;
        failureReason = nextState.reason;
      },
    );
    shutdownPromise.catch(() => undefined);
  };

  options.window.on("close", closeListener);

  return {
    unregister: () => {
      if (!listenerRegistered) {
        return false;
      }
      listenerRegistered = false;
      options.window.off("close", closeListener);
      if (state === "registered") {
        state = "unregistered";
      }
      return true;
    },
    snapshot: () =>
      failureReason !== undefined
        ? { state, reason: failureReason }
        : { state },
    shutdown: () => shutdownPromise ?? Promise.resolve(undefined),
  };
}

async function shutdownRuntimeForWindowLifecycle(
  options: InstallRuntimeWindowLifecycleShutdownOptions,
  setState: (state: RuntimeWindowLifecycleShutdownSnapshot) => void,
): Promise<InstalledRuntimeIpcMainHandlersShutdownResult> {
  setState({ state: "shutting_down" });
  try {
    const result = await options.runtime.shutdown(options.signal);
    setState({ state: "shutdown_complete" });
    options.window.close();
    return result;
  } catch (error) {
    setState({ state: "failed", reason: errorName(error) });
    options.window.close();
    throw error;
  }
}

export function installRuntimeMainLifecycleShutdown(
  options: InstallRuntimeMainLifecycleShutdownOptions,
): InstalledRuntimeMainLifecycleShutdown {
  let appListenerRegistered = true;
  let windowListenerRegistered = true;
  let state: RuntimeMainLifecycleShutdownState = "registered";
  let failureReason: string | undefined;
  let appQuitRequested = false;
  let windowCloseRequested = false;
  let shutdownPromise:
    | Promise<InstalledRuntimeIpcMainHandlersShutdownResult>
    | undefined;
  const statusHistory: RuntimeMainLifecycleShutdownStatus[] = [];

  const emitStatus = (kind: RuntimeMainLifecycleShutdownStatusKind): void => {
    const status = buildRuntimeMainLifecycleShutdownStatus({
      kind,
      state,
      appQuitRequested,
      windowCloseRequested,
      ...(failureReason !== undefined ? { reason: failureReason } : {}),
    });
    statusHistory.push(status);
    try {
      options.onStatus?.(status);
    } catch {
      // Status observers are diagnostic/broadcast hooks and must not block quit.
    }
  };

  const startShutdown = (): void => {
    shutdownPromise ??= shutdownRuntimeForMainLifecycle(
      options,
      () => ({
        appQuitRequested,
        windowCloseRequested,
      }),
      (nextState) => {
        state = nextState.state;
        failureReason = nextState.reason;
        emitStatus(mapMainLifecycleShutdownStateToStatusKind(state));
      },
    );
    shutdownPromise.catch(() => undefined);
  };

  const beforeQuitListener: CwMainBeforeQuitListener = (event) => {
    if (
      state === "shutdown_complete" ||
      state === "failed" ||
      state === "unregistered"
    ) {
      return;
    }

    event.preventDefault();
    appQuitRequested = true;
    emitStatus("app_quit_requested");
    startShutdown();
  };
  const closeListener: CwMainWindowCloseListener = (event) => {
    if (
      state === "shutdown_complete" ||
      state === "failed" ||
      state === "unregistered"
    ) {
      return;
    }

    event.preventDefault();
    windowCloseRequested = true;
    emitStatus("window_close_requested");
    startShutdown();
  };

  options.app.on("before-quit", beforeQuitListener);
  options.window.on("close", closeListener);
  emitStatus("registered");

  return {
    unregister: () => {
      const app = appListenerRegistered;
      const window = windowListenerRegistered;
      if (appListenerRegistered) {
        appListenerRegistered = false;
        options.app.off("before-quit", beforeQuitListener);
      }
      if (windowListenerRegistered) {
        windowListenerRegistered = false;
        options.window.off("close", closeListener);
      }
      if (state === "registered") {
        state = "unregistered";
        emitStatus("unregistered");
      }
      return { app, window };
    },
    snapshot: () =>
      failureReason !== undefined
        ? { state, reason: failureReason }
        : { state },
    statusHistory: () => [...statusHistory],
    shutdown: () => shutdownPromise ?? Promise.resolve(undefined),
  };
}

interface BuildRuntimeMainLifecycleShutdownStatusOptions {
  readonly kind: RuntimeMainLifecycleShutdownStatusKind;
  readonly state: RuntimeMainLifecycleShutdownState;
  readonly appQuitRequested: boolean;
  readonly windowCloseRequested: boolean;
  readonly reason?: string;
}

function buildRuntimeMainLifecycleShutdownStatus(
  options: BuildRuntimeMainLifecycleShutdownStatusOptions,
): RuntimeMainLifecycleShutdownStatus {
  return {
    kind: options.kind,
    state: options.state,
    severity: mainLifecycleShutdownStatusSeverity(options.kind),
    lifecycleComplete: isMainLifecycleShutdownTerminalState(options.state),
    retryable: options.state === "failed",
    appQuitRequested: options.appQuitRequested,
    windowCloseRequested: options.windowCloseRequested,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  };
}

function mapMainLifecycleShutdownStateToStatusKind(
  state: RuntimeMainLifecycleShutdownState,
): RuntimeMainLifecycleShutdownStatusKind {
  switch (state) {
    case "registered":
      return "registered";
    case "shutting_down":
      return "shutting_down";
    case "shutdown_complete":
      return "shutdown_complete";
    case "failed":
      return "shutdown_failed";
    case "unregistered":
      return "unregistered";
  }
}

function mainLifecycleShutdownStatusSeverity(
  kind: RuntimeMainLifecycleShutdownStatusKind,
): RuntimeMainLifecycleShutdownStatusSeverity {
  switch (kind) {
    case "shutdown_failed":
      return "error";
    case "unregistered":
      return "warning";
    case "registered":
    case "app_quit_requested":
    case "window_close_requested":
    case "shutting_down":
    case "shutdown_complete":
      return "info";
  }
}

function isMainLifecycleShutdownTerminalState(
  state: RuntimeMainLifecycleShutdownState,
): boolean {
  return (
    state === "shutdown_complete" ||
    state === "failed" ||
    state === "unregistered"
  );
}

async function shutdownRuntimeForMainLifecycle(
  options: InstallRuntimeMainLifecycleShutdownOptions,
  requestedFinalizers: () => {
    readonly appQuitRequested: boolean;
    readonly windowCloseRequested: boolean;
  },
  setState: (state: RuntimeMainLifecycleShutdownSnapshot) => void,
): Promise<InstalledRuntimeIpcMainHandlersShutdownResult> {
  setState({ state: "shutting_down" });
  try {
    const result = await options.runtime.shutdown(options.signal);
    setState({ state: "shutdown_complete" });
    runMainLifecycleFinalizers(options, requestedFinalizers());
    return result;
  } catch (error) {
    setState({ state: "failed", reason: errorName(error) });
    runMainLifecycleFinalizers(options, requestedFinalizers());
    throw error;
  }
}

function runMainLifecycleFinalizers(
  options: InstallRuntimeMainLifecycleShutdownOptions,
  requestedFinalizers: {
    readonly appQuitRequested: boolean;
    readonly windowCloseRequested: boolean;
  },
): void {
  if (requestedFinalizers.appQuitRequested) {
    options.app.quit();
  }
  if (requestedFinalizers.windowCloseRequested) {
    options.window.close();
  }
}

export function registerRuntimeIpcMainChannelRegistrations(
  ipcMain: CwMainIpcMain,
  registrations: readonly RuntimeIpcMainChannelRegistration[],
): readonly RuntimeIpcChannel[] {
  const registeredChannels: RuntimeIpcChannel[] = [];
  for (const registration of registrations) {
    ipcMain.handle(
      registration.channel,
      createRuntimeIpcMainInvokeHandler(registration),
    );
    registeredChannels.push(registration.channel);
  }
  return registeredChannels;
}

export function unregisterRuntimeIpcMainChannels(
  ipcMain: CwMainIpcMain,
  channels: readonly RuntimeIpcChannel[],
): readonly RuntimeIpcChannel[] {
  const unregisteredChannels: RuntimeIpcChannel[] = [];
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
    unregisteredChannels.push(channel);
  }
  return unregisteredChannels;
}

function createRuntimeIpcMainInvokeHandler(
  registration: RuntimeIpcMainChannelRegistration,
): CwMainIpcInvokeHandler {
  switch (registration.channel) {
    case RUNTIME_IPC_CONNECTION_INFO_CHANNEL:
      return async () => registration.handle();
    case RUNTIME_IPC_STARTUP_STATUS_CHANNEL:
      return async () => registration.handle();
    case RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL:
      return async () => registration.handle();
    case RUNTIME_IPC_FETCH_CHANNEL:
      return async (_event, payload) => registration.handle(payload);
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }
  return typeof error;
}
