import type {
  RuntimeBridge,
  RuntimeStartupStatus,
  RuntimeStartupStatusUnsubscribe,
} from "../preload/contract.js";
import {
  bindRuntimeStartupStatusStoreToPageLifecycle,
  createRuntimeStartupStatusStore,
  type BindRuntimeStartupStatusPageLifecycleOptions,
  type RuntimeStartupStatusPageLifecycleTarget,
  type RuntimeStartupStatusStore,
} from "./startup-status-client.js";
import {
  createRuntimeStartupStatusViewModel,
  type RuntimeStartupStatusViewModel,
  type RuntimeStartupStatusViewModelSnapshot,
} from "./startup-status-view-model.js";

export interface RuntimeStartupStatusSessionSnapshot {
  readonly statuses: readonly RuntimeStartupStatus[];
  readonly view: RuntimeStartupStatusViewModelSnapshot;
  readonly started: boolean;
  readonly disposed: boolean;
}

export type RuntimeStartupStatusSessionListener = (
  snapshot: RuntimeStartupStatusSessionSnapshot,
) => void;

export type RuntimeStartupStatusSessionErrorHandler = (error: unknown) => void;

export interface RuntimeStartupStatusSession {
  readonly store: RuntimeStartupStatusStore;
  readonly viewModel: RuntimeStartupStatusViewModel;
  readonly snapshot: () => RuntimeStartupStatusSessionSnapshot;
  readonly subscribe: (
    listener: RuntimeStartupStatusSessionListener,
  ) => RuntimeStartupStatusUnsubscribe;
  readonly start: () => RuntimeStartupStatusSessionSnapshot;
  readonly stop: () => boolean;
  readonly refresh: () => Promise<RuntimeStartupStatusSessionSnapshot>;
  readonly bindPageLifecycle: (
    target: RuntimeStartupStatusPageLifecycleTarget,
    options?: BindRuntimeStartupStatusPageLifecycleOptions,
  ) => RuntimeStartupStatusUnsubscribe;
  readonly isStarted: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeStartupStatusSessionOptions {
  readonly runtime: Pick<RuntimeBridge, "startupStatus" | "onStartupStatus">;
  readonly onError?: RuntimeStartupStatusSessionErrorHandler;
}

export function createRuntimeStartupStatusSession(
  options: CreateRuntimeStartupStatusSessionOptions,
): RuntimeStartupStatusSession {
  const store = createRuntimeStartupStatusStore({
    runtime: options.runtime,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const viewModel = createRuntimeStartupStatusViewModel({
    store,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const sessionListeners = new Set<RuntimeStartupStatusSessionListener>();
  const lifecycleUnsubscribes = new Set<RuntimeStartupStatusUnsubscribe>();
  let upstreamViewUnsubscribe: RuntimeStartupStatusUnsubscribe | undefined;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break startup session propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime startup status session is disposed");
    }
  };

  const snapshot = (): RuntimeStartupStatusSessionSnapshot => ({
    statuses: store.snapshot(),
    view: viewModel.snapshot(),
    started: !disposed && store.isStarted(),
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

  const ensureUpstreamViewSubscription = (): void => {
    if (upstreamViewUnsubscribe !== undefined) {
      return;
    }
    upstreamViewUnsubscribe = viewModel.subscribe(() => {
      publish();
    });
  };

  const releaseUpstreamViewSubscription = (): void => {
    upstreamViewUnsubscribe?.();
    upstreamViewUnsubscribe = undefined;
  };

  return {
    store,
    viewModel,
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      sessionListeners.add(listener);
      ensureUpstreamViewSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = sessionListeners.delete(listener);
        if (sessionListeners.size === 0) {
          releaseUpstreamViewSubscription();
        }
        return deleted;
      };
    },
    start: () => {
      assertActive();
      const started = store.start();
      if (started) {
        publish();
      }
      return snapshot();
    },
    stop: () => {
      if (disposed) {
        return false;
      }
      const stopped = store.stop();
      if (stopped) {
        publish();
      }
      return stopped;
    },
    refresh: async () => {
      assertActive();
      await store.refresh();
      return snapshot();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      const unsubscribe = bindRuntimeStartupStatusStoreToPageLifecycle(
        {
          stop: () => {
            const stopped = store.stop();
            if (stopped) {
              publish();
            }
            return stopped;
          },
        },
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
    isStarted: () => !disposed && store.isStarted(),
    listenerCount: () => sessionListeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseUpstreamViewSubscription();
      sessionListeners.clear();
      for (const unsubscribe of [...lifecycleUnsubscribes]) {
        unsubscribe();
      }
      lifecycleUnsubscribes.clear();
      store.stop();
      viewModel.dispose();
      return true;
    },
    isDisposed: () => disposed,
  };
}
