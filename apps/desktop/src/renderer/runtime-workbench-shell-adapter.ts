import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeWorkbenchPanelId } from "./runtime-workbench-session.js";
import type { RuntimeWorkbenchInteractionCommand } from "./runtime-workbench-interaction.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import type {
  RuntimeWorkbenchShellAction,
  RuntimeWorkbenchShellChromeSnapshot,
  RuntimeWorkbenchShellEmptyState,
  RuntimeWorkbenchShellPanelTab,
  RuntimeWorkbenchShellPresenter,
  RuntimeWorkbenchShellPresenterErrorHandler,
  RuntimeWorkbenchShellShortcutHint,
  RuntimeWorkbenchShellSnapshot,
  RuntimeWorkbenchShellStatusItem,
} from "./runtime-workbench-shell-presenter.js";

export type RuntimeWorkbenchShellAdapterStoreChangeListener = () => void;

export type RuntimeWorkbenchShellAdapterErrorHandler =
  RuntimeWorkbenchShellPresenterErrorHandler;

export interface RuntimeWorkbenchShellAdapter {
  readonly getSnapshot: () => RuntimeWorkbenchShellSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchShellSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchShellAdapterStoreChangeListener,
  ) => RuntimeStatusUnsubscribe;
  readonly dispatch: (
    command: RuntimeWorkbenchInteractionCommand,
  ) => Promise<RuntimeWorkbenchShellSnapshot>;
  readonly setActivePanel: (
    panel: RuntimeWorkbenchPanelId,
  ) => RuntimeWorkbenchShellSnapshot;
  readonly resolveKeyEvent: RuntimeWorkbenchShellPresenter["resolveKeyEvent"];
  readonly handleKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => Promise<RuntimeWorkbenchShellSnapshot>;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface RuntimeWorkbenchShellAdapterFactory {
  readonly createAdapter: (
    options?: CreateRuntimeWorkbenchShellAdapterFactoryAdapterOptions,
  ) => RuntimeWorkbenchShellAdapter;
}

export interface CreateRuntimeWorkbenchShellAdapterOptions {
  readonly presenter: RuntimeWorkbenchShellPresenter;
  readonly onError?: RuntimeWorkbenchShellAdapterErrorHandler;
}

export interface CreateRuntimeWorkbenchShellAdapterFactoryOptions {
  readonly createPresenter: (
    options?: CreateRuntimeWorkbenchShellAdapterFactoryPresenterOptions,
  ) => RuntimeWorkbenchShellPresenter;
  readonly onError?: RuntimeWorkbenchShellAdapterErrorHandler;
}

export interface CreateRuntimeWorkbenchShellAdapterFactoryPresenterOptions {
  readonly onError?: RuntimeWorkbenchShellAdapterErrorHandler;
}

export interface CreateRuntimeWorkbenchShellAdapterFactoryAdapterOptions extends CreateRuntimeWorkbenchShellAdapterFactoryPresenterOptions {}

export function createRuntimeWorkbenchShellAdapter(
  options: CreateRuntimeWorkbenchShellAdapterOptions,
): RuntimeWorkbenchShellAdapter {
  const listeners = new Set<RuntimeWorkbenchShellAdapterStoreChangeListener>();
  let presenterUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const initialSnapshot = options.presenter.getSnapshot();
  let currentSignature = snapshotSignature(initialSnapshot);
  let currentSnapshot =
    freezeRuntimeWorkbenchShellAdapterSnapshot(initialSnapshot);

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break shell adapter notifications.
    }
  };

  const isDisposed = (): boolean => disposed || options.presenter.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime workbench shell adapter is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeWorkbenchShellSnapshot => {
    const nextSnapshot = freezeRuntimeWorkbenchShellAdapterSnapshot(
      options.presenter.getSnapshot(),
    );
    const nextSignature = snapshotSignature(nextSnapshot);
    if (forceRefresh || nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = nextSnapshot;
    }
    return currentSnapshot;
  };

  const notify = (forceRefresh = false): void => {
    if (disposed && !forceRefresh) {
      return;
    }
    const previousSignature = currentSignature;
    captureSnapshot(forceRefresh || isDisposed());
    if (!forceRefresh && currentSignature === previousSignature) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensurePresenterSubscription = (): void => {
    if (
      listeners.size === 0 ||
      presenterUnsubscribe !== undefined ||
      isDisposed()
    ) {
      return;
    }
    presenterUnsubscribe = options.presenter.subscribe(() => {
      notify();
    });
  };

  const releasePresenterSubscription = (): void => {
    presenterUnsubscribe?.();
    presenterUnsubscribe = undefined;
  };

  return {
    getSnapshot: () => captureSnapshot(),
    getServerSnapshot: () => captureSnapshot(),
    subscribe: (listener) => {
      if (isDisposed()) {
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
    dispatch: async (command) => {
      assertActive();
      await options.presenter.dispatch(command);
      return captureSnapshot();
    },
    setActivePanel: (panel) => {
      assertActive();
      options.presenter.setActivePanel(panel);
      return captureSnapshot();
    },
    resolveKeyEvent: (event) => {
      if (isDisposed()) {
        return null;
      }
      return options.presenter.resolveKeyEvent(event);
    },
    handleKeyEvent: async (event) => {
      assertActive();
      await options.presenter.handleKeyEvent(event);
      return captureSnapshot();
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      options.presenter.dispose();
      notify(true);
      releasePresenterSubscription();
      listeners.clear();
      return true;
    },
    isDisposed,
  };
}

export function createRuntimeWorkbenchShellAdapterFactory(
  options: CreateRuntimeWorkbenchShellAdapterFactoryOptions,
): RuntimeWorkbenchShellAdapterFactory {
  return {
    createAdapter: (adapterOptions) => {
      const onError = adapterOptions?.onError ?? options.onError;
      const presenter = options.createPresenter(
        onError !== undefined ? { onError } : undefined,
      );
      return createRuntimeWorkbenchShellAdapter({
        presenter,
        ...(onError !== undefined ? { onError } : {}),
      });
    },
  };
}

function snapshotSignature(snapshot: RuntimeWorkbenchShellSnapshot): string {
  return JSON.stringify(snapshot);
}

function freezeRuntimeWorkbenchShellAdapterSnapshot(
  snapshot: RuntimeWorkbenchShellSnapshot,
): RuntimeWorkbenchShellSnapshot {
  return Object.freeze({
    ...snapshot,
    panels: Object.freeze(snapshot.panels.map(freezePanelTab)),
    actions: Object.freeze(snapshot.actions.map(freezeAction)),
    shortcutHints: Object.freeze(
      snapshot.shortcutHints.map(freezeShortcutHint),
    ),
    statusItems: Object.freeze(snapshot.statusItems.map(freezeStatusItem)),
    chrome: freezeChrome(snapshot.chrome),
    availableActionIds: Object.freeze([...snapshot.availableActionIds]),
    enabledActionIds: Object.freeze([...snapshot.enabledActionIds]),
    emptyState:
      snapshot.emptyState === null
        ? null
        : freezeEmptyState(snapshot.emptyState),
  });
}

function freezePanelTab(
  panel: RuntimeWorkbenchShellPanelTab,
): RuntimeWorkbenchShellPanelTab {
  return Object.freeze({ ...panel });
}

function freezeAction(
  action: RuntimeWorkbenchShellAction,
): RuntimeWorkbenchShellAction {
  return Object.freeze({
    ...action,
    shortcutIds: Object.freeze([...action.shortcutIds]),
  });
}

function freezeShortcutHint(
  shortcut: RuntimeWorkbenchShellShortcutHint,
): RuntimeWorkbenchShellShortcutHint {
  return Object.freeze({
    ...shortcut,
    keys: Object.freeze([...shortcut.keys]),
  });
}

function freezeStatusItem(
  item: RuntimeWorkbenchShellStatusItem,
): RuntimeWorkbenchShellStatusItem {
  return Object.freeze({ ...item });
}

function freezeChrome(
  chrome: RuntimeWorkbenchShellChromeSnapshot,
): RuntimeWorkbenchShellChromeSnapshot {
  return Object.freeze({
    dockItems: Object.freeze(
      chrome.dockItems.map((item) =>
        Object.freeze({
          ...item,
        }),
      ),
    ),
    fileTree: Object.freeze({
      title: chrome.fileTree.title,
      summary: chrome.fileTree.summary,
      nodes: Object.freeze(
        chrome.fileTree.nodes.map((node) =>
          Object.freeze({
            id: node.id,
            label: node.label,
            pathLabel: node.pathLabel,
            statusLabel: node.statusLabel,
            depth: node.depth,
            active: node.active,
            tone: node.tone,
          }),
        ),
      ),
    }),
    versionSnapshots: Object.freeze({
      title: chrome.versionSnapshots.title,
      summary: chrome.versionSnapshots.summary,
      items: Object.freeze(
        chrome.versionSnapshots.items.map((item) =>
          Object.freeze({
            id: item.id,
            label: item.label,
            value: item.value,
            statusLabel: item.statusLabel,
            active: item.active,
            tone: item.tone,
          }),
        ),
      ),
    }),
    taskDrawer: Object.freeze({
      title: chrome.taskDrawer.title,
      summary: chrome.taskDrawer.summary,
      collapsedSummary: chrome.taskDrawer.collapsedSummary,
      collapsible: chrome.taskDrawer.collapsible,
      defaultCollapsed: chrome.taskDrawer.defaultCollapsed,
      expandLabel: chrome.taskDrawer.expandLabel,
      collapseLabel: chrome.taskDrawer.collapseLabel,
      items: Object.freeze(
        chrome.taskDrawer.items.map((item) => Object.freeze({ ...item })),
      ),
    }),
    chatBox: Object.freeze({
      title: chrome.chatBox.title,
      placeholder: chrome.chatBox.placeholder,
      enabled: chrome.chatBox.enabled,
      statusLabel: chrome.chatBox.statusLabel,
      collapsedSummary: chrome.chatBox.collapsedSummary,
      collapsible: chrome.chatBox.collapsible,
      defaultCollapsed: chrome.chatBox.defaultCollapsed,
      expandLabel: chrome.chatBox.expandLabel,
      collapseLabel: chrome.chatBox.collapseLabel,
    }),
  });
}

function freezeEmptyState(
  emptyState: RuntimeWorkbenchShellEmptyState,
): RuntimeWorkbenchShellEmptyState {
  return Object.freeze({ ...emptyState });
}
