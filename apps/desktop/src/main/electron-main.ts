import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { startCwDesktopElectronApp } from "./electron-app.js";
import { buildElectronRuntimeStartupOptions } from "./electron-runtime-startup-options.js";

const mainDistDir = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(
  mainDistDir,
  "..",
  "preload",
  "electron-preload.js",
);
const projectRoot = process.env["CW_PROJECT_ROOT"] ?? process.cwd();
const rendererDevServerUrl = process.env["CW_DESKTOP_RENDERER_URL"];
const workspaceRoot = path.resolve(mainDistDir, "..", "..", "..", "..");

void startCwDesktopElectronApp({
  app,
  BrowserWindow,
  ipcMain,
  platform: process.platform,
  preloadPath,
  ...(rendererDevServerUrl !== undefined ? { rendererDevServerUrl } : {}),
  startup: buildElectronRuntimeStartupOptions({
    projectRoot,
    resourcesPath: process.resourcesPath,
    workspaceRoot,
    isPackaged: app.isPackaged,
    platform: process.platform,
    ...(process.env["CW_RUNTIME_DEV_COMMAND"] !== undefined
      ? { runtimeDevCommand: process.env["CW_RUNTIME_DEV_COMMAND"] }
      : {}),
  }),
  onError: reportElectronMainError,
}).catch((error: unknown) => {
  reportElectronMainError(error);
  app.quit();
});

function reportElectronMainError(error: unknown): void {
  console.error(error);
}
