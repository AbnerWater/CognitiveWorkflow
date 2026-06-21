import type {
  RuntimeBridge,
  RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import {
  createRuntimeLifecycleShellSession,
  type RuntimeLifecycleShellSession,
} from "./runtime-lifecycle-shell-session.js";
import type {
  BindRuntimeLifecycleStatusPageLifecycleOptions,
  RuntimeLifecycleStatusPageLifecycleTarget,
} from "./runtime-lifecycle-status-controller.js";
import {
  createRuntimeLifecyclePanelPresenter,
  type RuntimeLifecyclePanelCommandId,
  type RuntimeLifecyclePanelPresenter,
  type RuntimeLifecyclePanelPresenterErrorHandler,
  type RuntimeLifecyclePanelSnapshot,
} from "./runtime-lifecycle-panel-presenter.js";

export interface RuntimeLifecyclePanelControllerSnapshot {
  readonly panel: RuntimeLifecyclePanelSnapshot;
  readonly disposed: boolean;
}

export type RuntimeLifecyclePanelControllerListener = (
  snapshot: RuntimeLifecyclePanelControllerSnapshot,
) => void;

export type RuntimeLifecyclePanelControllerErrorHandler =
  RuntimeLifecyclePanelPresenterErrorHandler;

export interface RuntimeLifecyclePanelController {
  readonly getSnapshot: () => RuntimeLifecyclePanelControllerSnapshot;
  readonly snapshot: () => RuntimeLifecyclePanelControllerSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecyclePanelControllerListener,
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

export interface RuntimeLifecyclePanelControllerFactory {
  readonly createController: (
    options?: CreateRuntimeLifecyclePanelControllerFactoryControllerOptions,
  ) => RuntimeLifecyclePanelController;
}

export interface CreateRuntimeLifecyclePanelControllerOptions {
  readonly runtime: Pick<
    RuntimeBridge,
    "startupStatus" | "onStartupStatus" | "shutdownStatus" | "onShutdownStatus"
  >;
  readonly onError?: RuntimeLifecyclePanelControllerErrorHandler;
}

export interface CreateRuntimeLifecyclePanelControllerFactoryOptions extends CreateRuntimeLifecyclePanelControllerOptions {}

export interface CreateRuntimeLifecyclePanelControllerFactoryControllerOptions {
  readonly onError?: RuntimeLifecyclePanelControllerErrorHandler;
}

export function createRuntimeLifecyclePanelController(
  options: CreateRuntimeLifecyclePanelControllerOptions,
): RuntimeLifecyclePanelController {
  const session = createRuntimeLifecycleShellSession({
    runtime: options.runtime,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const presenter = createRuntimeLifecyclePanelPresenter({
    session,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  return createRuntimeLifecyclePanelControllerFromOwnedParts({
    session,
    presenter,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
}

export function createRuntimeLifecyclePanelControllerFactory(
  options: CreateRuntimeLifecyclePanelControllerFactoryOptions,
): RuntimeLifecyclePanelControllerFactory {
  return {
    createController: (controllerOptions) => {
      const onError = controllerOptions?.onError ?? options.onError;
      return createRuntimeLifecyclePanelController({
        runtime: options.runtime,
        ...(onError !== undefined ? { onError } : {}),
      });
    },
  };
}

function createRuntimeLifecyclePanelControllerFromOwnedParts(options: {
  readonly session: RuntimeLifecycleShellSession;
  readonly presenter: RuntimeLifecyclePanelPresenter;
  readonly onError?: RuntimeLifecyclePanelControllerErrorHandler;
}): RuntimeLifecyclePanelController {
  const listeners = new Set<RuntimeLifecyclePanelControllerListener>();
  const lifecycleUnsubscribes = new Set<RuntimeStatusUnsubscribe>();
  let presenterUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle panel controller propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime lifecycle panel controller is disposed");
    }
  };

  const buildSnapshot = (): RuntimeLifecyclePanelControllerSnapshot => ({
    panel: options.presenter.snapshot(),
    disposed,
  });

  let currentSnapshot = buildSnapshot();

  const refreshSnapshot = (): RuntimeLifecyclePanelControllerSnapshot => {
    currentSnapshot = buildSnapshot();
    return currentSnapshot;
  };

  const snapshot = (): RuntimeLifecyclePanelControllerSnapshot =>
    currentSnapshot;

  const publish = (): void => {
    if (disposed) {
      return;
    }
    refreshSnapshot();
    if (listeners.size === 0) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(buildSnapshot());
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensurePresenterSubscription = (): void => {
    if (presenterUnsubscribe !== undefined) {
      return;
    }
    presenterUnsubscribe = options.presenter.subscribe(() => {
      publish();
    });
  };

  const releasePresenterSubscription = (): void => {
    presenterUnsubscribe?.();
    presenterUnsubscribe = undefined;
  };

  return {
    getSnapshot: snapshot,
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      ensurePresenterSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releasePresenterSubscription();
        }
        return deleted;
      };
    },
    listenerCount: () => listeners.size,
    invoke: async (commandId) => {
      assertActive();
      await options.presenter.invoke(commandId);
      return refreshSnapshot();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      const unsubscribeSession = options.session.bindPageLifecycle(
        target,
        bindOptions,
      );
      lifecycleUnsubscribes.add(unsubscribeSession);
      let bound = true;
      return () => {
        if (!bound) {
          return false;
        }
        bound = false;
        lifecycleUnsubscribes.delete(unsubscribeSession);
        return unsubscribeSession();
      };
    },
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releasePresenterSubscription();
      listeners.clear();
      for (const unsubscribe of [...lifecycleUnsubscribes]) {
        unsubscribe();
      }
      lifecycleUnsubscribes.clear();
      options.presenter.dispose();
      options.session.dispose();
      refreshSnapshot();
      return true;
    },
    isDisposed: () => disposed,
  };
}
