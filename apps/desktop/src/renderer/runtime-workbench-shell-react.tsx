import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  useSyncExternalStore,
  type MouseEvent,
  type ReactElement,
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
import type { CreateRuntimeStreamInteractionSessionFactorySessionOptions } from "./runtime-stream-session.js";
import type {
  RuntimeWorkbenchInteractionCommand,
  RuntimeWorkbenchInteractionCommandId,
} from "./runtime-workbench-interaction.js";
import type { RuntimeWorkbenchPanelId } from "./runtime-workbench-session.js";
import type { RuntimeWorkbenchShellKeyboardDomEventTarget } from "./runtime-workbench-shell-keyboard-dom-adapter.js";
import type {
  RuntimeWorkbenchShellAction,
  RuntimeWorkbenchShellActionId,
  RuntimeWorkbenchShellChatBoxSnapshot,
  RuntimeWorkbenchShellDockItem,
  RuntimeWorkbenchShellFileTreeSnapshot,
  RuntimeWorkbenchShellLifecyclePanelSnapshot,
  RuntimeWorkbenchShellRuntimeStreamEventSnapshot,
  RuntimeWorkbenchShellRuntimeStreamPanelSnapshot,
  RuntimeWorkbenchShellSnapshot,
  RuntimeWorkbenchShellTaskDrawerSnapshot,
  RuntimeWorkbenchShellVersionSnapshotsSnapshot,
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

export interface RuntimeWorkbenchShellReactViewProps {
  readonly session: RuntimeWorkbenchShellDomSession;
  readonly title?: string;
  readonly keyboardTarget?: RuntimeWorkbenchShellKeyboardDomEventTarget | null;
  readonly keyboardOptions?: RuntimeWorkbenchShellDomSessionKeyboardOptions;
  readonly runtimeStreamSessionOptions?: CreateRuntimeStreamInteractionSessionFactorySessionOptions;
  readonly defaultRuntimeStreamOptionsFormState?: Partial<RuntimeWorkbenchShellReactStreamOptionsFormState>;
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
      if (panel !== "lifecycle" && panel !== "stream") {
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
          />

          <section
            aria-live={snapshot.ariaLive}
            className="cw-workbench__content"
          >
            {snapshot.emptyState === null ? (
              snapshot.activePanel === "stream" ? (
                <RuntimeWorkbenchShellStreamPanel
                  onAcknowledgeFullReloadClick={
                    handleStreamPanelAcknowledgeFullReloadClick
                  }
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
        <RuntimeWorkbenchShellChatBox chatBox={snapshot.chrome.chatBox} />
      </div>
    </main>
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
        {props.fileTree.nodes.map((node) => (
          <li
            aria-selected={node.active}
            className={[
              "cw-workbench__file-tree-node",
              `cw-workbench__file-tree-node--depth-${node.depth}`,
              `cw-workbench__file-tree-node--${node.tone}`,
              node.active ? "cw-workbench__file-tree-node--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-file-tree-node={node.id}
            key={node.id}
            role="treeitem"
          >
            <span>{node.label}</span>
            <small>{node.statusLabel}</small>
            <code>{node.pathLabel}</code>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function RuntimeWorkbenchShellVersionSnapshots(props: {
  readonly snapshots: RuntimeWorkbenchShellVersionSnapshotsSnapshot;
}): ReactElement {
  return (
    <section
      aria-label={props.snapshots.title}
      className="cw-workbench__version-snapshots"
    >
      <div className="cw-workbench__version-snapshots-header">
        <h2>{props.snapshots.title}</h2>
        <p>{props.snapshots.summary}</p>
      </div>
      <ol className="cw-workbench__version-snapshot-items">
        {props.snapshots.items.map((item) => (
          <li
            className={[
              "cw-workbench__version-snapshot-item",
              `cw-workbench__version-snapshot-item--${item.tone}`,
              item.active ? "cw-workbench__version-snapshot-item--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-version-snapshot={item.id}
            key={item.id}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.statusLabel}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RuntimeWorkbenchShellWorkflowCanvas(props: {
  readonly canvas: RuntimeWorkbenchShellWorkflowCanvasSnapshot;
}): ReactElement {
  return (
    <section
      aria-label={props.canvas.title}
      className="cw-workbench__workflow-canvas"
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
            <li
              className={[
                "cw-workbench__workflow-canvas-node",
                `cw-workbench__workflow-canvas-node--${node.tone}`,
                node.active ? "cw-workbench__workflow-canvas-node--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-workflow-canvas-node={node.nodeId}
              key={node.nodeId}
              style={
                {
                  left: `${node.position.x}%`,
                  top: `${node.position.y}%`,
                } as CSSProperties
              }
            >
              <span>{node.type}</span>
              <strong>{node.title}</strong>
              <small>{node.statusLabel}</small>
            </li>
          ))}
        </ol>
        <ol
          aria-label="Workflow canvas edges"
          className="cw-workbench__workflow-canvas-edges"
        >
          {props.canvas.edges.map((edge) => (
            <li
              className={`cw-workbench__workflow-canvas-edge cw-workbench__workflow-canvas-edge--${edge.tone}`}
              data-workflow-canvas-edge={edge.edgeId}
              key={edge.edgeId}
            >
              <span>{edge.type}</span>
              <strong>
                {edge.sourceNodeId} {" -> "} {edge.targetNodeId}
              </strong>
              <small>{edge.label}</small>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function RuntimeWorkbenchShellTaskDrawer(props: {
  readonly drawer: RuntimeWorkbenchShellTaskDrawerSnapshot;
}): ReactElement {
  const [expanded, setExpanded] = useState(
    () => !props.drawer.defaultCollapsed,
  );
  const handleToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
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
        <dl className="cw-workbench__task-drawer-items">
          {props.drawer.items.map((item) => (
            <div
              className={`cw-workbench__task-drawer-item cw-workbench__task-drawer-item--${item.tone}`}
              key={item.id}
            >
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cw-workbench__task-drawer-collapsed">
          {props.drawer.collapsedSummary}
        </p>
      )}
    </aside>
  );
}

function RuntimeWorkbenchShellChatBox(props: {
  readonly chatBox: RuntimeWorkbenchShellChatBoxSnapshot;
}): ReactElement {
  const [expanded, setExpanded] = useState(
    () => !props.chatBox.defaultCollapsed,
  );
  const handleToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
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
        <div className="cw-workbench__chat-compose">
          <textarea
            disabled={!props.chatBox.enabled}
            placeholder={props.chatBox.placeholder}
            rows={2}
          />
          <button disabled={!props.chatBox.enabled} type="button">
            Send
          </button>
        </div>
      ) : (
        <p className="cw-workbench__chat-collapsed">
          {props.chatBox.collapsedSummary}
        </p>
      )}
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
  readonly onClearSelectionClick: () => void;
  readonly onToggleExpandedClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  const panel = props.snapshot.runtimeStreamPanel;
  if (panel === null) {
    return (
      <div className="cw-workbench__stream-panel cw-workbench__stream-panel--empty">
        <div className="cw-workbench__stream-panel-header">
          <div>
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

  return (
    <div className="cw-workbench__stream-panel">
      <div className="cw-workbench__stream-panel-header">
        <div>
          <h2>Runtime stream</h2>
          <p>{props.snapshot.runtimeStreamChannelLabel ?? panel.status}</p>
        </div>
        <RuntimeWorkbenchShellStreamPanelMetrics panel={panel} />
      </div>

      {panel.fullReload === null ? null : (
        <div className="cw-workbench__stream-full-reload">
          <strong>Full reload required</strong>
          <span>{panel.fullReload.reason}</span>
          {panel.fullReload.acknowledged ? (
            <small>Acknowledged</small>
          ) : (
            <button onClick={props.onAcknowledgeFullReloadClick} type="button">
              Acknowledge
            </button>
          )}
        </div>
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
            onSelectEventClick={props.onSelectEventClick}
            onToggleExpandedClick={props.onToggleExpandedClick}
            title="Summary"
          />
          <RuntimeWorkbenchShellStreamEventGroup
            events={panel.timelineItems}
            onSelectEventClick={props.onSelectEventClick}
            onToggleExpandedClick={props.onToggleExpandedClick}
            title="Timeline"
          />
        </div>
        <RuntimeWorkbenchShellStreamSelection
          onClearSelectionClick={props.onClearSelectionClick}
          panel={panel}
        />
      </div>
    </div>
  );
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
  const hasSearch = props.panel.search.query.length > 0;
  const hasMatches = props.panel.search.matchCount > 0;
  const searchPosition =
    props.panel.search.activeMatchIndex === null
      ? "-"
      : `${props.panel.search.activeMatchIndex + 1}/${props.panel.search.matchCount}`;
  return (
    <div className="cw-workbench__stream-controls">
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
  readonly title: string;
  readonly events: readonly RuntimeWorkbenchShellRuntimeStreamEventSnapshot[];
  readonly onSelectEventClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onToggleExpandedClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  return (
    <section className="cw-workbench__stream-event-group">
      <div className="cw-workbench__stream-event-group-header">
        <h3>{props.title}</h3>
        <span>{props.events.length}</span>
      </div>
      {props.events.length === 0 ? (
        <p className="cw-workbench__stream-muted">No visible events</p>
      ) : (
        <ol className="cw-workbench__stream-events">
          {props.events.map((event, index) => (
            <RuntimeWorkbenchShellStreamEventItem
              event={event}
              key={event.id ?? `${event.type}:${index}`}
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
  readonly onToggleExpandedClick: (
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}): ReactElement {
  return (
    <li
      className={`cw-workbench__stream-event cw-workbench__stream-event--${props.event.severity}`}
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
          disabled={props.event.id === null}
          onClick={props.onSelectEventClick}
          type="button"
        >
          Select
        </button>
        {props.event.expandable ? (
          <button
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
              onSelectEventClick={props.onSelectEventClick}
              onToggleExpandedClick={props.onToggleExpandedClick}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function RuntimeWorkbenchShellStreamSelection(props: {
  readonly panel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot;
  readonly onClearSelectionClick: () => void;
}): ReactElement {
  const selected = props.panel.selectedEvent;
  return (
    <aside className="cw-workbench__stream-selection">
      <h3>Selection</h3>
      {props.panel.search.query.length === 0 ? null : (
        <p>
          Search "{props.panel.search.query}" - {props.panel.search.matchCount}{" "}
          matches
        </p>
      )}
      {selected === null ? (
        <p className="cw-workbench__stream-muted">No event selected</p>
      ) : (
        <div className="cw-workbench__stream-selected-event">
          <button onClick={props.onClearSelectionClick} type="button">
            Clear selection
          </button>
          <strong>{selected.title}</strong>
          <span>{selected.type}</span>
          {selected.summary === null ? null : <p>{selected.summary}</p>}
          {selected.content === null ? null : <p>{selected.content}</p>}
          <dl>
            <div>
              <dt>Seq</dt>
              <dd>{selected.seq ?? "-"}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>{selected.severity}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{selected.createdAt ?? "-"}</dd>
            </div>
          </dl>
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
