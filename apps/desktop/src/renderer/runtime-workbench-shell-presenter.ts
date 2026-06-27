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
  "show_canvas_panel",
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
    | "execution_mode"
    | "chat_instruction"
    | "artifact_action"
    | "project_creation"
    | "version_snapshot"
    | "reference_management"
    | "skill_management"
    | "human_decision"
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

export type RuntimeWorkbenchShellVersionSnapshotId = string;

export interface RuntimeWorkbenchShellVersionSnapshotItem {
  readonly id: RuntimeWorkbenchShellVersionSnapshotId;
  readonly label: string;
  readonly value: string;
  readonly statusLabel: string;
  readonly active: boolean;
  readonly tone: RuntimeWorkbenchShellTone;
}

export interface RuntimeWorkbenchShellVersionSnapshotsSnapshot {
  readonly title: string;
  readonly summary: string;
  readonly items: readonly RuntimeWorkbenchShellVersionSnapshotItem[];
}

export type RuntimeWorkbenchShellWorkflowCanvasNodeId =
  | "start"
  | "context_task"
  | "review_task"
  | "repair_task"
  | "end";

export type RuntimeWorkbenchShellWorkflowCanvasNodeType =
  | "start"
  | "execution_task"
  | "evaluation_task"
  | "repair_task"
  | "end";

export type RuntimeWorkbenchShellWorkflowCanvasEdgeId =
  | "start_to_context"
  | "context_to_review"
  | "review_to_end"
  | "review_to_repair"
  | "repair_to_context";

export type RuntimeWorkbenchShellWorkflowCanvasEdgeType =
  | "normal"
  | "pass"
  | "fail"
  | "repair";

export interface RuntimeWorkbenchShellWorkflowCanvasPosition {
  readonly x: number;
  readonly y: number;
}

export interface RuntimeWorkbenchShellWorkflowCanvasNode {
  readonly nodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId;
  readonly type: RuntimeWorkbenchShellWorkflowCanvasNodeType;
  readonly title: string;
  readonly statusLabel: string;
  readonly position: RuntimeWorkbenchShellWorkflowCanvasPosition;
  readonly active: boolean;
  readonly tone: RuntimeWorkbenchShellTone;
}

export interface RuntimeWorkbenchShellWorkflowCanvasEdge {
  readonly edgeId: RuntimeWorkbenchShellWorkflowCanvasEdgeId;
  readonly sourceNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId;
  readonly targetNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId;
  readonly type: RuntimeWorkbenchShellWorkflowCanvasEdgeType;
  readonly label: string;
  readonly tone: RuntimeWorkbenchShellTone;
}

export interface RuntimeWorkbenchShellWorkflowCanvasSnapshot {
  readonly title: string;
  readonly summary: string;
  readonly statusLabel: string;
  readonly nodes: readonly RuntimeWorkbenchShellWorkflowCanvasNode[];
  readonly edges: readonly RuntimeWorkbenchShellWorkflowCanvasEdge[];
}

export type RuntimeWorkbenchShellTaskDrawerItemId =
  | "active_panel"
  | "lifecycle_panel"
  | "runtime_stream"
  | "selected_node_artifacts"
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
  readonly versionSnapshots: RuntimeWorkbenchShellVersionSnapshotsSnapshot;
  readonly workflowCanvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot;
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

export type RuntimeWorkbenchShellExecutionPolicySnapshot =
  RuntimeWorkbenchHostSessionSnapshot["executionPolicy"];

export type RuntimeWorkbenchShellChatInstructionSnapshot =
  RuntimeWorkbenchHostSessionSnapshot["chatInstruction"];

export type RuntimeWorkbenchShellArtifactActionSnapshot =
  RuntimeWorkbenchHostSessionSnapshot["artifactAction"];

export type RuntimeWorkbenchShellProjectCreationSnapshot =
  RuntimeWorkbenchHostSessionSnapshot["projectCreation"];

export type RuntimeWorkbenchShellReferenceManagementSnapshot =
  RuntimeWorkbenchHostSessionSnapshot["referenceManagement"];

export type RuntimeWorkbenchShellSkillManagementSnapshot =
  RuntimeWorkbenchHostSessionSnapshot["skillManagement"];

export type RuntimeWorkbenchShellHumanDecisionSnapshot =
  RuntimeWorkbenchHostSessionSnapshot["humanDecision"];

export type RuntimeWorkbenchShellVersionSnapshotSnapshot =
  RuntimeWorkbenchHostSessionSnapshot["versionSnapshot"];

export interface RuntimeWorkbenchShellSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly activePanelLabel: string;
  readonly executionPolicy: RuntimeWorkbenchShellExecutionPolicySnapshot;
  readonly chatInstruction: RuntimeWorkbenchShellChatInstructionSnapshot;
  readonly artifactAction: RuntimeWorkbenchShellArtifactActionSnapshot;
  readonly projectCreation: RuntimeWorkbenchShellProjectCreationSnapshot;
  readonly referenceManagement: RuntimeWorkbenchShellReferenceManagementSnapshot;
  readonly skillManagement: RuntimeWorkbenchShellSkillManagementSnapshot;
  readonly humanDecision: RuntimeWorkbenchShellHumanDecisionSnapshot;
  readonly versionSnapshot: RuntimeWorkbenchShellVersionSnapshotSnapshot;
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
    executionPolicy: cloneRuntimeWorkbenchShellExecutionPolicy(
      host.executionPolicy,
    ),
    chatInstruction: cloneRuntimeWorkbenchShellChatInstruction(
      host.chatInstruction,
    ),
    artifactAction: cloneRuntimeWorkbenchShellArtifactAction(
      host.artifactAction,
    ),
    projectCreation: cloneRuntimeWorkbenchShellProjectCreation(
      host.projectCreation,
    ),
    referenceManagement: cloneRuntimeWorkbenchShellReferenceManagement(
      host.referenceManagement,
    ),
    skillManagement: cloneRuntimeWorkbenchShellSkillManagement(
      host.skillManagement,
    ),
    humanDecision: cloneRuntimeWorkbenchShellHumanDecision(host.humanDecision),
    versionSnapshot: cloneRuntimeWorkbenchShellVersionSnapshot(
      host.versionSnapshot,
    ),
    lifecyclePanelStatus,
    lifecyclePanel,
    runtimeStreamStatus,
    runtimeStreamChannelLabel,
    runtimeStreamPanel,
    lastHandledShortcutLabel,
    panels: buildPanelTabs(
      host,
      disposed ? "disposed" : "active",
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
      host.activePanel !== "canvas" &&
      lifecyclePanelStatus === "empty" &&
      runtimeStreamStatus === "empty"
        ? {
            title: "No active session",
            summary: "Runtime activity will appear after a session opens.",
          }
        : null,
  });
}

function buildPanelTabs(
  host: RuntimeWorkbenchHostSessionSnapshot,
  canvasPanelStatus: RuntimeWorkbenchShellPanelStatus,
  lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus,
  runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus,
  disposed: boolean,
): RuntimeWorkbenchShellPanelTab[] {
  return [
    panelTab({
      id: "canvas",
      label: "Canvas",
      title: "Workflow canvas panel",
      active: host.activePanel === "canvas",
      enabled: !disposed,
      status: canvasPanelStatus,
    }),
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
  const workflowSnapshotValue = host.versionSnapshot.commitSha;
  const gitSnapshotValue =
    workflowSnapshotValue !== null
      ? workflowSnapshotValue.slice(0, 12)
      : host.projectCreation.firstCommitSha === null
        ? "Not created"
        : host.projectCreation.firstCommitSha.slice(0, 12);
  return freezeRuntimeWorkbenchShellChrome({
    dockItems: [
      dockItem({
        id: "workflow_canvas",
        label: "Canvas",
        title: "Workflow canvas.",
        active: host.activePanel === "canvas",
        enabled: !disposed,
        status: disposed ? "disposed" : "active",
        targetPanel: "canvas",
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
          active: host.activePanel === "canvas",
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
    versionSnapshots: buildVersionSnapshotsSnapshot({
      activePanelLabel,
      disposed,
      gitSnapshotValue,
      host,
      lifecyclePanelStatus,
      runtimeStreamChannelLabel,
      runtimeStreamStatus,
      visibleItems,
    }),
    workflowCanvas: {
      title: "Workflow Canvas",
      summary: `${activePanelLabel} graph scaffold`,
      statusLabel: disposed ? "Disposed" : "Read-only",
      nodes: buildWorkflowCanvasNodes(host, disposed),
      edges: buildWorkflowCanvasEdges(disposed),
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
          id: "selected_node_artifacts",
          label: "Node artifacts",
          value: disposed
            ? "Disposed"
            : artifactActionStatusLabel(host.artifactAction),
          tone: disposed ? "danger" : artifactActionTone(host.artifactAction),
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
      enabled: !disposed && host.chatInstruction.canSubmitInstruction,
      statusLabel: disposed
        ? "Disposed"
        : chatInstructionStatusLabel(host.chatInstruction),
      collapsedSummary: `${activePanelLabel} focus, chat ${
        disposed ? "disposed" : chatInstructionStatusLabel(host.chatInstruction)
      }`,
      collapsible: true,
      defaultCollapsed: false,
      expandLabel: "Expand chat",
      collapseLabel: "Collapse chat",
    },
  });
}

function buildWorkflowCanvasNodes(
  host: RuntimeWorkbenchHostSessionSnapshot,
  disposed: boolean,
): RuntimeWorkbenchShellWorkflowCanvasNode[] {
  const activeLifecycleNode = host.activePanel === "lifecycle";
  const activeStreamNode = host.activePanel === "stream";
  const activeCanvasNode = host.activePanel === "canvas";
  return [
    workflowCanvasNode({
      nodeId: "start",
      type: "start",
      title: "Start",
      statusLabel: "manual",
      position: { x: 16, y: 44 },
      active: false,
      tone: disposed ? "danger" : "success",
    }),
    workflowCanvasNode({
      nodeId: "context_task",
      type: "execution_task",
      title: "Collect context",
      statusLabel: "execution_task",
      position: { x: 32, y: 28 },
      active: activeCanvasNode || activeStreamNode,
      tone: disposed ? "danger" : "accent",
    }),
    workflowCanvasNode({
      nodeId: "review_task",
      type: "evaluation_task",
      title: "Review result",
      statusLabel: "evaluation_task",
      position: { x: 56, y: 44 },
      active: activeLifecycleNode,
      tone: disposed ? "danger" : "warning",
    }),
    workflowCanvasNode({
      nodeId: "repair_task",
      type: "repair_task",
      title: "Repair loop",
      statusLabel: "repair_task",
      position: { x: 56, y: 78 },
      active: false,
      tone: disposed ? "danger" : "warning",
    }),
    workflowCanvasNode({
      nodeId: "end",
      type: "end",
      title: "End",
      statusLabel: "archive",
      position: { x: 84, y: 44 },
      active: false,
      tone: disposed ? "danger" : "success",
    }),
  ];
}

function buildWorkflowCanvasEdges(
  disposed: boolean,
): RuntimeWorkbenchShellWorkflowCanvasEdge[] {
  return [
    workflowCanvasEdge({
      edgeId: "start_to_context",
      sourceNodeId: "start",
      targetNodeId: "context_task",
      type: "normal",
      label: "start",
      tone: disposed ? "danger" : "neutral",
    }),
    workflowCanvasEdge({
      edgeId: "context_to_review",
      sourceNodeId: "context_task",
      targetNodeId: "review_task",
      type: "normal",
      label: "output",
      tone: disposed ? "danger" : "accent",
    }),
    workflowCanvasEdge({
      edgeId: "review_to_end",
      sourceNodeId: "review_task",
      targetNodeId: "end",
      type: "pass",
      label: "pass",
      tone: disposed ? "danger" : "success",
    }),
    workflowCanvasEdge({
      edgeId: "review_to_repair",
      sourceNodeId: "review_task",
      targetNodeId: "repair_task",
      type: "fail",
      label: "fail",
      tone: disposed ? "danger" : "warning",
    }),
    workflowCanvasEdge({
      edgeId: "repair_to_context",
      sourceNodeId: "repair_task",
      targetNodeId: "context_task",
      type: "repair",
      label: "repair",
      tone: disposed ? "danger" : "warning",
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
      id: "execution_mode",
      label: "Mode",
      value: executionModeLabel(host.executionPolicy.mode),
      tone: host.executionPolicy.mode === "step" ? "accent" : "neutral",
    }),
    statusItem({
      id: "chat_instruction",
      label: "Chat",
      value: disposed
        ? "Disposed"
        : chatInstructionStatusLabel(host.chatInstruction),
      tone: disposed ? "danger" : chatInstructionTone(host.chatInstruction),
    }),
    statusItem({
      id: "artifact_action",
      label: "Artifact",
      value: disposed
        ? "Disposed"
        : artifactActionStatusLabel(host.artifactAction),
      tone: disposed ? "danger" : artifactActionTone(host.artifactAction),
    }),
    statusItem({
      id: "project_creation",
      label: "Project",
      value: disposed
        ? "Disposed"
        : projectCreationStatusLabel(host.projectCreation),
      tone: disposed ? "danger" : projectCreationTone(host.projectCreation),
    }),
    statusItem({
      id: "version_snapshot",
      label: "Snapshot",
      value: disposed
        ? "Disposed"
        : versionSnapshotStatusLabel(host.versionSnapshot),
      tone: disposed ? "danger" : versionSnapshotTone(host.versionSnapshot),
    }),
    statusItem({
      id: "reference_management",
      label: "References",
      value: disposed
        ? "Disposed"
        : referenceManagementStatusLabel(host.referenceManagement),
      tone: disposed
        ? "danger"
        : referenceManagementTone(host.referenceManagement),
    }),
    statusItem({
      id: "skill_management",
      label: "Skills",
      value: disposed
        ? "Disposed"
        : skillManagementStatusLabel(host.skillManagement),
      tone: disposed ? "danger" : skillManagementTone(host.skillManagement),
    }),
    statusItem({
      id: "human_decision",
      label: "HITL",
      value: disposed
        ? "Disposed"
        : humanDecisionStatusLabel(host.humanDecision),
      tone: disposed ? "danger" : humanDecisionTone(host.humanDecision),
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

function versionSnapshotItem(
  item: RuntimeWorkbenchShellVersionSnapshotItem,
): RuntimeWorkbenchShellVersionSnapshotItem {
  return Object.freeze({ ...item });
}

function buildVersionSnapshotsSnapshot(options: {
  readonly activePanelLabel: string;
  readonly disposed: boolean;
  readonly gitSnapshotValue: string;
  readonly host: RuntimeWorkbenchHostSessionSnapshot;
  readonly lifecyclePanelStatus: RuntimeWorkbenchShellPanelStatus;
  readonly runtimeStreamChannelLabel: string | null;
  readonly runtimeStreamStatus: RuntimeWorkbenchShellPanelStatus;
  readonly visibleItems: number;
}): RuntimeWorkbenchShellVersionSnapshotsSnapshot {
  const timelineItems = options.host.versionSnapshot.timelineItems;
  if (timelineItems.length > 0) {
    return Object.freeze({
      title: "Version Snapshots",
      summary: `${timelineItems.length} runtime history entries`,
      items: Object.freeze(
        timelineItems.map((item) =>
          versionSnapshotItem({
            id: item.id,
            label: item.label,
            value: item.value,
            statusLabel: item.statusLabel,
            active: item.active,
            tone: options.disposed ? "danger" : item.tone,
          }),
        ),
      ),
    });
  }

  return Object.freeze({
    title: "Version Snapshots",
    summary: `${options.activePanelLabel} scaffold history`,
    items: Object.freeze([
      versionSnapshotItem({
        id: "draft",
        label: "Draft",
        value: "v0",
        statusLabel: "Read-only",
        active: options.host.activePanel === "canvas",
        tone: "neutral",
      }),
      versionSnapshotItem({
        id: "validation",
        label: "Validation",
        value:
          options.visibleItems === 0
            ? "0 visible"
            : `${options.visibleItems} visible`,
        statusLabel: panelStatusLabel(options.lifecyclePanelStatus),
        active: options.host.activePanel === "lifecycle",
        tone: panelStatusTone(options.lifecyclePanelStatus),
      }),
      versionSnapshotItem({
        id: "runtime",
        label: "Runtime",
        value: options.runtimeStreamChannelLabel ?? "No active stream",
        statusLabel: panelStatusLabel(options.runtimeStreamStatus),
        active: options.host.activePanel === "stream",
        tone: panelStatusTone(options.runtimeStreamStatus),
      }),
      versionSnapshotItem({
        id: "git_snapshot",
        label: "Git snapshot",
        value: options.gitSnapshotValue,
        statusLabel: options.disposed
          ? "Disposed"
          : versionSnapshotStatusLabel(options.host.versionSnapshot),
        active:
          options.host.versionSnapshot.status === "succeeded" ||
          options.host.projectCreation.gitInitialized === true,
        tone: options.disposed
          ? "danger"
          : versionSnapshotTone(options.host.versionSnapshot),
      }),
    ]),
  });
}

function workflowCanvasNode(
  node: RuntimeWorkbenchShellWorkflowCanvasNode,
): RuntimeWorkbenchShellWorkflowCanvasNode {
  return Object.freeze({
    nodeId: node.nodeId,
    type: node.type,
    title: node.title,
    statusLabel: node.statusLabel,
    position: Object.freeze({ ...node.position }),
    active: node.active,
    tone: node.tone,
  });
}

function workflowCanvasEdge(
  edge: RuntimeWorkbenchShellWorkflowCanvasEdge,
): RuntimeWorkbenchShellWorkflowCanvasEdge {
  return Object.freeze({ ...edge });
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
    case "show_canvas_panel":
      return {
        label: "Canvas",
        title: "Show workflow canvas panel.",
        slot: "navigation",
        tone: "neutral",
        targetPanel: "canvas",
        requiresOptions: false,
      };
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
  show_canvas_panel: ["show_canvas_panel"],
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
    case "canvas":
      return "Canvas";
    case "lifecycle":
      return "Lifecycle";
    case "stream":
      return "Stream";
  }
}

function executionModeLabel(
  mode: RuntimeWorkbenchShellExecutionPolicySnapshot["mode"],
): string {
  switch (mode) {
    case "auto":
      return "Auto";
    case "semi_auto":
      return "Semi-auto";
    case "step":
      return "Step";
  }
}

function projectCreationStatusLabel(
  projectCreation: RuntimeWorkbenchShellProjectCreationSnapshot,
): string {
  switch (projectCreation.status) {
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "idle":
      return "Not created";
    case "running":
      return "Creating";
    case "succeeded":
      return projectCreation.projectId ?? "Created";
  }
}

function chatInstructionStatusLabel(
  chatInstruction: RuntimeWorkbenchShellChatInstructionSnapshot,
): string {
  switch (chatInstruction.status) {
    case "submitting":
      return "Submitting";
    case "accepted":
      return chatInstruction.commandId ?? "Accepted";
    case "failed":
      return "Failed";
    case "blocked":
      return chatInstruction.blockedReason ?? "Blocked";
    case "idle":
      return chatInstruction.canSubmitInstruction ? "Ready" : "Unavailable";
  }
}

function chatInstructionTone(
  chatInstruction: RuntimeWorkbenchShellChatInstructionSnapshot,
): RuntimeWorkbenchShellTone {
  switch (chatInstruction.status) {
    case "accepted":
      return "success";
    case "submitting":
      return "accent";
    case "failed":
      return "danger";
    case "blocked":
      return "warning";
    case "idle":
      return chatInstruction.canSubmitInstruction ? "neutral" : "warning";
  }
}

function artifactActionStatusLabel(
  artifactAction: RuntimeWorkbenchShellArtifactActionSnapshot,
): string {
  switch (artifactAction.status) {
    case "running":
      return "Running";
    case "succeeded":
      return artifactAction.destinationKind ?? "Succeeded";
    case "failed":
      return "Failed";
    case "blocked":
      return artifactAction.blockedReason ?? "Blocked";
    case "cancelled":
      return "Cancelled";
    case "idle":
      return artifactAction.canRunArtifactAction ? "Ready" : "Unavailable";
  }
}

function artifactActionTone(
  artifactAction: RuntimeWorkbenchShellArtifactActionSnapshot,
): RuntimeWorkbenchShellTone {
  switch (artifactAction.status) {
    case "succeeded":
      return "success";
    case "running":
      return "accent";
    case "failed":
      return "danger";
    case "blocked":
    case "cancelled":
      return "warning";
    case "idle":
      return artifactAction.canRunArtifactAction ? "neutral" : "warning";
  }
}

function projectCreationTone(
  projectCreation: RuntimeWorkbenchShellProjectCreationSnapshot,
): RuntimeWorkbenchShellTone {
  switch (projectCreation.status) {
    case "blocked":
      return "warning";
    case "failed":
      return "danger";
    case "idle":
      return "neutral";
    case "running":
      return "accent";
    case "succeeded":
      return projectCreation.gitInitialized === true ? "success" : "warning";
  }
}

function referenceManagementStatusLabel(
  referenceManagement: RuntimeWorkbenchShellReferenceManagementSnapshot,
): string {
  switch (referenceManagement.status) {
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "refreshing":
      return "Refreshing";
    case "importing":
      return "Importing";
    case "updating":
      return "Updating";
    case "succeeded":
      return `${referenceManagement.entries.length} refs`;
    case "idle":
      return "Ready";
  }
}

function referenceManagementTone(
  referenceManagement: RuntimeWorkbenchShellReferenceManagementSnapshot,
): RuntimeWorkbenchShellTone {
  switch (referenceManagement.status) {
    case "blocked":
    case "failed":
      return "danger";
    case "refreshing":
    case "importing":
    case "updating":
      return "accent";
    case "succeeded":
      return "success";
    case "idle":
      return "neutral";
  }
}

function skillManagementStatusLabel(
  skillManagement: RuntimeWorkbenchShellSkillManagementSnapshot,
): string {
  switch (skillManagement.status) {
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "refreshing":
      return "Refreshing";
    case "updating":
      return "Updating";
    case "succeeded":
      return `${skillManagement.entries.length} skills`;
    case "idle":
      return "Ready";
  }
}

function skillManagementTone(
  skillManagement: RuntimeWorkbenchShellSkillManagementSnapshot,
): RuntimeWorkbenchShellTone {
  switch (skillManagement.status) {
    case "blocked":
    case "failed":
      return "danger";
    case "refreshing":
    case "updating":
      return "accent";
    case "succeeded":
      return "success";
    case "idle":
      return "neutral";
  }
}

function humanDecisionStatusLabel(
  humanDecision: RuntimeWorkbenchShellHumanDecisionSnapshot,
): string {
  switch (humanDecision.status) {
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "submitting":
      return "Submitting";
    case "succeeded":
      return "Resolved";
    case "idle":
      return humanDecision.canSubmitDecision ? "Ready" : "Unavailable";
  }
}

function humanDecisionTone(
  humanDecision: RuntimeWorkbenchShellHumanDecisionSnapshot,
): RuntimeWorkbenchShellTone {
  switch (humanDecision.status) {
    case "blocked":
    case "failed":
      return "danger";
    case "submitting":
      return "accent";
    case "succeeded":
      return "success";
    case "idle":
      return humanDecision.canSubmitDecision ? "neutral" : "warning";
  }
}

function versionSnapshotStatusLabel(
  versionSnapshot: RuntimeWorkbenchShellVersionSnapshotSnapshot,
): string {
  switch (versionSnapshot.status) {
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "loading":
      return "Loading";
    case "creating":
      return "Creating";
    case "succeeded":
      return versionSnapshot.snapshotId ?? "Created";
    case "idle":
      return versionSnapshot.canCreateSnapshot ? "Ready" : "Unavailable";
  }
}

function versionSnapshotTone(
  versionSnapshot: RuntimeWorkbenchShellVersionSnapshotSnapshot,
): RuntimeWorkbenchShellTone {
  switch (versionSnapshot.status) {
    case "blocked":
    case "failed":
      return "danger";
    case "loading":
    case "creating":
      return "accent";
    case "succeeded":
      return "success";
    case "idle":
      return versionSnapshot.canCreateSnapshot ? "neutral" : "warning";
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
    case "show_canvas_panel":
      return "Show canvas";
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
    case "show_canvas_panel":
      return ["Ctrl", "0"];
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
    executionPolicy: cloneRuntimeWorkbenchShellExecutionPolicy(
      snapshot.executionPolicy,
    ),
    chatInstruction: cloneRuntimeWorkbenchShellChatInstruction(
      snapshot.chatInstruction,
    ),
    artifactAction: cloneRuntimeWorkbenchShellArtifactAction(
      snapshot.artifactAction,
    ),
    projectCreation: cloneRuntimeWorkbenchShellProjectCreation(
      snapshot.projectCreation,
    ),
    referenceManagement: cloneRuntimeWorkbenchShellReferenceManagement(
      snapshot.referenceManagement,
    ),
    skillManagement: cloneRuntimeWorkbenchShellSkillManagement(
      snapshot.skillManagement,
    ),
    humanDecision: cloneRuntimeWorkbenchShellHumanDecision(
      snapshot.humanDecision,
    ),
    versionSnapshot: cloneRuntimeWorkbenchShellVersionSnapshot(
      snapshot.versionSnapshot,
    ),
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

function cloneRuntimeWorkbenchShellExecutionPolicy(
  policy: RuntimeWorkbenchShellExecutionPolicySnapshot,
): RuntimeWorkbenchShellExecutionPolicySnapshot {
  return Object.freeze({
    ...policy,
    availableModes: Object.freeze([...policy.availableModes]),
    runOnce: Object.freeze({ ...policy.runOnce }),
  });
}

function cloneRuntimeWorkbenchShellChatInstruction(
  chatInstruction: RuntimeWorkbenchShellChatInstructionSnapshot,
): RuntimeWorkbenchShellChatInstructionSnapshot {
  return Object.freeze({ ...chatInstruction });
}

function cloneRuntimeWorkbenchShellArtifactAction(
  artifactAction: RuntimeWorkbenchShellArtifactActionSnapshot,
): RuntimeWorkbenchShellArtifactActionSnapshot {
  return Object.freeze({ ...artifactAction });
}

function cloneRuntimeWorkbenchShellProjectCreation(
  projectCreation: RuntimeWorkbenchShellProjectCreationSnapshot,
): RuntimeWorkbenchShellProjectCreationSnapshot {
  return Object.freeze({ ...projectCreation });
}

function cloneRuntimeWorkbenchShellReferenceManagement(
  referenceManagement: RuntimeWorkbenchShellReferenceManagementSnapshot,
): RuntimeWorkbenchShellReferenceManagementSnapshot {
  return Object.freeze({
    ...referenceManagement,
    entries: Object.freeze([...referenceManagement.entries]),
  });
}

function cloneRuntimeWorkbenchShellSkillManagement(
  skillManagement: RuntimeWorkbenchShellSkillManagementSnapshot,
): RuntimeWorkbenchShellSkillManagementSnapshot {
  return Object.freeze({
    ...skillManagement,
    entries: Object.freeze([...skillManagement.entries]),
  });
}

function cloneRuntimeWorkbenchShellHumanDecision(
  humanDecision: RuntimeWorkbenchShellHumanDecisionSnapshot,
): RuntimeWorkbenchShellHumanDecisionSnapshot {
  return Object.freeze({ ...humanDecision });
}

function cloneRuntimeWorkbenchShellVersionSnapshot(
  versionSnapshot: RuntimeWorkbenchShellVersionSnapshotSnapshot,
): RuntimeWorkbenchShellVersionSnapshotSnapshot {
  return Object.freeze({ ...versionSnapshot });
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
    versionSnapshots: Object.freeze({
      title: chrome.versionSnapshots.title,
      summary: chrome.versionSnapshots.summary,
      items: Object.freeze(
        chrome.versionSnapshots.items.map((item) => versionSnapshotItem(item)),
      ),
    }),
    workflowCanvas: Object.freeze({
      title: chrome.workflowCanvas.title,
      summary: chrome.workflowCanvas.summary,
      statusLabel: chrome.workflowCanvas.statusLabel,
      nodes: Object.freeze(
        chrome.workflowCanvas.nodes.map((node) => workflowCanvasNode(node)),
      ),
      edges: Object.freeze(
        chrome.workflowCanvas.edges.map((edge) => workflowCanvasEdge(edge)),
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
    schemaVersion: event.schemaVersion,
    seq: event.seq,
    parentEventId: event.parentEventId,
    correlationId: event.correlationId,
    runId: event.runId,
    nodeId: event.nodeId,
    attemptId: event.attemptId,
    type: event.type,
    category: event.category,
    phase: event.phase,
    displayLevel: event.displayLevel,
    severity: event.severity,
    sensitivity: event.sensitivity,
    title: event.title,
    summary: event.summary,
    content: event.content,
    expandable: event.expandable,
    payloadSummary: Object.freeze({ ...event.payloadSummary }),
    metadataSummary: Object.freeze({ ...event.metadataSummary }),
    expanded: event.expanded,
    childCount: event.childCount,
    children: Object.freeze(
      event.children.map(cloneRuntimeWorkbenchShellRuntimeStreamEvent),
    ),
    artifactRefs: Object.freeze(
      event.artifactRefs.map((artifactRef) =>
        Object.freeze({ ...artifactRef }),
      ),
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
