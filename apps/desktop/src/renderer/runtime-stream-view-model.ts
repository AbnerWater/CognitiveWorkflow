import {
  type RuntimeStreamEvent,
  type RuntimeStreamFullReloadDecision,
  type RuntimeStreamUnsubscribe,
} from "./runtime-stream-client.js";
import {
  type RuntimeStreamEventStoreSnapshot,
  type RuntimeStreamEventStoreStatus,
} from "./runtime-stream-store.js";

export type RuntimeStreamViewDisplayLevel = "minimal" | "default" | "detailed";

export type RuntimeStreamViewSeverity =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "fatal";

const RUNTIME_STREAM_VIEW_EVENT_PHASES = [
  "run.created",
  "run.started",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "node.idle",
  "node.ready",
  "node.running",
  "node.validating",
  "node.reviewing",
  "node.passed",
  "node.review_failed",
  "node.repairing",
  "node.retrying",
  "node.waiting_user",
  "node.skipped",
  "node.failed",
  "attempt.started",
  "attempt.streaming",
  "attempt.tool_calling",
  "attempt.validating",
  "attempt.completed",
  "attempt.failed",
  "planning.exploring",
  "planning.understanding",
  "planning.clarifying",
  "planning.planning",
  "planning.validating",
  "planning.previewing",
  "planning.revising",
  "planning.created",
] as const;

export type RuntimeStreamViewEventPhase =
  (typeof RUNTIME_STREAM_VIEW_EVENT_PHASES)[number];

export type RuntimeStreamViewSensitivity = "public" | "project" | "sensitive";

export type RuntimeStreamViewCategory =
  | "lifecycle"
  | "model"
  | "tool"
  | "evaluation"
  | "repair"
  | "human"
  | "context"
  | "planning"
  | "artifact"
  | "metric"
  | "error"
  | "system";

export interface RuntimeStreamViewFilters {
  readonly displayLevels?: readonly RuntimeStreamViewDisplayLevel[];
  readonly categories?: readonly RuntimeStreamViewCategory[];
}

export interface RuntimeStreamViewNormalizedFilters {
  readonly displayLevels: readonly RuntimeStreamViewDisplayLevel[] | null;
  readonly categories: readonly RuntimeStreamViewCategory[] | null;
}

export interface RuntimeStreamViewEvent {
  readonly id: string | null;
  readonly schemaVersion: string | null;
  readonly seq: number | null;
  readonly parentEventId: string | null;
  readonly correlationId: string | null;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly attemptId: string | null;
  readonly type: string;
  readonly category: RuntimeStreamViewCategory | null;
  readonly phase: RuntimeStreamViewEventPhase | null;
  readonly displayLevel: RuntimeStreamViewDisplayLevel;
  readonly severity: RuntimeStreamViewSeverity;
  readonly sensitivity: RuntimeStreamViewSensitivity;
  readonly title: string;
  readonly summary: string | null;
  readonly content: string | null;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly childCount: number;
  readonly children: readonly RuntimeStreamViewEvent[];
  readonly payload: unknown;
  readonly artifactRefs: unknown;
  readonly createdAt: string | null;
  readonly rawData: string;
}

export interface RuntimeStreamViewModelSnapshot {
  readonly status: RuntimeStreamEventStoreStatus;
  readonly filters: RuntimeStreamViewNormalizedFilters;
  readonly summaryItems: readonly RuntimeStreamViewEvent[];
  readonly timelineItems: readonly RuntimeStreamViewEvent[];
  readonly bufferedEventCount: number;
  readonly matchingEventCount: number;
  readonly visibleEventCount: number;
  readonly hiddenEventCount: number;
  readonly foldedChildCount: number;
  readonly totalEvents: number;
  readonly fullReloadRequired: boolean;
  readonly fullReloadDecision: RuntimeStreamFullReloadDecision | null;
}

export type RuntimeStreamViewModelListener = (
  snapshot: RuntimeStreamViewModelSnapshot,
) => void;

export type RuntimeStreamViewModelErrorHandler = (error: unknown) => void;

export interface RuntimeStreamViewModelStore {
  readonly snapshot: () => RuntimeStreamEventStoreSnapshot;
  readonly subscribe: (
    listener: (snapshot: RuntimeStreamEventStoreSnapshot) => void,
  ) => RuntimeStreamUnsubscribe;
}

export interface RuntimeStreamViewModel {
  readonly snapshot: () => RuntimeStreamViewModelSnapshot;
  readonly subscribe: (
    listener: RuntimeStreamViewModelListener,
  ) => RuntimeStreamUnsubscribe;
  readonly setFilters: (
    filters: RuntimeStreamViewFilters,
  ) => RuntimeStreamViewModelSnapshot;
  readonly setExpanded: (
    eventId: string,
    expanded: boolean,
  ) => RuntimeStreamViewModelSnapshot;
  readonly toggleExpanded: (eventId: string) => RuntimeStreamViewModelSnapshot;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
}

export interface CreateRuntimeStreamViewModelOptions {
  readonly store: RuntimeStreamViewModelStore;
  readonly filters?: RuntimeStreamViewFilters;
  readonly expandedEventIds?: readonly string[];
  readonly onError?: RuntimeStreamViewModelErrorHandler;
}

interface RuntimeStreamViewEventDraft {
  readonly id: string | null;
  readonly schemaVersion: string | null;
  readonly seq: number | null;
  readonly parentEventId: string | null;
  readonly correlationId: string | null;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly attemptId: string | null;
  readonly type: string;
  readonly category: RuntimeStreamViewCategory | null;
  readonly phase: RuntimeStreamViewEventPhase | null;
  readonly displayLevel: RuntimeStreamViewDisplayLevel;
  readonly severity: RuntimeStreamViewSeverity;
  readonly sensitivity: RuntimeStreamViewSensitivity;
  readonly title: string;
  readonly summary: string | null;
  readonly content: string | null;
  readonly expandable: boolean;
  readonly payload: unknown;
  readonly artifactRefs: unknown;
  readonly createdAt: string | null;
  readonly rawData: string;
}

export function createRuntimeStreamViewModel(
  options: CreateRuntimeStreamViewModelOptions,
): RuntimeStreamViewModel {
  let storeSnapshot = options.store.snapshot();
  let filters = normalizeRuntimeStreamViewFilters(options.filters ?? {});
  const expandedEventIds = new Set<string>();
  for (const eventId of options.expandedEventIds ?? []) {
    expandedEventIds.add(requireRuntimeStreamViewEventId(eventId));
  }
  const listeners = new Set<RuntimeStreamViewModelListener>();
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break stream view propagation.
    }
  };

  const snapshot = (): RuntimeStreamViewModelSnapshot =>
    buildRuntimeStreamViewModelSnapshot(storeSnapshot, {
      filters,
      expandedEventIds: [...expandedEventIds],
    });

  const publish = (): void => {
    if (disposed) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(snapshot());
      } catch (error) {
        reportError(error);
      }
    }
  };

  const unsubscribeStore = options.store.subscribe((nextSnapshot) => {
    storeSnapshot = nextSnapshot;
    publish();
  });

  return {
    snapshot,
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
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
    setFilters: (nextFilters) => {
      filters = normalizeRuntimeStreamViewFilters(nextFilters);
      publish();
      return snapshot();
    },
    setExpanded: (eventId, expanded) => {
      const safeEventId = requireRuntimeStreamViewEventId(eventId);
      if (expanded) {
        expandedEventIds.add(safeEventId);
      } else {
        expandedEventIds.delete(safeEventId);
      }
      publish();
      return snapshot();
    },
    toggleExpanded: (eventId) => {
      const safeEventId = requireRuntimeStreamViewEventId(eventId);
      if (expandedEventIds.has(safeEventId)) {
        expandedEventIds.delete(safeEventId);
      } else {
        expandedEventIds.add(safeEventId);
      }
      publish();
      return snapshot();
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      listeners.clear();
      unsubscribeStore();
      return true;
    },
  };
}

export function buildRuntimeStreamViewModelSnapshot(
  storeSnapshot: RuntimeStreamEventStoreSnapshot,
  options: {
    readonly filters?:
      | RuntimeStreamViewFilters
      | RuntimeStreamViewNormalizedFilters;
    readonly expandedEventIds?: readonly string[];
  } = {},
): RuntimeStreamViewModelSnapshot {
  const filters = normalizeRuntimeStreamViewFilters(options.filters ?? {});
  const expandedEventIds = new Set<string>();
  for (const eventId of options.expandedEventIds ?? []) {
    expandedEventIds.add(requireRuntimeStreamViewEventId(eventId));
  }
  const drafts = storeSnapshot.events.map(toRuntimeStreamViewEventDraft);
  const matchingDrafts = drafts.filter((event) =>
    matchesRuntimeStreamViewFilters(event, filters),
  );
  const childDrafts = new Map<
    RuntimeStreamViewEventDraft,
    RuntimeStreamViewEventDraft[]
  >();
  const childSet = new Set<RuntimeStreamViewEventDraft>();
  const draftById = new Map<string, RuntimeStreamViewEventDraft>();

  for (const draft of matchingDrafts) {
    if (draft.id !== null && !draftById.has(draft.id)) {
      draftById.set(draft.id, draft);
    }
  }

  for (const draft of matchingDrafts) {
    if (draft.parentEventId === null || draft.parentEventId === draft.id) {
      continue;
    }
    const parent = draftById.get(draft.parentEventId);
    if (parent === undefined) {
      continue;
    }
    const children = childDrafts.get(parent) ?? [];
    children.push(draft);
    childDrafts.set(parent, children);
    childSet.add(draft);
  }

  const rootItems = matchingDrafts
    .filter((draft) => !childSet.has(draft))
    .map((draft) =>
      buildRuntimeStreamViewEvent(draft, childDrafts, expandedEventIds, []),
    );
  const summaryItems = rootItems.filter(
    (event) => event.displayLevel === "minimal",
  );
  const timelineItems = rootItems.filter(
    (event) => event.displayLevel !== "minimal",
  );
  const visibleEventCount =
    countRuntimeStreamViewEvents(summaryItems) +
    countRuntimeStreamViewEvents(timelineItems);

  return {
    status: storeSnapshot.status,
    filters,
    summaryItems,
    timelineItems,
    bufferedEventCount: storeSnapshot.events.length,
    matchingEventCount: matchingDrafts.length,
    visibleEventCount,
    hiddenEventCount: storeSnapshot.events.length - matchingDrafts.length,
    foldedChildCount: matchingDrafts.length - visibleEventCount,
    totalEvents: storeSnapshot.totalEvents,
    fullReloadRequired: storeSnapshot.status === "full_reload_required",
    fullReloadDecision:
      storeSnapshot.fullReloadDecision === undefined
        ? null
        : cloneRuntimeStreamFullReloadDecision(
            storeSnapshot.fullReloadDecision,
          ),
  };
}

function buildRuntimeStreamViewEvent(
  draft: RuntimeStreamViewEventDraft,
  childDrafts: ReadonlyMap<
    RuntimeStreamViewEventDraft,
    readonly RuntimeStreamViewEventDraft[]
  >,
  expandedEventIds: ReadonlySet<string>,
  visitedEventIds: readonly string[],
): RuntimeStreamViewEvent {
  const children = childDrafts.get(draft) ?? [];
  const expandable = draft.expandable || children.length > 0;
  const expanded =
    draft.id !== null &&
    expandable &&
    expandedEventIds.has(draft.id) &&
    !visitedEventIds.includes(draft.id);
  const nextVisitedEventIds =
    draft.id === null ? visitedEventIds : [...visitedEventIds, draft.id];
  return {
    id: draft.id,
    schemaVersion: draft.schemaVersion,
    seq: draft.seq,
    parentEventId: draft.parentEventId,
    correlationId: draft.correlationId,
    runId: draft.runId,
    nodeId: draft.nodeId,
    attemptId: draft.attemptId,
    type: draft.type,
    category: draft.category,
    phase: draft.phase,
    displayLevel: draft.displayLevel,
    severity: draft.severity,
    sensitivity: draft.sensitivity,
    title: draft.title,
    summary: draft.summary,
    content: draft.content,
    expandable,
    expanded,
    childCount: children.length,
    children: expanded
      ? children.map((child) =>
          buildRuntimeStreamViewEvent(
            child,
            childDrafts,
            expandedEventIds,
            nextVisitedEventIds,
          ),
        )
      : [],
    payload: structuredClone(draft.payload),
    artifactRefs: structuredClone(draft.artifactRefs),
    createdAt: draft.createdAt,
    rawData: draft.rawData,
  };
}

function toRuntimeStreamViewEventDraft(
  event: RuntimeStreamEvent<unknown>,
): RuntimeStreamViewEventDraft {
  const data = isRecord(event.data) ? event.data : {};
  const id = readString(data, "event_id") ?? event.id;
  const type = readString(data, "type") ?? event.type;
  return {
    id,
    schemaVersion: readString(data, "schema_version"),
    seq: readSafeInteger(data, "seq"),
    parentEventId: readNullableString(data, "parent_event_id"),
    correlationId: readString(data, "correlation_id"),
    runId: readString(data, "run_id"),
    nodeId: readString(data, "node_id"),
    attemptId: readString(data, "attempt_id"),
    type,
    category: readRuntimeStreamCategory(data, "category"),
    phase: readRuntimeStreamEventPhase(data, "phase"),
    displayLevel: readRuntimeStreamDisplayLevel(data, "display_level"),
    severity: readRuntimeStreamSeverity(data, "severity"),
    sensitivity: readRuntimeStreamSensitivity(data, "sensitivity"),
    title: readString(data, "title") ?? type,
    summary: readNullableString(data, "summary"),
    content: readNullableString(data, "content"),
    expandable: readBoolean(data, "expandable") ?? false,
    payload: structuredClone(readUnknown(data, "payload") ?? null),
    artifactRefs: structuredClone(readUnknown(data, "artifact_refs") ?? []),
    createdAt: readNullableString(data, "created_at"),
    rawData: event.rawData,
  };
}

function matchesRuntimeStreamViewFilters(
  event: RuntimeStreamViewEventDraft,
  filters: RuntimeStreamViewNormalizedFilters,
): boolean {
  if (
    filters.displayLevels !== null &&
    !filters.displayLevels.includes(event.displayLevel)
  ) {
    return false;
  }
  if (
    filters.categories !== null &&
    (event.category === null || !filters.categories.includes(event.category))
  ) {
    return false;
  }
  return true;
}

function normalizeRuntimeStreamViewFilters(
  filters: RuntimeStreamViewFilters | RuntimeStreamViewNormalizedFilters,
): RuntimeStreamViewNormalizedFilters {
  return {
    displayLevels:
      filters.displayLevels === undefined || filters.displayLevels === null
        ? null
        : normalizeRuntimeStreamDisplayLevels(filters.displayLevels),
    categories:
      filters.categories === undefined || filters.categories === null
        ? null
        : normalizeRuntimeStreamCategories(filters.categories),
  };
}

function normalizeRuntimeStreamDisplayLevels(
  displayLevels: readonly RuntimeStreamViewDisplayLevel[],
): RuntimeStreamViewDisplayLevel[] {
  const normalized: RuntimeStreamViewDisplayLevel[] = [];
  for (const displayLevel of displayLevels) {
    assertRuntimeStreamDisplayLevel(displayLevel);
    if (!normalized.includes(displayLevel)) {
      normalized.push(displayLevel);
    }
  }
  return normalized;
}

function normalizeRuntimeStreamCategories(
  categories: readonly RuntimeStreamViewCategory[],
): RuntimeStreamViewCategory[] {
  const normalized: RuntimeStreamViewCategory[] = [];
  for (const category of categories) {
    assertRuntimeStreamCategory(category);
    if (!normalized.includes(category)) {
      normalized.push(category);
    }
  }
  return normalized;
}

function countRuntimeStreamViewEvents(
  events: readonly RuntimeStreamViewEvent[],
): number {
  let count = 0;
  for (const event of events) {
    count += 1 + countRuntimeStreamViewEvents(event.children);
  }
  return count;
}

function requireRuntimeStreamViewEventId(eventId: string): string {
  if (eventId.length === 0 || /[\u0000-\u001f\u007f\s]/u.test(eventId)) {
    throw new Error(
      "Runtime stream view event id must be non-empty and contain no whitespace or control characters",
    );
  }
  return eventId;
}

function readRuntimeStreamDisplayLevel(
  record: Readonly<Record<string, unknown>>,
  key: string,
): RuntimeStreamViewDisplayLevel {
  const value = readString(record, key);
  if (value === "minimal" || value === "default" || value === "detailed") {
    return value;
  }
  return "default";
}

function assertRuntimeStreamDisplayLevel(
  displayLevel: RuntimeStreamViewDisplayLevel,
): void {
  if (
    displayLevel !== "minimal" &&
    displayLevel !== "default" &&
    displayLevel !== "detailed"
  ) {
    throw new Error(
      `Runtime stream view display level is invalid: ${displayLevel}`,
    );
  }
}

function readRuntimeStreamSeverity(
  record: Readonly<Record<string, unknown>>,
  key: string,
): RuntimeStreamViewSeverity {
  const value = readString(record, key);
  if (
    value === "info" ||
    value === "success" ||
    value === "warning" ||
    value === "error" ||
    value === "fatal"
  ) {
    return value;
  }
  return "info";
}

function readRuntimeStreamSensitivity(
  record: Readonly<Record<string, unknown>>,
  key: string,
): RuntimeStreamViewSensitivity {
  const value = readString(record, key);
  if (value === "public" || value === "project" || value === "sensitive") {
    return value;
  }
  return "project";
}

function readRuntimeStreamEventPhase(
  record: Readonly<Record<string, unknown>>,
  key: string,
): RuntimeStreamViewEventPhase | null {
  const value = readString(record, key);
  if (value === null) {
    return null;
  }
  return isRuntimeStreamEventPhase(value) ? value : null;
}

function isRuntimeStreamEventPhase(
  value: string,
): value is RuntimeStreamViewEventPhase {
  return RUNTIME_STREAM_VIEW_EVENT_PHASES.some((phase) => phase === value);
}

function readRuntimeStreamCategory(
  record: Readonly<Record<string, unknown>>,
  key: string,
): RuntimeStreamViewCategory | null {
  const value = readString(record, key);
  if (value === null) {
    return null;
  }
  return isRuntimeStreamCategory(value) ? value : null;
}

function assertRuntimeStreamCategory(
  category: RuntimeStreamViewCategory,
): void {
  if (!isRuntimeStreamCategory(category)) {
    throw new Error(`Runtime stream view category is invalid: ${category}`);
  }
}

function isRuntimeStreamCategory(
  value: string,
): value is RuntimeStreamViewCategory {
  return (
    value === "lifecycle" ||
    value === "model" ||
    value === "tool" ||
    value === "evaluation" ||
    value === "repair" ||
    value === "human" ||
    value === "context" ||
    value === "planning" ||
    value === "artifact" ||
    value === "metric" ||
    value === "error" ||
    value === "system"
  );
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : null;
}

function readSafeInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function readBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readUnknown(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return record[key];
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
