import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  RuntimeLifecyclePanelCommand,
  RuntimeLifecyclePanelSnapshot,
  RuntimeLifecyclePanelTimelineItem,
} from "./runtime-lifecycle-panel-presenter.js";
import type { RuntimeLifecyclePanelInteractionSnapshot } from "./runtime-lifecycle-panel-interaction.js";
import type {
  RuntimeLifecyclePanelTimelineFilterOption,
  RuntimeLifecyclePanelViewModelSnapshot,
} from "./runtime-lifecycle-panel-view-model.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import type { RuntimeWorkbenchShortcutId } from "./runtime-workbench-shortcuts.js";
import type {
  RuntimeWorkbenchHostSession,
  RuntimeWorkbenchHostSessionErrorHandler,
  RuntimeWorkbenchHostRuntimeStreamEventSnapshot,
  RuntimeWorkbenchHostRuntimeStreamFullReloadSnapshot,
  RuntimeWorkbenchHostRuntimeStreamPanelSnapshot,
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

export type RuntimeWorkbenchShellDockItemId =
  | "workflow_canvas"
  | "lifecycle_panel"
  | "runtime_stream"
  | "task_drawer";

export interface RuntimeWorkbenchShellDockItem {
  readonly id: RuntimeWorkbenchShellDockItemId;
  readonly label: string;
  readonly title: string;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly status: RuntimeWorkbenchShellPanelStatus;
  readonly badgeLabel: string | null;
  readonly tone: RuntimeWorkbenchShellTone;
  readonly targetPanel: RuntimeWorkbenchPanelId | null;
}

export type RuntimeWorkbenchShellFileTreeNodeId =
  | "workspace_root"
  | "workflow_graph"
  | "runtime_stream"
  | "reviews"
  | "accepted_specs";

export type RuntimeWorkbenchShellFileTreeNodeDepth = 0 | 1;

export interface RuntimeWorkbenchShellFileTreeNode {
  readonly id: RuntimeWorkbenchShellFileTreeNodeId;
  readonly label: string;
  readonly pathLabel: string;
  readonly statusLabel: string;
  readonly depth: RuntimeWorkbenchShellFileTreeNodeDepth;
  readonly active: boolean;
  readonly tone: RuntimeWorkbenchShellTone;
}

export interface RuntimeWorkbenchShellFileTreeSnapshot {
  readonly title: string;
  readonly summary: string;
  readonly nodes: readonly RuntimeWorkbenchShellFileTreeNode[];
}

export type RuntimeWorkbenchShellTaskDrawerItemId =
  | "active_panel"
  | "lifecycle_panel"
  | "runtime_stream"
  | "visible_items"
  | "unread_events";

export interface RuntimeWorkbenchShellTaskDrawerItem {
  readonly id: RuntimeWorkbenchShellTaskDrawerItemId;
  readonly label: string;
  readonly value: string;
  readonly tone: RuntimeWorkbenchShellTone;
}

export interface RuntimeWorkbenchShellTaskDrawerSnapshot {
  readonly title: string;
  readonly summary: string;
  readonly collapsedSummary: string;
  readonly collapsible: boolean;
  readonly defaultCollapsed: boolean;
  readonly expandLabel: string;
  readonly collapseLabel: string;
  readonly items: readonly RuntimeWorkbenchShellTaskDrawerItem[];
}

export interface RuntimeWorkbenchShellChatBoxSnapshot {
  readonly title: string;
  readonly placeholder: string;
  readonly enabled: boolean;
  readonly statusLabel: string;
  readonly collapsedSummary: string;
  readonly collapsible: boolean;
  readonly defaultCollapsed: boolean;
  readonly expandLabel: string;
  readonly collapseLabel: string;
}

export interface RuntimeWorkbenchShellChromeSnapshot {
  readonly dockItems: readonly RuntimeWorkbenchShellDockItem[];
  readonly fileTree: RuntimeWorkbenchShellFileTreeSnapshot;
  readonly taskDrawer: RuntimeWorkbenchShellTaskDrawerSnapshot;
  readonly chatBox: RuntimeWorkbenchShellChatBoxSnapshot;
}

export interface RuntimeWorkbenchShellEmptyState {
  readonly title: string;
  readonly summary: string;
}

export type RuntimeWorkbenchShellRuntimeStreamEventSnapshot =
  RuntimeWorkbenchHostRuntimeStreamEventSnapshot;

export type RuntimeWorkbenchShellRuntimeStreamFullReloadSnapshot =
  RuntimeWorkbenchHostRuntimeStreamFullReloadSnapshot;

export type RuntimeWorkbenchShellRuntimeStreamPanelSnapshot =
  RuntimeWorkbenchHostRuntimeStreamPanelSnapshot;

export type RuntimeWorkbenchShellLifecyclePanelSnapshot =
  RuntimeLifecyclePanelInteractionSnapshot;

export interface RuntimeWorkbenchShellSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly activePanelLabel: string;
  readonly lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus;
  readonly lifecyclePanel: RuntimeWorkbenchShellLifecyclePanelSnapshot | null;
  readonly runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus;
  readonly runtimeStreamChannelLabel: string | null;
  readonly runtimeStreamPanel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot | null;
  readonly lastHandledShortcutLabel: string | null;
  readonly panels: readonly RuntimeWorkbenchShellPanelTab[];
  readonly actions: readonly RuntimeWorkbenchShellAction[];
  readonly shortcutHints: readonly RuntimeWorkbenchShellShortcutHint[];
  readonly statusItems: readonly RuntimeWorkbenchShellStatusItem[];
  readonly chrome: RuntimeWorkbenchShellChromeSnapshot;
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
  const lifecyclePanel =
    disposed || host.lifecyclePanel.activeSession === null
      ? null
      : cloneRuntimeWorkbenchShellLifecyclePanel(
          host.lifecyclePanel.activeSession.interaction,
        );
  const runtimeStreamStatus = disposed
    ? "disposed"
    : panelStatus(host.runtimeStream);
  const activePanelLabel = panelLabel(host.activePanel);
  const runtimeStreamChannelLabel =
    disposed || host.runtimeStream.activeChannel === null
      ? null
      : formatRuntimeStreamChannelLabel(host.runtimeStream.activeChannel);
  const runtimeStreamPanel =
    disposed || host.runtimeStreamPanel === null
      ? null
      : cloneRuntimeWorkbenchShellRuntimeStreamPanel(host.runtimeStreamPanel);
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
    lifecyclePanel,
    runtimeStreamStatus,
    runtimeStreamChannelLabel,
    runtimeStreamPanel,
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
    chrome: buildShellChrome(
      host,
      lifecyclePanelStatus,
      runtimeStreamStatus,
      runtimeStreamChannelLabel,
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

function buildShellChrome(
  host: RuntimeWorkbenchHostSessionSnapshot,
  lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus,
  runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus,
  runtimeStreamChannelLabel: string | null,
  disposed: boolean,
): RuntimeWorkbenchShellChromeSnapshot {
  const activePanelLabel = panelLabel(host.activePanel);
  const visibleItems = visibleTaskItemCount(host);
  const unreadEvents = host.runtimeStreamPanel?.read.unreadCount ?? 0;
  return freezeRuntimeWorkbenchShellChrome({
    dockItems: [
      dockItem({
        id: "workflow_canvas",
        label: "Canvas",
        title: "Workflow canvas.",
        active: false,
        enabled: false,
        status: "empty",
        targetPanel: null,
      }),
      dockItem({
        id: "lifecycle_panel",
        label: "Lifecycle",
        title: "Runtime lifecycle panel.",
        active: host.activePanel === "lifecycle",
        enabled: !disposed,
        status: lifecyclePanelStatus,
        targetPanel: "lifecycle",
      }),
      dockItem({
        id: "runtime_stream",
        label: "Stream",
        title: "Runtime stream panel.",
        active: host.activePanel === "stream",
        enabled: !disposed,
        status: runtimeStreamStatus,
        targetPanel: "stream",
      }),
      dockItem({
        id: "task_drawer",
        label: "Tasks",
        title: "Task drawer.",
        active: false,
        enabled: false,
        status: disposed ? "disposed" : "active",
        targetPanel: null,
      }),
    ],
    fileTree: {
      title: "File Tree",
      summary: `${activePanelLabel} focus anchors`,
      nodes: [
        fileTreeNode({
          id: "workspace_root",
          label: "Workspace",
          pathLabel: "workspace root",
          statusLabel: disposed ? "Disposed" : "Open",
          depth: 0,
          active: false,
          tone: disposed ? "danger" : "success",
        }),
        fileTreeNode({
          id: "workflow_graph",
          label: "Graph spec",
          pathLabel: "specs/schemas/workflow_graph.md",
          statusLabel: "Spec",
          depth: 1,
          active: false,
          tone: "neutral",
        }),
        fileTreeNode({
          id: "runtime_stream",
          label: "Runtime stream",
          pathLabel: runtimeStreamChannelLabel ?? "No active stream",
          statusLabel: panelStatusLabel(runtimeStreamStatus),
          depth: 1,
          active: host.activePanel === "stream",
          tone: panelStatusTone(runtimeStreamStatus),
        }),
        fileTreeNode({
          id: "reviews",
          label: "Review reports",
          pathLabel: "docs/reviews",
          statusLabel: "M1.5",
          depth: 1,
          active: false,
          tone: "accent",
        }),
        fileTreeNode({
          id: "accepted_specs",
          label: "Accepted specs",
          pathLabel: "specs",
          statusLabel: "Read-only",
          depth: 1,
          active: false,
          tone: "neutral",
        }),
      ],
    },
    taskDrawer: {
      title: "Task Drawer",
      summary: `${activePanelLabel} focus`,
      collapsedSummary: `${activePanelLabel} focus, ${visibleItems} visible, ${unreadEvents} unread`,
      collapsible: true,
      defaultCollapsed: false,
      expandLabel: "Expand drawer",
      collapseLabel: "Collapse drawer",
      items: [
        taskDrawerItem({
          id: "active_panel",
          label: "Active panel",
          value: activePanelLabel,
          tone: disposed ? "danger" : "neutral",
        }),
        taskDrawerItem({
          id: "lifecycle_panel",
          label: "Lifecycle",
          value: panelStatusLabel(lifecyclePanelStatus),
          tone: panelStatusTone(lifecyclePanelStatus),
        }),
        taskDrawerItem({
          id: "runtime_stream",
          label: "Stream",
          value:
            runtimeStreamChannelLabel ?? panelStatusLabel(runtimeStreamStatus),
          tone: panelStatusTone(runtimeStreamStatus),
        }),
        taskDrawerItem({
          id: "visible_items",
          label: "Visible",
          value: String(visibleItems),
          tone: "neutral",
        }),
        taskDrawerItem({
          id: "unread_events",
          label: "Unread",
          value: String(unreadEvents),
          tone: unreadEvents > 0 ? "accent" : "neutral",
        }),
      ],
    },
    chatBox: {
      title: "Chat Box",
      placeholder: "Ask about the active workflow",
      enabled: false,
      statusLabel: disposed ? "Disposed" : "Idle",
      collapsedSummary: `${activePanelLabel} focus, chat ${disposed ? "disposed" : "idle"}`,
      collapsible: true,
      defaultCollapsed: false,
      expandLabel: "Expand chat",
      collapseLabel: "Collapse chat",
    },
  });
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

function visibleTaskItemCount(
  host: RuntimeWorkbenchHostSessionSnapshot,
): number {
  if (host.activePanel === "stream") {
    return host.runtimeStreamPanel?.visibleEventCount ?? 0;
  }
  return (
    host.lifecyclePanel.activeSession?.interaction.view
      .visibleTimelineItemCount ?? 0
  );
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

function dockItem(options: {
  readonly id: RuntimeWorkbenchShellDockItemId;
  readonly label: string;
  readonly title: string;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly status: RuntimeWorkbenchShellPanelStatus;
  readonly targetPanel: RuntimeWorkbenchPanelId | null;
}): RuntimeWorkbenchShellDockItem {
  return Object.freeze({
    ...options,
    badgeLabel: panelBadgeLabel(options.status),
    tone: panelStatusTone(options.status),
  });
}

function fileTreeNode(
  node: RuntimeWorkbenchShellFileTreeNode,
): RuntimeWorkbenchShellFileTreeNode {
  return Object.freeze({
    id: node.id,
    label: node.label,
    pathLabel: node.pathLabel,
    statusLabel: node.statusLabel,
    depth: node.depth,
    active: node.active,
    tone: node.tone,
  });
}

function taskDrawerItem(
  item: RuntimeWorkbenchShellTaskDrawerItem,
): RuntimeWorkbenchShellTaskDrawerItem {
  return Object.freeze({ ...item });
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
    chrome: freezeRuntimeWorkbenchShellChrome(snapshot.chrome),
    runtimeStreamPanel:
      snapshot.runtimeStreamPanel === null
        ? null
        : cloneRuntimeWorkbenchShellRuntimeStreamPanel(
            snapshot.runtimeStreamPanel,
          ),
    lifecyclePanel:
      snapshot.lifecyclePanel === null
        ? null
        : cloneRuntimeWorkbenchShellLifecyclePanel(snapshot.lifecyclePanel),
    availableActionIds: Object.freeze([...snapshot.availableActionIds]),
    enabledActionIds: Object.freeze([...snapshot.enabledActionIds]),
    emptyState:
      snapshot.emptyState === null
        ? null
        : Object.freeze({ ...snapshot.emptyState }),
  });
}

function freezeRuntimeWorkbenchShellChrome(
  chrome: RuntimeWorkbenchShellChromeSnapshot,
): RuntimeWorkbenchShellChromeSnapshot {
  return Object.freeze({
    dockItems: Object.freeze(
      chrome.dockItems.map((item) =>
        dockItem({
          id: item.id,
          label: item.label,
          title: item.title,
          active: item.active,
          enabled: item.enabled,
          status: item.status,
          targetPanel: item.targetPanel,
        }),
      ),
    ),
    fileTree: Object.freeze({
      title: chrome.fileTree.title,
      summary: chrome.fileTree.summary,
      nodes: Object.freeze(
        chrome.fileTree.nodes.map((node) => fileTreeNode(node)),
      ),
    }),
    taskDrawer: Object.freeze({
      title: chrome.taskDrawer.title,
      summary: chrome.taskDrawer.summary,
      collapsedSummary: chrome.taskDrawer.collapsedSummary,
      collapsible: chrome.taskDrawer.collapsible,
      defaultCollapsed: chrome.taskDrawer.defaultCollapsed,
      expandLabel: chrome.taskDrawer.expandLabel,
      collapseLabel: chrome.taskDrawer.collapseLabel,
      items: Object.freeze(
        chrome.taskDrawer.items.map((item) => taskDrawerItem(item)),
      ),
    }),
    chatBox: Object.freeze({
      title: chrome.chatBox.title,
      placeholder: chrome.chatBox.placeholder,
      enabled: chrome.chatBox.enabled,
      statusLabel: chrome.chatBox.statusLabel,
      collapsedSummary: chrome.chatBox.collapsedSummary,
      collapsible: chrome.chatBox.collapsible,
      defaultCollapsed: chrome.chatBox.defaultCollapsed,
      expandLabel: chrome.chatBox.expandLabel,
      collapseLabel: chrome.chatBox.collapseLabel,
    }),
  });
}

function runtimeWorkbenchShellSnapshotSignature(
  snapshot: RuntimeWorkbenchShellSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function cloneRuntimeWorkbenchShellLifecyclePanel(
  panel: RuntimeWorkbenchShellLifecyclePanelSnapshot,
): RuntimeWorkbenchShellLifecyclePanelSnapshot {
  return Object.freeze({
    view: cloneRuntimeWorkbenchShellLifecyclePanelView(panel.view),
    disposed: panel.disposed,
    focusTarget: panel.focusTarget,
    focusedCommandId: panel.focusedCommandId,
    focusedTimelineItemId: panel.focusedTimelineItemId,
    availableCommandIds: Object.freeze([...panel.availableCommandIds]),
    enabledCommandIds: Object.freeze([...panel.enabledCommandIds]),
    canActivateFocusedCommand: panel.canActivateFocusedCommand,
    canSelectFocusedTimelineItem: panel.canSelectFocusedTimelineItem,
  });
}

function cloneRuntimeWorkbenchShellLifecyclePanelView(
  view: RuntimeLifecyclePanelViewModelSnapshot,
): RuntimeLifecyclePanelViewModelSnapshot {
  return Object.freeze({
    panel: cloneRuntimeWorkbenchShellLifecyclePanelStatus(view.panel),
    disposed: view.disposed,
    timelineFilter: view.timelineFilter,
    timelineFilterOptions: Object.freeze(
      view.timelineFilterOptions.map(
        cloneRuntimeWorkbenchShellLifecyclePanelTimelineFilterOption,
      ),
    ),
    visibleTimelineItems: Object.freeze(
      view.visibleTimelineItems.map(
        cloneRuntimeWorkbenchShellLifecyclePanelTimelineItem,
      ),
    ),
    selectedTimelineItemId: view.selectedTimelineItemId,
    selectedTimelineItem:
      view.selectedTimelineItem === null
        ? null
        : cloneRuntimeWorkbenchShellLifecyclePanelTimelineItem(
            view.selectedTimelineItem,
          ),
    totalTimelineItems: view.totalTimelineItems,
    visibleTimelineItemCount: view.visibleTimelineItemCount,
    hiddenTimelineItemCount: view.hiddenTimelineItemCount,
  });
}

function cloneRuntimeWorkbenchShellLifecyclePanelStatus(
  panel: RuntimeLifecyclePanelSnapshot,
): RuntimeLifecyclePanelSnapshot {
  return Object.freeze({
    readiness: panel.readiness,
    tone: panel.tone,
    statusLabel: panel.statusLabel,
    title: panel.title,
    summary: panel.summary,
    runtimeReady: panel.runtimeReady,
    busy: panel.busy,
    terminal: panel.terminal,
    lifecycleComplete: panel.lifecycleComplete,
    userActionRequired: panel.userActionRequired,
    retryable: panel.retryable,
    startupTotal: panel.startupTotal,
    shutdownTotal: panel.shutdownTotal,
    started: panel.started,
    disposed: panel.disposed,
    ariaLive: panel.ariaLive,
    primaryCommand:
      panel.primaryCommand === null
        ? null
        : cloneRuntimeWorkbenchShellLifecyclePanelCommand(panel.primaryCommand),
    secondaryCommands: Object.freeze(
      panel.secondaryCommands.map(
        cloneRuntimeWorkbenchShellLifecyclePanelCommand,
      ),
    ),
    timelineItems: Object.freeze(
      panel.timelineItems.map(
        cloneRuntimeWorkbenchShellLifecyclePanelTimelineItem,
      ),
    ),
    emptyState:
      panel.emptyState === null ? null : Object.freeze({ ...panel.emptyState }),
  });
}

function cloneRuntimeWorkbenchShellLifecyclePanelCommand(
  command: RuntimeLifecyclePanelCommand,
): RuntimeLifecyclePanelCommand {
  return Object.freeze({ ...command });
}

function cloneRuntimeWorkbenchShellLifecyclePanelTimelineFilterOption(
  option: RuntimeLifecyclePanelTimelineFilterOption,
): RuntimeLifecyclePanelTimelineFilterOption {
  return Object.freeze({ ...option });
}

function cloneRuntimeWorkbenchShellLifecyclePanelTimelineItem(
  item: RuntimeLifecyclePanelTimelineItem,
): RuntimeLifecyclePanelTimelineItem {
  return Object.freeze({
    ...item,
    badges: Object.freeze([...item.badges]),
  });
}

function cloneRuntimeWorkbenchShellRuntimeStreamPanel(
  panel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot,
): RuntimeWorkbenchShellRuntimeStreamPanelSnapshot {
  return Object.freeze({
    status: panel.status,
    totalEvents: panel.totalEvents,
    bufferedEventCount: panel.bufferedEventCount,
    matchingEventCount: panel.matchingEventCount,
    visibleEventCount: panel.visibleEventCount,
    hiddenEventCount: panel.hiddenEventCount,
    foldedChildCount: panel.foldedChildCount,
    read: Object.freeze({ ...panel.read }),
    search: Object.freeze({ ...panel.search }),
    summaryItems: Object.freeze(
      panel.summaryItems.map(cloneRuntimeWorkbenchShellRuntimeStreamEvent),
    ),
    timelineItems: Object.freeze(
      panel.timelineItems.map(cloneRuntimeWorkbenchShellRuntimeStreamEvent),
    ),
    selectedEvent:
      panel.selectedEvent === null
        ? null
        : cloneRuntimeWorkbenchShellRuntimeStreamEvent(panel.selectedEvent),
    fullReload:
      panel.fullReload === null
        ? null
        : cloneRuntimeWorkbenchShellRuntimeStreamFullReload(panel.fullReload),
  });
}

function cloneRuntimeWorkbenchShellRuntimeStreamEvent(
  event: RuntimeWorkbenchShellRuntimeStreamEventSnapshot,
): RuntimeWorkbenchShellRuntimeStreamEventSnapshot {
  return Object.freeze({
    id: event.id,
    seq: event.seq,
    type: event.type,
    category: event.category,
    displayLevel: event.displayLevel,
    severity: event.severity,
    title: event.title,
    summary: event.summary,
    content: event.content,
    expandable: event.expandable,
    expanded: event.expanded,
    childCount: event.childCount,
    children: Object.freeze(
      event.children.map(cloneRuntimeWorkbenchShellRuntimeStreamEvent),
    ),
    createdAt: event.createdAt,
  });
}

function cloneRuntimeWorkbenchShellRuntimeStreamFullReload(
  fullReload: RuntimeWorkbenchShellRuntimeStreamFullReloadSnapshot,
): RuntimeWorkbenchShellRuntimeStreamFullReloadSnapshot {
  return Object.freeze({
    acknowledged: fullReload.acknowledged,
    lastEventId: fullReload.lastEventId,
    reason: fullReload.reason,
    ...(fullReload.status !== undefined ? { status: fullReload.status } : {}),
    ...(fullReload.errorCode !== undefined
      ? { errorCode: fullReload.errorCode }
      : {}),
  });
}
