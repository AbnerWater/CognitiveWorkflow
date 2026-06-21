import type {
  RuntimeShutdownStatus,
  RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import type {
  RuntimeLifecycleStatusController,
  RuntimeLifecycleStatusControllerPhase,
  RuntimeLifecycleStatusControllerSnapshot,
  RuntimeLifecycleStatusControllerTone,
} from "./runtime-lifecycle-status-controller.js";
import type { RuntimeStartupStatusViewItem } from "./startup-status-view-model.js";

export type RuntimeLifecycleShellReadiness =
  | "idle"
  | "busy"
  | "ready"
  | "attention_required"
  | "shutting_down"
  | "stopped";

export type RuntimeLifecyclePrimaryAction =
  | "start_runtime"
  | "retry_startup"
  | "inspect_issue"
  | "wait"
  | "none";

export type RuntimeLifecycleViewStateSource = "startup" | "shutdown";

export interface RuntimeLifecycleViewStateItem {
  readonly source: RuntimeLifecycleViewStateSource;
  readonly kind: string;
  readonly phase: RuntimeLifecycleStatusControllerPhase;
  readonly tone: RuntimeLifecycleStatusControllerTone;
  readonly title: string;
  readonly summary: string;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
}

export interface RuntimeLifecycleViewStateSnapshot {
  readonly phase: RuntimeLifecycleStatusControllerPhase;
  readonly tone: RuntimeLifecycleStatusControllerTone;
  readonly readiness: RuntimeLifecycleShellReadiness;
  readonly title: string;
  readonly summary: string;
  readonly primaryAction: RuntimeLifecyclePrimaryAction;
  readonly runtimeReady: boolean;
  readonly busy: boolean;
  readonly terminal: boolean;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
  readonly startupStarted: boolean;
  readonly shutdownStarted: boolean;
  readonly disposed: boolean;
  readonly latestItem: RuntimeLifecycleViewStateItem | null;
  readonly items: readonly RuntimeLifecycleViewStateItem[];
  readonly startupTotal: number;
  readonly shutdownTotal: number;
}

export type RuntimeLifecycleViewStateListener = (
  snapshot: RuntimeLifecycleViewStateSnapshot,
) => void;

export type RuntimeLifecycleViewStateErrorHandler = (error: unknown) => void;

export interface RuntimeLifecycleViewStateController {
  readonly snapshot: () => RuntimeLifecycleStatusControllerSnapshot;
  readonly subscribe: (
    listener: (snapshot: RuntimeLifecycleStatusControllerSnapshot) => void,
  ) => RuntimeStatusUnsubscribe;
}

export interface RuntimeLifecycleViewState {
  readonly controller: RuntimeLifecycleViewStateController;
  readonly snapshot: () => RuntimeLifecycleViewStateSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecycleViewStateListener,
  ) => RuntimeStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeLifecycleViewStateOptions {
  readonly controller:
    | RuntimeLifecycleViewStateController
    | Pick<RuntimeLifecycleStatusController, "snapshot" | "subscribe">;
  readonly onError?: RuntimeLifecycleViewStateErrorHandler;
}

export function createRuntimeLifecycleViewState(
  options: CreateRuntimeLifecycleViewStateOptions,
): RuntimeLifecycleViewState {
  let state = buildRuntimeLifecycleViewStateSnapshot(
    options.controller.snapshot(),
  );
  const listeners = new Set<RuntimeLifecycleViewStateListener>();
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle view propagation.
    }
  };

  const snapshot = (): RuntimeLifecycleViewStateSnapshot =>
    cloneRuntimeLifecycleViewStateSnapshot(state);

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

  const unsubscribeController = options.controller.subscribe(
    (controllerSnapshot) => {
      state = buildRuntimeLifecycleViewStateSnapshot(controllerSnapshot);
      publish();
    },
  );

  return {
    controller: options.controller,
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
      unsubscribeController();
      state = markRuntimeLifecycleViewStateDisposed(state);
      return true;
    },
    isDisposed: () => disposed,
  };
}

export function buildRuntimeLifecycleViewStateSnapshot(
  snapshot: RuntimeLifecycleStatusControllerSnapshot,
): RuntimeLifecycleViewStateSnapshot {
  const startupItems = snapshot.startup.view.items.map(toStartupViewStateItem);
  const shutdownItems = snapshot.shutdownStatuses.map(toShutdownViewStateItem);
  const latestStartupItem =
    snapshot.startup.view.latestStatus === null
      ? null
      : toStartupViewStateItem(snapshot.startup.view.latestStatus);
  const latestShutdownItem =
    snapshot.latestShutdownStatus === null
      ? null
      : toShutdownViewStateItem(snapshot.latestShutdownStatus);
  const latestItem =
    snapshot.latestShutdownStatus !== null &&
    snapshot.latestShutdownStatus.state !== "registered"
      ? latestShutdownItem
      : (latestStartupItem ?? latestShutdownItem);
  const title = latestItem?.title ?? snapshot.startup.view.title;
  const summary = latestItem?.summary ?? snapshot.startup.view.summary;
  const busy = isRuntimeLifecycleBusy(snapshot.phase);
  return {
    phase: snapshot.phase,
    tone: snapshot.tone,
    readiness: toRuntimeLifecycleShellReadiness(snapshot.phase),
    title,
    summary,
    primaryAction: toRuntimeLifecyclePrimaryAction(snapshot),
    runtimeReady: !snapshot.disposed && snapshot.phase === "ready",
    busy,
    terminal:
      snapshot.lifecycleComplete ||
      snapshot.phase === "stopped" ||
      snapshot.phase === "failed",
    lifecycleComplete: snapshot.lifecycleComplete,
    userActionRequired: snapshot.userActionRequired,
    retryable: snapshot.retryable,
    startupStarted: snapshot.startupStarted,
    shutdownStarted: snapshot.shutdownStarted,
    disposed: snapshot.disposed,
    latestItem,
    items: [...startupItems, ...shutdownItems].map(
      cloneRuntimeLifecycleViewStateItem,
    ),
    startupTotal: snapshot.startup.statuses.length,
    shutdownTotal: snapshot.shutdownStatuses.length,
  };
}

function toRuntimeLifecycleShellReadiness(
  phase: RuntimeLifecycleStatusControllerPhase,
): RuntimeLifecycleShellReadiness {
  switch (phase) {
    case "idle":
      return "idle";
    case "starting":
    case "waiting":
      return "busy";
    case "ready":
      return "ready";
    case "blocked":
    case "timed_out":
    case "failed":
      return "attention_required";
    case "shutting_down":
      return "shutting_down";
    case "stopped":
      return "stopped";
  }
}

function toRuntimeLifecyclePrimaryAction(
  snapshot: RuntimeLifecycleStatusControllerSnapshot,
): RuntimeLifecyclePrimaryAction {
  if (snapshot.disposed) {
    return "none";
  }

  switch (snapshot.phase) {
    case "idle":
    case "stopped":
      return "start_runtime";
    case "starting":
    case "waiting":
    case "shutting_down":
      return "wait";
    case "ready":
      return "none";
    case "blocked":
    case "timed_out":
    case "failed":
      return snapshot.retryable ? "retry_startup" : "inspect_issue";
  }
}

function isRuntimeLifecycleBusy(
  phase: RuntimeLifecycleStatusControllerPhase,
): boolean {
  return (
    phase === "starting" || phase === "waiting" || phase === "shutting_down"
  );
}

function toStartupViewStateItem(
  item: RuntimeStartupStatusViewItem,
): RuntimeLifecycleViewStateItem {
  return {
    source: "startup",
    kind: item.kind,
    phase: toStartupItemPhase(item),
    tone: item.kind === "runtime_ready" ? "success" : item.severity,
    title: item.title,
    summary: summaryStartupStatus(item.kind),
    lifecycleComplete: item.lifecycleComplete,
    userActionRequired: item.userActionRequired,
    retryable: item.retryable,
  };
}

function toStartupItemPhase(
  item: RuntimeStartupStatusViewItem,
): RuntimeLifecycleStatusControllerPhase {
  switch (item.kind) {
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

function summaryStartupStatus(
  kind: RuntimeStartupStatusViewItem["kind"],
): string {
  switch (kind) {
    case "starting_sidecar":
      return "Runtime startup is in progress.";
    case "cleaning_stale_lock":
      return "Runtime startup is cleaning a stale lock.";
    case "waiting_for_existing":
      return "Runtime startup is waiting for an existing runtime.";
    case "runtime_ready":
      return "Runtime sidecar is ready.";
    case "startup_blocked":
      return "Runtime startup is blocked.";
    case "startup_timed_out":
      return "Runtime startup timed out.";
  }
}

function toShutdownViewStateItem(
  status: RuntimeShutdownStatus,
): RuntimeLifecycleViewStateItem {
  return {
    source: "shutdown",
    kind: status.kind,
    phase: toShutdownItemPhase(status),
    tone: status.severity === "error" ? "error" : toShutdownItemTone(status),
    title: titleShutdownStatus(status.kind),
    summary: summaryShutdownStatus(status),
    lifecycleComplete: status.lifecycleComplete,
    userActionRequired: status.state === "failed",
    retryable: status.retryable,
  };
}

function toShutdownItemPhase(
  status: RuntimeShutdownStatus,
): RuntimeLifecycleStatusControllerPhase {
  switch (status.state) {
    case "registered":
      return "idle";
    case "shutting_down":
      return "shutting_down";
    case "shutdown_complete":
    case "unregistered":
      return "stopped";
    case "failed":
      return "failed";
  }
}

function toShutdownItemTone(
  status: RuntimeShutdownStatus,
): RuntimeLifecycleStatusControllerTone {
  if (status.state === "shutdown_complete" || status.state === "unregistered") {
    return "success";
  }
  return status.severity;
}

function titleShutdownStatus(kind: RuntimeShutdownStatus["kind"]): string {
  switch (kind) {
    case "registered":
      return "Runtime shutdown registered";
    case "app_quit_requested":
      return "App quit requested";
    case "window_close_requested":
      return "Window close requested";
    case "shutting_down":
      return "Runtime shutting down";
    case "shutdown_complete":
      return "Runtime shutdown complete";
    case "shutdown_failed":
      return "Runtime shutdown failed";
    case "unregistered":
      return "Runtime shutdown unregistered";
  }
}

function summaryShutdownStatus(status: RuntimeShutdownStatus): string {
  switch (status.kind) {
    case "registered":
      return "Runtime shutdown handlers are registered.";
    case "app_quit_requested":
      return "Application quit requested runtime shutdown.";
    case "window_close_requested":
      return "Window close requested runtime shutdown.";
    case "shutting_down":
      return "Runtime shutdown is in progress.";
    case "shutdown_complete":
      return "Runtime shutdown completed.";
    case "shutdown_failed":
      return "Runtime shutdown failed.";
    case "unregistered":
      return "Runtime shutdown handlers are unregistered.";
  }
}

function markRuntimeLifecycleViewStateDisposed(
  snapshot: RuntimeLifecycleViewStateSnapshot,
): RuntimeLifecycleViewStateSnapshot {
  return {
    ...cloneRuntimeLifecycleViewStateSnapshot(snapshot),
    primaryAction: "none",
    runtimeReady: false,
    busy: false,
    disposed: true,
  };
}

function cloneRuntimeLifecycleViewStateSnapshot(
  snapshot: RuntimeLifecycleViewStateSnapshot,
): RuntimeLifecycleViewStateSnapshot {
  return {
    ...snapshot,
    latestItem:
      snapshot.latestItem === null
        ? null
        : cloneRuntimeLifecycleViewStateItem(snapshot.latestItem),
    items: snapshot.items.map(cloneRuntimeLifecycleViewStateItem),
  };
}

function cloneRuntimeLifecycleViewStateItem(
  item: RuntimeLifecycleViewStateItem,
): RuntimeLifecycleViewStateItem {
  return { ...item };
}
