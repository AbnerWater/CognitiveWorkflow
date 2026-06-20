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

export interface RuntimeConnectionRegistryOptions {
  readonly nowMs?: () => number;
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

  const get = (projectRoot: string): RuntimeConnectionInfo | null => {
    const entry = entries.get(normalizeProjectRoot(projectRoot));
    return entry === undefined ? null : cloneConnection(entry.connection);
  };

  return {
    register: (
      registerOptions: RuntimeConnectionRegistryRegisterOptions,
    ): RuntimeConnectionRegistryEntry => {
      const projectRoot = normalizeProjectRoot(registerOptions.projectRoot);
      const connection = normalizeRuntimeConnectionInfo(
        registerOptions.connection,
      );
      const entry = {
        projectRoot,
        connection,
        registeredAtMs: nowMs(),
      };
      entries.set(projectRoot, entry);
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
      const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
      const current = entries.get(normalizedProjectRoot);
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

      return entries.delete(normalizedProjectRoot);
    },
    snapshot: (): readonly RuntimeConnectionRegistryEntry[] =>
      Array.from(entries.values(), cloneEntry),
    clear: (): void => {
      entries.clear();
    },
  };
}

function normalizeProjectRoot(projectRoot: string): string {
  const trimmedProjectRoot = projectRoot.trim();
  if (trimmedProjectRoot.length === 0) {
    throw new Error(
      "Runtime connection registry projectRoot must be non-empty",
    );
  }

  return path.resolve(trimmedProjectRoot);
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
