import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeStreamChannel } from "./runtime-stream-client.js";
import type { RuntimeLifecyclePanelSessionController } from "./runtime-lifecycle-panel-session.js";
import type { RuntimeStreamInteractionSessionController } from "./runtime-stream-session.js";
import {
  createRuntimeWorkbenchInteraction,
  type RuntimeWorkbenchInteraction,
  type RuntimeWorkbenchInteractionCommand,
  type RuntimeWorkbenchInteractionCommandId,
  type RuntimeWorkbenchInteractionErrorHandler,
} from "./runtime-workbench-interaction.js";
import {
  createRuntimeWorkbenchShortcutController,
  type RuntimeWorkbenchShortcutController,
  type RuntimeWorkbenchShortcutControllerSnapshot,
  type RuntimeWorkbenchShortcutId,
  type RuntimeWorkbenchShortcutKeyEvent,
  type RuntimeWorkbenchShortcutResolution,
} from "./runtime-workbench-shortcuts.js";
import {
  createRuntimeWorkbenchSession,
  type RuntimeWorkbenchPanelId,
  type RuntimeWorkbenchSession,
} from "./runtime-workbench-session.js";

export interface RuntimeWorkbenchHostLifecyclePanelSnapshot {
  readonly active: boolean;
  readonly disposed: boolean;
}

export interface RuntimeWorkbenchHostRuntimeStreamSnapshot {
  readonly active: boolean;
  readonly activeChannel: RuntimeStreamChannel | null;
  readonly disposed: boolean;
}

export interface RuntimeWorkbenchHostSessionSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly lifecyclePanel: RuntimeWorkbenchHostLifecyclePanelSnapshot;
  readonly runtimeStream: RuntimeWorkbenchHostRuntimeStreamSnapshot;
  readonly availableCommandIds: readonly RuntimeWorkbenchInteractionCommandId[];
  readonly enabledCommandIds: readonly RuntimeWorkbenchInteractionCommandId[];
  readonly availableShortcutIds: readonly RuntimeWorkbenchShortcutId[];
  readonly enabledShortcutIds: readonly RuntimeWorkbenchShortcutId[];
  readonly lastHandledShortcutId: RuntimeWorkbenchShortcutId | null;
  readonly disposed: boolean;
}

export type RuntimeWorkbenchHostSessionListener = () => void;

export type RuntimeWorkbenchHostSessionErrorHandler =
  RuntimeWorkbenchInteractionErrorHandler;

export interface RuntimeWorkbenchHostSession {
  readonly activePanel: () => RuntimeWorkbenchPanelId;
  readonly getSnapshot: () => RuntimeWorkbenchHostSessionSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchHostSessionSnapshot;
  readonly snapshot: () => RuntimeWorkbenchHostSessionSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchHostSessionListener,
  ) => RuntimeStatusUnsubscribe;
  readonly dispatch: (
    command: RuntimeWorkbenchInteractionCommand,
  ) => Promise<RuntimeWorkbenchHostSessionSnapshot>;
  readonly setActivePanel: (
    panel: RuntimeWorkbenchPanelId,
  ) => RuntimeWorkbenchHostSessionSnapshot;
  readonly resolveKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => RuntimeWorkbenchShortcutResolution | null;
  readonly handleKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => Promise<RuntimeWorkbenchHostSessionSnapshot>;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeWorkbenchHostSessionOptions {
  readonly lifecyclePanelController: RuntimeLifecyclePanelSessionController;
  readonly runtimeStreamController: RuntimeStreamInteractionSessionController;
  readonly activePanel?: RuntimeWorkbenchPanelId;
  readonly onError?: RuntimeWorkbenchHostSessionErrorHandler;
}

export function createRuntimeWorkbenchHostSession(
  options: CreateRuntimeWorkbenchHostSessionOptions,
): RuntimeWorkbenchHostSession {
  const errorHandlerOption =
    options.onError !== undefined ? { onError: options.onError } : {};
  const workbench = createRuntimeWorkbenchSession({
    lifecyclePanelController: options.lifecyclePanelController,
    runtimeStreamController: options.runtimeStreamController,
    ...(options.activePanel !== undefined
      ? { activePanel: options.activePanel }
      : {}),
    ...errorHandlerOption,
  });
  const interaction = createRuntimeWorkbenchInteraction({
    workbench,
    ...errorHandlerOption,
  });
  const shortcuts = createRuntimeWorkbenchShortcutController({
    interaction,
    ...errorHandlerOption,
  });
  return createRuntimeWorkbenchHostSessionFromParts({
    workbench,
    interaction,
    shortcuts,
    ...errorHandlerOption,
  });
}

interface RuntimeWorkbenchHostSessionParts {
  readonly workbench: RuntimeWorkbenchSession;
  readonly interaction: RuntimeWorkbenchInteraction;
  readonly shortcuts: RuntimeWorkbenchShortcutController;
  readonly onError?: RuntimeWorkbenchHostSessionErrorHandler;
}

function createRuntimeWorkbenchHostSessionFromParts(
  parts: RuntimeWorkbenchHostSessionParts,
): RuntimeWorkbenchHostSession {
  const listeners = new Set<RuntimeWorkbenchHostSessionListener>();
  let shortcutsUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let suppressShortcutPublish = false;
  let disposed = false;

  const initialSnapshot = freezeRuntimeWorkbenchHostSessionSnapshot(
    buildRuntimeWorkbenchHostSessionSnapshot(
      parts.shortcuts.getSnapshot(),
      disposed,
    ),
  );
  let currentSignature =
    runtimeWorkbenchHostSessionSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      parts.onError?.(error);
    } catch {
      // Renderer diagnostics must not break host-session propagation.
    }
  };

  const isDisposed = (): boolean =>
    disposed ||
    parts.shortcuts.isDisposed() ||
    parts.interaction.isDisposed() ||
    parts.workbench.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime workbench host session is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeWorkbenchHostSessionSnapshot => {
    const nextSnapshot = freezeRuntimeWorkbenchHostSessionSnapshot(
      buildRuntimeWorkbenchHostSessionSnapshot(
        parts.shortcuts.getSnapshot(),
        isDisposed(),
      ),
    );
    const nextSignature =
      runtimeWorkbenchHostSessionSnapshotSignature(nextSnapshot);
    if (forceRefresh || nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = nextSnapshot;
    }
    return currentSnapshot;
  };

  const publishIfChanged = (forceRefresh = false): void => {
    if (disposed && !forceRefresh) {
      return;
    }
    const previousSignature = currentSignature;
    captureSnapshot(forceRefresh);
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

  const ensureShortcutSubscription = (): void => {
    if (
      listeners.size === 0 ||
      shortcutsUnsubscribe !== undefined ||
      isDisposed()
    ) {
      return;
    }
    shortcutsUnsubscribe = parts.shortcuts.subscribe(() => {
      if (suppressShortcutPublish) {
        return;
      }
      publishIfChanged();
    });
  };

  const releaseShortcutSubscription = (): void => {
    shortcutsUnsubscribe?.();
    shortcutsUnsubscribe = undefined;
  };

  const runWithSuppressedShortcutPublish = async (
    action: () => Promise<unknown>,
  ): Promise<RuntimeWorkbenchHostSessionSnapshot> => {
    suppressShortcutPublish = true;
    try {
      await action();
    } finally {
      suppressShortcutPublish = false;
    }
    publishIfChanged();
    return captureSnapshot();
  };

  return {
    activePanel: () => captureSnapshot().activePanel,
    getSnapshot: () => captureSnapshot(),
    getServerSnapshot: () => captureSnapshot(),
    snapshot: () => captureSnapshot(),
    subscribe: (listener) => {
      if (isDisposed()) {
        return () => false;
      }
      listeners.add(listener);
      ensureShortcutSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseShortcutSubscription();
        }
        return deleted;
      };
    },
    dispatch: async (command) => {
      assertActive();
      return runWithSuppressedShortcutPublish(async () => {
        await parts.interaction.dispatch(command);
      });
    },
    setActivePanel: (panel) => {
      assertActive();
      suppressShortcutPublish = true;
      try {
        parts.interaction.setActivePanel(panel);
      } finally {
        suppressShortcutPublish = false;
      }
      publishIfChanged();
      return captureSnapshot();
    },
    resolveKeyEvent: (event) => {
      if (isDisposed()) {
        return null;
      }
      return parts.shortcuts.resolveKeyEvent(event);
    },
    handleKeyEvent: async (event) => {
      assertActive();
      return runWithSuppressedShortcutPublish(async () => {
        await parts.shortcuts.handleKeyEvent(event);
      });
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseShortcutSubscription();
      parts.shortcuts.dispose();
      parts.interaction.dispose();
      parts.workbench.dispose();
      publishIfChanged(true);
      listeners.clear();
      return true;
    },
    isDisposed,
  };
}

export function buildRuntimeWorkbenchHostSessionSnapshot(
  shortcuts: RuntimeWorkbenchShortcutControllerSnapshot,
  disposed = shortcuts.disposed,
): RuntimeWorkbenchHostSessionSnapshot {
  const interaction = shortcuts.workbench;
  const workbench = interaction.workbench;
  const activeChannel = workbench.runtimeStream.activeChannel;
  return {
    activePanel: interaction.activePanel,
    lifecyclePanel: Object.freeze({
      active: workbench.lifecyclePanel.activeSession !== null,
      disposed: workbench.lifecyclePanel.disposed,
    }),
    runtimeStream: Object.freeze({
      active: workbench.runtimeStream.activeSession !== null,
      activeChannel:
        activeChannel === null
          ? null
          : cloneRuntimeStreamChannel(activeChannel),
      disposed: workbench.runtimeStream.disposed,
    }),
    availableCommandIds: Object.freeze([...interaction.availableCommandIds]),
    enabledCommandIds: Object.freeze(
      disposed ? [] : [...interaction.enabledCommandIds],
    ),
    availableShortcutIds: Object.freeze([...shortcuts.availableShortcutIds]),
    enabledShortcutIds: Object.freeze(
      disposed ? [] : [...shortcuts.enabledShortcutIds],
    ),
    lastHandledShortcutId: shortcuts.lastHandledShortcutId,
    disposed,
  };
}

function freezeRuntimeWorkbenchHostSessionSnapshot(
  snapshot: RuntimeWorkbenchHostSessionSnapshot,
): RuntimeWorkbenchHostSessionSnapshot {
  return Object.freeze({ ...snapshot });
}

function runtimeWorkbenchHostSessionSnapshotSignature(
  snapshot: RuntimeWorkbenchHostSessionSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function cloneRuntimeStreamChannel(
  channel: RuntimeStreamChannel,
): RuntimeStreamChannel {
  return channel.kind === "planning"
    ? { kind: "planning", sessionId: channel.sessionId }
    : { kind: "run", runId: channel.runId };
}
