import type { RuntimeConnectionInfo } from "./runtime.js";
import { normalizeRuntimeConnectionInfo } from "./runtime-ipc-handlers.js";
import {
  decideRuntimeLockAction,
  inspectRuntimeLock,
  type InspectRuntimeLockOptions,
  type RuntimeLockInspection,
} from "./runtime-lock.js";

export type RuntimeConnectionHandoffAction =
  | "start_sidecar"
  | "cleanup_then_start"
  | "reuse_existing"
  | "wait_for_existing"
  | "block_startup";

export type RuntimeConnectionHandoffResolver = (
  inspection: RuntimeLockInspection,
) =>
  | RuntimeConnectionInfo
  | null
  | undefined
  | Promise<RuntimeConnectionInfo | null | undefined>;

export interface ResolveRuntimeConnectionHandoffOptions extends InspectRuntimeLockOptions {
  readonly connectionInfo?: RuntimeConnectionHandoffResolver;
}

export type RuntimeConnectionHandoffDecision =
  | {
      readonly action: "start_sidecar" | "cleanup_then_start";
      readonly inspection: RuntimeLockInspection;
    }
  | {
      readonly action: "reuse_existing";
      readonly inspection: RuntimeLockInspection;
      readonly connection: RuntimeConnectionInfo;
    }
  | {
      readonly action: "wait_for_existing" | "block_startup";
      readonly inspection: RuntimeLockInspection;
      readonly reason: string;
    };

export async function resolveRuntimeConnectionHandoff(
  options: ResolveRuntimeConnectionHandoffOptions,
): Promise<RuntimeConnectionHandoffDecision> {
  const inspection = await inspectRuntimeLock(options);
  const lockAction = decideRuntimeLockAction(inspection);

  switch (lockAction) {
    case "start_sidecar":
    case "cleanup_then_start":
      return { action: lockAction, inspection };
    case "block_startup":
      return {
        action: "block_startup",
        inspection,
        reason: inspection.error ?? "runtime.lock is corrupt",
      };
    case "reuse_existing_or_wait":
      return resolveActiveRuntimeHandoff(inspection, options.connectionInfo);
  }
}

async function resolveActiveRuntimeHandoff(
  inspection: RuntimeLockInspection,
  connectionInfo: RuntimeConnectionHandoffResolver | undefined,
): Promise<RuntimeConnectionHandoffDecision> {
  if (connectionInfo === undefined) {
    return {
      action: "wait_for_existing",
      inspection,
      reason:
        "runtime.lock is active but no in-memory connection handoff resolver is available",
    };
  }

  let connection: RuntimeConnectionInfo | null | undefined;
  try {
    connection = await connectionInfo(inspection);
  } catch (error) {
    return {
      action: "block_startup",
      inspection,
      reason: `Runtime connection handoff resolver failed: ${errorName(error)}`,
    };
  }

  if (connection === null || connection === undefined) {
    return {
      action: "wait_for_existing",
      inspection,
      reason:
        "runtime.lock is active but no reusable runtime connection is registered",
    };
  }

  try {
    return {
      action: "reuse_existing",
      inspection,
      connection: normalizeRuntimeConnectionInfo(connection),
    };
  } catch (error) {
    return {
      action: "block_startup",
      inspection,
      reason: `Runtime connection handoff is invalid: ${errorName(error)}`,
    };
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.message : typeof error;
}
