import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  useSyncExternalStore,
  type MouseEvent,
  type ReactElement,
} from "react";
import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  RuntimeStreamCategory,
  RuntimeStreamDisplayLevel,
} from "./runtime-stream-client.js";
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
  RuntimeWorkbenchShellRuntimeStreamEventSnapshot,
  RuntimeWorkbenchShellRuntimeStreamPanelSnapshot,
  RuntimeWorkbenchShellSnapshot,
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

      <nav aria-label="Runtime workbench panels" className="cw-workbench__tabs">
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

      <section aria-live={snapshot.ariaLive} className="cw-workbench__content">
        {snapshot.emptyState === null ? (
          snapshot.activePanel === "stream" ? (
            <RuntimeWorkbenchShellStreamPanel snapshot={snapshot} />
          ) : (
            <RuntimeWorkbenchShellPanelSummary snapshot={snapshot} />
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
              !isRuntimeWorkbenchShellReactActionEnabled(action, actionOptions)
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
    </main>
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

function RuntimeWorkbenchShellStreamPanel(props: {
  readonly snapshot: RuntimeWorkbenchShellSnapshot;
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
          {panel.fullReload.acknowledged ? <small>Acknowledged</small> : null}
        </div>
      )}

      <div className="cw-workbench__stream-panel-body">
        <div className="cw-workbench__stream-event-groups">
          <RuntimeWorkbenchShellStreamEventGroup
            events={panel.summaryItems}
            title="Summary"
          />
          <RuntimeWorkbenchShellStreamEventGroup
            events={panel.timelineItems}
            title="Timeline"
          />
        </div>
        <RuntimeWorkbenchShellStreamSelection panel={panel} />
      </div>
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
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function RuntimeWorkbenchShellStreamEventItem(props: {
  readonly event: RuntimeWorkbenchShellRuntimeStreamEventSnapshot;
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
      {props.event.children.length === 0 ? null : (
        <ol className="cw-workbench__stream-events cw-workbench__stream-events--children">
          {props.event.children.map((child, index) => (
            <RuntimeWorkbenchShellStreamEventItem
              event={child}
              key={child.id ?? `${child.type}:${index}`}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function RuntimeWorkbenchShellStreamSelection(props: {
  readonly panel: RuntimeWorkbenchShellRuntimeStreamPanelSnapshot;
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
