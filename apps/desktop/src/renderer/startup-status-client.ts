import type {
  RuntimeBridge,
  RuntimeStartupStatus,
  RuntimeStartupStatusListener,
  RuntimeStartupStatusUnsubscribe,
} from "../preload/contract.js";

export type RuntimeStartupStatusStoreListener = RuntimeStartupStatusListener;

export type RuntimeStartupStatusStoreErrorHandler = (error: unknown) => void;

export type RuntimeStartupStatusPageLifecycleEvent =
  | "beforeunload"
  | "pagehide";

export type RuntimeStartupStatusPageLifecycleListener = () => void;

export interface RuntimeStartupStatusPageLifecycleTarget {
  readonly addEventListener: (
    type: RuntimeStartupStatusPageLifecycleEvent,
    listener: RuntimeStartupStatusPageLifecycleListener,
  ) => void;
  readonly removeEventListener: (
    type: RuntimeStartupStatusPageLifecycleEvent,
    listener: RuntimeStartupStatusPageLifecycleListener,
  ) => void;
}

export interface BindRuntimeStartupStatusPageLifecycleOptions {
  readonly eventType?: RuntimeStartupStatusPageLifecycleEvent;
}

export interface RuntimeStartupStatusStore {
  readonly start: () => boolean;
  readonly stop: () => boolean;
  readonly refresh: () => Promise<readonly RuntimeStartupStatus[]>;
  readonly snapshot: () => readonly RuntimeStartupStatus[];
  readonly subscribe: (
    listener: RuntimeStartupStatusStoreListener,
  ) => RuntimeStartupStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly isStarted: () => boolean;
}

export interface CreateRuntimeStartupStatusStoreOptions {
  readonly runtime: Pick<RuntimeBridge, "startupStatus" | "onStartupStatus">;
  readonly onError?: RuntimeStartupStatusStoreErrorHandler;
}

export function createRuntimeStartupStatusStore(
  options: CreateRuntimeStartupStatusStoreOptions,
): RuntimeStartupStatusStore {
  let statuses: RuntimeStartupStatus[] = [];
  let liveUnsubscribe: RuntimeStartupStatusUnsubscribe | undefined;
  let liveGeneration = 0;
  const listeners = new Set<RuntimeStartupStatusStoreListener>();

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Error observers must not break renderer status propagation.
    }
  };

  const publish = (nextStatuses: readonly RuntimeStartupStatus[]): void => {
    statuses = cloneRuntimeStartupStatuses(nextStatuses);
    for (const listener of listeners) {
      try {
        listener(cloneRuntimeStartupStatuses(statuses));
      } catch (error) {
        reportError(error);
      }
    }
  };

  return {
    start: () => {
      if (liveUnsubscribe !== undefined) {
        return false;
      }
      liveUnsubscribe = options.runtime.onStartupStatus((liveStatuses) => {
        liveGeneration += 1;
        publish([...statuses, ...liveStatuses]);
      });
      return true;
    },
    stop: () => {
      if (liveUnsubscribe === undefined) {
        return false;
      }
      const unsubscribe = liveUnsubscribe;
      liveUnsubscribe = undefined;
      return unsubscribe();
    },
    refresh: async () => {
      const refreshGeneration = liveGeneration;
      try {
        const refreshedStatuses = await options.runtime.startupStatus();
        if (refreshGeneration === liveGeneration) {
          publish(refreshedStatuses);
        }
        return cloneRuntimeStartupStatuses(statuses);
      } catch (error) {
        reportError(error);
        throw error;
      }
    },
    snapshot: () => cloneRuntimeStartupStatuses(statuses),
    subscribe: (listener) => {
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
    listenerCount: () => listeners.size,
    isStarted: () => liveUnsubscribe !== undefined,
  };
}

export function bindRuntimeStartupStatusStoreToPageLifecycle(
  store: Pick<RuntimeStartupStatusStore, "stop">,
  target: RuntimeStartupStatusPageLifecycleTarget,
  options: BindRuntimeStartupStatusPageLifecycleOptions = {},
): RuntimeStartupStatusUnsubscribe {
  const eventType = options.eventType ?? "beforeunload";
  let stopped = false;
  const stopStore = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    store.stop();
  };
  target.addEventListener(eventType, stopStore);
  let bound = true;
  return () => {
    if (!bound) {
      return false;
    }
    bound = false;
    target.removeEventListener(eventType, stopStore);
    stopStore();
    return true;
  };
}

function cloneRuntimeStartupStatuses(
  statuses: readonly RuntimeStartupStatus[],
): RuntimeStartupStatus[] {
  return statuses.map((status) => ({ ...status }));
}
