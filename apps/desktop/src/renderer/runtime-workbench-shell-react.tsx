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
                  surface="focused"
                />
              ) : snapshot.activePanel === "stream" ? (
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
  const selectedNode = useMemo(
    () =>
      selectRuntimeWorkbenchShellWorkflowCanvasNode(
        props.canvas,
        selectionState.selectedNodeId,
      ),
    [props.canvas, selectionState.selectedNodeId],
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
    },
    [props.canvas],
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
    setSelectionState((current) => {
      const previousNodeId = current.history[current.history.length - 1];
      if (previousNodeId === undefined) {
        return current;
      }
      return {
        history: current.history.slice(0, -1),
        selectedNodeId: previousNodeId,
      };
    });
  }, []);
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
      setSelectionState((current) => {
        if (current.history[historyIndex] !== nodeId) {
          return current;
        }
        return {
          history: current.history.slice(0, historyIndex),
          selectedNodeId: nodeId,
        };
      });
      nodeButtonRefs.current.get(nodeId)?.focus({ preventScroll: true });
    },
    [props.canvas],
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

type RuntimeWorkbenchShellChatDraftPreviewState = "empty" | "blocked" | "ready";

type RuntimeWorkbenchShellChatDraftReadinessReason =
  | "empty_draft"
  | "chat_disabled"
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

const RUNTIME_WORKBENCH_CHAT_DRAFT_INTENTS = Object.freeze([
  "ask",
  "revise",
  "repair",
] satisfies RuntimeWorkbenchShellChatDraftIntent[]);

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

function runtimeWorkbenchShellChatDraftWordCount(draft: string): number {
  const trimmedDraft = draft.trim();
  if (trimmedDraft.length === 0) {
    return 0;
  }
  return trimmedDraft.split(/\s+/u).length;
}

function runtimeWorkbenchShellChatDraftPreview(
  chatBoxEnabled: boolean,
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
}): ReactElement {
  const [expanded, setExpanded] = useState(
    () => !props.chatBox.defaultCollapsed,
  );
  const [draft, setDraft] = useState("");
  const [draftIntent, setDraftIntent] =
    useState<RuntimeWorkbenchShellChatDraftIntent>("ask");
  const draftLength = draft.length;
  const draftWords = runtimeWorkbenchShellChatDraftWordCount(draft);
  const draftIntentLabel =
    runtimeWorkbenchShellChatDraftIntentLabel(draftIntent);
  const draftIntentContext =
    runtimeWorkbenchShellChatDraftIntentContext(draftIntent);
  const draftPreview = runtimeWorkbenchShellChatDraftPreview(
    props.chatBox.enabled,
    draftWords,
  );
  const sendGuard = runtimeWorkbenchShellChatDraftSendGuard(draftPreview);
  const handleToggleClick = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);
  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      setDraft(event.currentTarget.value);
    },
    [],
  );
  const handleDraftClearClick = useCallback((): void => {
    setDraft("");
  }, []);
  const handleDraftIntentClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const intent = event.currentTarget.dataset.chatDraftIntent;
      if (!isRuntimeWorkbenchShellChatDraftIntent(intent)) {
        return;
      }
      setDraftIntent(intent);
    },
    [],
  );
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
          <div className="cw-workbench__chat-compose">
            <textarea
              aria-label="Chat draft"
              data-chat-draft-input="true"
              onChange={handleDraftChange}
              placeholder={props.chatBox.placeholder}
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

function RuntimeWorkbenchShellChatDraftPreview(props: {
  readonly draft: string;
  readonly intentContext: RuntimeWorkbenchShellChatDraftIntentContext;
  readonly intent: RuntimeWorkbenchShellChatDraftIntent;
  readonly intentLabel: string;
  readonly preview: RuntimeWorkbenchShellChatDraftPreview;
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
            <div className="cw-workbench__stream-full-reload">
              <strong>Full reload required</strong>
              <span>{panel.fullReload.reason}</span>
              {panel.fullReload.acknowledged ? (
                <small>Acknowledged</small>
              ) : (
                <button
                  onClick={props.onAcknowledgeFullReloadClick}
                  type="button"
                >
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
