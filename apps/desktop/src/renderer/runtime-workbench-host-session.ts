import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeStreamChannel } from "./runtime-stream-client.js";
import type { RuntimeLifecyclePanelSessionSnapshot } from "./runtime-lifecycle-panel-session.js";
import type { RuntimeLifecyclePanelSessionController } from "./runtime-lifecycle-panel-session.js";
import type {
  RuntimeStreamInteractionSessionController,
  RuntimeStreamInteractionSessionSnapshot,
} from "./runtime-stream-session.js";
import type { RuntimeStreamEventStoreStatus } from "./runtime-stream-store.js";
import type {
  RuntimeStreamViewEventPhase,
  RuntimeStreamViewDisplayLevel,
  RuntimeStreamViewEvent,
  RuntimeStreamViewSensitivity,
  RuntimeStreamViewSeverity,
  RuntimeStreamViewStructuredFieldSummary,
} from "./runtime-stream-view-model.js";
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
  readonly activeSession: RuntimeLifecyclePanelSessionSnapshot | null;
}

export interface RuntimeWorkbenchHostRuntimeStreamSnapshot {
  readonly active: boolean;
  readonly activeChannel: RuntimeStreamChannel | null;
  readonly disposed: boolean;
}

export type RuntimeWorkbenchHostRuntimeStreamArtifactKind =
  | "artifact"
  | "pack"
  | "evaluation"
  | "patch"
  | "file"
  | "image"
  | "chart";

export interface RuntimeWorkbenchHostRuntimeStreamArtifactRefSnapshot {
  readonly artifactId: string;
  readonly kind: RuntimeWorkbenchHostRuntimeStreamArtifactKind;
  readonly displayName: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly previewText: string | null;
  readonly path: string | null;
}

export interface RuntimeWorkbenchHostRuntimeStreamEventSnapshot {
  readonly id: string | null;
  readonly schemaVersion: string | null;
  readonly seq: number | null;
  readonly parentEventId: string | null;
  readonly correlationId: string | null;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly attemptId: string | null;
  readonly type: string;
  readonly category: string | null;
  readonly phase: RuntimeStreamViewEventPhase | null;
  readonly displayLevel: RuntimeStreamViewDisplayLevel;
  readonly severity: RuntimeStreamViewSeverity;
  readonly sensitivity: RuntimeStreamViewSensitivity;
  readonly title: string;
  readonly summary: string | null;
  readonly content: string | null;
  readonly expandable: boolean;
  readonly payloadSummary: RuntimeStreamViewStructuredFieldSummary;
  readonly metadataSummary: RuntimeStreamViewStructuredFieldSummary;
  readonly expanded: boolean;
  readonly childCount: number;
  readonly children: readonly RuntimeWorkbenchHostRuntimeStreamEventSnapshot[];
  readonly artifactRefs: readonly RuntimeWorkbenchHostRuntimeStreamArtifactRefSnapshot[];
  readonly createdAt: string | null;
}

export interface RuntimeWorkbenchHostRuntimeStreamSearchSnapshot {
  readonly query: string;
  readonly matchCount: number;
  readonly activeMatchIndex: number | null;
  readonly activeEventId: string | null;
}

export interface RuntimeWorkbenchHostRuntimeStreamReadSnapshot {
  readonly lastSeenTotalEvents: number;
  readonly unreadCount: number;
}

export interface RuntimeWorkbenchHostRuntimeStreamFullReloadSnapshot {
  readonly acknowledged: boolean;
  readonly lastEventId: string | null;
  readonly reason: string;
  readonly status?: number;
  readonly errorCode?: string;
}

export interface RuntimeWorkbenchHostRuntimeStreamPanelSnapshot {
  readonly status: RuntimeStreamEventStoreStatus;
  readonly totalEvents: number;
  readonly bufferedEventCount: number;
  readonly matchingEventCount: number;
  readonly visibleEventCount: number;
  readonly hiddenEventCount: number;
  readonly foldedChildCount: number;
  readonly read: RuntimeWorkbenchHostRuntimeStreamReadSnapshot;
  readonly search: RuntimeWorkbenchHostRuntimeStreamSearchSnapshot;
  readonly summaryItems: readonly RuntimeWorkbenchHostRuntimeStreamEventSnapshot[];
  readonly timelineItems: readonly RuntimeWorkbenchHostRuntimeStreamEventSnapshot[];
  readonly selectedEvent: RuntimeWorkbenchHostRuntimeStreamEventSnapshot | null;
  readonly fullReload: RuntimeWorkbenchHostRuntimeStreamFullReloadSnapshot | null;
}

export interface RuntimeWorkbenchHostSessionSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly lifecyclePanel: RuntimeWorkbenchHostLifecyclePanelSnapshot;
  readonly runtimeStream: RuntimeWorkbenchHostRuntimeStreamSnapshot;
  readonly runtimeStreamPanel: RuntimeWorkbenchHostRuntimeStreamPanelSnapshot | null;
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
  const lifecyclePanelActiveSession =
    disposed || workbench.lifecyclePanel.activeSession === null
      ? null
      : workbench.lifecyclePanel.activeSession;
  const activeChannel = workbench.runtimeStream.activeChannel;
  const runtimeStreamPanel =
    disposed || workbench.runtimeStream.activeSession === null
      ? null
      : buildRuntimeWorkbenchHostRuntimeStreamPanelSnapshot(
          workbench.runtimeStream.activeSession,
        );
  return {
    activePanel: interaction.activePanel,
    lifecyclePanel: Object.freeze({
      active: lifecyclePanelActiveSession !== null,
      disposed: workbench.lifecyclePanel.disposed,
      activeSession:
        lifecyclePanelActiveSession === null
          ? null
          : lifecyclePanelActiveSession,
    }),
    runtimeStream: Object.freeze({
      active: workbench.runtimeStream.activeSession !== null,
      activeChannel:
        activeChannel === null
          ? null
          : cloneRuntimeStreamChannel(activeChannel),
      disposed: workbench.runtimeStream.disposed,
    }),
    runtimeStreamPanel,
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

function buildRuntimeWorkbenchHostRuntimeStreamPanelSnapshot(
  session: RuntimeStreamInteractionSessionSnapshot,
): RuntimeWorkbenchHostRuntimeStreamPanelSnapshot {
  const view = session.interaction.view;
  const summaryItems = view.summaryItems.map(
    toRuntimeWorkbenchHostRuntimeStreamEventSnapshot,
  );
  const timelineItems = view.timelineItems.map(
    toRuntimeWorkbenchHostRuntimeStreamEventSnapshot,
  );
  const selectedEvent =
    session.interaction.selectedEventId === null
      ? null
      : findRuntimeWorkbenchHostRuntimeStreamEvent(
          [...summaryItems, ...timelineItems],
          session.interaction.selectedEventId,
        );

  return Object.freeze({
    status: view.status,
    totalEvents: view.totalEvents,
    bufferedEventCount: view.bufferedEventCount,
    matchingEventCount: view.matchingEventCount,
    visibleEventCount: view.visibleEventCount,
    hiddenEventCount: view.hiddenEventCount,
    foldedChildCount: view.foldedChildCount,
    read: Object.freeze({ ...session.interaction.read }),
    search: Object.freeze({
      query: session.interaction.search.query,
      matchCount: session.interaction.search.matches.length,
      activeMatchIndex: session.interaction.search.activeMatchIndex,
      activeEventId: session.interaction.search.activeEventId,
    }),
    summaryItems: Object.freeze(summaryItems),
    timelineItems: Object.freeze(timelineItems),
    selectedEvent,
    fullReload:
      buildRuntimeWorkbenchHostRuntimeStreamFullReloadSnapshot(session),
  });
}

function toRuntimeWorkbenchHostRuntimeStreamEventSnapshot(
  event: RuntimeStreamViewEvent,
): RuntimeWorkbenchHostRuntimeStreamEventSnapshot {
  return Object.freeze({
    id: event.id,
    schemaVersion: event.schemaVersion,
    seq: event.seq,
    parentEventId: event.parentEventId,
    correlationId: event.correlationId,
    runId: event.runId,
    nodeId: event.nodeId,
    attemptId: event.attemptId,
    type: event.type,
    category: event.category,
    phase: event.phase,
    displayLevel: event.displayLevel,
    severity: event.severity,
    sensitivity: event.sensitivity,
    title: event.title,
    summary: event.summary,
    content: event.content,
    expandable: event.expandable,
    payloadSummary: Object.freeze({ ...event.payloadSummary }),
    metadataSummary: Object.freeze({ ...event.metadataSummary }),
    expanded: event.expanded,
    childCount: event.childCount,
    children: Object.freeze(
      event.children.map(toRuntimeWorkbenchHostRuntimeStreamEventSnapshot),
    ),
    artifactRefs: toRuntimeWorkbenchHostRuntimeStreamArtifactRefs(
      event.artifactRefs,
    ),
    createdAt: event.createdAt,
  });
}

function toRuntimeWorkbenchHostRuntimeStreamArtifactRefs(
  value: unknown,
): readonly RuntimeWorkbenchHostRuntimeStreamArtifactRefSnapshot[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    value.flatMap((item) => {
      const ref = toRuntimeWorkbenchHostRuntimeStreamArtifactRef(item);
      return ref === null ? [] : [ref];
    }),
  );
}

function toRuntimeWorkbenchHostRuntimeStreamArtifactRef(
  value: unknown,
): RuntimeWorkbenchHostRuntimeStreamArtifactRefSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const artifactId = readNonEmptyString(value, "artifact_id");
  const kind = readArtifactKind(value, "kind");
  const displayName = readNonEmptyString(value, "display_name");
  if (artifactId === null || kind === null || displayName === null) {
    return null;
  }
  return Object.freeze({
    artifactId,
    kind,
    displayName,
    mimeType: readOptionalString(value, "mime_type"),
    sizeBytes: readOptionalNonNegativeInteger(value, "size_bytes"),
    previewText: readOptionalString(value, "preview_text"),
    path: readOptionalString(value, "path"),
  });
}

function readArtifactKind(
  record: Readonly<Record<string, unknown>>,
  key: string,
): RuntimeWorkbenchHostRuntimeStreamArtifactKind | null {
  const value = readNonEmptyString(record, key);
  return value === "artifact" ||
    value === "pack" ||
    value === "evaluation" ||
    value === "patch" ||
    value === "file" ||
    value === "image" ||
    value === "chart"
    ? value
    : null;
}

function readNonEmptyString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readOptionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readOptionalNonNegativeInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findRuntimeWorkbenchHostRuntimeStreamEvent(
  events: readonly RuntimeWorkbenchHostRuntimeStreamEventSnapshot[],
  eventId: string,
): RuntimeWorkbenchHostRuntimeStreamEventSnapshot | null {
  for (const event of events) {
    if (event.id === eventId) {
      return event;
    }
    const child = findRuntimeWorkbenchHostRuntimeStreamEvent(
      event.children,
      eventId,
    );
    if (child !== null) {
      return child;
    }
  }
  return null;
}

function buildRuntimeWorkbenchHostRuntimeStreamFullReloadSnapshot(
  session: RuntimeStreamInteractionSessionSnapshot,
): RuntimeWorkbenchHostRuntimeStreamFullReloadSnapshot | null {
  const view = session.interaction.view;
  if (!view.fullReloadRequired) {
    return null;
  }
  const decision = view.fullReloadDecision;
  return Object.freeze({
    acknowledged: session.interaction.fullReloadAcknowledged,
    lastEventId: decision?.lastEventId ?? null,
    reason: decision?.reason ?? "Runtime stream full reload is required",
    ...(decision?.status !== undefined ? { status: decision.status } : {}),
    ...(decision?.errorCode !== undefined
      ? { errorCode: decision.errorCode }
      : {}),
  });
}
