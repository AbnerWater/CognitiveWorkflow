import {
  assertRuntimeRequestPath,
  type RuntimeArtifactActionRequest,
  type RuntimeArtifactActionResult,
  type RuntimeBridge,
  type RuntimeRequestPath,
  type RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import type {
  RuntimeInstructionAccepted,
  RuntimeInstructionRequest,
} from "@cw/schemas";
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

export type RuntimeWorkbenchInstructionIntent =
  RuntimeInstructionRequest["intent"];

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

export type RuntimeWorkbenchChatInstructionStatus =
  | "idle"
  | "submitting"
  | "accepted"
  | "failed"
  | "blocked";

export type RuntimeWorkbenchChatInstructionBlockedReason =
  | "invalid_input"
  | "request_failed"
  | "response_invalid"
  | "runtime_unavailable";

export interface RuntimeWorkbenchChatInstructionSnapshot {
  readonly status: RuntimeWorkbenchChatInstructionStatus;
  readonly method: "POST";
  readonly path: RuntimeRequestPath | null;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly scope: "run" | "node" | null;
  readonly intent: RuntimeWorkbenchInstructionIntent | null;
  readonly commandId: string | null;
  readonly statusCode: number | null;
  readonly blockedReason: RuntimeWorkbenchChatInstructionBlockedReason | null;
  readonly characterCount: number | null;
  readonly wordCount: number | null;
  readonly canSubmitInstruction: boolean;
}

export type RuntimeWorkbenchArtifactActionStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type RuntimeWorkbenchArtifactActionBlockedReason =
  | "invalid_input"
  | "request_failed"
  | "response_invalid"
  | "runtime_unavailable";

export interface RuntimeWorkbenchArtifactActionSnapshot {
  readonly status: RuntimeWorkbenchArtifactActionStatus;
  readonly artifactId: string | null;
  readonly action: "open" | "download" | null;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly destinationKind:
    | "project_temp"
    | "project_artifact"
    | "user_selected"
    | "native_shell"
    | "none"
    | null;
  readonly contentType: string | null;
  readonly byteCount: number | null;
  readonly contentHash: string | null;
  readonly sensitive: boolean;
  readonly errorCode: string | null;
  readonly correlationId: string | null;
  readonly blockedReason: RuntimeWorkbenchArtifactActionBlockedReason | null;
  readonly canRunArtifactAction: boolean;
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

export type RuntimeWorkbenchReferenceManagementStatus =
  | "idle"
  | "refreshing"
  | "importing"
  | "updating"
  | "succeeded"
  | "failed"
  | "blocked";

export type RuntimeWorkbenchReferenceManagementBlockedReason =
  | "invalid_input"
  | "request_failed"
  | "response_invalid"
  | "runtime_unavailable";

export type RuntimeWorkbenchReferenceKind =
  | "pdf"
  | "md"
  | "txt"
  | "csv"
  | "xlsx"
  | "image"
  | "web_url";

export type RuntimeWorkbenchReferenceChunkStatus =
  | "none"
  | "chunked"
  | "indexed"
  | "stale";

export interface RuntimeWorkbenchReferenceEntrySnapshot {
  readonly referenceId: string;
  readonly path: string;
  readonly kind: RuntimeWorkbenchReferenceKind;
  readonly enabled: boolean;
  readonly sourceUrl: string | null;
  readonly contentHash: string;
  readonly chunkStatus: RuntimeWorkbenchReferenceChunkStatus;
  readonly chunkSizeTokens: number | null;
  readonly sensitive: boolean;
  readonly importedAt: string;
}

export interface RuntimeWorkbenchReferenceManagementSnapshot {
  readonly status: RuntimeWorkbenchReferenceManagementStatus;
  readonly activeProjectId: string | null;
  readonly method: "GET" | "POST" | "PATCH" | null;
  readonly path: RuntimeRequestPath | null;
  readonly entries: readonly RuntimeWorkbenchReferenceEntrySnapshot[];
  readonly indexSnapshotId: string | null;
  readonly lastReferenceId: string | null;
  readonly statusCode: number | null;
  readonly blockedReason: RuntimeWorkbenchReferenceManagementBlockedReason | null;
  readonly canRefreshReferences: boolean;
  readonly canImportReference: boolean;
  readonly canUpdateReference: boolean;
}

export type RuntimeWorkbenchSkillManagementStatus =
  | "idle"
  | "refreshing"
  | "updating"
  | "succeeded"
  | "failed"
  | "blocked";

export type RuntimeWorkbenchSkillManagementBlockedReason =
  | "invalid_input"
  | "request_failed"
  | "response_invalid"
  | "runtime_unavailable";

export interface RuntimeWorkbenchSkillEntrySnapshot {
  readonly skillId: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly paramKeys: readonly string[];
}

export interface RuntimeWorkbenchSkillManagementSnapshot {
  readonly status: RuntimeWorkbenchSkillManagementStatus;
  readonly activeProjectId: string | null;
  readonly method: "GET" | "PATCH" | null;
  readonly path: RuntimeRequestPath | null;
  readonly entries: readonly RuntimeWorkbenchSkillEntrySnapshot[];
  readonly lastSkillId: string | null;
  readonly statusCode: number | null;
  readonly blockedReason: RuntimeWorkbenchSkillManagementBlockedReason | null;
  readonly canRefreshSkills: boolean;
  readonly canUpdateSkill: boolean;
}

export type RuntimeWorkbenchHumanDecisionStatus =
  | "idle"
  | "submitting"
  | "succeeded"
  | "failed"
  | "blocked";

export type RuntimeWorkbenchHumanDecisionBlockedReason =
  | "invalid_input"
  | "request_failed"
  | "response_invalid"
  | "runtime_unavailable";

export interface RuntimeWorkbenchHumanDecisionSnapshot {
  readonly status: RuntimeWorkbenchHumanDecisionStatus;
  readonly method: "POST";
  readonly path: RuntimeRequestPath | null;
  readonly runId: string | null;
  readonly humanNodeId: string | null;
  readonly decision: string | null;
  readonly by: string | null;
  readonly customValuePresent: boolean;
  readonly statusCode: number | null;
  readonly blockedReason: RuntimeWorkbenchHumanDecisionBlockedReason | null;
  readonly decidedAt: string | null;
  readonly requestedAt: string | null;
  readonly canSubmitDecision: boolean;
}

export type RuntimeWorkbenchVersionSnapshotStatus =
  | "idle"
  | "creating"
  | "succeeded"
  | "failed"
  | "blocked";

export type RuntimeWorkbenchVersionSnapshotBlockedReason =
  | "invalid_input"
  | "request_failed"
  | "response_invalid"
  | "runtime_unavailable";

export interface RuntimeWorkbenchVersionSnapshotSnapshot {
  readonly status: RuntimeWorkbenchVersionSnapshotStatus;
  readonly method: "POST";
  readonly path: RuntimeRequestPath | null;
  readonly workflowId: string | null;
  readonly snapshotId: string | null;
  readonly commitSha: string | null;
  readonly createdAt: string | null;
  readonly statusCode: number | null;
  readonly blockedReason: RuntimeWorkbenchVersionSnapshotBlockedReason | null;
  readonly canCreateSnapshot: boolean;
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

export interface RuntimeWorkbenchChatInstructionInput {
  readonly runId: string;
  readonly nodeId?: string;
  readonly instruction: string;
  readonly intent: RuntimeWorkbenchInstructionIntent;
  readonly projectId?: string;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly clientCommandId?: string;
}

export interface RuntimeWorkbenchArtifactActionInput {
  readonly artifactId: string;
  readonly action: "open" | "download";
  readonly runId?: string;
  readonly nodeId?: string;
  readonly intent?: RuntimeWorkbenchInstructionIntent;
  readonly requestedDestinationKind?: RuntimeArtifactActionRequest["requested_destination_kind"];
  readonly artifactSensitivity?: RuntimeArtifactActionRequest["artifact_sensitivity"];
  readonly allowSensitiveExport?: boolean;
  readonly correlationId?: string;
}

export interface RuntimeWorkbenchProjectCreationInput {
  readonly displayName: string;
  readonly hostPath: string;
  readonly idempotencyKey?: string;
  readonly settingsOverrides?: Readonly<Record<string, unknown>>;
}

export interface RuntimeWorkbenchReferenceRefreshInput {
  readonly projectId: string;
}

export interface RuntimeWorkbenchReferenceImportInput {
  readonly projectId: string;
  readonly fileName: string;
  readonly fileContentBase64: string;
  readonly kind: RuntimeWorkbenchReferenceKind;
  readonly sensitive?: boolean;
  readonly autoChunk?: boolean;
  readonly sourceUrl?: string;
}

export interface RuntimeWorkbenchReferenceEnabledInput {
  readonly projectId: string;
  readonly referenceId: string;
  readonly enabled: boolean;
}

export interface RuntimeWorkbenchSkillRefreshInput {
  readonly projectId: string;
}

export interface RuntimeWorkbenchSkillEnabledInput {
  readonly projectId: string;
  readonly skillId: string;
  readonly enabled: boolean;
  readonly version?: string;
}

export type RuntimeWorkbenchHumanDecisionCustomValue =
  | null
  | boolean
  | number
  | string
  | readonly RuntimeWorkbenchHumanDecisionCustomValue[]
  | {
      readonly [key: string]: RuntimeWorkbenchHumanDecisionCustomValue;
    };

export interface RuntimeWorkbenchHumanDecisionInput {
  readonly runId: string;
  readonly humanNodeId: string;
  readonly decision: string;
  readonly by: string;
  readonly customValue?: RuntimeWorkbenchHumanDecisionCustomValue;
  readonly idempotencyKey?: string;
}

export interface RuntimeWorkbenchVersionSnapshotInput {
  readonly workflowId: string;
  readonly idempotencyKey?: string;
}

export interface RuntimeWorkbenchSessionSnapshot {
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly executionPolicy: RuntimeWorkbenchExecutionPolicySnapshot;
  readonly chatInstruction: RuntimeWorkbenchChatInstructionSnapshot;
  readonly artifactAction: RuntimeWorkbenchArtifactActionSnapshot;
  readonly projectCreation: RuntimeWorkbenchProjectCreationSnapshot;
  readonly referenceManagement: RuntimeWorkbenchReferenceManagementSnapshot;
  readonly skillManagement: RuntimeWorkbenchSkillManagementSnapshot;
  readonly humanDecision: RuntimeWorkbenchHumanDecisionSnapshot;
  readonly versionSnapshot: RuntimeWorkbenchVersionSnapshotSnapshot;
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
  readonly submitChatInstruction: (
    input: RuntimeWorkbenchChatInstructionInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly runArtifactAction: (
    input: RuntimeWorkbenchArtifactActionInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly createProject: (
    input: RuntimeWorkbenchProjectCreationInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly refreshReferences: (
    input: RuntimeWorkbenchReferenceRefreshInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly importReference: (
    input: RuntimeWorkbenchReferenceImportInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly setReferenceEnabled: (
    input: RuntimeWorkbenchReferenceEnabledInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly refreshSkills: (
    input: RuntimeWorkbenchSkillRefreshInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly setSkillEnabled: (
    input: RuntimeWorkbenchSkillEnabledInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly submitHumanDecision: (
    input: RuntimeWorkbenchHumanDecisionInput,
  ) => Promise<RuntimeWorkbenchSessionSnapshot>;
  readonly createWorkflowSnapshot: (
    input: RuntimeWorkbenchVersionSnapshotInput,
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
  readonly runtime?: Pick<RuntimeBridge, "fetch"> &
    Partial<Pick<RuntimeBridge, "artifactAction">>;
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
  let chatInstructionSnapshot = createRuntimeWorkbenchChatInstructionSnapshot({
    status: "idle",
    runtimeAvailable: options.runtime !== undefined,
    disposed,
  });
  let artifactActionSnapshot = createRuntimeWorkbenchArtifactActionSnapshot({
    status: "idle",
    runtimeAvailable: options.runtime?.artifactAction !== undefined,
    disposed,
  });
  let projectCreationSnapshot = createRuntimeWorkbenchProjectCreationSnapshot({
    status: "idle",
    runtimeAvailable: options.runtime !== undefined,
    disposed,
  });
  let referenceManagementSnapshot =
    createRuntimeWorkbenchReferenceManagementSnapshot({
      status: "idle",
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    });
  let skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot({
    status: "idle",
    runtimeAvailable: options.runtime !== undefined,
    disposed,
  });
  let humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
    status: "idle",
    runtimeAvailable: options.runtime !== undefined,
    disposed,
  });
  let versionSnapshotSnapshot = createRuntimeWorkbenchVersionSnapshotSnapshot({
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
    chatInstruction: createRuntimeWorkbenchChatInstructionSnapshot({
      ...chatInstructionSnapshot,
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    }),
    artifactAction: createRuntimeWorkbenchArtifactActionSnapshot({
      ...artifactActionSnapshot,
      runtimeAvailable: options.runtime?.artifactAction !== undefined,
      disposed,
    }),
    projectCreation: createRuntimeWorkbenchProjectCreationSnapshot({
      ...projectCreationSnapshot,
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    }),
    referenceManagement: createRuntimeWorkbenchReferenceManagementSnapshot({
      ...referenceManagementSnapshot,
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    }),
    skillManagement: createRuntimeWorkbenchSkillManagementSnapshot({
      ...skillManagementSnapshot,
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    }),
    humanDecision: createRuntimeWorkbenchHumanDecisionSnapshot({
      ...humanDecisionSnapshot,
      runtimeAvailable: options.runtime !== undefined,
      disposed,
    }),
    versionSnapshot: createRuntimeWorkbenchVersionSnapshotSnapshot({
      ...versionSnapshotSnapshot,
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
      chatInstruction: createRuntimeWorkbenchChatInstructionSnapshot({
        ...chatInstructionSnapshot,
        runtimeAvailable: options.runtime !== undefined,
        disposed,
      }),
      artifactAction: createRuntimeWorkbenchArtifactActionSnapshot({
        ...artifactActionSnapshot,
        runtimeAvailable: options.runtime?.artifactAction !== undefined,
        disposed,
      }),
      projectCreation: createRuntimeWorkbenchProjectCreationSnapshot({
        ...projectCreationSnapshot,
        runtimeAvailable: options.runtime !== undefined,
        disposed,
      }),
      referenceManagement: createRuntimeWorkbenchReferenceManagementSnapshot({
        ...referenceManagementSnapshot,
        runtimeAvailable: options.runtime !== undefined,
        disposed,
      }),
      skillManagement: createRuntimeWorkbenchSkillManagementSnapshot({
        ...skillManagementSnapshot,
        runtimeAvailable: options.runtime !== undefined,
        disposed,
      }),
      humanDecision: createRuntimeWorkbenchHumanDecisionSnapshot({
        ...humanDecisionSnapshot,
        runtimeAvailable: options.runtime !== undefined,
        disposed,
      }),
      versionSnapshot: createRuntimeWorkbenchVersionSnapshotSnapshot({
        ...versionSnapshotSnapshot,
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
    submitChatInstruction: async (input) => {
      assertActive();
      const runId = normalizeRuntimeWorkbenchRunOncePathSegment(input.runId);
      const nodeId =
        input.nodeId === undefined
          ? null
          : normalizeRuntimeWorkbenchRunOncePathSegment(input.nodeId);
      const scope = input.nodeId === undefined ? "run" : "node";
      const intent = normalizeRuntimeWorkbenchInstructionIntent(input.intent);
      const instruction = normalizeRuntimeWorkbenchInstruction(
        input.instruction,
      );
      const characterCount =
        instruction === null ? null : input.instruction.length;
      const wordCount =
        instruction === null
          ? null
          : runtimeWorkbenchInstructionWordCount(input.instruction);
      if (
        runId === null ||
        (input.nodeId !== undefined && nodeId === null) ||
        intent === null ||
        instruction === null
      ) {
        chatInstructionSnapshot = createRuntimeWorkbenchChatInstructionSnapshot(
          {
            blockedReason: "invalid_input",
            characterCount,
            intent,
            nodeId,
            runId,
            scope,
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            wordCount,
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench chat instruction input is invalid");
      }
      const requestPath =
        scope === "node" && nodeId !== null
          ? buildRuntimeWorkbenchNodeInstructionPath(runId, nodeId)
          : buildRuntimeWorkbenchRunInstructionPath(runId);
      if (options.runtime === undefined) {
        chatInstructionSnapshot = createRuntimeWorkbenchChatInstructionSnapshot(
          {
            blockedReason: "runtime_unavailable",
            characterCount,
            intent,
            nodeId,
            path: requestPath,
            runId,
            runtimeAvailable: false,
            scope,
            status: "blocked",
            wordCount,
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }

      chatInstructionSnapshot = createRuntimeWorkbenchChatInstructionSnapshot({
        characterCount,
        intent,
        nodeId,
        path: requestPath,
        runId,
        runtimeAvailable: true,
        scope,
        status: "submitting",
        wordCount,
        disposed,
      });
      publishIfChanged(true);
      try {
        const requestBody: RuntimeInstructionRequest = {
          schema_version: "0.1.0",
          scope,
          instruction: input.instruction,
          intent,
          ...(input.correlationId !== undefined
            ? { correlation_id: input.correlationId }
            : {}),
          ...(input.clientCommandId !== undefined
            ? { client_command_id: input.clientCommandId }
            : {}),
          metadata: { cw: { source: "desktop_chat_box" } },
        };
        const response =
          await options.runtime.fetch<RuntimeInstructionAccepted>(requestPath, {
            method: "POST",
            body: JSON.stringify(requestBody),
            ...(input.projectId !== undefined
              ? { projectId: input.projectId }
              : {}),
            ...(input.idempotencyKey !== undefined
              ? { idempotencyKey: input.idempotencyKey }
              : {}),
          });
        if (!response.ok) {
          chatInstructionSnapshot =
            createRuntimeWorkbenchChatInstructionSnapshot({
              blockedReason: "request_failed",
              characterCount,
              intent,
              nodeId,
              path: requestPath,
              runId,
              runtimeAvailable: true,
              scope,
              status: "failed",
              statusCode: response.status,
              wordCount,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const accepted = parseRuntimeWorkbenchInstructionAccepted(
          response.body,
        );
        if (accepted === null) {
          chatInstructionSnapshot =
            createRuntimeWorkbenchChatInstructionSnapshot({
              blockedReason: "response_invalid",
              characterCount,
              intent,
              nodeId,
              path: requestPath,
              runId,
              runtimeAvailable: true,
              scope,
              status: "failed",
              statusCode: response.status,
              wordCount,
              disposed,
            });
          publishIfChanged(true);
          throw new Error(
            "Runtime workbench chat instruction response is invalid",
          );
        }
        chatInstructionSnapshot = createRuntimeWorkbenchChatInstructionSnapshot(
          {
            characterCount,
            commandId: accepted.command_id,
            intent: accepted.intent,
            nodeId: accepted.node_id ?? null,
            path: requestPath,
            runId: accepted.run_id,
            runtimeAvailable: true,
            scope: accepted.scope,
            status: "accepted",
            statusCode: response.status,
            wordCount,
            disposed,
          },
        );
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (chatInstructionSnapshot.status !== "failed") {
          chatInstructionSnapshot =
            createRuntimeWorkbenchChatInstructionSnapshot({
              blockedReason: "request_failed",
              characterCount,
              intent,
              nodeId,
              path: requestPath,
              runId,
              runtimeAvailable: true,
              scope,
              status: "failed",
              wordCount,
              disposed,
            });
          publishIfChanged(true);
        }
        throw error;
      }
    },
    runArtifactAction: async (input) => {
      assertActive();
      const artifactId = normalizeRuntimeWorkbenchRunOncePathSegment(
        input.artifactId,
      );
      const runId =
        input.runId === undefined
          ? null
          : normalizeRuntimeWorkbenchRunOncePathSegment(input.runId);
      const nodeId =
        input.nodeId === undefined
          ? null
          : normalizeRuntimeWorkbenchRunOncePathSegment(input.nodeId);
      const intent =
        input.intent === undefined
          ? undefined
          : normalizeRuntimeWorkbenchInstructionIntent(input.intent);
      if (
        artifactId === null ||
        !isRuntimeWorkbenchArtifactAction(input.action) ||
        (input.runId !== undefined && runId === null) ||
        (input.nodeId !== undefined && nodeId === null) ||
        intent === null
      ) {
        artifactActionSnapshot = createRuntimeWorkbenchArtifactActionSnapshot({
          action: input.action,
          artifactId,
          blockedReason: "invalid_input",
          nodeId,
          runId,
          runtimeAvailable: options.runtime?.artifactAction !== undefined,
          status: "blocked",
          disposed,
        });
        publishIfChanged(true);
        throw new Error("Runtime workbench artifact action input is invalid");
      }
      if (options.runtime?.artifactAction === undefined) {
        artifactActionSnapshot = createRuntimeWorkbenchArtifactActionSnapshot({
          action: input.action,
          artifactId,
          blockedReason: "runtime_unavailable",
          nodeId,
          runId,
          runtimeAvailable: false,
          status: "blocked",
          disposed,
        });
        publishIfChanged(true);
        throw new Error(
          "Runtime workbench artifact action bridge is unavailable",
        );
      }

      artifactActionSnapshot = createRuntimeWorkbenchArtifactActionSnapshot({
        action: input.action,
        artifactId,
        nodeId,
        runId,
        runtimeAvailable: true,
        status: "running",
        disposed,
      });
      publishIfChanged(true);
      try {
        const response = await options.runtime.artifactAction({
          schema_version: "0.1.0",
          artifact_id: artifactId,
          action: input.action,
          ...(runId !== null ? { run_id: runId } : {}),
          ...(nodeId !== null ? { node_id: nodeId } : {}),
          ...(intent !== undefined ? { intent } : {}),
          ...(input.requestedDestinationKind !== undefined
            ? { requested_destination_kind: input.requestedDestinationKind }
            : {}),
          ...(input.artifactSensitivity !== undefined
            ? { artifact_sensitivity: input.artifactSensitivity }
            : {}),
          ...(input.allowSensitiveExport !== undefined
            ? { allow_sensitive_export: input.allowSensitiveExport }
            : {}),
          ...(input.correlationId !== undefined
            ? { correlation_id: input.correlationId }
            : {}),
        });
        const result = parseRuntimeWorkbenchArtifactActionResult(response);
        if (result === null) {
          artifactActionSnapshot = createRuntimeWorkbenchArtifactActionSnapshot(
            {
              action: input.action,
              artifactId,
              blockedReason: "response_invalid",
              nodeId,
              runId,
              runtimeAvailable: true,
              status: "failed",
              disposed,
            },
          );
          publishIfChanged(true);
          throw new Error(
            "Runtime workbench artifact action response is invalid",
          );
        }
        artifactActionSnapshot = createRuntimeWorkbenchArtifactActionSnapshot({
          action: result.action,
          artifactId: result.artifact_id,
          byteCount: result.byte_count ?? null,
          contentHash: result.content_hash ?? null,
          contentType: result.content_type ?? null,
          correlationId: result.correlation_id ?? null,
          destinationKind: result.destination_kind,
          errorCode: result.error_code ?? null,
          nodeId,
          runId,
          runtimeAvailable: true,
          sensitive: result.sensitive ?? false,
          status: result.status,
          disposed,
        });
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (artifactActionSnapshot.status !== "failed") {
          artifactActionSnapshot = createRuntimeWorkbenchArtifactActionSnapshot(
            {
              action: input.action,
              artifactId,
              blockedReason: "request_failed",
              nodeId,
              runId,
              runtimeAvailable: true,
              status: "failed",
              disposed,
            },
          );
          publishIfChanged(true);
        }
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
    refreshReferences: async (input) => {
      assertActive();
      const projectId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.projectId,
      );
      if (projectId === null) {
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            blockedReason: "invalid_input",
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            disposed,
          });
        publishIfChanged(true);
        throw new Error("Runtime workbench reference project id is invalid");
      }
      const requestPath = buildRuntimeWorkbenchReferencesPath(projectId);
      if (options.runtime === undefined) {
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            activeProjectId: projectId,
            blockedReason: "runtime_unavailable",
            path: requestPath,
            runtimeAvailable: false,
            status: "blocked",
            disposed,
          });
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }
      referenceManagementSnapshot =
        createRuntimeWorkbenchReferenceManagementSnapshot({
          activeProjectId: projectId,
          entries: referenceManagementSnapshot.entries,
          indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
          method: "GET",
          path: requestPath,
          runtimeAvailable: true,
          status: "refreshing",
          disposed,
        });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath);
        if (!response.ok) {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: referenceManagementSnapshot.entries,
              indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
              method: "GET",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const parsed = parseRuntimeWorkbenchReferenceManifest(response.body);
        if (parsed === null) {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "response_invalid",
              method: "GET",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error("Runtime workbench reference manifest is invalid");
        }
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            activeProjectId: projectId,
            entries: parsed.entries,
            indexSnapshotId: parsed.indexSnapshotId,
            method: "GET",
            path: requestPath,
            runtimeAvailable: true,
            status: "succeeded",
            statusCode: response.status,
            disposed,
          });
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (referenceManagementSnapshot.status !== "failed") {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: referenceManagementSnapshot.entries,
              indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
              method: "GET",
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
    importReference: async (input) => {
      assertActive();
      const projectId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.projectId,
      );
      const fileName = normalizeRuntimeWorkbenchReferenceFileName(
        input.fileName,
      );
      const sourceUrl = normalizeRuntimeWorkbenchReferenceOptionalText(
        input.sourceUrl,
      );
      const fileContentBase64 = normalizeRuntimeWorkbenchReferenceBase64(
        input.fileContentBase64,
      );
      if (
        projectId === null ||
        fileName === null ||
        fileContentBase64 === null ||
        !isRuntimeWorkbenchReferenceKind(input.kind)
      ) {
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            blockedReason: "invalid_input",
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            disposed,
          });
        publishIfChanged(true);
        throw new Error("Runtime workbench reference import input is invalid");
      }
      const requestPath = buildRuntimeWorkbenchReferencesPath(projectId);
      if (options.runtime === undefined) {
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            activeProjectId: projectId,
            blockedReason: "runtime_unavailable",
            path: requestPath,
            runtimeAvailable: false,
            status: "blocked",
            disposed,
          });
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }
      referenceManagementSnapshot =
        createRuntimeWorkbenchReferenceManagementSnapshot({
          activeProjectId: projectId,
          entries: referenceManagementSnapshot.entries,
          indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
          method: "POST",
          path: requestPath,
          runtimeAvailable: true,
          status: "importing",
          disposed,
        });
      publishIfChanged(true);
      try {
        const multipart = buildRuntimeWorkbenchReferenceMultipartBody({
          autoChunk: input.autoChunk ?? true,
          fileContentBase64,
          fileName,
          kind: input.kind,
          sensitive: input.sensitive ?? false,
          sourceUrl,
        });
        const response = await options.runtime.fetch(requestPath, {
          method: "POST",
          headers: { "Content-Type": multipart.contentType },
          bodyBase64: multipart.bodyBase64,
        });
        if (!response.ok) {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: referenceManagementSnapshot.entries,
              indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
              method: "POST",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const entry = parseRuntimeWorkbenchReferenceEntry(response.body);
        if (entry === null) {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "response_invalid",
              method: "POST",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error("Runtime workbench reference response is invalid");
        }
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            activeProjectId: projectId,
            entries: upsertRuntimeWorkbenchReferenceEntry(
              referenceManagementSnapshot.entries,
              entry,
            ),
            indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
            lastReferenceId: entry.referenceId,
            method: "POST",
            path: requestPath,
            runtimeAvailable: true,
            status: "succeeded",
            statusCode: response.status,
            disposed,
          });
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (referenceManagementSnapshot.status !== "failed") {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: referenceManagementSnapshot.entries,
              indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
              method: "POST",
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
    setReferenceEnabled: async (input) => {
      assertActive();
      const projectId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.projectId,
      );
      const referenceId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.referenceId,
      );
      if (projectId === null || referenceId === null) {
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            blockedReason: "invalid_input",
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            disposed,
          });
        publishIfChanged(true);
        throw new Error("Runtime workbench reference update input is invalid");
      }
      const requestPath = buildRuntimeWorkbenchReferencePath(
        projectId,
        referenceId,
      );
      if (options.runtime === undefined) {
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            activeProjectId: projectId,
            blockedReason: "runtime_unavailable",
            lastReferenceId: referenceId,
            path: requestPath,
            runtimeAvailable: false,
            status: "blocked",
            disposed,
          });
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }
      referenceManagementSnapshot =
        createRuntimeWorkbenchReferenceManagementSnapshot({
          activeProjectId: projectId,
          entries: referenceManagementSnapshot.entries,
          indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
          lastReferenceId: referenceId,
          method: "PATCH",
          path: requestPath,
          runtimeAvailable: true,
          status: "updating",
          disposed,
        });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath, {
          method: "PATCH",
          body: JSON.stringify({
            schema_version: "0.1.0",
            enabled: input.enabled,
          }),
        });
        if (!response.ok) {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: referenceManagementSnapshot.entries,
              indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
              lastReferenceId: referenceId,
              method: "PATCH",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const entry = parseRuntimeWorkbenchReferenceEntry(response.body);
        if (entry === null) {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "response_invalid",
              lastReferenceId: referenceId,
              method: "PATCH",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error("Runtime workbench reference response is invalid");
        }
        referenceManagementSnapshot =
          createRuntimeWorkbenchReferenceManagementSnapshot({
            activeProjectId: projectId,
            entries: upsertRuntimeWorkbenchReferenceEntry(
              referenceManagementSnapshot.entries,
              entry,
            ),
            indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
            lastReferenceId: entry.referenceId,
            method: "PATCH",
            path: requestPath,
            runtimeAvailable: true,
            status: "succeeded",
            statusCode: response.status,
            disposed,
          });
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (referenceManagementSnapshot.status !== "failed") {
          referenceManagementSnapshot =
            createRuntimeWorkbenchReferenceManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: referenceManagementSnapshot.entries,
              indexSnapshotId: referenceManagementSnapshot.indexSnapshotId,
              lastReferenceId: referenceId,
              method: "PATCH",
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
    refreshSkills: async (input) => {
      assertActive();
      const projectId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.projectId,
      );
      if (projectId === null) {
        skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot(
          {
            blockedReason: "invalid_input",
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench Skill project id is invalid");
      }
      const requestPath = buildRuntimeWorkbenchSkillsPath(projectId);
      if (options.runtime === undefined) {
        skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot(
          {
            activeProjectId: projectId,
            blockedReason: "runtime_unavailable",
            path: requestPath,
            runtimeAvailable: false,
            status: "blocked",
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }
      skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot({
        activeProjectId: projectId,
        entries: skillManagementSnapshot.entries,
        method: "GET",
        path: requestPath,
        runtimeAvailable: true,
        status: "refreshing",
        disposed,
      });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath);
        if (!response.ok) {
          skillManagementSnapshot =
            createRuntimeWorkbenchSkillManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: skillManagementSnapshot.entries,
              method: "GET",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const entries = parseRuntimeWorkbenchSkillEntries(response.body);
        if (entries === null) {
          skillManagementSnapshot =
            createRuntimeWorkbenchSkillManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "response_invalid",
              method: "GET",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error("Runtime workbench Skill manifest is invalid");
        }
        skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot(
          {
            activeProjectId: projectId,
            entries,
            method: "GET",
            path: requestPath,
            runtimeAvailable: true,
            status: "succeeded",
            statusCode: response.status,
            disposed,
          },
        );
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (skillManagementSnapshot.status !== "failed") {
          skillManagementSnapshot =
            createRuntimeWorkbenchSkillManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: skillManagementSnapshot.entries,
              method: "GET",
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
    setSkillEnabled: async (input) => {
      assertActive();
      const projectId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.projectId,
      );
      const skillId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.skillId,
      );
      const version =
        input.version === undefined
          ? undefined
          : normalizeRuntimeWorkbenchReferenceOptionalText(input.version);
      if (
        projectId === null ||
        skillId === null ||
        (input.version !== undefined && (version === null || version === ""))
      ) {
        skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot(
          {
            blockedReason: "invalid_input",
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench Skill update input is invalid");
      }
      const requestPath = buildRuntimeWorkbenchSkillsPath(projectId);
      if (options.runtime === undefined) {
        skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot(
          {
            activeProjectId: projectId,
            blockedReason: "runtime_unavailable",
            lastSkillId: skillId,
            path: requestPath,
            runtimeAvailable: false,
            status: "blocked",
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }
      skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot({
        activeProjectId: projectId,
        entries: skillManagementSnapshot.entries,
        lastSkillId: skillId,
        method: "PATCH",
        path: requestPath,
        runtimeAvailable: true,
        status: "updating",
        disposed,
      });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath, {
          method: "PATCH",
          body: JSON.stringify({
            schema_version: "0.1.0",
            skill_id: skillId,
            enabled: input.enabled,
            ...(version === undefined ? {} : { version }),
          }),
        });
        if (!response.ok) {
          skillManagementSnapshot =
            createRuntimeWorkbenchSkillManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: skillManagementSnapshot.entries,
              lastSkillId: skillId,
              method: "PATCH",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const entry = parseRuntimeWorkbenchSkillEntry(response.body);
        if (entry === null) {
          skillManagementSnapshot =
            createRuntimeWorkbenchSkillManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "response_invalid",
              lastSkillId: skillId,
              method: "PATCH",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              disposed,
            });
          publishIfChanged(true);
          throw new Error("Runtime workbench Skill response is invalid");
        }
        skillManagementSnapshot = createRuntimeWorkbenchSkillManagementSnapshot(
          {
            activeProjectId: projectId,
            entries: upsertRuntimeWorkbenchSkillEntry(
              skillManagementSnapshot.entries,
              entry,
            ),
            lastSkillId: entry.skillId,
            method: "PATCH",
            path: requestPath,
            runtimeAvailable: true,
            status: "succeeded",
            statusCode: response.status,
            disposed,
          },
        );
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (skillManagementSnapshot.status !== "failed") {
          skillManagementSnapshot =
            createRuntimeWorkbenchSkillManagementSnapshot({
              activeProjectId: projectId,
              blockedReason: "request_failed",
              entries: skillManagementSnapshot.entries,
              lastSkillId: skillId,
              method: "PATCH",
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
    submitHumanDecision: async (input) => {
      assertActive();
      const runId = normalizeRuntimeWorkbenchRunOncePathSegment(input.runId);
      const humanNodeId = normalizeRuntimeWorkbenchRunOncePathSegment(
        input.humanNodeId,
      );
      const decision = normalizeRuntimeWorkbenchHumanDecisionKey(
        input.decision,
      );
      const by = normalizeRuntimeWorkbenchHumanDecisionText(input.by, 200);
      const customValue = normalizeRuntimeWorkbenchHumanDecisionCustomValue(
        input.customValue,
      );
      if (
        runId === null ||
        humanNodeId === null ||
        decision === null ||
        by === null ||
        customValue === null
      ) {
        humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
          blockedReason: "invalid_input",
          runtimeAvailable: options.runtime !== undefined,
          status: "blocked",
          disposed,
        });
        publishIfChanged(true);
        throw new Error("Runtime workbench human decision input is invalid");
      }
      const requestPath = buildRuntimeWorkbenchHumanDecisionPath(runId);
      if (options.runtime === undefined) {
        humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
          blockedReason: "runtime_unavailable",
          by,
          customValuePresent: customValue !== undefined && customValue !== null,
          decision,
          humanNodeId,
          path: requestPath,
          runId,
          runtimeAvailable: false,
          status: "blocked",
          disposed,
        });
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }
      humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
        by,
        customValuePresent: customValue !== undefined && customValue !== null,
        decision,
        humanNodeId,
        path: requestPath,
        runId,
        runtimeAvailable: true,
        status: "submitting",
        disposed,
      });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath, {
          method: "POST",
          body: JSON.stringify({
            schema_version: "0.1.0",
            human_node_id: humanNodeId,
            decision,
            by,
            ...(customValue === undefined ? {} : { custom_value: customValue }),
          }),
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        });
        if (!response.ok) {
          humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
            blockedReason: "request_failed",
            by,
            customValuePresent:
              customValue !== undefined && customValue !== null,
            decision,
            humanNodeId,
            path: requestPath,
            runId,
            runtimeAvailable: true,
            status: "failed",
            statusCode: response.status,
            disposed,
          });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const record = parseRuntimeWorkbenchHumanDecisionRecord(response.body);
        if (record === null) {
          humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
            blockedReason: "response_invalid",
            by,
            customValuePresent:
              customValue !== undefined && customValue !== null,
            decision,
            humanNodeId,
            path: requestPath,
            runId,
            runtimeAvailable: true,
            status: "failed",
            statusCode: response.status,
            disposed,
          });
          publishIfChanged(true);
          throw new Error(
            "Runtime workbench human decision response is invalid",
          );
        }
        humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
          by: record.by,
          customValuePresent: record.customValuePresent,
          decidedAt: record.decidedAt,
          decision: record.decision,
          humanNodeId: record.humanNodeId,
          path: requestPath,
          requestedAt: record.requestedAt,
          runId,
          runtimeAvailable: true,
          status: "succeeded",
          statusCode: response.status,
          disposed,
        });
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (humanDecisionSnapshot.status !== "failed") {
          humanDecisionSnapshot = createRuntimeWorkbenchHumanDecisionSnapshot({
            blockedReason: "request_failed",
            by,
            customValuePresent:
              customValue !== undefined && customValue !== null,
            decision,
            humanNodeId,
            path: requestPath,
            runId,
            runtimeAvailable: true,
            status: "failed",
            disposed,
          });
          publishIfChanged(true);
        }
        throw error;
      }
    },
    createWorkflowSnapshot: async (input) => {
      assertActive();
      const workflowId = normalizeRuntimeWorkbenchReferencePathSegment(
        input.workflowId,
      );
      if (workflowId === null) {
        versionSnapshotSnapshot = createRuntimeWorkbenchVersionSnapshotSnapshot(
          {
            blockedReason: "invalid_input",
            runtimeAvailable: options.runtime !== undefined,
            status: "blocked",
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench workflow snapshot input is invalid");
      }
      const requestPath = buildRuntimeWorkbenchWorkflowSnapshotPath(workflowId);
      if (options.runtime === undefined) {
        versionSnapshotSnapshot = createRuntimeWorkbenchVersionSnapshotSnapshot(
          {
            blockedReason: "runtime_unavailable",
            path: requestPath,
            runtimeAvailable: false,
            status: "blocked",
            workflowId,
            disposed,
          },
        );
        publishIfChanged(true);
        throw new Error("Runtime workbench runtime bridge is unavailable");
      }
      versionSnapshotSnapshot = createRuntimeWorkbenchVersionSnapshotSnapshot({
        path: requestPath,
        runtimeAvailable: true,
        status: "creating",
        workflowId,
        disposed,
      });
      publishIfChanged(true);
      try {
        const response = await options.runtime.fetch(requestPath, {
          method: "POST",
          body: JSON.stringify({
            schema_version: "0.1.0",
          }),
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        });
        if (!response.ok) {
          versionSnapshotSnapshot =
            createRuntimeWorkbenchVersionSnapshotSnapshot({
              blockedReason: "request_failed",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              workflowId,
              disposed,
            });
          publishIfChanged(true);
          return captureSnapshot();
        }
        const parsed = parseRuntimeWorkbenchVersionSnapshotRecord(
          response.body,
        );
        if (parsed === null) {
          versionSnapshotSnapshot =
            createRuntimeWorkbenchVersionSnapshotSnapshot({
              blockedReason: "response_invalid",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              statusCode: response.status,
              workflowId,
              disposed,
            });
          publishIfChanged(true);
          throw new Error(
            "Runtime workbench workflow snapshot response is invalid",
          );
        }
        versionSnapshotSnapshot = createRuntimeWorkbenchVersionSnapshotSnapshot(
          {
            commitSha: parsed.commitSha,
            createdAt: parsed.createdAt,
            path: requestPath,
            runtimeAvailable: true,
            snapshotId: parsed.snapshotId,
            status: "succeeded",
            statusCode: response.status,
            workflowId,
            disposed,
          },
        );
        publishIfChanged(true);
        return captureSnapshot();
      } catch (error) {
        if (versionSnapshotSnapshot.status !== "failed") {
          versionSnapshotSnapshot =
            createRuntimeWorkbenchVersionSnapshotSnapshot({
              blockedReason: "request_failed",
              path: requestPath,
              runtimeAvailable: true,
              status: "failed",
              workflowId,
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

function createRuntimeWorkbenchChatInstructionSnapshot(
  input: Partial<RuntimeWorkbenchChatInstructionSnapshot> & {
    readonly status: RuntimeWorkbenchChatInstructionStatus;
    readonly runtimeAvailable: boolean;
    readonly disposed: boolean;
  },
): RuntimeWorkbenchChatInstructionSnapshot {
  return Object.freeze({
    status: input.status,
    method: "POST",
    path: input.path ?? null,
    runId: input.runId ?? null,
    nodeId: input.nodeId ?? null,
    scope: input.scope ?? null,
    intent: input.intent ?? null,
    commandId: input.commandId ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    characterCount: input.characterCount ?? null,
    wordCount: input.wordCount ?? null,
    canSubmitInstruction:
      !input.disposed &&
      input.runtimeAvailable &&
      input.status !== "submitting",
  });
}

function createRuntimeWorkbenchArtifactActionSnapshot(
  input: Partial<RuntimeWorkbenchArtifactActionSnapshot> & {
    readonly status: RuntimeWorkbenchArtifactActionStatus;
    readonly runtimeAvailable: boolean;
    readonly disposed: boolean;
  },
): RuntimeWorkbenchArtifactActionSnapshot {
  return Object.freeze({
    status: input.status,
    artifactId: input.artifactId ?? null,
    action: input.action ?? null,
    runId: input.runId ?? null,
    nodeId: input.nodeId ?? null,
    destinationKind: input.destinationKind ?? null,
    contentType: input.contentType ?? null,
    byteCount: input.byteCount ?? null,
    contentHash: input.contentHash ?? null,
    sensitive: input.sensitive ?? false,
    errorCode: input.errorCode ?? null,
    correlationId: input.correlationId ?? null,
    blockedReason: input.blockedReason ?? null,
    canRunArtifactAction:
      !input.disposed && input.runtimeAvailable && input.status !== "running",
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

function createRuntimeWorkbenchReferenceManagementSnapshot(
  input: Partial<RuntimeWorkbenchReferenceManagementSnapshot> & {
    readonly status: RuntimeWorkbenchReferenceManagementStatus;
    readonly runtimeAvailable: boolean;
    readonly disposed: boolean;
  },
): RuntimeWorkbenchReferenceManagementSnapshot {
  const entries = Object.freeze([...(input.entries ?? [])]);
  return Object.freeze({
    status: input.status,
    activeProjectId: input.activeProjectId ?? null,
    method: input.method ?? null,
    path: input.path ?? null,
    entries,
    indexSnapshotId: input.indexSnapshotId ?? null,
    lastReferenceId: input.lastReferenceId ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    canRefreshReferences:
      !input.disposed &&
      input.runtimeAvailable &&
      input.status !== "refreshing",
    canImportReference:
      !input.disposed && input.runtimeAvailable && input.status !== "importing",
    canUpdateReference:
      !input.disposed && input.runtimeAvailable && input.status !== "updating",
  });
}

function createRuntimeWorkbenchSkillManagementSnapshot(
  input: Partial<RuntimeWorkbenchSkillManagementSnapshot> & {
    readonly status: RuntimeWorkbenchSkillManagementStatus;
    readonly runtimeAvailable: boolean;
    readonly disposed: boolean;
  },
): RuntimeWorkbenchSkillManagementSnapshot {
  const entries = Object.freeze([...(input.entries ?? [])]);
  return Object.freeze({
    status: input.status,
    activeProjectId: input.activeProjectId ?? null,
    method: input.method ?? null,
    path: input.path ?? null,
    entries,
    lastSkillId: input.lastSkillId ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    canRefreshSkills:
      !input.disposed &&
      input.runtimeAvailable &&
      input.status !== "refreshing",
    canUpdateSkill:
      !input.disposed && input.runtimeAvailable && input.status !== "updating",
  });
}

function createRuntimeWorkbenchHumanDecisionSnapshot(
  input: Partial<RuntimeWorkbenchHumanDecisionSnapshot> & {
    readonly status: RuntimeWorkbenchHumanDecisionStatus;
    readonly runtimeAvailable: boolean;
    readonly disposed: boolean;
  },
): RuntimeWorkbenchHumanDecisionSnapshot {
  return Object.freeze({
    status: input.status,
    method: "POST",
    path: input.path ?? null,
    runId: input.runId ?? null,
    humanNodeId: input.humanNodeId ?? null,
    decision: input.decision ?? null,
    by: input.by ?? null,
    customValuePresent: input.customValuePresent ?? false,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    decidedAt: input.decidedAt ?? null,
    requestedAt: input.requestedAt ?? null,
    canSubmitDecision:
      !input.disposed &&
      input.runtimeAvailable &&
      input.status !== "submitting",
  });
}

function createRuntimeWorkbenchVersionSnapshotSnapshot(
  input: Partial<RuntimeWorkbenchVersionSnapshotSnapshot> & {
    readonly status: RuntimeWorkbenchVersionSnapshotStatus;
    readonly runtimeAvailable: boolean;
    readonly disposed: boolean;
  },
): RuntimeWorkbenchVersionSnapshotSnapshot {
  return Object.freeze({
    status: input.status,
    method: "POST",
    path: input.path ?? null,
    workflowId: input.workflowId ?? null,
    snapshotId: input.snapshotId ?? null,
    commitSha: input.commitSha ?? null,
    createdAt: input.createdAt ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    canCreateSnapshot:
      !input.disposed && input.runtimeAvailable && input.status !== "creating",
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

function buildRuntimeWorkbenchRunInstructionPath(
  runId: string,
): RuntimeRequestPath {
  const requestPath = `/runs/${encodeURIComponent(runId)}:submit-instruction`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
}

function buildRuntimeWorkbenchNodeInstructionPath(
  runId: string,
  nodeId: string,
): RuntimeRequestPath {
  const requestPath = `/runs/${encodeURIComponent(
    runId,
  )}/nodes/${encodeURIComponent(nodeId)}:submit-instruction`;
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

function normalizeRuntimeWorkbenchInstructionIntent(
  value: string,
): RuntimeWorkbenchInstructionIntent | null {
  switch (value) {
    case "ask":
    case "revise":
    case "repair":
      return value;
    default:
      return null;
  }
}

function normalizeRuntimeWorkbenchInstruction(value: string): string | null {
  if (
    value.trim().length === 0 ||
    value.length > 20_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function runtimeWorkbenchInstructionWordCount(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/u).length;
}

function isRuntimeWorkbenchArtifactAction(
  action: string,
): action is "open" | "download" {
  return action === "open" || action === "download";
}

function buildRuntimeWorkbenchProjectCreationPath(): RuntimeRequestPath {
  const requestPath = "/projects";
  assertRuntimeRequestPath(requestPath);
  return requestPath;
}

function buildRuntimeWorkbenchReferencesPath(
  projectId: string,
): RuntimeRequestPath {
  const requestPath = `/projects/${encodeURIComponent(projectId)}/references`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
}

function buildRuntimeWorkbenchReferencePath(
  projectId: string,
  referenceId: string,
): RuntimeRequestPath {
  const requestPath = `${buildRuntimeWorkbenchReferencesPath(
    projectId,
  )}/${encodeURIComponent(referenceId)}`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
}

function buildRuntimeWorkbenchSkillsPath(
  projectId: string,
): RuntimeRequestPath {
  const requestPath = `/projects/${encodeURIComponent(projectId)}/skills`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
}

function buildRuntimeWorkbenchHumanDecisionPath(
  runId: string,
): RuntimeRequestPath {
  const requestPath = `/runs/${encodeURIComponent(runId)}/decisions`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
}

function buildRuntimeWorkbenchWorkflowSnapshotPath(
  workflowId: string,
): RuntimeRequestPath {
  const requestPath = `/workflows/${encodeURIComponent(workflowId)}/snapshot`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
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

function normalizeRuntimeWorkbenchReferencePathSegment(
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

function normalizeRuntimeWorkbenchReferenceFileName(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 180 ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function normalizeRuntimeWorkbenchReferenceOptionalText(
  value: string | undefined,
): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeRuntimeWorkbenchHumanDecisionKey(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 64 ||
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

function normalizeRuntimeWorkbenchHumanDecisionText(
  value: string,
  maxLength: number,
): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function normalizeRuntimeWorkbenchHumanDecisionCustomValue(
  value: RuntimeWorkbenchHumanDecisionCustomValue | undefined,
): RuntimeWorkbenchHumanDecisionCustomValue | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return isRuntimeWorkbenchHumanDecisionCustomValue(value) ? value : null;
}

function isRuntimeWorkbenchHumanDecisionCustomValue(
  value: unknown,
  depth = 0,
): value is RuntimeWorkbenchHumanDecisionCustomValue {
  if (depth > 12) {
    return false;
  }
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) {
        return value.every((item) =>
          isRuntimeWorkbenchHumanDecisionCustomValue(item, depth + 1),
        );
      }
      if (!isRecord(value)) {
        return false;
      }
      return Object.values(value).every((item) =>
        isRuntimeWorkbenchHumanDecisionCustomValue(item, depth + 1),
      );
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      return false;
  }
  return false;
}

function normalizeRuntimeWorkbenchReferenceBase64(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      trimmed,
    )
  ) {
    return null;
  }
  return trimmed;
}

function isRuntimeWorkbenchReferenceKind(
  value: string,
): value is RuntimeWorkbenchReferenceKind {
  return (
    value === "pdf" ||
    value === "md" ||
    value === "txt" ||
    value === "csv" ||
    value === "xlsx" ||
    value === "image" ||
    value === "web_url"
  );
}

function isRuntimeWorkbenchReferenceChunkStatus(
  value: string,
): value is RuntimeWorkbenchReferenceChunkStatus {
  return (
    value === "none" ||
    value === "chunked" ||
    value === "indexed" ||
    value === "stale"
  );
}

interface ParsedRuntimeWorkbenchProjectCreationResponse {
  readonly projectId: string;
  readonly hostPath: string;
  readonly gitInitialized: boolean;
  readonly firstCommitSha: string | null;
}

function parseRuntimeWorkbenchInstructionAccepted(
  body: unknown,
): RuntimeInstructionAccepted | null {
  if (!isRecord(body)) {
    return null;
  }
  if (
    !(body.schema_version === undefined || body.schema_version === "0.1.0") ||
    typeof body.command_id !== "string" ||
    body.command_id.trim().length === 0 ||
    body.status !== "accepted" ||
    typeof body.run_id !== "string" ||
    body.run_id.trim().length === 0 ||
    typeof body.scope !== "string" ||
    typeof body.intent !== "string" ||
    normalizeRuntimeWorkbenchInstructionIntent(body.intent) === null ||
    !(body.scope === "run" || body.scope === "node") ||
    typeof body.accepted_at !== "string" ||
    body.accepted_at.trim().length === 0 ||
    !(
      body.node_id === undefined ||
      body.node_id === null ||
      typeof body.node_id === "string"
    ) ||
    !(
      body.stream_url === undefined ||
      body.stream_url === null ||
      typeof body.stream_url === "string"
    ) ||
    !(
      body.correlation_id === undefined ||
      body.correlation_id === null ||
      typeof body.correlation_id === "string"
    )
  ) {
    return null;
  }
  return body as unknown as RuntimeInstructionAccepted;
}

function parseRuntimeWorkbenchArtifactActionResult(
  body: unknown,
): RuntimeArtifactActionResult | null {
  if (!isRecord(body)) {
    return null;
  }
  if (
    !(body.schema_version === undefined || body.schema_version === "0.1.0") ||
    typeof body.artifact_id !== "string" ||
    body.artifact_id.trim().length === 0 ||
    typeof body.action !== "string" ||
    !isRuntimeWorkbenchArtifactAction(body.action) ||
    typeof body.status !== "string" ||
    !(
      body.status === "succeeded" ||
      body.status === "failed" ||
      body.status === "blocked" ||
      body.status === "cancelled"
    ) ||
    typeof body.destination_kind !== "string" ||
    !(
      body.destination_kind === "project_temp" ||
      body.destination_kind === "project_artifact" ||
      body.destination_kind === "user_selected" ||
      body.destination_kind === "native_shell" ||
      body.destination_kind === "none"
    ) ||
    !(
      body.content_type === undefined ||
      body.content_type === null ||
      typeof body.content_type === "string"
    ) ||
    !(
      body.byte_count === undefined ||
      body.byte_count === null ||
      (typeof body.byte_count === "number" &&
        Number.isInteger(body.byte_count) &&
        body.byte_count >= 0)
    ) ||
    !(
      body.content_hash === undefined ||
      body.content_hash === null ||
      typeof body.content_hash === "string"
    ) ||
    !(body.sensitive === undefined || typeof body.sensitive === "boolean") ||
    !(
      body.error_code === undefined ||
      body.error_code === null ||
      typeof body.error_code === "string"
    ) ||
    !(
      body.correlation_id === undefined ||
      body.correlation_id === null ||
      typeof body.correlation_id === "string"
    )
  ) {
    return null;
  }
  return body as unknown as RuntimeArtifactActionResult;
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

interface ParsedRuntimeWorkbenchReferenceManifest {
  readonly entries: readonly RuntimeWorkbenchReferenceEntrySnapshot[];
  readonly indexSnapshotId: string;
}

function parseRuntimeWorkbenchReferenceManifest(
  body: unknown,
): ParsedRuntimeWorkbenchReferenceManifest | null {
  if (!isRecord(body)) {
    return null;
  }
  const entries = body.entries;
  const indexSnapshotId = body.index_snapshot_id;
  if (!Array.isArray(entries) || typeof indexSnapshotId !== "string") {
    return null;
  }
  const parsedEntries: RuntimeWorkbenchReferenceEntrySnapshot[] = [];
  for (const entry of entries) {
    const parsed = parseRuntimeWorkbenchReferenceEntry(entry);
    if (parsed === null) {
      return null;
    }
    parsedEntries.push(parsed);
  }
  return {
    entries: Object.freeze(parsedEntries),
    indexSnapshotId,
  };
}

function parseRuntimeWorkbenchReferenceEntry(
  body: unknown,
): RuntimeWorkbenchReferenceEntrySnapshot | null {
  if (!isRecord(body)) {
    return null;
  }
  const referenceId = body.reference_id;
  const path = body.path;
  const kind = body.kind;
  const enabled = body.enabled;
  const sourceUrl = body.source_url;
  const contentHash = body.content_hash;
  const chunkStatus = body.chunk_status;
  const chunkSizeTokens = body.chunk_size_tokens;
  const sensitive = body.sensitive;
  const importedAt = body.imported_at;
  if (
    typeof referenceId !== "string" ||
    referenceId.trim().length === 0 ||
    typeof path !== "string" ||
    path.trim().length === 0 ||
    typeof kind !== "string" ||
    !isRuntimeWorkbenchReferenceKind(kind) ||
    typeof enabled !== "boolean" ||
    !(
      sourceUrl === undefined ||
      sourceUrl === null ||
      typeof sourceUrl === "string"
    ) ||
    typeof contentHash !== "string" ||
    contentHash.trim().length === 0 ||
    typeof chunkStatus !== "string" ||
    !isRuntimeWorkbenchReferenceChunkStatus(chunkStatus) ||
    !(
      chunkSizeTokens === undefined ||
      chunkSizeTokens === null ||
      (typeof chunkSizeTokens === "number" &&
        Number.isInteger(chunkSizeTokens) &&
        chunkSizeTokens > 0)
    ) ||
    typeof sensitive !== "boolean" ||
    typeof importedAt !== "string" ||
    importedAt.trim().length === 0
  ) {
    return null;
  }
  return Object.freeze({
    referenceId,
    path,
    kind,
    enabled,
    sourceUrl: sourceUrl ?? null,
    contentHash,
    chunkStatus,
    chunkSizeTokens: chunkSizeTokens ?? null,
    sensitive,
    importedAt,
  });
}

function upsertRuntimeWorkbenchReferenceEntry(
  entries: readonly RuntimeWorkbenchReferenceEntrySnapshot[],
  entry: RuntimeWorkbenchReferenceEntrySnapshot,
): readonly RuntimeWorkbenchReferenceEntrySnapshot[] {
  let replaced = false;
  const nextEntries = entries.map((candidate) => {
    if (candidate.referenceId !== entry.referenceId) {
      return candidate;
    }
    replaced = true;
    return entry;
  });
  if (!replaced) {
    nextEntries.push(entry);
  }
  return Object.freeze(nextEntries);
}

function parseRuntimeWorkbenchSkillEntries(
  body: unknown,
): readonly RuntimeWorkbenchSkillEntrySnapshot[] | null {
  if (!Array.isArray(body)) {
    return null;
  }
  const entries: RuntimeWorkbenchSkillEntrySnapshot[] = [];
  for (const item of body) {
    const parsed = parseRuntimeWorkbenchSkillEntry(item);
    if (parsed === null) {
      return null;
    }
    entries.push(parsed);
  }
  return Object.freeze(entries);
}

function parseRuntimeWorkbenchSkillEntry(
  body: unknown,
): RuntimeWorkbenchSkillEntrySnapshot | null {
  if (!isRecord(body)) {
    return null;
  }
  const skillId = body.skill_id;
  const version = body.version;
  const enabled = body.enabled;
  if (
    typeof skillId !== "string" ||
    skillId.trim().length === 0 ||
    typeof version !== "string" ||
    version.trim().length === 0 ||
    typeof enabled !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({
    skillId,
    version,
    enabled,
    paramKeys: Object.freeze([]),
  });
}

function upsertRuntimeWorkbenchSkillEntry(
  entries: readonly RuntimeWorkbenchSkillEntrySnapshot[],
  entry: RuntimeWorkbenchSkillEntrySnapshot,
): readonly RuntimeWorkbenchSkillEntrySnapshot[] {
  let replaced = false;
  const nextEntries = entries.map((candidate) => {
    if (candidate.skillId !== entry.skillId) {
      return candidate;
    }
    replaced = true;
    return entry;
  });
  if (!replaced) {
    nextEntries.push(entry);
  }
  return Object.freeze(nextEntries);
}

interface ParsedRuntimeWorkbenchHumanDecisionRecord {
  readonly humanNodeId: string;
  readonly decision: string;
  readonly by: string;
  readonly customValuePresent: boolean;
  readonly decidedAt: string;
  readonly requestedAt: string;
}

function parseRuntimeWorkbenchHumanDecisionRecord(
  body: unknown,
): ParsedRuntimeWorkbenchHumanDecisionRecord | null {
  if (!isRecord(body)) {
    return null;
  }
  const schemaVersion = body.schema_version;
  const humanNodeId = body.human_node_id;
  const status = body.status;
  const decision = body.decision;
  const by = body.by;
  const decidedAt = body.decided_at;
  const requestedAt = body.requested_at;
  if (
    schemaVersion !== "0.1.0" ||
    typeof humanNodeId !== "string" ||
    humanNodeId.trim().length === 0 ||
    status !== "resolved" ||
    typeof decision !== "string" ||
    decision.trim().length === 0 ||
    typeof by !== "string" ||
    by.trim().length === 0 ||
    typeof decidedAt !== "string" ||
    decidedAt.trim().length === 0 ||
    typeof requestedAt !== "string" ||
    requestedAt.trim().length === 0
  ) {
    return null;
  }
  return {
    humanNodeId,
    decision,
    by,
    customValuePresent:
      Object.hasOwn(body, "custom_value") && body.custom_value !== null,
    decidedAt,
    requestedAt,
  };
}

interface ParsedRuntimeWorkbenchVersionSnapshotRecord {
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly createdAt: string;
}

function parseRuntimeWorkbenchVersionSnapshotRecord(
  body: unknown,
): ParsedRuntimeWorkbenchVersionSnapshotRecord | null {
  if (!isRecord(body)) {
    return null;
  }
  const schemaVersion = body.schema_version;
  const snapshotId = body.snapshot_id;
  const commitSha = body.commit_sha;
  const createdAt = body.created_at;
  if (
    schemaVersion !== "0.1.0" ||
    typeof snapshotId !== "string" ||
    snapshotId.trim().length === 0 ||
    typeof commitSha !== "string" ||
    commitSha.trim().length === 0 ||
    typeof createdAt !== "string" ||
    createdAt.trim().length === 0
  ) {
    return null;
  }
  return {
    snapshotId,
    commitSha,
    createdAt,
  };
}

function buildRuntimeWorkbenchReferenceMultipartBody(options: {
  readonly kind: RuntimeWorkbenchReferenceKind;
  readonly sensitive: boolean;
  readonly autoChunk: boolean;
  readonly sourceUrl: string | null;
  readonly fileName: string;
  readonly fileContentBase64: string;
}): { readonly contentType: string; readonly bodyBase64: string } {
  const boundary = `----cw-reference-${Date.now().toString(36)}`;
  const metadata: Record<string, unknown> = {
    schema_version: "0.1.0",
    kind: options.kind,
    sensitive: options.sensitive,
    auto_chunk: options.autoChunk,
    ...(options.sourceUrl !== null ? { source_url: options.sourceUrl } : {}),
  };
  const prefix = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="metadata"',
    "Content-Type: application/json",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${escapeRuntimeWorkbenchMultipartQuotedString(
      options.fileName,
    )}"`,
    "Content-Type: application/octet-stream",
    "",
  ].join("\r\n");
  const suffix = `\r\n--${boundary}--\r\n`;
  const bodyBytes = concatRuntimeWorkbenchBytes([
    runtimeWorkbenchUtf8Bytes(`${prefix}\r\n`),
    runtimeWorkbenchBase64ToBytes(options.fileContentBase64),
    runtimeWorkbenchUtf8Bytes(suffix),
  ]);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    bodyBase64: runtimeWorkbenchBytesToBase64(bodyBytes),
  };
}

function escapeRuntimeWorkbenchMultipartQuotedString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function runtimeWorkbenchUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function runtimeWorkbenchBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function runtimeWorkbenchBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function concatRuntimeWorkbenchBytes(
  chunks: readonly Uint8Array[],
): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
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
    chatInstruction: createRuntimeWorkbenchChatInstructionSnapshot({
      ...snapshot.chatInstruction,
      runtimeAvailable:
        snapshot.chatInstruction.canSubmitInstruction ||
        snapshot.chatInstruction.status === "submitting",
      disposed: snapshot.disposed,
    }),
    artifactAction: createRuntimeWorkbenchArtifactActionSnapshot({
      ...snapshot.artifactAction,
      runtimeAvailable:
        snapshot.artifactAction.canRunArtifactAction ||
        snapshot.artifactAction.status === "running",
      disposed: snapshot.disposed,
    }),
    projectCreation: createRuntimeWorkbenchProjectCreationSnapshot({
      ...snapshot.projectCreation,
      runtimeAvailable:
        snapshot.projectCreation.canCreateProject ||
        snapshot.projectCreation.status === "running",
      disposed: snapshot.disposed,
    }),
    referenceManagement: createRuntimeWorkbenchReferenceManagementSnapshot({
      ...snapshot.referenceManagement,
      runtimeAvailable:
        snapshot.referenceManagement.canRefreshReferences ||
        snapshot.referenceManagement.canImportReference ||
        snapshot.referenceManagement.canUpdateReference ||
        snapshot.referenceManagement.status === "refreshing" ||
        snapshot.referenceManagement.status === "importing" ||
        snapshot.referenceManagement.status === "updating",
      disposed: snapshot.disposed,
    }),
    skillManagement: createRuntimeWorkbenchSkillManagementSnapshot({
      ...snapshot.skillManagement,
      runtimeAvailable:
        snapshot.skillManagement.canRefreshSkills ||
        snapshot.skillManagement.canUpdateSkill ||
        snapshot.skillManagement.status === "refreshing" ||
        snapshot.skillManagement.status === "updating",
      disposed: snapshot.disposed,
    }),
    humanDecision: createRuntimeWorkbenchHumanDecisionSnapshot({
      ...snapshot.humanDecision,
      runtimeAvailable:
        snapshot.humanDecision.canSubmitDecision ||
        snapshot.humanDecision.status === "submitting",
      disposed: snapshot.disposed,
    }),
    versionSnapshot: createRuntimeWorkbenchVersionSnapshotSnapshot({
      ...snapshot.versionSnapshot,
      runtimeAvailable:
        snapshot.versionSnapshot.canCreateSnapshot ||
        snapshot.versionSnapshot.status === "creating",
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
