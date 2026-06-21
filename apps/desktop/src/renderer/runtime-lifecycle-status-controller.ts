import type {
  RuntimeBridge,
  RuntimeShutdownStatus,
  RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import {
  createRuntimeShutdownStatusStore,
  type RuntimeShutdownStatusStore,
} from "./shutdown-status-client.js";
import {
  createRuntimeStartupStatusSession,
  type RuntimeStartupStatusSession,
  type RuntimeStartupStatusSessionSnapshot,
} from "./startup-status-session.js";
import type { RuntimeStartupStatusViewTone } from "./startup-status-view-model.js";

export type RuntimeLifecycleStatusControllerPhase =
  | "idle"
  | "starting"
  | "waiting"
  | "ready"
  | "blocked"
  | "timed_out"
  | "shutting_down"
  | "stopped"
  | "failed";

export type RuntimeLifecycleStatusControllerTone = RuntimeStartupStatusViewTone;

export type RuntimeLifecycleStatusPageLifecycleEvent =
  | "beforeunload"
  | "pagehide";

export type RuntimeLifecycleStatusPageLifecycleListener = () => void;

export interface RuntimeLifecycleStatusPageLifecycleTarget {
  readonly addEventListener: (
    type: RuntimeLifecycleStatusPageLifecycleEvent,
    listener: RuntimeLifecycleStatusPageLifecycleListener,
  ) => void;
  readonly removeEventListener: (
    type: RuntimeLifecycleStatusPageLifecycleEvent,
    listener: RuntimeLifecycleStatusPageLifecycleListener,
  ) => void;
}

export interface BindRuntimeLifecycleStatusPageLifecycleOptions {
  readonly eventType?: RuntimeLifecycleStatusPageLifecycleEvent;
}

export interface RuntimeLifecycleStatusControllerSnapshot {
  readonly startup: RuntimeStartupStatusSessionSnapshot;
  readonly shutdownStatuses: readonly RuntimeShutdownStatus[];
  readonly latestShutdownStatus: RuntimeShutdownStatus | null;
  readonly phase: RuntimeLifecycleStatusControllerPhase;
  readonly tone: RuntimeLifecycleStatusControllerTone;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
  readonly startupStarted: boolean;
  readonly shutdownStarted: boolean;
  readonly disposed: boolean;
}

export type RuntimeLifecycleStatusControllerListener = (
  snapshot: RuntimeLifecycleStatusControllerSnapshot,
) => void;

export type RuntimeLifecycleStatusControllerErrorHandler = (
  error: unknown,
) => void;

export interface RuntimeLifecycleStatusController {
  readonly startupSession: RuntimeStartupStatusSession;
  readonly shutdownStore: RuntimeShutdownStatusStore;
  readonly snapshot: () => RuntimeLifecycleStatusControllerSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecycleStatusControllerListener,
  ) => RuntimeStatusUnsubscribe;
  readonly start: () => RuntimeLifecycleStatusControllerSnapshot;
  readonly stop: () => boolean;
  readonly refresh: () => Promise<RuntimeLifecycleStatusControllerSnapshot>;
  readonly bindPageLifecycle: (
    target: RuntimeLifecycleStatusPageLifecycleTarget,
    options?: BindRuntimeLifecycleStatusPageLifecycleOptions,
  ) => RuntimeStatusUnsubscribe;
  readonly isStarted: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeLifecycleStatusControllerOptions {
  readonly runtime: Pick<
    RuntimeBridge,
    "startupStatus" | "onStartupStatus" | "shutdownStatus" | "onShutdownStatus"
  >;
  readonly onError?: RuntimeLifecycleStatusControllerErrorHandler;
}

export function createRuntimeLifecycleStatusController(
  options: CreateRuntimeLifecycleStatusControllerOptions,
): RuntimeLifecycleStatusController {
  const startupSession = createRuntimeStartupStatusSession({
    runtime: options.runtime,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const shutdownStore = createRuntimeShutdownStatusStore({
    runtime: options.runtime,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const listeners = new Set<RuntimeLifecycleStatusControllerListener>();
  const lifecycleUnsubscribes = new Set<RuntimeStatusUnsubscribe>();
  let startupUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let shutdownUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;
  let suppressPublishDepth = 0;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle status propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime lifecycle status controller is disposed");
    }
  };

  const snapshot = (): RuntimeLifecycleStatusControllerSnapshot =>
    buildRuntimeLifecycleStatusControllerSnapshot({
      startup: startupSession.snapshot(),
      shutdownStatuses: shutdownStore.snapshot(),
      shutdownStarted: !disposed && shutdownStore.isStarted(),
      disposed,
    });

  const publish = (): void => {
    if (disposed || suppressPublishDepth > 0 || listeners.size === 0) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(snapshot());
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensureUpstreamSubscriptions = (): void => {
    if (startupUnsubscribe === undefined) {
      startupUnsubscribe = startupSession.subscribe(() => {
        publish();
      });
    }
    if (shutdownUnsubscribe === undefined) {
      shutdownUnsubscribe = shutdownStore.subscribe(() => {
        publish();
      });
    }
  };

  const releaseUpstreamSubscriptions = (): void => {
    startupUnsubscribe?.();
    startupUnsubscribe = undefined;
    shutdownUnsubscribe?.();
    shutdownUnsubscribe = undefined;
  };

  const runBatched = <T>(operation: () => T): T => {
    suppressPublishDepth += 1;
    try {
      return operation();
    } finally {
      suppressPublishDepth -= 1;
    }
  };

  const start = (): RuntimeLifecycleStatusControllerSnapshot => {
    assertActive();
    const startupWasStarted = startupSession.isStarted();
    const shutdownWasStarted = shutdownStore.isStarted();
    runBatched(() => {
      startupSession.start();
      shutdownStore.start();
    });
    if (!startupWasStarted || !shutdownWasStarted) {
      publish();
    }
    return snapshot();
  };

  const stop = (): boolean => {
    if (disposed) {
      return false;
    }
    let stopped = false;
    runBatched(() => {
      const startupStopped = startupSession.stop();
      const shutdownStopped = shutdownStore.stop();
      stopped = startupStopped || shutdownStopped;
    });
    if (stopped) {
      publish();
    }
    return stopped;
  };

  return {
    startupSession,
    shutdownStore,
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      ensureUpstreamSubscriptions();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseUpstreamSubscriptions();
        }
        return deleted;
      };
    },
    start,
    stop,
    refresh: async () => {
      assertActive();
      suppressPublishDepth += 1;
      try {
        await Promise.all([startupSession.refresh(), shutdownStore.refresh()]);
      } finally {
        suppressPublishDepth -= 1;
      }
      publish();
      return snapshot();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      const eventType = bindOptions?.eventType ?? "beforeunload";
      let stopped = false;
      const stopController = (): void => {
        if (stopped) {
          return;
        }
        stopped = true;
        stop();
      };
      target.addEventListener(eventType, stopController);
      let bound = true;
      const unsubscribe = (): boolean => {
        if (!bound) {
          return false;
        }
        bound = false;
        lifecycleUnsubscribes.delete(unsubscribe);
        target.removeEventListener(eventType, stopController);
        stopController();
        return true;
      };
      lifecycleUnsubscribes.add(unsubscribe);
      return unsubscribe;
    },
    isStarted: () =>
      !disposed && (startupSession.isStarted() || shutdownStore.isStarted()),
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseUpstreamSubscriptions();
      listeners.clear();
      for (const unsubscribe of [...lifecycleUnsubscribes]) {
        unsubscribe();
      }
      lifecycleUnsubscribes.clear();
      shutdownStore.stop();
      startupSession.dispose();
      return true;
    },
    isDisposed: () => disposed,
  };
}

function buildRuntimeLifecycleStatusControllerSnapshot(input: {
  readonly startup: RuntimeStartupStatusSessionSnapshot;
  readonly shutdownStatuses: readonly RuntimeShutdownStatus[];
  readonly shutdownStarted: boolean;
  readonly disposed: boolean;
}): RuntimeLifecycleStatusControllerSnapshot {
  const shutdownStatuses = input.shutdownStatuses.map(cloneShutdownStatus);
  const latestShutdownStatus = shutdownStatuses.at(-1) ?? null;
  const shutdownProjection = projectShutdownStatus(latestShutdownStatus);
  const phase = shutdownProjection?.phase ?? input.startup.view.phase;
  const tone = shutdownProjection?.tone ?? input.startup.view.tone;
  return {
    startup: input.startup,
    shutdownStatuses,
    latestShutdownStatus,
    phase,
    tone,
    lifecycleComplete:
      shutdownProjection?.lifecycleComplete ??
      input.startup.view.lifecycleComplete,
    userActionRequired:
      input.startup.view.userActionRequired ||
      (shutdownProjection?.userActionRequired ?? false),
    retryable:
      input.startup.view.retryable || (shutdownProjection?.retryable ?? false),
    startupStarted: input.startup.started,
    shutdownStarted: !input.disposed && input.shutdownStarted,
    disposed: input.disposed,
  };
}

function projectShutdownStatus(status: RuntimeShutdownStatus | null): {
  readonly phase: RuntimeLifecycleStatusControllerPhase;
  readonly tone: RuntimeLifecycleStatusControllerTone;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
} | null {
  if (status === null || status.state === "registered") {
    return null;
  }

  if (status.state === "failed") {
    return {
      phase: "failed",
      tone: "error",
      lifecycleComplete: status.lifecycleComplete,
      userActionRequired: true,
      retryable: status.retryable,
    };
  }

  if (status.state === "shutting_down") {
    return {
      phase: "shutting_down",
      tone: status.severity === "error" ? "error" : "info",
      lifecycleComplete: status.lifecycleComplete,
      userActionRequired: false,
      retryable: status.retryable,
    };
  }

  return {
    phase: "stopped",
    tone: status.severity === "error" ? "error" : "success",
    lifecycleComplete: status.lifecycleComplete,
    userActionRequired: false,
    retryable: status.retryable,
  };
}

function cloneShutdownStatus(
  status: RuntimeShutdownStatus,
): RuntimeShutdownStatus {
  return { ...status };
}
