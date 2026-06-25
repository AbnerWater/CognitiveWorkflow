import {
  assertRuntimeRequestPath,
  type RuntimeBridge,
  type RuntimeRequestPath,
  type RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import type {
  CreateRuntimeLifecyclePanelSessionFactorySessionOptions,
  RuntimeLifecyclePanelSession,
  RuntimeLifecyclePanelSessionController,
  RuntimeLifecyclePanelSessionControllerSnapshot,
  RuntimeLifecyclePanelSessionErrorHandler,
} from "./runtime-lifecycle-panel-session.js";
import type { RuntimeLifecyclePanelInteractionCommand } from "./runtime-lifecycle-panel-interaction.js";
import type {
  CreateRuntimeStreamInteractionSessionFactorySessionOptions,
  RuntimeStreamInteractionSession,
  RuntimeStreamInteractionSessionController,
  RuntimeStreamInteractionSessionControllerSnapshot,
  RuntimeStreamKnownEventType,
} from "./runtime-stream-session.js";
import type { RuntimeStreamInteractionCommand } from "./runtime-stream-interaction.js";

export type RuntimeWorkbenchPanelId = "canvas" | "lifecycle" | "stream";

export const RUNTIME_WORKBENCH_EXECUTION_MODES = [
  "step",
  "semi_auto",
  "auto",
] as const;

export type RuntimeWorkbenchExecutionMode =
  (typeof RUNTIME_WORKBENCH_EXECUTION_MODES)[number];

export type RuntimeWorkbenchRunOnceStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

export type RuntimeWorkbenchRunOnceBlockedReason =
  | "invalid_target"
  | "mode_not_step"
  | "request_failed"
  | "runtime_unavailable";

export interface RuntimeWorkbenchRunOnceSnapshot {
  readonly status: RuntimeWorkbenchRunOnceStatus;
  readonly method: "POST";
  readonly path: RuntimeRequestPath | null;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly statusCode: number | null;
  readonly blockedReason: RuntimeWorkbenchRunOnceBlockedReason | null;
}

export type RuntimeWorkbenchProjectCreationStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

export type RuntimeWorkbenchProjectCreationBlockedReason =
  | "git_not_initialized"
  | "invalid_input"
  | "request_failed"
  | "response_invalid"
  | "runtime_unavailable";

export interface RuntimeWorkbenchProjectCreationSnapshot {
  readonly status: RuntimeWorkbenchProjectCreationStatus;
  readonly method: "POST";
  readonly path: RuntimeRequestPath;
  readonly displayName: string | null;
  readonly hostPath: string | null;
  readonly projectId: string | null;
  readonly gitInitialized: boolean | null;
  readonly firstCommitSha: string | null;
  readonly statusCode: number | null;
  readonly blockedReason: RuntimeWorkbenchProjectCreationBlockedReason | null;
  readonly canCreateProject: boolean;
}

export interface RuntimeWorkbenchExecutionPolicySnapshot {
  readonly mode: RuntimeWorkbenchExecutionMode;
  readonly availableModes: readonly RuntimeWorkbenchExecutionMode[];
  readonly canChangeMode: boolean;
  readonly canRunOnce: boolean;
  readonly runOnce: RuntimeWorkbenchRunOnceSnapshot;
}

export interface RuntimeWorkbenchRunOnceInput {
  readonly runId: string;
  readonly nodeId: string;
  readonly projectId?: string;
  readonly idempotencyKey?: string;
}

export interface RuntimeWorkbenchProjectCreationInput {
  readonly displayName: string;
  readonly hostPath: string;
  readonly idempotencyKey?: string;
  readonly settingsOverrides?: Readonly<Record<string, unknown>>;
}

export interface RuntimeWorkbenchSessionSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly executionPolicy: RuntimeWorkbenchExecutionPolicySnapshot;
  readonly projectCreation: RuntimeWorkbenchProjectCreationSnapshot;
  readonly lifecyclePanel: RuntimeLifecyclePanelSessionControllerSnapshot;
  readonly runtimeStream: RuntimeStreamInteractionSessionControllerSnapshot;
  readonly disposed: boolean;
}

export type RuntimeWorkbenchSessionStoreChangeListener = () => void;

export type RuntimeWorkbenchSessionErrorHandler =
  RuntimeLifecyclePanelSessionErrorHandler;

export interface RuntimeWorkbenchStreamSession {
  readonly eventTypes: readonly RuntimeStreamKnownEventType[];
  readonly snapshot: RuntimeStreamInteractionSession["snapshot"];
  readonly subscribe: RuntimeStreamInteractionSession["subscribe"];
  readonly dispatch: RuntimeStreamInteractionSession["dispatch"];
  readonly start: RuntimeStreamInteractionSession["start"];
  readonly stop: RuntimeStreamInteractionSession["stop"];
  readonly resetFullReloadRequired: RuntimeStreamInteractionSession["resetFullReloadRequired"];
  readonly bindPageLifecycle: RuntimeStreamInteractionSession["bindPageLifecycle"];
  readonly isStarted: RuntimeStreamInteractionSession["isStarted"];
  readonly listenerCount: RuntimeStreamInteractionSession["listenerCount"];
  readonly dispose: () => boolean;
}

export interface RuntimeWorkbenchSession {
  readonly activePanel: () => RuntimeWorkbenchPanelId;
  readonly getSnapshot: () => RuntimeWorkbenchSessionSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchSessionSnapshot;
  readonly snapshot: () => RuntimeWorkbenchSessionSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchSessionStoreChangeListener,
  ) => RuntimeStatusUnsubscribe;
  readonly setActivePanel: (
    panel: RuntimeWorkbenchPanelId,
  ) => RuntimeWorkbenchSessionSnapshot;
  readonly setExecutionMode: (
    mode: RuntimeWorkbenchExecutionMode,
  ) => RuntimeWorkbenchSessionSnapshot;
  readonly runNodeOnce: (
    input: RuntimeWorkbenchRunOnceInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly createProject: (
    input: RuntimeWorkbenchProjectCreationInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly openLifecyclePanelSession: (
    options?: CreateRuntimeLifecyclePanelSessionFactorySessionOptions,
  ) => RuntimeLifecyclePanelSession;
  readonly disposeLifecyclePanelSession: () => boolean;
  readonly dispatchLifecyclePanelCommand: (
    command: RuntimeLifecyclePanelInteractionCommand,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly openRuntimeStreamSession: (
    options: CreateRuntimeStreamInteractionSessionFactorySessionOptions,
  ) => RuntimeWorkbenchStreamSession;
  readonly dispatchRuntimeStreamCommand: (
    command: RuntimeStreamInteractionCommand,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly disposeRuntimeStreamSession: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeWorkbenchSessionOptions {
  readonly lifecyclePanelController: RuntimeLifecyclePanelSessionController;
  readonly runtimeStreamController: RuntimeStreamInteractionSessionController;
  readonly runtime?: Pick<RuntimeBridge, "fetch">;
  readonly activePanel?: RuntimeWorkbenchPanelId;
  readonly executionMode?: RuntimeWorkbenchExecutionMode;
  readonly onError?: RuntimeWorkbenchSessionErrorHandler;
}

export function createRuntimeWorkbenchSession(
  options: CreateRuntimeWorkbenchSessionOptions,
): RuntimeWorkbenchSession {
  let activePanel = requireRuntimeWorkbenchPanelId(
    options.activePanel ?? "lifecycle",
  );
  let executionMode = requireRuntimeWorkbenchExecutionMode(
    options.executionMode ?? "semi_auto",
  );
  let runOnceSnapshot = createRuntimeWorkbenchRunOnceSnapshot({
    status: "idle",
  });
  let disposed = false;
  let projectCreationSnapshot = createRuntimeWorkbenchProjectCreationSnapshot({
    status: "idle",
    runtimeAvailable: options.runtime !== undefined,
    disposed,
  });
  const listeners = new Set<RuntimeWorkbenchSessionStoreChangeListener>();
  let lifecyclePanelUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let runtimeStreamUnsubscribe: RuntimeStatusUnsubscribe | undefined;

  const initialSnapshot = freezeRuntimeWorkbenchSessionSnapshot({
    activePanel,
    executionPolicy: createRuntimeWorkbenchExecutionPolicySnapshot({
      mode: executionMode,
      runOnce: runOnceSnapshot,
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    }),
    projectCreation: createRuntimeWorkbenchProjectCreationSnapshot({
      ...projectCreationSnapshot,
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    }),
    lifecyclePanel: options.lifecyclePanelController.getSnapshot(),
    runtimeStream: options.runtimeStreamController.snapshot(),
    disposed,
  });
  let currentSignature =
    runtimeWorkbenchSessionSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break root workbench propagation.
    }
  };

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Runtime workbench session is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeWorkbenchSessionSnapshot => {
    const nextSnapshot = freezeRuntimeWorkbenchSessionSnapshot({
      activePanel,
      executionPolicy: createRuntimeWorkbenchExecutionPolicySnapshot({
        mode: executionMode,
        runOnce: runOnceSnapshot,
        runtimeAvailable: options.runtime !== undefined,
        disposed,
      }),
      projectCreation: createRuntimeWorkbenchProjectCreationSnapshot({
        ...projectCreationSnapshot,
        runtimeAvailable: options.runtime !== undefined,
        disposed,
      }),
      lifecyclePanel: options.lifecyclePanelController.getSnapshot(),
      runtimeStream: options.runtimeStreamController.snapshot(),
      disposed,
    });
    const nextSignature =
      runtimeWorkbenchSessionSnapshotSignature(nextSnapshot);
    if (forceRefresh || nextSignature !== currentSignature) {
      currentSignature = nextSignature;
      currentSnapshot = nextSnapshot;
    }
    return currentSnapshot;
  };

  const publishIfChanged = (forceRefresh = false): void => {
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

  const releaseLifecyclePanelSubscription = (): void => {
    lifecyclePanelUnsubscribe?.();
    lifecyclePanelUnsubscribe = undefined;
  };

  const releaseRuntimeStreamSubscription = (): void => {
    runtimeStreamUnsubscribe?.();
    runtimeStreamUnsubscribe = undefined;
  };

  const ensureControllerSubscriptions = (): void => {
    if (listeners.size === 0 || disposed) {
      return;
    }
    if (lifecyclePanelUnsubscribe === undefined) {
      lifecyclePanelUnsubscribe = options.lifecyclePanelController.subscribe(
        () => {
          publishIfChanged();
        },
      );
    }
    if (runtimeStreamUnsubscribe === undefined) {
      runtimeStreamUnsubscribe = options.runtimeStreamController.subscribe(
        () => {
          publishIfChanged();
        },
      );
    }
  };

  const releaseControllerSubscriptions = (): void => {
    releaseLifecyclePanelSubscription();
    releaseRuntimeStreamSubscription();
  };

  const runWithSuppressedControllerPublish = <T>(action: () => T): T => {
    const shouldRestoreSubscriptions = listeners.size > 0 && !disposed;
    if (shouldRestoreSubscriptions) {
      releaseControllerSubscriptions();
    }
    try {
      const result = action();
      if (shouldRestoreSubscriptions) {
        ensureControllerSubscriptions();
      }
      return result;
    } catch (error) {
      if (shouldRestoreSubscriptions) {
        ensureControllerSubscriptions();
      }
      throw error;
    }
  };

  return {
    activePanel: () => activePanel,
    getSnapshot: () => captureSnapshot(),
    getServerSnapshot: () => captureSnapshot(),
    snapshot: () => captureSnapshot(),
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      ensureControllerSubscriptions();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseControllerSubscriptions();
        }
        return deleted;
      };
    },
    setActivePanel: (panel) => {
      assertActive();
      activePanel = requireRuntimeWorkbenchPanelId(panel);
      publishIfChanged();
      return captureSnapshot();
    },
    setExecutionMode: (mode) => {
      assertActive();
      executionMode = requireRuntimeWorkbenchExecutionMode(mode);
      publishIfChanged();
      return captureSnapshot();
    },
    runNodeOnce: async (input) => {
      assertActive();
      const runId = normalizeRuntimeWorkbenchRunOncePathSegment(input.runId);
      const nodeId = normalizeRuntimeWorkbenchRunOncePathSegment(input.nodeId);
      if (runId === null || nodeId === null) {
        runOnceSnapshot = createRuntimeWorkbenchRunOnceSnapshot({
          blockedReason: "invalid_target",
          status: "blocked",
        });
        publishIfChanged(true);
        throw new Error("Runtime workbench run-once target is invalid");
      }
      const requestPath = buildRuntimeWorkbenchRunOncePath(runId, nodeId);
      if (executionMode !== "step") {
        runOnceSnapshot = createRuntimeWorkbenchRunOnceSnapshot({
          blockedReason: "mode_not_step",
          nodeId,
          path: requestPath,
          runId,
          status: "blocked",
        });
        publishIfChanged(true);
        throw new Error("Runtime workbench run-once requires step mode");
      }
      if (options.runtime === undefined) {
        runOnceSnapshot = createRuntimeWorkbenchRunOnceSnapshot({
          blockedReason: "runtime_unavailable",
          nodeId,
          path: requestPath,
          runId,
          status: "blocked",
        });
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }

      runOnceSnapshot = createRuntimeWorkbenchRunOnceSnapshot({
        nodeId,
        path: requestPath,
        runId,
        status: "running",
      });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath, {
          method: "POST",
          ...(input.projectId !== undefined
            ? { projectId: input.projectId }
            : {}),
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        });
        runOnceSnapshot = createRuntimeWorkbenchRunOnceSnapshot({
          nodeId,
          path: requestPath,
          runId,
          status: response.ok ? "succeeded" : "failed",
          statusCode: response.status,
        });
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        runOnceSnapshot = createRuntimeWorkbenchRunOnceSnapshot({
          blockedReason: "request_failed",
          nodeId,
          path: requestPath,
          runId,
          status: "failed",
        });
        publishIfChanged(true);
        throw error;
      }
    },
    createProject: async (input) => {
      assertActive();
      const requestPath = buildRuntimeWorkbenchProjectCreationPath();
      const displayName = normalizeRuntimeWorkbenchProjectDisplayName(
        input.displayName,
      );
      const hostPath = normalizeRuntimeWorkbenchProjectHostPath(input.hostPath);
      if (displayName === null || hostPath === null) {
        projectCreationSnapshot = createRuntimeWorkbenchProjectCreationSnapshot(
          {
            blockedReason: "invalid_input",
            displayName,
            hostPath,
            path: requestPath,
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench project creation input is invalid");
      }
      if (options.runtime === undefined) {
        projectCreationSnapshot = createRuntimeWorkbenchProjectCreationSnapshot(
          {
            blockedReason: "runtime_unavailable",
            displayName,
            hostPath,
            path: requestPath,
            runtimeAvailable: false,
            status: "blocked",
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }

      projectCreationSnapshot = createRuntimeWorkbenchProjectCreationSnapshot({
        displayName,
        hostPath,
        path: requestPath,
        runtimeAvailable: true,
        status: "running",
        disposed,
      });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath, {
          method: "POST",
          body: JSON.stringify(
            buildRuntimeWorkbenchProjectCreationRequestBody(
              input.settingsOverrides === undefined
                ? {
                    displayName,
                    hostPath,
                  }
                : {
                    displayName,
                    hostPath,
                    settingsOverrides: input.settingsOverrides,
                  },
            ),
          ),
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        });
        if (!response.ok) {
          projectCreationSnapshot =
            createRuntimeWorkbenchProjectCreationSnapshot({
              displayName,
              hostPath,
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }

        const parsedResponse = parseRuntimeWorkbenchProjectCreationResponse(
          response.body,
        );
        if (parsedResponse === null) {
          projectCreationSnapshot =
            createRuntimeWorkbenchProjectCreationSnapshot({
              blockedReason: "response_invalid",
              displayName,
              hostPath,
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error(
            "Runtime workbench project creation response is invalid",
          );
        }
        if (parsedResponse.gitInitialized !== true) {
          projectCreationSnapshot =
            createRuntimeWorkbenchProjectCreationSnapshot({
              blockedReason: "git_not_initialized",
              displayName,
              gitInitialized: false,
              hostPath: parsedResponse.hostPath,
              path: requestPath,
              projectId: parsedResponse.projectId,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error(
            "Runtime workbench project creation did not initialize Git",
          );
        }
        if (parsedResponse.firstCommitSha === null) {
          projectCreationSnapshot =
            createRuntimeWorkbenchProjectCreationSnapshot({
              blockedReason: "response_invalid",
              displayName,
              gitInitialized: true,
              hostPath: parsedResponse.hostPath,
              path: requestPath,
              projectId: parsedResponse.projectId,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error(
            "Runtime workbench project creation response is invalid",
          );
        }

        projectCreationSnapshot = createRuntimeWorkbenchProjectCreationSnapshot(
          {
            displayName,
            firstCommitSha: parsedResponse.firstCommitSha,
            gitInitialized: parsedResponse.gitInitialized,
            hostPath: parsedResponse.hostPath,
            path: requestPath,
            projectId: parsedResponse.projectId,
            runtimeAvailable: true,
            status: "succeeded",
            statusCode: response.status,
            disposed,
          },
        );
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (
          projectCreationSnapshot.status !== "failed" ||
          projectCreationSnapshot.blockedReason === null
        ) {
          projectCreationSnapshot =
            createRuntimeWorkbenchProjectCreationSnapshot({
              blockedReason: "request_failed",
              displayName,
              hostPath,
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              disposed,
            });
          publishIfChanged(true);
        }
        throw error;
      }
    },
    openLifecyclePanelSession: (sessionOptions) => {
      assertActive();
      const session = runWithSuppressedControllerPublish(() =>
        options.lifecyclePanelController.openSession(sessionOptions),
      );
      activePanel = "lifecycle";
      publishIfChanged(true);
      return session;
    },
    disposeLifecyclePanelSession: () => {
      if (disposed) {
        return false;
      }
      return runWithSuppressedControllerPublish(() => {
        const result = options.lifecyclePanelController.disposeActiveSession();
        if (result) {
          publishIfChanged(true);
        }
        return result;
      });
    },
    dispatchLifecyclePanelCommand: async (command) => {
      assertActive();
      const lifecycleSession = options.lifecyclePanelController.activeSession();
      if (lifecycleSession === null) {
        throw new Error(
          "Runtime workbench lifecycle panel session is not active",
        );
      }
      await lifecycleSession.dispatch(command);
      publishIfChanged();
      return captureSnapshot();
    },
    openRuntimeStreamSession: (sessionOptions) => {
      assertActive();
      const session = runWithSuppressedControllerPublish(() =>
        options.runtimeStreamController.openSession(sessionOptions),
      );
      activePanel = "stream";
      publishIfChanged(true);
      return createRuntimeWorkbenchStreamSessionFacade(
        session,
        options.runtimeStreamController,
      );
    },
    dispatchRuntimeStreamCommand: async (command) => {
      assertActive();
      const streamSession = options.runtimeStreamController.activeSession();
      if (streamSession === null) {
        throw new Error("Runtime workbench stream session is not active");
      }
      streamSession.dispatch(command);
      if (
        command.type === "acknowledge_full_reload" &&
        streamSession.snapshot().store.status === "full_reload_required"
      ) {
        streamSession.resetFullReloadRequired();
        await streamSession.start();
      }
      publishIfChanged();
      return captureSnapshot();
    },
    disposeRuntimeStreamSession: () => {
      if (disposed) {
        return false;
      }
      return runWithSuppressedControllerPublish(() => {
        const result = options.runtimeStreamController.disposeActiveSession();
        if (result) {
          publishIfChanged(true);
        }
        return result;
      });
    },
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseControllerSubscriptions();
      options.lifecyclePanelController.dispose();
      options.runtimeStreamController.dispose();
      publishIfChanged(true);
      listeners.clear();
      return true;
    },
    isDisposed: () => disposed,
  };
}

function createRuntimeWorkbenchStreamSessionFacade(
  session: RuntimeStreamInteractionSession,
  controller: RuntimeStreamInteractionSessionController,
): RuntimeWorkbenchStreamSession {
  const dispose = (): boolean => {
    if (controller.activeSession() !== session) {
      return false;
    }
    return controller.disposeActiveSession();
  };

  const facade: RuntimeWorkbenchStreamSession = {
    eventTypes: Object.freeze([...session.eventTypes]),
    snapshot: () => session.snapshot(),
    subscribe: (listener) => session.subscribe(listener),
    dispatch: (command) => session.dispatch(command),
    start: () => session.start(),
    stop: () => session.stop(),
    resetFullReloadRequired: () => session.resetFullReloadRequired(),
    bindPageLifecycle: (target, options) =>
      session.bindPageLifecycle(target, options),
    isStarted: () => session.isStarted(),
    listenerCount: () => session.listenerCount(),
    dispose,
  };
  return Object.freeze(facade);
}

export function isRuntimeWorkbenchExecutionMode(
  mode: string,
): mode is RuntimeWorkbenchExecutionMode {
  return RUNTIME_WORKBENCH_EXECUTION_MODES.includes(
    mode as RuntimeWorkbenchExecutionMode,
  );
}

function requireRuntimeWorkbenchExecutionMode(
  mode: string,
): RuntimeWorkbenchExecutionMode {
  if (!isRuntimeWorkbenchExecutionMode(mode)) {
    throw new Error("Invalid runtime workbench execution mode");
  }
  return mode;
}

function createRuntimeWorkbenchExecutionPolicySnapshot(options: {
  readonly mode: RuntimeWorkbenchExecutionMode;
  readonly runOnce: RuntimeWorkbenchRunOnceSnapshot;
  readonly runtimeAvailable: boolean;
  readonly disposed: boolean;
}): RuntimeWorkbenchExecutionPolicySnapshot {
  return Object.freeze({
    mode: options.mode,
    availableModes: Object.freeze([...RUNTIME_WORKBENCH_EXECUTION_MODES]),
    canChangeMode: !options.disposed,
    canRunOnce:
      !options.disposed &&
      options.runtimeAvailable &&
      options.mode === "step" &&
      options.runOnce.status !== "running",
    runOnce: createRuntimeWorkbenchRunOnceSnapshot(options.runOnce),
  });
}

function createRuntimeWorkbenchRunOnceSnapshot(
  input: Partial<RuntimeWorkbenchRunOnceSnapshot> & {
    readonly status: RuntimeWorkbenchRunOnceStatus;
  },
): RuntimeWorkbenchRunOnceSnapshot {
  return Object.freeze({
    status: input.status,
    method: "POST",
    path: input.path ?? null,
    runId: input.runId ?? null,
    nodeId: input.nodeId ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
  });
}

function createRuntimeWorkbenchProjectCreationSnapshot(
  input: Partial<RuntimeWorkbenchProjectCreationSnapshot> & {
    readonly status: RuntimeWorkbenchProjectCreationStatus;
    readonly runtimeAvailable: boolean;
    readonly disposed: boolean;
  },
): RuntimeWorkbenchProjectCreationSnapshot {
  return Object.freeze({
    status: input.status,
    method: "POST",
    path: input.path ?? buildRuntimeWorkbenchProjectCreationPath(),
    displayName: input.displayName ?? null,
    hostPath: input.hostPath ?? null,
    projectId: input.projectId ?? null,
    gitInitialized: input.gitInitialized ?? null,
    firstCommitSha: input.firstCommitSha ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    canCreateProject:
      !input.disposed && input.runtimeAvailable && input.status !== "running",
  });
}

function buildRuntimeWorkbenchRunOncePath(
  runId: string,
  nodeId: string,
): RuntimeRequestPath {
  const requestPath = `/runs/${encodeURIComponent(
    runId,
  )}/nodes/${encodeURIComponent(nodeId)}:run-once`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
}

function normalizeRuntimeWorkbenchRunOncePathSegment(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    trimmed.includes("..") ||
    /[\u0000-\u001f\u007f\s]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function buildRuntimeWorkbenchProjectCreationPath(): RuntimeRequestPath {
  const requestPath = "/projects";
  assertRuntimeRequestPath(requestPath);
  return requestPath;
}

function buildRuntimeWorkbenchProjectCreationRequestBody(options: {
  readonly displayName: string;
  readonly hostPath: string;
  readonly settingsOverrides?: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    schema_version: "0.1.0",
    display_name: options.displayName,
    host_path: options.hostPath,
    ...(options.settingsOverrides !== undefined
      ? { settings_overrides: options.settingsOverrides }
      : {}),
  };
}

function normalizeRuntimeWorkbenchProjectDisplayName(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function normalizeRuntimeWorkbenchProjectHostPath(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

interface ParsedRuntimeWorkbenchProjectCreationResponse {
  readonly projectId: string;
  readonly hostPath: string;
  readonly gitInitialized: boolean;
  readonly firstCommitSha: string | null;
}

function parseRuntimeWorkbenchProjectCreationResponse(
  body: unknown,
): ParsedRuntimeWorkbenchProjectCreationResponse | null {
  if (!isRecord(body)) {
    return null;
  }
  const schemaVersion = body.schema_version;
  const projectId = body.project_id;
  const hostPath = body.host_path;
  const gitInitialized = body.git_initialized;
  const firstCommitSha = body.first_commit_sha;
  if (
    schemaVersion !== "0.1.0" ||
    typeof projectId !== "string" ||
    projectId.trim().length === 0 ||
    typeof hostPath !== "string" ||
    hostPath.trim().length === 0 ||
    typeof gitInitialized !== "boolean"
  ) {
    return null;
  }
  let normalizedFirstCommitSha: string | null = null;
  if (gitInitialized) {
    if (
      typeof firstCommitSha !== "string" ||
      firstCommitSha.trim().length === 0
    ) {
      return null;
    }
    normalizedFirstCommitSha = firstCommitSha;
  }
  return {
    projectId,
    hostPath,
    gitInitialized,
    firstCommitSha: normalizedFirstCommitSha,
  };
}

function requireRuntimeWorkbenchPanelId(
  panel: string,
): RuntimeWorkbenchPanelId {
  switch (panel) {
    case "canvas":
    case "lifecycle":
    case "stream":
      return panel;
    default:
      throw new Error("Invalid runtime workbench panel id");
  }
}

function freezeRuntimeWorkbenchSessionSnapshot(
  snapshot: RuntimeWorkbenchSessionSnapshot,
): RuntimeWorkbenchSessionSnapshot {
  return Object.freeze({
    ...snapshot,
    executionPolicy: cloneRuntimeWorkbenchExecutionPolicySnapshot(
      snapshot.executionPolicy,
    ),
    projectCreation: createRuntimeWorkbenchProjectCreationSnapshot({
      ...snapshot.projectCreation,
      runtimeAvailable:
        snapshot.projectCreation.canCreateProject ||
        snapshot.projectCreation.status === "running",
      disposed: snapshot.disposed,
    }),
  });
}

function cloneRuntimeWorkbenchExecutionPolicySnapshot(
  snapshot: RuntimeWorkbenchExecutionPolicySnapshot,
): RuntimeWorkbenchExecutionPolicySnapshot {
  return Object.freeze({
    ...snapshot,
    availableModes: Object.freeze([...snapshot.availableModes]),
    runOnce: createRuntimeWorkbenchRunOnceSnapshot(snapshot.runOnce),
  });
}

function runtimeWorkbenchSessionSnapshotSignature(
  snapshot: RuntimeWorkbenchSessionSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
