import type {
  RuntimeBridge,
  RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import {
  createRuntimeLifecycleStatusController,
  type BindRuntimeLifecycleStatusPageLifecycleOptions,
  type RuntimeLifecycleStatusController,
  type RuntimeLifecycleStatusControllerErrorHandler,
  type RuntimeLifecycleStatusPageLifecycleTarget,
} from "./runtime-lifecycle-status-controller.js";
import {
  createRuntimeLifecycleViewState,
  type RuntimeLifecycleViewState,
  type RuntimeLifecycleViewStateSnapshot,
} from "./runtime-lifecycle-view-state.js";

export interface RuntimeLifecycleShellSessionSnapshot {
  readonly view: RuntimeLifecycleViewStateSnapshot;
  readonly started: boolean;
  readonly disposed: boolean;
}

export type RuntimeLifecycleShellSessionListener = (
  snapshot: RuntimeLifecycleShellSessionSnapshot,
) => void;

export type RuntimeLifecycleShellSessionErrorHandler =
  RuntimeLifecycleStatusControllerErrorHandler;

export interface RuntimeLifecycleShellSession {
  readonly controller: RuntimeLifecycleStatusController;
  readonly viewState: RuntimeLifecycleViewState;
  readonly snapshot: () => RuntimeLifecycleShellSessionSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecycleShellSessionListener,
  ) => RuntimeStatusUnsubscribe;
  readonly start: () => RuntimeLifecycleShellSessionSnapshot;
  readonly stop: () => boolean;
  readonly refresh: () => Promise<RuntimeLifecycleShellSessionSnapshot>;
  readonly bindPageLifecycle: (
    target: RuntimeLifecycleStatusPageLifecycleTarget,
    options?: BindRuntimeLifecycleStatusPageLifecycleOptions,
  ) => RuntimeStatusUnsubscribe;
  readonly isStarted: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeLifecycleShellSessionOptions {
  readonly runtime: Pick<
    RuntimeBridge,
    "startupStatus" | "onStartupStatus" | "shutdownStatus" | "onShutdownStatus"
  >;
  readonly onError?: RuntimeLifecycleShellSessionErrorHandler;
}

export function createRuntimeLifecycleShellSession(
  options: CreateRuntimeLifecycleShellSessionOptions,
): RuntimeLifecycleShellSession {
  const controller = createRuntimeLifecycleStatusController({
    runtime: options.runtime,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const viewState = createRuntimeLifecycleViewState({
    controller,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const sessionListeners = new Set<RuntimeLifecycleShellSessionListener>();
  const lifecycleUnsubscribes = new Set<RuntimeStatusUnsubscribe>();
  let viewStateUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle shell propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime lifecycle shell session is disposed");
    }
  };

  const snapshot = (): RuntimeLifecycleShellSessionSnapshot => ({
    view: viewState.snapshot(),
    started: !disposed && controller.isStarted(),
    disposed,
  });

  const publish = (): void => {
    if (disposed || sessionListeners.size === 0) {
      return;
    }
    for (const listener of [...sessionListeners]) {
      try {
        listener(snapshot());
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensureViewStateSubscription = (): void => {
    if (viewStateUnsubscribe !== undefined) {
      return;
    }
    viewStateUnsubscribe = viewState.subscribe(() => {
      publish();
    });
  };

  const releaseViewStateSubscription = (): void => {
    viewStateUnsubscribe?.();
    viewStateUnsubscribe = undefined;
  };

  return {
    controller,
    viewState,
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      sessionListeners.add(listener);
      ensureViewStateSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = sessionListeners.delete(listener);
        if (sessionListeners.size === 0) {
          releaseViewStateSubscription();
        }
        return deleted;
      };
    },
    start: () => {
      assertActive();
      controller.start();
      return snapshot();
    },
    stop: () => {
      if (disposed) {
        return false;
      }
      return controller.stop();
    },
    refresh: async () => {
      assertActive();
      await controller.refresh();
      return snapshot();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      const unsubscribeController = controller.bindPageLifecycle(
        target,
        bindOptions,
      );
      lifecycleUnsubscribes.add(unsubscribeController);
      let bound = true;
      return () => {
        if (!bound) {
          return false;
        }
        bound = false;
        lifecycleUnsubscribes.delete(unsubscribeController);
        return unsubscribeController();
      };
    },
    isStarted: () => !disposed && controller.isStarted(),
    listenerCount: () => sessionListeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseViewStateSubscription();
      sessionListeners.clear();
      for (const unsubscribe of [...lifecycleUnsubscribes]) {
        unsubscribe();
      }
      lifecycleUnsubscribes.clear();
      viewState.dispose();
      controller.dispose();
      return true;
    },
    isDisposed: () => disposed,
  };
}
