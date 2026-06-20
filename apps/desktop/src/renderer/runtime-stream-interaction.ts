import { type RuntimeStreamUnsubscribe } from "./runtime-stream-client.js";
import {
  type RuntimeStreamViewEvent,
  type RuntimeStreamViewModelSnapshot,
} from "./runtime-stream-view-model.js";

export type RuntimeStreamInteractionSearchField =
  | "id"
  | "type"
  | "category"
  | "title"
  | "summary"
  | "content";

export interface RuntimeStreamInteractionSearchMatch {
  readonly eventId: string;
  readonly fields: readonly RuntimeStreamInteractionSearchField[];
}

export interface RuntimeStreamInteractionSearchState {
  readonly query: string;
  readonly matches: readonly RuntimeStreamInteractionSearchMatch[];
  readonly activeMatchIndex: number | null;
  readonly activeEventId: string | null;
}

export interface RuntimeStreamInteractionReadState {
  readonly lastSeenTotalEvents: number;
  readonly unreadCount: number;
}

export interface RuntimeStreamInteractionSnapshot {
  readonly view: RuntimeStreamViewModelSnapshot;
  readonly selectedEventId: string | null;
  readonly search: RuntimeStreamInteractionSearchState;
  readonly read: RuntimeStreamInteractionReadState;
  readonly fullReloadAcknowledged: boolean;
}

export type RuntimeStreamInteractionListener = (
  snapshot: RuntimeStreamInteractionSnapshot,
) => void;

export type RuntimeStreamInteractionErrorHandler = (error: unknown) => void;

export interface RuntimeStreamInteractionViewModel {
  readonly snapshot: () => RuntimeStreamViewModelSnapshot;
  readonly subscribe: (
    listener: (snapshot: RuntimeStreamViewModelSnapshot) => void,
  ) => RuntimeStreamUnsubscribe;
  readonly setExpanded: (
    eventId: string,
    expanded: boolean,
  ) => RuntimeStreamViewModelSnapshot;
  readonly toggleExpanded: (eventId: string) => RuntimeStreamViewModelSnapshot;
}

export interface RuntimeStreamInteraction {
  readonly snapshot: () => RuntimeStreamInteractionSnapshot;
  readonly subscribe: (
    listener: RuntimeStreamInteractionListener,
  ) => RuntimeStreamUnsubscribe;
  readonly selectEvent: (
    eventId: string | null,
  ) => RuntimeStreamInteractionSnapshot;
  readonly selectActiveSearchMatch: () => RuntimeStreamInteractionSnapshot;
  readonly setSearchQuery: (query: string) => RuntimeStreamInteractionSnapshot;
  readonly clearSearch: () => RuntimeStreamInteractionSnapshot;
  readonly nextSearchMatch: () => RuntimeStreamInteractionSnapshot;
  readonly previousSearchMatch: () => RuntimeStreamInteractionSnapshot;
  readonly markAllRead: () => RuntimeStreamInteractionSnapshot;
  readonly acknowledgeFullReload: () => RuntimeStreamInteractionSnapshot;
  readonly setExpanded: (
    eventId: string,
    expanded: boolean,
  ) => RuntimeStreamInteractionSnapshot;
  readonly toggleExpanded: (
    eventId: string,
  ) => RuntimeStreamInteractionSnapshot;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
}

export interface CreateRuntimeStreamInteractionOptions {
  readonly viewModel: RuntimeStreamInteractionViewModel;
  readonly searchQuery?: string;
  readonly selectedEventId?: string | null;
  readonly lastSeenTotalEvents?: number;
  readonly onError?: RuntimeStreamInteractionErrorHandler;
}

const MAX_RUNTIME_STREAM_SEARCH_QUERY_LENGTH = 200;

export function createRuntimeStreamInteraction(
  options: CreateRuntimeStreamInteractionOptions,
): RuntimeStreamInteraction {
  let viewSnapshot = options.viewModel.snapshot();
  let selectedEventId =
    options.selectedEventId === undefined || options.selectedEventId === null
      ? null
      : requireRuntimeStreamInteractionEventId(options.selectedEventId);
  let searchQuery = normalizeRuntimeStreamInteractionSearchQuery(
    options.searchQuery ?? "",
  );
  let activeSearchEventId: string | null = null;
  let lastSeenTotalEvents =
    options.lastSeenTotalEvents === undefined
      ? viewSnapshot.totalEvents
      : requireRuntimeStreamInteractionTotalEvents(
          options.lastSeenTotalEvents,
          "lastSeenTotalEvents",
        );
  let acknowledgedFullReloadKey: string | null = null;
  const listeners = new Set<RuntimeStreamInteractionListener>();
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break interaction-state propagation.
    }
  };

  const reconcileState = (): void => {
    if (
      selectedEventId !== null &&
      findVisibleRuntimeStreamViewEvent(viewSnapshot, selectedEventId) === null
    ) {
      selectedEventId = null;
    }

    if (searchQuery.length === 0) {
      activeSearchEventId = null;
      return;
    }

    const matches = collectRuntimeStreamInteractionSearchMatches(
      viewSnapshot,
      searchQuery,
    );
    if (matches.length === 0) {
      activeSearchEventId = null;
      return;
    }
    if (
      activeSearchEventId === null ||
      !matches.some((match) => match.eventId === activeSearchEventId)
    ) {
      activeSearchEventId = matches[0]?.eventId ?? null;
    }
  };

  const snapshot = (): RuntimeStreamInteractionSnapshot => {
    reconcileState();
    return buildRuntimeStreamInteractionSnapshot({
      viewSnapshot,
      selectedEventId,
      searchQuery,
      activeSearchEventId,
      lastSeenTotalEvents,
      acknowledgedFullReloadKey,
    });
  };

  const publish = (): void => {
    if (disposed) {
      return;
    }
    reconcileState();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot());
      } catch (error) {
        reportError(error);
      }
    }
  };

  if (selectedEventId !== null) {
    requireVisibleRuntimeStreamViewEvent(viewSnapshot, selectedEventId);
  }
  reconcileState();

  const unsubscribeViewModel = options.viewModel.subscribe((nextSnapshot) => {
    viewSnapshot = nextSnapshot;
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
    selectEvent: (eventId) => {
      selectedEventId =
        eventId === null
          ? null
          : requireVisibleRuntimeStreamViewEvent(
              viewSnapshot,
              requireRuntimeStreamInteractionEventId(eventId),
            ).id;
      publish();
      return snapshot();
    },
    selectActiveSearchMatch: () => {
      const currentSnapshot = snapshot();
      selectedEventId = currentSnapshot.search.activeEventId;
      publish();
      return snapshot();
    },
    setSearchQuery: (query) => {
      searchQuery = normalizeRuntimeStreamInteractionSearchQuery(query);
      activeSearchEventId = null;
      reconcileState();
      publish();
      return snapshot();
    },
    clearSearch: () => {
      searchQuery = "";
      activeSearchEventId = null;
      publish();
      return snapshot();
    },
    nextSearchMatch: () => {
      const currentSnapshot = snapshot();
      if (currentSnapshot.search.matches.length > 0) {
        const activeIndex = currentSnapshot.search.activeMatchIndex ?? -1;
        const nextIndex =
          (activeIndex + 1) % currentSnapshot.search.matches.length;
        activeSearchEventId =
          currentSnapshot.search.matches[nextIndex]?.eventId ?? null;
      }
      publish();
      return snapshot();
    },
    previousSearchMatch: () => {
      const currentSnapshot = snapshot();
      if (currentSnapshot.search.matches.length > 0) {
        const activeIndex =
          currentSnapshot.search.activeMatchIndex ??
          currentSnapshot.search.matches.length;
        const previousIndex =
          (activeIndex - 1 + currentSnapshot.search.matches.length) %
          currentSnapshot.search.matches.length;
        activeSearchEventId =
          currentSnapshot.search.matches[previousIndex]?.eventId ?? null;
      }
      publish();
      return snapshot();
    },
    markAllRead: () => {
      lastSeenTotalEvents = viewSnapshot.totalEvents;
      publish();
      return snapshot();
    },
    acknowledgeFullReload: () => {
      acknowledgedFullReloadKey =
        buildRuntimeStreamFullReloadInteractionKey(viewSnapshot);
      publish();
      return snapshot();
    },
    setExpanded: (eventId, expanded) => {
      viewSnapshot = options.viewModel.setExpanded(eventId, expanded);
      return snapshot();
    },
    toggleExpanded: (eventId) => {
      viewSnapshot = options.viewModel.toggleExpanded(eventId);
      return snapshot();
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      listeners.clear();
      unsubscribeViewModel();
      return true;
    },
  };
}

function buildRuntimeStreamInteractionSnapshot(options: {
  readonly viewSnapshot: RuntimeStreamViewModelSnapshot;
  readonly selectedEventId: string | null;
  readonly searchQuery: string;
  readonly activeSearchEventId: string | null;
  readonly lastSeenTotalEvents: number;
  readonly acknowledgedFullReloadKey: string | null;
}): RuntimeStreamInteractionSnapshot {
  const search = buildRuntimeStreamInteractionSearchState(
    options.viewSnapshot,
    options.searchQuery,
    options.activeSearchEventId,
  );
  const fullReloadKey = buildRuntimeStreamFullReloadInteractionKey(
    options.viewSnapshot,
  );
  return {
    view: cloneRuntimeStreamViewModelSnapshot(options.viewSnapshot),
    selectedEventId: options.selectedEventId,
    search,
    read: {
      lastSeenTotalEvents: options.lastSeenTotalEvents,
      unreadCount: Math.max(
        0,
        options.viewSnapshot.totalEvents - options.lastSeenTotalEvents,
      ),
    },
    fullReloadAcknowledged:
      fullReloadKey !== null &&
      fullReloadKey === options.acknowledgedFullReloadKey,
  };
}

function buildRuntimeStreamInteractionSearchState(
  viewSnapshot: RuntimeStreamViewModelSnapshot,
  query: string,
  activeSearchEventId: string | null,
): RuntimeStreamInteractionSearchState {
  const matches = collectRuntimeStreamInteractionSearchMatches(
    viewSnapshot,
    query,
  );
  const activeMatchIndex =
    activeSearchEventId === null
      ? null
      : matches.findIndex((match) => match.eventId === activeSearchEventId);
  const normalizedActiveMatchIndex =
    activeMatchIndex === null || activeMatchIndex < 0 ? null : activeMatchIndex;
  return {
    query,
    matches,
    activeMatchIndex: normalizedActiveMatchIndex,
    activeEventId:
      normalizedActiveMatchIndex === null
        ? null
        : (matches[normalizedActiveMatchIndex]?.eventId ?? null),
  };
}

function collectRuntimeStreamInteractionSearchMatches(
  viewSnapshot: RuntimeStreamViewModelSnapshot,
  query: string,
): RuntimeStreamInteractionSearchMatch[] {
  if (query.length === 0) {
    return [];
  }
  const normalizedQuery = query.toLocaleLowerCase();
  return flattenRuntimeStreamViewEvents(viewSnapshot).flatMap((event) => {
    if (event.id === null) {
      return [];
    }
    const fields = collectRuntimeStreamInteractionSearchFields(
      event,
      normalizedQuery,
    );
    return fields.length === 0 ? [] : [{ eventId: event.id, fields }];
  });
}

function collectRuntimeStreamInteractionSearchFields(
  event: RuntimeStreamViewEvent,
  normalizedQuery: string,
): RuntimeStreamInteractionSearchField[] {
  const fields: RuntimeStreamInteractionSearchField[] = [];
  const candidates: ReadonlyArray<{
    readonly field: RuntimeStreamInteractionSearchField;
    readonly value: string | null;
  }> = [
    { field: "id", value: event.id },
    { field: "type", value: event.type },
    { field: "category", value: event.category },
    { field: "title", value: event.title },
    { field: "summary", value: event.summary },
    { field: "content", value: event.content },
  ];
  for (const candidate of candidates) {
    if (
      candidate.value !== null &&
      candidate.value.toLocaleLowerCase().includes(normalizedQuery)
    ) {
      fields.push(candidate.field);
    }
  }
  return fields;
}

function flattenRuntimeStreamViewEvents(
  viewSnapshot: RuntimeStreamViewModelSnapshot,
): RuntimeStreamViewEvent[] {
  const events: RuntimeStreamViewEvent[] = [];
  const visit = (event: RuntimeStreamViewEvent): void => {
    events.push(event);
    for (const child of event.children) {
      visit(child);
    }
  };
  for (const event of viewSnapshot.summaryItems) {
    visit(event);
  }
  for (const event of viewSnapshot.timelineItems) {
    visit(event);
  }
  return events;
}

function findVisibleRuntimeStreamViewEvent(
  viewSnapshot: RuntimeStreamViewModelSnapshot,
  eventId: string,
): RuntimeStreamViewEvent | null {
  return (
    flattenRuntimeStreamViewEvents(viewSnapshot).find(
      (event) => event.id === eventId,
    ) ?? null
  );
}

function requireVisibleRuntimeStreamViewEvent(
  viewSnapshot: RuntimeStreamViewModelSnapshot,
  eventId: string,
): RuntimeStreamViewEvent & { readonly id: string } {
  const event = findVisibleRuntimeStreamViewEvent(viewSnapshot, eventId);
  if (event === null || event.id === null) {
    throw new Error(
      `Runtime stream interaction event is not visible: ${eventId}`,
    );
  }
  return event as RuntimeStreamViewEvent & { readonly id: string };
}

function normalizeRuntimeStreamInteractionSearchQuery(query: string): string {
  if (/[\u0000-\u001f\u007f]/u.test(query)) {
    throw new Error(
      "Runtime stream interaction search query must contain no control characters",
    );
  }
  const normalizedQuery = query.trim();
  if (normalizedQuery.length > MAX_RUNTIME_STREAM_SEARCH_QUERY_LENGTH) {
    throw new Error(
      `Runtime stream interaction search query must be at most ${MAX_RUNTIME_STREAM_SEARCH_QUERY_LENGTH} characters`,
    );
  }
  return normalizedQuery;
}

function requireRuntimeStreamInteractionEventId(eventId: string): string {
  if (eventId.length === 0 || /[\u0000-\u001f\u007f\s]/u.test(eventId)) {
    throw new Error(
      "Runtime stream interaction event id must be non-empty and contain no whitespace or control characters",
    );
  }
  return eventId;
}

function requireRuntimeStreamInteractionTotalEvents(
  value: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Runtime stream interaction ${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

function buildRuntimeStreamFullReloadInteractionKey(
  viewSnapshot: RuntimeStreamViewModelSnapshot,
): string | null {
  if (!viewSnapshot.fullReloadRequired) {
    return null;
  }
  const decision = viewSnapshot.fullReloadDecision;
  if (decision === null) {
    return "full_reload_required";
  }
  return JSON.stringify([
    decision.lastEventId,
    decision.reason,
    decision.status ?? null,
    decision.errorCode ?? null,
  ]);
}

function cloneRuntimeStreamViewModelSnapshot(
  snapshot: RuntimeStreamViewModelSnapshot,
): RuntimeStreamViewModelSnapshot {
  return structuredClone(snapshot) as RuntimeStreamViewModelSnapshot;
}
