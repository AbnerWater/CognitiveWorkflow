import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { startCwDesktopElectronApp } from "./electron-app.js";
import type { StartRuntimeWithLifecycleOptions } from "./runtime-startup-controller.js";

const mainDistDir = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(
  mainDistDir,
  "..",
  "preload",
  "electron-preload.js",
);
const projectRoot = process.env["CW_PROJECT_ROOT"] ?? process.cwd();
const rendererDevServerUrl = process.env["CW_DESKTOP_RENDERER_URL"];

void startCwDesktopElectronApp({
  app,
  BrowserWindow,
  ipcMain,
  platform: process.platform,
  preloadPath,
  ...(rendererDevServerUrl !== undefined ? { rendererDevServerUrl } : {}),
  startup: buildElectronRuntimeStartupOptions(projectRoot),
  onError: reportElectronMainError,
}).catch((error: unknown) => {
  reportElectronMainError(error);
  app.quit();
});

function buildElectronRuntimeStartupOptions(
  projectRoot: string,
): StartRuntimeWithLifecycleOptions {
  const runtimeDevCommand = process.env["CW_RUNTIME_DEV_COMMAND"];
  return {
    projectRoot,
    cwd: projectRoot,
    command: {
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      ...buildElectronRuntimeDevCommand(runtimeDevCommand),
    },
  };
}

function buildElectronRuntimeDevCommand(
  runtimeDevCommand: string | undefined,
): Pick<StartRuntimeWithLifecycleOptions["command"], "devArgs" | "devCommand"> {
  if (runtimeDevCommand !== undefined) {
    return { devCommand: runtimeDevCommand };
  }
  if (app.isPackaged) {
    return {};
  }
  return {
    devCommand: "uv",
    devArgs: [
      "run",
      "--package",
      "cw_runtime",
      "--extra",
      "runtime",
      "cw-runtime",
    ],
  };
}

function reportElectronMainError(error: unknown): void {
  console.error(error);
}
