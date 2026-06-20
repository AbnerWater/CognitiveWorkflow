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
