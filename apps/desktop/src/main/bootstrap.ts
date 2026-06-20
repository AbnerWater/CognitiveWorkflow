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
}

export interface InstallRuntimeIpcMainHandlersOptions extends CreateRuntimeIpcStartupHandlersOptions {
  readonly ipcMain: CwMainIpcMain;
}

export interface InstalledRuntimeIpcMainHandlers {
  readonly startupHandlers: RuntimeIpcStartupHandlers;
  readonly registeredChannels: readonly RuntimeIpcChannel[];
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

  return {
    startupHandlers,
    registeredChannels,
  };
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
