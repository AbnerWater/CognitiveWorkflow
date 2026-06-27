import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type RefObject,
  type ReactElement,
  type ReactNode,
} from "react";
import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  RuntimeLifecyclePanelCommand,
  RuntimeLifecyclePanelCommandId,
  RuntimeLifecyclePanelTimelineItem,
} from "./runtime-lifecycle-panel-presenter.js";
import type { RuntimeLifecyclePanelInteractionCommand } from "./runtime-lifecycle-panel-interaction.js";
import type {
  RuntimeStreamCategory,
  RuntimeStreamDisplayLevel,
} from "./runtime-stream-client.js";
import type { RuntimeStreamInteractionCommand } from "./runtime-stream-interaction.js";
import {
  RUNTIME_STREAM_ALL_EVENT_TYPES,
  type CreateRuntimeStreamInteractionSessionFactorySessionOptions,
} from "./runtime-stream-session.js";
import type {
  RuntimeWorkbenchInteractionCommand,
  RuntimeWorkbenchInteractionCommandId,
} from "./runtime-workbench-interaction.js";
import {
  RUNTIME_WORKBENCH_EXECUTION_MODES,
  type RuntimeWorkbenchExecutionMode,
  type RuntimeWorkbenchPanelId,
  type RuntimeWorkbenchReferenceEntrySnapshot,
  type RuntimeWorkbenchReferenceKind,
  type RuntimeWorkbenchSkillEntrySnapshot,
} from "./runtime-workbench-session.js";
import type { RuntimeWorkbenchShellKeyboardDomEventTarget } from "./runtime-workbench-shell-keyboard-dom-adapter.js";
import type {
  RuntimeWorkbenchShellAction,
  RuntimeWorkbenchShellActionId,
  RuntimeWorkbenchShellChatBoxSnapshot,
  RuntimeWorkbenchShellDockItem,
  RuntimeWorkbenchShellFileTreeNode,
  RuntimeWorkbenchShellFileTreeNodeId,
  RuntimeWorkbenchShellFileTreeSnapshot,
  RuntimeWorkbenchShellLifecyclePanelSnapshot,
  RuntimeWorkbenchShellRuntimeStreamEventSnapshot,
  RuntimeWorkbenchShellRuntimeStreamPanelSnapshot,
  RuntimeWorkbenchShellSnapshot,
  RuntimeWorkbenchShellTaskDrawerItem,
  RuntimeWorkbenchShellTaskDrawerItemId,
  RuntimeWorkbenchShellTaskDrawerSnapshot,
  RuntimeWorkbenchShellVersionSnapshotId,
  RuntimeWorkbenchShellVersionSnapshotItem,
  RuntimeWorkbenchShellVersionSnapshotsSnapshot,
  RuntimeWorkbenchShellWorkflowCanvasEdge,
  RuntimeWorkbenchShellWorkflowCanvasNode,
  RuntimeWorkbenchShellWorkflowCanvasNodeId,
  RuntimeWorkbenchShellWorkflowCanvasSnapshot,
} from "./runtime-workbench-shell-presenter.js";
import type {
  RuntimeWorkbenchShellDomSession,
  RuntimeWorkbenchShellDomSessionKeyboardOptions,
} from "./runtime-workbench-shell-dom-session.js";

export interface RuntimeWorkbenchShellReactActionOptions {
  readonly runtimeStreamSessionOptions?: CreateRuntimeStreamInteractionSessionFactorySessionOptions;
}

export type RuntimeWorkbenchShellReactStreamChannelKind = "run" | "planning";

export interface RuntimeWorkbenchShellReactStreamOptionsFormState {
  readonly channelKind: RuntimeWorkbenchShellReactStreamChannelKind;
  readonly runId: string;
  readonly planningSessionId: string;
  readonly projectId: string;
  readonly displayLevel: RuntimeStreamDisplayLevel;
  readonly categories: readonly RuntimeStreamCategory[];
  readonly sinceSeq: string;
  readonly untilSeq: string;
}

export interface RuntimeWorkbenchShellReactProjectCreationFormState {
  readonly displayName: string;
  readonly hostPath: string;
  readonly taskBackground: string;
}

export interface RuntimeWorkbenchShellReactReferenceImportFormState {
  readonly projectId: string;
  readonly kind: RuntimeWorkbenchReferenceKind;
  readonly fileName: string;
  readonly fileContentBase64: string;
  readonly sourceUrl: string;
  readonly sensitive: boolean;
  readonly autoChunk: boolean;
  readonly fileLabel: string | null;
  readonly fileByteLength: number | null;
}

export interface RuntimeWorkbenchShellReactSkillManagementFormState {
  readonly projectId: string;
  readonly skillId: string;
  readonly version: string;
}

export interface RuntimeWorkbenchShellReactHumanDecisionFormState {
  readonly runId: string;
  readonly humanNodeId: string;
  readonly decision: string;
  readonly by: string;
}

export interface RuntimeWorkbenchShellReactVersionSnapshotFormState {
  readonly workflowId: string;
}

export interface RuntimeWorkbenchShellReactViewProps {
  readonly session: RuntimeWorkbenchShellDomSession;
  readonly title?: string;
  readonly keyboardTarget?: RuntimeWorkbenchShellKeyboardDomEventTarget | null;
  readonly keyboardOptions?: RuntimeWorkbenchShellDomSessionKeyboardOptions;
  readonly runtimeStreamSessionOptions?: CreateRuntimeStreamInteractionSessionFactorySessionOptions;
  readonly defaultRuntimeStreamOptionsFormState?: Partial<RuntimeWorkbenchShellReactStreamOptionsFormState>;
  readonly defaultProjectCreationFormState?: Partial<RuntimeWorkbenchShellReactProjectCreationFormState>;
  readonly defaultReferenceImportFormState?: Partial<RuntimeWorkbenchShellReactReferenceImportFormState>;
  readonly defaultSkillManagementFormState?: Partial<RuntimeWorkbenchShellReactSkillManagementFormState>;
  readonly defaultHumanDecisionFormState?: Partial<RuntimeWorkbenchShellReactHumanDecisionFormState>;
  readonly defaultVersionSnapshotFormState?: Partial<RuntimeWorkbenchShellReactVersionSnapshotFormState>;
  readonly className?: string;
  readonly onActionError?: (error: unknown) => void;
}

const RUNTIME_WORKBENCH_STREAM_DISPLAY_LEVELS: readonly RuntimeStreamDisplayLevel[] =
  ["minimal", "default", "detailed"] as const;

const RUNTIME_WORKBENCH_RUN_STREAM_CATEGORIES: readonly RuntimeStreamCategory[] =
  [
    "lifecycle",
    "model",
    "tool",
    "context",
    "evidence",
    "evaluation",
    "repair",
    "human",
    "artifact",
    "metric",
    "error",
    "system",
  ] as const;

const RUNTIME_WORKBENCH_PLANNING_STREAM_CATEGORIES: readonly RuntimeStreamCategory[] =
  ["planning", "system"] as const;

const RUNTIME_WORKBENCH_STREAM_KNOWN_EVENT_TYPE_SET = new Set<string>(
  RUNTIME_STREAM_ALL_EVENT_TYPES,
);

const RUNTIME_WORKBENCH_EXECUTION_MODE_OPTIONS: readonly {
  readonly mode: RuntimeWorkbenchExecutionMode;
  readonly label: string;
  readonly title: string;
}[] = Object.freeze([
  {
    mode: "step",
    label: "Step",
    title: "Use step execution policy",
  },
  {
    mode: "semi_auto",
    label: "Semi-auto",
    title: "Use semi-auto execution policy",
  },
  {
    mode: "auto",
    label: "Auto",
    title: "Use auto execution policy",
  },
]);

const RUNTIME_WORKBENCH_REFERENCE_KIND_OPTIONS: readonly RuntimeWorkbenchReferenceKind[] =
  ["pdf", "md", "txt", "csv", "xlsx", "image", "web_url"] as const;

export function useRuntimeWorkbenchShellSnapshot(
  session: RuntimeWorkbenchShellDomSession,
): RuntimeWorkbenchShellSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(listener),
    [session],
  );
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const getServerSnapshot = useCallback(
    () => session.getServerSnapshot(),
    [session],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function bindRuntimeWorkbenchShellReactKeyboardTarget(
  session: RuntimeWorkbenchShellDomSession,
  target: RuntimeWorkbenchShellKeyboardDomEventTarget | null,
  options?: RuntimeWorkbenchShellDomSessionKeyboardOptions,
): RuntimeStatusUnsubscribe {
  if (target === null || session.isDisposed()) {
    return () => false;
  }
  const didBind =
    options === undefined
      ? session.bindKeyboardTarget(target)
      : session.bindKeyboardTarget(target, options);
  if (!didBind) {
    return () => false;
  }
  let bound = true;
  return () => {
    if (!bound) {
      return false;
    }
    bound = false;
    return session.unbindKeyboardTarget();
  };
}

export function createRuntimeWorkbenchShellReactStreamOptionsFormState(
  input: Partial<RuntimeWorkbenchShellReactStreamOptionsFormState> = {},
): RuntimeWorkbenchShellReactStreamOptionsFormState {
  const channelKind = input.channelKind ?? "run";
  return Object.freeze({
    channelKind,
    runId: input.runId ?? "",
    planningSessionId: input.planningSessionId ?? "",
    projectId: input.projectId ?? "",
    displayLevel: input.displayLevel ?? "default",
    categories: Object.freeze(
      normalizeRuntimeWorkbenchShellReactStreamCategories(
        channelKind,
        input.categories ?? [],
      ),
    ),
    sinceSeq: input.sinceSeq ?? "",
    untilSeq: input.untilSeq ?? "",
  });
}

export function createRuntimeWorkbenchShellReactProjectCreationFormState(
  input: Partial<RuntimeWorkbenchShellReactProjectCreationFormState> = {},
): RuntimeWorkbenchShellReactProjectCreationFormState {
  return Object.freeze({
    displayName: input.displayName ?? "",
    hostPath: input.hostPath ?? "",
    taskBackground: input.taskBackground ?? "",
  });
}

export function createRuntimeWorkbenchShellReactReferenceImportFormState(
  input: Partial<RuntimeWorkbenchShellReactReferenceImportFormState> = {},
): RuntimeWorkbenchShellReactReferenceImportFormState {
  const kind = isRuntimeWorkbenchShellReactReferenceKind(input.kind)
    ? input.kind
    : "pdf";
  const fileName = input.fileName ?? "";
  return Object.freeze({
    projectId: input.projectId ?? "",
    kind,
    fileName,
    fileContentBase64: input.fileContentBase64 ?? "",
    sourceUrl: input.sourceUrl ?? "",
    sensitive: input.sensitive ?? false,
    autoChunk: input.autoChunk ?? true,
    fileLabel: input.fileLabel ?? (fileName.length > 0 ? fileName : null),
    fileByteLength: input.fileByteLength ?? null,
  });
}

export function createRuntimeWorkbenchShellReactSkillManagementFormState(
  input: Partial<RuntimeWorkbenchShellReactSkillManagementFormState> = {},
): RuntimeWorkbenchShellReactSkillManagementFormState {
  return Object.freeze({
    projectId: input.projectId ?? "",
    skillId: input.skillId ?? "",
    version: input.version ?? "latest",
  });
}

export function createRuntimeWorkbenchShellReactHumanDecisionFormState(
  input: Partial<RuntimeWorkbenchShellReactHumanDecisionFormState> = {},
): RuntimeWorkbenchShellReactHumanDecisionFormState {
  return Object.freeze({
    runId: input.runId ?? "",
    humanNodeId: input.humanNodeId ?? "",
    decision: input.decision ?? "",
    by: input.by ?? "",
  });
}

export function createRuntimeWorkbenchShellReactVersionSnapshotFormState(
  input: Partial<RuntimeWorkbenchShellReactVersionSnapshotFormState> = {},
): RuntimeWorkbenchShellReactVersionSnapshotFormState {
  return Object.freeze({
    workflowId: input.workflowId ?? "",
  });
}

export function buildRuntimeWorkbenchShellReactStreamSessionOptions(
  state: RuntimeWorkbenchShellReactStreamOptionsFormState,
): CreateRuntimeStreamInteractionSessionFactorySessionOptions | null {
  const channelId =
    state.channelKind === "run" ? state.runId : state.planningSessionId;
  const normalizedChannelId =
    normalizeRuntimeWorkbenchShellReactPathSegment(channelId);
  if (normalizedChannelId === null) {
    return null;
  }

  const filters = buildRuntimeWorkbenchShellReactStreamFilters(state);
  if (filters === null) {
    return null;
  }

  const projectId = normalizeRuntimeWorkbenchShellReactProjectId(
    state.projectId,
  );
  if (projectId === null) {
    return null;
  }

  return {
    channel:
      state.channelKind === "run"
        ? { kind: "run", runId: normalizedChannelId }
        : { kind: "planning", sessionId: normalizedChannelId },
    ...(projectId.length > 0 ? { projectId } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  };
}

export function isRuntimeWorkbenchShellReactActionEnabled(
  action: RuntimeWorkbenchShellAction,
  options: RuntimeWorkbenchShellReactActionOptions = {},
): boolean {
  return (
    action.enabled &&
    (!action.requiresOptions ||
      options.runtimeStreamSessionOptions !== undefined)
  );
}

export function runtimeWorkbenchShellActionToCommand(
  action: RuntimeWorkbenchShellAction,
  options: RuntimeWorkbenchShellReactActionOptions = {},
): RuntimeWorkbenchInteractionCommand | null {
  switch (action.id) {
    case "show_canvas_panel":
    case "show_lifecycle_panel":
    case "show_stream_panel":
    case "open_lifecycle_panel_session":
    case "dispose_lifecycle_panel_session":
    case "dispose_runtime_stream_session":
      return { type: action.id };
    case "open_runtime_stream_session":
      return options.runtimeStreamSessionOptions === undefined
        ? null
        : {
            type: "open_runtime_stream_session",
            options: options.runtimeStreamSessionOptions,
          };
  }
}

export function runtimeWorkbenchShellStreamPanelCommandToWorkbenchCommand(
  command: RuntimeStreamInteractionCommand,
): RuntimeWorkbenchInteractionCommand {
  return {
    type: "dispatch_runtime_stream",
    command,
  };
}

export function runtimeWorkbenchShellLifecyclePanelCommandToWorkbenchCommand(
  command: RuntimeLifecyclePanelInteractionCommand,
): RuntimeWorkbenchInteractionCommand {
  return {
    type: "dispatch_lifecycle_panel",
    command,
  };
}

export function RuntimeWorkbenchShellReactView(
  props: RuntimeWorkbenchShellReactViewProps,
): ReactElement {
  const snapshot = useRuntimeWorkbenchShellSnapshot(props.session);
  const title = props.title ?? "CognitiveWorkflow Runtime Workbench";
  const [streamOptionsForm, setStreamOptionsForm] =
    useState<RuntimeWorkbenchShellReactStreamOptionsFormState>(() =>
      createRuntimeWorkbenchShellReactStreamOptionsFormState(
        props.defaultRuntimeStreamOptionsFormState,
      ),
    );
  const [projectCreationForm, setProjectCreationForm] =
    useState<RuntimeWorkbenchShellReactProjectCreationFormState>(() =>
      createRuntimeWorkbenchShellReactProjectCreationFormState(
        props.defaultProjectCreationFormState,
      ),
    );
  const [referenceImportForm, setReferenceImportForm] =
    useState<RuntimeWorkbenchShellReactReferenceImportFormState>(() =>
      createRuntimeWorkbenchShellReactReferenceImportFormState(
        props.defaultReferenceImportFormState,
      ),
    );
  const [skillManagementForm, setSkillManagementForm] =
    useState<RuntimeWorkbenchShellReactSkillManagementFormState>(() =>
      createRuntimeWorkbenchShellReactSkillManagementFormState(
        props.defaultSkillManagementFormState,
      ),
    );
  const [humanDecisionForm, setHumanDecisionForm] =
    useState<RuntimeWorkbenchShellReactHumanDecisionFormState>(() =>
      createRuntimeWorkbenchShellReactHumanDecisionFormState(
        props.defaultHumanDecisionFormState,
      ),
    );
  const [versionSnapshotForm, setVersionSnapshotForm] =
    useState<RuntimeWorkbenchShellReactVersionSnapshotFormState>(() =>
      createRuntimeWorkbenchShellReactVersionSnapshotFormState(
        props.defaultVersionSnapshotFormState,
      ),
    );
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const formRuntimeStreamSessionOptions = useMemo(
    () =>
      buildRuntimeWorkbenchShellReactStreamSessionOptions(streamOptionsForm),
    [streamOptionsForm],
  );
  const runtimeStreamSessionOptions =
    props.runtimeStreamSessionOptions ?? formRuntimeStreamSessionOptions;
  const actionOptions = useMemo(
    (): RuntimeWorkbenchShellReactActionOptions =>
      runtimeStreamSessionOptions === null
        ? {}
        : { runtimeStreamSessionOptions },
    [runtimeStreamSessionOptions],
  );
  const actionsById = useMemo(
    () => new Map(snapshot.actions.map((action) => [action.id, action])),
    [snapshot.actions],
  );
  const [workflowCanvasSelectedNodeId, setWorkflowCanvasSelectedNodeId] =
    useState<RuntimeWorkbenchShellWorkflowCanvasNodeId | null>(null);
  const selectedWorkflowCanvasNode = useMemo(
    () =>
      selectRuntimeWorkbenchShellWorkflowCanvasNode(
        snapshot.chrome.workflowCanvas,
        workflowCanvasSelectedNodeId,
      ),
    [snapshot.chrome.workflowCanvas, workflowCanvasSelectedNodeId],
  );
  const currentWorkflowCanvasNode = useMemo(
    () =>
      selectRuntimeWorkbenchShellCurrentWorkflowCanvasNode(
        snapshot.chrome.workflowCanvas,
        workflowCanvasSelectedNodeId,
      ),
    [snapshot.chrome.workflowCanvas, workflowCanvasSelectedNodeId],
  );
  const executionRunId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(streamOptionsForm.runId),
    [streamOptionsForm.runId],
  );
  const activeRuntimeStreamRunId = useMemo(
    () => selectRuntimeWorkbenchShellReactActiveRunId(snapshot),
    [snapshot],
  );
  const runtimeActionRunId = executionRunId ?? activeRuntimeStreamRunId;
  const executionProjectId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactProjectId(streamOptionsForm.projectId),
    [streamOptionsForm.projectId],
  );
  const projectCreationDisplayName = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactProjectDisplayName(
        projectCreationForm.displayName,
      ),
    [projectCreationForm.displayName],
  );
  const projectCreationHostPath = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactProjectHostPath(
        projectCreationForm.hostPath,
      ),
    [projectCreationForm.hostPath],
  );
  const projectCreationTaskBackgroundReady =
    projectCreationForm.taskBackground.trim().length > 0;
  const projectCreationReady =
    snapshot.projectCreation.canCreateProject &&
    projectCreationDisplayName !== null &&
    projectCreationHostPath !== null &&
    projectCreationTaskBackgroundReady;
  const referenceProjectId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(
        referenceImportForm.projectId,
      ),
    [referenceImportForm.projectId],
  );
  const referenceFileName = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactReferenceFileName(
        referenceImportForm.fileName,
      ),
    [referenceImportForm.fileName],
  );
  const referenceSourceUrl = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactOptionalText(
        referenceImportForm.sourceUrl,
      ),
    [referenceImportForm.sourceUrl],
  );
  const referenceRefreshReady =
    snapshot.referenceManagement.canRefreshReferences &&
    referenceProjectId !== null;
  const referenceImportReady =
    snapshot.referenceManagement.canImportReference &&
    referenceProjectId !== null &&
    referenceFileName !== null &&
    referenceImportForm.fileContentBase64.length > 0 &&
    referenceSourceUrl !== null;
  const referenceToggleProjectId =
    snapshot.referenceManagement.activeProjectId ?? referenceProjectId;
  const referenceUpdateReady =
    snapshot.referenceManagement.canUpdateReference &&
    referenceToggleProjectId !== null;
  const skillProjectId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(
        skillManagementForm.projectId,
      ),
    [skillManagementForm.projectId],
  );
  const skillId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(
        skillManagementForm.skillId,
      ),
    [skillManagementForm.skillId],
  );
  const skillVersion = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactOptionalText(
        skillManagementForm.version,
      ),
    [skillManagementForm.version],
  );
  const skillRefreshReady =
    snapshot.skillManagement.canRefreshSkills && skillProjectId !== null;
  const skillToggleProjectId =
    snapshot.skillManagement.activeProjectId ?? skillProjectId;
  const skillUpdateReady =
    snapshot.skillManagement.canUpdateSkill && skillToggleProjectId !== null;
  const skillSetReady =
    snapshot.skillManagement.canUpdateSkill &&
    skillProjectId !== null &&
    skillId !== null &&
    skillVersion !== null &&
    skillVersion.length > 0;
  const humanDecisionRunId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(humanDecisionForm.runId),
    [humanDecisionForm.runId],
  );
  const humanDecisionNodeId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(
        humanDecisionForm.humanNodeId,
      ),
    [humanDecisionForm.humanNodeId],
  );
  const humanDecisionChoice = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(
        humanDecisionForm.decision,
      ),
    [humanDecisionForm.decision],
  );
  const humanDecisionActor = useMemo(() => {
    const normalized = normalizeRuntimeWorkbenchShellReactOptionalText(
      humanDecisionForm.by,
    );
    if (normalized === null || normalized.length === 0) {
      return null;
    }
    return normalized.length > 200 ? null : normalized;
  }, [humanDecisionForm.by]);
  const humanDecisionReady =
    snapshot.humanDecision.canSubmitDecision &&
    humanDecisionRunId !== null &&
    humanDecisionNodeId !== null &&
    humanDecisionChoice !== null &&
    humanDecisionActor !== null;
  const versionSnapshotWorkflowId = useMemo(
    () =>
      normalizeRuntimeWorkbenchShellReactPathSegment(
        versionSnapshotForm.workflowId,
      ),
    [versionSnapshotForm.workflowId],
  );
  const versionSnapshotReady =
    snapshot.versionSnapshot.canCreateSnapshot &&
    versionSnapshotWorkflowId !== null;
  const handleActionError = useCallback(
    (error: unknown): void => {
      try {
        props.onActionError?.(error);
      } catch {
        // Renderer diagnostics must not break the React shell.
      }
    },
    [props.onActionError],
  );
  const handlePanelClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const panel = event.currentTarget.dataset.panel;
      if (panel !== "canvas" && panel !== "lifecycle" && panel !== "stream") {
        return;
      }
      try {
        props.session.setActivePanel(panel);
      } catch (error) {
        handleActionError(error);
      }
    },
    [handleActionError, props.session],
  );
  const handleActionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const actionId = event.currentTarget.dataset.actionId as
        | RuntimeWorkbenchShellActionId
        | undefined;
      if (actionId === undefined) {
        return;
      }
      const action = actionsById.get(actionId);
      if (
        action === undefined ||
        !isRuntimeWorkbenchShellReactActionEnabled(action, actionOptions)
      ) {
        return;
      }
      const command = runtimeWorkbenchShellActionToCommand(
        action,
        actionOptions,
      );
      if (command === null) {
        return;
      }
      void props.session.dispatch(command).catch(handleActionError);
    },
    [actionOptions, actionsById, handleActionError, props.session],
  );
  const handleExecutionModeClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const mode = event.currentTarget.dataset.executionModeOption;
      if (!isRuntimeWorkbenchShellExecutionMode(mode)) {
        return;
      }
      void props.session
        .dispatch({
          type: "set_execution_mode",
          mode,
        })
        .catch(handleActionError);
    },
    [handleActionError, props.session],
  );
  const handleRunSelectedNodeOnceClick = useCallback((): void => {
    if (
      !snapshot.executionPolicy.canRunOnce ||
      executionRunId === null ||
      executionProjectId === null ||
      selectedWorkflowCanvasNode === null
    ) {
      return;
    }
    void props.session
      .dispatch({
        type: "run_node_once",
        runId: executionRunId,
        nodeId: selectedWorkflowCanvasNode.nodeId,
        ...(executionProjectId.length > 0
          ? { projectId: executionProjectId }
          : {}),
      })
      .catch(handleActionError);
  }, [
    executionProjectId,
    executionRunId,
    handleActionError,
    props.session,
    selectedWorkflowCanvasNode,
    snapshot.executionPolicy.canRunOnce,
  ]);
  const handleStreamChannelKindClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const channelKind = event.currentTarget.dataset.streamChannelKind;
      if (channelKind !== "run" && channelKind !== "planning") {
        return;
      }
      setStreamOptionsForm((current) =>
        createRuntimeWorkbenchShellReactStreamOptionsFormState({
          ...current,
          channelKind,
          categories: normalizeRuntimeWorkbenchShellReactStreamCategories(
            channelKind,
            current.categories,
          ),
        }),
      );
    },
    [],
  );
  const handleStreamTextInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const field = event.currentTarget.dataset.streamField;
      if (
        field !== "runId" &&
        field !== "planningSessionId" &&
        field !== "projectId" &&
        field !== "sinceSeq" &&
        field !== "untilSeq"
      ) {
        return;
      }
      const value = event.currentTarget.value;
      setStreamOptionsForm((current) =>
        createRuntimeWorkbenchShellReactStreamOptionsFormState({
          ...current,
          [field]: value,
        }),
      );
    },
    [],
  );
  const handleProjectCreationTextInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const field = event.currentTarget.dataset.projectCreateField;
      if (
        field !== "displayName" &&
        field !== "hostPath" &&
        field !== "taskBackground"
      ) {
        return;
      }
      const value = event.currentTarget.value;
      setProjectCreationForm((current) =>
        createRuntimeWorkbenchShellReactProjectCreationFormState({
          ...current,
          [field]: value,
        }),
      );
    },
    [],
  );
  const handleReferenceTextInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const field = event.currentTarget.dataset.referenceField;
      if (field !== "projectId" && field !== "sourceUrl") {
        return;
      }
      const value = event.currentTarget.value;
      setReferenceImportForm((current) =>
        createRuntimeWorkbenchShellReactReferenceImportFormState({
          ...current,
          [field]: value,
        }),
      );
    },
    [],
  );
  const handleReferenceKindChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      const kind = event.currentTarget.value;
      if (!isRuntimeWorkbenchShellReactReferenceKind(kind)) {
        return;
      }
      setReferenceImportForm((current) =>
        createRuntimeWorkbenchShellReactReferenceImportFormState({
          ...current,
          kind,
        }),
      );
    },
    [],
  );
  const handleReferenceFlagChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const flag = event.currentTarget.dataset.referenceFlag;
      if (flag !== "sensitive" && flag !== "autoChunk") {
        return;
      }
      const checked = event.currentTarget.checked;
      setReferenceImportForm((current) =>
        createRuntimeWorkbenchShellReactReferenceImportFormState({
          ...current,
          [flag]: checked,
        }),
      );
    },
    [],
  );
  const handleSkillTextInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const field = event.currentTarget.dataset.skillField;
      if (field !== "projectId" && field !== "skillId" && field !== "version") {
        return;
      }
      const value = event.currentTarget.value;
      setSkillManagementForm((current) =>
        createRuntimeWorkbenchShellReactSkillManagementFormState({
          ...current,
          [field]: value,
        }),
      );
    },
    [],
  );
  const handleHumanDecisionTextInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const field = event.currentTarget.dataset.humanDecisionField;
      if (
        field !== "runId" &&
        field !== "humanNodeId" &&
        field !== "decision" &&
        field !== "by"
      ) {
        return;
      }
      const value = event.currentTarget.value;
      setHumanDecisionForm((current) =>
        createRuntimeWorkbenchShellReactHumanDecisionFormState({
          ...current,
          [field]: value,
        }),
      );
    },
    [],
  );
  const handleVersionSnapshotTextInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const field = event.currentTarget.dataset.versionSnapshotField;
      if (field !== "workflowId") {
        return;
      }
      const value = event.currentTarget.value;
      setVersionSnapshotForm((current) =>
        createRuntimeWorkbenchShellReactVersionSnapshotFormState({
          ...current,
          [field]: value,
        }),
      );
    },
    [],
  );
  const handleReferenceFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const file = event.currentTarget.files?.[0] ?? null;
      if (file === null) {
        setReferenceImportForm((current) =>
          createRuntimeWorkbenchShellReactReferenceImportFormState({
            ...current,
            fileName: "",
            fileContentBase64: "",
            fileLabel: null,
            fileByteLength: null,
          }),
        );
        return;
      }
      void file
        .arrayBuffer()
        .then((buffer) => {
          setReferenceImportForm((current) =>
            createRuntimeWorkbenchShellReactReferenceImportFormState({
              ...current,
              fileName: file.name,
              fileContentBase64:
                runtimeWorkbenchShellReactArrayBufferToBase64(buffer),
              fileLabel: file.name,
              fileByteLength: file.size,
            }),
          );
        })
        .catch(handleActionError);
    },
    [handleActionError],
  );
  const handleCreateProjectClick = useCallback((): void => {
    if (
      !projectCreationReady ||
      projectCreationDisplayName === null ||
      projectCreationHostPath === null
    ) {
      return;
    }
    void props.session
      .dispatch({
        type: "create_project",
        displayName: projectCreationDisplayName,
        hostPath: projectCreationHostPath,
      })
      .catch(handleActionError);
  }, [
    handleActionError,
    projectCreationDisplayName,
    projectCreationHostPath,
    projectCreationReady,
    props.session,
  ]);
  const handleRefreshReferencesClick = useCallback((): void => {
    if (!referenceRefreshReady || referenceProjectId === null) {
      return;
    }
    void props.session
      .dispatch({
        type: "refresh_references",
        projectId: referenceProjectId,
      })
      .catch(handleActionError);
  }, [
    handleActionError,
    props.session,
    referenceProjectId,
    referenceRefreshReady,
  ]);
  const handleImportReferenceClick = useCallback((): void => {
    if (
      !referenceImportReady ||
      referenceProjectId === null ||
      referenceFileName === null ||
      referenceSourceUrl === null
    ) {
      return;
    }
    void props.session
      .dispatch({
        type: "import_reference",
        projectId: referenceProjectId,
        fileName: referenceFileName,
        fileContentBase64: referenceImportForm.fileContentBase64,
        kind: referenceImportForm.kind,
        sensitive: referenceImportForm.sensitive,
        autoChunk: referenceImportForm.autoChunk,
        ...(referenceSourceUrl.length > 0
          ? { sourceUrl: referenceSourceUrl }
          : {}),
      })
      .then(() => {
        if (referenceFileInputRef.current !== null) {
          referenceFileInputRef.current.value = "";
        }
        setReferenceImportForm((current) =>
          createRuntimeWorkbenchShellReactReferenceImportFormState({
            ...current,
            fileName: "",
            fileContentBase64: "",
            fileLabel: null,
            fileByteLength: null,
          }),
        );
      })
      .catch(handleActionError);
  }, [
    handleActionError,
    props.session,
    referenceFileName,
    referenceImportForm.autoChunk,
    referenceImportForm.fileContentBase64,
    referenceImportForm.kind,
    referenceImportForm.sensitive,
    referenceImportReady,
    referenceProjectId,
    referenceSourceUrl,
  ]);
  const handleReferenceToggleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const referenceId = event.currentTarget.dataset.referenceToggleId;
      const nextEnabled =
        event.currentTarget.dataset.referenceToggleNextEnabled;
      if (
        !referenceUpdateReady ||
        referenceToggleProjectId === null ||
        referenceId === undefined ||
        referenceId.length === 0 ||
        (nextEnabled !== "true" && nextEnabled !== "false")
      ) {
        return;
      }
      void props.session
        .dispatch({
          type: "set_reference_enabled",
          projectId: referenceToggleProjectId,
          referenceId,
          enabled: nextEnabled === "true",
        })
        .catch(handleActionError);
    },
    [
      handleActionError,
      props.session,
      referenceToggleProjectId,
      referenceUpdateReady,
    ],
  );
  const handleRefreshSkillsClick = useCallback((): void => {
    if (!skillRefreshReady || skillProjectId === null) {
      return;
    }
    void props.session
      .dispatch({
        type: "refresh_skills",
        projectId: skillProjectId,
      })
      .catch(handleActionError);
  }, [handleActionError, props.session, skillProjectId, skillRefreshReady]);
  const handleSetSkillEnabledClick = useCallback((): void => {
    if (
      !skillSetReady ||
      skillProjectId === null ||
      skillId === null ||
      skillVersion === null ||
      skillVersion.length === 0
    ) {
      return;
    }
    void props.session
      .dispatch({
        type: "set_skill_enabled",
        projectId: skillProjectId,
        skillId,
        enabled: true,
        version: skillVersion,
      })
      .catch(handleActionError);
  }, [
    handleActionError,
    props.session,
    skillId,
    skillProjectId,
    skillSetReady,
    skillVersion,
  ]);
  const handleSkillToggleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const selectedSkillId = event.currentTarget.dataset.skillToggleId;
      const nextEnabled = event.currentTarget.dataset.skillToggleNextEnabled;
      if (
        !skillUpdateReady ||
        skillToggleProjectId === null ||
        selectedSkillId === undefined ||
        selectedSkillId.length === 0 ||
        (nextEnabled !== "true" && nextEnabled !== "false")
      ) {
        return;
      }
      void props.session
        .dispatch({
          type: "set_skill_enabled",
          projectId: skillToggleProjectId,
          skillId: selectedSkillId,
          enabled: nextEnabled === "true",
        })
        .catch(handleActionError);
    },
    [handleActionError, props.session, skillToggleProjectId, skillUpdateReady],
  );
  const handleSubmitHumanDecisionClick = useCallback((): void => {
    if (
      !humanDecisionReady ||
      humanDecisionRunId === null ||
      humanDecisionNodeId === null ||
      humanDecisionChoice === null ||
      humanDecisionActor === null
    ) {
      return;
    }
    void props.session
      .dispatch({
        type: "submit_human_decision",
        runId: humanDecisionRunId,
        humanNodeId: humanDecisionNodeId,
        decision: humanDecisionChoice,
        by: humanDecisionActor,
      })
      .catch(handleActionError);
  }, [
    handleActionError,
    humanDecisionActor,
    humanDecisionChoice,
    humanDecisionNodeId,
    humanDecisionReady,
    humanDecisionRunId,
    props.session,
  ]);
  const handleCreateWorkflowSnapshotClick = useCallback((): void => {
    if (!versionSnapshotReady || versionSnapshotWorkflowId === null) {
      return;
    }
    void props.session
      .dispatch({
        type: "create_workflow_snapshot",
        workflowId: versionSnapshotWorkflowId,
      })
      .catch(handleActionError);
  }, [
    handleActionError,
    props.session,
    versionSnapshotReady,
    versionSnapshotWorkflowId,
  ]);
  const handleStreamDisplayLevelClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const displayLevel = event.currentTarget.dataset.streamDisplayLevel;
      if (displayLevel === undefined) {
        return;
      }
      if (!isRuntimeWorkbenchShellReactDisplayLevel(displayLevel)) {
        return;
      }
      setStreamOptionsForm((current) =>
        createRuntimeWorkbenchShellReactStreamOptionsFormState({
          ...current,
          displayLevel,
        }),
      );
    },
    [],
  );
  const handleStreamCategoryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const category = event.currentTarget.value;
      if (!isRuntimeWorkbenchShellReactCategory(category)) {
        return;
      }
      const checked = event.currentTarget.checked;
      setStreamOptionsForm((current) => {
        const categories = checked
          ? [...current.categories, category]
          : current.categories.filter((candidate) => candidate !== category);
        return createRuntimeWorkbenchShellReactStreamOptionsFormState({
          ...current,
          categories,
        });
      });
    },
    [],
  );
  const dispatchStreamPanelCommand = useCallback(
    (command: RuntimeStreamInteractionCommand): void => {
      void props.session
        .dispatch(
          runtimeWorkbenchShellStreamPanelCommandToWorkbenchCommand(command),
        )
        .catch(handleActionError);
    },
    [handleActionError, props.session],
  );
  const handleStreamPanelSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      dispatchStreamPanelCommand({
        type: "set_search_query",
        query: event.currentTarget.value,
      });
    },
    [dispatchStreamPanelCommand],
  );
  const handleStreamPanelClearSearchClick = useCallback((): void => {
    dispatchStreamPanelCommand({ type: "clear_search" });
  }, [dispatchStreamPanelCommand]);
  const handleStreamPanelPreviousSearchClick = useCallback((): void => {
    dispatchStreamPanelCommand({ type: "previous_search_match" });
  }, [dispatchStreamPanelCommand]);
  const handleStreamPanelNextSearchClick = useCallback((): void => {
    dispatchStreamPanelCommand({ type: "next_search_match" });
  }, [dispatchStreamPanelCommand]);
  const handleStreamPanelSelectSearchClick = useCallback((): void => {
    dispatchStreamPanelCommand({ type: "select_active_search_match" });
  }, [dispatchStreamPanelCommand]);
  const handleStreamPanelMarkReadClick = useCallback((): void => {
    dispatchStreamPanelCommand({ type: "mark_all_read" });
  }, [dispatchStreamPanelCommand]);
  const handleStreamPanelAcknowledgeFullReloadClick = useCallback((): void => {
    dispatchStreamPanelCommand({ type: "acknowledge_full_reload" });
  }, [dispatchStreamPanelCommand]);
  const handleStreamPanelSelectEventClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const eventId = event.currentTarget.dataset.streamEventId;
      if (eventId === undefined || eventId.length === 0) {
        return;
      }
      dispatchStreamPanelCommand({ type: "select_event", eventId });
    },
    [dispatchStreamPanelCommand],
  );
  const handleStreamPanelClearSelectionClick = useCallback((): void => {
    dispatchStreamPanelCommand({ type: "select_event", eventId: null });
  }, [dispatchStreamPanelCommand]);
  const handleStreamPanelToggleExpandedClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const eventId = event.currentTarget.dataset.streamEventId;
      if (eventId === undefined || eventId.length === 0) {
        return;
      }
      dispatchStreamPanelCommand({ type: "toggle_expanded", eventId });
    },
    [dispatchStreamPanelCommand],
  );
  const handleStreamArtifactActionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const artifactId = event.currentTarget.dataset.streamArtifactId;
      const action = event.currentTarget.dataset.streamArtifactAction;
      if (
        artifactId === undefined ||
        artifactId.length === 0 ||
        (action !== "open" && action !== "download")
      ) {
        return;
      }
      void props.session
        .dispatch({
          type: "run_artifact_action",
          artifactId,
          action,
          ...(runtimeActionRunId !== null ? { runId: runtimeActionRunId } : {}),
        })
        .catch(handleActionError);
    },
    [handleActionError, props.session, runtimeActionRunId],
  );
  const handleChatSubmit = useCallback(
    (input: RuntimeWorkbenchShellChatSubmitInput): void => {
      if (runtimeActionRunId === null) {
        return;
      }
      void props.session
        .dispatch({
          type: "submit_chat_instruction",
          runId: runtimeActionRunId,
          ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
          instruction: input.instruction,
          intent: input.intent,
          ...(executionProjectId !== null && executionProjectId.length > 0
            ? { projectId: executionProjectId }
            : {}),
        })
        .catch(handleActionError);
    },
    [executionProjectId, handleActionError, props.session, runtimeActionRunId],
  );
  const dispatchLifecyclePanelCommand = useCallback(
    (command: RuntimeLifecyclePanelInteractionCommand): void => {
      void props.session
        .dispatch(
          runtimeWorkbenchShellLifecyclePanelCommandToWorkbenchCommand(command),
        )
        .catch(handleActionError);
    },
    [handleActionError, props.session],
  );
  const handleLifecyclePanelCommandClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const commandId = event.currentTarget.dataset.lifecycleCommandId as
        | RuntimeLifecyclePanelCommandId
        | undefined;
      if (commandId === undefined) {
        return;
      }
      const command =
        runtimeWorkbenchShellLifecycleCommandIdToInteractionCommand(commandId);
      if (command === null) {
        return;
      }
      dispatchLifecyclePanelCommand(command);
    },
    [dispatchLifecyclePanelCommand],
  );
  const handleLifecyclePanelNavigationClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const command = event.currentTarget.dataset.lifecycleNavigationCommand as
        | RuntimeLifecyclePanelInteractionCommand
        | undefined;
      if (command === undefined) {
        return;
      }
      dispatchLifecyclePanelCommand(command);
    },
    [dispatchLifecyclePanelCommand],
  );

  useEffect(() => {
    const unbindKeyboardTarget = bindRuntimeWorkbenchShellReactKeyboardTarget(
      props.session,
      props.keyboardTarget ?? null,
      props.keyboardOptions,
    );
    return () => {
      unbindKeyboardTarget();
    };
  }, [props.keyboardOptions, props.keyboardTarget, props.session]);

  return (
    <main
      className={["cw-workbench", props.className].filter(Boolean).join(" ")}
    >
      <header className="cw-workbench__header">
        <div>
          <p className="cw-workbench__eyebrow">Runtime Shell</p>
          <h1>{title}</h1>
        </div>
        <dl className="cw-workbench__status-grid">
          {snapshot.statusItems.map((item) => (
            <div
              className={`cw-workbench__status cw-workbench__status--${item.tone}`}
              key={item.id}
            >
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="cw-workbench__shell">
        <div className="cw-workbench__left-rail">
          <RuntimeWorkbenchShellDock
            items={snapshot.chrome.dockItems}
            onPanelClick={handlePanelClick}
          />
          <RuntimeWorkbenchShellFileTree fileTree={snapshot.chrome.fileTree} />
        </div>

        <div className="cw-workbench__workspace">
          <nav
            aria-label="Runtime workbench panels"
            className="cw-workbench__tabs"
          >
            {snapshot.panels.map((panel) => (
              <button
                aria-current={panel.active ? "page" : undefined}
                className={`cw-workbench__tab cw-workbench__tab--${panel.tone}`}
                data-panel={panel.id satisfies RuntimeWorkbenchPanelId}
                disabled={!panel.enabled}
                key={panel.id}
                onClick={handlePanelClick}
                title={panel.title}
                type="button"
              >
                <span>{panel.label}</span>
                {panel.badgeLabel === null ? null : (
                  <small>{panel.badgeLabel}</small>
                )}
              </button>
            ))}
          </nav>

          <RuntimeWorkbenchShellVersionSnapshots
            snapshots={snapshot.chrome.versionSnapshots}
          />

          <RuntimeWorkbenchShellWorkflowCanvas
            canvas={snapshot.chrome.workflowCanvas}
            surface="preview"
          />

          <section
            aria-live={snapshot.ariaLive}
            className="cw-workbench__content"
          >
            {snapshot.emptyState === null ? (
              snapshot.activePanel === "canvas" ? (
                <RuntimeWorkbenchShellWorkflowCanvas
                  canvas={snapshot.chrome.workflowCanvas}
                  onSelectedNodeChange={setWorkflowCanvasSelectedNodeId}
                  selectedNodeId={workflowCanvasSelectedNodeId}
                  surface="focused"
                />
              ) : snapshot.activePanel === "stream" ? (
                <RuntimeWorkbenchShellStreamPanel
                  onAcknowledgeFullReloadClick={
                    handleStreamPanelAcknowledgeFullReloadClick
                  }
                  onArtifactActionClick={handleStreamArtifactActionClick}
                  onClearSearchClick={handleStreamPanelClearSearchClick}
                  onClearSelectionClick={handleStreamPanelClearSelectionClick}
                  onMarkReadClick={handleStreamPanelMarkReadClick}
                  onNextSearchClick={handleStreamPanelNextSearchClick}
                  onPreviousSearchClick={handleStreamPanelPreviousSearchClick}
                  onSearchChange={handleStreamPanelSearchChange}
                  onSelectEventClick={handleStreamPanelSelectEventClick}
                  onSelectSearchClick={handleStreamPanelSelectSearchClick}
                  onToggleExpandedClick={handleStreamPanelToggleExpandedClick}
                  snapshot={snapshot}
                />
              ) : snapshot.lifecyclePanel === null ? (
                <RuntimeWorkbenchShellPanelSummary snapshot={snapshot} />
              ) : (
                <RuntimeWorkbenchShellLifecyclePanel
                  onCommandClick={handleLifecyclePanelCommandClick}
                  onNavigationClick={handleLifecyclePanelNavigationClick}
                  panel={snapshot.lifecyclePanel}
                />
              )
            ) : (
              <div className="cw-workbench__empty">
                <h2>{snapshot.emptyState.title}</h2>
                <p>{snapshot.emptyState.summary}</p>
              </div>
            )}
          </section>

          <RuntimeWorkbenchShellStreamOptionsForm
            onCategoryChange={handleStreamCategoryChange}
            onChannelKindClick={handleStreamChannelKindClick}
            onDisplayLevelClick={handleStreamDisplayLevelClick}
            onTextInputChange={handleStreamTextInputChange}
            optionsReady={runtimeStreamSessionOptions !== null}
            state={streamOptionsForm}
          />

          <section
            aria-label="Runtime workbench actions"
            className="cw-workbench__actions"
          >
            <RuntimeWorkbenchShellVersionSnapshotControls
              onCreateSnapshotClick={handleCreateWorkflowSnapshotClick}
              onTextInputChange={handleVersionSnapshotTextInputChange}
              ready={versionSnapshotReady}
              state={versionSnapshotForm}
              versionSnapshot={snapshot.versionSnapshot}
            />
            <RuntimeWorkbenchShellProjectCreationControls
              onCreateProjectClick={handleCreateProjectClick}
              onTextInputChange={handleProjectCreationTextInputChange}
              projectCreation={snapshot.projectCreation}
              projectCreationReady={projectCreationReady}
              state={projectCreationForm}
            />
            <RuntimeWorkbenchShellReferenceManagementControls
              importReady={referenceImportReady}
              onFileInputChange={handleReferenceFileInputChange}
              onFlagChange={handleReferenceFlagChange}
              onImportClick={handleImportReferenceClick}
              onKindChange={handleReferenceKindChange}
              onRefreshClick={handleRefreshReferencesClick}
              onTextInputChange={handleReferenceTextInputChange}
              onToggleClick={handleReferenceToggleClick}
              fileInputRef={referenceFileInputRef}
              referenceManagement={snapshot.referenceManagement}
              updateReady={referenceUpdateReady}
              refreshReady={referenceRefreshReady}
              state={referenceImportForm}
            />
            <RuntimeWorkbenchShellSkillManagementControls
              onRefreshClick={handleRefreshSkillsClick}
              onSetEnabledClick={handleSetSkillEnabledClick}
              onTextInputChange={handleSkillTextInputChange}
              onToggleClick={handleSkillToggleClick}
              refreshReady={skillRefreshReady}
              setReady={skillSetReady}
              skillManagement={snapshot.skillManagement}
              state={skillManagementForm}
              updateReady={skillUpdateReady}
            />
            <RuntimeWorkbenchShellHumanDecisionControls
              humanDecision={snapshot.humanDecision}
              onSubmitClick={handleSubmitHumanDecisionClick}
              onTextInputChange={handleHumanDecisionTextInputChange}
              ready={humanDecisionReady}
              state={humanDecisionForm}
            />
            <RuntimeWorkbenchShellExecutionControls
              executionPolicy={snapshot.executionPolicy}
              onExecutionModeClick={handleExecutionModeClick}
              onRunSelectedNodeOnceClick={handleRunSelectedNodeOnceClick}
              projectId={executionProjectId}
              runId={executionRunId}
              selectedNode={selectedWorkflowCanvasNode}
            />
            {snapshot.actions.map((action) => (
              <button
                className={`cw-workbench__action cw-workbench__action--${action.slot} cw-workbench__action--${action.tone}`}
                data-action-id={
                  action.id satisfies RuntimeWorkbenchInteractionCommandId
                }
                disabled={
                  !isRuntimeWorkbenchShellReactActionEnabled(
                    action,
                    actionOptions,
                  )
                }
                key={action.id}
                onClick={handleActionClick}
                title={action.title}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </section>

          <footer className="cw-workbench__shortcuts">
            {snapshot.shortcutHints.map((shortcut) => (
              <span
                className={
                  shortcut.enabled
                    ? "cw-workbench__shortcut"
                    : "cw-workbench__shortcut cw-workbench__shortcut--disabled"
                }
                key={shortcut.id}
                title={shortcut.title}
              >
                <span>{shortcut.label}</span>
                <kbd>{shortcut.keys.join("+")}</kbd>
              </span>
            ))}
          </footer>
        </div>

        <RuntimeWorkbenchShellTaskDrawer drawer={snapshot.chrome.taskDrawer} />
        <RuntimeWorkbenchShellChatBox
          chatBox={snapshot.chrome.chatBox}
          onSubmit={handleChatSubmit}
          runId={runtimeActionRunId}
          selectedNodeId={currentWorkflowCanvasNode?.nodeId ?? null}
        />
      </div>
    </main>
  );
}

function RuntimeWorkbenchShellProjectCreationControls(props: {
  readonly projectCreation: RuntimeWorkbenchShellSnapshot["projectCreation"];
  readonly state: RuntimeWorkbenchShellReactProjectCreationFormState;
  readonly projectCreationReady: boolean;
  readonly onTextInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onCreateProjectClick: () => void;
}): ReactElement {
  return (
    <section
      aria-label="Project creation"
      className="cw-workbench__project-creation"
      data-project-creation-control="true"
      data-project-creation-status={props.projectCreation.status}
      data-project-creation-git-initialized={
        props.projectCreation.gitInitialized === null
          ? "unknown"
          : String(props.projectCreation.gitInitialized)
      }
      data-project-creation-project-id={
        props.projectCreation.projectId ?? undefined
      }
    >
      <label className="cw-workbench__project-creation-field">
        <span>Project</span>
        <input
          data-project-create-field="displayName"
          inputMode="text"
          onChange={props.onTextInputChange}
          value={props.state.displayName}
        />
      </label>
      <label className="cw-workbench__project-creation-field">
        <span>Path</span>
        <input
          data-project-create-field="hostPath"
          inputMode="text"
          onChange={props.onTextInputChange}
          value={props.state.hostPath}
        />
      </label>
      <label className="cw-workbench__project-creation-field">
        <span>Task background</span>
        <input
          data-project-create-field="taskBackground"
          inputMode="text"
          onChange={props.onTextInputChange}
          value={props.state.taskBackground}
        />
      </label>
      <button
        className="cw-workbench__project-create-submit"
        data-project-create-submit="true"
        data-project-create-enabled={
          props.projectCreationReady ? "true" : "false"
        }
        disabled={!props.projectCreationReady}
        onClick={props.onCreateProjectClick}
        type="button"
      >
        Create project
      </button>
      <dl className="cw-workbench__project-creation-status">
        <div>
          <dt>Git</dt>
          <dd>
            {props.projectCreation.gitInitialized === true
              ? "Initialized"
              : "Required"}
          </dd>
        </div>
        <div>
          <dt>Project id</dt>
          <dd>
            {props.projectCreation.projectId ?? props.projectCreation.status}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function RuntimeWorkbenchShellReferenceManagementControls(props: {
  readonly referenceManagement: RuntimeWorkbenchShellSnapshot["referenceManagement"];
  readonly state: RuntimeWorkbenchShellReactReferenceImportFormState;
  readonly fileInputRef: RefObject<HTMLInputElement>;
  readonly refreshReady: boolean;
  readonly importReady: boolean;
  readonly updateReady: boolean;
  readonly onTextInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onKindChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly onFlagChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onRefreshClick: () => void;
  readonly onImportClick: () => void;
  readonly onToggleClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <section
      aria-label="Reference management"
      className="cw-workbench__reference-management"
      data-reference-management-active-project-id={
        props.referenceManagement.activeProjectId ?? undefined
      }
      data-reference-management-control="true"
      data-reference-management-entry-count={String(
        props.referenceManagement.entries.length,
      )}
      data-reference-management-status={props.referenceManagement.status}
    >
      <div className="cw-workbench__reference-management-form">
        <label className="cw-workbench__reference-field">
          <span>Project id</span>
          <input
            data-reference-field="projectId"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.projectId}
          />
        </label>
        <label className="cw-workbench__reference-field">
          <span>Kind</span>
          <select
            data-reference-field="kind"
            onChange={props.onKindChange}
            value={props.state.kind}
          >
            {RUNTIME_WORKBENCH_REFERENCE_KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {runtimeWorkbenchShellReactReferenceKindLabel(kind)}
              </option>
            ))}
          </select>
        </label>
        <label className="cw-workbench__reference-field">
          <span>Source URL</span>
          <input
            data-reference-field="sourceUrl"
            inputMode="url"
            onChange={props.onTextInputChange}
            value={props.state.sourceUrl}
          />
        </label>
        <label className="cw-workbench__reference-field">
          <span>File</span>
          <input
            data-reference-file-input="true"
            onChange={props.onFileInputChange}
            ref={props.fileInputRef}
            type="file"
          />
        </label>
        <label className="cw-workbench__reference-check">
          <input
            checked={props.state.autoChunk}
            data-reference-flag="autoChunk"
            onChange={props.onFlagChange}
            type="checkbox"
          />
          <span>Auto chunk</span>
        </label>
        <label className="cw-workbench__reference-check">
          <input
            checked={props.state.sensitive}
            data-reference-flag="sensitive"
            onChange={props.onFlagChange}
            type="checkbox"
          />
          <span>Sensitive</span>
        </label>
        <button
          className="cw-workbench__reference-refresh"
          data-reference-refresh-submit="true"
          data-reference-refresh-enabled={props.refreshReady ? "true" : "false"}
          disabled={!props.refreshReady}
          onClick={props.onRefreshClick}
          type="button"
        >
          Refresh
        </button>
        <button
          className="cw-workbench__reference-import"
          data-reference-import-submit="true"
          data-reference-import-enabled={props.importReady ? "true" : "false"}
          data-reference-import-file-ready={
            props.state.fileContentBase64.length > 0 ? "true" : "false"
          }
          disabled={!props.importReady}
          onClick={props.onImportClick}
          type="button"
        >
          Import
        </button>
      </div>
      <dl className="cw-workbench__reference-status">
        <div>
          <dt>Status</dt>
          <dd>{props.referenceManagement.status}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>
            {props.state.fileLabel === null
              ? "No file"
              : `${props.state.fileLabel} (${props.state.fileByteLength ?? 0} bytes)`}
          </dd>
        </div>
        <div>
          <dt>Index snapshot</dt>
          <dd>{props.referenceManagement.indexSnapshotId ?? "none"}</dd>
        </div>
      </dl>
      <RuntimeWorkbenchShellReferenceEntryList
        entries={props.referenceManagement.entries}
        onToggleClick={props.onToggleClick}
        updateEnabled={props.updateReady}
      />
    </section>
  );
}

function RuntimeWorkbenchShellReferenceEntryList(props: {
  readonly entries: readonly RuntimeWorkbenchReferenceEntrySnapshot[];
  readonly updateEnabled: boolean;
  readonly onToggleClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  if (props.entries.length === 0) {
    return (
      <p className="cw-workbench__reference-empty" data-reference-empty="true">
        No references
      </p>
    );
  }
  return (
    <ul className="cw-workbench__reference-list">
      {props.entries.map((entry) => (
        <li
          className="cw-workbench__reference-entry"
          data-reference-entry-enabled={entry.enabled ? "true" : "false"}
          data-reference-entry-id={entry.referenceId}
          key={entry.referenceId}
        >
          <div className="cw-workbench__reference-entry-main">
            <strong>{entry.referenceId}</strong>
            <span>{entry.path}</span>
          </div>
          <dl className="cw-workbench__reference-entry-meta">
            <div>
              <dt>Kind</dt>
              <dd>
                {runtimeWorkbenchShellReactReferenceKindLabel(entry.kind)}
              </dd>
            </div>
            <div>
              <dt>Chunk</dt>
              <dd>{entry.chunkStatus}</dd>
            </div>
            <div>
              <dt>Hash</dt>
              <dd>{entry.contentHash}</dd>
            </div>
            <div>
              <dt>Sensitive</dt>
              <dd>{entry.sensitive ? "yes" : "no"}</dd>
            </div>
          </dl>
          <button
            className="cw-workbench__reference-toggle"
            data-reference-toggle-id={entry.referenceId}
            data-reference-toggle-next-enabled={
              entry.enabled ? "false" : "true"
            }
            disabled={!props.updateEnabled}
            onClick={props.onToggleClick}
            type="button"
          >
            {entry.enabled ? "Disable" : "Enable"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function RuntimeWorkbenchShellSkillManagementControls(props: {
  readonly skillManagement: RuntimeWorkbenchShellSnapshot["skillManagement"];
  readonly state: RuntimeWorkbenchShellReactSkillManagementFormState;
  readonly refreshReady: boolean;
  readonly setReady: boolean;
  readonly updateReady: boolean;
  readonly onTextInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onRefreshClick: () => void;
  readonly onSetEnabledClick: () => void;
  readonly onToggleClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <section
      aria-label="Skill management"
      className="cw-workbench__skill-management"
      data-skill-management-active-project-id={
        props.skillManagement.activeProjectId ?? undefined
      }
      data-skill-management-control="true"
      data-skill-management-entry-count={String(
        props.skillManagement.entries.length,
      )}
      data-skill-management-status={props.skillManagement.status}
    >
      <div className="cw-workbench__skill-management-form">
        <label className="cw-workbench__skill-field">
          <span>Project id</span>
          <input
            data-skill-field="projectId"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.projectId}
          />
        </label>
        <label className="cw-workbench__skill-field">
          <span>Skill id</span>
          <input
            data-skill-field="skillId"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.skillId}
          />
        </label>
        <label className="cw-workbench__skill-field">
          <span>Version</span>
          <input
            data-skill-field="version"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.version}
          />
        </label>
        <button
          className="cw-workbench__skill-refresh"
          data-skill-refresh-submit="true"
          data-skill-refresh-enabled={props.refreshReady ? "true" : "false"}
          disabled={!props.refreshReady}
          onClick={props.onRefreshClick}
          type="button"
        >
          Refresh
        </button>
        <button
          className="cw-workbench__skill-set"
          data-skill-set-submit="true"
          data-skill-set-enabled={props.setReady ? "true" : "false"}
          disabled={!props.setReady}
          onClick={props.onSetEnabledClick}
          type="button"
        >
          Enable
        </button>
      </div>
      <dl className="cw-workbench__skill-status">
        <div>
          <dt>Status</dt>
          <dd>{props.skillManagement.status}</dd>
        </div>
        <div>
          <dt>Last skill</dt>
          <dd>{props.skillManagement.lastSkillId ?? "none"}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{props.skillManagement.activeProjectId ?? "none"}</dd>
        </div>
      </dl>
      <RuntimeWorkbenchShellSkillEntryList
        entries={props.skillManagement.entries}
        onToggleClick={props.onToggleClick}
        updateEnabled={props.updateReady}
      />
    </section>
  );
}

function RuntimeWorkbenchShellSkillEntryList(props: {
  readonly entries: readonly RuntimeWorkbenchSkillEntrySnapshot[];
  readonly updateEnabled: boolean;
  readonly onToggleClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  if (props.entries.length === 0) {
    return (
      <p className="cw-workbench__skill-empty" data-skill-empty="true">
        No skills
      </p>
    );
  }
  return (
    <ul className="cw-workbench__skill-list">
      {props.entries.map((entry) => (
        <li
          className="cw-workbench__skill-entry"
          data-skill-entry-enabled={entry.enabled ? "true" : "false"}
          data-skill-entry-id={entry.skillId}
          key={entry.skillId}
        >
          <div className="cw-workbench__skill-entry-main">
            <strong>{entry.skillId}</strong>
            <span>{entry.version}</span>
          </div>
          <dl className="cw-workbench__skill-entry-meta">
            <div>
              <dt>Enabled</dt>
              <dd>{entry.enabled ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt>Param keys</dt>
              <dd>
                {entry.paramKeys.length === 0
                  ? "none"
                  : entry.paramKeys.join(", ")}
              </dd>
            </div>
          </dl>
          <button
            className="cw-workbench__skill-toggle"
            data-skill-toggle-id={entry.skillId}
            data-skill-toggle-next-enabled={entry.enabled ? "false" : "true"}
            disabled={!props.updateEnabled}
            onClick={props.onToggleClick}
            type="button"
          >
            {entry.enabled ? "Disable" : "Enable"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function RuntimeWorkbenchShellHumanDecisionControls(props: {
  readonly humanDecision: RuntimeWorkbenchShellSnapshot["humanDecision"];
  readonly state: RuntimeWorkbenchShellReactHumanDecisionFormState;
  readonly ready: boolean;
  readonly onTextInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSubmitClick: () => void;
}): ReactElement {
  return (
    <section
      aria-label="Human decision"
      className="cw-workbench__human-decision"
      data-human-decision-can-submit={
        props.humanDecision.canSubmitDecision ? "true" : "false"
      }
      data-human-decision-control="true"
      data-human-decision-custom-value-present={
        props.humanDecision.customValuePresent ? "true" : "false"
      }
      data-human-decision-status={props.humanDecision.status}
    >
      <div className="cw-workbench__human-decision-form">
        <label className="cw-workbench__human-decision-field">
          <span>Run id</span>
          <input
            data-human-decision-field="runId"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.runId}
          />
        </label>
        <label className="cw-workbench__human-decision-field">
          <span>Human node</span>
          <input
            data-human-decision-field="humanNodeId"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.humanNodeId}
          />
        </label>
        <label className="cw-workbench__human-decision-field">
          <span>Decision</span>
          <input
            data-human-decision-field="decision"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.decision}
          />
        </label>
        <label className="cw-workbench__human-decision-field">
          <span>By</span>
          <input
            data-human-decision-field="by"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.by}
          />
        </label>
        <button
          className="cw-workbench__human-decision-submit"
          data-human-decision-submit="true"
          data-human-decision-submit-enabled={props.ready ? "true" : "false"}
          disabled={!props.ready}
          onClick={props.onSubmitClick}
          type="button"
        >
          Submit
        </button>
      </div>
      <dl className="cw-workbench__human-decision-status">
        <div>
          <dt>Status</dt>
          <dd>{props.humanDecision.status}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>{props.humanDecision.runId ?? "none"}</dd>
        </div>
        <div>
          <dt>Node</dt>
          <dd>{props.humanDecision.humanNodeId ?? "none"}</dd>
        </div>
        <div>
          <dt>Decision</dt>
          <dd>{props.humanDecision.decision ?? "none"}</dd>
        </div>
        <div>
          <dt>By</dt>
          <dd>{props.humanDecision.by ?? "none"}</dd>
        </div>
        <div>
          <dt>Custom</dt>
          <dd>
            {props.humanDecision.customValuePresent === true
              ? "present"
              : "none"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function RuntimeWorkbenchShellExecutionControls(props: {
  readonly executionPolicy: RuntimeWorkbenchShellSnapshot["executionPolicy"];
  readonly selectedNode: RuntimeWorkbenchShellWorkflowCanvasNode | null;
  readonly runId: string | null;
  readonly projectId: string | null;
  readonly onExecutionModeClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onRunSelectedNodeOnceClick: () => void;
}): ReactElement {
  const runOnceReady =
    props.executionPolicy.canRunOnce &&
    props.runId !== null &&
    props.projectId !== null &&
    props.selectedNode !== null;
  const selectedNodeLabel = props.selectedNode?.title ?? "No node";
  return (
    <div
      aria-label="Execution mode"
      className="cw-workbench__execution-controls"
      data-execution-mode-control="true"
      data-execution-mode={props.executionPolicy.mode}
      data-execution-run-once-status={props.executionPolicy.runOnce.status}
    >
      <span className="cw-workbench__execution-controls-label">Mode</span>
      <div
        aria-label="Execution mode options"
        className="cw-workbench__execution-mode-options"
        role="group"
      >
        {RUNTIME_WORKBENCH_EXECUTION_MODE_OPTIONS.map((option) => (
          <button
            aria-pressed={props.executionPolicy.mode === option.mode}
            className={[
              "cw-workbench__execution-mode-option",
              props.executionPolicy.mode === option.mode
                ? "cw-workbench__execution-mode-option--active"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-execution-mode-option={option.mode}
            disabled={!props.executionPolicy.canChangeMode}
            key={option.mode}
            onClick={props.onExecutionModeClick}
            title={option.title}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        className="cw-workbench__execution-run-once"
        data-execution-run-once="true"
        data-execution-run-once-enabled={runOnceReady ? "true" : "false"}
        data-execution-run-once-node-id={props.selectedNode?.nodeId ?? ""}
        disabled={!runOnceReady}
        onClick={props.onRunSelectedNodeOnceClick}
        title={`Run ${selectedNodeLabel} once`}
        type="button"
      >
        Run selected once
      </button>
    </div>
  );
}

function runtimeWorkbenchShellLifecycleCommandIdToInteractionCommand(
  commandId: RuntimeLifecyclePanelCommandId,
): RuntimeLifecyclePanelInteractionCommand | null {
  switch (commandId) {
    case "start_runtime":
    case "retry_startup":
      return "start_or_retry_runtime";
    case "refresh_status":
      return "refresh_status";
    case "stop_runtime":
      return "stop_runtime";
    case "inspect_issue":
    case "wait":
    case "none":
      return null;
  }
}

function RuntimeWorkbenchShellDock(props: {
  readonly items: readonly RuntimeWorkbenchShellDockItem[];
  readonly onPanelClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <aside aria-label="Runtime workspace dock" className="cw-workbench__dock">
      {props.items.map((item) => (
        <button
          aria-current={item.active ? "page" : undefined}
          className={`cw-workbench__dock-item cw-workbench__dock-item--${item.tone}`}
          data-panel={item.targetPanel ?? undefined}
          disabled={!item.enabled || item.targetPanel === null}
          key={item.id}
          onClick={props.onPanelClick}
          title={item.title}
          type="button"
        >
          <span>{item.label}</span>
          {item.badgeLabel === null ? null : <small>{item.badgeLabel}</small>}
        </button>
      ))}
    </aside>
  );
}

function RuntimeWorkbenchShellFileTree(props: {
  readonly fileTree: RuntimeWorkbenchShellFileTreeSnapshot;
}): ReactElement {
  const [selectedNodeId, setSelectedNodeId] =
    useState<RuntimeWorkbenchShellFileTreeNodeId | null>(
      props.fileTree.nodes[0]?.id ?? null,
    );
  const selectedNode = useMemo(
    () =>
      props.fileTree.nodes.find((node) => node.id === selectedNodeId) ??
      props.fileTree.nodes[0] ??
      null,
    [props.fileTree.nodes, selectedNodeId],
  );
  const handleNodeSelect = useCallback(
    (nodeId: RuntimeWorkbenchShellFileTreeNodeId): void => {
      setSelectedNodeId(nodeId);
    },
    [],
  );
  const handleNodeClick = useCallback(
    (event: MouseEvent<HTMLLIElement>): void => {
      const nodeId = event.currentTarget.dataset.fileTreeNodeSelect;
      if (!isRuntimeWorkbenchShellFileTreeNodeId(props.fileTree, nodeId)) {
        return;
      }
      handleNodeSelect(nodeId);
    },
    [handleNodeSelect, props.fileTree],
  );
  const handleNodeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>): void => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const nodeId = event.currentTarget.dataset.fileTreeNodeSelect;
      if (!isRuntimeWorkbenchShellFileTreeNodeId(props.fileTree, nodeId)) {
        return;
      }
      event.preventDefault();
      handleNodeSelect(nodeId);
    },
    [handleNodeSelect, props.fileTree],
  );

  return (
    <aside
      aria-label={props.fileTree.title}
      className="cw-workbench__file-tree"
    >
      <div className="cw-workbench__file-tree-header">
        <h2>{props.fileTree.title}</h2>
        <p>{props.fileTree.summary}</p>
      </div>
      <ul className="cw-workbench__file-tree-nodes" role="tree">
        {props.fileTree.nodes.map((node) => {
          const selected = selectedNode?.id === node.id;
          return (
            <li
              aria-selected={selected}
              className={[
                "cw-workbench__file-tree-node",
                `cw-workbench__file-tree-node--depth-${node.depth}`,
                `cw-workbench__file-tree-node--${node.tone}`,
                node.active ? "cw-workbench__file-tree-node--active" : "",
                selected ? "cw-workbench__file-tree-node--selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-file-tree-node={node.id}
              data-file-tree-node-active={node.active ? "true" : undefined}
              data-file-tree-node-select={node.id}
              data-file-tree-node-selected={selected ? "true" : undefined}
              key={node.id}
              onClick={handleNodeClick}
              onKeyDown={handleNodeKeyDown}
              role="treeitem"
              tabIndex={0}
            >
              <span>{node.label}</span>
              <small>{node.statusLabel}</small>
              <code>{node.pathLabel}</code>
            </li>
          );
        })}
      </ul>
      {selectedNode === null ? null : (
        <RuntimeWorkbenchShellFileTreeDetails node={selectedNode} />
      )}
    </aside>
  );
}

function RuntimeWorkbenchShellFileTreeDetails(props: {
  readonly node: RuntimeWorkbenchShellFileTreeNode;
}): ReactElement {
  return (
    <section
      aria-label="File tree selection details"
      className="cw-workbench__file-tree-details"
      data-file-tree-details={props.node.id}
      data-file-tree-details-depth={props.node.depth}
      data-file-tree-details-path={props.node.pathLabel}
      data-file-tree-details-status={props.node.statusLabel}
    >
      <h3>{props.node.label}</h3>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{props.node.statusLabel}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{props.node.pathLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

function RuntimeWorkbenchShellVersionSnapshots(props: {
  readonly snapshots: RuntimeWorkbenchShellVersionSnapshotsSnapshot;
}): ReactElement {
  const [selectedSnapshotId, setSelectedSnapshotId] =
    useState<RuntimeWorkbenchShellVersionSnapshotId | null>(
      props.snapshots.items.find((item) => item.active)?.id ??
        props.snapshots.items[0]?.id ??
        null,
    );
  const selectedSnapshot = useMemo(
    () =>
      props.snapshots.items.find((item) => item.id === selectedSnapshotId) ??
      props.snapshots.items.find((item) => item.active) ??
      props.snapshots.items[0] ??
      null,
    [props.snapshots.items, selectedSnapshotId],
  );
  const handleSnapshotSelect = useCallback(
    (snapshotId: RuntimeWorkbenchShellVersionSnapshotId): void => {
      setSelectedSnapshotId(snapshotId);
    },
    [],
  );
  const handleSnapshotClick = useCallback(
    (event: MouseEvent<HTMLLIElement>): void => {
      const snapshotId = event.currentTarget.dataset.versionSnapshotSelect;
      if (
        !isRuntimeWorkbenchShellVersionSnapshotId(props.snapshots, snapshotId)
      ) {
        return;
      }
      handleSnapshotSelect(snapshotId);
    },
    [handleSnapshotSelect, props.snapshots],
  );
  const handleSnapshotKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>): void => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const snapshotId = event.currentTarget.dataset.versionSnapshotSelect;
      if (
        !isRuntimeWorkbenchShellVersionSnapshotId(props.snapshots, snapshotId)
      ) {
        return;
      }
      event.preventDefault();
      handleSnapshotSelect(snapshotId);
    },
    [handleSnapshotSelect, props.snapshots],
  );

  return (
    <section
      aria-label={props.snapshots.title}
      className="cw-workbench__version-snapshots"
    >
      <div className="cw-workbench__version-snapshots-header">
        <h2>{props.snapshots.title}</h2>
        <p>{props.snapshots.summary}</p>
      </div>
      <ol className="cw-workbench__version-snapshot-items" role="listbox">
        {props.snapshots.items.map((item) => {
          const selected = selectedSnapshot?.id === item.id;
          return (
            <li
              aria-selected={selected}
              className={[
                "cw-workbench__version-snapshot-item",
                `cw-workbench__version-snapshot-item--${item.tone}`,
                item.active
                  ? "cw-workbench__version-snapshot-item--active"
                  : "",
                selected ? "cw-workbench__version-snapshot-item--selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-version-snapshot={item.id}
              data-version-snapshot-active={item.active ? "true" : undefined}
              data-version-snapshot-select={item.id}
              data-version-snapshot-selected={selected ? "true" : undefined}
              key={item.id}
              onClick={handleSnapshotClick}
              onKeyDown={handleSnapshotKeyDown}
              role="option"
              tabIndex={0}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.statusLabel}</small>
            </li>
          );
        })}
      </ol>
      {selectedSnapshot === null ? null : (
        <RuntimeWorkbenchShellVersionSnapshotDetails item={selectedSnapshot} />
      )}
    </section>
  );
}

function RuntimeWorkbenchShellVersionSnapshotDetails(props: {
  readonly item: RuntimeWorkbenchShellVersionSnapshotItem;
}): ReactElement {
  return (
    <section
      aria-label="Version snapshot selection details"
      className="cw-workbench__version-snapshot-details"
      data-version-snapshot-details={props.item.id}
      data-version-snapshot-details-active={
        props.item.active ? "true" : "false"
      }
      data-version-snapshot-details-status={props.item.statusLabel}
      data-version-snapshot-details-value={props.item.value}
    >
      <h3>{props.item.label}</h3>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{props.item.statusLabel}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{props.item.value}</dd>
        </div>
        <div>
          <dt>Active</dt>
          <dd>{props.item.active ? "Yes" : "No"}</dd>
        </div>
      </dl>
    </section>
  );
}

function RuntimeWorkbenchShellVersionSnapshotControls(props: {
  readonly versionSnapshot: RuntimeWorkbenchShellSnapshot["versionSnapshot"];
  readonly state: RuntimeWorkbenchShellReactVersionSnapshotFormState;
  readonly ready: boolean;
  readonly onTextInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onCreateSnapshotClick: () => void;
}): ReactElement {
  return (
    <section
      aria-label="Version snapshot action"
      className="cw-workbench__version-snapshot-action"
      data-version-snapshot-can-create={
        props.versionSnapshot.canCreateSnapshot ? "true" : "false"
      }
      data-version-snapshot-control="true"
      data-version-snapshot-status={props.versionSnapshot.status}
    >
      <div className="cw-workbench__version-snapshot-action-form">
        <label className="cw-workbench__version-snapshot-action-field">
          <span>Workflow id</span>
          <input
            data-version-snapshot-field="workflowId"
            inputMode="text"
            onChange={props.onTextInputChange}
            value={props.state.workflowId}
          />
        </label>
        <button
          className="cw-workbench__version-snapshot-create"
          data-version-snapshot-create="true"
          data-version-snapshot-create-enabled={props.ready ? "true" : "false"}
          disabled={!props.ready}
          onClick={props.onCreateSnapshotClick}
          type="button"
        >
          Create snapshot
        </button>
      </div>
      <dl className="cw-workbench__version-snapshot-action-status">
        <div>
          <dt>Status</dt>
          <dd>{props.versionSnapshot.status}</dd>
        </div>
        <div>
          <dt>Workflow</dt>
          <dd>{props.versionSnapshot.workflowId ?? "none"}</dd>
        </div>
        <div>
          <dt>Snapshot</dt>
          <dd>{props.versionSnapshot.snapshotId ?? "none"}</dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd>{props.versionSnapshot.commitSha ?? "none"}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{props.versionSnapshot.path ?? "none"}</dd>
        </div>
        <div>
          <dt>Status code</dt>
          <dd>{props.versionSnapshot.statusCode ?? "none"}</dd>
        </div>
      </dl>
    </section>
  );
}

interface RuntimeWorkbenchShellWorkflowCanvasSelectionState {
  readonly selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null;
  readonly history: readonly RuntimeWorkbenchShellWorkflowCanvasNodeId[];
}

type RuntimeWorkbenchShellWorkflowCanvasTypeFocus =
  | {
      readonly kind: "node";
      readonly value: RuntimeWorkbenchShellWorkflowCanvasNode["type"];
    }
  | {
      readonly kind: "edge";
      readonly value: RuntimeWorkbenchShellWorkflowCanvasEdge["type"];
    };

interface RuntimeWorkbenchShellWorkflowCanvasSummary {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly activeNodeCount: number;
  readonly entryNodeCount: number;
  readonly terminalNodeCount: number;
  readonly nodeTypes: readonly RuntimeWorkbenchShellWorkflowCanvasNodeSummaryItem[];
  readonly edgeTypes: readonly RuntimeWorkbenchShellWorkflowCanvasEdgeSummaryItem[];
}

interface RuntimeWorkbenchShellWorkflowCanvasNodeSummaryItem {
  readonly label: RuntimeWorkbenchShellWorkflowCanvasNode["type"];
  readonly count: number;
}

interface RuntimeWorkbenchShellWorkflowCanvasEdgeSummaryItem {
  readonly label: RuntimeWorkbenchShellWorkflowCanvasEdge["type"];
  readonly count: number;
}

const RUNTIME_WORKBENCH_SHELL_WORKFLOW_CANVAS_NODE_TYPE_ORDER: readonly RuntimeWorkbenchShellWorkflowCanvasNode["type"][] =
  ["start", "execution_task", "evaluation_task", "repair_task", "end"];

const RUNTIME_WORKBENCH_SHELL_WORKFLOW_CANVAS_EDGE_TYPE_ORDER: readonly RuntimeWorkbenchShellWorkflowCanvasEdge["type"][] =
  ["normal", "pass", "fail", "repair"];

function RuntimeWorkbenchShellWorkflowCanvas(props: {
  readonly canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot;
  readonly selectedNodeId?: RuntimeWorkbenchShellWorkflowCanvasNodeId | null;
  readonly onSelectedNodeChange?: (
    nodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId,
  ) => void;
  readonly surface: "focused" | "preview";
}): ReactElement {
  const [selectionState, setSelectionState] =
    useState<RuntimeWorkbenchShellWorkflowCanvasSelectionState>({
      history: [],
      selectedNodeId: null,
    });
  const [typeFocus, setTypeFocus] =
    useState<RuntimeWorkbenchShellWorkflowCanvasTypeFocus | null>(null);
  const nodeButtonRefs = useRef(
    new Map<RuntimeWorkbenchShellWorkflowCanvasNodeId, HTMLButtonElement>(),
  );
  const selectable = props.surface === "focused";
  const onSelectedNodeChange = props.onSelectedNodeChange;
  const effectiveSelectedNodeId =
    props.selectedNodeId ?? selectionState.selectedNodeId;
  const selectedNode = useMemo(
    () =>
      selectRuntimeWorkbenchShellWorkflowCanvasNode(
        props.canvas,
        effectiveSelectedNodeId,
      ),
    [effectiveSelectedNodeId, props.canvas],
  );
  const previousSelectedNodeId =
    selectionState.history[selectionState.history.length - 1] ?? null;
  const canvasSummary = useMemo(
    () => runtimeWorkbenchShellWorkflowCanvasSummary(props.canvas),
    [props.canvas],
  );
  const selectedIncomingEdges = useMemo(
    () =>
      selectedNode === null
        ? []
        : props.canvas.edges.filter(
            (edge) => edge.targetNodeId === selectedNode.nodeId,
          ),
    [props.canvas.edges, selectedNode],
  );
  const selectedOutgoingEdges = useMemo(
    () =>
      selectedNode === null
        ? []
        : props.canvas.edges.filter(
            (edge) => edge.sourceNodeId === selectedNode.nodeId,
          ),
    [props.canvas.edges, selectedNode],
  );
  const selectNode = useCallback(
    (nodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId): void => {
      setSelectionState((current) => {
        const currentNode = selectRuntimeWorkbenchShellWorkflowCanvasNode(
          props.canvas,
          current.selectedNodeId,
        );
        if (currentNode?.nodeId === nodeId) {
          return current;
        }
        return {
          history:
            currentNode === null
              ? current.history
              : [...current.history, currentNode.nodeId].slice(-8),
          selectedNodeId: nodeId,
        };
      });
      onSelectedNodeChange?.(nodeId);
    },
    [onSelectedNodeChange, props.canvas],
  );
  const handleNodeSelectClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const nodeId = event.currentTarget.dataset.workflowCanvasNodeSelect;
      if (!isRuntimeWorkbenchShellWorkflowCanvasNodeId(props.canvas, nodeId)) {
        return;
      }
      selectNode(nodeId);
    },
    [props.canvas, selectNode],
  );
  const handleNodeSelectKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      const nodeId = runtimeWorkbenchShellWorkflowCanvasKeyboardTargetNodeId(
        props.canvas,
        selectedNode?.nodeId ?? null,
        event.key,
      );
      if (nodeId === null) {
        return;
      }
      event.preventDefault();
      selectNode(nodeId);
      nodeButtonRefs.current.get(nodeId)?.focus({ preventScroll: true });
    },
    [props.canvas, selectNode, selectedNode],
  );
  const handleInspectorRouteSelectClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const nodeId = event.currentTarget.dataset.workflowCanvasRouteSelect;
      if (!isRuntimeWorkbenchShellWorkflowCanvasNodeId(props.canvas, nodeId)) {
        return;
      }
      selectNode(nodeId);
    },
    [props.canvas, selectNode],
  );
  const handleInspectorBackClick = useCallback((): void => {
    const previousNodeId =
      selectionState.history[selectionState.history.length - 1];
    if (previousNodeId === undefined) {
      return;
    }
    setSelectionState({
      history: selectionState.history.slice(0, -1),
      selectedNodeId: previousNodeId,
    });
    onSelectedNodeChange?.(previousNodeId);
  }, [onSelectedNodeChange, selectionState.history]);
  const handleInspectorHistorySelectClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const nodeId = event.currentTarget.dataset.workflowCanvasHistorySelect;
      const rawIndex = event.currentTarget.dataset.workflowCanvasHistoryIndex;
      if (
        !isRuntimeWorkbenchShellWorkflowCanvasNodeId(props.canvas, nodeId) ||
        rawIndex === undefined
      ) {
        return;
      }
      const historyIndex = Number(rawIndex);
      if (!Number.isSafeInteger(historyIndex) || historyIndex < 0) {
        return;
      }
      if (selectionState.history[historyIndex] !== nodeId) {
        return;
      }
      setSelectionState({
        history: selectionState.history.slice(0, historyIndex),
        selectedNodeId: nodeId,
      });
      onSelectedNodeChange?.(nodeId);
      nodeButtonRefs.current.get(nodeId)?.focus({ preventScroll: true });
    },
    [onSelectedNodeChange, props.canvas, selectionState.history],
  );
  const handleTypeFocusClick = useCallback(
    (focus: RuntimeWorkbenchShellWorkflowCanvasTypeFocus): void => {
      setTypeFocus(focus);
    },
    [],
  );
  const handleTypeFocusClearClick = useCallback((): void => {
    setTypeFocus(null);
  }, []);
  const handleTypeFocusNodeSelectClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const nodeId =
        event.currentTarget.dataset.workflowCanvasTypeFocusNodeSelect;
      if (!isRuntimeWorkbenchShellWorkflowCanvasNodeId(props.canvas, nodeId)) {
        return;
      }
      selectNode(nodeId);
      nodeButtonRefs.current.get(nodeId)?.focus({ preventScroll: true });
    },
    [props.canvas, selectNode],
  );

  return (
    <section
      aria-label={props.canvas.title}
      className={[
        "cw-workbench__workflow-canvas",
        `cw-workbench__workflow-canvas--${props.surface}`,
      ].join(" ")}
      data-workflow-canvas-surface={props.surface}
      data-workflow-canvas-status={props.canvas.statusLabel}
    >
      <div className="cw-workbench__workflow-canvas-header">
        <div>
          <h2>{props.canvas.title}</h2>
          <p>{props.canvas.summary}</p>
        </div>
        <span>{props.canvas.statusLabel}</span>
      </div>
      <div className="cw-workbench__workflow-canvas-body">
        <ol
          aria-label="Workflow canvas nodes"
          className="cw-workbench__workflow-canvas-nodes"
        >
          {props.canvas.nodes.map((node) => (
            <RuntimeWorkbenchShellWorkflowCanvasNodeItem
              handleNodeSelectClick={handleNodeSelectClick}
              handleNodeSelectKeyDown={handleNodeSelectKeyDown}
              key={node.nodeId}
              node={node}
              nodeButtonRef={(element) => {
                if (element === null) {
                  nodeButtonRefs.current.delete(node.nodeId);
                  return;
                }
                nodeButtonRefs.current.set(node.nodeId, element);
              }}
              selected={selectable && selectedNode?.nodeId === node.nodeId}
              selectable={selectable}
              typeFocused={
                selectable &&
                typeFocus?.kind === "node" &&
                typeFocus.value === node.type
              }
            />
          ))}
        </ol>
        <div className="cw-workbench__workflow-canvas-sidebar">
          {selectable ? (
            <RuntimeWorkbenchShellWorkflowCanvasSummaryPanel
              canvas={props.canvas}
              handleTypeFocusClearClick={handleTypeFocusClearClick}
              handleTypeFocusClick={handleTypeFocusClick}
              handleTypeFocusNodeSelectClick={handleTypeFocusNodeSelectClick}
              summary={canvasSummary}
              typeFocus={typeFocus}
            />
          ) : null}
          {selectable && selectedNode !== null ? (
            <RuntimeWorkbenchShellWorkflowCanvasInspector
              handleBackClick={handleInspectorBackClick}
              handleHistorySelectClick={handleInspectorHistorySelectClick}
              handleRouteSelectClick={handleInspectorRouteSelectClick}
              history={selectionState.history}
              historyDepth={selectionState.history.length}
              incomingEdges={selectedIncomingEdges}
              node={selectedNode}
              outgoingEdges={selectedOutgoingEdges}
              previousNodeId={previousSelectedNodeId}
            />
          ) : null}
          <ol
            aria-label="Workflow canvas edges"
            className="cw-workbench__workflow-canvas-edges"
          >
            {props.canvas.edges.map((edge) => (
              <RuntimeWorkbenchShellWorkflowCanvasEdgeItem
                edge={edge}
                key={edge.edgeId}
                selectedDirection={
                  selectable && selectedNode !== null
                    ? runtimeWorkbenchShellWorkflowCanvasEdgeDirection(
                        edge,
                        selectedNode.nodeId,
                      )
                    : null
                }
                typeFocused={
                  selectable &&
                  typeFocus?.kind === "edge" &&
                  typeFocus.value === edge.type
                }
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasSummaryPanel(props: {
  readonly canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot;
  readonly summary: RuntimeWorkbenchShellWorkflowCanvasSummary;
  readonly typeFocus: RuntimeWorkbenchShellWorkflowCanvasTypeFocus | null;
  readonly handleTypeFocusClick: (
    focus: RuntimeWorkbenchShellWorkflowCanvasTypeFocus,
  ) => void;
  readonly handleTypeFocusClearClick: () => void;
  readonly handleTypeFocusNodeSelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  return (
    <aside
      aria-label="Canvas graph summary"
      className="cw-workbench__workflow-canvas-summary"
      data-workflow-canvas-summary="true"
      data-workflow-canvas-summary-active-nodes={props.summary.activeNodeCount}
      data-workflow-canvas-summary-edges={props.summary.edgeCount}
      data-workflow-canvas-summary-entry-nodes={props.summary.entryNodeCount}
      data-workflow-canvas-summary-nodes={props.summary.nodeCount}
      data-workflow-canvas-summary-terminal-nodes={
        props.summary.terminalNodeCount
      }
      data-workflow-canvas-type-focus-kind={props.typeFocus?.kind ?? undefined}
      data-workflow-canvas-type-focus-value={
        props.typeFocus?.value ?? undefined
      }
    >
      <div className="cw-workbench__workflow-canvas-summary-heading">
        <h3>Graph summary</h3>
        {props.typeFocus === null ? null : (
          <button
            className="cw-workbench__workflow-canvas-type-focus-clear"
            data-workflow-canvas-type-focus-clear="true"
            onClick={props.handleTypeFocusClearClick}
            type="button"
          >
            Clear focus
          </button>
        )}
      </div>
      <dl>
        <RuntimeWorkbenchShellWorkflowCanvasSummaryMetric
          label="Nodes"
          metric="nodes"
          value={props.summary.nodeCount}
        />
        <RuntimeWorkbenchShellWorkflowCanvasSummaryMetric
          label="Edges"
          metric="edges"
          value={props.summary.edgeCount}
        />
        <RuntimeWorkbenchShellWorkflowCanvasSummaryMetric
          label="Active"
          metric="active_nodes"
          value={props.summary.activeNodeCount}
        />
        <RuntimeWorkbenchShellWorkflowCanvasSummaryMetric
          label="Entry"
          metric="entry_nodes"
          value={props.summary.entryNodeCount}
        />
        <RuntimeWorkbenchShellWorkflowCanvasSummaryMetric
          label="Terminal"
          metric="terminal_nodes"
          value={props.summary.terminalNodeCount}
        />
      </dl>
      <RuntimeWorkbenchShellWorkflowCanvasNodeSummaryList
        handleTypeFocusClick={props.handleTypeFocusClick}
        items={props.summary.nodeTypes}
        title="Node types"
        typeFocus={props.typeFocus?.kind === "node" ? props.typeFocus : null}
      />
      <RuntimeWorkbenchShellWorkflowCanvasEdgeSummaryList
        handleTypeFocusClick={props.handleTypeFocusClick}
        items={props.summary.edgeTypes}
        title="Edge types"
        typeFocus={props.typeFocus?.kind === "edge" ? props.typeFocus : null}
      />
      <RuntimeWorkbenchShellWorkflowCanvasTypeFocusDetails
        canvas={props.canvas}
        handleNodeSelectClick={props.handleTypeFocusNodeSelectClick}
        typeFocus={props.typeFocus}
      />
    </aside>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasSummaryMetric(props: {
  readonly label: string;
  readonly metric: string;
  readonly value: number;
}): ReactElement {
  return (
    <div
      data-workflow-canvas-summary-metric={props.metric}
      data-workflow-canvas-summary-value={props.value}
    >
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasNodeSummaryList(props: {
  readonly title: string;
  readonly items: readonly RuntimeWorkbenchShellWorkflowCanvasNodeSummaryItem[];
  readonly typeFocus: Extract<
    RuntimeWorkbenchShellWorkflowCanvasTypeFocus,
    { readonly kind: "node" }
  > | null;
  readonly handleTypeFocusClick: (
    focus: Extract<
      RuntimeWorkbenchShellWorkflowCanvasTypeFocus,
      { readonly kind: "node" }
    >,
  ) => void;
}): ReactElement {
  return (
    <section>
      <h4>{props.title}</h4>
      <ol>
        {props.items.map((item) => {
          const focused = props.typeFocus?.value === item.label;
          return (
            <li key={item.label}>
              <button
                aria-pressed={focused}
                className={[
                  "cw-workbench__workflow-canvas-type-focus-button",
                  focused
                    ? "cw-workbench__workflow-canvas-type-focus-button--active"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-workflow-canvas-summary-count={item.count}
                data-workflow-canvas-summary-node-type={item.label}
                data-workflow-canvas-type-focus-active={
                  focused ? "true" : undefined
                }
                data-workflow-canvas-type-focus-kind="node"
                data-workflow-canvas-type-focus-value={item.label}
                onClick={() =>
                  props.handleTypeFocusClick({
                    kind: "node",
                    value: item.label,
                  })
                }
                type="button"
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasEdgeSummaryList(props: {
  readonly title: string;
  readonly items: readonly RuntimeWorkbenchShellWorkflowCanvasEdgeSummaryItem[];
  readonly typeFocus: Extract<
    RuntimeWorkbenchShellWorkflowCanvasTypeFocus,
    { readonly kind: "edge" }
  > | null;
  readonly handleTypeFocusClick: (
    focus: Extract<
      RuntimeWorkbenchShellWorkflowCanvasTypeFocus,
      { readonly kind: "edge" }
    >,
  ) => void;
}): ReactElement {
  return (
    <section>
      <h4>{props.title}</h4>
      <ol>
        {props.items.map((item) => {
          const focused = props.typeFocus?.value === item.label;
          return (
            <li key={item.label}>
              <button
                aria-pressed={focused}
                className={[
                  "cw-workbench__workflow-canvas-type-focus-button",
                  focused
                    ? "cw-workbench__workflow-canvas-type-focus-button--active"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-workflow-canvas-summary-count={item.count}
                data-workflow-canvas-summary-edge-type={item.label}
                data-workflow-canvas-type-focus-active={
                  focused ? "true" : undefined
                }
                data-workflow-canvas-type-focus-kind="edge"
                data-workflow-canvas-type-focus-value={item.label}
                onClick={() =>
                  props.handleTypeFocusClick({
                    kind: "edge",
                    value: item.label,
                  })
                }
                type="button"
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasTypeFocusDetails(props: {
  readonly canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot;
  readonly typeFocus: RuntimeWorkbenchShellWorkflowCanvasTypeFocus | null;
  readonly handleNodeSelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement | null {
  if (props.typeFocus === null) {
    return null;
  }
  if (props.typeFocus.kind === "node") {
    const typeFocus = props.typeFocus;
    const nodes = props.canvas.nodes.filter(
      (node) => node.type === typeFocus.value,
    );
    return (
      <section
        aria-label="Canvas type focus node matches"
        className="cw-workbench__workflow-canvas-type-focus-details"
        data-workflow-canvas-type-focus-details="node"
        data-workflow-canvas-type-focus-details-value={typeFocus.value}
        data-workflow-canvas-type-focus-match-count={nodes.length}
      >
        <h4>{typeFocus.value} matches</h4>
        <ol>
          {nodes.map((node) => (
            <li
              data-workflow-canvas-type-focus-node-match={node.nodeId}
              key={node.nodeId}
            >
              <button
                className="cw-workbench__workflow-canvas-type-focus-match-button"
                data-workflow-canvas-type-focus-node-select={node.nodeId}
                onClick={props.handleNodeSelectClick}
                type="button"
              >
                <span>{node.type}</span>
                <strong>{node.title}</strong>
                <small>{node.nodeId}</small>
              </button>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const typeFocus = props.typeFocus;
  const edges = props.canvas.edges.filter(
    (edge) => edge.type === typeFocus.value,
  );
  return (
    <section
      aria-label="Canvas type focus edge matches"
      className="cw-workbench__workflow-canvas-type-focus-details"
      data-workflow-canvas-type-focus-details="edge"
      data-workflow-canvas-type-focus-details-value={typeFocus.value}
      data-workflow-canvas-type-focus-match-count={edges.length}
    >
      <h4>{typeFocus.value} matches</h4>
      <ol>
        {edges.map((edge) => (
          <li
            data-workflow-canvas-type-focus-edge-match={edge.edgeId}
            key={edge.edgeId}
          >
            <div className="cw-workbench__workflow-canvas-type-focus-match-row">
              <span>{edge.type}</span>
              <strong>
                {edge.sourceNodeId} {" -> "} {edge.targetNodeId}
              </strong>
              <small>{edge.label}</small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasNodeItem(props: {
  readonly node: RuntimeWorkbenchShellWorkflowCanvasNode;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly typeFocused: boolean;
  readonly handleNodeSelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly handleNodeSelectKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
  readonly nodeButtonRef: (element: HTMLButtonElement | null) => void;
}): ReactElement {
  return (
    <li
      className={[
        "cw-workbench__workflow-canvas-node",
        `cw-workbench__workflow-canvas-node--${props.node.tone}`,
        props.node.active ? "cw-workbench__workflow-canvas-node--active" : "",
        props.selected ? "cw-workbench__workflow-canvas-node--selected" : "",
        props.typeFocused
          ? "cw-workbench__workflow-canvas-node--type-focused"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-workflow-canvas-node={props.node.nodeId}
      data-workflow-canvas-node-selected={props.selected ? "true" : undefined}
      data-workflow-canvas-node-type-focused={
        props.typeFocused ? "true" : undefined
      }
      style={
        {
          left: `${props.node.position.x}%`,
          top: `${props.node.position.y}%`,
        } as CSSProperties
      }
    >
      {props.selectable ? (
        <button
          aria-pressed={props.selected}
          className="cw-workbench__workflow-canvas-node-button"
          data-workflow-canvas-node-select={props.node.nodeId}
          onClick={props.handleNodeSelectClick}
          onKeyDown={props.handleNodeSelectKeyDown}
          ref={props.nodeButtonRef}
          type="button"
        >
          <RuntimeWorkbenchShellWorkflowCanvasNodeContent node={props.node} />
        </button>
      ) : (
        <RuntimeWorkbenchShellWorkflowCanvasNodeContent node={props.node} />
      )}
    </li>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasEdgeItem(props: {
  readonly edge: RuntimeWorkbenchShellWorkflowCanvasEdge;
  readonly selectedDirection: "incoming" | "outgoing" | null;
  readonly typeFocused: boolean;
}): ReactElement {
  return (
    <li
      className={[
        "cw-workbench__workflow-canvas-edge",
        `cw-workbench__workflow-canvas-edge--${props.edge.tone}`,
        props.selectedDirection === null
          ? ""
          : "cw-workbench__workflow-canvas-edge--selected",
        props.selectedDirection === "incoming"
          ? "cw-workbench__workflow-canvas-edge--incoming"
          : "",
        props.selectedDirection === "outgoing"
          ? "cw-workbench__workflow-canvas-edge--outgoing"
          : "",
        props.typeFocused
          ? "cw-workbench__workflow-canvas-edge--type-focused"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-workflow-canvas-edge={props.edge.edgeId}
      data-workflow-canvas-edge-direction={props.selectedDirection ?? undefined}
      data-workflow-canvas-edge-selected={
        props.selectedDirection === null ? undefined : "true"
      }
      data-workflow-canvas-edge-type-focused={
        props.typeFocused ? "true" : undefined
      }
    >
      <RuntimeWorkbenchShellWorkflowCanvasEdgeContent edge={props.edge} />
    </li>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasEdgeContent(props: {
  readonly edge: RuntimeWorkbenchShellWorkflowCanvasEdge;
}): ReactElement {
  return (
    <>
      <span>{props.edge.type}</span>
      <strong>
        {props.edge.sourceNodeId} {" -> "} {props.edge.targetNodeId}
      </strong>
      <small>{props.edge.label}</small>
    </>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasNodeContent(props: {
  readonly node: RuntimeWorkbenchShellWorkflowCanvasNode;
}): ReactElement {
  return (
    <>
      <span>{props.node.type}</span>
      <strong>{props.node.title}</strong>
      <small>{props.node.statusLabel}</small>
    </>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasInspector(props: {
  readonly node: RuntimeWorkbenchShellWorkflowCanvasNode;
  readonly incomingEdges: readonly RuntimeWorkbenchShellWorkflowCanvasEdge[];
  readonly outgoingEdges: readonly RuntimeWorkbenchShellWorkflowCanvasEdge[];
  readonly history: readonly RuntimeWorkbenchShellWorkflowCanvasNodeId[];
  readonly historyDepth: number;
  readonly previousNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null;
  readonly handleBackClick: () => void;
  readonly handleHistorySelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly handleRouteSelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  return (
    <aside
      aria-label="Canvas inspector"
      className="cw-workbench__workflow-canvas-inspector"
      data-workflow-canvas-inspector-history-depth={props.historyDepth}
      data-workflow-canvas-inspector={props.node.nodeId}
    >
      <div className="cw-workbench__workflow-canvas-inspector-heading">
        <h3>{props.node.title}</h3>
        {props.previousNodeId === null ? null : (
          <button
            className="cw-workbench__workflow-canvas-inspector-back"
            data-workflow-canvas-inspector-back="true"
            data-workflow-canvas-inspector-back-target={props.previousNodeId}
            onClick={props.handleBackClick}
            type="button"
          >
            Back to {props.previousNodeId}
          </button>
        )}
      </div>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{props.node.type}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{props.node.statusLabel}</dd>
        </div>
        <div>
          <dt>Incoming</dt>
          <dd>{props.incomingEdges.length}</dd>
        </div>
        <div>
          <dt>Outgoing</dt>
          <dd>{props.outgoingEdges.length}</dd>
        </div>
      </dl>
      <RuntimeWorkbenchShellWorkflowCanvasHistoryTrail
        handleHistorySelectClick={props.handleHistorySelectClick}
        history={props.history}
      />
      <RuntimeWorkbenchShellWorkflowCanvasInspectorEdgeList
        currentNodeId={props.node.nodeId}
        edges={props.incomingEdges}
        emptyLabel="No incoming edges"
        handleRouteSelectClick={props.handleRouteSelectClick}
        title="Incoming edges"
      />
      <RuntimeWorkbenchShellWorkflowCanvasInspectorEdgeList
        currentNodeId={props.node.nodeId}
        edges={props.outgoingEdges}
        emptyLabel="No outgoing edges"
        handleRouteSelectClick={props.handleRouteSelectClick}
        title="Outgoing edges"
      />
    </aside>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasHistoryTrail(props: {
  readonly history: readonly RuntimeWorkbenchShellWorkflowCanvasNodeId[];
  readonly handleHistorySelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement | null {
  if (props.history.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Canvas history trail"
      className="cw-workbench__workflow-canvas-history"
      data-workflow-canvas-history-trail="true"
    >
      <h4>History</h4>
      <ol>
        {props.history.map((nodeId, index) => (
          <li
            data-workflow-canvas-history-item={nodeId}
            key={`${index}-${nodeId}`}
          >
            <button
              className="cw-workbench__workflow-canvas-history-button"
              data-workflow-canvas-history-index={index}
              data-workflow-canvas-history-select={nodeId}
              onClick={props.handleHistorySelectClick}
              type="button"
            >
              <span>{index + 1}</span>
              <strong>{nodeId}</strong>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasInspectorEdgeList(props: {
  readonly title: string;
  readonly emptyLabel: string;
  readonly currentNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId;
  readonly edges: readonly RuntimeWorkbenchShellWorkflowCanvasEdge[];
  readonly handleRouteSelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  return (
    <section className="cw-workbench__workflow-canvas-inspector-routes">
      <h4>{props.title}</h4>
      {props.edges.length === 0 ? (
        <p>{props.emptyLabel}</p>
      ) : (
        <ol>
          {props.edges.map((edge) => (
            <RuntimeWorkbenchShellWorkflowCanvasInspectorEdgeItem
              currentNodeId={props.currentNodeId}
              edge={edge}
              handleRouteSelectClick={props.handleRouteSelectClick}
              key={edge.edgeId}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function RuntimeWorkbenchShellWorkflowCanvasInspectorEdgeItem(props: {
  readonly currentNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId;
  readonly edge: RuntimeWorkbenchShellWorkflowCanvasEdge;
  readonly handleRouteSelectClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  const adjacentNodeId = runtimeWorkbenchShellWorkflowCanvasAdjacentNodeId(
    props.edge,
    props.currentNodeId,
  );
  return (
    <li data-workflow-canvas-inspector-edge={props.edge.edgeId}>
      <div className="cw-workbench__workflow-canvas-inspector-route-content">
        <RuntimeWorkbenchShellWorkflowCanvasEdgeContent edge={props.edge} />
      </div>
      {adjacentNodeId === null ? null : (
        <button
          aria-label={`Select ${adjacentNodeId}`}
          className="cw-workbench__workflow-canvas-inspector-route-button"
          data-workflow-canvas-inspector-edge-route={props.edge.edgeId}
          data-workflow-canvas-route-select={adjacentNodeId}
          onClick={props.handleRouteSelectClick}
          type="button"
        >
          {adjacentNodeId}
        </button>
      )}
    </li>
  );
}

function selectRuntimeWorkbenchShellWorkflowCanvasNode(
  canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot,
  selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null,
): RuntimeWorkbenchShellWorkflowCanvasNode | null {
  return (
    (selectedNodeId === null
      ? undefined
      : canvas.nodes.find((node) => node.nodeId === selectedNodeId)) ??
    canvas.nodes.find((node) => node.active) ??
    canvas.nodes[0] ??
    null
  );
}

function selectRuntimeWorkbenchShellCurrentWorkflowCanvasNode(
  canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot,
  selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null,
): RuntimeWorkbenchShellWorkflowCanvasNode | null {
  return (
    (selectedNodeId === null
      ? undefined
      : canvas.nodes.find((node) => node.nodeId === selectedNodeId)) ??
    canvas.nodes.find((node) => node.active) ??
    null
  );
}

function isRuntimeWorkbenchShellFileTreeNodeId(
  fileTree: RuntimeWorkbenchShellFileTreeSnapshot,
  value: string | undefined,
): value is RuntimeWorkbenchShellFileTreeNodeId {
  return (
    value !== undefined && fileTree.nodes.some((node) => node.id === value)
  );
}

function isRuntimeWorkbenchShellVersionSnapshotId(
  snapshots: RuntimeWorkbenchShellVersionSnapshotsSnapshot,
  value: string | undefined,
): value is RuntimeWorkbenchShellVersionSnapshotId {
  return (
    value !== undefined && snapshots.items.some((item) => item.id === value)
  );
}

function isRuntimeWorkbenchShellTaskDrawerItemId(
  drawer: RuntimeWorkbenchShellTaskDrawerSnapshot,
  value: string | undefined,
): value is RuntimeWorkbenchShellTaskDrawerItemId {
  return value !== undefined && drawer.items.some((item) => item.id === value);
}

function isRuntimeWorkbenchShellWorkflowCanvasNodeId(
  canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot,
  value: string | undefined,
): value is RuntimeWorkbenchShellWorkflowCanvasNodeId {
  return (
    value !== undefined && canvas.nodes.some((node) => node.nodeId === value)
  );
}

function runtimeWorkbenchShellWorkflowCanvasEdgeDirection(
  edge: RuntimeWorkbenchShellWorkflowCanvasEdge,
  selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId,
): "incoming" | "outgoing" | null {
  if (edge.targetNodeId === selectedNodeId) {
    return "incoming";
  }
  if (edge.sourceNodeId === selectedNodeId) {
    return "outgoing";
  }
  return null;
}

function runtimeWorkbenchShellWorkflowCanvasAdjacentNodeId(
  edge: RuntimeWorkbenchShellWorkflowCanvasEdge,
  selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId,
): RuntimeWorkbenchShellWorkflowCanvasNodeId | null {
  if (edge.targetNodeId === selectedNodeId) {
    return edge.sourceNodeId;
  }
  if (edge.sourceNodeId === selectedNodeId) {
    return edge.targetNodeId;
  }
  return null;
}

function runtimeWorkbenchShellWorkflowCanvasSummary(
  canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot,
): RuntimeWorkbenchShellWorkflowCanvasSummary {
  const nodeTypeCounts = new Map<
    RuntimeWorkbenchShellWorkflowCanvasNode["type"],
    number
  >();
  const edgeTypeCounts = new Map<
    RuntimeWorkbenchShellWorkflowCanvasEdge["type"],
    number
  >();
  for (const type of RUNTIME_WORKBENCH_SHELL_WORKFLOW_CANVAS_NODE_TYPE_ORDER) {
    nodeTypeCounts.set(type, 0);
  }
  for (const type of RUNTIME_WORKBENCH_SHELL_WORKFLOW_CANVAS_EDGE_TYPE_ORDER) {
    edgeTypeCounts.set(type, 0);
  }

  let activeNodeCount = 0;
  let entryNodeCount = 0;
  let terminalNodeCount = 0;
  for (const node of canvas.nodes) {
    nodeTypeCounts.set(node.type, (nodeTypeCounts.get(node.type) ?? 0) + 1);
    if (node.active) {
      activeNodeCount += 1;
    }
    if (node.type === "start") {
      entryNodeCount += 1;
    }
    if (node.type === "end") {
      terminalNodeCount += 1;
    }
  }
  for (const edge of canvas.edges) {
    edgeTypeCounts.set(edge.type, (edgeTypeCounts.get(edge.type) ?? 0) + 1);
  }

  return {
    activeNodeCount,
    edgeCount: canvas.edges.length,
    edgeTypes: RUNTIME_WORKBENCH_SHELL_WORKFLOW_CANVAS_EDGE_TYPE_ORDER.map(
      (type) => ({
        count: edgeTypeCounts.get(type) ?? 0,
        label: type,
      }),
    ).filter((item) => item.count > 0),
    entryNodeCount,
    nodeCount: canvas.nodes.length,
    nodeTypes: RUNTIME_WORKBENCH_SHELL_WORKFLOW_CANVAS_NODE_TYPE_ORDER.map(
      (type) => ({
        count: nodeTypeCounts.get(type) ?? 0,
        label: type,
      }),
    ).filter((item) => item.count > 0),
    terminalNodeCount,
  };
}

function runtimeWorkbenchShellWorkflowCanvasKeyboardTargetNodeId(
  canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot,
  selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null,
  key: string,
): RuntimeWorkbenchShellWorkflowCanvasNodeId | null {
  const nodeCount = canvas.nodes.length;
  if (nodeCount === 0) {
    return null;
  }
  const currentIndex =
    selectedNodeId === null
      ? -1
      : canvas.nodes.findIndex((node) => node.nodeId === selectedNodeId);
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (
        canvas.nodes[
          Math.min(currentIndex < 0 ? 0 : currentIndex + 1, nodeCount - 1)
        ]?.nodeId ?? null
      );
    case "ArrowLeft":
    case "ArrowUp":
      return canvas.nodes[Math.max(currentIndex - 1, 0)]?.nodeId ?? null;
    case "End":
      return canvas.nodes[nodeCount - 1]?.nodeId ?? null;
    case "Home":
      return canvas.nodes[0]?.nodeId ?? null;
    default:
      return null;
  }
}

function RuntimeWorkbenchShellTaskDrawer(props: {
  readonly drawer: RuntimeWorkbenchShellTaskDrawerSnapshot;
}): ReactElement {
  const [expanded, setExpanded] = useState(
    () => !props.drawer.defaultCollapsed,
  );
  const [selectedItemId, setSelectedItemId] =
    useState<RuntimeWorkbenchShellTaskDrawerItemId | null>(
      props.drawer.items.find((item) => item.id === "active_panel")?.id ??
        props.drawer.items[0]?.id ??
        null,
    );
  const selectedItem = useMemo(
    () =>
      props.drawer.items.find((item) => item.id === selectedItemId) ??
      props.drawer.items[0] ??
      null,
    [props.drawer.items, selectedItemId],
  );
  const handleToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
  const handleItemSelect = useCallback(
    (itemId: RuntimeWorkbenchShellTaskDrawerItemId): void => {
      setSelectedItemId(itemId);
    },
    [],
  );
  const handleItemClick = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      const itemId = event.currentTarget.dataset.taskDrawerItemSelect;
      if (!isRuntimeWorkbenchShellTaskDrawerItemId(props.drawer, itemId)) {
        return;
      }
      handleItemSelect(itemId);
    },
    [handleItemSelect, props.drawer],
  );
  const handleItemKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const itemId = event.currentTarget.dataset.taskDrawerItemSelect;
      if (!isRuntimeWorkbenchShellTaskDrawerItemId(props.drawer, itemId)) {
        return;
      }
      event.preventDefault();
      handleItemSelect(itemId);
    },
    [handleItemSelect, props.drawer],
  );

  return (
    <aside
      className={[
        "cw-workbench__task-drawer",
        expanded ? "" : "cw-workbench__task-drawer--collapsed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-task-drawer-expanded={expanded ? "true" : "false"}
    >
      <div className="cw-workbench__task-drawer-header">
        <div>
          <h2>{props.drawer.title}</h2>
          <p>{props.drawer.summary}</p>
        </div>
        {props.drawer.collapsible ? (
          <button
            aria-expanded={expanded}
            className="cw-workbench__task-drawer-toggle"
            data-task-drawer-toggle="true"
            onClick={handleToggleClick}
            type="button"
          >
            {expanded ? props.drawer.collapseLabel : props.drawer.expandLabel}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <>
          <dl
            aria-label="Task drawer items"
            className="cw-workbench__task-drawer-items"
            role="listbox"
          >
            {props.drawer.items.map((item) => {
              const selected = selectedItem?.id === item.id;
              return (
                <div
                  aria-selected={selected}
                  className={[
                    "cw-workbench__task-drawer-item",
                    `cw-workbench__task-drawer-item--${item.tone}`,
                    selected ? "cw-workbench__task-drawer-item--selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-task-drawer-item={item.id}
                  data-task-drawer-item-select={item.id}
                  data-task-drawer-item-selected={selected ? "true" : undefined}
                  data-task-drawer-item-tone={item.tone}
                  key={item.id}
                  onClick={handleItemClick}
                  onKeyDown={handleItemKeyDown}
                  role="option"
                  tabIndex={0}
                >
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              );
            })}
          </dl>
          {selectedItem === null ? null : (
            <RuntimeWorkbenchShellTaskDrawerDetails item={selectedItem} />
          )}
        </>
      ) : (
        <p className="cw-workbench__task-drawer-collapsed">
          {props.drawer.collapsedSummary}
        </p>
      )}
    </aside>
  );
}

function RuntimeWorkbenchShellTaskDrawerDetails(props: {
  readonly item: RuntimeWorkbenchShellTaskDrawerItem;
}): ReactElement {
  return (
    <section
      aria-label="Task drawer selection details"
      className="cw-workbench__task-drawer-details"
      data-task-drawer-details={props.item.id}
      data-task-drawer-details-label={props.item.label}
      data-task-drawer-details-tone={props.item.tone}
      data-task-drawer-details-value={props.item.value}
    >
      <h3>{props.item.label}</h3>
      <dl>
        <div>
          <dt>Value</dt>
          <dd>{props.item.value}</dd>
        </div>
        <div>
          <dt>Tone</dt>
          <dd>{props.item.tone}</dd>
        </div>
      </dl>
    </section>
  );
}

type RuntimeWorkbenchShellChatDraftIntent = "ask" | "revise" | "repair";

interface RuntimeWorkbenchShellChatSubmitInput {
  readonly instruction: string;
  readonly intent: RuntimeWorkbenchShellChatDraftIntent;
  readonly nodeId?: RuntimeWorkbenchShellWorkflowCanvasNodeId;
}

type RuntimeWorkbenchShellChatDraftPreviewState = "empty" | "blocked" | "ready";

type RuntimeWorkbenchShellChatDraftReadinessReason =
  | "empty_draft"
  | "chat_disabled"
  | "current_node_unavailable"
  | "ready";

interface RuntimeWorkbenchShellChatDraftPreview {
  readonly state: RuntimeWorkbenchShellChatDraftPreviewState;
  readonly reason: RuntimeWorkbenchShellChatDraftReadinessReason;
  readonly label: string;
  readonly reasonLabel: string;
}

interface RuntimeWorkbenchShellChatDraftSendGuard {
  readonly enabled: boolean;
  readonly reason: RuntimeWorkbenchShellChatDraftReadinessReason;
  readonly label: string;
}

interface RuntimeWorkbenchShellChatDraftIntentContext {
  readonly target: "workflow" | "draft" | "repair";
  readonly targetLabel: string;
  readonly action: "question" | "change_request" | "repair_review";
  readonly actionLabel: string;
}

type RuntimeWorkbenchShellChatDraftTargetScope = "workflow" | "current_node";

interface RuntimeWorkbenchShellChatDraftTargetContext {
  readonly scope: RuntimeWorkbenchShellChatDraftTargetScope;
  readonly target: "workflow" | "current_node";
  readonly targetLabel: string;
  readonly nodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null;
}

interface RuntimeWorkbenchShellChatLocalSubmission {
  readonly sequence: number;
  readonly status: "queued_local";
  readonly statusLabel: string;
  readonly intent: RuntimeWorkbenchShellChatDraftIntent;
  readonly intentLabel: string;
  readonly target: RuntimeWorkbenchShellChatDraftIntentContext["target"];
  readonly targetLabel: string;
  readonly targetScope: RuntimeWorkbenchShellChatDraftTargetScope;
  readonly targetScopeLabel: string;
  readonly targetNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null;
  readonly action: RuntimeWorkbenchShellChatDraftIntentContext["action"];
  readonly actionLabel: string;
  readonly characterCount: number;
  readonly wordCount: number;
}

const RUNTIME_WORKBENCH_CHAT_LOCAL_SUBMISSION_HISTORY_LIMIT = 3;

const RUNTIME_WORKBENCH_CHAT_DRAFT_INTENTS = Object.freeze([
  "ask",
  "revise",
  "repair",
] satisfies RuntimeWorkbenchShellChatDraftIntent[]);

const RUNTIME_WORKBENCH_CHAT_DRAFT_TARGET_SCOPES = Object.freeze([
  "workflow",
  "current_node",
] satisfies RuntimeWorkbenchShellChatDraftTargetScope[]);

function isRuntimeWorkbenchShellChatDraftIntent(
  value: string | undefined,
): value is RuntimeWorkbenchShellChatDraftIntent {
  return RUNTIME_WORKBENCH_CHAT_DRAFT_INTENTS.some(
    (intent) => intent === value,
  );
}

function runtimeWorkbenchShellChatDraftIntentLabel(
  intent: RuntimeWorkbenchShellChatDraftIntent,
): string {
  switch (intent) {
    case "ask":
      return "Ask";
    case "revise":
      return "Revise";
    case "repair":
      return "Repair";
  }
}

function runtimeWorkbenchShellChatDraftIntentContext(
  intent: RuntimeWorkbenchShellChatDraftIntent,
): RuntimeWorkbenchShellChatDraftIntentContext {
  switch (intent) {
    case "ask":
      return {
        target: "workflow",
        targetLabel: "Current workflow",
        action: "question",
        actionLabel: "Question",
      };
    case "revise":
      return {
        target: "draft",
        targetLabel: "Workflow draft",
        action: "change_request",
        actionLabel: "Change request",
      };
    case "repair":
      return {
        target: "repair",
        targetLabel: "Repair plan",
        action: "repair_review",
        actionLabel: "Repair review",
      };
  }
}

function isRuntimeWorkbenchShellChatDraftTargetScope(
  value: string | undefined,
): value is RuntimeWorkbenchShellChatDraftTargetScope {
  return RUNTIME_WORKBENCH_CHAT_DRAFT_TARGET_SCOPES.some(
    (scope) => scope === value,
  );
}

function runtimeWorkbenchShellChatDraftTargetScopeLabel(
  targetScope: RuntimeWorkbenchShellChatDraftTargetScope,
): string {
  switch (targetScope) {
    case "workflow":
      return "Workflow";
    case "current_node":
      return "Current node";
  }
}

function runtimeWorkbenchShellChatDraftTargetContext(
  targetScope: RuntimeWorkbenchShellChatDraftTargetScope,
  selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null,
): RuntimeWorkbenchShellChatDraftTargetContext {
  if (targetScope === "current_node") {
    return {
      scope: targetScope,
      target: "current_node",
      targetLabel:
        selectedNodeId === null
          ? "Current node"
          : `Current node ${selectedNodeId}`,
      nodeId: selectedNodeId,
    };
  }
  return {
    scope: targetScope,
    target: "workflow",
    targetLabel: "Current workflow",
    nodeId: null,
  };
}

function runtimeWorkbenchShellChatDraftWordCount(draft: string): number {
  const trimmedDraft = draft.trim();
  if (trimmedDraft.length === 0) {
    return 0;
  }
  return trimmedDraft.split(/\s+/u).length;
}

function runtimeWorkbenchShellCreateChatLocalSubmission(
  sequence: number,
  intent: RuntimeWorkbenchShellChatDraftIntent,
  intentLabel: string,
  intentContext: RuntimeWorkbenchShellChatDraftIntentContext,
  targetContext: RuntimeWorkbenchShellChatDraftTargetContext,
  draftLength: number,
  draftWords: number,
): RuntimeWorkbenchShellChatLocalSubmission {
  return {
    sequence,
    status: "queued_local",
    statusLabel: "Queued locally",
    intent,
    intentLabel,
    target: intentContext.target,
    targetLabel: intentContext.targetLabel,
    targetScope: targetContext.scope,
    targetScopeLabel: targetContext.targetLabel,
    targetNodeId: targetContext.nodeId,
    action: intentContext.action,
    actionLabel: intentContext.actionLabel,
    characterCount: draftLength,
    wordCount: draftWords,
  };
}

function runtimeWorkbenchShellChatDraftPreview(
  chatBoxEnabled: boolean,
  targetContext: RuntimeWorkbenchShellChatDraftTargetContext,
  draftWords: number,
): RuntimeWorkbenchShellChatDraftPreview {
  if (draftWords === 0) {
    return {
      state: "empty",
      reason: "empty_draft",
      label: "Empty",
      reasonLabel: "Draft is empty",
    };
  }
  if (!chatBoxEnabled) {
    return {
      state: "blocked",
      reason: "chat_disabled",
      label: "Blocked",
      reasonLabel: "Chat disabled",
    };
  }
  if (targetContext.scope === "current_node" && targetContext.nodeId === null) {
    return {
      state: "blocked",
      reason: "current_node_unavailable",
      label: "Blocked",
      reasonLabel: "No current node selected",
    };
  }
  return {
    state: "ready",
    reason: "ready",
    label: "Ready",
    reasonLabel: "Ready to send",
  };
}

function runtimeWorkbenchShellChatDraftSendGuard(
  preview: RuntimeWorkbenchShellChatDraftPreview,
): RuntimeWorkbenchShellChatDraftSendGuard {
  if (preview.state === "ready") {
    return {
      enabled: true,
      reason: preview.reason,
      label: "Send ready",
    };
  }
  return {
    enabled: false,
    reason: preview.reason,
    label: `Send unavailable: ${preview.reasonLabel}`,
  };
}

function RuntimeWorkbenchShellChatBox(props: {
  readonly chatBox: RuntimeWorkbenchShellChatBoxSnapshot;
  readonly onSubmit: (input: RuntimeWorkbenchShellChatSubmitInput) => void;
  readonly runId: string | null;
  readonly selectedNodeId: RuntimeWorkbenchShellWorkflowCanvasNodeId | null;
}): ReactElement {
  const [expanded, setExpanded] = useState(
    () => !props.chatBox.defaultCollapsed,
  );
  const [draft, setDraft] = useState("");
  const [draftIntent, setDraftIntent] =
    useState<RuntimeWorkbenchShellChatDraftIntent>("ask");
  const [draftTargetScope, setDraftTargetScope] =
    useState<RuntimeWorkbenchShellChatDraftTargetScope>("workflow");
  const [localSubmissions, setLocalSubmissions] = useState<
    readonly RuntimeWorkbenchShellChatLocalSubmission[]
  >([]);
  const localSubmissionSequenceRef = useRef(0);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldFocusDraftOnExpandRef = useRef(false);
  const draftLength = draft.length;
  const draftWords = runtimeWorkbenchShellChatDraftWordCount(draft);
  const draftIntentLabel =
    runtimeWorkbenchShellChatDraftIntentLabel(draftIntent);
  const draftIntentContext =
    runtimeWorkbenchShellChatDraftIntentContext(draftIntent);
  const draftTargetContext = runtimeWorkbenchShellChatDraftTargetContext(
    draftTargetScope,
    props.selectedNodeId,
  );
  const draftPreview = runtimeWorkbenchShellChatDraftPreview(
    props.chatBox.enabled && props.runId !== null,
    draftTargetContext,
    draftWords,
  );
  const sendGuard = runtimeWorkbenchShellChatDraftSendGuard(draftPreview);
  const focusDraftInput = useCallback((): void => {
    draftInputRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect((): void => {
    if (!expanded || !shouldFocusDraftOnExpandRef.current) {
      return;
    }
    shouldFocusDraftOnExpandRef.current = false;
    focusDraftInput();
  }, [expanded, focusDraftInput]);
  const handleToggleClick = useCallback((): void => {
    setExpanded((current) => {
      const nextExpanded = !current;
      if (nextExpanded) {
        shouldFocusDraftOnExpandRef.current = true;
      }
      return nextExpanded;
    });
  }, []);
  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      setDraft(event.currentTarget.value);
    },
    [],
  );
  const handleDraftClearClick = useCallback((): void => {
    setDraft("");
    focusDraftInput();
  }, [focusDraftInput]);
  const handleLocalSubmissionClearClick = useCallback((): void => {
    setLocalSubmissions([]);
    focusDraftInput();
  }, [focusDraftInput]);
  const handleDraftIntentClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const intent = event.currentTarget.dataset.chatDraftIntent;
      if (!isRuntimeWorkbenchShellChatDraftIntent(intent)) {
        return;
      }
      setDraftIntent(intent);
      focusDraftInput();
    },
    [focusDraftInput],
  );
  const handleDraftTargetScopeClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const targetScope = event.currentTarget.dataset.chatDraftTargetScope;
      if (!isRuntimeWorkbenchShellChatDraftTargetScope(targetScope)) {
        return;
      }
      setDraftTargetScope(targetScope);
      focusDraftInput();
    },
    [focusDraftInput],
  );
  const submitChatDraft = useCallback((): void => {
    if (!sendGuard.enabled) {
      return;
    }
    props.onSubmit({
      instruction: draft,
      intent: draftIntent,
      ...(draftTargetContext.nodeId !== null
        ? { nodeId: draftTargetContext.nodeId }
        : {}),
    });
    const sequence = localSubmissionSequenceRef.current + 1;
    localSubmissionSequenceRef.current = sequence;
    const localSubmission = runtimeWorkbenchShellCreateChatLocalSubmission(
      sequence,
      draftIntent,
      draftIntentLabel,
      draftIntentContext,
      draftTargetContext,
      draftLength,
      draftWords,
    );
    setLocalSubmissions((current) =>
      [localSubmission, ...current].slice(
        0,
        RUNTIME_WORKBENCH_CHAT_LOCAL_SUBMISSION_HISTORY_LIMIT,
      ),
    );
    setDraft("");
    focusDraftInput();
  }, [
    draft,
    draftIntent,
    draftIntentContext,
    draftIntentLabel,
    draftLength,
    draftTargetContext,
    draftWords,
    focusDraftInput,
    props.onSubmit,
    sendGuard.enabled,
  ]);
  const handleDraftKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) {
        return;
      }
      event.preventDefault();
      submitChatDraft();
    },
    [submitChatDraft],
  );
  const handleSendClick = useCallback((): void => {
    submitChatDraft();
  }, [submitChatDraft]);
  return (
    <section
      aria-label={props.chatBox.title}
      className={[
        "cw-workbench__chat",
        expanded ? "" : "cw-workbench__chat--collapsed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-chat-box-expanded={expanded ? "true" : "false"}
    >
      <div className="cw-workbench__chat-header">
        <div>
          <h2>{props.chatBox.title}</h2>
          <span>{props.chatBox.statusLabel}</span>
        </div>
        {props.chatBox.collapsible ? (
          <button
            aria-expanded={expanded}
            className="cw-workbench__chat-toggle"
            data-chat-box-toggle="true"
            onClick={handleToggleClick}
            type="button"
          >
            {expanded ? props.chatBox.collapseLabel : props.chatBox.expandLabel}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <>
          <div
            aria-label="Chat draft intent"
            className="cw-workbench__chat-intents"
            role="group"
          >
            {RUNTIME_WORKBENCH_CHAT_DRAFT_INTENTS.map((intent) => {
              const active = intent === draftIntent;
              return (
                <button
                  aria-pressed={active}
                  className={[
                    "cw-workbench__chat-intent",
                    active ? "cw-workbench__chat-intent--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-chat-draft-intent={intent}
                  data-chat-draft-intent-active={active ? "true" : "false"}
                  key={intent}
                  onClick={handleDraftIntentClick}
                  type="button"
                >
                  {runtimeWorkbenchShellChatDraftIntentLabel(intent)}
                </button>
              );
            })}
          </div>
          <div
            aria-label="Chat draft target"
            className="cw-workbench__chat-targets"
            data-chat-draft-target-selected-node-id={props.selectedNodeId ?? ""}
            role="group"
          >
            {RUNTIME_WORKBENCH_CHAT_DRAFT_TARGET_SCOPES.map((targetScope) => {
              const active = targetScope === draftTargetScope;
              const targetLabel =
                runtimeWorkbenchShellChatDraftTargetScopeLabel(targetScope);
              return (
                <button
                  aria-pressed={active}
                  className={[
                    "cw-workbench__chat-target",
                    active ? "cw-workbench__chat-target--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-chat-draft-target-scope={targetScope}
                  data-chat-draft-target-scope-active={
                    active ? "true" : "false"
                  }
                  disabled={
                    targetScope === "current_node" &&
                    props.selectedNodeId === null
                  }
                  key={targetScope}
                  onClick={handleDraftTargetScopeClick}
                  type="button"
                >
                  {targetLabel}
                </button>
              );
            })}
          </div>
          <div className="cw-workbench__chat-compose">
            <textarea
              aria-label="Chat draft"
              data-chat-draft-input="true"
              onChange={handleDraftChange}
              onKeyDown={handleDraftKeyDown}
              placeholder={props.chatBox.placeholder}
              ref={draftInputRef}
              rows={2}
              value={draft}
            />
            <button
              data-chat-draft-clear="true"
              data-chat-draft-clear-disabled={
                draftLength === 0 ? "true" : "false"
              }
              disabled={draftLength === 0}
              onClick={handleDraftClearClick}
              type="button"
            >
              Clear
            </button>
            <button
              aria-describedby="cw-workbench-chat-send-guard"
              data-chat-send="true"
              data-chat-send-disabled={sendGuard.enabled ? "false" : "true"}
              data-chat-send-reason={sendGuard.reason}
              disabled={!sendGuard.enabled}
              onClick={handleSendClick}
              type="button"
            >
              Send
            </button>
          </div>
          <p
            className="cw-workbench__chat-send-guard"
            data-chat-send-guard="true"
            data-chat-send-guard-enabled={sendGuard.enabled ? "true" : "false"}
            data-chat-send-guard-reason={sendGuard.reason}
            id="cw-workbench-chat-send-guard"
          >
            {sendGuard.label}
          </p>
          <RuntimeWorkbenchShellChatDraftPreview
            draft={draft}
            intentContext={draftIntentContext}
            intent={draftIntent}
            intentLabel={draftIntentLabel}
            preview={draftPreview}
            targetContext={draftTargetContext}
          />
          <RuntimeWorkbenchShellChatLocalSubmissionHistory
            onClear={handleLocalSubmissionClearClick}
            submissions={localSubmissions}
          />
          <section
            aria-label="Chat draft details"
            className="cw-workbench__chat-details"
            data-chat-draft-details="true"
            data-chat-draft-intent={draftIntent}
            data-chat-draft-intent-label={draftIntentLabel}
            data-chat-draft-length={String(draftLength)}
            data-chat-draft-send-enabled={sendGuard.enabled ? "true" : "false"}
            data-chat-draft-send-reason={sendGuard.reason}
            data-chat-draft-status={props.chatBox.statusLabel}
            data-chat-draft-target-node-id={draftTargetContext.nodeId ?? ""}
            data-chat-draft-target-scope={draftTargetContext.scope}
            data-chat-draft-words={String(draftWords)}
          >
            <h3>Draft</h3>
            <dl>
              <div>
                <dt>Characters</dt>
                <dd>{draftLength}</dd>
              </div>
              <div>
                <dt>Words</dt>
                <dd>{draftWords}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{props.chatBox.statusLabel}</dd>
              </div>
              <div>
                <dt>Intent</dt>
                <dd>{draftIntentLabel}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{draftTargetContext.targetLabel}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : (
        <p className="cw-workbench__chat-collapsed">
          {props.chatBox.collapsedSummary}
        </p>
      )}
    </section>
  );
}

function RuntimeWorkbenchShellChatLocalSubmissionHistory(props: {
  readonly onClear: () => void;
  readonly submissions: readonly RuntimeWorkbenchShellChatLocalSubmission[];
}): ReactElement | null {
  const latestSubmission = props.submissions[0];
  if (latestSubmission === undefined) {
    return null;
  }
  return (
    <section
      aria-label="Chat local submission"
      className="cw-workbench__chat-local-submission"
      data-chat-local-submit="true"
      data-chat-local-submit-action={latestSubmission.action}
      data-chat-local-submit-characters={String(
        latestSubmission.characterCount,
      )}
      data-chat-local-submit-count={String(props.submissions.length)}
      data-chat-local-submit-intent={latestSubmission.intent}
      data-chat-local-submit-intent-label={latestSubmission.intentLabel}
      data-chat-local-submit-sequence={String(latestSubmission.sequence)}
      data-chat-local-submit-status={latestSubmission.status}
      data-chat-local-submit-target={latestSubmission.target}
      data-chat-local-submit-target-node-id={
        latestSubmission.targetNodeId ?? ""
      }
      data-chat-local-submit-target-scope={latestSubmission.targetScope}
      data-chat-local-submit-words={String(latestSubmission.wordCount)}
    >
      <div className="cw-workbench__chat-local-submission-header">
        <h3>Recent requests</h3>
        <button
          data-chat-local-submit-clear="true"
          data-chat-local-submit-clear-count={String(props.submissions.length)}
          onClick={props.onClear}
          type="button"
        >
          Clear history
        </button>
      </div>
      <ol data-chat-local-submit-history="true">
        {props.submissions.map((submission, index) => (
          <li
            data-chat-local-submit-history-current={
              index === 0 ? "true" : "false"
            }
            data-chat-local-submit-history-item={String(submission.sequence)}
            data-chat-local-submit-history-status={submission.status}
            key={submission.sequence}
          >
            <span>#{submission.sequence}</span>
            <span>{submission.statusLabel}</span>
            <span>{submission.intentLabel}</span>
            <span>{submission.targetScopeLabel}</span>
            <span>{submission.targetLabel}</span>
            <span>{submission.actionLabel}</span>
            <span>{submission.characterCount} chars</span>
            <span>{submission.wordCount} words</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RuntimeWorkbenchShellChatDraftPreview(props: {
  readonly draft: string;
  readonly intentContext: RuntimeWorkbenchShellChatDraftIntentContext;
  readonly intent: RuntimeWorkbenchShellChatDraftIntent;
  readonly intentLabel: string;
  readonly preview: RuntimeWorkbenchShellChatDraftPreview;
  readonly targetContext: RuntimeWorkbenchShellChatDraftTargetContext;
}): ReactElement {
  const hasDraft = props.draft.trim().length > 0;
  return (
    <section
      aria-label="Chat draft preview"
      className={[
        "cw-workbench__chat-preview",
        `cw-workbench__chat-preview--${props.preview.state}`,
      ].join(" ")}
      data-chat-draft-preview="true"
      data-chat-draft-preview-action={props.intentContext.action}
      data-chat-draft-preview-intent={props.intent}
      data-chat-draft-preview-intent-label={props.intentLabel}
      data-chat-draft-preview-ready={
        props.preview.state === "ready" ? "true" : "false"
      }
      data-chat-draft-preview-reason={props.preview.reason}
      data-chat-draft-preview-state={props.preview.state}
      data-chat-draft-preview-target={props.intentContext.target}
      data-chat-draft-preview-target-node-id={props.targetContext.nodeId ?? ""}
      data-chat-draft-preview-target-scope={props.targetContext.scope}
    >
      <div className="cw-workbench__chat-preview-header">
        <h3>Preview</h3>
        <span>{props.preview.label}</span>
      </div>
      <p
        className="cw-workbench__chat-preview-body"
        data-chat-draft-preview-body={hasDraft ? "draft" : "empty"}
      >
        {hasDraft ? props.draft : "No draft text"}
      </p>
      <dl>
        <div>
          <dt>Intent</dt>
          <dd>{props.intentLabel}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{props.intentContext.targetLabel}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{props.targetContext.targetLabel}</dd>
        </div>
        <div>
          <dt>Action</dt>
          <dd>{props.intentContext.actionLabel}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{props.preview.reasonLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

function RuntimeWorkbenchShellStreamOptionsForm(props: {
  readonly state: RuntimeWorkbenchShellReactStreamOptionsFormState;
  readonly optionsReady: boolean;
  readonly onChannelKindClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onTextInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDisplayLevelClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onCategoryChange: (event: ChangeEvent<HTMLInputElement>) => void;
}): ReactElement {
  const activeCategories = runtimeWorkbenchShellReactCategoriesForChannel(
    props.state.channelKind,
  );
  return (
    <section
      aria-label="Runtime stream options"
      className="cw-workbench__stream-options"
    >
      <div className="cw-workbench__stream-option-group cw-workbench__stream-option-group--source">
        <span className="cw-workbench__stream-label">Stream source</span>
        <div className="cw-workbench__segmented">
          {(["run", "planning"] as const).map((channelKind) => (
            <button
              aria-pressed={props.state.channelKind === channelKind}
              className="cw-workbench__segment"
              data-stream-channel-kind={channelKind}
              key={channelKind}
              onClick={props.onChannelKindClick}
              type="button"
            >
              {channelKind === "run" ? "Run" : "Planning"}
            </button>
          ))}
        </div>
      </div>

      <label className="cw-workbench__stream-field">
        <span>
          {props.state.channelKind === "run" ? "Run id" : "Planning session id"}
        </span>
        <input
          data-stream-field={
            props.state.channelKind === "run" ? "runId" : "planningSessionId"
          }
          inputMode="text"
          onChange={props.onTextInputChange}
          value={
            props.state.channelKind === "run"
              ? props.state.runId
              : props.state.planningSessionId
          }
        />
      </label>

      <label className="cw-workbench__stream-field">
        <span>Project id</span>
        <input
          data-stream-field="projectId"
          inputMode="text"
          onChange={props.onTextInputChange}
          value={props.state.projectId}
        />
      </label>

      <div className="cw-workbench__stream-option-group">
        <span>Level</span>
        <div className="cw-workbench__segmented cw-workbench__segmented--level">
          {RUNTIME_WORKBENCH_STREAM_DISPLAY_LEVELS.map((level) => (
            <button
              aria-pressed={props.state.displayLevel === level}
              className="cw-workbench__segment"
              data-stream-display-level={level}
              key={level}
              onClick={props.onDisplayLevelClick}
              type="button"
            >
              {runtimeWorkbenchShellReactTitleCase(level)}
            </button>
          ))}
        </div>
      </div>

      <label className="cw-workbench__stream-field">
        <span>Since seq</span>
        <input
          data-stream-field="sinceSeq"
          inputMode="numeric"
          onChange={props.onTextInputChange}
          value={props.state.sinceSeq}
        />
      </label>

      <label className="cw-workbench__stream-field">
        <span>Until seq</span>
        <input
          data-stream-field="untilSeq"
          inputMode="numeric"
          onChange={props.onTextInputChange}
          value={props.state.untilSeq}
        />
      </label>

      <fieldset className="cw-workbench__stream-categories">
        <legend>Categories</legend>
        {activeCategories.map((category) => (
          <label className="cw-workbench__stream-category" key={category}>
            <input
              checked={props.state.categories.includes(category)}
              onChange={props.onCategoryChange}
              type="checkbox"
              value={category}
            />
            <span>{runtimeWorkbenchShellReactTitleCase(category)}</span>
          </label>
        ))}
      </fieldset>

      <div
        className={
          props.optionsReady
            ? "cw-workbench__stream-ready cw-workbench__stream-ready--ready"
            : "cw-workbench__stream-ready"
        }
      >
        {props.optionsReady ? "Ready" : "Waiting"}
      </div>
    </section>
  );
}

function RuntimeWorkbenchShellPanelSummary(props: {
  readonly snapshot: RuntimeWorkbenchShellSnapshot;
}): ReactElement {
  return (
    <div className="cw-workbench__panel-summary">
      <article>
        <h2>{props.snapshot.activePanelLabel}</h2>
        <p>{activePanelSummary(props.snapshot)}</p>
      </article>
      <article>
        <h3>Lifecycle</h3>
        <p>{props.snapshot.lifecyclePanelStatus}</p>
      </article>
      <article>
        <h3>Stream</h3>
        <p>
          {props.snapshot.runtimeStreamChannelLabel ??
            props.snapshot.runtimeStreamStatus}
        </p>
      </article>
    </div>
  );
}

function RuntimeWorkbenchShellLifecyclePanel(props: {
  readonly panel: RuntimeWorkbenchShellLifecyclePanelSnapshot;
  readonly onCommandClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onNavigationClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const panel = props.panel.view.panel;
  const selected = props.panel.view.selectedTimelineItem;
  return (
    <div className="cw-workbench__lifecycle-panel">
      <div className="cw-workbench__lifecycle-header">
        <div>
          <h2>{panel.title}</h2>
          <p>{panel.summary}</p>
        </div>
        <RuntimeWorkbenchShellLifecycleMetrics panel={props.panel} />
      </div>

      <div className="cw-workbench__lifecycle-command-bar">
        {panel.primaryCommand === null ? null : (
          <RuntimeWorkbenchShellLifecycleCommandButton
            command={panel.primaryCommand}
            focusedCommandId={props.panel.focusedCommandId}
            onClick={props.onCommandClick}
          />
        )}
        {panel.secondaryCommands.map((command) => (
          <RuntimeWorkbenchShellLifecycleCommandButton
            command={command}
            focusedCommandId={props.panel.focusedCommandId}
            key={command.id}
            onClick={props.onCommandClick}
          />
        ))}
      </div>

      <div className="cw-workbench__lifecycle-body">
        <section className="cw-workbench__lifecycle-timeline">
          <div className="cw-workbench__lifecycle-timeline-header">
            <div>
              <h3>Lifecycle timeline</h3>
              <p>
                {props.panel.view.visibleTimelineItemCount}/
                {props.panel.view.totalTimelineItems} visible
              </p>
            </div>
            <div className="cw-workbench__lifecycle-navigation">
              <button
                data-lifecycle-navigation-command="focus_previous_timeline_item"
                disabled={props.panel.view.visibleTimelineItemCount === 0}
                onClick={props.onNavigationClick}
                type="button"
              >
                Previous
              </button>
              <button
                data-lifecycle-navigation-command="focus_next_timeline_item"
                disabled={props.panel.view.visibleTimelineItemCount === 0}
                onClick={props.onNavigationClick}
                type="button"
              >
                Next
              </button>
              <button
                data-lifecycle-navigation-command="select_focused_timeline_item"
                disabled={!props.panel.canSelectFocusedTimelineItem}
                onClick={props.onNavigationClick}
                type="button"
              >
                Select focused
              </button>
              <button
                data-lifecycle-navigation-command="clear_selection"
                disabled={selected === null}
                onClick={props.onNavigationClick}
                type="button"
              >
                Clear selection
              </button>
            </div>
          </div>

          <RuntimeWorkbenchShellLifecycleFilterSummary panel={props.panel} />

          {panel.emptyState === null ? (
            <ol className="cw-workbench__lifecycle-items">
              {props.panel.view.visibleTimelineItems.map((item) => (
                <RuntimeWorkbenchShellLifecycleTimelineItem
                  focused={props.panel.focusedTimelineItemId === item.id}
                  item={item}
                  key={item.id}
                  selected={props.panel.view.selectedTimelineItemId === item.id}
                />
              ))}
            </ol>
          ) : (
            <div className="cw-workbench__lifecycle-empty">
              <h3>{panel.emptyState.title}</h3>
              <p>{panel.emptyState.summary}</p>
            </div>
          )}
        </section>

        <RuntimeWorkbenchShellLifecycleSelection item={selected} />
      </div>
    </div>
  );
}

function RuntimeWorkbenchShellLifecycleCommandButton(props: {
  readonly command: RuntimeLifecyclePanelCommand;
  readonly focusedCommandId: RuntimeLifecyclePanelCommandId | null;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const mappedCommand =
    runtimeWorkbenchShellLifecycleCommandIdToInteractionCommand(
      props.command.id,
    );
  return (
    <button
      aria-pressed={props.focusedCommandId === props.command.id}
      className={`cw-workbench__lifecycle-command cw-workbench__lifecycle-command--${props.command.role} cw-workbench__lifecycle-command--${props.command.tone}`}
      data-lifecycle-command-id={props.command.id}
      disabled={
        mappedCommand === null || !props.command.enabled || props.command.busy
      }
      onClick={props.onClick}
      title={props.command.title}
      type="button"
    >
      {props.command.label}
    </button>
  );
}

function RuntimeWorkbenchShellLifecycleMetrics(props: {
  readonly panel: RuntimeWorkbenchShellLifecyclePanelSnapshot;
}): ReactElement {
  const panel = props.panel.view.panel;
  const metrics: ReadonlyArray<readonly [string, string | number]> = [
    ["Status", panel.statusLabel],
    ["Startup", panel.startupTotal],
    ["Shutdown", panel.shutdownTotal],
    ["Visible", props.panel.view.visibleTimelineItemCount],
  ];
  return (
    <dl className="cw-workbench__lifecycle-metrics">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RuntimeWorkbenchShellLifecycleFilterSummary(props: {
  readonly panel: RuntimeWorkbenchShellLifecyclePanelSnapshot;
}): ReactElement {
  return (
    <div className="cw-workbench__lifecycle-filters">
      {props.panel.view.timelineFilterOptions.map((option) => (
        <span
          className={
            option.active
              ? "cw-workbench__lifecycle-filter cw-workbench__lifecycle-filter--active"
              : "cw-workbench__lifecycle-filter"
          }
          key={option.id}
          title={`${option.label}: ${option.count}`}
        >
          {option.label}
          <strong>{option.count}</strong>
        </span>
      ))}
    </div>
  );
}

function RuntimeWorkbenchShellLifecycleTimelineItem(props: {
  readonly item: RuntimeLifecyclePanelTimelineItem;
  readonly focused: boolean;
  readonly selected: boolean;
}): ReactElement {
  return (
    <li
      className={[
        "cw-workbench__lifecycle-item",
        `cw-workbench__lifecycle-item--${props.item.tone}`,
        props.focused ? "cw-workbench__lifecycle-item--focused" : "",
        props.selected ? "cw-workbench__lifecycle-item--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="cw-workbench__lifecycle-item-main">
        <span>{props.item.sourceLabel}</span>
        <div>
          <h4>{props.item.title}</h4>
          <p>{props.item.summary}</p>
        </div>
      </div>
      <div className="cw-workbench__lifecycle-item-meta">
        <span>{props.item.statusLabel}</span>
        <span>{props.item.kind}</span>
        {props.item.badges.map((badge) => (
          <span key={badge}>{runtimeWorkbenchShellReactTitleCase(badge)}</span>
        ))}
      </div>
    </li>
  );
}

function RuntimeWorkbenchShellLifecycleSelection(props: {
  readonly item: RuntimeLifecyclePanelTimelineItem | null;
}): ReactElement {
  return (
    <aside className="cw-workbench__lifecycle-selection">
      <h3>Lifecycle selection</h3>
      {props.item === null ? (
        <p className="cw-workbench__stream-muted">No timeline item selected</p>
      ) : (
        <div className="cw-workbench__lifecycle-selected-item">
          <strong>{props.item.title}</strong>
          <span>{props.item.statusLabel}</span>
          <p>{props.item.summary}</p>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{props.item.sourceLabel}</dd>
            </div>
            <div>
              <dt>Phase</dt>
              <dd>{props.item.phase}</dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{props.item.kind}</dd>
            </div>
          </dl>
        </div>
      )}
    </aside>
  );
}

function RuntimeWorkbenchShellStreamPanel(props: {
  readonly snapshot: RuntimeWorkbenchShellSnapshot;
  readonly onSearchChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onClearSearchClick: () => void;
  readonly onPreviousSearchClick: () => void;
  readonly onNextSearchClick: () => void;
  readonly onSelectSearchClick: () => void;
  readonly onMarkReadClick: () => void;
  readonly onAcknowledgeFullReloadClick: () => void;
  readonly onSelectEventClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onArtifactActionClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly onClearSelectionClick: () => void;
  readonly onToggleExpandedClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  const panel = props.snapshot.runtimeStreamPanel;
  const [expanded, setExpanded] = useState(true);
  const handlePanelToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
  if (panel === null) {
    return (
      <div className="cw-workbench__stream-panel cw-workbench__stream-panel--empty">
        <div className="cw-workbench__stream-panel-header">
          <div className="cw-workbench__stream-panel-title">
            <h2>Runtime stream</h2>
            <p>
              {props.snapshot.runtimeStreamChannelLabel ??
                props.snapshot.runtimeStreamStatus}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const collapsedSummary = runtimeWorkbenchShellStreamPanelCollapsedSummary(
    props.snapshot,
    panel,
  );

  return (
    <div
      className={[
        "cw-workbench__stream-panel",
        expanded ? "" : "cw-workbench__stream-panel--collapsed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-stream-panel-expanded={expanded ? "true" : "false"}
    >
      <div className="cw-workbench__stream-panel-header">
        <div className="cw-workbench__stream-panel-title">
          <h2>Runtime stream</h2>
          <p>{props.snapshot.runtimeStreamChannelLabel ?? panel.status}</p>
          <button
            aria-expanded={expanded}
            data-stream-panel-toggle="true"
            onClick={handlePanelToggleClick}
            type="button"
          >
            {expanded ? "Collapse stream" : "Expand stream"}
          </button>
        </div>
        <RuntimeWorkbenchShellStreamPanelMetrics panel={panel} />
      </div>

      {expanded ? (
        <>
          {panel.fullReload === null ? null : (
            <RuntimeWorkbenchShellStreamFullReload
              fullReload={panel.fullReload}
              onAcknowledgeFullReloadClick={props.onAcknowledgeFullReloadClick}
            />
          )}

          <RuntimeWorkbenchShellStreamControls
            onClearSearchClick={props.onClearSearchClick}
            onMarkReadClick={props.onMarkReadClick}
            onNextSearchClick={props.onNextSearchClick}
            onPreviousSearchClick={props.onPreviousSearchClick}
            onSearchChange={props.onSearchChange}
            onSelectSearchClick={props.onSelectSearchClick}
            panel={panel}
          />

          <div className="cw-workbench__stream-panel-body">
            <div className="cw-workbench__stream-event-groups">
              <RuntimeWorkbenchShellStreamEventGroup
                events={panel.summaryItems}
                groupId="summary"
                onArtifactActionClick={props.onArtifactActionClick}
                onSelectEventClick={props.onSelectEventClick}
                onToggleExpandedClick={props.onToggleExpandedClick}
                title="Summary"
              />
              <RuntimeWorkbenchShellStreamEventGroup
                events={panel.timelineItems}
                groupId="timeline"
                onArtifactActionClick={props.onArtifactActionClick}
                onSelectEventClick={props.onSelectEventClick}
                onToggleExpandedClick={props.onToggleExpandedClick}
                title="Timeline"
              />
            </div>
            <RuntimeWorkbenchShellStreamSelection
              onArtifactActionClick={props.onArtifactActionClick}
              onClearSelectionClick={props.onClearSelectionClick}
              panel={panel}
            />
          </div>
        </>
      ) : (
        <p
          className="cw-workbench__stream-collapsed"
          data-stream-panel-collapsed-summary="true"
          data-stream-panel-collapsed-unread={String(panel.read.unreadCount)}
          data-stream-panel-collapsed-visible={String(panel.visibleEventCount)}
        >
          {collapsedSummary}
        </p>
      )}
    </div>
  );
}

function RuntimeWorkbenchShellStreamFullReload(props: {
  readonly fullReload: NonNullable<
    RuntimeWorkbenchShellRuntimeStreamPanelSnapshot["fullReload"]
  >;
  readonly onAcknowledgeFullReloadClick: () => void;
}): ReactElement {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const handleDetailsToggleClick = useCallback((): void => {
    setDetailsExpanded((current) => !current);
  }, []);
  const statusLabel =
    props.fullReload.status === undefined
      ? "-"
      : String(props.fullReload.status);
  const errorCodeLabel = props.fullReload.errorCode ?? "-";
  const lastEventIdLabel = props.fullReload.lastEventId ?? "-";
  return (
    <div
      className={[
        "cw-workbench__stream-full-reload",
        detailsExpanded ? "cw-workbench__stream-full-reload--expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-stream-full-reload-expanded={detailsExpanded ? "true" : "false"}
      data-stream-full-reload-last-event-id={lastEventIdLabel}
      data-stream-full-reload-status={statusLabel}
    >
      <div className="cw-workbench__stream-full-reload-summary">
        <strong>Full reload required</strong>
        <span>{props.fullReload.reason}</span>
        <button
          aria-expanded={detailsExpanded}
          data-stream-full-reload-details-toggle="true"
          onClick={handleDetailsToggleClick}
          type="button"
        >
          {detailsExpanded ? "Hide details" : "Show details"}
        </button>
        {props.fullReload.acknowledged ? (
          <small>Acknowledged</small>
        ) : (
          <button
            data-stream-full-reload-acknowledge="true"
            onClick={props.onAcknowledgeFullReloadClick}
            type="button"
          >
            Acknowledge
          </button>
        )}
      </div>
      {detailsExpanded ? (
        <dl
          className="cw-workbench__stream-full-reload-details"
          data-stream-full-reload-details="true"
          data-stream-full-reload-details-error-code={errorCodeLabel}
          data-stream-full-reload-details-last-event-id={lastEventIdLabel}
          data-stream-full-reload-details-status={statusLabel}
        >
          <div>
            <dt>HTTP status</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div>
            <dt>Error code</dt>
            <dd>{errorCodeLabel}</dd>
          </div>
          <div>
            <dt>Last event id</dt>
            <dd>{lastEventIdLabel}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function runtimeWorkbenchShellStreamPanelCollapsedSummary(
  snapshot: RuntimeWorkbenchShellSnapshot,
  panel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot,
): string {
  return `${
    snapshot.runtimeStreamChannelLabel ?? panel.status
  }, ${panel.visibleEventCount} visible, ${panel.read.unreadCount} unread`;
}

function RuntimeWorkbenchShellStreamControls(props: {
  readonly panel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot;
  readonly onSearchChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onClearSearchClick: () => void;
  readonly onPreviousSearchClick: () => void;
  readonly onNextSearchClick: () => void;
  readonly onSelectSearchClick: () => void;
  readonly onMarkReadClick: () => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const hasSearch = props.panel.search.query.length > 0;
  const hasMatches = props.panel.search.matchCount > 0;
  const searchPosition =
    props.panel.search.activeMatchIndex === null
      ? "-"
      : `${props.panel.search.activeMatchIndex + 1}/${props.panel.search.matchCount}`;
  const handleControlsToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
  const matchLabel = props.panel.search.matchCount === 1 ? "match" : "matches";
  const collapsedSummary = `${
    hasSearch ? `Search "${props.panel.search.query}"` : "No search"
  }, ${props.panel.search.matchCount} ${matchLabel}, ${props.panel.read.unreadCount} unread`;
  return (
    <div
      className={[
        "cw-workbench__stream-controls",
        expanded ? "" : "cw-workbench__stream-controls--collapsed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-stream-controls-expanded={expanded ? "true" : "false"}
      data-stream-controls-matches={String(props.panel.search.matchCount)}
      data-stream-controls-query={props.panel.search.query}
      data-stream-controls-unread={String(props.panel.read.unreadCount)}
    >
      <div className="cw-workbench__stream-controls-header">
        <h3>Controls</h3>
        <button
          aria-expanded={expanded}
          data-stream-controls-toggle="true"
          onClick={handleControlsToggleClick}
          type="button"
        >
          {expanded ? "Collapse controls" : "Expand controls"}
        </button>
      </div>
      {expanded ? (
        <div
          className="cw-workbench__stream-controls-body"
          data-stream-controls-body="true"
        >
          <label className="cw-workbench__stream-search">
            <span>Search events</span>
            <input
              onChange={props.onSearchChange}
              type="search"
              value={props.panel.search.query}
            />
          </label>
          <div className="cw-workbench__stream-control-buttons">
            <button
              disabled={!hasSearch}
              onClick={props.onClearSearchClick}
              type="button"
            >
              Clear
            </button>
            <button
              disabled={!hasMatches}
              onClick={props.onPreviousSearchClick}
              type="button"
            >
              Previous
            </button>
            <button
              disabled={!hasMatches}
              onClick={props.onNextSearchClick}
              type="button"
            >
              Next
            </button>
            <button
              disabled={props.panel.search.activeEventId === null}
              onClick={props.onSelectSearchClick}
              type="button"
            >
              Select match
            </button>
            <button
              disabled={props.panel.read.unreadCount === 0}
              onClick={props.onMarkReadClick}
              type="button"
            >
              Mark read
            </button>
          </div>
          <span className="cw-workbench__stream-search-position">
            {searchPosition}
          </span>
        </div>
      ) : (
        <p
          className="cw-workbench__stream-controls-collapsed"
          data-stream-controls-collapsed-matches={String(
            props.panel.search.matchCount,
          )}
          data-stream-controls-collapsed-query={props.panel.search.query}
          data-stream-controls-collapsed-summary="true"
          data-stream-controls-collapsed-unread={String(
            props.panel.read.unreadCount,
          )}
        >
          {collapsedSummary}
        </p>
      )}
    </div>
  );
}

function RuntimeWorkbenchShellStreamPanelMetrics(props: {
  readonly panel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot;
}): ReactElement {
  const metrics: ReadonlyArray<readonly [string, string | number]> = [
    ["Status", props.panel.status],
    ["Total", props.panel.totalEvents],
    ["Visible", props.panel.visibleEventCount],
    ["Unread", props.panel.read.unreadCount],
    ["Search", props.panel.search.matchCount],
  ];
  return (
    <dl className="cw-workbench__stream-metrics">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RuntimeWorkbenchShellStreamEventGroup(props: {
  readonly groupId: "summary" | "timeline";
  readonly title: string;
  readonly events: readonly RuntimeWorkbenchShellRuntimeStreamEventSnapshot[];
  readonly onSelectEventClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onArtifactActionClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly onToggleExpandedClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const handleGroupToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
  const eventLabel = props.events.length === 1 ? "event" : "events";
  return (
    <section
      className={[
        "cw-workbench__stream-event-group",
        expanded ? "" : "cw-workbench__stream-event-group--collapsed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-stream-event-group={props.groupId}
      data-stream-event-group-count={String(props.events.length)}
      data-stream-event-group-expanded={expanded ? "true" : "false"}
    >
      <div className="cw-workbench__stream-event-group-header">
        <h3>{props.title}</h3>
        <span>{props.events.length}</span>
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${props.title} stream group`}
          data-stream-event-group-toggle={props.groupId}
          onClick={handleGroupToggleClick}
          type="button"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {!expanded ? (
        <p
          className="cw-workbench__stream-event-group-collapsed"
          data-stream-event-group-collapsed-count={String(props.events.length)}
          data-stream-event-group-collapsed-summary={props.groupId}
        >
          {props.title} hidden, {props.events.length} {eventLabel}
        </p>
      ) : props.events.length === 0 ? (
        <p className="cw-workbench__stream-muted">No visible events</p>
      ) : (
        <ol className="cw-workbench__stream-events">
          {props.events.map((event, index) => (
            <RuntimeWorkbenchShellStreamEventItem
              event={event}
              key={event.id ?? `${event.type}:${index}`}
              onArtifactActionClick={props.onArtifactActionClick}
              onSelectEventClick={props.onSelectEventClick}
              onToggleExpandedClick={props.onToggleExpandedClick}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function RuntimeWorkbenchShellStreamEventItem(props: {
  readonly event: RuntimeWorkbenchShellRuntimeStreamEventSnapshot;
  readonly onSelectEventClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onArtifactActionClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly onToggleExpandedClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  const knownType = runtimeWorkbenchShellReactIsKnownStreamEventType(
    props.event.type,
  );
  const payloadSummaryLabel = runtimeWorkbenchShellReactStructuredFieldLabel(
    props.event.payloadSummary,
  );
  const metadataSummaryLabel = runtimeWorkbenchShellReactStructuredFieldLabel(
    props.event.metadataSummary,
  );
  return (
    <li
      className={[
        "cw-workbench__stream-event",
        `cw-workbench__stream-event--${props.event.severity}`,
        knownType ? "" : "cw-workbench__stream-event--unknown-type",
      ]
        .filter(Boolean)
        .join(" ")}
      data-stream-event-expanded={props.event.expanded ? "true" : "false"}
      data-stream-event-known-type={knownType ? "true" : "false"}
      data-stream-event-parent-id={props.event.parentEventId ?? ""}
    >
      <div className="cw-workbench__stream-event-main">
        <span className="cw-workbench__stream-event-seq">
          {props.event.seq === null ? "-" : `#${props.event.seq}`}
        </span>
        <div>
          <h4>{props.event.title}</h4>
          <p>
            {props.event.summary ?? props.event.content ?? props.event.type}
          </p>
        </div>
      </div>
      <div className="cw-workbench__stream-event-meta">
        <span>{props.event.type}</span>
        {knownType ? null : (
          <span
            className="cw-workbench__stream-event-type-status"
            data-stream-event-type-status="unknown"
          >
            Unknown event
          </span>
        )}
        {props.event.category === null ? null : (
          <span>
            {runtimeWorkbenchShellReactTitleCase(props.event.category)}
          </span>
        )}
        <span>{props.event.displayLevel}</span>
      </div>
      <div className="cw-workbench__stream-event-actions">
        <button
          data-stream-event-id={props.event.id ?? undefined}
          data-stream-event-select={props.event.id ?? undefined}
          disabled={props.event.id === null}
          onClick={props.onSelectEventClick}
          type="button"
        >
          Select
        </button>
        {props.event.expandable ? (
          <button
            aria-expanded={props.event.expanded}
            data-stream-event-expand-toggle={props.event.id ?? undefined}
            data-stream-event-id={props.event.id ?? undefined}
            disabled={props.event.id === null}
            onClick={props.onToggleExpandedClick}
            type="button"
          >
            {props.event.expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
      </div>
      {props.event.children.length === 0 ? null : (
        <ol className="cw-workbench__stream-events cw-workbench__stream-events--children">
          {props.event.children.map((child, index) => (
            <RuntimeWorkbenchShellStreamEventItem
              event={child}
              key={child.id ?? `${child.type}:${index}`}
              onArtifactActionClick={props.onArtifactActionClick}
              onSelectEventClick={props.onSelectEventClick}
              onToggleExpandedClick={props.onToggleExpandedClick}
            />
          ))}
        </ol>
      )}
      {!props.event.expanded ? null : (
        <div
          className="cw-workbench__stream-event-detail"
          data-stream-event-detail="true"
          data-stream-event-detail-artifact-count={String(
            props.event.artifactRefs.length,
          )}
          data-stream-event-detail-category={props.event.category ?? ""}
          data-stream-event-detail-child-count={String(props.event.childCount)}
          data-stream-event-detail-created-at={props.event.createdAt ?? ""}
          data-stream-event-detail-correlation-id={
            props.event.correlationId ?? ""
          }
          data-stream-event-detail-display-level={props.event.displayLevel}
          data-stream-event-detail-event-id={props.event.id ?? ""}
          data-stream-event-detail-expandable={
            props.event.expandable ? "yes" : "no"
          }
          data-stream-event-detail-known-type={knownType ? "true" : "false"}
          data-stream-event-detail-metadata-key-count={String(
            props.event.metadataSummary.keyCount,
          )}
          data-stream-event-detail-metadata-kind={
            props.event.metadataSummary.kind
          }
          data-stream-event-detail-metadata-present={
            props.event.metadataSummary.present ? "yes" : "no"
          }
          data-stream-event-detail-parent-id={props.event.parentEventId ?? ""}
          data-stream-event-detail-payload-key-count={String(
            props.event.payloadSummary.keyCount,
          )}
          data-stream-event-detail-payload-kind={
            props.event.payloadSummary.kind
          }
          data-stream-event-detail-payload-present={
            props.event.payloadSummary.present ? "yes" : "no"
          }
          data-stream-event-detail-run-id={props.event.runId ?? ""}
          data-stream-event-detail-node-id={props.event.nodeId ?? ""}
          data-stream-event-detail-attempt-id={props.event.attemptId ?? ""}
          data-stream-event-detail-phase={props.event.phase ?? ""}
          data-stream-event-detail-schema-version={
            props.event.schemaVersion ?? ""
          }
          data-stream-event-detail-severity={props.event.severity}
          data-stream-event-detail-sensitivity={props.event.sensitivity}
          data-stream-event-detail-seq={
            props.event.seq === null ? "" : String(props.event.seq)
          }
          data-stream-event-detail-summary={props.event.summary ?? ""}
          data-stream-event-detail-title={props.event.title}
          data-stream-event-detail-type={props.event.type}
        >
          <RuntimeWorkbenchShellStreamContent
            content={props.event.content}
            source="event-detail"
          />
          <RuntimeWorkbenchShellStreamArtifactRefs
            artifactRefs={props.event.artifactRefs}
            onArtifactActionClick={props.onArtifactActionClick}
            source="event-detail"
          />
          <dl>
            <div>
              <dt>Event ID</dt>
              <dd>{props.event.id ?? "-"}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{props.event.type}</dd>
            </div>
            <div>
              <dt>Type status</dt>
              <dd>{knownType ? "Known event type" : "Unknown event type"}</dd>
            </div>
            <div>
              <dt>Title</dt>
              <dd>{props.event.title}</dd>
            </div>
            <div>
              <dt>Summary</dt>
              <dd>{props.event.summary ?? "-"}</dd>
            </div>
            <div>
              <dt>Expandable</dt>
              <dd>{props.event.expandable ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt>Payload</dt>
              <dd>{payloadSummaryLabel}</dd>
            </div>
            <div>
              <dt>Metadata</dt>
              <dd>{metadataSummaryLabel}</dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>{props.event.schemaVersion ?? "-"}</dd>
            </div>
            <div>
              <dt>Seq</dt>
              <dd>{props.event.seq ?? "-"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{props.event.createdAt ?? "-"}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{props.event.category ?? "-"}</dd>
            </div>
            <div>
              <dt>Display level</dt>
              <dd>{props.event.displayLevel}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>{props.event.severity}</dd>
            </div>
            <div>
              <dt>Run</dt>
              <dd>{props.event.runId ?? "-"}</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{props.event.nodeId ?? "-"}</dd>
            </div>
            <div>
              <dt>Attempt</dt>
              <dd>{props.event.attemptId ?? "-"}</dd>
            </div>
            <div>
              <dt>Correlation</dt>
              <dd>{props.event.correlationId ?? "-"}</dd>
            </div>
            <div>
              <dt>Phase</dt>
              <dd>{props.event.phase ?? "-"}</dd>
            </div>
            <div>
              <dt>Sensitivity</dt>
              <dd>
                {runtimeWorkbenchShellReactTitleCase(props.event.sensitivity)}
              </dd>
            </div>
            <div>
              <dt>Parent event</dt>
              <dd>{props.event.parentEventId ?? "-"}</dd>
            </div>
            <div>
              <dt>Child count</dt>
              <dd>{props.event.childCount}</dd>
            </div>
          </dl>
        </div>
      )}
    </li>
  );
}

function RuntimeWorkbenchShellStreamArtifactRefs(props: {
  readonly artifactRefs: readonly RuntimeWorkbenchShellRuntimeStreamEventSnapshot["artifactRefs"][number][];
  readonly onArtifactActionClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly source: "event-detail" | "selection";
}): ReactElement | null {
  if (props.artifactRefs.length === 0) {
    return null;
  }
  return (
    <section
      className="cw-workbench__stream-artifact-refs"
      data-stream-artifact-ref-count={String(props.artifactRefs.length)}
      data-stream-artifact-refs={props.source}
    >
      <h5>Artifact refs</h5>
      <ul>
        {props.artifactRefs.map((artifactRef) => (
          <li
            data-stream-artifact-ref={props.source}
            data-stream-artifact-ref-id={artifactRef.artifactId}
            data-stream-artifact-ref-kind={artifactRef.kind}
            data-stream-artifact-ref-path={artifactRef.path ?? ""}
            data-stream-artifact-ref-size-bytes={
              artifactRef.sizeBytes === null
                ? ""
                : String(artifactRef.sizeBytes)
            }
            key={artifactRef.artifactId}
          >
            <strong>{artifactRef.displayName}</strong>
            <span>{runtimeWorkbenchShellReactTitleCase(artifactRef.kind)}</span>
            {artifactRef.path === null ? null : <code>{artifactRef.path}</code>}
            {artifactRef.mimeType === null ? null : (
              <small>{artifactRef.mimeType}</small>
            )}
            {artifactRef.sizeBytes === null ? null : (
              <small>{artifactRef.sizeBytes} bytes</small>
            )}
            {artifactRef.previewText === null ? null : (
              <p>{artifactRef.previewText}</p>
            )}
            <div className="cw-workbench__stream-artifact-actions">
              <button
                data-stream-artifact-action="open"
                data-stream-artifact-id={artifactRef.artifactId}
                onClick={props.onArtifactActionClick}
                type="button"
              >
                Open
              </button>
              <button
                data-stream-artifact-action="download"
                data-stream-artifact-id={artifactRef.artifactId}
                onClick={props.onArtifactActionClick}
                type="button"
              >
                Download
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RuntimeWorkbenchShellStreamSelection(props: {
  readonly panel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot;
  readonly onArtifactActionClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly onClearSelectionClick: () => void;
}): ReactElement {
  const selected = props.panel.selectedEvent;
  const [expanded, setExpanded] = useState(true);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const handleSelectionToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
  const handleMetadataToggleClick = useCallback((): void => {
    setMetadataExpanded((current) => !current);
  }, []);
  const selectedKnownType =
    selected === null
      ? true
      : runtimeWorkbenchShellReactIsKnownStreamEventType(selected.type);
  const collapsedSummary =
    selected === null
      ? "No event selected"
      : selectedKnownType
        ? `${selected.title}, ${selected.type}`
        : `Unknown event, ${selected.type}`;
  const categoryLabel = selected?.category ?? "-";
  const eventIdLabel = selected?.id ?? "-";
  const eventTypeLabel = selected?.type ?? "-";
  const titleLabel = selected?.title ?? "-";
  const summaryLabel = selected?.summary ?? "-";
  const payloadSummaryLabel =
    selected === null
      ? "-"
      : runtimeWorkbenchShellReactStructuredFieldLabel(selected.payloadSummary);
  const metadataSummaryLabel =
    selected === null
      ? "-"
      : runtimeWorkbenchShellReactStructuredFieldLabel(
          selected.metadataSummary,
        );
  const schemaVersionLabel = selected?.schemaVersion ?? "-";
  const seqLabel =
    selected === null || selected.seq === null ? "-" : String(selected.seq);
  const createdAtLabel = selected?.createdAt ?? "-";
  const phaseLabel = selected?.phase ?? "-";
  const parentEventIdLabel = selected?.parentEventId ?? "-";
  const correlationIdLabel = selected?.correlationId ?? "-";
  const runIdLabel = selected?.runId ?? "-";
  const nodeIdLabel = selected?.nodeId ?? "-";
  const attemptIdLabel = selected?.attemptId ?? "-";
  const sensitivityLabel =
    selected === null
      ? "-"
      : runtimeWorkbenchShellReactTitleCase(selected.sensitivity);
  const expandableLabel =
    selected === null ? "-" : selected.expandable ? "yes" : "no";
  const typeStatusLabel = selectedKnownType
    ? "Known event type"
    : "Unknown event type";
  return (
    <aside
      className={[
        "cw-workbench__stream-selection",
        expanded ? "" : "cw-workbench__stream-selection--collapsed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-stream-selection-expanded={expanded ? "true" : "false"}
      data-stream-selection-selected-id={selected?.id ?? ""}
    >
      <div className="cw-workbench__stream-selection-header">
        <h3>Selection</h3>
        <button
          aria-expanded={expanded}
          data-stream-selection-toggle="true"
          onClick={handleSelectionToggleClick}
          type="button"
        >
          {expanded ? "Collapse selection" : "Expand selection"}
        </button>
      </div>
      {props.panel.search.query.length === 0 ? null : (
        <p>
          Search "{props.panel.search.query}" - {props.panel.search.matchCount}{" "}
          matches
        </p>
      )}
      {!expanded ? (
        <p
          className="cw-workbench__stream-selection-collapsed"
          data-stream-selection-collapsed-selected-id={selected?.id ?? ""}
          data-stream-selection-collapsed-selected-type={selected?.type ?? ""}
          data-stream-selection-collapsed-summary="true"
        >
          {collapsedSummary}
        </p>
      ) : selected === null ? (
        <p className="cw-workbench__stream-muted">No event selected</p>
      ) : (
        <div
          className="cw-workbench__stream-selected-event"
          data-stream-selected-event="true"
          data-stream-selected-event-artifact-count={String(
            selected.artifactRefs.length,
          )}
          data-stream-selected-event-category={selected.category ?? ""}
          data-stream-selected-event-child-count={String(selected.childCount)}
          data-stream-selected-event-created-at={selected.createdAt ?? ""}
          data-stream-selected-event-correlation-id={
            selected.correlationId ?? ""
          }
          data-stream-selected-event-display-level={selected.displayLevel}
          data-stream-selected-event-expandable={expandableLabel}
          data-stream-selected-event-id={selected.id ?? ""}
          data-stream-selected-event-known-type={
            selectedKnownType ? "true" : "false"
          }
          data-stream-selected-event-run-id={selected.runId ?? ""}
          data-stream-selected-event-node-id={selected.nodeId ?? ""}
          data-stream-selected-event-attempt-id={selected.attemptId ?? ""}
          data-stream-selected-event-parent-id={parentEventIdLabel}
          data-stream-selected-event-metadata-key-count={String(
            selected.metadataSummary.keyCount,
          )}
          data-stream-selected-event-metadata-kind={
            selected.metadataSummary.kind
          }
          data-stream-selected-event-metadata-present={
            selected.metadataSummary.present ? "yes" : "no"
          }
          data-stream-selected-event-payload-key-count={String(
            selected.payloadSummary.keyCount,
          )}
          data-stream-selected-event-payload-kind={selected.payloadSummary.kind}
          data-stream-selected-event-payload-present={
            selected.payloadSummary.present ? "yes" : "no"
          }
          data-stream-selected-event-phase={selected.phase ?? ""}
          data-stream-selected-event-schema-version={
            selected.schemaVersion ?? ""
          }
          data-stream-selected-event-severity={selected.severity}
          data-stream-selected-event-sensitivity={selected.sensitivity}
          data-stream-selected-event-seq={
            selected.seq === null ? "" : String(selected.seq)
          }
          data-stream-selected-event-summary={selected.summary ?? ""}
          data-stream-selected-event-title={selected.title}
          data-stream-selected-event-type={selected.type}
        >
          <button onClick={props.onClearSelectionClick} type="button">
            Clear selection
          </button>
          <strong>{selected.title}</strong>
          <span>{selected.type}</span>
          {selectedKnownType ? null : (
            <span
              className="cw-workbench__stream-event-type-status"
              data-stream-selected-event-type-status="unknown"
            >
              Unknown event
            </span>
          )}
          {selected.summary === null ? null : <p>{selected.summary}</p>}
          <RuntimeWorkbenchShellStreamContent
            content={selected.content}
            source="selection"
          />
          <RuntimeWorkbenchShellStreamArtifactRefs
            artifactRefs={selected.artifactRefs}
            onArtifactActionClick={props.onArtifactActionClick}
            source="selection"
          />
          <dl>
            <div>
              <dt>Event ID</dt>
              <dd>{eventIdLabel}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{eventTypeLabel}</dd>
            </div>
            <div>
              <dt>Type status</dt>
              <dd>{typeStatusLabel}</dd>
            </div>
            <div>
              <dt>Title</dt>
              <dd>{titleLabel}</dd>
            </div>
            <div>
              <dt>Summary</dt>
              <dd>{summaryLabel}</dd>
            </div>
            <div>
              <dt>Expandable</dt>
              <dd>{expandableLabel}</dd>
            </div>
            <div>
              <dt>Payload</dt>
              <dd>{payloadSummaryLabel}</dd>
            </div>
            <div>
              <dt>Metadata</dt>
              <dd>{metadataSummaryLabel}</dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>{schemaVersionLabel}</dd>
            </div>
            <div>
              <dt>Seq</dt>
              <dd>{seqLabel}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{categoryLabel}</dd>
            </div>
            <div>
              <dt>Display level</dt>
              <dd>{selected.displayLevel}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>{selected.severity}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{createdAtLabel}</dd>
            </div>
          </dl>
          <button
            aria-expanded={metadataExpanded}
            data-stream-selection-metadata-toggle="true"
            onClick={handleMetadataToggleClick}
            type="button"
          >
            {metadataExpanded ? "Hide metadata" : "Show metadata"}
          </button>
          {metadataExpanded ? (
            <dl
              className="cw-workbench__stream-selected-event-metadata"
              data-stream-selection-metadata="true"
              data-stream-selection-metadata-category={categoryLabel}
              data-stream-selection-metadata-child-count={String(
                selected.childCount,
              )}
              data-stream-selection-metadata-created-at={createdAtLabel}
              data-stream-selection-metadata-correlation-id={correlationIdLabel}
              data-stream-selection-metadata-display-level={
                selected.displayLevel
              }
              data-stream-selection-metadata-event-id={eventIdLabel}
              data-stream-selection-metadata-expandable={expandableLabel}
              data-stream-selection-metadata-known-type={
                selectedKnownType ? "true" : "false"
              }
              data-stream-selection-metadata-run-id={runIdLabel}
              data-stream-selection-metadata-node-id={nodeIdLabel}
              data-stream-selection-metadata-attempt-id={attemptIdLabel}
              data-stream-selection-metadata-parent-id={parentEventIdLabel}
              data-stream-selection-metadata-metadata-key-count={String(
                selected.metadataSummary.keyCount,
              )}
              data-stream-selection-metadata-metadata-kind={
                selected.metadataSummary.kind
              }
              data-stream-selection-metadata-metadata-present={
                selected.metadataSummary.present ? "yes" : "no"
              }
              data-stream-selection-metadata-payload-key-count={String(
                selected.payloadSummary.keyCount,
              )}
              data-stream-selection-metadata-payload-kind={
                selected.payloadSummary.kind
              }
              data-stream-selection-metadata-payload-present={
                selected.payloadSummary.present ? "yes" : "no"
              }
              data-stream-selection-metadata-phase={phaseLabel}
              data-stream-selection-metadata-schema-version={schemaVersionLabel}
              data-stream-selection-metadata-severity={selected.severity}
              data-stream-selection-metadata-sensitivity={selected.sensitivity}
              data-stream-selection-metadata-seq={seqLabel}
              data-stream-selection-metadata-summary={summaryLabel}
              data-stream-selection-metadata-title={titleLabel}
              data-stream-selection-metadata-type={eventTypeLabel}
            >
              <div>
                <dt>Event ID</dt>
                <dd>{eventIdLabel}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{eventTypeLabel}</dd>
              </div>
              <div>
                <dt>Type status</dt>
                <dd>{typeStatusLabel}</dd>
              </div>
              <div>
                <dt>Title</dt>
                <dd>{titleLabel}</dd>
              </div>
              <div>
                <dt>Summary</dt>
                <dd>{summaryLabel}</dd>
              </div>
              <div>
                <dt>Payload</dt>
                <dd>{payloadSummaryLabel}</dd>
              </div>
              <div>
                <dt>Metadata</dt>
                <dd>{metadataSummaryLabel}</dd>
              </div>
              <div>
                <dt>Schema</dt>
                <dd>{schemaVersionLabel}</dd>
              </div>
              <div>
                <dt>Seq</dt>
                <dd>{seqLabel}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{createdAtLabel}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{categoryLabel}</dd>
              </div>
              <div>
                <dt>Run</dt>
                <dd>{runIdLabel}</dd>
              </div>
              <div>
                <dt>Node</dt>
                <dd>{nodeIdLabel}</dd>
              </div>
              <div>
                <dt>Attempt</dt>
                <dd>{attemptIdLabel}</dd>
              </div>
              <div>
                <dt>Correlation</dt>
                <dd>{correlationIdLabel}</dd>
              </div>
              <div>
                <dt>Phase</dt>
                <dd>{phaseLabel}</dd>
              </div>
              <div>
                <dt>Sensitivity</dt>
                <dd>{sensitivityLabel}</dd>
              </div>
              <div>
                <dt>Display level</dt>
                <dd>{selected.displayLevel}</dd>
              </div>
              <div>
                <dt>Severity</dt>
                <dd>{selected.severity}</dd>
              </div>
              <div>
                <dt>Parent event</dt>
                <dd>{parentEventIdLabel}</dd>
              </div>
              <div>
                <dt>Child count</dt>
                <dd>{selected.childCount}</dd>
              </div>
              <div>
                <dt>Expandable</dt>
                <dd>{expandableLabel}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function activePanelSummary(snapshot: RuntimeWorkbenchShellSnapshot): string {
  if (snapshot.disposed) {
    return "Disposed";
  }
  return snapshot.activePanel === "lifecycle"
    ? `Lifecycle panel is ${snapshot.lifecyclePanelStatus}.`
    : `Runtime stream is ${snapshot.runtimeStreamChannelLabel ?? snapshot.runtimeStreamStatus}.`;
}

function buildRuntimeWorkbenchShellReactStreamFilters(
  state: RuntimeWorkbenchShellReactStreamOptionsFormState,
): NonNullable<
  CreateRuntimeStreamInteractionSessionFactorySessionOptions["filters"]
> | null {
  const sinceSeq = normalizeRuntimeWorkbenchShellReactSeq(state.sinceSeq);
  const untilSeq = normalizeRuntimeWorkbenchShellReactSeq(state.untilSeq);
  if (
    sinceSeq === null ||
    untilSeq === null ||
    (sinceSeq !== undefined && untilSeq !== undefined && untilSeq < sinceSeq)
  ) {
    return null;
  }

  const categories = normalizeRuntimeWorkbenchShellReactStreamCategories(
    state.channelKind,
    state.categories,
  );
  return {
    level: state.displayLevel,
    ...(categories.length > 0 ? { category: categories } : {}),
    ...(sinceSeq !== undefined ? { sinceSeq } : {}),
    ...(untilSeq !== undefined ? { untilSeq } : {}),
  };
}

function normalizeRuntimeWorkbenchShellReactSeq(
  value: string,
): number | undefined | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeRuntimeWorkbenchShellReactProjectId(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return /^[\u0020-\u007e]+$/u.test(trimmed) && !/[\r\n]/u.test(trimmed)
    ? trimmed
    : null;
}

function normalizeRuntimeWorkbenchShellReactProjectDisplayName(
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

function normalizeRuntimeWorkbenchShellReactProjectHostPath(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeRuntimeWorkbenchShellReactReferenceFileName(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 180 ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function normalizeRuntimeWorkbenchShellReactOptionalText(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length > 2048 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeRuntimeWorkbenchShellReactPathSegment(
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

function selectRuntimeWorkbenchShellReactActiveRunId(
  snapshot: RuntimeWorkbenchShellSnapshot,
): string | null {
  const panel = snapshot.runtimeStreamPanel;
  if (panel === null) {
    return null;
  }
  const candidates = [
    panel.selectedEvent?.runId ?? null,
    ...panel.timelineItems.map((item) => item.runId),
  ];
  for (const candidate of candidates) {
    if (candidate === null) {
      continue;
    }
    const runId = normalizeRuntimeWorkbenchShellReactPathSegment(candidate);
    if (runId !== null) {
      return runId;
    }
  }
  return null;
}

function isRuntimeWorkbenchShellReactReferenceKind(
  value: string | undefined,
): value is RuntimeWorkbenchReferenceKind {
  return (
    value !== undefined &&
    RUNTIME_WORKBENCH_REFERENCE_KIND_OPTIONS.includes(
      value as RuntimeWorkbenchReferenceKind,
    )
  );
}

function isRuntimeWorkbenchShellExecutionMode(
  value: string | undefined,
): value is RuntimeWorkbenchExecutionMode {
  return (
    value !== undefined &&
    RUNTIME_WORKBENCH_EXECUTION_MODES.includes(
      value as RuntimeWorkbenchExecutionMode,
    )
  );
}

function normalizeRuntimeWorkbenchShellReactStreamCategories(
  channelKind: RuntimeWorkbenchShellReactStreamChannelKind,
  categories: readonly RuntimeStreamCategory[],
): RuntimeStreamCategory[] {
  const allowed = runtimeWorkbenchShellReactCategoriesForChannel(channelKind);
  const normalized: RuntimeStreamCategory[] = [];
  for (const category of categories) {
    if (allowed.includes(category) && !normalized.includes(category)) {
      normalized.push(category);
    }
  }
  return normalized;
}

function runtimeWorkbenchShellReactCategoriesForChannel(
  channelKind: RuntimeWorkbenchShellReactStreamChannelKind,
): readonly RuntimeStreamCategory[] {
  return channelKind === "run"
    ? RUNTIME_WORKBENCH_RUN_STREAM_CATEGORIES
    : RUNTIME_WORKBENCH_PLANNING_STREAM_CATEGORIES;
}

function isRuntimeWorkbenchShellReactDisplayLevel(
  value: string,
): value is RuntimeStreamDisplayLevel {
  return RUNTIME_WORKBENCH_STREAM_DISPLAY_LEVELS.includes(
    value as RuntimeStreamDisplayLevel,
  );
}

function isRuntimeWorkbenchShellReactCategory(
  value: string,
): value is RuntimeStreamCategory {
  return (
    RUNTIME_WORKBENCH_RUN_STREAM_CATEGORIES.includes(
      value as RuntimeStreamCategory,
    ) ||
    RUNTIME_WORKBENCH_PLANNING_STREAM_CATEGORIES.includes(
      value as RuntimeStreamCategory,
    )
  );
}

function runtimeWorkbenchShellReactTitleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function runtimeWorkbenchShellReactReferenceKindLabel(
  value: RuntimeWorkbenchReferenceKind,
): string {
  return value.split("_").map(runtimeWorkbenchShellReactTitleCase).join(" ");
}

function runtimeWorkbenchShellReactArrayBufferToBase64(
  buffer: ArrayBuffer,
): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function runtimeWorkbenchShellReactIsKnownStreamEventType(
  eventType: string,
): boolean {
  return RUNTIME_WORKBENCH_STREAM_KNOWN_EVENT_TYPE_SET.has(eventType);
}

type RuntimeWorkbenchShellStreamContentSource = "event-detail" | "selection";

interface RuntimeWorkbenchShellStreamContentProps {
  readonly content: string | null;
  readonly source: RuntimeWorkbenchShellStreamContentSource;
}

interface RuntimeWorkbenchShellStreamContentMetrics {
  headingCount: number;
  listCount: number;
  codeBlockCount: number;
  tableCount: number;
  linkCount: number;
  markCount: number;
  blockedHtmlCount: number;
  blockedImageCount: number;
  blockedLinkCount: number;
}

type RuntimeWorkbenchShellStreamContentFallbackReason =
  | "none"
  | "render_failed";

interface RuntimeWorkbenchShellRenderedStreamContent {
  readonly blocks: readonly ReactNode[];
  readonly metrics: RuntimeWorkbenchShellStreamContentMetrics;
  readonly fallback: boolean;
  readonly fallbackReason: RuntimeWorkbenchShellStreamContentFallbackReason;
}

interface RuntimeWorkbenchShellMarkdownLinkToken {
  readonly label: string;
  readonly target: string;
  readonly end: number;
}

function RuntimeWorkbenchShellStreamContent(
  props: RuntimeWorkbenchShellStreamContentProps,
): ReactElement | null {
  const rendered = useMemo(
    () =>
      props.content === null
        ? null
        : runtimeWorkbenchShellReactRenderRestrictedMarkdown(
            props.content,
            props.source,
          ),
    [props.content, props.source],
  );
  if (rendered === null) {
    return null;
  }
  return (
    <div
      className="cw-workbench__stream-content"
      data-stream-content={props.source}
      data-stream-content-blocked-html-count={String(
        rendered.metrics.blockedHtmlCount,
      )}
      data-stream-content-blocked-image-count={String(
        rendered.metrics.blockedImageCount,
      )}
      data-stream-content-blocked-link-count={String(
        rendered.metrics.blockedLinkCount,
      )}
      data-stream-content-code-block-count={String(
        rendered.metrics.codeBlockCount,
      )}
      data-stream-content-fallback={rendered.fallback ? "true" : "false"}
      data-stream-content-fallback-reason={rendered.fallbackReason}
      data-stream-content-heading-count={String(rendered.metrics.headingCount)}
      data-stream-content-link-count={String(rendered.metrics.linkCount)}
      data-stream-content-list-count={String(rendered.metrics.listCount)}
      data-stream-content-mark-count={String(rendered.metrics.markCount)}
      data-stream-content-table-count={String(rendered.metrics.tableCount)}
      data-stream-event-detail-content={
        props.source === "event-detail" ? "true" : undefined
      }
      data-stream-selected-event-content={
        props.source === "selection" ? "true" : undefined
      }
    >
      {rendered.blocks}
    </div>
  );
}

function runtimeWorkbenchShellReactRenderRestrictedMarkdown(
  content: string,
  source: RuntimeWorkbenchShellStreamContentSource,
): RuntimeWorkbenchShellRenderedStreamContent {
  try {
    return runtimeWorkbenchShellReactRenderRestrictedMarkdownBlocks(
      content,
      source,
    );
  } catch {
    return runtimeWorkbenchShellReactRenderPlainTextStreamContent(
      content,
      source,
    );
  }
}

function runtimeWorkbenchShellReactRenderRestrictedMarkdownBlocks(
  content: string,
  source: RuntimeWorkbenchShellStreamContentSource,
): RuntimeWorkbenchShellRenderedStreamContent {
  const metrics = runtimeWorkbenchShellReactCreateStreamContentMetrics();
  const blocks: ReactNode[] = [];
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? "";
    if (line.trim().length === 0) {
      lineIndex += 1;
      continue;
    }
    if (runtimeWorkbenchShellReactIsFenceLine(line)) {
      const codeLines: string[] = [];
      lineIndex += 1;
      while (lineIndex < lines.length) {
        const codeLine = lines[lineIndex] ?? "";
        if (runtimeWorkbenchShellReactIsFenceLine(codeLine)) {
          lineIndex += 1;
          break;
        }
        codeLines.push(codeLine);
        lineIndex += 1;
      }
      metrics.codeBlockCount += 1;
      blocks.push(
        <pre key={`${source}:code:${blocks.length}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (runtimeWorkbenchShellReactIsTableStart(lines, lineIndex)) {
      const headerCells = runtimeWorkbenchShellReactSplitTableRow(line);
      lineIndex += 2;
      const mutableRows: string[][] = [];
      while (lineIndex < lines.length) {
        const rowLine = lines[lineIndex] ?? "";
        if (
          rowLine.trim().length === 0 ||
          !runtimeWorkbenchShellReactLooksLikeTableRow(rowLine)
        ) {
          break;
        }
        mutableRows.push(runtimeWorkbenchShellReactSplitTableRow(rowLine));
        lineIndex += 1;
      }
      metrics.tableCount += 1;
      blocks.push(
        <table key={`${source}:table:${blocks.length}`}>
          <thead>
            <tr>
              {headerCells.map((cell, cellIndex) => (
                <th key={`${source}:table:${blocks.length}:h:${cellIndex}`}>
                  {runtimeWorkbenchShellReactRenderInlineMarkdown(
                    cell,
                    metrics,
                    `${source}:table:${blocks.length}:h:${cellIndex}`,
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mutableRows.map((row, rowIndex) => (
              <tr key={`${source}:table:${blocks.length}:r:${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${source}:table:${blocks.length}:r:${rowIndex}:${cellIndex}`}
                  >
                    {runtimeWorkbenchShellReactRenderInlineMarkdown(
                      cell,
                      metrics,
                      `${source}:table:${blocks.length}:r:${rowIndex}:${cellIndex}`,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const headingMatch = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (headingMatch !== null) {
      const level = headingMatch[1]?.length ?? 1;
      const headingText = headingMatch[2] ?? "";
      metrics.headingCount += 1;
      const headingContent = runtimeWorkbenchShellReactRenderInlineMarkdown(
        headingText,
        metrics,
        `${source}:heading:${blocks.length}`,
      );
      if (level === 1) {
        blocks.push(
          <h1 key={`${source}:heading:${blocks.length}`}>{headingContent}</h1>,
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={`${source}:heading:${blocks.length}`}>{headingContent}</h2>,
        );
      } else {
        blocks.push(
          <h3 key={`${source}:heading:${blocks.length}`}>{headingContent}</h3>,
        );
      }
      lineIndex += 1;
      continue;
    }
    const listMatch = runtimeWorkbenchShellReactMatchListItem(line);
    if (listMatch !== null) {
      const ordered = listMatch.ordered;
      const items: string[] = [];
      while (lineIndex < lines.length) {
        const itemMatch = runtimeWorkbenchShellReactMatchListItem(
          lines[lineIndex] ?? "",
        );
        if (itemMatch === null || itemMatch.ordered !== ordered) {
          break;
        }
        items.push(itemMatch.text);
        lineIndex += 1;
      }
      metrics.listCount += 1;
      const listItems = items.map((item, itemIndex) => (
        <li key={`${source}:list:${blocks.length}:${itemIndex}`}>
          {runtimeWorkbenchShellReactRenderInlineMarkdown(
            item,
            metrics,
            `${source}:list:${blocks.length}:${itemIndex}`,
          )}
        </li>
      ));
      blocks.push(
        ordered ? (
          <ol key={`${source}:list:${blocks.length}`}>{listItems}</ol>
        ) : (
          <ul key={`${source}:list:${blocks.length}`}>{listItems}</ul>
        ),
      );
      continue;
    }
    const paragraphLines: string[] = [line.trim()];
    lineIndex += 1;
    while (lineIndex < lines.length) {
      const nextLine = lines[lineIndex] ?? "";
      if (
        nextLine.trim().length === 0 ||
        runtimeWorkbenchShellReactIsSpecialBlockStart(lines, lineIndex)
      ) {
        break;
      }
      paragraphLines.push(nextLine.trim());
      lineIndex += 1;
    }
    blocks.push(
      <p key={`${source}:paragraph:${blocks.length}`}>
        {runtimeWorkbenchShellReactRenderInlineMarkdown(
          paragraphLines.join(" "),
          metrics,
          `${source}:paragraph:${blocks.length}`,
        )}
      </p>,
    );
  }
  if (blocks.length === 0) {
    blocks.push(<p key={`${source}:paragraph:0`} />);
  }
  return { blocks, fallback: false, fallbackReason: "none", metrics };
}

function runtimeWorkbenchShellReactRenderPlainTextStreamContent(
  content: unknown,
  source: RuntimeWorkbenchShellStreamContentSource,
): RuntimeWorkbenchShellRenderedStreamContent {
  return {
    blocks: [
      <p key={`${source}:fallback:0`}>
        {runtimeWorkbenchShellReactStringifyStreamContent(content)}
      </p>,
    ],
    fallback: true,
    fallbackReason: "render_failed",
    metrics: runtimeWorkbenchShellReactCreateStreamContentMetrics(),
  };
}

function runtimeWorkbenchShellReactStringifyStreamContent(
  content: unknown,
): string {
  if (typeof content === "string") {
    return content;
  }
  try {
    return String(content);
  } catch {
    return "";
  }
}

function runtimeWorkbenchShellReactCreateStreamContentMetrics(): RuntimeWorkbenchShellStreamContentMetrics {
  return {
    headingCount: 0,
    listCount: 0,
    codeBlockCount: 0,
    tableCount: 0,
    linkCount: 0,
    markCount: 0,
    blockedHtmlCount: 0,
    blockedImageCount: 0,
    blockedLinkCount: 0,
  };
}

function runtimeWorkbenchShellReactRenderInlineMarkdown(
  text: string,
  metrics: RuntimeWorkbenchShellStreamContentMetrics,
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let index = 0;
  let keyIndex = 0;
  const flushText = (): void => {
    if (buffer.length === 0) {
      return;
    }
    nodes.push(buffer);
    buffer = "";
  };
  while (index < text.length) {
    if (text.startsWith("![", index)) {
      const imageToken = runtimeWorkbenchShellReactParseMarkdownLink(
        text,
        index + 1,
      );
      if (imageToken !== null) {
        flushText();
        metrics.blockedImageCount += 1;
        nodes.push(
          imageToken.label.length === 0 ? "[image]" : imageToken.label,
        );
        index = imageToken.end;
        continue;
      }
    }
    if (text[index] === "[") {
      const linkToken = runtimeWorkbenchShellReactParseMarkdownLink(
        text,
        index,
      );
      if (linkToken !== null) {
        flushText();
        const label =
          linkToken.label.length === 0 ? linkToken.target : linkToken.label;
        if (runtimeWorkbenchShellReactIsTrustedMarkdownHref(linkToken.target)) {
          metrics.linkCount += 1;
          nodes.push(
            <a
              href={linkToken.target}
              key={`${keyPrefix}:link:${keyIndex}`}
              rel="noreferrer"
              target="_blank"
            >
              {label}
            </a>,
          );
          keyIndex += 1;
        } else {
          metrics.blockedLinkCount += 1;
          nodes.push(label);
        }
        index = linkToken.end;
        continue;
      }
    }
    if (text[index] === "`") {
      const codeEnd = text.indexOf("`", index + 1);
      if (codeEnd > index + 1) {
        flushText();
        nodes.push(
          <code key={`${keyPrefix}:code:${keyIndex}`}>
            {text.slice(index + 1, codeEnd)}
          </code>,
        );
        keyIndex += 1;
        index = codeEnd + 1;
        continue;
      }
    }
    if (text.startsWith("<mark>", index)) {
      const markEnd = text.indexOf("</mark>", index + "<mark>".length);
      if (markEnd >= 0) {
        flushText();
        metrics.markCount += 1;
        nodes.push(
          <mark key={`${keyPrefix}:mark:${keyIndex}`}>
            {runtimeWorkbenchShellReactRenderInlineMarkdown(
              text.slice(index + "<mark>".length, markEnd),
              metrics,
              `${keyPrefix}:mark:${keyIndex}`,
            )}
          </mark>,
        );
        keyIndex += 1;
        index = markEnd + "</mark>".length;
        continue;
      }
    }
    if (text[index] === "<") {
      const htmlEnd = text.indexOf(">", index + 1);
      if (htmlEnd > index) {
        const htmlToken = text.slice(index, htmlEnd + 1);
        if (/^<\/?[A-Za-z][^>]*>$/u.test(htmlToken)) {
          flushText();
          metrics.blockedHtmlCount += 1;
          nodes.push(htmlToken);
          index = htmlEnd + 1;
          continue;
        }
      }
    }
    buffer += text[index] ?? "";
    index += 1;
  }
  flushText();
  return nodes;
}

function runtimeWorkbenchShellReactParseMarkdownLink(
  text: string,
  start: number,
): RuntimeWorkbenchShellMarkdownLinkToken | null {
  const labelEnd = text.indexOf("]", start + 1);
  if (labelEnd < 0 || text[labelEnd + 1] !== "(") {
    return null;
  }
  const targetEnd = text.indexOf(")", labelEnd + 2);
  if (targetEnd < 0) {
    return null;
  }
  return {
    label: text.slice(start + 1, labelEnd),
    target: text.slice(labelEnd + 2, targetEnd).trim(),
    end: targetEnd + 1,
  };
}

function runtimeWorkbenchShellReactIsTrustedMarkdownHref(
  href: string,
): boolean {
  if (href.length === 0 || /[\u0000-\u001f\u007f\s]/u.test(href)) {
    return false;
  }
  if (href.startsWith("//")) {
    return false;
  }
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(href);
  if (schemeMatch !== null) {
    const scheme = schemeMatch[1]?.toLowerCase() ?? "";
    return scheme === "https" || scheme === "mailto";
  }
  return true;
}

function runtimeWorkbenchShellReactIsSpecialBlockStart(
  lines: readonly string[],
  index: number,
): boolean {
  const line = lines[index] ?? "";
  return (
    runtimeWorkbenchShellReactIsFenceLine(line) ||
    runtimeWorkbenchShellReactIsTableStart(lines, index) ||
    /^(#{1,3})\s+(.+)$/u.test(line) ||
    runtimeWorkbenchShellReactMatchListItem(line) !== null
  );
}

function runtimeWorkbenchShellReactIsFenceLine(line: string): boolean {
  return /^\s*```/u.test(line);
}

function runtimeWorkbenchShellReactIsTableStart(
  lines: readonly string[],
  index: number,
): boolean {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return (
    runtimeWorkbenchShellReactLooksLikeTableRow(header) &&
    runtimeWorkbenchShellReactIsTableSeparator(separator)
  );
}

function runtimeWorkbenchShellReactLooksLikeTableRow(line: string): boolean {
  return runtimeWorkbenchShellReactSplitTableRow(line).length > 1;
}

function runtimeWorkbenchShellReactIsTableSeparator(line: string): boolean {
  const cells = runtimeWorkbenchShellReactSplitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function runtimeWorkbenchShellReactSplitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutLeading = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailing = withoutLeading.endsWith("|")
    ? withoutLeading.slice(0, -1)
    : withoutLeading;
  return withoutTrailing.split("|").map((cell) => cell.trim());
}

function runtimeWorkbenchShellReactMatchListItem(
  line: string,
): { readonly ordered: boolean; readonly text: string } | null {
  const match = /^\s*((?:[-*+])|(?:\d+[.)]))\s+(.+)$/u.exec(line);
  if (match === null) {
    return null;
  }
  const marker = match[1] ?? "";
  return {
    ordered: /^\d/u.test(marker),
    text: match[2] ?? "",
  };
}

function runtimeWorkbenchShellReactStructuredFieldLabel(
  summary: RuntimeWorkbenchShellRuntimeStreamEventSnapshot["payloadSummary"],
): string {
  if (!summary.present || summary.kind === "null") {
    return "none";
  }
  if (summary.kind === "object") {
    return `object (${summary.keyCount} ${
      summary.keyCount === 1 ? "key" : "keys"
    })`;
  }
  if (summary.kind === "array") {
    return `array (${summary.keyCount} ${
      summary.keyCount === 1 ? "item" : "items"
    })`;
  }
  return "primitive";
}
