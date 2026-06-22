import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type MouseEvent,
  type ReactElement,
} from "react";
import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
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
  RuntimeWorkbenchShellSnapshot,
} from "./runtime-workbench-shell-presenter.js";
import type {
  RuntimeWorkbenchShellDomSession,
  RuntimeWorkbenchShellDomSessionKeyboardOptions,
} from "./runtime-workbench-shell-dom-session.js";

export interface RuntimeWorkbenchShellReactActionOptions {
  readonly runtimeStreamSessionOptions?: CreateRuntimeStreamInteractionSessionFactorySessionOptions;
}

export interface RuntimeWorkbenchShellReactViewProps {
  readonly session: RuntimeWorkbenchShellDomSession;
  readonly title?: string;
  readonly keyboardTarget?: RuntimeWorkbenchShellKeyboardDomEventTarget | null;
  readonly keyboardOptions?: RuntimeWorkbenchShellDomSessionKeyboardOptions;
  readonly runtimeStreamSessionOptions?: CreateRuntimeStreamInteractionSessionFactorySessionOptions;
  readonly className?: string;
  readonly onActionError?: (error: unknown) => void;
}

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
  const actionOptions = useMemo(
    (): RuntimeWorkbenchShellReactActionOptions =>
      props.runtimeStreamSessionOptions === undefined
        ? {}
        : { runtimeStreamSessionOptions: props.runtimeStreamSessionOptions },
    [props.runtimeStreamSessionOptions],
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
          <RuntimeWorkbenchShellPanelSummary snapshot={snapshot} />
        ) : (
          <div className="cw-workbench__empty">
            <h2>{snapshot.emptyState.title}</h2>
            <p>{snapshot.emptyState.summary}</p>
          </div>
        )}
      </section>

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

function activePanelSummary(snapshot: RuntimeWorkbenchShellSnapshot): string {
  if (snapshot.disposed) {
    return "Disposed";
  }
  return snapshot.activePanel === "lifecycle"
    ? `Lifecycle panel is ${snapshot.lifecyclePanelStatus}.`
    : `Runtime stream is ${snapshot.runtimeStreamChannelLabel ?? snapshot.runtimeStreamStatus}.`;
}
