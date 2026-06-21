import {
  type OpenRuntimeStreamReconnectingClientOptions,
  type RuntimeStreamChannel,
  type RuntimeStreamErrorHandler,
  type RuntimeStreamFilters,
  type RuntimeStreamFullReloadDecision,
  type RuntimeStreamReconnectScheduler,
  type RuntimeStreamReplayDecision,
  type RuntimeStreamReplayState,
  type RuntimeStreamUnsubscribe,
} from "./runtime-stream-client.js";
import {
  type ArtifactEvent,
  type ContextEvent,
  type ErrorEvent,
  type EvaluationEvent,
  type HumanEvent,
  type LifecycleEvent,
  type MetricEvent,
  type ModelEvent,
  type PlanningEvent,
  type RepairEvent,
  type SystemEvent,
  type ToolEvent,
} from "@cw/schemas";
import {
  bindRuntimeStreamEventStoreToPageLifecycle,
  createRuntimeStreamEventStore,
  type BindRuntimeStreamEventStorePageLifecycleOptions,
  type CreateRuntimeStreamEventStoreOptions,
  type RuntimeStreamEventStore,
  type RuntimeStreamEventStorePageLifecycleTarget,
  type RuntimeStreamEventStoreSnapshot,
} from "./runtime-stream-store.js";
import {
  createRuntimeStreamInteraction,
  type RuntimeStreamInteraction,
  type RuntimeStreamInteractionSnapshot,
} from "./runtime-stream-interaction.js";
import {
  createRuntimeStreamViewModel,
  type RuntimeStreamViewFilters,
  type RuntimeStreamViewModel,
} from "./runtime-stream-view-model.js";

export const RUNTIME_STREAM_LIFECYCLE_EVENT_TYPES = [
  "run.started",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "node.state_changed",
  "attempt.started",
  "attempt.completed",
  "attempt.failed",
] as const;

export const RUNTIME_STREAM_MODEL_EVENT_TYPES = [
  "model.request_started",
  "model.thinking_delta",
  "model.thought_completed",
  "model.text_delta",
  "model.text_completed",
  "model.request_completed",
  "model.request_failed",
  "model.escalated",
] as const;

export const RUNTIME_STREAM_TOOL_EVENT_TYPES = [
  "tool.call_started",
  "tool.call_completed",
  "tool.call_failed",
  "tool.approval_required",
  "tool.approved",
  "tool.rejected",
] as const;

export const RUNTIME_STREAM_CONTEXT_EVENT_TYPES = [
  "context.build_started",
  "context.build_completed",
  "context.compression_applied",
  "context.over_budget_failed",
  "evidence.build_completed",
  "evidence.conflict_detected",
  "evidence.feedback_written",
] as const;

export const RUNTIME_STREAM_EVALUATION_EVENT_TYPES = [
  "evaluation.started",
  "evaluation.criterion_passed",
  "evaluation.criterion_failed",
  "evaluation.completed",
  "evaluation.judge_disagreement",
] as const;

export const RUNTIME_STREAM_REPAIR_EVENT_TYPES = [
  "repair.started",
  "repair.patch_proposed",
  "repair.patch_rejected",
  "repair.patch_applied",
  "repair.patch_reverted",
  "repair.escalation_to_human",
] as const;

export const RUNTIME_STREAM_HUMAN_EVENT_TYPES = [
  "human.gate_required",
  "human.gate_resolved",
  "human.gate_timeout",
] as const;

export const RUNTIME_STREAM_PLANNING_EVENT_TYPES = [
  "planning.session_started",
  "planning.phase_changed",
  "planning.context_built",
  "planning.understanding_completed",
  "planning.clarification_question",
  "planning.clarification_answered",
  "planning.draft_generated",
  "planning.draft_validation",
  "planning.draft_repaired",
  "planning.workflow_patch_proposed",
  "planning.workflow_instantiated",
] as const;

export const RUNTIME_STREAM_ARTIFACT_EVENT_TYPES = [
  "artifact.written",
  "artifact.deleted",
  "git.snapshot_created",
  "git.tag_created",
  "export.completed",
] as const;

export const RUNTIME_STREAM_METRIC_EVENT_TYPES = [
  "metric.snapshot",
  "usage.delta",
] as const;

export const RUNTIME_STREAM_ERROR_EVENT_TYPES = [
  "error.exception",
  "error.network",
  "error.budget_exhausted",
] as const;

export const RUNTIME_STREAM_SYSTEM_EVENT_TYPES = [
  "system.runtime_ready",
  "system.heartbeat",
  "system.runtime_shutting_down",
] as const;

export const RUNTIME_STREAM_SSE_SYSTEM_EVENT_TYPES = [
  "system.heartbeat",
] as const;

export const RUNTIME_STREAM_RUN_EVENT_TYPES = [
  ...RUNTIME_STREAM_LIFECYCLE_EVENT_TYPES,
  ...RUNTIME_STREAM_MODEL_EVENT_TYPES,
  ...RUNTIME_STREAM_TOOL_EVENT_TYPES,
  ...RUNTIME_STREAM_CONTEXT_EVENT_TYPES,
  ...RUNTIME_STREAM_EVALUATION_EVENT_TYPES,
  ...RUNTIME_STREAM_REPAIR_EVENT_TYPES,
  ...RUNTIME_STREAM_HUMAN_EVENT_TYPES,
  ...RUNTIME_STREAM_ARTIFACT_EVENT_TYPES,
  ...RUNTIME_STREAM_METRIC_EVENT_TYPES,
  ...RUNTIME_STREAM_ERROR_EVENT_TYPES,
  ...RUNTIME_STREAM_SSE_SYSTEM_EVENT_TYPES,
] as const;

export const RUNTIME_STREAM_PLANNING_SESSION_EVENT_TYPES = [
  ...RUNTIME_STREAM_PLANNING_EVENT_TYPES,
  ...RUNTIME_STREAM_SSE_SYSTEM_EVENT_TYPES,
] as const;

export const RUNTIME_STREAM_ALL_EVENT_TYPES = [
  ...RUNTIME_STREAM_LIFECYCLE_EVENT_TYPES,
  ...RUNTIME_STREAM_MODEL_EVENT_TYPES,
  ...RUNTIME_STREAM_TOOL_EVENT_TYPES,
  ...RUNTIME_STREAM_CONTEXT_EVENT_TYPES,
  ...RUNTIME_STREAM_EVALUATION_EVENT_TYPES,
  ...RUNTIME_STREAM_REPAIR_EVENT_TYPES,
  ...RUNTIME_STREAM_HUMAN_EVENT_TYPES,
  ...RUNTIME_STREAM_PLANNING_EVENT_TYPES,
  ...RUNTIME_STREAM_ARTIFACT_EVENT_TYPES,
  ...RUNTIME_STREAM_METRIC_EVENT_TYPES,
  ...RUNTIME_STREAM_ERROR_EVENT_TYPES,
  ...RUNTIME_STREAM_SYSTEM_EVENT_TYPES,
] as const;

export type RuntimeStreamKnownEventType =
  (typeof RUNTIME_STREAM_ALL_EVENT_TYPES)[number];

export type RuntimeStreamGeneratedEventType =
  | LifecycleEvent["type"]
  | ModelEvent["type"]
  | ToolEvent["type"]
  | ContextEvent["type"]
  | EvaluationEvent["type"]
  | RepairEvent["type"]
  | HumanEvent["type"]
  | PlanningEvent["type"]
  | ArtifactEvent["type"]
  | MetricEvent["type"]
  | ErrorEvent["type"]
  | SystemEvent["type"];

type RuntimeStreamExactEventTypeSet<TActual, TExpected> =
  Exclude<TActual, TExpected> extends never
    ? Exclude<TExpected, TActual> extends never
      ? true
      : never
    : never;

export const RUNTIME_STREAM_GENERATED_EVENT_TYPE_PARITY: RuntimeStreamExactEventTypeSet<
  RuntimeStreamKnownEventType,
  RuntimeStreamGeneratedEventType
> = true;

export interface RuntimeStreamInteractionSessionSnapshot {
  readonly store: RuntimeStreamEventStoreSnapshot;
  readonly interaction: RuntimeStreamInteractionSnapshot;
}

export type RuntimeStreamInteractionSessionListener = (
  snapshot: RuntimeStreamInteractionSessionSnapshot,
) => void;

export interface RuntimeStreamInteractionSession {
  readonly eventTypes: readonly RuntimeStreamKnownEventType[];
  readonly store: RuntimeStreamEventStore;
  readonly viewModel: RuntimeStreamViewModel;
  readonly interaction: RuntimeStreamInteraction;
  readonly snapshot: () => RuntimeStreamInteractionSessionSnapshot;
  readonly subscribe: (
    listener: RuntimeStreamInteractionSessionListener,
  ) => RuntimeStreamUnsubscribe;
  readonly start: () => Promise<RuntimeStreamInteractionSessionSnapshot>;
  readonly stop: () => boolean;
  readonly resetFullReloadRequired: () => RuntimeStreamInteractionSessionSnapshot;
  readonly bindPageLifecycle: (
    target: RuntimeStreamEventStorePageLifecycleTarget,
    options?: BindRuntimeStreamEventStorePageLifecycleOptions,
  ) => RuntimeStreamUnsubscribe;
  readonly isStarted: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
}

export interface CreateRuntimeStreamInteractionSessionOptions {
  readonly clientOptions: OpenRuntimeStreamReconnectingClientOptions;
  readonly eventTypes?: readonly RuntimeStreamKnownEventType[];
  readonly maxEvents?: number;
  readonly clientFactory?: CreateRuntimeStreamEventStoreOptions["clientFactory"];
  readonly viewFilters?: RuntimeStreamViewFilters;
  readonly expandedEventIds?: readonly string[];
  readonly searchQuery?: string;
  readonly selectedEventId?: string | null;
  readonly lastSeenTotalEvents?: number;
  readonly onError?: (error: unknown) => void;
}

export interface RuntimeStreamInteractionSessionFactory {
  readonly createSession: (
    options: CreateRuntimeStreamInteractionSessionFactorySessionOptions,
  ) => RuntimeStreamInteractionSession;
}

export interface RuntimeStreamInteractionSessionController {
  readonly activeSession: () => RuntimeStreamInteractionSession | null;
  readonly activeChannel: () => RuntimeStreamChannel | null;
  readonly openSession: (
    options: CreateRuntimeStreamInteractionSessionFactorySessionOptions,
  ) => RuntimeStreamInteractionSession;
  readonly disposeActiveSession: () => boolean;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeStreamInteractionSessionFactoryOptions {
  readonly runtime: OpenRuntimeStreamReconnectingClientOptions["runtime"];
  readonly eventSourceFactory: OpenRuntimeStreamReconnectingClientOptions["eventSourceFactory"];
  readonly projectId?: string;
  readonly filters?: RuntimeStreamFilters;
  readonly scheduler?: RuntimeStreamReconnectScheduler;
  readonly onEventError?: RuntimeStreamErrorHandler;
  readonly onConnectionError?: RuntimeStreamErrorHandler;
  readonly onReplayDecision?: (decision: RuntimeStreamReplayDecision) => void;
  readonly onFullReloadRequired?: (
    decision: RuntimeStreamFullReloadDecision,
  ) => void;
  readonly onError?: (error: unknown) => void;
}

export interface CreateRuntimeStreamInteractionSessionControllerOptions {
  readonly factory: RuntimeStreamInteractionSessionFactory;
}

export interface CreateRuntimeStreamInteractionSessionFactorySessionOptions extends Omit<
  CreateRuntimeStreamInteractionSessionOptions,
  "clientOptions"
> {
  readonly channel: RuntimeStreamChannel;
  readonly projectId?: string;
  readonly filters?: RuntimeStreamFilters;
  readonly replayState?: RuntimeStreamReplayState;
  readonly scheduler?: RuntimeStreamReconnectScheduler;
  readonly onEventError?: RuntimeStreamErrorHandler;
  readonly onConnectionError?: RuntimeStreamErrorHandler;
  readonly onReplayDecision?: (decision: RuntimeStreamReplayDecision) => void;
  readonly onFullReloadRequired?: (
    decision: RuntimeStreamFullReloadDecision,
  ) => void;
}

export function createRuntimeStreamInteractionSession(
  options: CreateRuntimeStreamInteractionSessionOptions,
): RuntimeStreamInteractionSession {
  const eventTypes = normalizeRuntimeStreamSessionEventTypes(
    options.eventTypes ??
      defaultRuntimeStreamSessionEventTypes(options.clientOptions.channel),
  );
  const store = createRuntimeStreamEventStore({
    clientOptions: options.clientOptions,
    eventTypes,
    ...(options.maxEvents !== undefined
      ? { maxEvents: options.maxEvents }
      : {}),
    ...(options.clientFactory !== undefined
      ? { clientFactory: options.clientFactory }
      : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const viewModel = createRuntimeStreamViewModel({
    store,
    ...(options.viewFilters !== undefined
      ? { filters: options.viewFilters }
      : {}),
    ...(options.expandedEventIds !== undefined
      ? { expandedEventIds: options.expandedEventIds }
      : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const interaction = createRuntimeStreamInteraction({
    viewModel,
    ...(options.searchQuery !== undefined
      ? { searchQuery: options.searchQuery }
      : {}),
    ...(options.selectedEventId !== undefined
      ? { selectedEventId: options.selectedEventId }
      : {}),
    ...(options.lastSeenTotalEvents !== undefined
      ? { lastSeenTotalEvents: options.lastSeenTotalEvents }
      : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const lifecycleUnsubscribes = new Set<RuntimeStreamUnsubscribe>();
  const sessionListeners = new Set<RuntimeStreamInteractionSessionListener>();
  let upstreamInteractionUnsubscribe: RuntimeStreamUnsubscribe | null = null;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break session snapshot propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime stream interaction session is disposed");
    }
  };

  const snapshot = (): RuntimeStreamInteractionSessionSnapshot => ({
    store: store.snapshot(),
    interaction: interaction.snapshot(),
  });

  const publish = (): void => {
    if (disposed || sessionListeners.size === 0) {
      return;
    }
    const nextSnapshot = snapshot();
    for (const listener of [...sessionListeners]) {
      try {
        listener(nextSnapshot);
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensureUpstreamInteractionSubscription = (): void => {
    if (upstreamInteractionUnsubscribe !== null) {
      return;
    }
    upstreamInteractionUnsubscribe = interaction.subscribe(() => {
      publish();
    });
  };

  const releaseUpstreamInteractionSubscription = (): void => {
    upstreamInteractionUnsubscribe?.();
    upstreamInteractionUnsubscribe = null;
  };

  return {
    eventTypes,
    store,
    viewModel,
    interaction,
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      sessionListeners.add(listener);
      ensureUpstreamInteractionSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = sessionListeners.delete(listener);
        if (sessionListeners.size === 0) {
          releaseUpstreamInteractionSubscription();
        }
        return deleted;
      };
    },
    start: async () => {
      assertActive();
      await store.start();
      return snapshot();
    },
    stop: () => {
      if (disposed) {
        return false;
      }
      return store.stop();
    },
    resetFullReloadRequired: () => {
      assertActive();
      const wasFullReloadRequired =
        store.snapshot().status === "full_reload_required";
      store.resetFullReloadRequired();
      if (wasFullReloadRequired) {
        interaction.markAllRead();
      }
      return snapshot();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      const unsubscribe = bindRuntimeStreamEventStoreToPageLifecycle(
        store,
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
      releaseUpstreamInteractionSubscription();
      sessionListeners.clear();
      for (const unsubscribe of [...lifecycleUnsubscribes]) {
        unsubscribe();
      }
      lifecycleUnsubscribes.clear();
      store.stop();
      interaction.dispose();
      viewModel.dispose();
      return true;
    },
  };
}

export function createRuntimeStreamInteractionSessionFactory(
  options: CreateRuntimeStreamInteractionSessionFactoryOptions,
): RuntimeStreamInteractionSessionFactory {
  return {
    createSession: (sessionOptions) =>
      createRuntimeStreamInteractionSession(
        buildRuntimeStreamInteractionSessionOptions(options, sessionOptions),
      ),
  };
}

export function createRuntimeStreamInteractionSessionController(
  options: CreateRuntimeStreamInteractionSessionControllerOptions,
): RuntimeStreamInteractionSessionController {
  let activeSession: RuntimeStreamInteractionSession | null = null;
  let activeChannel: RuntimeStreamChannel | null = null;
  let disposed = false;

  const assertActive = (): void => {
    if (disposed) {
      throw new Error(
        "Runtime stream interaction session controller is disposed",
      );
    }
  };

  const clearActiveSession = (): boolean => {
    const session = activeSession;
    activeSession = null;
    activeChannel = null;
    return session?.dispose() ?? false;
  };

  return {
    activeSession: () => activeSession,
    activeChannel: () =>
      activeChannel === null ? null : cloneRuntimeStreamChannel(activeChannel),
    openSession: (sessionOptions) => {
      assertActive();
      const channel = cloneRuntimeStreamChannel(sessionOptions.channel);
      const nextSession = options.factory.createSession({
        ...sessionOptions,
        channel,
      });
      const previousSession = activeSession;
      activeSession = nextSession;
      activeChannel = cloneRuntimeStreamChannel(channel);
      previousSession?.dispose();
      return nextSession;
    },
    disposeActiveSession: () => clearActiveSession(),
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      clearActiveSession();
      return true;
    },
    isDisposed: () => disposed,
  };
}

export function defaultRuntimeStreamSessionEventTypes(
  channel: RuntimeStreamChannel,
): readonly RuntimeStreamKnownEventType[] {
  return channel.kind === "planning"
    ? RUNTIME_STREAM_PLANNING_SESSION_EVENT_TYPES
    : RUNTIME_STREAM_RUN_EVENT_TYPES;
}

function normalizeRuntimeStreamSessionEventTypes(
  eventTypes: readonly string[],
): RuntimeStreamKnownEventType[] {
  if (eventTypes.length === 0) {
    throw new Error(
      "Runtime stream interaction session requires at least one event type",
    );
  }
  const uniqueEventTypes: RuntimeStreamKnownEventType[] = [];
  for (const eventType of eventTypes) {
    assertRuntimeStreamSessionEventType(eventType);
    if (!uniqueEventTypes.includes(eventType)) {
      uniqueEventTypes.push(eventType);
    }
  }
  return uniqueEventTypes;
}

function buildRuntimeStreamInteractionSessionOptions(
  factoryOptions: CreateRuntimeStreamInteractionSessionFactoryOptions,
  sessionOptions: CreateRuntimeStreamInteractionSessionFactorySessionOptions,
): CreateRuntimeStreamInteractionSessionOptions {
  const options: {
    clientOptions: OpenRuntimeStreamReconnectingClientOptions;
    eventTypes?: readonly RuntimeStreamKnownEventType[];
    maxEvents?: number;
    clientFactory?: CreateRuntimeStreamEventStoreOptions["clientFactory"];
    viewFilters?: RuntimeStreamViewFilters;
    expandedEventIds?: readonly string[];
    searchQuery?: string;
    selectedEventId?: string | null;
    lastSeenTotalEvents?: number;
    onError?: (error: unknown) => void;
  } = {
    clientOptions: buildRuntimeStreamInteractionSessionClientOptions(
      factoryOptions,
      sessionOptions,
    ),
  };
  if (sessionOptions.eventTypes !== undefined) {
    options.eventTypes = sessionOptions.eventTypes;
  }
  if (sessionOptions.maxEvents !== undefined) {
    options.maxEvents = sessionOptions.maxEvents;
  }
  if (sessionOptions.clientFactory !== undefined) {
    options.clientFactory = sessionOptions.clientFactory;
  }
  if (sessionOptions.viewFilters !== undefined) {
    options.viewFilters = sessionOptions.viewFilters;
  }
  if (sessionOptions.expandedEventIds !== undefined) {
    options.expandedEventIds = sessionOptions.expandedEventIds;
  }
  if (sessionOptions.searchQuery !== undefined) {
    options.searchQuery = sessionOptions.searchQuery;
  }
  if (sessionOptions.selectedEventId !== undefined) {
    options.selectedEventId = sessionOptions.selectedEventId;
  }
  if (sessionOptions.lastSeenTotalEvents !== undefined) {
    options.lastSeenTotalEvents = sessionOptions.lastSeenTotalEvents;
  }
  const onError = sessionOptions.onError ?? factoryOptions.onError;
  if (onError !== undefined) {
    options.onError = onError;
  }
  return options;
}

function buildRuntimeStreamInteractionSessionClientOptions(
  factoryOptions: CreateRuntimeStreamInteractionSessionFactoryOptions,
  sessionOptions: CreateRuntimeStreamInteractionSessionFactorySessionOptions,
): OpenRuntimeStreamReconnectingClientOptions {
  const clientOptions: {
    runtime: OpenRuntimeStreamReconnectingClientOptions["runtime"];
    channel: RuntimeStreamChannel;
    eventSourceFactory: OpenRuntimeStreamReconnectingClientOptions["eventSourceFactory"];
    projectId?: string;
    filters?: RuntimeStreamFilters;
    replayState?: RuntimeStreamReplayState;
    scheduler?: RuntimeStreamReconnectScheduler;
    onEventError?: RuntimeStreamErrorHandler;
    onConnectionError?: RuntimeStreamErrorHandler;
    onReplayDecision?: (decision: RuntimeStreamReplayDecision) => void;
    onFullReloadRequired?: (decision: RuntimeStreamFullReloadDecision) => void;
  } = {
    runtime: factoryOptions.runtime,
    channel: sessionOptions.channel,
    eventSourceFactory: factoryOptions.eventSourceFactory,
  };
  const projectId = sessionOptions.projectId ?? factoryOptions.projectId;
  const filters = sessionOptions.filters ?? factoryOptions.filters;
  const scheduler = sessionOptions.scheduler ?? factoryOptions.scheduler;
  const onEventError =
    sessionOptions.onEventError ?? factoryOptions.onEventError;
  const onConnectionError =
    sessionOptions.onConnectionError ?? factoryOptions.onConnectionError;
  const onReplayDecision =
    sessionOptions.onReplayDecision ?? factoryOptions.onReplayDecision;
  const onFullReloadRequired =
    sessionOptions.onFullReloadRequired ?? factoryOptions.onFullReloadRequired;
  if (projectId !== undefined) {
    clientOptions.projectId = projectId;
  }
  if (filters !== undefined) {
    clientOptions.filters = filters;
  }
  if (sessionOptions.replayState !== undefined) {
    clientOptions.replayState = sessionOptions.replayState;
  }
  if (scheduler !== undefined) {
    clientOptions.scheduler = scheduler;
  }
  if (onEventError !== undefined) {
    clientOptions.onEventError = onEventError;
  }
  if (onConnectionError !== undefined) {
    clientOptions.onConnectionError = onConnectionError;
  }
  if (onReplayDecision !== undefined) {
    clientOptions.onReplayDecision = onReplayDecision;
  }
  if (onFullReloadRequired !== undefined) {
    clientOptions.onFullReloadRequired = onFullReloadRequired;
  }
  return clientOptions;
}

function cloneRuntimeStreamChannel(
  channel: RuntimeStreamChannel,
): RuntimeStreamChannel {
  return channel.kind === "planning"
    ? { kind: "planning", sessionId: channel.sessionId }
    : { kind: "run", runId: channel.runId };
}

const RUNTIME_STREAM_KNOWN_EVENT_TYPE_SET = new Set<string>(
  RUNTIME_STREAM_ALL_EVENT_TYPES,
);

function assertRuntimeStreamSessionEventType(
  eventType: string,
): asserts eventType is RuntimeStreamKnownEventType {
  if (!/^[a-z]+(?:\.[a-z0-9_]+)+$/u.test(eventType)) {
    throw new Error(
      `Runtime stream interaction session event type is invalid: ${eventType}`,
    );
  }
  if (!RUNTIME_STREAM_KNOWN_EVENT_TYPE_SET.has(eventType)) {
    throw new Error(
      `Runtime stream interaction session event type is not in the StreamEvent spec: ${eventType}`,
    );
  }
}
