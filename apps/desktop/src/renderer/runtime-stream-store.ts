import {
  openRuntimeStreamReconnectingClient,
  type OpenRuntimeStreamReconnectingClientOptions,
  type RuntimeStreamEvent,
  type RuntimeStreamFullReloadDecision,
  type RuntimeStreamReconnectingClient,
  type RuntimeStreamUnsubscribe,
} from "./runtime-stream-client.js";

export const RUNTIME_STREAM_EVENT_STORE_DEFAULT_MAX_EVENTS = 500;

export type RuntimeStreamEventStoreStatus =
  | "idle"
  | "starting"
  | "running"
  | "full_reload_required"
  | "stopped";

export interface RuntimeStreamEventStoreSnapshot {
  readonly status: RuntimeStreamEventStoreStatus;
  readonly events: readonly RuntimeStreamEvent<unknown>[];
  readonly totalEvents: number;
  readonly fullReloadDecision?: RuntimeStreamFullReloadDecision;
}

export type RuntimeStreamEventStoreListener = (
  snapshot: RuntimeStreamEventStoreSnapshot,
) => void;

export type RuntimeStreamEventStoreErrorHandler = (error: unknown) => void;

export type RuntimeStreamEventStoreClientFactory = (
  options: OpenRuntimeStreamReconnectingClientOptions,
) => Promise<RuntimeStreamReconnectingClient>;

export interface RuntimeStreamEventStore {
  readonly start: () => Promise<RuntimeStreamEventStoreSnapshot>;
  readonly stop: () => boolean;
  readonly snapshot: () => RuntimeStreamEventStoreSnapshot;
  readonly subscribe: (
    listener: RuntimeStreamEventStoreListener,
  ) => RuntimeStreamUnsubscribe;
  readonly listenerCount: () => number;
  readonly isStarted: () => boolean;
}

export interface CreateRuntimeStreamEventStoreOptions {
  readonly clientOptions: OpenRuntimeStreamReconnectingClientOptions;
  readonly eventTypes: readonly string[];
  readonly maxEvents?: number;
  readonly clientFactory?: RuntimeStreamEventStoreClientFactory;
  readonly onError?: RuntimeStreamEventStoreErrorHandler;
}

export type RuntimeStreamEventStorePageLifecycleEvent =
  | "beforeunload"
  | "pagehide";

export type RuntimeStreamEventStorePageLifecycleListener = () => void;

export interface RuntimeStreamEventStorePageLifecycleTarget {
  readonly addEventListener: (
    type: RuntimeStreamEventStorePageLifecycleEvent,
    listener: RuntimeStreamEventStorePageLifecycleListener,
  ) => void;
  readonly removeEventListener: (
    type: RuntimeStreamEventStorePageLifecycleEvent,
    listener: RuntimeStreamEventStorePageLifecycleListener,
  ) => void;
}

export interface BindRuntimeStreamEventStorePageLifecycleOptions {
  readonly eventType?: RuntimeStreamEventStorePageLifecycleEvent;
}

export function createRuntimeStreamEventStore(
  options: CreateRuntimeStreamEventStoreOptions,
): RuntimeStreamEventStore {
  const eventTypes = normalizeRuntimeStreamStoreEventTypes(options.eventTypes);
  const maxEvents = normalizeRuntimeStreamStoreMaxEvents(
    options.maxEvents ?? RUNTIME_STREAM_EVENT_STORE_DEFAULT_MAX_EVENTS,
  );
  const clientFactory =
    options.clientFactory ?? openRuntimeStreamReconnectingClient;
  const listeners = new Set<RuntimeStreamEventStoreListener>();
  let status: RuntimeStreamEventStoreStatus = "idle";
  let events: RuntimeStreamEvent<unknown>[] = [];
  let totalEvents = 0;
  let fullReloadDecision: RuntimeStreamFullReloadDecision | undefined;
  let activeClient: RuntimeStreamReconnectingClient | null = null;
  let activeUnsubscribes: RuntimeStreamUnsubscribe[] = [];
  let startGeneration = 0;
  let startPromise: Promise<RuntimeStreamEventStoreSnapshot> | null = null;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break stream store propagation.
    }
  };

  const snapshot = (): RuntimeStreamEventStoreSnapshot => {
    const input: {
      status: RuntimeStreamEventStoreStatus;
      events: RuntimeStreamEvent<unknown>[];
      totalEvents: number;
      fullReloadDecision?: RuntimeStreamFullReloadDecision;
    } = {
      status,
      events,
      totalEvents,
    };
    if (fullReloadDecision !== undefined) {
      input.fullReloadDecision = fullReloadDecision;
    }
    return buildRuntimeStreamEventStoreSnapshot(input);
  };

  const publish = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener(snapshot());
      } catch (error) {
        reportError(error);
      }
    }
  };

  const clearClientSubscriptions = (): void => {
    for (const unsubscribe of activeUnsubscribes.splice(0)) {
      unsubscribe();
    }
  };

  const handleFullReloadRequired = (
    decision: RuntimeStreamFullReloadDecision,
  ): void => {
    startGeneration += 1;
    fullReloadDecision = cloneRuntimeStreamFullReloadDecision(decision);
    clearClientSubscriptions();
    activeClient?.close();
    activeClient = null;
    status = "full_reload_required";
    publish();
    try {
      options.clientOptions.onFullReloadRequired?.(
        cloneRuntimeStreamFullReloadDecision(decision),
      );
    } catch (error) {
      reportError(error);
    }
  };

  const recordEvent = (event: RuntimeStreamEvent<unknown>): void => {
    totalEvents += 1;
    events = [...events, cloneRuntimeStreamEvent(event)].slice(-maxEvents);
    publish();
  };

  return {
    start: async () => {
      if (status === "full_reload_required" || activeClient !== null) {
        return snapshot();
      }
      if (startPromise !== null) {
        return startPromise;
      }

      const generation = startGeneration + 1;
      startGeneration = generation;
      status = "starting";
      fullReloadDecision = undefined;
      publish();

      startPromise = clientFactory({
        ...options.clientOptions,
        onFullReloadRequired: handleFullReloadRequired,
      })
        .then((client) => {
          if (generation !== startGeneration || status === "stopped") {
            client.close();
            return snapshot();
          }

          activeClient = client;
          activeUnsubscribes = eventTypes.map((eventType) =>
            client.subscribe(eventType, recordEvent),
          );
          status = "running";
          publish();
          return snapshot();
        })
        .catch((error: unknown) => {
          status = "stopped";
          reportError(error);
          publish();
          throw error;
        })
        .finally(() => {
          startPromise = null;
        });

      return startPromise;
    },
    stop: () => {
      const shouldStop =
        status === "starting" ||
        status === "running" ||
        activeClient !== null ||
        startPromise !== null;
      if (!shouldStop) {
        return false;
      }

      startGeneration += 1;
      clearClientSubscriptions();
      activeClient?.close();
      activeClient = null;
      status = "stopped";
      publish();
      return true;
    },
    snapshot,
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
    isStarted: () => activeClient !== null,
  };
}

export function bindRuntimeStreamEventStoreToPageLifecycle(
  store: Pick<RuntimeStreamEventStore, "stop">,
  target: RuntimeStreamEventStorePageLifecycleTarget,
  options: BindRuntimeStreamEventStorePageLifecycleOptions = {},
): RuntimeStreamUnsubscribe {
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

function normalizeRuntimeStreamStoreEventTypes(
  eventTypes: readonly string[],
): string[] {
  if (eventTypes.length === 0) {
    throw new Error(
      "Runtime stream event store requires at least one event type",
    );
  }
  const uniqueEventTypes: string[] = [];
  for (const eventType of eventTypes) {
    assertRuntimeStreamStoreEventType(eventType);
    if (!uniqueEventTypes.includes(eventType)) {
      uniqueEventTypes.push(eventType);
    }
  }
  return uniqueEventTypes;
}

function assertRuntimeStreamStoreEventType(eventType: string): void {
  if (!/^[a-z]+(?:\.[a-z0-9_]+)+$/u.test(eventType)) {
    throw new Error(
      `Runtime stream event store event type is invalid: ${eventType}`,
    );
  }
}

function normalizeRuntimeStreamStoreMaxEvents(maxEvents: number): number {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) {
    throw new Error(
      "Runtime stream event store maxEvents must be a positive integer",
    );
  }
  return maxEvents;
}

function buildRuntimeStreamEventStoreSnapshot(input: {
  readonly status: RuntimeStreamEventStoreStatus;
  readonly events: readonly RuntimeStreamEvent<unknown>[];
  readonly totalEvents: number;
  readonly fullReloadDecision?: RuntimeStreamFullReloadDecision;
}): RuntimeStreamEventStoreSnapshot {
  return {
    status: input.status,
    events: input.events.map(cloneRuntimeStreamEvent),
    totalEvents: input.totalEvents,
    ...(input.fullReloadDecision !== undefined
      ? {
          fullReloadDecision: cloneRuntimeStreamFullReloadDecision(
            input.fullReloadDecision,
          ),
        }
      : {}),
  };
}

function cloneRuntimeStreamEvent(
  event: RuntimeStreamEvent<unknown>,
): RuntimeStreamEvent<unknown> {
  return {
    id: event.id,
    type: event.type,
    data: structuredClone(event.data),
    rawData: event.rawData,
  };
}

function cloneRuntimeStreamFullReloadDecision(
  decision: RuntimeStreamFullReloadDecision,
): RuntimeStreamFullReloadDecision {
  return {
    action: "full_reload",
    lastEventId: decision.lastEventId,
    reason: decision.reason,
    ...(decision.status !== undefined ? { status: decision.status } : {}),
    ...(decision.errorCode !== undefined
      ? { errorCode: decision.errorCode }
      : {}),
  };
}
