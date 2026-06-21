import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  BindRuntimeLifecycleStatusPageLifecycleOptions,
  RuntimeLifecycleStatusPageLifecycleTarget,
} from "./runtime-lifecycle-status-controller.js";
import type {
  CreateRuntimeLifecyclePanelControllerFactoryControllerOptions,
  RuntimeLifecyclePanelController,
  RuntimeLifecyclePanelControllerErrorHandler,
  RuntimeLifecyclePanelControllerFactory,
  RuntimeLifecyclePanelControllerSnapshot,
} from "./runtime-lifecycle-panel-controller.js";
import type {
  RuntimeLifecyclePanelCommand,
  RuntimeLifecyclePanelCommandId,
  RuntimeLifecyclePanelEmptyState,
  RuntimeLifecyclePanelSnapshot,
  RuntimeLifecyclePanelTimelineItem,
} from "./runtime-lifecycle-panel-presenter.js";

export type RuntimeLifecyclePanelHookStoreChangeListener = () => void;

export type RuntimeLifecyclePanelHookAdapterErrorHandler =
  RuntimeLifecyclePanelControllerErrorHandler;

export interface RuntimeLifecyclePanelHookAdapter {
  readonly getSnapshot: () => RuntimeLifecyclePanelControllerSnapshot;
  readonly getServerSnapshot: () => RuntimeLifecyclePanelControllerSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecyclePanelHookStoreChangeListener,
  ) => RuntimeStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly invoke: (
    commandId: RuntimeLifecyclePanelCommandId,
  ) => Promise<RuntimeLifecyclePanelControllerSnapshot>;
  readonly bindPageLifecycle: (
    target: RuntimeLifecycleStatusPageLifecycleTarget,
    options?: BindRuntimeLifecycleStatusPageLifecycleOptions,
  ) => RuntimeStatusUnsubscribe;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface RuntimeLifecyclePanelHookAdapterFactory {
  readonly createAdapter: (
    options?: CreateRuntimeLifecyclePanelHookAdapterFactoryAdapterOptions,
  ) => RuntimeLifecyclePanelHookAdapter;
}

export interface CreateRuntimeLifecyclePanelHookAdapterOptions {
  readonly controller: RuntimeLifecyclePanelController;
  readonly onError?: RuntimeLifecyclePanelHookAdapterErrorHandler;
}

export interface CreateRuntimeLifecyclePanelHookAdapterFactoryOptions {
  readonly controllerFactory: RuntimeLifecyclePanelControllerFactory;
  readonly onError?: RuntimeLifecyclePanelHookAdapterErrorHandler;
}

export interface CreateRuntimeLifecyclePanelHookAdapterFactoryAdapterOptions extends CreateRuntimeLifecyclePanelControllerFactoryControllerOptions {}

export function createRuntimeLifecyclePanelHookAdapter(
  options: CreateRuntimeLifecyclePanelHookAdapterOptions,
): RuntimeLifecyclePanelHookAdapter {
  const listeners = new Set<RuntimeLifecyclePanelHookStoreChangeListener>();
  let controllerUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const initialSnapshot = options.controller.getSnapshot();
  let currentSignature = snapshotSignature(initialSnapshot);
  let currentSnapshot = freezeControllerSnapshot(initialSnapshot);

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle hook notifications.
    }
  };

  const isDisposed = (): boolean => disposed || options.controller.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime lifecycle panel hook adapter is disposed");
    }
  };

  const captureSnapshot = (): RuntimeLifecyclePanelControllerSnapshot => {
    const nextSnapshot = options.controller.getSnapshot();
    const nextSignature = snapshotSignature(nextSnapshot);
    if (nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = freezeControllerSnapshot(nextSnapshot);
    }
    return currentSnapshot;
  };

  const notify = (): void => {
    if (isDisposed()) {
      return;
    }
    captureSnapshot();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensureControllerSubscription = (): void => {
    if (controllerUnsubscribe !== undefined) {
      return;
    }
    controllerUnsubscribe = options.controller.subscribe(() => {
      notify();
    });
  };

  const releaseControllerSubscription = (): void => {
    controllerUnsubscribe?.();
    controllerUnsubscribe = undefined;
  };

  return {
    getSnapshot: captureSnapshot,
    getServerSnapshot: captureSnapshot,
    subscribe: (listener) => {
      if (isDisposed()) {
        return () => false;
      }
      listeners.add(listener);
      ensureControllerSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseControllerSubscription();
        }
        return deleted;
      };
    },
    listenerCount: () => listeners.size,
    invoke: async (commandId) => {
      assertActive();
      await options.controller.invoke(commandId);
      return captureSnapshot();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      return options.controller.bindPageLifecycle(target, bindOptions);
    },
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseControllerSubscription();
      listeners.clear();
      options.controller.dispose();
      captureSnapshot();
      return true;
    },
    isDisposed,
  };
}

export function createRuntimeLifecyclePanelHookAdapterFactory(
  options: CreateRuntimeLifecyclePanelHookAdapterFactoryOptions,
): RuntimeLifecyclePanelHookAdapterFactory {
  return {
    createAdapter: (adapterOptions) => {
      const onError = adapterOptions?.onError ?? options.onError;
      const controller = options.controllerFactory.createController(
        onError !== undefined ? { onError } : undefined,
      );
      return createRuntimeLifecyclePanelHookAdapter({
        controller,
        ...(onError !== undefined ? { onError } : {}),
      });
    },
  };
}

function snapshotSignature(
  snapshot: RuntimeLifecyclePanelControllerSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function freezeControllerSnapshot(
  snapshot: RuntimeLifecyclePanelControllerSnapshot,
): RuntimeLifecyclePanelControllerSnapshot {
  return Object.freeze({
    panel: freezePanelSnapshot(snapshot.panel),
    disposed: snapshot.disposed,
  });
}

function freezePanelSnapshot(
  snapshot: RuntimeLifecyclePanelSnapshot,
): RuntimeLifecyclePanelSnapshot {
  return Object.freeze({
    ...snapshot,
    primaryCommand:
      snapshot.primaryCommand === null
        ? null
        : freezePanelCommand(snapshot.primaryCommand),
    secondaryCommands: Object.freeze(
      snapshot.secondaryCommands.map(freezePanelCommand),
    ),
    timelineItems: Object.freeze(
      snapshot.timelineItems.map(freezePanelTimelineItem),
    ),
    emptyState:
      snapshot.emptyState === null
        ? null
        : freezePanelEmptyState(snapshot.emptyState),
  });
}

function freezePanelCommand(
  command: RuntimeLifecyclePanelCommand,
): RuntimeLifecyclePanelCommand {
  return Object.freeze({ ...command });
}

function freezePanelTimelineItem(
  item: RuntimeLifecyclePanelTimelineItem,
): RuntimeLifecyclePanelTimelineItem {
  return Object.freeze({
    ...item,
    badges: Object.freeze([...item.badges]),
  });
}

function freezePanelEmptyState(
  emptyState: RuntimeLifecyclePanelEmptyState,
): RuntimeLifecyclePanelEmptyState {
  return Object.freeze({ ...emptyState });
}
