import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeLifecyclePanelInteractionCommand } from "./runtime-lifecycle-panel-interaction.js";
import type { RuntimeStreamInteractionCommand } from "./runtime-stream-interaction.js";
import type { CreateRuntimeLifecyclePanelSessionFactorySessionOptions } from "./runtime-lifecycle-panel-session.js";
import type { CreateRuntimeStreamInteractionSessionFactorySessionOptions } from "./runtime-stream-session.js";
import type {
  RuntimeWorkbenchExecutionMode,
  RuntimeWorkbenchHumanDecisionCustomValue,
  RuntimeWorkbenchPanelId,
  RuntimeWorkbenchReferenceKind,
  RuntimeWorkbenchSession,
  RuntimeWorkbenchSessionErrorHandler,
  RuntimeWorkbenchSessionSnapshot,
} from "./runtime-workbench-session.js";
import { isRuntimeWorkbenchExecutionMode } from "./runtime-workbench-session.js";

export const RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS = [
  "show_canvas_panel",
  "show_lifecycle_panel",
  "show_stream_panel",
  "open_lifecycle_panel_session",
  "dispose_lifecycle_panel_session",
  "open_runtime_stream_session",
  "dispose_runtime_stream_session",
  "set_execution_mode",
  "run_node_once",
  "create_project",
  "refresh_references",
  "import_reference",
  "set_reference_enabled",
  "refresh_skills",
  "set_skill_enabled",
  "submit_human_decision",
  "dispatch_lifecycle_panel",
  "dispatch_runtime_stream",
] as const;

export type RuntimeWorkbenchInteractionCommandId =
  (typeof RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS)[number];

export type RuntimeWorkbenchInteractionCommand =
  | {
      readonly type: "show_canvas_panel";
    }
  | {
      readonly type: "show_lifecycle_panel";
    }
  | {
      readonly type: "show_stream_panel";
    }
  | {
      readonly type: "open_lifecycle_panel_session";
      readonly options?: CreateRuntimeLifecyclePanelSessionFactorySessionOptions;
    }
  | {
      readonly type: "dispose_lifecycle_panel_session";
    }
  | {
      readonly type: "open_runtime_stream_session";
      readonly options: CreateRuntimeStreamInteractionSessionFactorySessionOptions;
    }
  | {
      readonly type: "dispose_runtime_stream_session";
    }
  | {
      readonly type: "set_execution_mode";
      readonly mode: RuntimeWorkbenchExecutionMode;
    }
  | {
      readonly type: "run_node_once";
      readonly runId: string;
      readonly nodeId: string;
      readonly projectId?: string;
      readonly idempotencyKey?: string;
    }
  | {
      readonly type: "create_project";
      readonly displayName: string;
      readonly hostPath: string;
      readonly idempotencyKey?: string;
      readonly settingsOverrides?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "refresh_references";
      readonly projectId: string;
    }
  | {
      readonly type: "import_reference";
      readonly projectId: string;
      readonly fileName: string;
      readonly fileContentBase64: string;
      readonly kind: RuntimeWorkbenchReferenceKind;
      readonly sensitive?: boolean;
      readonly autoChunk?: boolean;
      readonly sourceUrl?: string;
    }
  | {
      readonly type: "set_reference_enabled";
      readonly projectId: string;
      readonly referenceId: string;
      readonly enabled: boolean;
    }
  | {
      readonly type: "refresh_skills";
      readonly projectId: string;
    }
  | {
      readonly type: "set_skill_enabled";
      readonly projectId: string;
      readonly skillId: string;
      readonly enabled: boolean;
      readonly version?: string;
    }
  | {
      readonly type: "submit_human_decision";
      readonly runId: string;
      readonly humanNodeId: string;
      readonly decision: string;
      readonly by: string;
      readonly customValue?: RuntimeWorkbenchHumanDecisionCustomValue;
      readonly idempotencyKey?: string;
    }
  | {
      readonly type: "dispatch_lifecycle_panel";
      readonly command: RuntimeLifecyclePanelInteractionCommand;
    }
  | {
      readonly type: "dispatch_runtime_stream";
      readonly command: RuntimeStreamInteractionCommand;
    };

export interface RuntimeWorkbenchInteractionSnapshot {
  readonly workbench: RuntimeWorkbenchSessionSnapshot;
  readonly activePanel: RuntimeWorkbenchPanelId;
  readonly availableCommandIds: readonly RuntimeWorkbenchInteractionCommandId[];
  readonly enabledCommandIds: readonly RuntimeWorkbenchInteractionCommandId[];
  readonly disposed: boolean;
}

export type RuntimeWorkbenchInteractionListener = (
  snapshot: RuntimeWorkbenchInteractionSnapshot,
) => void;

export type RuntimeWorkbenchInteractionErrorHandler =
  RuntimeWorkbenchSessionErrorHandler;

export interface RuntimeWorkbenchInteraction {
  readonly getSnapshot: () => RuntimeWorkbenchInteractionSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchInteractionSnapshot;
  readonly snapshot: () => RuntimeWorkbenchInteractionSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchInteractionListener,
  ) => RuntimeStatusUnsubscribe;
  readonly dispatch: (
    command: RuntimeWorkbenchInteractionCommand,
  ) => Promise<RuntimeWorkbenchInteractionSnapshot>;
  readonly setActivePanel: (
    panel: RuntimeWorkbenchPanelId,
  ) => RuntimeWorkbenchInteractionSnapshot;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeWorkbenchInteractionOptions {
  readonly workbench: RuntimeWorkbenchSession;
  readonly onError?: RuntimeWorkbenchInteractionErrorHandler;
}

export function createRuntimeWorkbenchInteraction(
  options: CreateRuntimeWorkbenchInteractionOptions,
): RuntimeWorkbenchInteraction {
  const listeners = new Set<RuntimeWorkbenchInteractionListener>();
  let workbenchUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const initialSnapshot = freezeRuntimeWorkbenchInteractionSnapshot(
    buildRuntimeWorkbenchInteractionSnapshot(
      options.workbench.getSnapshot(),
      disposed,
    ),
  );
  let currentSignature =
    runtimeWorkbenchInteractionSnapshotSignature(initialSnapshot);
  let currentSnapshot = initialSnapshot;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break workbench command propagation.
    }
  };

  const isDisposed = (): boolean => disposed || options.workbench.isDisposed();

  const assertActive = (): void => {
    if (isDisposed()) {
      throw new Error("Runtime workbench interaction is disposed");
    }
  };

  const captureSnapshot = (
    forceRefresh = false,
  ): RuntimeWorkbenchInteractionSnapshot => {
    const nextSnapshot = freezeRuntimeWorkbenchInteractionSnapshot(
      buildRuntimeWorkbenchInteractionSnapshot(
        options.workbench.getSnapshot(),
        isDisposed(),
      ),
    );
    const nextSignature =
      runtimeWorkbenchInteractionSnapshotSignature(nextSnapshot);
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
        listener(currentSnapshot);
      } catch (error) {
        reportError(error);
      }
    }
  };

  const ensureWorkbenchSubscription = (): void => {
    if (
      listeners.size === 0 ||
      workbenchUnsubscribe !== undefined ||
      isDisposed()
    ) {
      return;
    }
    workbenchUnsubscribe = options.workbench.subscribe(() => {
      publishIfChanged();
    });
  };

  const releaseWorkbenchSubscription = (): void => {
    workbenchUnsubscribe?.();
    workbenchUnsubscribe = undefined;
  };

  const completeAction = (): RuntimeWorkbenchInteractionSnapshot => {
    publishIfChanged();
    return captureSnapshot();
  };

  const setActivePanel = (
    panel: RuntimeWorkbenchPanelId,
  ): RuntimeWorkbenchInteractionSnapshot => {
    assertActive();
    options.workbench.setActivePanel(requireRuntimeWorkbenchPanelId(panel));
    return completeAction();
  };

  const dispatch = async (
    command: RuntimeWorkbenchInteractionCommand,
  ): Promise<RuntimeWorkbenchInteractionSnapshot> => {
    assertActive();
    const safeCommand = requireRuntimeWorkbenchInteractionCommand(command);
    switch (safeCommand.type) {
      case "show_canvas_panel":
        return setActivePanel("canvas");
      case "show_lifecycle_panel":
        return setActivePanel("lifecycle");
      case "show_stream_panel":
        return setActivePanel("stream");
      case "open_lifecycle_panel_session":
        options.workbench.openLifecyclePanelSession(safeCommand.options);
        return completeAction();
      case "dispose_lifecycle_panel_session":
        options.workbench.disposeLifecyclePanelSession();
        return completeAction();
      case "open_runtime_stream_session":
        await options.workbench
          .openRuntimeStreamSession(safeCommand.options)
          .start();
        return completeAction();
      case "dispose_runtime_stream_session":
        options.workbench.disposeRuntimeStreamSession();
        return completeAction();
      case "set_execution_mode":
        options.workbench.setExecutionMode(safeCommand.mode);
        return completeAction();
      case "run_node_once":
        await options.workbench.runNodeOnce({
          runId: safeCommand.runId,
          nodeId: safeCommand.nodeId,
          ...(safeCommand.projectId !== undefined
            ? { projectId: safeCommand.projectId }
            : {}),
          ...(safeCommand.idempotencyKey !== undefined
            ? { idempotencyKey: safeCommand.idempotencyKey }
            : {}),
        });
        return completeAction();
      case "create_project":
        await options.workbench.createProject({
          displayName: safeCommand.displayName,
          hostPath: safeCommand.hostPath,
          ...(safeCommand.idempotencyKey !== undefined
            ? { idempotencyKey: safeCommand.idempotencyKey }
            : {}),
          ...(safeCommand.settingsOverrides !== undefined
            ? { settingsOverrides: safeCommand.settingsOverrides }
            : {}),
        });
        return completeAction();
      case "refresh_references":
        await options.workbench.refreshReferences({
          projectId: safeCommand.projectId,
        });
        return completeAction();
      case "import_reference":
        await options.workbench.importReference({
          projectId: safeCommand.projectId,
          fileName: safeCommand.fileName,
          fileContentBase64: safeCommand.fileContentBase64,
          kind: safeCommand.kind,
          ...(safeCommand.sensitive !== undefined
            ? { sensitive: safeCommand.sensitive }
            : {}),
          ...(safeCommand.autoChunk !== undefined
            ? { autoChunk: safeCommand.autoChunk }
            : {}),
          ...(safeCommand.sourceUrl !== undefined
            ? { sourceUrl: safeCommand.sourceUrl }
            : {}),
        });
        return completeAction();
      case "set_reference_enabled":
        await options.workbench.setReferenceEnabled({
          projectId: safeCommand.projectId,
          referenceId: safeCommand.referenceId,
          enabled: safeCommand.enabled,
        });
        return completeAction();
      case "refresh_skills":
        await options.workbench.refreshSkills({
          projectId: safeCommand.projectId,
        });
        return completeAction();
      case "set_skill_enabled":
        await options.workbench.setSkillEnabled({
          projectId: safeCommand.projectId,
          skillId: safeCommand.skillId,
          enabled: safeCommand.enabled,
          ...(safeCommand.version !== undefined
            ? { version: safeCommand.version }
            : {}),
        });
        return completeAction();
      case "submit_human_decision":
        await options.workbench.submitHumanDecision({
          runId: safeCommand.runId,
          humanNodeId: safeCommand.humanNodeId,
          decision: safeCommand.decision,
          by: safeCommand.by,
          ...(safeCommand.customValue !== undefined
            ? { customValue: safeCommand.customValue }
            : {}),
          ...(safeCommand.idempotencyKey !== undefined
            ? { idempotencyKey: safeCommand.idempotencyKey }
            : {}),
        });
        return completeAction();
      case "dispatch_lifecycle_panel": {
        await options.workbench.dispatchLifecyclePanelCommand(
          safeCommand.command,
        );
        return completeAction();
      }
      case "dispatch_runtime_stream":
        await options.workbench.dispatchRuntimeStreamCommand(
          safeCommand.command,
        );
        return completeAction();
    }
  };

  return {
    getSnapshot: () => captureSnapshot(),
    getServerSnapshot: () => captureSnapshot(),
    snapshot: () => captureSnapshot(),
    subscribe: (listener) => {
      if (isDisposed()) {
        return () => false;
      }
      listeners.add(listener);
      ensureWorkbenchSubscription();
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        const deleted = listeners.delete(listener);
        if (listeners.size === 0) {
          releaseWorkbenchSubscription();
        }
        return deleted;
      };
    },
    dispatch,
    setActivePanel,
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      releaseWorkbenchSubscription();
      publishIfChanged(true);
      listeners.clear();
      return true;
    },
    isDisposed,
  };
}

export function buildRuntimeWorkbenchInteractionSnapshot(
  workbench: RuntimeWorkbenchSessionSnapshot,
  disposed = workbench.disposed,
): RuntimeWorkbenchInteractionSnapshot {
  const availableCommandIds = [...RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS];
  const enabledCommandIds: RuntimeWorkbenchInteractionCommandId[] = [];
  if (!disposed) {
    if (workbench.activePanel !== "canvas") {
      enabledCommandIds.push("show_canvas_panel");
    }
    if (workbench.activePanel !== "lifecycle") {
      enabledCommandIds.push("show_lifecycle_panel");
    }
    if (workbench.activePanel !== "stream") {
      enabledCommandIds.push("show_stream_panel");
    }
    enabledCommandIds.push(
      "open_lifecycle_panel_session",
      "open_runtime_stream_session",
      "set_execution_mode",
    );
    if (workbench.executionPolicy.canRunOnce) {
      enabledCommandIds.push("run_node_once");
    }
    if (workbench.projectCreation.canCreateProject) {
      enabledCommandIds.push("create_project");
    }
    if (workbench.referenceManagement.canRefreshReferences) {
      enabledCommandIds.push("refresh_references");
    }
    if (workbench.referenceManagement.canImportReference) {
      enabledCommandIds.push("import_reference");
    }
    if (workbench.referenceManagement.canUpdateReference) {
      enabledCommandIds.push("set_reference_enabled");
    }
    if (workbench.skillManagement.canRefreshSkills) {
      enabledCommandIds.push("refresh_skills");
    }
    if (workbench.skillManagement.canUpdateSkill) {
      enabledCommandIds.push("set_skill_enabled");
    }
    if (workbench.humanDecision.canSubmitDecision) {
      enabledCommandIds.push("submit_human_decision");
    }
    if (workbench.lifecyclePanel.activeSession !== null) {
      enabledCommandIds.push(
        "dispose_lifecycle_panel_session",
        "dispatch_lifecycle_panel",
      );
    }
    if (workbench.runtimeStream.activeSession !== null) {
      enabledCommandIds.push(
        "dispose_runtime_stream_session",
        "dispatch_runtime_stream",
      );
    }
  }

  return {
    workbench,
    activePanel: workbench.activePanel,
    availableCommandIds: Object.freeze(availableCommandIds),
    enabledCommandIds: Object.freeze(enabledCommandIds),
    disposed,
  };
}

function requireRuntimeWorkbenchInteractionCommand(
  command: RuntimeWorkbenchInteractionCommand,
): RuntimeWorkbenchInteractionCommand {
  if (!isRecord(command)) {
    throw new Error("Invalid runtime workbench interaction command");
  }
  const commandType = command.type;
  switch (commandType) {
    case "show_canvas_panel":
    case "show_lifecycle_panel":
    case "show_stream_panel":
    case "dispose_lifecycle_panel_session":
    case "dispose_runtime_stream_session":
      return command;
    case "set_execution_mode":
      if (
        typeof command.mode !== "string" ||
        !isRuntimeWorkbenchExecutionMode(command.mode)
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "run_node_once":
      if (
        typeof command.runId !== "string" ||
        typeof command.nodeId !== "string" ||
        ("projectId" in command &&
          command.projectId !== undefined &&
          typeof command.projectId !== "string") ||
        ("idempotencyKey" in command &&
          command.idempotencyKey !== undefined &&
          typeof command.idempotencyKey !== "string")
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "create_project":
      if (
        typeof command.displayName !== "string" ||
        typeof command.hostPath !== "string" ||
        ("idempotencyKey" in command &&
          command.idempotencyKey !== undefined &&
          typeof command.idempotencyKey !== "string") ||
        ("settingsOverrides" in command &&
          command.settingsOverrides !== undefined &&
          !isRecord(command.settingsOverrides))
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "refresh_references":
      if (typeof command.projectId !== "string") {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "import_reference":
      if (
        typeof command.projectId !== "string" ||
        typeof command.fileName !== "string" ||
        typeof command.fileContentBase64 !== "string" ||
        typeof command.kind !== "string" ||
        ("sensitive" in command &&
          command.sensitive !== undefined &&
          typeof command.sensitive !== "boolean") ||
        ("autoChunk" in command &&
          command.autoChunk !== undefined &&
          typeof command.autoChunk !== "boolean") ||
        ("sourceUrl" in command &&
          command.sourceUrl !== undefined &&
          typeof command.sourceUrl !== "string")
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "set_reference_enabled":
      if (
        typeof command.projectId !== "string" ||
        typeof command.referenceId !== "string" ||
        typeof command.enabled !== "boolean"
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "refresh_skills":
      if (typeof command.projectId !== "string") {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "set_skill_enabled":
      if (
        typeof command.projectId !== "string" ||
        typeof command.skillId !== "string" ||
        typeof command.enabled !== "boolean" ||
        ("version" in command &&
          command.version !== undefined &&
          typeof command.version !== "string")
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "submit_human_decision":
      if (
        typeof command.runId !== "string" ||
        typeof command.humanNodeId !== "string" ||
        typeof command.decision !== "string" ||
        typeof command.by !== "string" ||
        ("customValue" in command &&
          command.customValue !== undefined &&
          !isRuntimeWorkbenchHumanDecisionCustomValue(command.customValue)) ||
        ("idempotencyKey" in command &&
          command.idempotencyKey !== undefined &&
          typeof command.idempotencyKey !== "string")
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "open_lifecycle_panel_session":
      if (
        "options" in command &&
        command.options !== undefined &&
        !isRecord(command.options)
      ) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "open_runtime_stream_session":
      if (!isRecord(command.options)) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "dispatch_lifecycle_panel":
      if (typeof command.command !== "string") {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    case "dispatch_runtime_stream":
      if (!isRecord(command.command)) {
        throw new Error("Invalid runtime workbench interaction command");
      }
      return command;
    default:
      throw new Error("Invalid runtime workbench interaction command");
  }
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

function freezeRuntimeWorkbenchInteractionSnapshot(
  snapshot: RuntimeWorkbenchInteractionSnapshot,
): RuntimeWorkbenchInteractionSnapshot {
  return Object.freeze({ ...snapshot });
}

function runtimeWorkbenchInteractionSnapshotSignature(
  snapshot: RuntimeWorkbenchInteractionSnapshot,
): string {
  return JSON.stringify(snapshot);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
