import path from "node:path";

export const PACKAGED_RUNTIME_DIRNAME = "runtime" as const;
export const RUNTIME_EXECUTABLE_BASENAME = "cw-runtime" as const;

export type RuntimeCommandSource = "dev" | "packaged";
export type RuntimeExecutableExists = (filePath: string) => boolean;

export interface RuntimeCommand {
  readonly source: RuntimeCommandSource;
  readonly command: string;
  readonly args: readonly string[];
}

export interface ResolveRuntimeCommandOptions {
  readonly devCommand?: string;
  readonly devArgs?: readonly string[];
  readonly resourcesPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly exists?: RuntimeExecutableExists;
}

export function getRuntimeExecutableName(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? `${RUNTIME_EXECUTABLE_BASENAME}.exe`
    : RUNTIME_EXECUTABLE_BASENAME;
}

export function resolvePackagedRuntimePath(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(
    normalizeCommandValue(resourcesPath, "Electron resources path"),
    PACKAGED_RUNTIME_DIRNAME,
    getRuntimeExecutableName(platform),
  );
}

export function resolveRuntimeCommand(
  options: ResolveRuntimeCommandOptions,
): RuntimeCommand {
  const devCommand =
    options.devCommand === undefined
      ? null
      : normalizeCommandValue(options.devCommand, "Runtime dev command");
  if (devCommand !== null) {
    return {
      source: "dev",
      command: devCommand,
      args: [...(options.devArgs ?? [])],
    };
  }

  if (options.devArgs !== undefined && options.devArgs.length > 0) {
    throw new Error("Runtime dev args require a runtime dev command");
  }

  if (options.resourcesPath === undefined) {
    throw new Error("Electron resources path is required for packaged runtime");
  }

  const command = resolvePackagedRuntimePath(
    options.resourcesPath,
    options.platform ?? process.platform,
  );
  if (options.exists !== undefined && !options.exists(command)) {
    throw new Error(`Packaged runtime executable not found: ${command}`);
  }

  return {
    source: "packaged",
    command,
    args: [],
  };
}

function normalizeCommandValue(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} must not contain control characters`);
  }

  return normalized;
}
