import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import type { RuntimeWorkbenchShortcutId } from "./runtime-workbench-shortcuts.js";
import type {
  RuntimeWorkbenchHostSession,
  RuntimeWorkbenchHostSessionErrorHandler,
  RuntimeWorkbenchHostSessionSnapshot,
} from "./runtime-workbench-host-session.js";
import type { RuntimeWorkbenchInteractionCommand } from "./runtime-workbench-interaction.js";
import type { RuntimeWorkbenchPanelId } from "./runtime-workbench-session.js";

export type RuntimeWorkbenchShellPanelStatus = "empty" | "active" | "disposed";

export type RuntimeWorkbenchShellTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger";

export type RuntimeWorkbenchShellActionSlot =
  | "navigation"
  | "primary"
  | "secondary"
  | "destructive";

export const RUNTIME_WORKBENCH_SHELL_ACTION_IDS = [
  "show_lifecycle_panel",
  "show_stream_panel",
  "open_lifecycle_panel_session",
  "dispose_lifecycle_panel_session",
  "open_runtime_stream_session",
  "dispose_runtime_stream_session",
] as const;

export type RuntimeWorkbenchShellActionId =
  (typeof RUNTIME_WORKBENCH_SHELL_ACTION_IDS)[number];

export interface RuntimeWorkbenchShellPanelTab {
  readonly id: RuntimeWorkbenchPanelId;
  readonly label: string;
  readonly title: string;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly status: RuntimeWorkbenchShellPanelStatus;
  readonly badgeLabel: string | null;
  readonly tone: RuntimeWorkbenchShellTone;
}

export interface RuntimeWorkbenchShellAction {
  readonly id: RuntimeWorkbenchShellActionId;
  readonly label: string;
  readonly title: string;
  readonly slot: RuntimeWorkbenchShellActionSlot;
  readonly tone: RuntimeWorkbenchShellTone;
  readonly targetPanel: RuntimeWorkbenchPanelId;
  readonly enabled: boolean;
  readonly requiresOptions: boolean;
  readonly shortcutIds: readonly RuntimeWorkbenchShortcutId[];
}

export interface RuntimeWorkbenchShellShortcutHint {
  readonly id: RuntimeWorkbenchShortcutId;
  readonly label: string;
  readonly title: string;
  readonly keys: readonly string[];
  readonly enabled: boolean;
}

export interface RuntimeWorkbenchShellStatusItem {
  readonly id:
    | "active_panel"
    | "lifecycle_panel"
    | "runtime_stream"
    | "last_shortcut";
  readonly label: string;
  readonly value: string;
  readonly tone: RuntimeWorkbenchShellTone;
}

export interface RuntimeWorkbenchShellEmptyState {
  readonly title: string;
  readonly summary: string;
}

export interface RuntimeWorkbenchShellSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly activePanelLabel: string;
  readonly lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus;
  readonly runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus;
  readonly runtimeStreamChannelLabel: string | null;
  readonly lastHandledShortcutLabel: string | null;
  readonly panels: readonly RuntimeWorkbenchShellPanelTab[];
  readonly actions: readonly RuntimeWorkbenchShellAction[];
  readonly shortcutHints: readonly RuntimeWorkbenchShellShortcutHint[];
  readonly statusItems: readonly RuntimeWorkbenchShellStatusItem[];
  readonly availableActionIds: readonly RuntimeWorkbenchShellActionId[];
  readonly enabledActionIds: readonly RuntimeWorkbenchShellActionId[];
  readonly disposed: boolean;
  readonly ariaLive: "off" | "polite" | "assertive";
  readonly emptyState: RuntimeWorkbenchShellEmptyState | null;
}

export type RuntimeWorkbenchShellPresenterListener = () => void;

export type RuntimeWorkbenchShellPresenterErrorHandler =
  RuntimeWorkbenchHostSessionErrorHandler;

export interface RuntimeWorkbenchShellPresenter {
  readonly getSnapshot: () => RuntimeWorkbenchShellSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchShellSnapshot;
  readonly snapshot: () => RuntimeWorkbenchShellSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchShellPresenterListener,
  ) => RuntimeStatusUnsubscribe;
  readonly dispatch: (
    command: RuntimeWorkbenchInteractionCommand,
  ) => Promise<RuntimeWorkbenchShellSnapshot>;
  readonly setActivePanel: (
    panel: RuntimeWorkbenchPanelId,
  ) => RuntimeWorkbenchShellSnapshot;
  readonly resolveKeyEvent: RuntimeWorkbenchHostSession["resolveKeyEvent"];
  readonly handleKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => Promise<RuntimeWorkbenchShellSnapshot>;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeWorkbenchShellPresenterOptions {
  readonly host: RuntimeWorkbenchHostSession;
  readonly onError?: RuntimeWorkbenchShellPresenterErrorHandler;
}

export function createRuntimeWorkbenchShellPresenter(
  options: CreateRuntimeWorkbenchShellPresenterOptions,
): RuntimeWorkbenchShellPresenter {
  const listeners = new Set<RuntimeWorkbenchShellPresenterListener>();
  let hostUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let suppressHostPublish = false;
  let disposed = false;

  const initialSnapshot = freezeRuntimeWorkbenchShellSnapshot(
    buildRuntimeWorkbenchShellSnapshot(
      options.host.getSnapshot(),
      options.host.isDisposed(),
    ),
  );
  let currentSignature =
    runtimeWorkbenchShellSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break shell presenter propagation.
    }
  };

  const isDisposed = (): boolean => disposed || options.host.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime workbench shell presenter is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeWorkbenchShellSnapshot => {
    const nextSnapshot = freezeRuntimeWorkbenchShellSnapshot(
      buildRuntimeWorkbenchShellSnapshot(
        options.host.getSnapshot(),
        isDisposed(),
      ),
    );
    const nextSignature = runtimeWorkbenchShellSnapshotSignature(nextSnapshot);
    if (forceRefresh || nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = nextSnapshot;
    }
    return currentSnapshot;
  };

  const publishIfChanged = (forceRefresh = false): void => {
    if (disposed && !forceRefresh) {
      return;
    }
    const previousSignature = currentSignature;
    captureSnapshot(forceRefresh);
    if (!forceRefresh && currentSignature === previousSignature) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensureHostSubscription = (): void => {
    if (listeners.size === 0 || hostUnsubscribe !== undefined || isDisposed()) {
      return;
    }
    hostUnsubscribe = options.host.subscribe(() => {
      if (suppressHostPublish) {
        return;
      }
      publishIfChanged();
    });
  };

  const releaseHostSubscription = (): void => {
    hostUnsubscribe?.();
    hostUnsubscribe = undefined;
  };

  const runWithSuppressedHostPublish = async (
    action: () => Promise<unknown>,
  ): Promise<RuntimeWorkbenchShellSnapshot> => {
    suppressHostPublish = true;
    try {
      await action();
    } finally {
      suppressHostPublish = false;
    }
    publishIfChanged();
    return captureSnapshot();
  };

  return {
    getSnapshot: () => captureSnapshot(),
    getServerSnapshot: () => captureSnapshot(),
    snapshot: () => captureSnapshot(),
    subscribe: (listener) => {
      if (isDisposed()) {
        return () => false;
      }
      listeners.add(listener);
      ensureHostSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseHostSubscription();
        }
        return deleted;
      };
    },
    dispatch: async (command) => {
      assertActive();
      return runWithSuppressedHostPublish(async () => {
        await options.host.dispatch(command);
      });
    },
    setActivePanel: (panel) => {
      assertActive();
      suppressHostPublish = true;
      try {
        options.host.setActivePanel(panel);
      } finally {
        suppressHostPublish = false;
      }
      publishIfChanged();
      return captureSnapshot();
    },
    resolveKeyEvent: (event) => {
      if (isDisposed()) {
        return null;
      }
      return options.host.resolveKeyEvent(event);
    },
    handleKeyEvent: async (event) => {
      assertActive();
      return runWithSuppressedHostPublish(async () => {
        await options.host.handleKeyEvent(event);
      });
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseHostSubscription();
      publishIfChanged(true);
      listeners.clear();
      return true;
    },
    isDisposed,
  };
}

export function buildRuntimeWorkbenchShellSnapshot(
  host: RuntimeWorkbenchHostSessionSnapshot,
  disposed = host.disposed,
): RuntimeWorkbenchShellSnapshot {
  const lifecyclePanelStatus = disposed
    ? "disposed"
    : panelStatus(host.lifecyclePanel);
  const runtimeStreamStatus = disposed
    ? "disposed"
    : panelStatus(host.runtimeStream);
  const activePanelLabel = panelLabel(host.activePanel);
  const runtimeStreamChannelLabel =
    disposed || host.runtimeStream.activeChannel === null
      ? null
      : formatRuntimeStreamChannelLabel(host.runtimeStream.activeChannel);
  const lastHandledShortcutLabel =
    disposed || host.lastHandledShortcutId === null
      ? null
      : shortcutLabel(host.lastHandledShortcutId);
  const actions = buildShellActions(host, disposed);
  const availableActionIds = actions.map((action) => action.id);
  const enabledActionIds = actions
    .filter((action) => action.enabled)
    .map((action) => action.id);
  return freezeRuntimeWorkbenchShellSnapshot({
    activePanel: host.activePanel,
    activePanelLabel,
    lifecyclePanelStatus,
    runtimeStreamStatus,
    runtimeStreamChannelLabel,
    lastHandledShortcutLabel,
    panels: buildPanelTabs(
      host,
      lifecyclePanelStatus,
      runtimeStreamStatus,
      disposed,
    ),
    actions,
    shortcutHints: buildShortcutHints(host, disposed),
    statusItems: buildStatusItems(
      host,
      lifecyclePanelStatus,
      runtimeStreamStatus,
      runtimeStreamChannelLabel,
      lastHandledShortcutLabel,
      disposed,
    ),
    availableActionIds: Object.freeze(availableActionIds),
    enabledActionIds: Object.freeze(enabledActionIds),
    disposed,
    ariaLive: shellAriaLive(
      disposed,
      lifecyclePanelStatus,
      runtimeStreamStatus,
    ),
    emptyState:
      lifecyclePanelStatus === "empty" && runtimeStreamStatus === "empty"
        ? {
            title: "No active session",
            summary: "Runtime activity will appear after a session opens.",
          }
        : null,
  });
}

function buildPanelTabs(
  host: RuntimeWorkbenchHostSessionSnapshot,
  lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus,
  runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus,
  disposed: boolean,
): RuntimeWorkbenchShellPanelTab[] {
  return [
    panelTab({
      id: "lifecycle",
      label: "Lifecycle",
      title: "Runtime lifecycle panel",
      active: host.activePanel === "lifecycle",
      enabled: !disposed,
      status: lifecyclePanelStatus,
    }),
    panelTab({
      id: "stream",
      label: "Stream",
      title: "Runtime stream panel",
      active: host.activePanel === "stream",
      enabled: !disposed,
      status: runtimeStreamStatus,
    }),
  ];
}

function buildShellActions(
  host: RuntimeWorkbenchHostSessionSnapshot,
  disposed: boolean,
): RuntimeWorkbenchShellAction[] {
  return RUNTIME_WORKBENCH_SHELL_ACTION_IDS.filter((actionId) =>
    host.availableCommandIds.includes(actionId),
  ).map((actionId) =>
    shellAction({
      id: actionId,
      activePanel: host.activePanel,
      enabled: !disposed && host.enabledCommandIds.includes(actionId),
      shortcutIds: shortcutIdsForAction(actionId, host),
    }),
  );
}

function buildShortcutHints(
  host: RuntimeWorkbenchHostSessionSnapshot,
  disposed: boolean,
): RuntimeWorkbenchShellShortcutHint[] {
  return host.availableShortcutIds.map((shortcutId) =>
    shortcutHint({
      id: shortcutId,
      enabled: !disposed && host.enabledShortcutIds.includes(shortcutId),
    }),
  );
}

function buildStatusItems(
  host: RuntimeWorkbenchHostSessionSnapshot,
  lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus,
  runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus,
  runtimeStreamChannelLabel: string | null,
  lastHandledShortcutLabel: string | null,
  disposed: boolean,
): RuntimeWorkbenchShellStatusItem[] {
  return [
    statusItem({
      id: "active_panel",
      label: "Active panel",
      value: panelLabel(host.activePanel),
      tone: disposed ? "danger" : "neutral",
    }),
    statusItem({
      id: "lifecycle_panel",
      label: "Lifecycle",
      value: panelStatusLabel(lifecyclePanelStatus),
      tone: panelStatusTone(lifecyclePanelStatus),
    }),
    statusItem({
      id: "runtime_stream",
      label: "Stream",
      value:
        runtimeStreamChannelLabel === null
          ? panelStatusLabel(runtimeStreamStatus)
          : runtimeStreamChannelLabel,
      tone: panelStatusTone(runtimeStreamStatus),
    }),
    statusItem({
      id: "last_shortcut",
      label: "Shortcut",
      value: lastHandledShortcutLabel ?? "None",
      tone: lastHandledShortcutLabel === null ? "neutral" : "accent",
    }),
  ];
}

function panelTab(options: {
  readonly id: RuntimeWorkbenchPanelId;
  readonly label: string;
  readonly title: string;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly status: RuntimeWorkbenchShellPanelStatus;
}): RuntimeWorkbenchShellPanelTab {
  return Object.freeze({
    ...options,
    badgeLabel: panelBadgeLabel(options.status),
    tone: panelStatusTone(options.status),
  });
}

function shellAction(options: {
  readonly id: RuntimeWorkbenchShellActionId;
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly enabled: boolean;
  readonly shortcutIds: readonly RuntimeWorkbenchShortcutId[];
}): RuntimeWorkbenchShellAction {
  const metadata = shellActionMetadata(options.id, options.activePanel);
  return Object.freeze({
    id: options.id,
    label: metadata.label,
    title: metadata.title,
    slot: metadata.slot,
    tone: metadata.tone,
    targetPanel: metadata.targetPanel,
    enabled: options.enabled,
    requiresOptions: metadata.requiresOptions,
    shortcutIds: Object.freeze([...options.shortcutIds]),
  });
}

function shortcutHint(options: {
  readonly id: RuntimeWorkbenchShortcutId;
  readonly enabled: boolean;
}): RuntimeWorkbenchShellShortcutHint {
  return Object.freeze({
    id: options.id,
    label: shortcutLabel(options.id),
    title: shortcutTitle(options.id),
    keys: Object.freeze(shortcutKeys(options.id)),
    enabled: options.enabled,
  });
}

function statusItem(
  item: RuntimeWorkbenchShellStatusItem,
): RuntimeWorkbenchShellStatusItem {
  return Object.freeze({ ...item });
}

function shellActionMetadata(
  actionId: RuntimeWorkbenchShellActionId,
  activePanel: RuntimeWorkbenchPanelId,
): Omit<RuntimeWorkbenchShellAction, "id" | "enabled" | "shortcutIds"> {
  switch (actionId) {
    case "show_lifecycle_panel":
      return {
        label: "Lifecycle",
        title: "Show runtime lifecycle panel.",
        slot: "navigation",
        tone: "neutral",
        targetPanel: "lifecycle",
        requiresOptions: false,
      };
    case "show_stream_panel":
      return {
        label: "Stream",
        title: "Show runtime stream panel.",
        slot: "navigation",
        tone: "neutral",
        targetPanel: "stream",
        requiresOptions: false,
      };
    case "open_lifecycle_panel_session":
      return {
        label: "Open lifecycle",
        title: "Open a runtime lifecycle panel session.",
        slot: activePanel === "lifecycle" ? "primary" : "secondary",
        tone: "accent",
        targetPanel: "lifecycle",
        requiresOptions: false,
      };
    case "dispose_lifecycle_panel_session":
      return {
        label: "Close lifecycle",
        title: "Close the active lifecycle panel session.",
        slot: "destructive",
        tone: "danger",
        targetPanel: "lifecycle",
        requiresOptions: false,
      };
    case "open_runtime_stream_session":
      return {
        label: "Open stream",
        title: "Open a runtime stream session.",
        slot: activePanel === "stream" ? "primary" : "secondary",
        tone: "accent",
        targetPanel: "stream",
        requiresOptions: true,
      };
    case "dispose_runtime_stream_session":
      return {
        label: "Close stream",
        title: "Close the active runtime stream session.",
        slot: "destructive",
        tone: "danger",
        targetPanel: "stream",
        requiresOptions: false,
      };
  }
}

function shortcutIdsForAction(
  actionId: RuntimeWorkbenchShellActionId,
  host: RuntimeWorkbenchHostSessionSnapshot,
): RuntimeWorkbenchShortcutId[] {
  const shortcutIds = DEFAULT_SHELL_ACTION_SHORTCUT_IDS[actionId];
  return shortcutIds.filter((shortcutId) =>
    host.availableShortcutIds.includes(shortcutId),
  );
}

const DEFAULT_SHELL_ACTION_SHORTCUT_IDS: Readonly<
  Record<RuntimeWorkbenchShellActionId, readonly RuntimeWorkbenchShortcutId[]>
> = {
  show_lifecycle_panel: ["show_lifecycle_panel"],
  show_stream_panel: ["show_stream_panel"],
  open_lifecycle_panel_session: [],
  dispose_lifecycle_panel_session: ["dispose_lifecycle_panel_session"],
  open_runtime_stream_session: [],
  dispose_runtime_stream_session: ["dispose_runtime_stream_session"],
};

function panelStatus(
  panel:
    | RuntimeWorkbenchHostSessionSnapshot["lifecyclePanel"]
    | RuntimeWorkbenchHostSessionSnapshot["runtimeStream"],
): RuntimeWorkbenchShellPanelStatus {
  if (panel.disposed) {
    return "disposed";
  }
  return panel.active ? "active" : "empty";
}

function panelStatusLabel(status: RuntimeWorkbenchShellPanelStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "disposed":
      return "Disposed";
    case "empty":
      return "Idle";
  }
}

function panelBadgeLabel(
  status: RuntimeWorkbenchShellPanelStatus,
): string | null {
  return status === "empty" ? null : panelStatusLabel(status);
}

function panelStatusTone(
  status: RuntimeWorkbenchShellPanelStatus,
): RuntimeWorkbenchShellTone {
  switch (status) {
    case "active":
      return "success";
    case "disposed":
      return "danger";
    case "empty":
      return "neutral";
  }
}

function panelLabel(panel: RuntimeWorkbenchPanelId): string {
  switch (panel) {
    case "lifecycle":
      return "Lifecycle";
    case "stream":
      return "Stream";
  }
}

function formatRuntimeStreamChannelLabel(
  channel: NonNullable<
    RuntimeWorkbenchHostSessionSnapshot["runtimeStream"]["activeChannel"]
  >,
): string {
  return channel.kind === "planning"
    ? `Planning ${channel.sessionId}`
    : `Run ${channel.runId}`;
}

function shortcutLabel(shortcutId: RuntimeWorkbenchShortcutId): string {
  switch (shortcutId) {
    case "show_lifecycle_panel":
      return "Show lifecycle";
    case "show_stream_panel":
      return "Show stream";
    case "focus_lifecycle_primary_command":
      return "Focus primary lifecycle command";
    case "focus_next_lifecycle_command":
      return "Focus next lifecycle command";
    case "focus_previous_lifecycle_command":
      return "Focus previous lifecycle command";
    case "activate_lifecycle_focused_command":
      return "Activate focused lifecycle command";
    case "refresh_lifecycle_status":
      return "Refresh lifecycle status";
    case "start_or_retry_lifecycle_runtime":
      return "Start or retry lifecycle runtime";
    case "stop_lifecycle_runtime":
      return "Stop lifecycle runtime";
    case "focus_next_lifecycle_timeline_item":
      return "Focus next lifecycle timeline item";
    case "focus_previous_lifecycle_timeline_item":
      return "Focus previous lifecycle timeline item";
    case "select_lifecycle_timeline_item":
      return "Select lifecycle timeline item";
    case "clear_lifecycle_selection":
      return "Clear lifecycle selection";
    case "dispose_lifecycle_panel_session":
      return "Close lifecycle session";
    case "dispose_runtime_stream_session":
      return "Close stream session";
  }
}

function shortcutTitle(shortcutId: RuntimeWorkbenchShortcutId): string {
  return `${shortcutLabel(shortcutId)}.`;
}

function shortcutKeys(shortcutId: RuntimeWorkbenchShortcutId): string[] {
  switch (shortcutId) {
    case "show_lifecycle_panel":
      return ["Ctrl", "1"];
    case "show_stream_panel":
      return ["Ctrl", "2"];
    case "focus_lifecycle_primary_command":
      return ["Alt", "Home"];
    case "focus_next_lifecycle_command":
      return ["Alt", "ArrowRight"];
    case "focus_previous_lifecycle_command":
      return ["Alt", "ArrowLeft"];
    case "activate_lifecycle_focused_command":
    case "select_lifecycle_timeline_item":
      return ["Enter"];
    case "refresh_lifecycle_status":
      return ["F5"];
    case "start_or_retry_lifecycle_runtime":
      return ["Ctrl", "Enter"];
    case "stop_lifecycle_runtime":
      return ["Ctrl", "Escape"];
    case "focus_next_lifecycle_timeline_item":
      return ["Alt", "ArrowDown"];
    case "focus_previous_lifecycle_timeline_item":
      return ["Alt", "ArrowUp"];
    case "clear_lifecycle_selection":
      return ["Escape"];
    case "dispose_lifecycle_panel_session":
    case "dispose_runtime_stream_session":
      return ["Shift", "Escape"];
  }
}

function shellAriaLive(
  disposed: boolean,
  lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus,
  runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus,
): RuntimeWorkbenchShellSnapshot["ariaLive"] {
  if (disposed) {
    return "assertive";
  }
  if (lifecyclePanelStatus === "active" || runtimeStreamStatus === "active") {
    return "polite";
  }
  return "off";
}

function freezeRuntimeWorkbenchShellSnapshot(
  snapshot: RuntimeWorkbenchShellSnapshot,
): RuntimeWorkbenchShellSnapshot {
  return Object.freeze({
    ...snapshot,
    panels: Object.freeze(snapshot.panels.map((panel) => panelTab(panel))),
    actions: Object.freeze(
      snapshot.actions.map((action) =>
        Object.freeze({
          ...action,
          shortcutIds: Object.freeze([...action.shortcutIds]),
        }),
      ),
    ),
    shortcutHints: Object.freeze(
      snapshot.shortcutHints.map((shortcut) =>
        Object.freeze({
          ...shortcut,
          keys: Object.freeze([...shortcut.keys]),
        }),
      ),
    ),
    statusItems: Object.freeze(
      snapshot.statusItems.map((item) => Object.freeze({ ...item })),
    ),
    availableActionIds: Object.freeze([...snapshot.availableActionIds]),
    enabledActionIds: Object.freeze([...snapshot.enabledActionIds]),
    emptyState:
      snapshot.emptyState === null
        ? null
        : Object.freeze({ ...snapshot.emptyState }),
  });
}

function runtimeWorkbenchShellSnapshotSignature(
  snapshot: RuntimeWorkbenchShellSnapshot,
): string {
  return JSON.stringify(snapshot);
}
