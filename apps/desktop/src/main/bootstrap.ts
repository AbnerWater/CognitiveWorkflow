import {
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  type RuntimeIpcChannel,
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

export function installRuntimeIpcMainHandlers(
  options: InstallRuntimeIpcMainHandlersOptions,
): InstalledRuntimeIpcMainHandlers {
  const startupHandlers = createRuntimeIpcStartupHandlers({
    startup: options.startup,
    ...(options.starter !== undefined ? { starter: options.starter } : {}),
    ...(options.onStatus !== undefined ? { onStatus: options.onStatus } : {}),
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

  return {
    startupHandlers,
    registeredChannels,
    unregister,
    shutdown: (signal?: NodeJS.Signals) => {
      shutdownPromise ??= shutdownRuntimeIpcMainHandlers({
        unregister,
        stop: startupHandlers.stop,
        ...(signal !== undefined ? { signal } : {}),
      });
      return shutdownPromise;
    },
  };
}

async function shutdownRuntimeIpcMainHandlers(options: {
  readonly unregister: () => readonly RuntimeIpcChannel[];
  readonly stop: (signal?: NodeJS.Signals) => Promise<boolean>;
  readonly signal?: NodeJS.Signals;
}): Promise<InstalledRuntimeIpcMainHandlersShutdownResult> {
  const unregisteredChannels = options.unregister();
  const runtimeStopped = await options.stop(options.signal);
  return { unregisteredChannels, runtimeStopped };
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
