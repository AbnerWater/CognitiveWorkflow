import path from "node:path";

import type { StartRuntimeWithLifecycleOptions } from "./runtime-startup-controller.js";

export const DEFAULT_UNPACKAGED_RUNTIME_DEV_ARGS = [
  "-m",
  "cw_runtime.cli",
] as const;

export interface BuildElectronRuntimeStartupOptionsInput {
  readonly projectRoot: string;
  readonly resourcesPath: string;
  readonly workspaceRoot: string;
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly runtimeDevCommand?: string;
}

export function buildElectronRuntimeStartupOptions(
  input: BuildElectronRuntimeStartupOptionsInput,
): StartRuntimeWithLifecycleOptions {
  return {
    projectRoot: input.projectRoot,
    cwd: input.projectRoot,
    command: {
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
      resourcesPath: input.resourcesPath,
      ...buildElectronRuntimeDevCommand(input),
    },
  };
}

function buildElectronRuntimeDevCommand(
  input: BuildElectronRuntimeStartupOptionsInput,
): Pick<StartRuntimeWithLifecycleOptions["command"], "devArgs" | "devCommand"> {
  if (input.runtimeDevCommand !== undefined) {
    return { devCommand: input.runtimeDevCommand };
  }
  if (input.isPackaged) {
    return {};
  }
  return {
    devCommand: resolveUnpackagedRuntimePythonCommand(
      input.workspaceRoot,
      input.platform,
    ),
    devArgs: [...DEFAULT_UNPACKAGED_RUNTIME_DEV_ARGS],
  };
}

function resolveUnpackagedRuntimePythonCommand(
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32"
    ? platformPath.join(workspaceRoot, ".venv", "Scripts", "python.exe")
    : platformPath.join(workspaceRoot, ".venv", "bin", "python");
}
