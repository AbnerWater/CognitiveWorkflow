import type {
  RuntimeBridge,
  RuntimeShutdownStatus,
  RuntimeShutdownStatusListener,
  RuntimeShutdownStatusUnsubscribe,
} from "../preload/contract.js";

export type RuntimeShutdownStatusStoreListener = RuntimeShutdownStatusListener;

export type RuntimeShutdownStatusStoreErrorHandler = (error: unknown) => void;

export type RuntimeShutdownStatusPageLifecycleEvent =
  | "beforeunload"
  | "pagehide";

export type RuntimeShutdownStatusPageLifecycleListener = () => void;

export interface RuntimeShutdownStatusPageLifecycleTarget {
  readonly addEventListener: (
    type: RuntimeShutdownStatusPageLifecycleEvent,
    listener: RuntimeShutdownStatusPageLifecycleListener,
  ) => void;
  readonly removeEventListener: (
    type: RuntimeShutdownStatusPageLifecycleEvent,
    listener: RuntimeShutdownStatusPageLifecycleListener,
  ) => void;
}

export interface BindRuntimeShutdownStatusPageLifecycleOptions {
  readonly eventType?: RuntimeShutdownStatusPageLifecycleEvent;
}

export interface RuntimeShutdownStatusStore {
  readonly start: () => boolean;
  readonly stop: () => boolean;
  readonly refresh: () => Promise<readonly RuntimeShutdownStatus[]>;
  readonly snapshot: () => readonly RuntimeShutdownStatus[];
  readonly subscribe: (
    listener: RuntimeShutdownStatusStoreListener,
  ) => RuntimeShutdownStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly isStarted: () => boolean;
}

export interface CreateRuntimeShutdownStatusStoreOptions {
  readonly runtime: Pick<RuntimeBridge, "shutdownStatus" | "onShutdownStatus">;
  readonly onError?: RuntimeShutdownStatusStoreErrorHandler;
}

export function createRuntimeShutdownStatusStore(
  options: CreateRuntimeShutdownStatusStoreOptions,
): RuntimeShutdownStatusStore {
  let statuses: RuntimeShutdownStatus[] = [];
  let liveUnsubscribe: RuntimeShutdownStatusUnsubscribe | undefined;
  let liveGeneration = 0;
  const listeners = new Set<RuntimeShutdownStatusStoreListener>();

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Error observers must not break renderer status propagation.
    }
  };

  const publish = (nextStatuses: readonly RuntimeShutdownStatus[]): void => {
    statuses = cloneRuntimeShutdownStatuses(nextStatuses);
    for (const listener of listeners) {
      try {
        listener(cloneRuntimeShutdownStatuses(statuses));
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
      liveUnsubscribe = options.runtime.onShutdownStatus((liveStatuses) => {
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
        const refreshedStatuses = await options.runtime.shutdownStatus();
        if (refreshGeneration === liveGeneration) {
          publish(refreshedStatuses);
        }
        return cloneRuntimeShutdownStatuses(statuses);
      } catch (error) {
        reportError(error);
        throw error;
      }
    },
    snapshot: () => cloneRuntimeShutdownStatuses(statuses),
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

export function bindRuntimeShutdownStatusStoreToPageLifecycle(
  store: Pick<RuntimeShutdownStatusStore, "stop">,
  target: RuntimeShutdownStatusPageLifecycleTarget,
  options: BindRuntimeShutdownStatusPageLifecycleOptions = {},
): RuntimeShutdownStatusUnsubscribe {
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

function cloneRuntimeShutdownStatuses(
  statuses: readonly RuntimeShutdownStatus[],
): RuntimeShutdownStatus[] {
  return statuses.map((status) => ({ ...status }));
}
