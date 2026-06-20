import {
  resolveRuntimeConnectionHandoff,
  type ResolveRuntimeConnectionHandoffOptions,
  type RuntimeConnectionHandoffDecision,
  type RuntimeConnectionHandoffResolver,
} from "./runtime-handoff.js";
import {
  mapRuntimeStartupDecisionToStatus,
  mapRuntimeStartupTransitionToStatus,
  type RuntimeStartupStatus,
} from "./runtime-startup-status.js";
import type {
  RuntimeLockInspection,
  RuntimeLockReadText,
} from "./runtime-lock.js";

export const DEFAULT_RUNTIME_STARTUP_LIFECYCLE_TIMEOUT_MS = 5_000;
export const DEFAULT_RUNTIME_STARTUP_LIFECYCLE_RETRY_MS = 100;

export type RuntimeStartupLifecycleAction =
  | "start_sidecar"
  | "cleanup_then_start"
  | "reuse_existing"
  | "timeout_waiting_for_existing"
  | "block_startup";

export type RuntimeStartupLifecycleSleep = (delayMs: number) => Promise<void>;

export type RuntimeConnectionHandoffProvider = (
  options: ResolveRuntimeConnectionHandoffOptions,
) => Promise<RuntimeConnectionHandoffDecision>;

export interface RuntimeStartupLifecycleTransition {
  readonly attempt: number;
  readonly action: RuntimeConnectionHandoffDecision["action"];
  readonly inspection: RuntimeLockInspection;
  readonly reason?: string;
}

export type RuntimeStartupLifecycleDecision =
  | {
      readonly action: "start_sidecar" | "cleanup_then_start";
      readonly attempts: number;
      readonly handoff: RuntimeConnectionHandoffDecision;
    }
  | {
      readonly action: "reuse_existing";
      readonly attempts: number;
      readonly handoff: RuntimeConnectionHandoffDecision;
    }
  | {
      readonly action: "block_startup";
      readonly attempts: number;
      readonly reason: string;
      readonly handoff: RuntimeConnectionHandoffDecision;
    }
  | {
      readonly action: "timeout_waiting_for_existing";
      readonly attempts: number;
      readonly reason: string;
      readonly handoff: RuntimeConnectionHandoffDecision;
    };

export interface ResolveRuntimeStartupLifecycleOptions {
  readonly projectRoot: string;
  readonly staleMs?: number;
  readonly readText?: RuntimeLockReadText;
  readonly connectionInfo?: RuntimeConnectionHandoffResolver;
  readonly timeoutMs?: number;
  readonly retryMs?: number;
  readonly nowMs?: () => number;
  readonly sleep?: RuntimeStartupLifecycleSleep;
  readonly handoff?: RuntimeConnectionHandoffProvider;
  readonly onTransition?: (
    transition: RuntimeStartupLifecycleTransition,
  ) => void | Promise<void>;
  readonly onStatus?: (status: RuntimeStartupStatus) => void | Promise<void>;
}

export async function resolveRuntimeStartupLifecycle(
  options: ResolveRuntimeStartupLifecycleOptions,
): Promise<RuntimeStartupLifecycleDecision> {
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_RUNTIME_STARTUP_LIFECYCLE_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RUNTIME_STARTUP_LIFECYCLE_RETRY_MS;
  assertPositiveInteger(timeoutMs, "Runtime startup lifecycle timeout");
  assertPositiveInteger(retryMs, "Runtime startup lifecycle retry interval");

  const handoff = options.handoff ?? resolveRuntimeConnectionHandoff;
  const nowMs = options.nowMs ?? Date.now;
  const sleep = options.sleep ?? sleepMs;
  const startedAtMs = nowMs();
  const maxWaitAttempts = Math.max(1, Math.ceil(timeoutMs / retryMs) + 1);
  let attempts = 0;
  let waitAttempts = 0;
  let lastWait: RuntimeConnectionHandoffWaitDecision | undefined;

  while (true) {
    if (lastWait !== undefined) {
      const elapsedMs = Math.max(0, nowMs() - startedAtMs);
      if (elapsedMs >= timeoutMs) {
        const decision: RuntimeStartupLifecycleDecision = {
          action: "timeout_waiting_for_existing",
          attempts,
          reason: lastWait.reason,
          handoff: lastWait,
        };
        await options.onStatus?.(mapRuntimeStartupDecisionToStatus(decision));
        return decision;
      }
    }

    attempts += 1;
    const decision = await handoff({
      projectRoot: options.projectRoot,
      nowMs: nowMs(),
      ...(options.staleMs !== undefined ? { staleMs: options.staleMs } : {}),
      ...(options.readText !== undefined ? { readText: options.readText } : {}),
      ...(options.connectionInfo !== undefined
        ? { connectionInfo: options.connectionInfo }
        : {}),
    });

    const transition: RuntimeStartupLifecycleTransition = {
      attempt: attempts,
      action: decision.action,
      inspection: decision.inspection,
      ...("reason" in decision ? { reason: decision.reason } : {}),
    };
    await options.onTransition?.(transition);

    if (isRuntimeConnectionHandoffWaitDecision(decision)) {
      await options.onStatus?.(mapRuntimeStartupTransitionToStatus(transition));
      lastWait = decision;
      waitAttempts += 1;
      const elapsedMs = Math.max(0, nowMs() - startedAtMs);
      if (elapsedMs >= timeoutMs || waitAttempts >= maxWaitAttempts) {
        const timeoutDecision: RuntimeStartupLifecycleDecision = {
          action: "timeout_waiting_for_existing",
          attempts,
          reason: decision.reason,
          handoff: decision,
        };
        await options.onStatus?.(
          mapRuntimeStartupDecisionToStatus(timeoutDecision),
        );
        return timeoutDecision;
      }
      await sleep(Math.min(retryMs, timeoutMs - elapsedMs));
      continue;
    }

    if (isRuntimeConnectionHandoffBlockDecision(decision)) {
      const blockedDecision: RuntimeStartupLifecycleDecision = {
        action: "block_startup",
        attempts,
        reason: decision.reason,
        handoff: decision,
      };
      await options.onStatus?.(
        mapRuntimeStartupDecisionToStatus(blockedDecision),
      );
      return blockedDecision;
    }

    switch (decision.action) {
      case "start_sidecar":
      case "cleanup_then_start": {
        const lifecycleDecision: RuntimeStartupLifecycleDecision = {
          action: decision.action,
          attempts,
          handoff: decision,
        };
        await options.onStatus?.(
          mapRuntimeStartupDecisionToStatus(lifecycleDecision),
        );
        return lifecycleDecision;
      }
      case "reuse_existing": {
        const lifecycleDecision: RuntimeStartupLifecycleDecision = {
          action: "reuse_existing",
          attempts,
          handoff: decision,
        };
        await options.onStatus?.(
          mapRuntimeStartupDecisionToStatus(lifecycleDecision),
        );
        return lifecycleDecision;
      }
    }
  }
}

type RuntimeConnectionHandoffWaitDecision = RuntimeConnectionHandoffDecision & {
  readonly action: "wait_for_existing";
  readonly reason: string;
};

type RuntimeConnectionHandoffBlockDecision =
  RuntimeConnectionHandoffDecision & {
    readonly action: "block_startup";
    readonly reason: string;
  };

function isRuntimeConnectionHandoffWaitDecision(
  decision: RuntimeConnectionHandoffDecision,
): decision is RuntimeConnectionHandoffWaitDecision {
  return decision.action === "wait_for_existing";
}

function isRuntimeConnectionHandoffBlockDecision(
  decision: RuntimeConnectionHandoffDecision,
): decision is RuntimeConnectionHandoffBlockDecision {
  return decision.action === "block_startup";
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

async function sleepMs(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
