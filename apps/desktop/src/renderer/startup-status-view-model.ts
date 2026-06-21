import type {
  RuntimeStartupStatus,
  RuntimeStartupStatusUnsubscribe,
} from "../preload/contract.js";

export type RuntimeStartupStatusViewPhase =
  | "idle"
  | "starting"
  | "waiting"
  | "ready"
  | "blocked"
  | "timed_out";

export type RuntimeStartupStatusViewTone =
  | "info"
  | "success"
  | "warning"
  | "error";

export interface RuntimeStartupStatusViewItem {
  readonly kind: RuntimeStartupStatus["kind"];
  readonly action: RuntimeStartupStatus["action"];
  readonly attempt: number;
  readonly lockStatus: RuntimeStartupStatus["lockStatus"];
  readonly severity: RuntimeStartupStatus["severity"];
  readonly message: string;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
  readonly reason?: string;
  readonly title: string;
  readonly summary: string;
}

export interface RuntimeStartupStatusViewModelSnapshot {
  readonly phase: RuntimeStartupStatusViewPhase;
  readonly tone: RuntimeStartupStatusViewTone;
  readonly title: string;
  readonly summary: string;
  readonly latestStatus: RuntimeStartupStatusViewItem | null;
  readonly items: readonly RuntimeStartupStatusViewItem[];
  readonly totalStatuses: number;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
}

export type RuntimeStartupStatusViewModelListener = (
  snapshot: RuntimeStartupStatusViewModelSnapshot,
) => void;

export type RuntimeStartupStatusViewModelErrorHandler = (
  error: unknown,
) => void;

export interface RuntimeStartupStatusViewModelStore {
  readonly snapshot: () => readonly RuntimeStartupStatus[];
  readonly subscribe: (
    listener: (statuses: readonly RuntimeStartupStatus[]) => void,
  ) => RuntimeStartupStatusUnsubscribe;
}

export interface RuntimeStartupStatusViewModel {
  readonly snapshot: () => RuntimeStartupStatusViewModelSnapshot;
  readonly subscribe: (
    listener: RuntimeStartupStatusViewModelListener,
  ) => RuntimeStartupStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
}

export interface CreateRuntimeStartupStatusViewModelOptions {
  readonly store: RuntimeStartupStatusViewModelStore;
  readonly onError?: RuntimeStartupStatusViewModelErrorHandler;
}

export function createRuntimeStartupStatusViewModel(
  options: CreateRuntimeStartupStatusViewModelOptions,
): RuntimeStartupStatusViewModel {
  let statuses = cloneRuntimeStartupStatuses(options.store.snapshot());
  const listeners = new Set<RuntimeStartupStatusViewModelListener>();
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break startup view propagation.
    }
  };

  const snapshot = (): RuntimeStartupStatusViewModelSnapshot =>
    buildRuntimeStartupStatusViewModelSnapshot(statuses);

  const publish = (): void => {
    if (disposed) {
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

  const unsubscribeStore = options.store.subscribe((nextStatuses) => {
    statuses = cloneRuntimeStartupStatuses(nextStatuses);
    publish();
  });

  return {
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        return listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      listeners.clear();
      unsubscribeStore();
      return true;
    },
  };
}

export function buildRuntimeStartupStatusViewModelSnapshot(
  statuses: readonly RuntimeStartupStatus[],
): RuntimeStartupStatusViewModelSnapshot {
  const items = statuses.map(toRuntimeStartupStatusViewItem);
  const latestStatus = items.at(-1) ?? null;

  if (latestStatus === null) {
    return {
      phase: "idle",
      tone: "info",
      title: "Runtime startup is idle",
      summary: "No runtime startup status has been received.",
      latestStatus: null,
      items: [],
      totalStatuses: 0,
      lifecycleComplete: false,
      userActionRequired: false,
      retryable: false,
    };
  }

  const phase = toRuntimeStartupStatusViewPhase(latestStatus.kind);
  return {
    phase,
    tone:
      phase === "ready"
        ? "success"
        : toRuntimeStartupStatusViewTone(latestStatus.severity),
    title: latestStatus.title,
    summary: latestStatus.summary,
    latestStatus: cloneRuntimeStartupStatusViewItem(latestStatus),
    items: items.map(cloneRuntimeStartupStatusViewItem),
    totalStatuses: items.length,
    lifecycleComplete: latestStatus.lifecycleComplete,
    userActionRequired: latestStatus.userActionRequired,
    retryable: latestStatus.retryable,
  };
}

function toRuntimeStartupStatusViewItem(
  status: RuntimeStartupStatus,
): RuntimeStartupStatusViewItem {
  const input: RuntimeStartupStatusViewItem = {
    kind: status.kind,
    action: status.action,
    attempt: status.attempt,
    lockStatus: status.lockStatus,
    severity: status.severity,
    message: status.message,
    lifecycleComplete: status.lifecycleComplete,
    userActionRequired: status.userActionRequired,
    retryable: status.retryable,
    title: titleRuntimeStartupStatus(status.kind),
    summary:
      status.reason === undefined
        ? status.message
        : `${status.message} ${status.reason}`,
  };
  return status.reason === undefined
    ? input
    : { ...input, reason: status.reason };
}

function titleRuntimeStartupStatus(kind: RuntimeStartupStatus["kind"]): string {
  switch (kind) {
    case "starting_sidecar":
      return "Starting runtime";
    case "cleaning_stale_lock":
      return "Cleaning stale runtime lock";
    case "waiting_for_existing":
      return "Waiting for existing runtime";
    case "runtime_ready":
      return "Runtime ready";
    case "startup_blocked":
      return "Startup blocked";
    case "startup_timed_out":
      return "Startup timed out";
  }
}

function toRuntimeStartupStatusViewPhase(
  kind: RuntimeStartupStatus["kind"],
): RuntimeStartupStatusViewPhase {
  switch (kind) {
    case "starting_sidecar":
    case "cleaning_stale_lock":
      return "starting";
    case "waiting_for_existing":
      return "waiting";
    case "runtime_ready":
      return "ready";
    case "startup_blocked":
      return "blocked";
    case "startup_timed_out":
      return "timed_out";
  }
}

function toRuntimeStartupStatusViewTone(
  severity: RuntimeStartupStatus["severity"],
): RuntimeStartupStatusViewTone {
  switch (severity) {
    case "info":
      return "info";
    case "warning":
      return "warning";
    case "error":
      return "error";
  }
}

function cloneRuntimeStartupStatuses(
  statuses: readonly RuntimeStartupStatus[],
): RuntimeStartupStatus[] {
  return statuses.map((status) => ({ ...status }));
}

function cloneRuntimeStartupStatusViewItem(
  item: RuntimeStartupStatusViewItem,
): RuntimeStartupStatusViewItem {
  return { ...item };
}
