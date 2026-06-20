import fs from "node:fs";
import path from "node:path";

import type { RuntimeConnectionInfo } from "./runtime.js";
import type { RuntimeConnectionHandoffResolver } from "./runtime-handoff.js";
import { normalizeRuntimeConnectionInfo } from "./runtime-ipc-handlers.js";

export interface RuntimeConnectionRegistryEntry {
  readonly projectRoot: string;
  readonly connection: RuntimeConnectionInfo;
  readonly registeredAtMs: number;
}

export interface RuntimeConnectionRegistryRegisterOptions {
  readonly projectRoot: string;
  readonly connection: RuntimeConnectionInfo;
}

export type RuntimeConnectionRegistryProjectRootCaseSensitivity =
  | "case_sensitive"
  | "case_insensitive";

export type RuntimeConnectionRegistryProjectRootRealpathResolver = (
  projectRoot: string,
) => string | null | undefined;

export interface RuntimeConnectionRegistryOptions {
  readonly nowMs?: () => number;
  readonly projectRootCaseSensitivity?: RuntimeConnectionRegistryProjectRootCaseSensitivity;
  readonly projectRootRealpath?:
    | RuntimeConnectionRegistryProjectRootRealpathResolver
    | false;
}

export interface RuntimeConnectionRegistry {
  register(
    options: RuntimeConnectionRegistryRegisterOptions,
  ): RuntimeConnectionRegistryEntry;
  get(projectRoot: string): RuntimeConnectionInfo | null;
  resolver(projectRoot: string): RuntimeConnectionHandoffResolver;
  unregister(projectRoot: string, connection?: RuntimeConnectionInfo): boolean;
  snapshot(): readonly RuntimeConnectionRegistryEntry[];
  clear(): void;
}

export const DEFAULT_RUNTIME_CONNECTION_REGISTRY =
  createRuntimeConnectionRegistry();

export function createRuntimeConnectionRegistry(
  options: RuntimeConnectionRegistryOptions = {},
): RuntimeConnectionRegistry {
  const entries = new Map<string, RuntimeConnectionRegistryEntry>();
  const nowMs = options.nowMs ?? Date.now;
  const projectRootCaseSensitivity =
    options.projectRootCaseSensitivity ??
    (process.platform === "win32" ? "case_insensitive" : "case_sensitive");
  const projectRootRealpath =
    options.projectRootRealpath === undefined
      ? defaultProjectRootRealpath
      : options.projectRootRealpath;

  const get = (projectRoot: string): RuntimeConnectionInfo | null => {
    const entry = entries.get(
      normalizeProjectRoot(
        projectRoot,
        projectRootCaseSensitivity,
        projectRootRealpath,
      ).lookupKey,
    );
    return entry === undefined ? null : cloneConnection(entry.connection);
  };

  return {
    register: (
      registerOptions: RuntimeConnectionRegistryRegisterOptions,
    ): RuntimeConnectionRegistryEntry => {
      const projectRoot = normalizeProjectRoot(
        registerOptions.projectRoot,
        projectRootCaseSensitivity,
        projectRootRealpath,
      );
      const connection = normalizeRuntimeConnectionInfo(
        registerOptions.connection,
      );
      const entry = {
        projectRoot: projectRoot.displayPath,
        connection,
        registeredAtMs: nowMs(),
      };
      entries.set(projectRoot.lookupKey, entry);
      return cloneEntry(entry);
    },
    get,
    resolver:
      (projectRoot: string): RuntimeConnectionHandoffResolver =>
      () =>
        get(projectRoot),
    unregister: (
      projectRoot: string,
      connection?: RuntimeConnectionInfo,
    ): boolean => {
      const normalizedProjectRoot = normalizeProjectRoot(
        projectRoot,
        projectRootCaseSensitivity,
        projectRootRealpath,
      );
      const current = entries.get(normalizedProjectRoot.lookupKey);
      if (current === undefined) {
        return false;
      }

      if (
        connection !== undefined &&
        !runtimeConnectionsEqual(
          current.connection,
          normalizeRuntimeConnectionInfo(connection),
        )
      ) {
        return false;
      }

      return entries.delete(normalizedProjectRoot.lookupKey);
    },
    snapshot: (): readonly RuntimeConnectionRegistryEntry[] =>
      Array.from(entries.values(), cloneEntry),
    clear: (): void => {
      entries.clear();
    },
  };
}

interface NormalizedProjectRoot {
  readonly displayPath: string;
  readonly lookupKey: string;
}

function normalizeProjectRoot(
  projectRoot: string,
  caseSensitivity: RuntimeConnectionRegistryProjectRootCaseSensitivity,
  realpath: RuntimeConnectionRegistryProjectRootRealpathResolver | false,
): NormalizedProjectRoot {
  const trimmedProjectRoot = projectRoot.trim();
  if (trimmedProjectRoot.length === 0) {
    throw new Error(
      "Runtime connection registry projectRoot must be non-empty",
    );
  }

  const displayPath = path.resolve(trimmedProjectRoot);
  const canonicalPath = resolveProjectRootCanonicalPath(displayPath, realpath);
  const lookupKey =
    caseSensitivity === "case_insensitive"
      ? canonicalPath.toLowerCase()
      : canonicalPath;

  return { displayPath, lookupKey };
}

function resolveProjectRootCanonicalPath(
  displayPath: string,
  realpath: RuntimeConnectionRegistryProjectRootRealpathResolver | false,
): string {
  if (realpath === false) {
    return displayPath;
  }

  let realPath: string | null | undefined;
  try {
    realPath = realpath(displayPath);
  } catch {
    return displayPath;
  }

  if (realPath === null || realPath === undefined) {
    return displayPath;
  }

  const trimmedRealPath = realPath.trim();
  if (trimmedRealPath.length === 0) {
    throw new Error(
      "Runtime connection registry realpath must be non-empty when provided",
    );
  }

  return path.resolve(trimmedRealPath);
}

function cloneEntry(
  entry: RuntimeConnectionRegistryEntry,
): RuntimeConnectionRegistryEntry {
  return {
    projectRoot: entry.projectRoot,
    connection: cloneConnection(entry.connection),
    registeredAtMs: entry.registeredAtMs,
  };
}

function cloneConnection(
  connection: RuntimeConnectionInfo,
): RuntimeConnectionInfo {
  return {
    base_url: connection.base_url,
    token: connection.token,
  };
}

function runtimeConnectionsEqual(
  left: RuntimeConnectionInfo,
  right: RuntimeConnectionInfo,
): boolean {
  return left.base_url === right.base_url && left.token === right.token;
}

function defaultProjectRootRealpath(projectRoot: string): string | undefined {
  try {
    return fs.realpathSync.native(projectRoot);
  } catch {
    return undefined;
  }
}
