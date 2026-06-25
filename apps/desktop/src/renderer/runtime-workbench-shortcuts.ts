import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeLifecyclePanelInteractionCommand } from "./runtime-lifecycle-panel-interaction.js";
import type { RuntimeStreamInteractionCommand } from "./runtime-stream-interaction.js";
import type {
  RuntimeWorkbenchInteraction,
  RuntimeWorkbenchInteractionCommand,
  RuntimeWorkbenchInteractionErrorHandler,
  RuntimeWorkbenchInteractionSnapshot,
} from "./runtime-workbench-interaction.js";

export type RuntimeWorkbenchShortcutId =
  | "show_canvas_panel"
  | "show_lifecycle_panel"
  | "show_stream_panel"
  | "focus_lifecycle_primary_command"
  | "focus_next_lifecycle_command"
  | "focus_previous_lifecycle_command"
  | "activate_lifecycle_focused_command"
  | "refresh_lifecycle_status"
  | "start_or_retry_lifecycle_runtime"
  | "stop_lifecycle_runtime"
  | "focus_next_lifecycle_timeline_item"
  | "focus_previous_lifecycle_timeline_item"
  | "select_lifecycle_timeline_item"
  | "clear_lifecycle_selection"
  | "dispose_lifecycle_panel_session"
  | "dispose_runtime_stream_session";

export interface RuntimeWorkbenchShortcutKeyEventTarget {
  readonly tagName?: string;
  readonly role?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

export interface RuntimeWorkbenchShortcutKeyEvent {
  readonly key: string;
  readonly code?: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
  readonly defaultPrevented?: boolean;
  readonly target?: RuntimeWorkbenchShortcutKeyEventTarget;
  readonly preventDefault?: () => void;
}

export interface RuntimeWorkbenchShortcutBinding {
  readonly id: RuntimeWorkbenchShortcutId;
  readonly key: string;
  readonly code?: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly allowRepeat?: boolean;
  readonly allowEditableTarget?: boolean;
  readonly preventDefault?: boolean;
  readonly command: RuntimeWorkbenchInteractionCommand;
}

export interface RuntimeWorkbenchShortcutResolution {
  readonly shortcutId: RuntimeWorkbenchShortcutId;
  readonly command: RuntimeWorkbenchInteractionCommand;
  readonly preventDefault: boolean;
}

export interface RuntimeWorkbenchShortcutControllerSnapshot {
  readonly workbench: RuntimeWorkbenchInteractionSnapshot;
  readonly availableShortcutIds: readonly RuntimeWorkbenchShortcutId[];
  readonly enabledShortcutIds: readonly RuntimeWorkbenchShortcutId[];
  readonly lastHandledShortcutId: RuntimeWorkbenchShortcutId | null;
  readonly disposed: boolean;
}

export type RuntimeWorkbenchShortcutControllerListener = (
  snapshot: RuntimeWorkbenchShortcutControllerSnapshot,
) => void;

export type RuntimeWorkbenchShortcutControllerErrorHandler =
  RuntimeWorkbenchInteractionErrorHandler;

export interface RuntimeWorkbenchShortcutController {
  readonly getSnapshot: () => RuntimeWorkbenchShortcutControllerSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchShortcutControllerSnapshot;
  readonly snapshot: () => RuntimeWorkbenchShortcutControllerSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchShortcutControllerListener,
  ) => RuntimeStatusUnsubscribe;
  readonly resolveKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => RuntimeWorkbenchShortcutResolution | null;
  readonly handleKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => Promise<RuntimeWorkbenchShortcutControllerSnapshot>;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeWorkbenchShortcutControllerOptions {
  readonly interaction: RuntimeWorkbenchInteraction;
  readonly onError?: RuntimeWorkbenchShortcutControllerErrorHandler;
}

export const DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS: readonly RuntimeWorkbenchShortcutBinding[] =
  Object.freeze([
    runtimeWorkbenchShortcutBinding({
      id: "show_canvas_panel",
      key: "0",
      ctrlKey: true,
      command: { type: "show_canvas_panel" },
    }),
    runtimeWorkbenchShortcutBinding({
      id: "show_lifecycle_panel",
      key: "1",
      ctrlKey: true,
      command: { type: "show_lifecycle_panel" },
    }),
    runtimeWorkbenchShortcutBinding({
      id: "show_stream_panel",
      key: "2",
      ctrlKey: true,
      command: { type: "show_stream_panel" },
    }),
    runtimeWorkbenchShortcutBinding({
      id: "focus_lifecycle_primary_command",
      key: "Home",
      altKey: true,
      command: lifecycleShortcutCommand("focus_primary_command"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "focus_next_lifecycle_command",
      key: "ArrowRight",
      altKey: true,
      command: lifecycleShortcutCommand("focus_next_command"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "focus_previous_lifecycle_command",
      key: "ArrowLeft",
      altKey: true,
      command: lifecycleShortcutCommand("focus_previous_command"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "select_lifecycle_timeline_item",
      key: "Enter",
      command: lifecycleShortcutCommand("select_focused_timeline_item"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "activate_lifecycle_focused_command",
      key: "Enter",
      command: lifecycleShortcutCommand("activate_focused_command"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "refresh_lifecycle_status",
      key: "F5",
      command: lifecycleShortcutCommand("refresh_status"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "start_or_retry_lifecycle_runtime",
      key: "Enter",
      ctrlKey: true,
      command: lifecycleShortcutCommand("start_or_retry_runtime"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "stop_lifecycle_runtime",
      key: "Escape",
      ctrlKey: true,
      command: lifecycleShortcutCommand("stop_runtime"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "focus_next_lifecycle_timeline_item",
      key: "ArrowDown",
      altKey: true,
      command: lifecycleShortcutCommand("focus_next_timeline_item"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "focus_previous_lifecycle_timeline_item",
      key: "ArrowUp",
      altKey: true,
      command: lifecycleShortcutCommand("focus_previous_timeline_item"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "clear_lifecycle_selection",
      key: "Escape",
      command: lifecycleShortcutCommand("clear_selection"),
    }),
    runtimeWorkbenchShortcutBinding({
      id: "dispose_lifecycle_panel_session",
      key: "Escape",
      shiftKey: true,
      command: { type: "dispose_lifecycle_panel_session" },
    }),
    runtimeWorkbenchShortcutBinding({
      id: "dispose_runtime_stream_session",
      key: "Escape",
      shiftKey: true,
      command: { type: "dispose_runtime_stream_session" },
    }),
  ] satisfies RuntimeWorkbenchShortcutBinding[]);

export function createRuntimeWorkbenchShortcutController(
  options: CreateRuntimeWorkbenchShortcutControllerOptions,
): RuntimeWorkbenchShortcutController {
  const listeners = new Set<RuntimeWorkbenchShortcutControllerListener>();
  let interactionUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let suppressInteractionPublish = false;
  let lastHandledShortcutId: RuntimeWorkbenchShortcutId | null = null;
  let disposed = false;

  const initialSnapshot = freezeRuntimeWorkbenchShortcutControllerSnapshot(
    buildRuntimeWorkbenchShortcutControllerSnapshot(
      options.interaction.getSnapshot(),
      lastHandledShortcutId,
      disposed,
    ),
  );
  let currentSignature =
    runtimeWorkbenchShortcutControllerSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break shortcut propagation.
    }
  };

  const isDisposed = (): boolean =>
    disposed || options.interaction.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime workbench shortcut controller is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeWorkbenchShortcutControllerSnapshot => {
    const nextSnapshot = freezeRuntimeWorkbenchShortcutControllerSnapshot(
      buildRuntimeWorkbenchShortcutControllerSnapshot(
        options.interaction.getSnapshot(),
        lastHandledShortcutId,
        isDisposed(),
      ),
    );
    const nextSignature =
      runtimeWorkbenchShortcutControllerSnapshotSignature(nextSnapshot);
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
        listener(currentSnapshot);
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensureInteractionSubscription = (): void => {
    if (
      listeners.size === 0 ||
      interactionUnsubscribe !== undefined ||
      isDisposed()
    ) {
      return;
    }
    interactionUnsubscribe = options.interaction.subscribe(() => {
      if (suppressInteractionPublish) {
        return;
      }
      publishIfChanged();
    });
  };

  const releaseInteractionSubscription = (): void => {
    interactionUnsubscribe?.();
    interactionUnsubscribe = undefined;
  };

  const resolveKeyEvent = (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ): RuntimeWorkbenchShortcutResolution | null => {
    if (isDisposed()) {
      return null;
    }
    const safeEvent = requireRuntimeWorkbenchShortcutKeyEvent(event);
    const snapshot = captureSnapshot();
    for (const binding of DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS) {
      if (
        runtimeWorkbenchShortcutBindingMatchesEvent(binding, safeEvent) &&
        runtimeWorkbenchShortcutBindingIsEnabled(binding, snapshot.workbench)
      ) {
        return freezeRuntimeWorkbenchShortcutResolution({
          shortcutId: binding.id,
          command: cloneRuntimeWorkbenchInteractionCommand(binding.command),
          preventDefault: binding.preventDefault ?? true,
        });
      }
    }
    return null;
  };

  const handleKeyEvent = async (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ): Promise<RuntimeWorkbenchShortcutControllerSnapshot> => {
    assertActive();
    const resolution = resolveKeyEvent(event);
    if (resolution === null) {
      return captureSnapshot();
    }
    if (resolution.preventDefault) {
      event.preventDefault?.();
    }
    suppressInteractionPublish = true;
    try {
      await options.interaction.dispatch(resolution.command);
    } finally {
      suppressInteractionPublish = false;
    }
    lastHandledShortcutId = resolution.shortcutId;
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
      ensureInteractionSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseInteractionSubscription();
        }
        return deleted;
      };
    },
    resolveKeyEvent,
    handleKeyEvent,
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseInteractionSubscription();
      publishIfChanged(true);
      listeners.clear();
      return true;
    },
    isDisposed,
  };
}

export function buildRuntimeWorkbenchShortcutControllerSnapshot(
  workbench: RuntimeWorkbenchInteractionSnapshot,
  lastHandledShortcutId: RuntimeWorkbenchShortcutId | null,
  disposed = workbench.disposed,
): RuntimeWorkbenchShortcutControllerSnapshot {
  const availableShortcutIds = DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS.map(
    (binding) => binding.id,
  );
  const enabledShortcutIds = disposed
    ? []
    : DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS.filter((binding) =>
        runtimeWorkbenchShortcutBindingIsEnabled(binding, workbench),
      ).map((binding) => binding.id);
  return {
    workbench,
    availableShortcutIds: Object.freeze([...availableShortcutIds]),
    enabledShortcutIds: Object.freeze([...enabledShortcutIds]),
    lastHandledShortcutId,
    disposed,
  };
}

function runtimeWorkbenchShortcutBinding(
  binding: RuntimeWorkbenchShortcutBinding,
): RuntimeWorkbenchShortcutBinding {
  return Object.freeze({
    ...binding,
    command: cloneRuntimeWorkbenchInteractionCommand(binding.command),
  });
}

function lifecycleShortcutCommand(
  command: RuntimeLifecyclePanelInteractionCommand,
): RuntimeWorkbenchInteractionCommand {
  return {
    type: "dispatch_lifecycle_panel",
    command,
  };
}

function runtimeWorkbenchShortcutBindingMatchesEvent(
  binding: RuntimeWorkbenchShortcutBinding,
  event: RuntimeWorkbenchShortcutKeyEvent,
): boolean {
  if (event.defaultPrevented === true) {
    return false;
  }
  if (event.repeat === true && binding.allowRepeat !== true) {
    return false;
  }
  if (
    binding.allowEditableTarget !== true &&
    runtimeWorkbenchShortcutEventTargetIsEditable(event.target)
  ) {
    return false;
  }
  if (
    normalizeRuntimeWorkbenchShortcutKey(binding.key) !==
    normalizeRuntimeWorkbenchShortcutKey(event.key)
  ) {
    return false;
  }
  if (binding.code !== undefined && binding.code !== event.code) {
    return false;
  }
  return (
    (binding.altKey ?? false) === (event.altKey ?? false) &&
    (binding.ctrlKey ?? false) === (event.ctrlKey ?? false) &&
    (binding.metaKey ?? false) === (event.metaKey ?? false) &&
    (binding.shiftKey ?? false) === (event.shiftKey ?? false)
  );
}

function runtimeWorkbenchShortcutBindingIsEnabled(
  binding: RuntimeWorkbenchShortcutBinding,
  snapshot: RuntimeWorkbenchInteractionSnapshot,
): boolean {
  if (snapshot.disposed) {
    return false;
  }
  const command = binding.command;
  switch (command.type) {
    case "show_canvas_panel":
    case "show_lifecycle_panel":
    case "show_stream_panel":
      return snapshot.enabledCommandIds.includes(command.type);
    case "dispose_lifecycle_panel_session":
      return (
        snapshot.activePanel === "lifecycle" &&
        snapshot.enabledCommandIds.includes(command.type)
      );
    case "dispose_runtime_stream_session":
      return (
        snapshot.activePanel === "stream" &&
        snapshot.enabledCommandIds.includes(command.type)
      );
    case "open_lifecycle_panel_session":
    case "open_runtime_stream_session":
    case "set_execution_mode":
    case "run_node_once":
    case "create_project":
    case "refresh_references":
    case "import_reference":
    case "set_reference_enabled":
      return false;
    case "dispatch_lifecycle_panel":
      return (
        snapshot.activePanel === "lifecycle" &&
        snapshot.enabledCommandIds.includes("dispatch_lifecycle_panel") &&
        lifecycleShortcutCommandIsEnabled(command.command, snapshot)
      );
    case "dispatch_runtime_stream":
      return (
        snapshot.activePanel === "stream" &&
        snapshot.enabledCommandIds.includes("dispatch_runtime_stream")
      );
  }
}

function lifecycleShortcutCommandIsEnabled(
  command: RuntimeLifecyclePanelInteractionCommand,
  snapshot: RuntimeWorkbenchInteractionSnapshot,
): boolean {
  const lifecycle =
    snapshot.workbench.lifecyclePanel.activeSession?.interaction ?? null;
  if (lifecycle === null || lifecycle.disposed) {
    return false;
  }
  switch (command) {
    case "focus_primary_command":
    case "focus_next_command":
    case "focus_previous_command":
      return lifecycle.availableCommandIds.length > 0;
    case "activate_focused_command":
      return lifecycle.canActivateFocusedCommand;
    case "refresh_status":
      return lifecycle.enabledCommandIds.includes("refresh_status");
    case "stop_runtime":
      return lifecycle.enabledCommandIds.includes("stop_runtime");
    case "start_or_retry_runtime": {
      const primaryCommand = lifecycle.view.panel.primaryCommand;
      return (
        primaryCommand !== null &&
        (primaryCommand.id === "start_runtime" ||
          primaryCommand.id === "retry_startup") &&
        primaryCommand.enabled &&
        !primaryCommand.busy
      );
    }
    case "focus_next_timeline_item":
    case "focus_previous_timeline_item":
      return lifecycle.view.visibleTimelineItemCount > 0;
    case "select_focused_timeline_item":
      return lifecycle.canSelectFocusedTimelineItem;
    case "clear_selection":
      return (
        lifecycle.view.selectedTimelineItemId !== null ||
        lifecycle.focusTarget !== null
      );
  }
}

function runtimeWorkbenchShortcutEventTargetIsEditable(
  target: RuntimeWorkbenchShortcutKeyEventTarget | undefined,
): boolean {
  if (target === undefined) {
    return false;
  }
  if (target.isContentEditable === true) {
    return true;
  }
  const tagName = target.tagName?.toLowerCase();
  if (tagName === "textarea" || tagName === "select" || tagName === "input") {
    return true;
  }
  const role = target.role?.toLowerCase();
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

function requireRuntimeWorkbenchShortcutKeyEvent(
  event: RuntimeWorkbenchShortcutKeyEvent,
): RuntimeWorkbenchShortcutKeyEvent {
  if (!isRecord(event) || typeof event.key !== "string") {
    throw new Error("Invalid runtime workbench shortcut key event");
  }
  if (event.key.length === 0 || event.key.length > 64) {
    throw new Error("Invalid runtime workbench shortcut key event");
  }
  if (
    "code" in event &&
    event.code !== undefined &&
    (typeof event.code !== "string" ||
      event.code.length === 0 ||
      event.code.length > 128)
  ) {
    throw new Error("Invalid runtime workbench shortcut key event");
  }
  for (const field of [
    "altKey",
    "ctrlKey",
    "metaKey",
    "shiftKey",
    "repeat",
    "defaultPrevented",
  ] as const) {
    if (
      field in event &&
      event[field] !== undefined &&
      typeof event[field] !== "boolean"
    ) {
      throw new Error("Invalid runtime workbench shortcut key event");
    }
  }
  if ("target" in event && event.target !== undefined) {
    requireRuntimeWorkbenchShortcutKeyEventTarget(event.target);
  }
  if (
    "preventDefault" in event &&
    event.preventDefault !== undefined &&
    typeof event.preventDefault !== "function"
  ) {
    throw new Error("Invalid runtime workbench shortcut key event");
  }
  return event;
}

function requireRuntimeWorkbenchShortcutKeyEventTarget(
  target: RuntimeWorkbenchShortcutKeyEventTarget,
): void {
  if (!isRecord(target)) {
    throw new Error("Invalid runtime workbench shortcut key event");
  }
  for (const field of ["tagName", "role", "type"] as const) {
    if (
      field in target &&
      target[field] !== undefined &&
      typeof target[field] !== "string"
    ) {
      throw new Error("Invalid runtime workbench shortcut key event");
    }
  }
  if (
    "isContentEditable" in target &&
    target.isContentEditable !== undefined &&
    typeof target.isContentEditable !== "boolean"
  ) {
    throw new Error("Invalid runtime workbench shortcut key event");
  }
}

function cloneRuntimeWorkbenchInteractionCommand(
  command: RuntimeWorkbenchInteractionCommand,
): RuntimeWorkbenchInteractionCommand {
  switch (command.type) {
    case "show_canvas_panel":
    case "show_lifecycle_panel":
    case "show_stream_panel":
    case "dispose_lifecycle_panel_session":
    case "dispose_runtime_stream_session":
      return Object.freeze({ type: command.type });
    case "set_execution_mode":
      return Object.freeze({ type: command.type, mode: command.mode });
    case "run_node_once":
      return Object.freeze({
        type: command.type,
        runId: command.runId,
        nodeId: command.nodeId,
        ...(command.projectId !== undefined
          ? { projectId: command.projectId }
          : {}),
        ...(command.idempotencyKey !== undefined
          ? { idempotencyKey: command.idempotencyKey }
          : {}),
      });
    case "create_project":
      return Object.freeze({
        type: command.type,
        displayName: command.displayName,
        hostPath: command.hostPath,
        ...(command.idempotencyKey !== undefined
          ? { idempotencyKey: command.idempotencyKey }
          : {}),
        ...(command.settingsOverrides !== undefined
          ? { settingsOverrides: command.settingsOverrides }
          : {}),
      });
    case "refresh_references":
      return Object.freeze({
        type: command.type,
        projectId: command.projectId,
      });
    case "import_reference":
      return Object.freeze({
        type: command.type,
        projectId: command.projectId,
        fileName: command.fileName,
        fileContentBase64: command.fileContentBase64,
        kind: command.kind,
        ...(command.sensitive !== undefined
          ? { sensitive: command.sensitive }
          : {}),
        ...(command.autoChunk !== undefined
          ? { autoChunk: command.autoChunk }
          : {}),
        ...(command.sourceUrl !== undefined
          ? { sourceUrl: command.sourceUrl }
          : {}),
      });
    case "set_reference_enabled":
      return Object.freeze({
        type: command.type,
        projectId: command.projectId,
        referenceId: command.referenceId,
        enabled: command.enabled,
      });
    case "open_lifecycle_panel_session":
      return Object.freeze({
        type: command.type,
        ...(command.options !== undefined ? { options: command.options } : {}),
      });
    case "open_runtime_stream_session":
      return Object.freeze({
        type: command.type,
        options: command.options,
      });
    case "dispatch_lifecycle_panel":
      return Object.freeze({
        type: command.type,
        command: command.command,
      });
    case "dispatch_runtime_stream":
      return Object.freeze({
        type: command.type,
        command: cloneRuntimeStreamInteractionCommand(command.command),
      });
  }
}

function cloneRuntimeStreamInteractionCommand(
  command: RuntimeStreamInteractionCommand,
): RuntimeStreamInteractionCommand {
  switch (command.type) {
    case "set_search_query":
      return Object.freeze({ type: command.type, query: command.query });
    case "select_event":
      return Object.freeze({ type: command.type, eventId: command.eventId });
    case "set_expanded":
      return Object.freeze({
        type: command.type,
        eventId: command.eventId,
        expanded: command.expanded,
      });
    case "toggle_expanded":
      return Object.freeze({
        type: command.type,
        eventId: command.eventId,
      });
    case "clear_search":
    case "next_search_match":
    case "previous_search_match":
    case "select_active_search_match":
    case "mark_all_read":
    case "acknowledge_full_reload":
      return Object.freeze({ type: command.type });
  }
}

function freezeRuntimeWorkbenchShortcutResolution(
  resolution: RuntimeWorkbenchShortcutResolution,
): RuntimeWorkbenchShortcutResolution {
  return Object.freeze({
    ...resolution,
    command: cloneRuntimeWorkbenchInteractionCommand(resolution.command),
  });
}

function freezeRuntimeWorkbenchShortcutControllerSnapshot(
  snapshot: RuntimeWorkbenchShortcutControllerSnapshot,
): RuntimeWorkbenchShortcutControllerSnapshot {
  return Object.freeze({ ...snapshot });
}

function runtimeWorkbenchShortcutControllerSnapshotSignature(
  snapshot: RuntimeWorkbenchShortcutControllerSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function normalizeRuntimeWorkbenchShortcutKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
