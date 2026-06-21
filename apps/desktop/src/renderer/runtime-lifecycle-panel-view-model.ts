import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  BindRuntimeLifecycleStatusPageLifecycleOptions,
  RuntimeLifecycleStatusPageLifecycleTarget,
} from "./runtime-lifecycle-status-controller.js";
import type {
  RuntimeLifecyclePanelHookAdapter,
  RuntimeLifecyclePanelHookAdapterErrorHandler,
} from "./runtime-lifecycle-panel-hook-adapter.js";
import type {
  RuntimeLifecyclePanelCommandId,
  RuntimeLifecyclePanelSnapshot,
  RuntimeLifecyclePanelTimelineItem,
} from "./runtime-lifecycle-panel-presenter.js";

export type RuntimeLifecyclePanelTimelineFilter =
  | "all"
  | "startup"
  | "shutdown"
  | "action_required"
  | "retryable"
  | "error";

export interface RuntimeLifecyclePanelTimelineFilterOption {
  readonly id: RuntimeLifecyclePanelTimelineFilter;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
}

export interface RuntimeLifecyclePanelViewModelSnapshot {
  readonly panel: RuntimeLifecyclePanelSnapshot;
  readonly disposed: boolean;
  readonly timelineFilter: RuntimeLifecyclePanelTimelineFilter;
  readonly timelineFilterOptions: readonly RuntimeLifecyclePanelTimelineFilterOption[];
  readonly visibleTimelineItems: readonly RuntimeLifecyclePanelTimelineItem[];
  readonly selectedTimelineItemId: string | null;
  readonly selectedTimelineItem: RuntimeLifecyclePanelTimelineItem | null;
  readonly totalTimelineItems: number;
  readonly visibleTimelineItemCount: number;
  readonly hiddenTimelineItemCount: number;
}

export type RuntimeLifecyclePanelViewModelListener = (
  snapshot: RuntimeLifecyclePanelViewModelSnapshot,
) => void;

export type RuntimeLifecyclePanelViewModelErrorHandler =
  RuntimeLifecyclePanelHookAdapterErrorHandler;

export interface RuntimeLifecyclePanelViewModel {
  readonly snapshot: () => RuntimeLifecyclePanelViewModelSnapshot;
  readonly subscribe: (
    listener: RuntimeLifecyclePanelViewModelListener,
  ) => RuntimeStatusUnsubscribe;
  readonly setTimelineFilter: (
    filter: RuntimeLifecyclePanelTimelineFilter,
  ) => RuntimeLifecyclePanelViewModelSnapshot;
  readonly selectTimelineItem: (
    itemId: string,
  ) => RuntimeLifecyclePanelViewModelSnapshot;
  readonly clearSelection: () => RuntimeLifecyclePanelViewModelSnapshot;
  readonly invoke: (
    commandId: RuntimeLifecyclePanelCommandId,
  ) => Promise<RuntimeLifecyclePanelViewModelSnapshot>;
  readonly bindPageLifecycle: (
    target: RuntimeLifecycleStatusPageLifecycleTarget,
    options?: BindRuntimeLifecycleStatusPageLifecycleOptions,
  ) => RuntimeStatusUnsubscribe;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeLifecyclePanelViewModelOptions {
  readonly adapter: RuntimeLifecyclePanelHookAdapter;
  readonly timelineFilter?: RuntimeLifecyclePanelTimelineFilter;
  readonly selectedTimelineItemId?: string;
  readonly onError?: RuntimeLifecyclePanelViewModelErrorHandler;
}

interface RuntimeLifecyclePanelViewModelState {
  readonly timelineFilter: RuntimeLifecyclePanelTimelineFilter;
  readonly selectedTimelineItemId: string | null;
}

export function createRuntimeLifecyclePanelViewModel(
  options: CreateRuntimeLifecyclePanelViewModelOptions,
): RuntimeLifecyclePanelViewModel {
  let timelineFilter = requireRuntimeLifecyclePanelTimelineFilter(
    options.timelineFilter ?? "all",
  );
  let selectedTimelineItemId =
    options.selectedTimelineItemId === undefined
      ? null
      : requireRuntimeLifecyclePanelTimelineItemId(
          options.selectedTimelineItemId,
        );
  const listeners = new Set<RuntimeLifecyclePanelViewModelListener>();
  let adapterUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break lifecycle panel view propagation.
    }
  };

  const isDisposed = (): boolean => disposed || options.adapter.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime lifecycle panel view model is disposed");
    }
  };

  const snapshot = (): RuntimeLifecyclePanelViewModelSnapshot => {
    const adapterSnapshot = options.adapter.getSnapshot();
    const candidateSnapshot = buildRuntimeLifecyclePanelViewModelSnapshot(
      adapterSnapshot.panel,
      {
        timelineFilter,
        selectedTimelineItemId,
      },
      adapterSnapshot.disposed || isDisposed(),
    );
    selectedTimelineItemId = candidateSnapshot.selectedTimelineItemId;
    return candidateSnapshot;
  };

  const publish = (): void => {
    if (isDisposed()) {
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

  const ensureAdapterSubscription = (): void => {
    if (adapterUnsubscribe !== undefined) {
      return;
    }
    adapterUnsubscribe = options.adapter.subscribe(() => {
      publish();
    });
  };

  const releaseAdapterSubscription = (): void => {
    adapterUnsubscribe?.();
    adapterUnsubscribe = undefined;
  };

  return {
    snapshot,
    subscribe: (listener) => {
      if (isDisposed()) {
        return () => false;
      }
      listeners.add(listener);
      ensureAdapterSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseAdapterSubscription();
        }
        return deleted;
      };
    },
    setTimelineFilter: (filter) => {
      assertActive();
      timelineFilter = requireRuntimeLifecyclePanelTimelineFilter(filter);
      const nextSnapshot = snapshot();
      publish();
      return nextSnapshot;
    },
    selectTimelineItem: (itemId) => {
      assertActive();
      const safeItemId = requireRuntimeLifecyclePanelTimelineItemId(itemId);
      const currentSnapshot = snapshot();
      const selectedItem = currentSnapshot.visibleTimelineItems.find(
        (item) => item.id === safeItemId,
      );
      if (selectedItem === undefined) {
        throw new Error("Runtime lifecycle panel timeline item is not visible");
      }
      selectedTimelineItemId = safeItemId;
      const nextSnapshot = snapshot();
      publish();
      return nextSnapshot;
    },
    clearSelection: () => {
      assertActive();
      selectedTimelineItemId = null;
      const nextSnapshot = snapshot();
      publish();
      return nextSnapshot;
    },
    invoke: async (commandId) => {
      assertActive();
      await options.adapter.invoke(commandId);
      return snapshot();
    },
    bindPageLifecycle: (target, bindOptions) => {
      assertActive();
      return options.adapter.bindPageLifecycle(target, bindOptions);
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseAdapterSubscription();
      listeners.clear();
      options.adapter.dispose();
      selectedTimelineItemId = null;
      return true;
    },
    isDisposed,
  };
}

export function buildRuntimeLifecyclePanelViewModelSnapshot(
  panel: RuntimeLifecyclePanelSnapshot,
  state: RuntimeLifecyclePanelViewModelState,
  disposed = panel.disposed,
): RuntimeLifecyclePanelViewModelSnapshot {
  const timelineFilter = requireRuntimeLifecyclePanelTimelineFilter(
    state.timelineFilter,
  );
  const visibleTimelineItems = panel.timelineItems.filter((item) =>
    matchesTimelineFilter(item, timelineFilter),
  );
  const selectedTimelineItem =
    state.selectedTimelineItemId === null
      ? null
      : (visibleTimelineItems.find(
          (item) => item.id === state.selectedTimelineItemId,
        ) ?? null);
  const selectedTimelineItemId = selectedTimelineItem?.id ?? null;

  return freezeRuntimeLifecyclePanelViewModelSnapshot({
    panel,
    disposed,
    timelineFilter,
    timelineFilterOptions: buildTimelineFilterOptions(
      panel.timelineItems,
      timelineFilter,
    ),
    visibleTimelineItems,
    selectedTimelineItemId,
    selectedTimelineItem,
    totalTimelineItems: panel.timelineItems.length,
    visibleTimelineItemCount: visibleTimelineItems.length,
    hiddenTimelineItemCount:
      panel.timelineItems.length - visibleTimelineItems.length,
  });
}

function requireRuntimeLifecyclePanelTimelineFilter(
  filter: string,
): RuntimeLifecyclePanelTimelineFilter {
  switch (filter) {
    case "all":
    case "startup":
    case "shutdown":
    case "action_required":
    case "retryable":
    case "error":
      return filter;
    default:
      throw new Error("Invalid runtime lifecycle panel timeline filter");
  }
}

function requireRuntimeLifecyclePanelTimelineItemId(itemId: string): string {
  if (
    itemId.length === 0 ||
    itemId.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/u.test(itemId)
  ) {
    throw new Error("Invalid runtime lifecycle panel timeline item id");
  }
  return itemId;
}

function buildTimelineFilterOptions(
  items: readonly RuntimeLifecyclePanelTimelineItem[],
  activeFilter: RuntimeLifecyclePanelTimelineFilter,
): RuntimeLifecyclePanelTimelineFilterOption[] {
  return [
    filterOption("all", "All", items, activeFilter),
    filterOption("startup", "Startup", items, activeFilter),
    filterOption("shutdown", "Shutdown", items, activeFilter),
    filterOption("action_required", "Action required", items, activeFilter),
    filterOption("retryable", "Retryable", items, activeFilter),
    filterOption("error", "Errors", items, activeFilter),
  ];
}

function filterOption(
  filter: RuntimeLifecyclePanelTimelineFilter,
  label: string,
  items: readonly RuntimeLifecyclePanelTimelineItem[],
  activeFilter: RuntimeLifecyclePanelTimelineFilter,
): RuntimeLifecyclePanelTimelineFilterOption {
  return {
    id: filter,
    label,
    count: items.filter((item) => matchesTimelineFilter(item, filter)).length,
    active: filter === activeFilter,
  };
}

function matchesTimelineFilter(
  item: RuntimeLifecyclePanelTimelineItem,
  filter: RuntimeLifecyclePanelTimelineFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "startup":
      return item.source === "startup";
    case "shutdown":
      return item.source === "shutdown";
    case "action_required":
      return item.badges.includes("action_required");
    case "retryable":
      return item.badges.includes("retryable");
    case "error":
      return item.tone === "error";
  }
}

function freezeRuntimeLifecyclePanelViewModelSnapshot(
  snapshot: RuntimeLifecyclePanelViewModelSnapshot,
): RuntimeLifecyclePanelViewModelSnapshot {
  return Object.freeze({
    ...snapshot,
    timelineFilterOptions: Object.freeze(
      snapshot.timelineFilterOptions.map((option) =>
        Object.freeze({ ...option }),
      ),
    ),
    visibleTimelineItems: Object.freeze(
      snapshot.visibleTimelineItems.map(cloneTimelineItem),
    ),
    selectedTimelineItem:
      snapshot.selectedTimelineItem === null
        ? null
        : cloneTimelineItem(snapshot.selectedTimelineItem),
  });
}

function cloneTimelineItem(
  item: RuntimeLifecyclePanelTimelineItem,
): RuntimeLifecyclePanelTimelineItem {
  return Object.freeze({
    ...item,
    badges: Object.freeze([...item.badges]),
  });
}
