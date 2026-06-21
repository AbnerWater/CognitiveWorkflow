import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  CreateRuntimeLifecyclePanelSessionFactorySessionOptions,
  RuntimeLifecyclePanelSession,
  RuntimeLifecyclePanelSessionController,
  RuntimeLifecyclePanelSessionControllerSnapshot,
  RuntimeLifecyclePanelSessionErrorHandler,
} from "./runtime-lifecycle-panel-session.js";
import type {
  CreateRuntimeStreamInteractionSessionFactorySessionOptions,
  RuntimeStreamInteractionSession,
  RuntimeStreamInteractionSessionController,
  RuntimeStreamInteractionSessionControllerSnapshot,
  RuntimeStreamKnownEventType,
} from "./runtime-stream-session.js";

export type RuntimeWorkbenchPanelId = "lifecycle" | "stream";

export interface RuntimeWorkbenchSessionSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly lifecyclePanel: RuntimeLifecyclePanelSessionControllerSnapshot;
  readonly runtimeStream: RuntimeStreamInteractionSessionControllerSnapshot;
  readonly disposed: boolean;
}

export type RuntimeWorkbenchSessionStoreChangeListener = () => void;

export type RuntimeWorkbenchSessionErrorHandler =
  RuntimeLifecyclePanelSessionErrorHandler;

export interface RuntimeWorkbenchStreamSession {
  readonly eventTypes: readonly RuntimeStreamKnownEventType[];
  readonly snapshot: RuntimeStreamInteractionSession["snapshot"];
  readonly subscribe: RuntimeStreamInteractionSession["subscribe"];
  readonly start: RuntimeStreamInteractionSession["start"];
  readonly stop: RuntimeStreamInteractionSession["stop"];
  readonly resetFullReloadRequired: RuntimeStreamInteractionSession["resetFullReloadRequired"];
  readonly bindPageLifecycle: RuntimeStreamInteractionSession["bindPageLifecycle"];
  readonly isStarted: RuntimeStreamInteractionSession["isStarted"];
  readonly listenerCount: RuntimeStreamInteractionSession["listenerCount"];
  readonly dispose: () => boolean;
}

export interface RuntimeWorkbenchSession {
  readonly activePanel: () => RuntimeWorkbenchPanelId;
  readonly getSnapshot: () => RuntimeWorkbenchSessionSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchSessionSnapshot;
  readonly snapshot: () => RuntimeWorkbenchSessionSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchSessionStoreChangeListener,
  ) => RuntimeStatusUnsubscribe;
  readonly setActivePanel: (
    panel: RuntimeWorkbenchPanelId,
  ) => RuntimeWorkbenchSessionSnapshot;
  readonly openLifecyclePanelSession: (
    options?: CreateRuntimeLifecyclePanelSessionFactorySessionOptions,
  ) => RuntimeLifecyclePanelSession;
  readonly disposeLifecyclePanelSession: () => boolean;
  readonly openRuntimeStreamSession: (
    options: CreateRuntimeStreamInteractionSessionFactorySessionOptions,
  ) => RuntimeWorkbenchStreamSession;
  readonly disposeRuntimeStreamSession: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeWorkbenchSessionOptions {
  readonly lifecyclePanelController: RuntimeLifecyclePanelSessionController;
  readonly runtimeStreamController: RuntimeStreamInteractionSessionController;
  readonly activePanel?: RuntimeWorkbenchPanelId;
  readonly onError?: RuntimeWorkbenchSessionErrorHandler;
}

export function createRuntimeWorkbenchSession(
  options: CreateRuntimeWorkbenchSessionOptions,
): RuntimeWorkbenchSession {
  let activePanel = requireRuntimeWorkbenchPanelId(
    options.activePanel ?? "lifecycle",
  );
  const listeners = new Set<RuntimeWorkbenchSessionStoreChangeListener>();
  let lifecyclePanelUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let runtimeStreamUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const initialSnapshot = freezeRuntimeWorkbenchSessionSnapshot({
    activePanel,
    lifecyclePanel: options.lifecyclePanelController.getSnapshot(),
    runtimeStream: options.runtimeStreamController.snapshot(),
    disposed,
  });
  let currentSignature =
    runtimeWorkbenchSessionSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break root workbench propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime workbench session is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeWorkbenchSessionSnapshot => {
    const nextSnapshot = freezeRuntimeWorkbenchSessionSnapshot({
      activePanel,
      lifecyclePanel: options.lifecyclePanelController.getSnapshot(),
      runtimeStream: options.runtimeStreamController.snapshot(),
      disposed,
    });
    const nextSignature =
      runtimeWorkbenchSessionSnapshotSignature(nextSnapshot);
    if (forceRefresh || nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = nextSnapshot;
    }
    return currentSnapshot;
  };

  const publishIfChanged = (forceRefresh = false): void => {
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

  const releaseLifecyclePanelSubscription = (): void => {
    lifecyclePanelUnsubscribe?.();
    lifecyclePanelUnsubscribe = undefined;
  };

  const releaseRuntimeStreamSubscription = (): void => {
    runtimeStreamUnsubscribe?.();
    runtimeStreamUnsubscribe = undefined;
  };

  const ensureControllerSubscriptions = (): void => {
    if (listeners.size === 0 || disposed) {
      return;
    }
    if (lifecyclePanelUnsubscribe === undefined) {
      lifecyclePanelUnsubscribe = options.lifecyclePanelController.subscribe(
        () => {
          publishIfChanged();
        },
      );
    }
    if (runtimeStreamUnsubscribe === undefined) {
      runtimeStreamUnsubscribe = options.runtimeStreamController.subscribe(
        () => {
          publishIfChanged();
        },
      );
    }
  };

  const releaseControllerSubscriptions = (): void => {
    releaseLifecyclePanelSubscription();
    releaseRuntimeStreamSubscription();
  };

  const runWithSuppressedControllerPublish = <T>(action: () => T): T => {
    const shouldRestoreSubscriptions = listeners.size > 0 && !disposed;
    if (shouldRestoreSubscriptions) {
      releaseControllerSubscriptions();
    }
    try {
      const result = action();
      if (shouldRestoreSubscriptions) {
        ensureControllerSubscriptions();
      }
      return result;
    } catch (error) {
      if (shouldRestoreSubscriptions) {
        ensureControllerSubscriptions();
      }
      throw error;
    }
  };

  return {
    activePanel: () => activePanel,
    getSnapshot: () => captureSnapshot(),
    getServerSnapshot: () => captureSnapshot(),
    snapshot: () => captureSnapshot(),
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      ensureControllerSubscriptions();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseControllerSubscriptions();
        }
        return deleted;
      };
    },
    setActivePanel: (panel) => {
      assertActive();
      activePanel = requireRuntimeWorkbenchPanelId(panel);
      publishIfChanged();
      return captureSnapshot();
    },
    openLifecyclePanelSession: (sessionOptions) => {
      assertActive();
      const session = runWithSuppressedControllerPublish(() =>
        options.lifecyclePanelController.openSession(sessionOptions),
      );
      activePanel = "lifecycle";
      publishIfChanged(true);
      return session;
    },
    disposeLifecyclePanelSession: () => {
      if (disposed) {
        return false;
      }
      return runWithSuppressedControllerPublish(() => {
        const result = options.lifecyclePanelController.disposeActiveSession();
        if (result) {
          publishIfChanged(true);
        }
        return result;
      });
    },
    openRuntimeStreamSession: (sessionOptions) => {
      assertActive();
      const session = runWithSuppressedControllerPublish(() =>
        options.runtimeStreamController.openSession(sessionOptions),
      );
      activePanel = "stream";
      publishIfChanged(true);
      return createRuntimeWorkbenchStreamSessionFacade(
        session,
        options.runtimeStreamController,
      );
    },
    disposeRuntimeStreamSession: () => {
      if (disposed) {
        return false;
      }
      return runWithSuppressedControllerPublish(() => {
        const result = options.runtimeStreamController.disposeActiveSession();
        if (result) {
          publishIfChanged(true);
        }
        return result;
      });
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseControllerSubscriptions();
      options.lifecyclePanelController.dispose();
      options.runtimeStreamController.dispose();
      publishIfChanged(true);
      listeners.clear();
      return true;
    },
    isDisposed: () => disposed,
  };
}

function createRuntimeWorkbenchStreamSessionFacade(
  session: RuntimeStreamInteractionSession,
  controller: RuntimeStreamInteractionSessionController,
): RuntimeWorkbenchStreamSession {
  const dispose = (): boolean => {
    if (controller.activeSession() !== session) {
      return false;
    }
    return controller.disposeActiveSession();
  };

  const facade: RuntimeWorkbenchStreamSession = {
    eventTypes: Object.freeze([...session.eventTypes]),
    snapshot: () => session.snapshot(),
    subscribe: (listener) => session.subscribe(listener),
    start: () => session.start(),
    stop: () => session.stop(),
    resetFullReloadRequired: () => session.resetFullReloadRequired(),
    bindPageLifecycle: (target, options) =>
      session.bindPageLifecycle(target, options),
    isStarted: () => session.isStarted(),
    listenerCount: () => session.listenerCount(),
    dispose,
  };
  return Object.freeze(facade);
}

function requireRuntimeWorkbenchPanelId(
  panel: string,
): RuntimeWorkbenchPanelId {
  switch (panel) {
    case "lifecycle":
    case "stream":
      return panel;
    default:
      throw new Error("Invalid runtime workbench panel id");
  }
}

function freezeRuntimeWorkbenchSessionSnapshot(
  snapshot: RuntimeWorkbenchSessionSnapshot,
): RuntimeWorkbenchSessionSnapshot {
  return Object.freeze({ ...snapshot });
}

function runtimeWorkbenchSessionSnapshotSignature(
  snapshot: RuntimeWorkbenchSessionSnapshot,
): string {
  return JSON.stringify(snapshot);
}
