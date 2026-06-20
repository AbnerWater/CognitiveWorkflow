import {
  type OpenRuntimeStreamReconnectingClientOptions,
  type RuntimeStreamChannel,
  type RuntimeStreamUnsubscribe,
} from "./runtime-stream-client.js";
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

export interface RuntimeStreamInteractionSessionSnapshot {
  readonly store: RuntimeStreamEventStoreSnapshot;
  readonly interaction: RuntimeStreamInteractionSnapshot;
}

export interface RuntimeStreamInteractionSession {
  readonly eventTypes: readonly RuntimeStreamKnownEventType[];
  readonly store: RuntimeStreamEventStore;
  readonly viewModel: RuntimeStreamViewModel;
  readonly interaction: RuntimeStreamInteraction;
  readonly snapshot: () => RuntimeStreamInteractionSessionSnapshot;
  readonly start: () => Promise<RuntimeStreamInteractionSessionSnapshot>;
  readonly stop: () => boolean;
  readonly bindPageLifecycle: (
    target: RuntimeStreamEventStorePageLifecycleTarget,
    options?: BindRuntimeStreamEventStorePageLifecycleOptions,
  ) => RuntimeStreamUnsubscribe;
  readonly isStarted: () => boolean;
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
  let disposed = false;

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime stream interaction session is disposed");
    }
  };

  const snapshot = (): RuntimeStreamInteractionSessionSnapshot => ({
    store: store.snapshot(),
    interaction: interaction.snapshot(),
  });

  return {
    eventTypes,
    store,
    viewModel,
    interaction,
    snapshot,
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
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
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
