import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  BindRuntimeLifecycleStatusPageLifecycleOptions,
  RuntimeLifecycleStatusPageLifecycleTarget,
} from "./runtime-lifecycle-status-controller.js";
import {
  createRuntimeLifecyclePanelHookAdapter,
  type RuntimeLifecyclePanelHookAdapter,
} from "./runtime-lifecycle-panel-hook-adapter.js";
import type {
  RuntimeLifecyclePanelControllerFactory,
  RuntimeLifecyclePanelControllerErrorHandler,
} from "./runtime-lifecycle-panel-controller.js";
import type { RuntimeLifecyclePanelCommandId } from "./runtime-lifecycle-panel-presenter.js";
import {
  createRuntimeLifecyclePanelInteraction,
  type RuntimeLifecyclePanelInteractionCommand,
  type RuntimeLifecyclePanelInteractionSnapshot,
} from "./runtime-lifecycle-panel-interaction.js";
import {
  createRuntimeLifecyclePanelViewModel,
  type RuntimeLifecyclePanelTimelineFilter,
} from "./runtime-lifecycle-panel-view-model.js";

export interface RuntimeLifecyclePanelSessionSnapshot {
  readonly interaction: RuntimeLifecyclePanelInteractionSnapshot;
  readonly disposed: boolean;
}

export type RuntimeLifecyclePanelSessionStoreChangeListener = () => void;

export type RuntimeLifecyclePanelSessionErrorHandler =
  RuntimeLifecyclePanelControllerErrorHandler;

export interface RuntimeLifecyclePanelSession {
  readonly getSnapshot: () => RuntimeLifecyclePanelSessionSnapshot;
  readonly getServerSnapshot: () => RuntimeLifecyclePanelSessionSnapshot;
  readonly snapshot: () => RuntimeLifecyclePanelSessionSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecyclePanelSessionStoreChangeListener,
  ) => RuntimeStatusUnsubscribe;
  readonly dispatch: (
    command: RuntimeLifecyclePanelInteractionCommand,
  ) => Promise<RuntimeLifecyclePanelSessionSnapshot>;
  readonly setTimelineFilter: (
    filter: RuntimeLifecyclePanelTimelineFilter,
  ) => RuntimeLifecyclePanelSessionSnapshot;
  readonly focusCommand: (
    commandId: RuntimeLifecyclePanelCommandId,
  ) => RuntimeLifecyclePanelSessionSnapshot;
  readonly focusTimelineItem: (
    itemId: string,
  ) => RuntimeLifecyclePanelSessionSnapshot;
  readonly invokeCommand: (
    commandId: RuntimeLifecyclePanelCommandId,
  ) => Promise<RuntimeLifecyclePanelSessionSnapshot>;
  readonly clearSelection: () => RuntimeLifecyclePanelSessionSnapshot;
  readonly bindPageLifecycle: (
    target: RuntimeLifecycleStatusPageLifecycleTarget,
    options?: BindRuntimeLifecycleStatusPageLifecycleOptions,
  ) => RuntimeStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface RuntimeLifecyclePanelSessionFactory {
  readonly createSession: (
    options?: CreateRuntimeLifecyclePanelSessionFactorySessionOptions,
  ) => RuntimeLifecyclePanelSession;
}

export interface RuntimeLifecyclePanelSessionController {
  readonly activeSession: () => RuntimeLifecyclePanelSession | null;
  readonly getSnapshot: () => RuntimeLifecyclePanelSessionControllerSnapshot;
  readonly getServerSnapshot: () => RuntimeLifecyclePanelSessionControllerSnapshot;
  readonly snapshot: () => RuntimeLifecyclePanelSessionControllerSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecyclePanelSessionStoreChangeListener,
  ) => RuntimeStatusUnsubscribe;
  readonly openSession: (
    options?: CreateRuntimeLifecyclePanelSessionFactorySessionOptions,
  ) => RuntimeLifecyclePanelSession;
  readonly disposeActiveSession: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface RuntimeLifecyclePanelSessionControllerSnapshot {
  readonly activeSession: RuntimeLifecyclePanelSessionSnapshot | null;
  readonly disposed: boolean;
}

export interface CreateRuntimeLifecyclePanelSessionOptions {
  readonly adapter: RuntimeLifecyclePanelHookAdapter;
  readonly timelineFilter?: RuntimeLifecyclePanelTimelineFilter;
  readonly selectedTimelineItemId?: string;
  readonly focusedCommandId?: RuntimeLifecyclePanelCommandId | null;
  readonly focusedTimelineItemId?: string | null;
  readonly onError?: RuntimeLifecyclePanelSessionErrorHandler;
}

export interface CreateRuntimeLifecyclePanelSessionFactoryOptions {
  readonly controllerFactory: RuntimeLifecyclePanelControllerFactory;
  readonly onError?: RuntimeLifecyclePanelSessionErrorHandler;
}

export interface CreateRuntimeLifecyclePanelSessionControllerOptions {
  readonly factory: RuntimeLifecyclePanelSessionFactory;
  readonly onError?: RuntimeLifecyclePanelSessionErrorHandler;
}

export interface CreateRuntimeLifecyclePanelSessionFactorySessionOptions extends Omit<
  CreateRuntimeLifecyclePanelSessionOptions,
  "adapter"
> {}

export function createRuntimeLifecyclePanelSession(
  options: CreateRuntimeLifecyclePanelSessionOptions,
): RuntimeLifecyclePanelSession {
  const viewModel = createRuntimeLifecyclePanelViewModel({
    adapter: options.adapter,
    ...(options.timelineFilter !== undefined
      ? { timelineFilter: options.timelineFilter }
      : {}),
    ...(options.selectedTimelineItemId !== undefined
      ? { selectedTimelineItemId: options.selectedTimelineItemId }
      : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const interaction = createRuntimeLifecyclePanelInteraction({
    viewModel,
    ...(options.focusedCommandId !== undefined
      ? { focusedCommandId: options.focusedCommandId }
      : {}),
    ...(options.focusedTimelineItemId !== undefined
      ? { focusedTimelineItemId: options.focusedTimelineItemId }
      : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const listeners = new Set<RuntimeLifecyclePanelSessionStoreChangeListener>();
  const lifecycleUnsubscribes = new Set<RuntimeStatusUnsubscribe>();
  let interactionUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const initialSnapshot = freezeRuntimeLifecyclePanelSessionSnapshot({
    interaction: interaction.snapshot(),
    disposed,
  });
  let currentSignature = sessionSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle panel session propagation.
    }
  };

  const isDisposed = (): boolean =>
    disposed || interaction.isDisposed() || viewModel.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime lifecycle panel session is disposed");
    }
  };

  const captureSnapshot = (): RuntimeLifecyclePanelSessionSnapshot => {
    const nextSnapshot = freezeRuntimeLifecyclePanelSessionSnapshot({
      interaction: interaction.snapshot(),
      disposed: isDisposed(),
    });
    const nextSignature = sessionSnapshotSignature(nextSnapshot);
    if (nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = nextSnapshot;
    }
    return currentSnapshot;
  };

  const publishIfChanged = (): void => {
    if (disposed) {
      return;
    }
    const previousSignature = currentSignature;
    captureSnapshot();
    if (currentSignature === previousSignature) {
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

  const ensureInteractionSubscription = (): void => {
    if (interactionUnsubscribe !== undefined) {
      return;
    }
    interactionUnsubscribe = interaction.subscribe(() => {
      publishIfChanged();
    });
  };

  const releaseInteractionSubscription = (): void => {
    interactionUnsubscribe?.();
    interactionUnsubscribe = undefined;
  };

  const completeAction = (): RuntimeLifecyclePanelSessionSnapshot => {
    publishIfChanged();
    return captureSnapshot();
  };

  return {
    getSnapshot: captureSnapshot,
    getServerSnapshot: captureSnapshot,
    snapshot: captureSnapshot,
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
    dispatch: async (command) => {
      assertActive();
      await interaction.dispatch(command);
      return completeAction();
    },
    setTimelineFilter: (filter) => {
      assertActive();
      viewModel.setTimelineFilter(filter);
      return completeAction();
    },
    focusCommand: (commandId) => {
      assertActive();
      interaction.focusCommand(commandId);
      return completeAction();
    },
    focusTimelineItem: (itemId) => {
      assertActive();
      interaction.focusTimelineItem(itemId);
      return completeAction();
    },
    invokeCommand: async (commandId) => {
      assertActive();
      await interaction.invokeCommand(commandId);
      return completeAction();
    },
    clearSelection: () => {
      assertActive();
      interaction.clearSelection();
      return completeAction();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      const unsubscribe = interaction.bindPageLifecycle(target, bindOptions);
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
      releaseInteractionSubscription();
      for (const unsubscribe of [...lifecycleUnsubscribes]) {
        unsubscribe();
      }
      lifecycleUnsubscribes.clear();
      listeners.clear();
      interaction.dispose();
      viewModel.dispose();
      captureSnapshot();
      return true;
    },
    isDisposed,
  };
}

export function createRuntimeLifecyclePanelSessionFactory(
  options: CreateRuntimeLifecyclePanelSessionFactoryOptions,
): RuntimeLifecyclePanelSessionFactory {
  return {
    createSession: (sessionOptions) => {
      const onError = sessionOptions?.onError ?? options.onError;
      const controller = options.controllerFactory.createController(
        onError !== undefined ? { onError } : undefined,
      );
      const adapter = createRuntimeLifecyclePanelHookAdapter({
        controller,
        ...(onError !== undefined ? { onError } : {}),
      });
      return createRuntimeLifecyclePanelSession({
        adapter,
        ...(sessionOptions?.timelineFilter !== undefined
          ? { timelineFilter: sessionOptions.timelineFilter }
          : {}),
        ...(sessionOptions?.selectedTimelineItemId !== undefined
          ? { selectedTimelineItemId: sessionOptions.selectedTimelineItemId }
          : {}),
        ...(sessionOptions?.focusedCommandId !== undefined
          ? { focusedCommandId: sessionOptions.focusedCommandId }
          : {}),
        ...(sessionOptions?.focusedTimelineItemId !== undefined
          ? { focusedTimelineItemId: sessionOptions.focusedTimelineItemId }
          : {}),
        ...(onError !== undefined ? { onError } : {}),
      });
    },
  };
}

export function createRuntimeLifecyclePanelSessionController(
  options: CreateRuntimeLifecyclePanelSessionControllerOptions,
): RuntimeLifecyclePanelSessionController {
  let activeSession: RuntimeLifecyclePanelSession | null = null;
  let activeSessionUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  const listeners = new Set<RuntimeLifecyclePanelSessionStoreChangeListener>();
  let disposed = false;

  const initialSnapshot = freezeRuntimeLifecyclePanelSessionControllerSnapshot({
    activeSession: null,
    disposed,
  });
  let currentSignature = sessionControllerSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle panel controller updates.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime lifecycle panel session controller is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeLifecyclePanelSessionControllerSnapshot => {
    const nextSnapshot = freezeRuntimeLifecyclePanelSessionControllerSnapshot({
      activeSession: activeSession?.getSnapshot() ?? null,
      disposed,
    });
    const nextSignature = sessionControllerSnapshotSignature(nextSnapshot);
    if (forceRefresh || nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = nextSnapshot;
    }
    return currentSnapshot;
  };

  const publish = (forceRefresh = false): void => {
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

  const releaseActiveSessionSubscription = (): void => {
    activeSessionUnsubscribe?.();
    activeSessionUnsubscribe = undefined;
  };

  const ensureActiveSessionSubscription = (): void => {
    if (
      activeSessionUnsubscribe !== undefined ||
      activeSession === null ||
      listeners.size === 0
    ) {
      return;
    }
    activeSessionUnsubscribe = activeSession.subscribe(() => {
      publish();
    });
  };

  const clearActiveSession = (): boolean => {
    const session = activeSession;
    releaseActiveSessionSubscription();
    activeSession = null;
    const disposedSession = session?.dispose() ?? false;
    if (session !== null) {
      publish(true);
    }
    return disposedSession;
  };

  return {
    activeSession: () => activeSession,
    getSnapshot: () => captureSnapshot(),
    getServerSnapshot: () => captureSnapshot(),
    snapshot: () => captureSnapshot(),
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      ensureActiveSessionSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseActiveSessionSubscription();
        }
        return deleted;
      };
    },
    openSession: (sessionOptions) => {
      assertActive();
      const nextSession = options.factory.createSession(sessionOptions);
      const previousSession = activeSession;
      releaseActiveSessionSubscription();
      activeSession = nextSession;
      ensureActiveSessionSubscription();
      previousSession?.dispose();
      publish(true);
      return nextSession;
    },
    disposeActiveSession: () => clearActiveSession(),
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      const hadActiveSession = activeSession !== null;
      clearActiveSession();
      if (!hadActiveSession) {
        publish(true);
      }
      releaseActiveSessionSubscription();
      listeners.clear();
      return true;
    },
    isDisposed: () => disposed,
  };
}

function freezeRuntimeLifecyclePanelSessionSnapshot(
  snapshot: RuntimeLifecyclePanelSessionSnapshot,
): RuntimeLifecyclePanelSessionSnapshot {
  return Object.freeze({ ...snapshot });
}

function sessionSnapshotSignature(
  snapshot: RuntimeLifecyclePanelSessionSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function freezeRuntimeLifecyclePanelSessionControllerSnapshot(
  snapshot: RuntimeLifecyclePanelSessionControllerSnapshot,
): RuntimeLifecyclePanelSessionControllerSnapshot {
  return Object.freeze({ ...snapshot });
}

function sessionControllerSnapshotSignature(
  snapshot: RuntimeLifecyclePanelSessionControllerSnapshot,
): string {
  return JSON.stringify(snapshot);
}
