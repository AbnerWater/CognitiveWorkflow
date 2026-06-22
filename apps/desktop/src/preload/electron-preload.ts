import { contextBridge, ipcRenderer } from "electron";
import { installCwPreloadApi } from "./bootstrap.js";

installCwPreloadApi({ contextBridge, ipcRenderer });
