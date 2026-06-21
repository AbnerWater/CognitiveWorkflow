import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  RuntimeLifecycleShellSession,
  RuntimeLifecycleShellSessionSnapshot,
} from "./runtime-lifecycle-shell-session.js";
import type {
  RuntimeLifecyclePrimaryAction,
  RuntimeLifecycleShellReadiness,
  RuntimeLifecycleViewStateItem,
} from "./runtime-lifecycle-view-state.js";

export type RuntimeLifecyclePanelCommandId =
  | RuntimeLifecyclePrimaryAction
  | "refresh_status"
  | "stop_runtime";

export type RuntimeLifecyclePanelCommandRole = "primary" | "secondary";

export type RuntimeLifecyclePanelCommandTone = "neutral" | "accent" | "danger";

export interface RuntimeLifecyclePanelCommand {
  readonly id: RuntimeLifecyclePanelCommandId;
  readonly role: RuntimeLifecyclePanelCommandRole;
  readonly label: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly tone: RuntimeLifecyclePanelCommandTone;
}

export type RuntimeLifecyclePanelTimelineBadge =
  | "startup"
  | "shutdown"
  | "complete"
  | "action_required"
  | "retryable";

export interface RuntimeLifecyclePanelTimelineItem {
  readonly id: string;
  readonly source: RuntimeLifecycleViewStateItem["source"];
  readonly sourceLabel: string;
  readonly kind: string;
  readonly phase: RuntimeLifecycleViewStateItem["phase"];
  readonly tone: RuntimeLifecycleViewStateItem["tone"];
  readonly statusLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly badges: readonly RuntimeLifecyclePanelTimelineBadge[];
}

export interface RuntimeLifecyclePanelEmptyState {
  readonly title: string;
  readonly summary: string;
}

export interface RuntimeLifecyclePanelSnapshot {
  readonly readiness: RuntimeLifecycleShellReadiness;
  readonly tone: RuntimeLifecycleViewStateItem["tone"];
  readonly statusLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly runtimeReady: boolean;
  readonly busy: boolean;
  readonly terminal: boolean;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
  readonly startupTotal: number;
  readonly shutdownTotal: number;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly ariaLive: "off" | "polite" | "assertive";
  readonly primaryCommand: RuntimeLifecyclePanelCommand | null;
  readonly secondaryCommands: readonly RuntimeLifecyclePanelCommand[];
  readonly timelineItems: readonly RuntimeLifecyclePanelTimelineItem[];
  readonly emptyState: RuntimeLifecyclePanelEmptyState | null;
}

export type RuntimeLifecyclePanelPresenterListener = (
  snapshot: RuntimeLifecyclePanelSnapshot,
) => void;

export type RuntimeLifecyclePanelPresenterErrorHandler = (
  error: unknown,
) => void;

export interface RuntimeLifecyclePanelPresenter {
  readonly snapshot: () => RuntimeLifecyclePanelSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecyclePanelPresenterListener,
  ) => RuntimeStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly invoke: (
    commandId: RuntimeLifecyclePanelCommandId,
  ) => Promise<RuntimeLifecyclePanelSnapshot>;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeLifecyclePanelPresenterOptions {
  readonly session: Pick<
    RuntimeLifecycleShellSession,
    "snapshot" | "subscribe" | "start" | "stop" | "refresh" | "isStarted"
  >;
  readonly onError?: RuntimeLifecyclePanelPresenterErrorHandler;
}

export function createRuntimeLifecyclePanelPresenter(
  options: CreateRuntimeLifecyclePanelPresenterOptions,
): RuntimeLifecyclePanelPresenter {
  const listeners = new Set<RuntimeLifecyclePanelPresenterListener>();
  let sessionUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle panel propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime lifecycle panel presenter is disposed");
    }
  };

  const snapshot = (): RuntimeLifecyclePanelSnapshot =>
    buildRuntimeLifecyclePanelSnapshot(options.session.snapshot());

  const publish = (): void => {
    if (disposed || listeners.size === 0) {
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

  const ensureSessionSubscription = (): void => {
    if (sessionUnsubscribe !== undefined) {
      return;
    }
    sessionUnsubscribe = options.session.subscribe(() => {
      publish();
    });
  };

  const releaseSessionSubscription = (): void => {
    sessionUnsubscribe?.();
    sessionUnsubscribe = undefined;
  };

  return {
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      ensureSessionSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseSessionSubscription();
        }
        return deleted;
      };
    },
    listenerCount: () => listeners.size,
    invoke: async (commandId) => {
      assertActive();
      switch (commandId) {
        case "start_runtime":
          options.session.start();
          break;
        case "retry_startup":
          options.session.stop();
          options.session.start();
          break;
        case "refresh_status":
          await options.session.refresh();
          break;
        case "stop_runtime":
          options.session.stop();
          break;
        case "inspect_issue":
        case "wait":
        case "none":
          break;
      }
      return snapshot();
    },
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseSessionSubscription();
      listeners.clear();
      return true;
    },
    isDisposed: () => disposed,
  };
}

export function buildRuntimeLifecyclePanelSnapshot(
  snapshot: RuntimeLifecycleShellSessionSnapshot,
): RuntimeLifecyclePanelSnapshot {
  const view = snapshot.view;
  const timelineItems = view.items.map(toPanelTimelineItem);
  return {
    readiness: view.readiness,
    tone: view.tone,
    statusLabel: statusLabel(view.readiness),
    title: view.title,
    summary: view.summary,
    runtimeReady: view.runtimeReady,
    busy: view.busy,
    terminal: view.terminal,
    lifecycleComplete: view.lifecycleComplete,
    userActionRequired: view.userActionRequired,
    retryable: view.retryable,
    startupTotal: view.startupTotal,
    shutdownTotal: view.shutdownTotal,
    started: snapshot.started,
    disposed: snapshot.disposed,
    ariaLive: ariaLive(view.readiness),
    primaryCommand: primaryCommand(snapshot),
    secondaryCommands: secondaryCommands(snapshot),
    timelineItems: timelineItems.map(clonePanelTimelineItem),
    emptyState:
      timelineItems.length === 0
        ? {
            title: "No lifecycle activity",
            summary: "Runtime lifecycle events will appear here.",
          }
        : null,
  };
}

function primaryCommand(
  snapshot: RuntimeLifecycleShellSessionSnapshot,
): RuntimeLifecyclePanelCommand | null {
  const { view } = snapshot;
  switch (view.primaryAction) {
    case "start_runtime":
      return {
        id: "start_runtime",
        role: "primary",
        label: "Start runtime",
        title: "Start runtime lifecycle tracking.",
        enabled: !snapshot.disposed && !view.busy,
        busy: false,
        tone: "accent",
      };
    case "retry_startup":
      return {
        id: "retry_startup",
        role: "primary",
        label: "Retry runtime",
        title: "Retry runtime lifecycle tracking.",
        enabled: !snapshot.disposed && view.retryable && !view.busy,
        busy: false,
        tone: "accent",
      };
    case "inspect_issue":
      return {
        id: "inspect_issue",
        role: "primary",
        label: "Inspect issue",
        title: "Issue inspection is available after the task drawer is wired.",
        enabled: false,
        busy: false,
        tone: "danger",
      };
    case "wait":
      return {
        id: "wait",
        role: "primary",
        label: waitLabel(view.readiness),
        title: "Runtime lifecycle is in progress.",
        enabled: false,
        busy: true,
        tone: "neutral",
      };
    case "none":
      return null;
  }
}

function secondaryCommands(
  snapshot: RuntimeLifecycleShellSessionSnapshot,
): RuntimeLifecyclePanelCommand[] {
  const { view } = snapshot;
  const commands: RuntimeLifecyclePanelCommand[] = [
    {
      id: "refresh_status",
      role: "secondary",
      label: "Refresh",
      title: "Refresh runtime lifecycle status.",
      enabled: !snapshot.disposed,
      busy: view.busy,
      tone: "neutral",
    },
  ];
  if (snapshot.started) {
    commands.push({
      id: "stop_runtime",
      role: "secondary",
      label: "Stop tracking",
      title: "Stop runtime lifecycle tracking.",
      enabled: !snapshot.disposed,
      busy: false,
      tone: view.tone === "error" ? "danger" : "neutral",
    });
  }
  return commands;
}

function toPanelTimelineItem(
  item: RuntimeLifecycleViewStateItem,
  index: number,
): RuntimeLifecyclePanelTimelineItem {
  return {
    id: `${item.source}:${index}:${item.kind}`,
    source: item.source,
    sourceLabel: item.source === "startup" ? "Startup" : "Shutdown",
    kind: item.kind,
    phase: item.phase,
    tone: item.tone,
    statusLabel: itemStatusLabel(item),
    title: item.title,
    summary: item.summary,
    badges: itemBadges(item),
  };
}

function itemBadges(
  item: RuntimeLifecycleViewStateItem,
): RuntimeLifecyclePanelTimelineBadge[] {
  const badges: RuntimeLifecyclePanelTimelineBadge[] = [item.source];
  if (item.lifecycleComplete) {
    badges.push("complete");
  }
  if (item.userActionRequired) {
    badges.push("action_required");
  }
  if (item.retryable) {
    badges.push("retryable");
  }
  return badges;
}

function statusLabel(readiness: RuntimeLifecycleShellReadiness): string {
  switch (readiness) {
    case "idle":
      return "Idle";
    case "busy":
      return "Starting";
    case "ready":
      return "Ready";
    case "attention_required":
      return "Needs attention";
    case "shutting_down":
      return "Shutting down";
    case "stopped":
      return "Stopped";
  }
}

function itemStatusLabel(item: RuntimeLifecycleViewStateItem): string {
  switch (item.phase) {
    case "idle":
      return "Idle";
    case "starting":
      return "Starting";
    case "waiting":
      return "Waiting";
    case "ready":
      return "Ready";
    case "blocked":
      return "Blocked";
    case "timed_out":
      return "Timed out";
    case "shutting_down":
      return "Shutting down";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
  }
}

function waitLabel(readiness: RuntimeLifecycleShellReadiness): string {
  return readiness === "shutting_down" ? "Shutting down" : "Working";
}

function ariaLive(
  readiness: RuntimeLifecycleShellReadiness,
): RuntimeLifecyclePanelSnapshot["ariaLive"] {
  if (readiness === "attention_required") {
    return "assertive";
  }
  if (readiness === "idle") {
    return "off";
  }
  return "polite";
}

function clonePanelTimelineItem(
  item: RuntimeLifecyclePanelTimelineItem,
): RuntimeLifecyclePanelTimelineItem {
  return {
    ...item,
    badges: [...item.badges],
  };
}
