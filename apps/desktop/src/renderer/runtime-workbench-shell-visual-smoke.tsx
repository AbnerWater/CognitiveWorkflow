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
  RuntimeWorkbenchShellChromeSnapshot,
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
  readonly lastHandledShortcutLabel: string | null;
}

function createRuntimeWorkbenchShellVisualSmokeSession(): RuntimeWorkbenchShellDomSession {
  const listeners = new Set<() => void>();
  let state: VisualSmokeState = {
    activePanel: "lifecycle",
    focusedTimelineItemId: VISUAL_SMOKE_TIMELINE_ITEMS[0]?.id ?? "",
    selectedTimelineItemId: VISUAL_SMOKE_TIMELINE_ITEMS[1]?.id ?? null,
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
    dispatch: async (command) => handleLifecycleCommand(command),
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
  return Object.freeze({
    activePanel: state.activePanel,
    activePanelLabel:
      state.activePanel === "lifecycle" ? "Lifecycle" : "Stream",
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
    runtimeStreamStatus: "empty",
    runtimeStreamChannelLabel: null,
    runtimeStreamPanel: null,
    lastHandledShortcutLabel: state.lastHandledShortcutLabel,
    panels: Object.freeze([
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
        status: "empty",
        badgeLabel: null,
        tone: "neutral",
      }),
    ]),
    actions: Object.freeze([
      Object.freeze({
        id: "show_lifecycle_panel",
        label: "Lifecycle",
        title: "Show runtime lifecycle panel.",
        slot: "navigation",
        tone: "neutral",
        targetPanel: "lifecycle",
        enabled: !disposed,
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
        enabled: !disposed,
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
        id: "show_lifecycle_panel",
        label: "Lifecycle",
        title: "Show runtime lifecycle panel.",
        keys: Object.freeze(["Ctrl", "1"]),
        enabled: !disposed,
      }),
      Object.freeze({
        id: "show_stream_panel",
        label: "Stream",
        title: "Show runtime stream panel.",
        keys: Object.freeze(["Ctrl", "2"]),
        enabled: !disposed,
      }),
    ]),
    statusItems: Object.freeze([
      Object.freeze({
        id: "active_panel",
        label: "Panel",
        value: state.activePanel === "lifecycle" ? "Lifecycle" : "Stream",
        tone: "neutral",
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
      "show_lifecycle_panel",
      "show_stream_panel",
      "open_lifecycle_panel_session",
    ] as const),
    enabledActionIds: Object.freeze([
      "show_lifecycle_panel",
      "show_stream_panel",
    ] as const),
    disposed,
    ariaLive: disposed ? "assertive" : "polite",
    emptyState: null,
  });
}

function buildVisualSmokeChromeSnapshot(
  state: VisualSmokeState,
  disposed: boolean,
): RuntimeWorkbenchShellChromeSnapshot {
  return Object.freeze({
    dockItems: Object.freeze([
      Object.freeze({
        id: "workflow_canvas",
        label: "Canvas",
        title: "Workflow canvas.",
        active: false,
        enabled: false,
        status: "empty",
        badgeLabel: null,
        tone: "neutral",
        targetPanel: null,
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
    taskDrawer: Object.freeze({
      title: "Task Drawer",
      summary:
        state.activePanel === "lifecycle" ? "Lifecycle focus" : "Stream focus",
      items: Object.freeze([
        Object.freeze({
          id: "active_panel",
          label: "Active panel",
          value: state.activePanel === "lifecycle" ? "Lifecycle" : "Stream",
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
      enabled: false,
      statusLabel: disposed ? "Disposed" : "Idle",
    }),
  });
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
