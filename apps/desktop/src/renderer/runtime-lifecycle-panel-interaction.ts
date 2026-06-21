import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  BindRuntimeLifecycleStatusPageLifecycleOptions,
  RuntimeLifecycleStatusPageLifecycleTarget,
} from "./runtime-lifecycle-status-controller.js";
import type {
  RuntimeLifecyclePanelCommand,
  RuntimeLifecyclePanelCommandId,
} from "./runtime-lifecycle-panel-presenter.js";
import type {
  RuntimeLifecyclePanelViewModel,
  RuntimeLifecyclePanelViewModelErrorHandler,
  RuntimeLifecyclePanelViewModelSnapshot,
} from "./runtime-lifecycle-panel-view-model.js";

export type RuntimeLifecyclePanelInteractionCommand =
  | "focus_primary_command"
  | "focus_next_command"
  | "focus_previous_command"
  | "activate_focused_command"
  | "refresh_status"
  | "stop_runtime"
  | "start_or_retry_runtime"
  | "focus_next_timeline_item"
  | "focus_previous_timeline_item"
  | "select_focused_timeline_item"
  | "clear_selection";

export type RuntimeLifecyclePanelInteractionFocusTarget =
  | "command"
  | "timeline_item";

export interface RuntimeLifecyclePanelInteractionSnapshot {
  readonly view: RuntimeLifecyclePanelViewModelSnapshot;
  readonly disposed: boolean;
  readonly focusTarget: RuntimeLifecyclePanelInteractionFocusTarget | null;
  readonly focusedCommandId: RuntimeLifecyclePanelCommandId | null;
  readonly focusedTimelineItemId: string | null;
  readonly availableCommandIds: readonly RuntimeLifecyclePanelCommandId[];
  readonly enabledCommandIds: readonly RuntimeLifecyclePanelCommandId[];
  readonly canActivateFocusedCommand: boolean;
  readonly canSelectFocusedTimelineItem: boolean;
}

export type RuntimeLifecyclePanelInteractionListener = (
  snapshot: RuntimeLifecyclePanelInteractionSnapshot,
) => void;

export type RuntimeLifecyclePanelInteractionErrorHandler =
  RuntimeLifecyclePanelViewModelErrorHandler;

export interface RuntimeLifecyclePanelInteraction {
  readonly snapshot: () => RuntimeLifecyclePanelInteractionSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecyclePanelInteractionListener,
  ) => RuntimeStatusUnsubscribe;
  readonly dispatch: (
    command: RuntimeLifecyclePanelInteractionCommand,
  ) => Promise<RuntimeLifecyclePanelInteractionSnapshot>;
  readonly focusCommand: (
    commandId: RuntimeLifecyclePanelCommandId,
  ) => RuntimeLifecyclePanelInteractionSnapshot;
  readonly focusTimelineItem: (
    itemId: string,
  ) => RuntimeLifecyclePanelInteractionSnapshot;
  readonly invokeCommand: (
    commandId: RuntimeLifecyclePanelCommandId,
  ) => Promise<RuntimeLifecyclePanelInteractionSnapshot>;
  readonly clearSelection: () => RuntimeLifecyclePanelInteractionSnapshot;
  readonly bindPageLifecycle: (
    target: RuntimeLifecycleStatusPageLifecycleTarget,
    options?: BindRuntimeLifecycleStatusPageLifecycleOptions,
  ) => RuntimeStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeLifecyclePanelInteractionOptions {
  readonly viewModel: RuntimeLifecyclePanelViewModel;
  readonly focusedCommandId?: RuntimeLifecyclePanelCommandId | null;
  readonly focusedTimelineItemId?: string | null;
  readonly onError?: RuntimeLifecyclePanelInteractionErrorHandler;
}

interface RuntimeLifecyclePanelInteractionState {
  readonly focusedCommandId: RuntimeLifecyclePanelCommandId | null;
  readonly focusedTimelineItemId: string | null;
}

export function createRuntimeLifecyclePanelInteraction(
  options: CreateRuntimeLifecyclePanelInteractionOptions,
): RuntimeLifecyclePanelInteraction {
  let viewSnapshot = options.viewModel.snapshot();
  let focusedCommandId =
    options.focusedCommandId === undefined || options.focusedCommandId === null
      ? null
      : requireRuntimeLifecyclePanelCommandId(options.focusedCommandId);
  let focusedTimelineItemId =
    options.focusedTimelineItemId === undefined ||
    options.focusedTimelineItemId === null
      ? null
      : requireRuntimeLifecyclePanelTimelineItemId(
          options.focusedTimelineItemId,
        );
  const listeners = new Set<RuntimeLifecyclePanelInteractionListener>();
  const lifecycleUnsubscribes = new Set<RuntimeStatusUnsubscribe>();
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle interaction propagation.
    }
  };

  const isDisposed = (): boolean => disposed || options.viewModel.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime lifecycle panel interaction is disposed");
    }
  };

  const reconcileFocus = (): void => {
    const commands = availableRuntimeLifecyclePanelCommands(viewSnapshot);
    if (
      focusedCommandId !== null &&
      !commands.some((command) => command.id === focusedCommandId)
    ) {
      focusedCommandId = null;
    }
    if (
      focusedTimelineItemId !== null &&
      !viewSnapshot.visibleTimelineItems.some(
        (item) => item.id === focusedTimelineItemId,
      )
    ) {
      focusedTimelineItemId = null;
    }
  };

  const captureViewSnapshot = (): RuntimeLifecyclePanelViewModelSnapshot => {
    viewSnapshot = options.viewModel.snapshot();
    reconcileFocus();
    return viewSnapshot;
  };

  const snapshot = (): RuntimeLifecyclePanelInteractionSnapshot => {
    captureViewSnapshot();
    return buildRuntimeLifecyclePanelInteractionSnapshot(
      viewSnapshot,
      {
        focusedCommandId,
        focusedTimelineItemId,
      },
      isDisposed(),
    );
  };

  const publish = (): void => {
    if (isDisposed()) {
      return;
    }
    captureViewSnapshot();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot());
      } catch (error) {
        reportError(error);
      }
    }
  };

  const focusCommand = (
    commandId: RuntimeLifecyclePanelCommandId,
  ): RuntimeLifecyclePanelInteractionSnapshot => {
    assertActive();
    const safeCommandId = requireRuntimeLifecyclePanelCommandId(commandId);
    if (
      findRuntimeLifecyclePanelCommand(viewSnapshot, safeCommandId) ===
      undefined
    ) {
      throw new Error("Runtime lifecycle panel command is not available");
    }
    focusedCommandId = safeCommandId;
    focusedTimelineItemId = null;
    publish();
    return snapshot();
  };

  const focusTimelineItem = (
    itemId: string,
  ): RuntimeLifecyclePanelInteractionSnapshot => {
    assertActive();
    const safeItemId = requireRuntimeLifecyclePanelTimelineItemId(itemId);
    if (
      !viewSnapshot.visibleTimelineItems.some((item) => item.id === safeItemId)
    ) {
      throw new Error("Runtime lifecycle panel timeline item is not visible");
    }
    focusedTimelineItemId = safeItemId;
    focusedCommandId = null;
    publish();
    return snapshot();
  };

  const invokeCommand = async (
    commandId: RuntimeLifecyclePanelCommandId,
  ): Promise<RuntimeLifecyclePanelInteractionSnapshot> => {
    assertActive();
    const command = requireAvailableRuntimeLifecyclePanelCommand(
      viewSnapshot,
      commandId,
    );
    requireEnabledRuntimeLifecyclePanelCommand(command);
    viewSnapshot = await options.viewModel.invoke(command.id);
    reconcileFocus();
    return snapshot();
  };

  const focusPrimaryCommand = (): RuntimeLifecyclePanelInteractionSnapshot => {
    assertActive();
    const primaryCommand = viewSnapshot.panel.primaryCommand;
    if (primaryCommand === null) {
      focusedCommandId = null;
      publish();
      return snapshot();
    }
    return focusCommand(primaryCommand.id);
  };

  const focusAdjacentCommand = (
    direction: 1 | -1,
  ): RuntimeLifecyclePanelInteractionSnapshot => {
    assertActive();
    const commandIds = availableRuntimeLifecyclePanelCommandIds(viewSnapshot);
    if (commandIds.length === 0) {
      focusedCommandId = null;
      publish();
      return snapshot();
    }
    const activeIndex =
      focusedCommandId === null
        ? -1
        : commandIds.findIndex((commandId) => commandId === focusedCommandId);
    const fallbackIndex = direction === 1 ? 0 : commandIds.length - 1;
    const nextIndex =
      activeIndex < 0
        ? fallbackIndex
        : (activeIndex + direction + commandIds.length) % commandIds.length;
    focusedCommandId = commandIds[nextIndex] ?? null;
    focusedTimelineItemId = null;
    publish();
    return snapshot();
  };

  const focusAdjacentTimelineItem = (
    direction: 1 | -1,
  ): RuntimeLifecyclePanelInteractionSnapshot => {
    assertActive();
    const items = viewSnapshot.visibleTimelineItems;
    if (items.length === 0) {
      focusedTimelineItemId = null;
      publish();
      return snapshot();
    }
    const activeIndex =
      focusedTimelineItemId === null
        ? -1
        : items.findIndex((item) => item.id === focusedTimelineItemId);
    const fallbackIndex = direction === 1 ? 0 : items.length - 1;
    const nextIndex =
      activeIndex < 0
        ? fallbackIndex
        : (activeIndex + direction + items.length) % items.length;
    focusedTimelineItemId = items[nextIndex]?.id ?? null;
    focusedCommandId = null;
    publish();
    return snapshot();
  };

  const selectFocusedTimelineItem =
    (): RuntimeLifecyclePanelInteractionSnapshot => {
      assertActive();
      if (focusedTimelineItemId === null) {
        return snapshot();
      }
      viewSnapshot = options.viewModel.selectTimelineItem(
        focusedTimelineItemId,
      );
      reconcileFocus();
      return snapshot();
    };

  const clearSelection = (): RuntimeLifecyclePanelInteractionSnapshot => {
    assertActive();
    focusedTimelineItemId = null;
    viewSnapshot = options.viewModel.clearSelection();
    reconcileFocus();
    return snapshot();
  };

  const invokeShortcutCommand = async (
    commandId: RuntimeLifecyclePanelCommandId,
  ): Promise<RuntimeLifecyclePanelInteractionSnapshot> => {
    const command = findRuntimeLifecyclePanelCommand(viewSnapshot, commandId);
    if (command === undefined || !command.enabled || command.busy) {
      return snapshot();
    }
    viewSnapshot = await options.viewModel.invoke(command.id);
    reconcileFocus();
    return snapshot();
  };

  const dispatch = async (
    command: RuntimeLifecyclePanelInteractionCommand,
  ): Promise<RuntimeLifecyclePanelInteractionSnapshot> => {
    assertActive();
    const safeCommand = requireRuntimeLifecyclePanelInteractionCommand(command);
    switch (safeCommand) {
      case "focus_primary_command":
        return focusPrimaryCommand();
      case "focus_next_command":
        return focusAdjacentCommand(1);
      case "focus_previous_command":
        return focusAdjacentCommand(-1);
      case "activate_focused_command":
        if (focusedCommandId === null) {
          return snapshot();
        }
        return invokeShortcutCommand(focusedCommandId);
      case "refresh_status":
        return invokeShortcutCommand("refresh_status");
      case "stop_runtime":
        return invokeShortcutCommand("stop_runtime");
      case "start_or_retry_runtime": {
        const primaryCommand = viewSnapshot.panel.primaryCommand;
        if (
          primaryCommand === null ||
          (primaryCommand.id !== "start_runtime" &&
            primaryCommand.id !== "retry_startup")
        ) {
          return snapshot();
        }
        return invokeShortcutCommand(primaryCommand.id);
      }
      case "focus_next_timeline_item":
        return focusAdjacentTimelineItem(1);
      case "focus_previous_timeline_item":
        return focusAdjacentTimelineItem(-1);
      case "select_focused_timeline_item":
        return selectFocusedTimelineItem();
      case "clear_selection":
        return clearSelection();
    }
  };

  if (focusedCommandId !== null) {
    requireAvailableRuntimeLifecyclePanelCommand(
      viewSnapshot,
      focusedCommandId,
    );
  }
  if (focusedTimelineItemId !== null) {
    if (
      !viewSnapshot.visibleTimelineItems.some(
        (item) => item.id === focusedTimelineItemId,
      )
    ) {
      throw new Error("Runtime lifecycle panel timeline item is not visible");
    }
  }
  reconcileFocus();

  const unsubscribeViewModel = options.viewModel.subscribe((nextSnapshot) => {
    viewSnapshot = nextSnapshot;
    publish();
  });

  return {
    snapshot,
    subscribe: (listener) => {
      if (isDisposed()) {
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
    dispatch,
    focusCommand,
    focusTimelineItem,
    invokeCommand,
    clearSelection,
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      const unsubscribe = options.viewModel.bindPageLifecycle(
        target,
        bindOptions,
      );
      lifecycleUnsubscribes.add(unsubscribe);
      let bound = true;
      return () => {
        if (!bound) {
          return false;
        }
        bound = false;
        lifecycleUnsubscribes.delete(unsubscribe);
        return unsubscribe();
      };
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      unsubscribeViewModel();
      for (const unsubscribe of [...lifecycleUnsubscribes]) {
        unsubscribe();
      }
      lifecycleUnsubscribes.clear();
      listeners.clear();
      focusedCommandId = null;
      focusedTimelineItemId = null;
      return true;
    },
    isDisposed,
  };
}

export function buildRuntimeLifecyclePanelInteractionSnapshot(
  view: RuntimeLifecyclePanelViewModelSnapshot,
  state: RuntimeLifecyclePanelInteractionState,
  disposed = view.disposed,
): RuntimeLifecyclePanelInteractionSnapshot {
  const commands = availableRuntimeLifecyclePanelCommands(view);
  const availableCommandIds = commands.map((command) => command.id);
  const enabledCommandIds = commands
    .filter((command) => command.enabled && !command.busy)
    .map((command) => command.id);
  const focusedCommand =
    state.focusedCommandId === null
      ? undefined
      : commands.find((command) => command.id === state.focusedCommandId);
  const focusedTimelineItem =
    state.focusedTimelineItemId === null
      ? undefined
      : view.visibleTimelineItems.find(
          (item) => item.id === state.focusedTimelineItemId,
        );
  const focusedCommandId = focusedCommand?.id ?? null;
  const focusedTimelineItemId = focusedTimelineItem?.id ?? null;

  return Object.freeze({
    view,
    disposed,
    focusTarget:
      focusedCommandId !== null
        ? "command"
        : focusedTimelineItemId !== null
          ? "timeline_item"
          : null,
    focusedCommandId,
    focusedTimelineItemId,
    availableCommandIds: Object.freeze([...availableCommandIds]),
    enabledCommandIds: Object.freeze([...enabledCommandIds]),
    canActivateFocusedCommand:
      focusedCommand !== undefined &&
      focusedCommand.enabled &&
      !focusedCommand.busy,
    canSelectFocusedTimelineItem: focusedTimelineItem !== undefined,
  });
}

function availableRuntimeLifecyclePanelCommands(
  view: RuntimeLifecyclePanelViewModelSnapshot,
): RuntimeLifecyclePanelCommand[] {
  const commands: RuntimeLifecyclePanelCommand[] = [];
  if (view.panel.primaryCommand !== null) {
    commands.push(view.panel.primaryCommand);
  }
  commands.push(...view.panel.secondaryCommands);
  return commands;
}

function availableRuntimeLifecyclePanelCommandIds(
  view: RuntimeLifecyclePanelViewModelSnapshot,
): RuntimeLifecyclePanelCommandId[] {
  return availableRuntimeLifecyclePanelCommands(view).map(
    (command) => command.id,
  );
}

function findRuntimeLifecyclePanelCommand(
  view: RuntimeLifecyclePanelViewModelSnapshot,
  commandId: RuntimeLifecyclePanelCommandId,
): RuntimeLifecyclePanelCommand | undefined {
  return availableRuntimeLifecyclePanelCommands(view).find(
    (command) => command.id === commandId,
  );
}

function requireAvailableRuntimeLifecyclePanelCommand(
  view: RuntimeLifecyclePanelViewModelSnapshot,
  commandId: RuntimeLifecyclePanelCommandId,
): RuntimeLifecyclePanelCommand {
  const safeCommandId = requireRuntimeLifecyclePanelCommandId(commandId);
  const command = findRuntimeLifecyclePanelCommand(view, safeCommandId);
  if (command === undefined) {
    throw new Error("Runtime lifecycle panel command is not available");
  }
  return command;
}

function requireEnabledRuntimeLifecyclePanelCommand(
  command: RuntimeLifecyclePanelCommand,
): void {
  if (!command.enabled || command.busy) {
    throw new Error("Runtime lifecycle panel command is not enabled");
  }
}

function requireRuntimeLifecyclePanelCommandId(
  commandId: string,
): RuntimeLifecyclePanelCommandId {
  switch (commandId) {
    case "start_runtime":
    case "retry_startup":
    case "inspect_issue":
    case "wait":
    case "none":
    case "refresh_status":
    case "stop_runtime":
      return commandId;
    default:
      throw new Error("Invalid runtime lifecycle panel command id");
  }
}

function requireRuntimeLifecyclePanelInteractionCommand(
  command: string,
): RuntimeLifecyclePanelInteractionCommand {
  switch (command) {
    case "focus_primary_command":
    case "focus_next_command":
    case "focus_previous_command":
    case "activate_focused_command":
    case "refresh_status":
    case "stop_runtime":
    case "start_or_retry_runtime":
    case "focus_next_timeline_item":
    case "focus_previous_timeline_item":
    case "select_focused_timeline_item":
    case "clear_selection":
      return command;
    default:
      throw new Error("Invalid runtime lifecycle panel interaction command");
  }
}

function requireRuntimeLifecyclePanelTimelineItemId(itemId: string): string {
  if (
    itemId.length === 0 ||
    itemId.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/u.test(itemId)
  ) {
    throw new Error("Invalid runtime lifecycle panel timeline item id");
  }
  return itemId;
}
