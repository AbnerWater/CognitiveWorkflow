import type { RuntimeConnectionHandoffAction } from "./runtime-handoff.js";
import type {
  RuntimeStartupLifecycleDecision,
  RuntimeStartupLifecycleTransition,
} from "./runtime-lifecycle.js";
import type { RuntimeLockStatus } from "./runtime-lock.js";

export type RuntimeStartupStatusKind =
  | "starting_sidecar"
  | "cleaning_stale_lock"
  | "waiting_for_existing"
  | "runtime_ready"
  | "startup_blocked"
  | "startup_timed_out";

export type RuntimeStartupStatusSeverity = "info" | "warning" | "error";

export type RuntimeStartupStatusAction =
  | RuntimeConnectionHandoffAction
  | RuntimeStartupLifecycleDecision["action"];

export interface RuntimeStartupStatus {
  readonly kind: RuntimeStartupStatusKind;
  readonly action: RuntimeStartupStatusAction;
  readonly attempt: number;
  readonly lockStatus: RuntimeLockStatus;
  readonly severity: RuntimeStartupStatusSeverity;
  readonly message: string;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
  readonly reason?: string;
}

export function mapRuntimeStartupDecisionToStatus(
  decision: RuntimeStartupLifecycleDecision,
): RuntimeStartupStatus {
  return buildRuntimeStartupStatus({
    action: decision.action,
    attempt: decision.attempts,
    lockStatus: decision.handoff.inspection.status,
    ...("reason" in decision ? { reason: decision.reason } : {}),
  });
}

export function mapRuntimeStartupTransitionToStatus(
  transition: RuntimeStartupLifecycleTransition,
): RuntimeStartupStatus {
  return buildRuntimeStartupStatus({
    action: transition.action,
    attempt: transition.attempt,
    lockStatus: transition.inspection.status,
    ...(transition.reason !== undefined ? { reason: transition.reason } : {}),
  });
}

interface BuildRuntimeStartupStatusOptions {
  readonly action: RuntimeStartupStatusAction;
  readonly attempt: number;
  readonly lockStatus: RuntimeLockStatus;
  readonly reason?: string;
}

function buildRuntimeStartupStatus(
  options: BuildRuntimeStartupStatusOptions,
): RuntimeStartupStatus {
  switch (options.action) {
    case "start_sidecar":
      return createStatus(options, {
        kind: "starting_sidecar",
        severity: "info",
        message: "Starting runtime sidecar.",
        lifecycleComplete: true,
        userActionRequired: false,
        retryable: false,
      });
    case "cleanup_then_start":
      return createStatus(options, {
        kind: "cleaning_stale_lock",
        severity: "warning",
        message: "Cleaning stale runtime lock before starting runtime sidecar.",
        lifecycleComplete: true,
        userActionRequired: false,
        retryable: false,
      });
    case "reuse_existing":
      return createStatus(options, {
        kind: "runtime_ready",
        severity: "info",
        message: "Runtime sidecar is ready.",
        lifecycleComplete: true,
        userActionRequired: false,
        retryable: false,
      });
    case "wait_for_existing":
      return createStatus(options, {
        kind: "waiting_for_existing",
        severity: "info",
        message: "Waiting for existing runtime sidecar.",
        lifecycleComplete: false,
        userActionRequired: false,
        retryable: false,
      });
    case "timeout_waiting_for_existing":
      return createStatus(options, {
        kind: "startup_timed_out",
        severity: "warning",
        message: "Timed out waiting for existing runtime sidecar.",
        lifecycleComplete: true,
        userActionRequired: true,
        retryable: true,
      });
    case "block_startup":
      return createStatus(options, {
        kind: "startup_blocked",
        severity: "error",
        message: "Runtime startup is blocked.",
        lifecycleComplete: true,
        userActionRequired: true,
        retryable: false,
      });
  }
}

interface RuntimeStartupStatusTemplate {
  readonly kind: RuntimeStartupStatusKind;
  readonly severity: RuntimeStartupStatusSeverity;
  readonly message: string;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
}

function createStatus(
  options: BuildRuntimeStartupStatusOptions,
  template: RuntimeStartupStatusTemplate,
): RuntimeStartupStatus {
  return {
    kind: template.kind,
    action: options.action,
    attempt: options.attempt,
    lockStatus: options.lockStatus,
    severity: template.severity,
    message: template.message,
    lifecycleComplete: template.lifecycleComplete,
    userActionRequired: template.userActionRequired,
    retryable: template.retryable,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  };
}
