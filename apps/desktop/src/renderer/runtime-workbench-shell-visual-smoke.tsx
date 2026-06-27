import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeLifecyclePanelTimelineItem } from "./runtime-lifecycle-panel-presenter.js";
import type { RuntimeWorkbenchInteractionCommand } from "./runtime-workbench-interaction.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import type { RuntimeWorkbenchPanelId } from "./runtime-workbench-session.js";
import type { RuntimeWorkbenchShellDomSession } from "./runtime-workbench-shell-dom-session.js";
import type { RuntimeWorkbenchShellKeyboardDomEventTarget } from "./runtime-workbench-shell-keyboard-dom-adapter.js";
import type {
  RuntimeWorkbenchShellActionId,
  RuntimeWorkbenchShellChromeSnapshot,
  RuntimeWorkbenchShellRuntimeStreamPanelSnapshot,
  RuntimeWorkbenchShellSnapshot,
} from "./runtime-workbench-shell-presenter.js";
import { RuntimeWorkbenchShellReactView } from "./runtime-workbench-shell-react.js";
import "./runtime-workbench-shell.css";

function mountRuntimeWorkbenchShellVisualSmoke(): void {
  const rootElement = document.getElementById("root");

  if (rootElement === null) {
    throw new Error(
      "Runtime workbench visual smoke root element was not found",
    );
  }

  const session = createRuntimeWorkbenchShellVisualSmokeSession();
  window.addEventListener(
    "beforeunload",
    () => {
      session.dispose();
    },
    { once: true },
  );

  createRoot(rootElement).render(
    <StrictMode>
      <RuntimeWorkbenchShellReactView
        keyboardTarget={window}
        session={session}
        title="Runtime Workbench Visual Smoke"
      />
    </StrictMode>,
  );
}

interface VisualSmokeState {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly focusedTimelineItemId: string;
  readonly selectedTimelineItemId: string | null;
  readonly streamEventExpanded: boolean;
  readonly streamEventMode: VisualSmokeStreamEventMode;
  readonly chatBoxMode: VisualSmokeChatBoxMode;
  readonly lastHandledShortcutLabel: string | null;
}

type VisualSmokeStreamEventMode = "known" | "unknown";
type VisualSmokeChatBoxMode = "disabled" | "enabled";

const VISUAL_SMOKE_MARKDOWN_STREAM_CONTENT = [
  "delta content with `inline_code` and <mark>marked token</mark> [trusted link](/artifacts/visual-report.md) [blocked link](javascript:alert(1)).",
  "![blocked image](https://example.invalid/visual.png) <script>alert(1)</script>",
  "",
  "## Visual markdown detail",
  "- first visual item",
  "- second visual item",
  "",
  "| Metric | Value |",
  "| --- | --- |",
  "| status | ok |",
  "",
  "```",
  'const result = "visual";',
  "```",
].join("\n");

function createRuntimeWorkbenchShellVisualSmokeSession(): RuntimeWorkbenchShellDomSession {
  const listeners = new Set<() => void>();
  let state: VisualSmokeState = {
    activePanel: "lifecycle",
    focusedTimelineItemId: VISUAL_SMOKE_TIMELINE_ITEMS[0]?.id ?? "",
    selectedTimelineItemId: VISUAL_SMOKE_TIMELINE_ITEMS[1]?.id ?? null,
    streamEventExpanded: false,
    streamEventMode: parseVisualSmokeStreamEventMode(),
    chatBoxMode: parseVisualSmokeChatBoxMode(),
    lastHandledShortcutLabel: "None",
  };
  let disposed = false;
  let currentSnapshot = buildVisualSmokeSnapshot(state, disposed);
  let keyboardTarget: {
    readonly target: RuntimeWorkbenchShellKeyboardDomEventTarget;
    readonly listener: EventListener;
  } | null = null;

  const publish = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const updateState = (
    nextState: VisualSmokeState,
  ): RuntimeWorkbenchShellSnapshot => {
    state = nextState;
    currentSnapshot = buildVisualSmokeSnapshot(state, disposed);
    publish();
    return currentSnapshot;
  };
  const handleLifecycleCommand = (
    command: RuntimeWorkbenchInteractionCommand,
  ): RuntimeWorkbenchShellSnapshot => {
    if (command.type !== "dispatch_lifecycle_panel") {
      return currentSnapshot;
    }
    switch (command.command) {
      case "focus_next_timeline_item":
        return updateState({
          ...state,
          focusedTimelineItemId: nextTimelineItemId(
            state.focusedTimelineItemId,
          ),
        });
      case "focus_previous_timeline_item":
        return updateState({
          ...state,
          focusedTimelineItemId: previousTimelineItemId(
            state.focusedTimelineItemId,
          ),
        });
      case "select_focused_timeline_item":
        return updateState({
          ...state,
          selectedTimelineItemId: state.focusedTimelineItemId,
        });
      case "clear_selection":
        return updateState({ ...state, selectedTimelineItemId: null });
      case "refresh_status":
      case "start_or_retry_runtime":
      case "stop_runtime":
      case "focus_primary_command":
      case "focus_next_command":
      case "focus_previous_command":
      case "activate_focused_command":
        return currentSnapshot;
    }
  };
  const handleRuntimeStreamCommand = (
    command: RuntimeWorkbenchInteractionCommand,
  ): RuntimeWorkbenchShellSnapshot => {
    if (command.type !== "dispatch_runtime_stream") {
      return currentSnapshot;
    }
    if (
      command.command.type === "toggle_expanded" &&
      command.command.eventId === "evt_visual_stream"
    ) {
      return updateState({
        ...state,
        streamEventExpanded: !state.streamEventExpanded,
      });
    }
    if (
      command.command.type === "set_expanded" &&
      command.command.eventId === "evt_visual_stream"
    ) {
      return updateState({
        ...state,
        streamEventExpanded: command.command.expanded,
      });
    }
    return currentSnapshot;
  };
  const handleCommand = (
    command: RuntimeWorkbenchInteractionCommand,
  ): RuntimeWorkbenchShellSnapshot => {
    if (command.type === "dispatch_lifecycle_panel") {
      return handleLifecycleCommand(command);
    }
    if (command.type === "dispatch_runtime_stream") {
      return handleRuntimeStreamCommand(command);
    }
    return currentSnapshot;
  };
  const unbindKeyboardTarget = (): boolean => {
    if (keyboardTarget === null) {
      return false;
    }
    keyboardTarget.target.removeEventListener(
      "keydown",
      keyboardTarget.listener,
    );
    keyboardTarget = null;
    return true;
  };

  return {
    getSnapshot: () => currentSnapshot,
    getServerSnapshot: () => currentSnapshot,
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
    dispatch: async (command) => handleCommand(command),
    setActivePanel: (panel) => updateState({ ...state, activePanel: panel }),
    resolveKeyEvent: () => null,
    handleKeyEvent: async (_event: RuntimeWorkbenchShortcutKeyEvent) =>
      currentSnapshot,
    bindKeyboardTarget: (target) => {
      if (disposed) {
        return false;
      }
      unbindKeyboardTarget();
      const listener = (): void => undefined;
      target.addEventListener("keydown", listener);
      keyboardTarget = { target, listener };
      return true;
    },
    unbindKeyboardTarget,
    isKeyboardTargetBound: () => keyboardTarget !== null,
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      listeners.clear();
      unbindKeyboardTarget();
      currentSnapshot = buildVisualSmokeSnapshot(state, disposed);
      return true;
    },
    isDisposed: () => disposed,
  };
}

function buildVisualSmokeSnapshot(
  state: VisualSmokeState,
  disposed: boolean,
): RuntimeWorkbenchShellSnapshot {
  const selectedTimelineItem =
    state.selectedTimelineItemId === null
      ? null
      : (VISUAL_SMOKE_TIMELINE_ITEMS.find(
          (item) => item.id === state.selectedTimelineItemId,
        ) ?? null);
  const activePanelLabel = visualSmokePanelLabel(state.activePanel);
  const runtimeStreamPanel =
    state.activePanel === "stream" && !disposed
      ? buildVisualSmokeRuntimeStreamPanelSnapshot(state)
      : null;
  return Object.freeze({
    activePanel: state.activePanel,
    activePanelLabel,
    executionPolicy: buildVisualSmokeExecutionPolicySnapshot(),
    chatInstruction: Object.freeze({
      status: "idle",
      method: "POST",
      path: null,
      runId: null,
      nodeId: null,
      scope: null,
      intent: null,
      commandId: null,
      statusCode: null,
      blockedReason: null,
      characterCount: null,
      wordCount: null,
      canSubmitInstruction: !disposed,
    }),
    artifactAction: Object.freeze({
      status: "idle",
      artifactId: null,
      action: null,
      runId: null,
      nodeId: null,
      destinationKind: null,
      contentType: null,
      byteCount: null,
      contentHash: null,
      sensitive: false,
      errorCode: null,
      correlationId: null,
      blockedReason: null,
      canRunArtifactAction: !disposed,
    }),
    projectCreation: Object.freeze({
      status: "idle",
      method: "POST",
      path: "/projects",
      displayName: null,
      hostPath: null,
      projectId: null,
      gitInitialized: null,
      firstCommitSha: null,
      statusCode: null,
      blockedReason: null,
      canCreateProject: !disposed,
    }),
    referenceManagement: Object.freeze({
      status: "succeeded",
      activeProjectId: "visual-project",
      method: "GET",
      path: "/projects/visual-project/references",
      entries: Object.freeze([
        Object.freeze({
          referenceId: "ref-visual-architecture",
          path: "references/ref-visual-architecture.md",
          kind: "md",
          enabled: true,
          sourceUrl: null,
          contentHash:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          chunkStatus: "indexed",
          chunkSizeTokens: 320,
          sensitive: false,
          importedAt: "2026-06-25T00:00:00.000Z",
        }),
      ]),
      indexSnapshotId: "index-visual",
      lastReferenceId: "ref-visual-architecture",
      statusCode: 200,
      blockedReason: null,
      canRefreshReferences: !disposed,
      canImportReference: !disposed,
      canUpdateReference: !disposed,
    }),
    skillManagement: Object.freeze({
      status: "succeeded",
      activeProjectId: "visual-project",
      method: "GET",
      path: "/projects/visual-project/skills",
      mcpPath: "/projects/visual-project/mcps",
      entries: Object.freeze([
        Object.freeze({
          skillId: "citation_checker",
          version: "1.0.0",
          enabled: true,
          paramKeys: Object.freeze(["mode"]),
        }),
      ]),
      mcpEntries: Object.freeze([
        Object.freeze({
          serverId: "mcp_docs",
          transport: "stdio",
          enabled: true,
          requiresApproval: true,
          hasSecretRef: true,
        }),
      ]),
      lastSkillId: "citation_checker",
      statusCode: 200,
      mcpStatusCode: 200,
      blockedReason: null,
      canRefreshSkills: !disposed,
      canUpdateSkill: !disposed,
    }),
    humanDecision: Object.freeze({
      status: "idle",
      activeProjectId: null,
      method: "POST",
      path: null,
      runId: null,
      humanNodeId: null,
      decision: null,
      availableDecisions: Object.freeze([]),
      pendingDecisionCount: 0,
      by: null,
      customValuePresent: false,
      statusCode: null,
      blockedReason: null,
      decidedAt: null,
      requestedAt: null,
      canRefreshPendingDecisions: !disposed,
      canSubmitDecision: !disposed,
    }),
    versionSnapshot: Object.freeze({
      status: "idle",
      method: "POST",
      path: null,
      workflowId: null,
      snapshotId: null,
      commitSha: null,
      createdAt: null,
      statusCode: null,
      blockedReason: null,
      canCreateSnapshot: !disposed,
      canRefreshTimeline: !disposed,
      timelineItems: Object.freeze([]),
    }),
    lifecyclePanelStatus: disposed ? "disposed" : "active",
    lifecyclePanel: disposed
      ? null
      : Object.freeze({
          view: Object.freeze({
            panel: Object.freeze({
              readiness: "attention_required",
              tone: "warning",
              statusLabel: "Action required",
              title: "Runtime lifecycle needs review",
              summary:
                "Visual smoke fixture with intentionally long lifecycle copy for responsive wrapping checks.",
              runtimeReady: false,
              busy: false,
              terminal: false,
              lifecycleComplete: false,
              userActionRequired: true,
              retryable: true,
              startupTotal: 4,
              shutdownTotal: 1,
              started: true,
              disposed: false,
              ariaLive: "polite",
              primaryCommand: Object.freeze({
                id: "refresh_status",
                role: "primary",
                label: "Refresh",
                title: "Refresh runtime lifecycle status.",
                enabled: true,
                busy: false,
                tone: "accent",
              }),
              secondaryCommands: Object.freeze([
                Object.freeze({
                  id: "start_runtime",
                  role: "secondary",
                  label: "Retry startup",
                  title: "Retry runtime startup.",
                  enabled: true,
                  busy: false,
                  tone: "neutral",
                }),
                Object.freeze({
                  id: "stop_runtime",
                  role: "secondary",
                  label: "Stop",
                  title: "Stop runtime lifecycle tracking.",
                  enabled: true,
                  busy: false,
                  tone: "danger",
                }),
              ]),
              timelineItems: VISUAL_SMOKE_TIMELINE_ITEMS,
              emptyState: null,
            }),
            disposed: false,
            timelineFilter: "all",
            timelineFilterOptions: Object.freeze([
              Object.freeze({
                id: "all",
                label: "All",
                count: 5,
                active: true,
              }),
              Object.freeze({
                id: "startup",
                label: "Startup",
                count: 4,
                active: false,
              }),
              Object.freeze({
                id: "shutdown",
                label: "Shutdown",
                count: 1,
                active: false,
              }),
              Object.freeze({
                id: "action_required",
                label: "Action required",
                count: 2,
                active: false,
              }),
              Object.freeze({
                id: "retryable",
                label: "Retryable",
                count: 1,
                active: false,
              }),
              Object.freeze({
                id: "error",
                label: "Errors",
                count: 1,
                active: false,
              }),
            ]),
            visibleTimelineItems: VISUAL_SMOKE_TIMELINE_ITEMS,
            selectedTimelineItemId: selectedTimelineItem?.id ?? null,
            selectedTimelineItem,
            totalTimelineItems: VISUAL_SMOKE_TIMELINE_ITEMS.length,
            visibleTimelineItemCount: VISUAL_SMOKE_TIMELINE_ITEMS.length,
            hiddenTimelineItemCount: 0,
          }),
          disposed: false,
          focusTarget: "timeline_item",
          focusedCommandId: "refresh_status",
          focusedTimelineItemId: state.focusedTimelineItemId,
          availableCommandIds: Object.freeze([
            "refresh_status",
            "start_runtime",
            "stop_runtime",
          ] as const),
          enabledCommandIds: Object.freeze([
            "refresh_status",
            "start_runtime",
            "stop_runtime",
          ] as const),
          canActivateFocusedCommand: true,
          canSelectFocusedTimelineItem: true,
        }),
    runtimeStreamStatus: runtimeStreamPanel === null ? "empty" : "active",
    runtimeStreamChannelLabel:
      runtimeStreamPanel === null ? null : "Run run_live_smoke",
    runtimeStreamPanel,
    lastHandledShortcutLabel: state.lastHandledShortcutLabel,
    panels: Object.freeze([
      Object.freeze({
        id: "canvas",
        label: "Canvas",
        title: "Show workflow canvas panel.",
        active: state.activePanel === "canvas",
        enabled: !disposed,
        status: disposed ? "disposed" : "active",
        badgeLabel: disposed ? "Disposed" : "Active",
        tone: disposed ? "danger" : "success",
      }),
      Object.freeze({
        id: "lifecycle",
        label: "Lifecycle",
        title: "Show runtime lifecycle panel.",
        active: state.activePanel === "lifecycle",
        enabled: !disposed,
        status: disposed ? "disposed" : "active",
        badgeLabel: disposed ? "Disposed" : "Active",
        tone: disposed ? "danger" : "success",
      }),
      Object.freeze({
        id: "stream",
        label: "Stream",
        title: "Show runtime stream panel.",
        active: state.activePanel === "stream",
        enabled: !disposed,
        status: runtimeStreamPanel === null ? "empty" : "active",
        badgeLabel: runtimeStreamPanel === null ? null : "1 unread",
        tone: runtimeStreamPanel === null ? "neutral" : "warning",
      }),
    ]),
    actions: Object.freeze([
      Object.freeze({
        id: "show_canvas_panel",
        label: "Canvas",
        title: "Show workflow canvas panel.",
        slot: "navigation",
        tone: "neutral",
        targetPanel: "canvas",
        enabled: !disposed && state.activePanel !== "canvas",
        requiresOptions: false,
        shortcutIds: Object.freeze(["show_canvas_panel"] as const),
      }),
      Object.freeze({
        id: "show_lifecycle_panel",
        label: "Lifecycle",
        title: "Show runtime lifecycle panel.",
        slot: "navigation",
        tone: "neutral",
        targetPanel: "lifecycle",
        enabled: !disposed && state.activePanel !== "lifecycle",
        requiresOptions: false,
        shortcutIds: Object.freeze(["show_lifecycle_panel"] as const),
      }),
      Object.freeze({
        id: "show_stream_panel",
        label: "Stream",
        title: "Show runtime stream panel.",
        slot: "navigation",
        tone: "neutral",
        targetPanel: "stream",
        enabled: !disposed && state.activePanel !== "stream",
        requiresOptions: false,
        shortcutIds: Object.freeze(["show_stream_panel"] as const),
      }),
      Object.freeze({
        id: "open_lifecycle_panel_session",
        label: "Open lifecycle",
        title: "Open a lifecycle panel session.",
        slot: "primary",
        tone: "accent",
        targetPanel: "lifecycle",
        enabled: false,
        requiresOptions: false,
        shortcutIds: Object.freeze([]),
      }),
    ]),
    shortcutHints: Object.freeze([
      Object.freeze({
        id: "show_canvas_panel",
        label: "Canvas",
        title: "Show workflow canvas panel.",
        keys: Object.freeze(["Ctrl", "0"]),
        enabled: !disposed && state.activePanel !== "canvas",
      }),
      Object.freeze({
        id: "show_lifecycle_panel",
        label: "Lifecycle",
        title: "Show runtime lifecycle panel.",
        keys: Object.freeze(["Ctrl", "1"]),
        enabled: !disposed && state.activePanel !== "lifecycle",
      }),
      Object.freeze({
        id: "show_stream_panel",
        label: "Stream",
        title: "Show runtime stream panel.",
        keys: Object.freeze(["Ctrl", "2"]),
        enabled: !disposed && state.activePanel !== "stream",
      }),
    ]),
    statusItems: Object.freeze([
      Object.freeze({
        id: "active_panel",
        label: "Panel",
        value: activePanelLabel,
        tone: "neutral",
      }),
      Object.freeze({
        id: "project_creation",
        label: "Project",
        value: disposed ? "Disposed" : "Not created",
        tone: disposed ? "danger" : "neutral",
      }),
      Object.freeze({
        id: "reference_management",
        label: "References",
        value: disposed ? "Disposed" : "1 refs",
        tone: disposed ? "danger" : "success",
      }),
      Object.freeze({
        id: "skill_management",
        label: "Skills",
        value: disposed ? "Disposed" : "1 skills",
        tone: disposed ? "danger" : "success",
      }),
      Object.freeze({
        id: "human_decision",
        label: "HITL",
        value: disposed ? "Disposed" : "Ready",
        tone: disposed ? "danger" : "neutral",
      }),
      Object.freeze({
        id: "lifecycle_panel",
        label: "Lifecycle",
        value: disposed ? "Disposed" : "Active",
        tone: disposed ? "danger" : "success",
      }),
      Object.freeze({
        id: "runtime_stream",
        label: "Stream",
        value: "Empty",
        tone: "neutral",
      }),
      Object.freeze({
        id: "last_shortcut",
        label: "Last shortcut",
        value: state.lastHandledShortcutLabel ?? "None",
        tone: "neutral",
      }),
    ]),
    chrome: buildVisualSmokeChromeSnapshot(state, disposed),
    availableActionIds: Object.freeze([
      "show_canvas_panel",
      "show_lifecycle_panel",
      "show_stream_panel",
      "open_lifecycle_panel_session",
    ] as const),
    enabledActionIds: buildVisualSmokeEnabledActionIds(
      state.activePanel,
      disposed,
    ),
    disposed,
    ariaLive: disposed ? "assertive" : "polite",
    emptyState: null,
  });
}

function buildVisualSmokeExecutionPolicySnapshot(): RuntimeWorkbenchShellSnapshot["executionPolicy"] {
  return Object.freeze({
    mode: "semi_auto",
    availableModes: Object.freeze(["step", "semi_auto", "auto"] as const),
    canChangeMode: true,
    canRunOnce: false,
    runOnce: Object.freeze({
      status: "idle",
      method: "POST",
      path: null,
      runId: null,
      nodeId: null,
      statusCode: null,
      blockedReason: null,
    }),
  });
}

function buildVisualSmokeRuntimeStreamPanelSnapshot(
  state: VisualSmokeState,
): RuntimeWorkbenchShellRuntimeStreamPanelSnapshot {
  const eventMode = state.streamEventMode;
  const event = Object.freeze({
    id: "evt_visual_stream",
    schemaVersion: "0.1.0",
    seq: 12,
    parentEventId: "evt_visual_parent",
    correlationId: "trace_visual_stream",
    runId: "run_visual_stream",
    nodeId:
      eventMode === "unknown" ? "node_visual_adapter" : "node_visual_model",
    attemptId: "attempt_visual_stream",
    type:
      eventMode === "unknown"
        ? "adapter.experimental_event"
        : "model.text_delta",
    category: eventMode === "unknown" ? "system" : "model",
    phase: "attempt.streaming",
    displayLevel: "default",
    severity: "info",
    sensitivity: "sensitive",
    title:
      eventMode === "unknown"
        ? "Visual experimental adapter event"
        : "Visual stream delta",
    summary:
      eventMode === "unknown"
        ? "forward compatible visual summary"
        : "delta summary",
    content: VISUAL_SMOKE_MARKDOWN_STREAM_CONTENT,
    expandable: true,
    payloadSummary: Object.freeze({
      present: true,
      kind: "object",
      keyCount: 1,
    }),
    metadataSummary: Object.freeze({
      present: true,
      kind: "object",
      keyCount: 2,
    }),
    expanded: state.streamEventExpanded,
    childCount: 0,
    children: Object.freeze([]),
    artifactRefs: Object.freeze([
      Object.freeze({
        artifactId: "artifact_visual_report",
        kind: "file",
        displayName: "Visual report",
        mimeType: "text/markdown",
        sizeBytes: 256,
        previewText: "Visual report preview",
        path: "artifacts/visual-report.md",
      }),
    ]),
    createdAt: "2026-06-23T00:00:00.000Z",
  } satisfies RuntimeWorkbenchShellRuntimeStreamPanelSnapshot["timelineItems"][number]);
  return Object.freeze({
    status: "full_reload_required",
    totalEvents: 3,
    bufferedEventCount: 3,
    matchingEventCount: 1,
    visibleEventCount: 1,
    hiddenEventCount: 2,
    foldedChildCount: 0,
    read: Object.freeze({
      lastSeenTotalEvents: 2,
      unreadCount: 1,
    }),
    search: Object.freeze({
      query: "delta",
      matchCount: 1,
      activeMatchIndex: 0,
      activeEventId: event.id,
    }),
    summaryItems: Object.freeze([]),
    timelineItems: Object.freeze([event]),
    selectedEvent: event,
    fullReload: Object.freeze({
      acknowledged: false,
      lastEventId: "evt_old",
      reason: "Replay point expired",
      status: 412,
      errorCode: "SE_SSE_REPLAY_NOT_FOUND",
    }),
  });
}

function parseVisualSmokeStreamEventMode(): VisualSmokeStreamEventMode {
  const streamEventMode = new URLSearchParams(window.location.search).get(
    "streamEvent",
  );
  return streamEventMode === "unknown" ? "unknown" : "known";
}

function parseVisualSmokeChatBoxMode(): VisualSmokeChatBoxMode {
  const chatBoxMode = new URLSearchParams(window.location.search).get(
    "chatBox",
  );
  return chatBoxMode === "enabled" ? "enabled" : "disabled";
}

function buildVisualSmokeChromeSnapshot(
  state: VisualSmokeState,
  disposed: boolean,
): RuntimeWorkbenchShellChromeSnapshot {
  const activePanelLabel = visualSmokePanelLabel(state.activePanel);
  return Object.freeze({
    dockItems: Object.freeze([
      Object.freeze({
        id: "workflow_canvas",
        label: "Canvas",
        title: "Workflow canvas.",
        active: state.activePanel === "canvas",
        enabled: !disposed,
        status: disposed ? "disposed" : "active",
        badgeLabel: disposed ? "Disposed" : "Active",
        tone: disposed ? "danger" : "success",
        targetPanel: "canvas",
      }),
      Object.freeze({
        id: "lifecycle_panel",
        label: "Lifecycle",
        title: "Runtime lifecycle panel.",
        active: state.activePanel === "lifecycle",
        enabled: !disposed,
        status: disposed ? "disposed" : "active",
        badgeLabel: disposed ? "Disposed" : "Active",
        tone: disposed ? "danger" : "success",
        targetPanel: "lifecycle",
      }),
      Object.freeze({
        id: "runtime_stream",
        label: "Stream",
        title: "Runtime stream panel.",
        active: state.activePanel === "stream",
        enabled: !disposed,
        status: disposed ? "disposed" : "empty",
        badgeLabel: disposed ? "Disposed" : null,
        tone: disposed ? "danger" : "neutral",
        targetPanel: "stream",
      }),
      Object.freeze({
        id: "task_drawer",
        label: "Tasks",
        title: "Task drawer.",
        active: false,
        enabled: false,
        status: disposed ? "disposed" : "active",
        badgeLabel: disposed ? "Disposed" : "Active",
        tone: disposed ? "danger" : "success",
        targetPanel: null,
      }),
    ]),
    fileTree: Object.freeze({
      title: "File Tree",
      summary: `${activePanelLabel} focus anchors`,
      nodes: Object.freeze([
        Object.freeze({
          id: "workspace_root",
          label: "Workspace",
          pathLabel: "workspace root",
          statusLabel: disposed ? "Disposed" : "Open",
          depth: 0,
          active: false,
          tone: disposed ? "danger" : "success",
        }),
        Object.freeze({
          id: "workflow_graph",
          label: "Graph spec",
          pathLabel: "specs/schemas/workflow_graph.md",
          statusLabel: "Spec",
          depth: 1,
          active: state.activePanel === "canvas",
          tone: "neutral",
        }),
        Object.freeze({
          id: "runtime_stream",
          label: "Runtime stream",
          pathLabel: disposed ? "Disposed" : "No active stream",
          statusLabel: disposed ? "Disposed" : "Idle",
          depth: 1,
          active: state.activePanel === "stream",
          tone: disposed ? "danger" : "neutral",
        }),
        Object.freeze({
          id: "reviews",
          label: "Review reports",
          pathLabel: "docs/reviews",
          statusLabel: "M1.5",
          depth: 1,
          active: false,
          tone: "accent",
        }),
        Object.freeze({
          id: "accepted_specs",
          label: "Accepted specs",
          pathLabel: "specs",
          statusLabel: "Read-only",
          depth: 1,
          active: false,
          tone: "neutral",
        }),
      ]),
    }),
    versionSnapshots: Object.freeze({
      title: "Version Snapshots",
      summary: `${activePanelLabel} scaffold history`,
      items: Object.freeze([
        Object.freeze({
          id: "draft",
          label: "Draft",
          value: "v0",
          statusLabel: "Read-only",
          active: state.activePanel === "canvas",
          tone: "neutral",
        }),
        Object.freeze({
          id: "validation",
          label: "Validation",
          value: `${VISUAL_SMOKE_TIMELINE_ITEMS.length} visible`,
          statusLabel: disposed ? "Disposed" : "Active",
          active: state.activePanel === "lifecycle",
          tone: disposed ? "danger" : "success",
        }),
        Object.freeze({
          id: "runtime",
          label: "Runtime",
          value: disposed ? "Disposed" : "No active stream",
          statusLabel: disposed ? "Disposed" : "Idle",
          active: state.activePanel === "stream",
          tone: disposed ? "danger" : "neutral",
        }),
        Object.freeze({
          id: "git_snapshot",
          label: "Git snapshot",
          value: "Not created",
          statusLabel: "Future",
          active: false,
          tone: disposed ? "danger" : "neutral",
        }),
      ]),
    }),
    workflowCanvas: Object.freeze({
      title: "Workflow Canvas",
      summary: `${activePanelLabel} graph scaffold`,
      statusLabel: disposed ? "Disposed" : "Read-only",
      nodes: Object.freeze([
        Object.freeze({
          nodeId: "start",
          type: "start",
          title: "Start",
          statusLabel: "manual",
          position: Object.freeze({ x: 16, y: 44 }),
          active: false,
          tone: disposed ? "danger" : "success",
        }),
        Object.freeze({
          nodeId: "context_task",
          type: "execution_task",
          title: "Collect context",
          statusLabel: "execution_task",
          position: Object.freeze({ x: 32, y: 28 }),
          active:
            state.activePanel === "canvas" || state.activePanel === "stream",
          tone: disposed ? "danger" : "accent",
        }),
        Object.freeze({
          nodeId: "review_task",
          type: "evaluation_task",
          title: "Review result",
          statusLabel: "evaluation_task",
          position: Object.freeze({ x: 56, y: 44 }),
          active: state.activePanel === "lifecycle",
          tone: disposed ? "danger" : "warning",
        }),
        Object.freeze({
          nodeId: "repair_task",
          type: "repair_task",
          title: "Repair loop",
          statusLabel: "repair_task",
          position: Object.freeze({ x: 56, y: 78 }),
          active: false,
          tone: disposed ? "danger" : "warning",
        }),
        Object.freeze({
          nodeId: "end",
          type: "end",
          title: "End",
          statusLabel: "archive",
          position: Object.freeze({ x: 84, y: 44 }),
          active: false,
          tone: disposed ? "danger" : "success",
        }),
      ]),
      edges: Object.freeze([
        Object.freeze({
          edgeId: "start_to_context",
          sourceNodeId: "start",
          targetNodeId: "context_task",
          type: "normal",
          label: "start",
          tone: disposed ? "danger" : "neutral",
        }),
        Object.freeze({
          edgeId: "context_to_review",
          sourceNodeId: "context_task",
          targetNodeId: "review_task",
          type: "normal",
          label: "output",
          tone: disposed ? "danger" : "accent",
        }),
        Object.freeze({
          edgeId: "review_to_end",
          sourceNodeId: "review_task",
          targetNodeId: "end",
          type: "pass",
          label: "pass",
          tone: disposed ? "danger" : "success",
        }),
        Object.freeze({
          edgeId: "review_to_repair",
          sourceNodeId: "review_task",
          targetNodeId: "repair_task",
          type: "fail",
          label: "fail",
          tone: disposed ? "danger" : "warning",
        }),
        Object.freeze({
          edgeId: "repair_to_context",
          sourceNodeId: "repair_task",
          targetNodeId: "context_task",
          type: "repair",
          label: "repair",
          tone: disposed ? "danger" : "warning",
        }),
      ]),
    }),
    taskDrawer: Object.freeze({
      title: "Task Drawer",
      summary: `${activePanelLabel} focus`,
      collapsedSummary: `${activePanelLabel} focus, ${VISUAL_SMOKE_TIMELINE_ITEMS.length} visible, 0 unread`,
      collapsible: true,
      defaultCollapsed: false,
      expandLabel: "Expand drawer",
      collapseLabel: "Collapse drawer",
      items: Object.freeze([
        Object.freeze({
          id: "active_panel",
          label: "Active panel",
          value: activePanelLabel,
          tone: disposed ? "danger" : "neutral",
        }),
        Object.freeze({
          id: "lifecycle_panel",
          label: "Lifecycle",
          value: disposed ? "Disposed" : "Active",
          tone: disposed ? "danger" : "success",
        }),
        Object.freeze({
          id: "runtime_stream",
          label: "Stream",
          value: disposed ? "Disposed" : "Idle",
          tone: disposed ? "danger" : "neutral",
        }),
        Object.freeze({
          id: "visible_items",
          label: "Visible",
          value: String(VISUAL_SMOKE_TIMELINE_ITEMS.length),
          tone: "neutral",
        }),
        Object.freeze({
          id: "unread_events",
          label: "Unread",
          value: "0",
          tone: "neutral",
        }),
      ]),
    }),
    chatBox: Object.freeze({
      title: "Chat Box",
      placeholder: "Ask about the active workflow",
      enabled: state.chatBoxMode === "enabled" && !disposed,
      statusLabel: disposed ? "Disposed" : "Idle",
      collapsedSummary: `${activePanelLabel} focus, chat ${disposed ? "disposed" : "idle"}`,
      collapsible: true,
      defaultCollapsed: false,
      expandLabel: "Expand chat",
      collapseLabel: "Collapse chat",
    }),
  });
}

function visualSmokePanelLabel(panel: RuntimeWorkbenchPanelId): string {
  switch (panel) {
    case "canvas":
      return "Canvas";
    case "lifecycle":
      return "Lifecycle";
    case "stream":
      return "Stream";
  }
}

function buildVisualSmokeEnabledActionIds(
  activePanel: RuntimeWorkbenchPanelId,
  disposed: boolean,
): readonly RuntimeWorkbenchShellActionId[] {
  if (disposed) {
    return Object.freeze([]);
  }
  const enabledActionIds: RuntimeWorkbenchShellActionId[] = [];
  if (activePanel !== "canvas") {
    enabledActionIds.push("show_canvas_panel");
  }
  if (activePanel !== "lifecycle") {
    enabledActionIds.push("show_lifecycle_panel");
  }
  if (activePanel !== "stream") {
    enabledActionIds.push("show_stream_panel");
  }
  return Object.freeze(enabledActionIds);
}

const VISUAL_SMOKE_TIMELINE_ITEMS: readonly RuntimeLifecyclePanelTimelineItem[] =
  Object.freeze([
    Object.freeze({
      id: "visual-smoke-startup-ready",
      source: "startup",
      sourceLabel: "Startup",
      kind: "runtime_ready",
      phase: "ready",
      tone: "success",
      statusLabel: "Ready",
      title: "Runtime READY emitted",
      summary: "Loopback runtime accepted the desktop token.",
      badges: Object.freeze(["startup", "complete"] as const),
    }),
    Object.freeze({
      id: "visual-smoke-runtime-warning",
      source: "startup",
      sourceLabel: "Startup",
      kind: "waiting_for_existing",
      phase: "waiting",
      tone: "warning",
      statusLabel: "Waiting",
      title: "Waiting for active runtime lock handoff",
      summary:
        "A long diagnostic summary wraps across compact panels without overlapping adjacent controls.",
      badges: Object.freeze(["startup", "action_required"] as const),
    }),
    Object.freeze({
      id: "visual-smoke-retryable-error",
      source: "startup",
      sourceLabel: "Startup",
      kind: "startup_timed_out",
      phase: "timed_out",
      tone: "error",
      statusLabel: "Timed out",
      title: "Startup timed out after bounded wait",
      summary:
        "Retryable startup issue keeps failure details visible while preserving shell layout density.",
      badges: Object.freeze([
        "startup",
        "action_required",
        "retryable",
      ] as const),
    }),
    Object.freeze({
      id: "visual-smoke-startup-complete",
      source: "startup",
      sourceLabel: "Startup",
      kind: "startup_complete",
      phase: "ready",
      tone: "success",
      statusLabel: "Complete",
      title: "Startup sequence complete",
      summary:
        "Lifecycle panel can display normal completion alongside warnings.",
      badges: Object.freeze(["startup", "complete"] as const),
    }),
    Object.freeze({
      id: "visual-smoke-shutdown-registered",
      source: "shutdown",
      sourceLabel: "Shutdown",
      kind: "registered",
      phase: "shutting_down",
      tone: "info",
      statusLabel: "Registered",
      title: "Shutdown observer registered",
      summary:
        "Shutdown status remains visible in the same responsive timeline.",
      badges: Object.freeze(["shutdown"] as const),
    }),
  ]);

function nextTimelineItemId(currentItemId: string): string {
  const currentIndex = VISUAL_SMOKE_TIMELINE_ITEMS.findIndex(
    (item) => item.id === currentItemId,
  );
  const nextIndex = (currentIndex + 1) % VISUAL_SMOKE_TIMELINE_ITEMS.length;
  return VISUAL_SMOKE_TIMELINE_ITEMS[nextIndex]?.id ?? currentItemId;
}

function previousTimelineItemId(currentItemId: string): string {
  const currentIndex = VISUAL_SMOKE_TIMELINE_ITEMS.findIndex(
    (item) => item.id === currentItemId,
  );
  const nextIndex =
    currentIndex <= 0
      ? VISUAL_SMOKE_TIMELINE_ITEMS.length - 1
      : currentIndex - 1;
  return VISUAL_SMOKE_TIMELINE_ITEMS[nextIndex]?.id ?? currentItemId;
}

mountRuntimeWorkbenchShellVisualSmoke();
