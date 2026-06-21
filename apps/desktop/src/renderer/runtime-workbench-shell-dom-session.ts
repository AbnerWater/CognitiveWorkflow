import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type { RuntimeWorkbenchPanelId } from "./runtime-workbench-session.js";
import type { RuntimeWorkbenchInteractionCommand } from "./runtime-workbench-interaction.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import type {
  RuntimeWorkbenchShellAdapter,
  RuntimeWorkbenchShellAdapterStoreChangeListener,
} from "./runtime-workbench-shell-adapter.js";
import type { RuntimeWorkbenchShellSnapshot } from "./runtime-workbench-shell-presenter.js";
import {
  bindRuntimeWorkbenchShellKeyboardDomTarget,
  type BindRuntimeWorkbenchShellKeyboardDomTargetOptions,
  type RuntimeWorkbenchShellKeyboardDomEventTarget,
} from "./runtime-workbench-shell-keyboard-dom-adapter.js";

export type RuntimeWorkbenchShellDomSessionKeyboardOptions =
  BindRuntimeWorkbenchShellKeyboardDomTargetOptions;

export interface RuntimeWorkbenchShellDomSession {
  readonly getSnapshot: () => RuntimeWorkbenchShellSnapshot;
  readonly getServerSnapshot: () => RuntimeWorkbenchShellSnapshot;
  readonly subscribe: (
    listener: RuntimeWorkbenchShellAdapterStoreChangeListener,
  ) => RuntimeStatusUnsubscribe;
  readonly dispatch: (
    command: RuntimeWorkbenchInteractionCommand,
  ) => Promise<RuntimeWorkbenchShellSnapshot>;
  readonly setActivePanel: (
    panel: RuntimeWorkbenchPanelId,
  ) => RuntimeWorkbenchShellSnapshot;
  readonly resolveKeyEvent: RuntimeWorkbenchShellAdapter["resolveKeyEvent"];
  readonly handleKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => Promise<RuntimeWorkbenchShellSnapshot>;
  readonly bindKeyboardTarget: (
    target: RuntimeWorkbenchShellKeyboardDomEventTarget,
    options?: RuntimeWorkbenchShellDomSessionKeyboardOptions,
  ) => boolean;
  readonly unbindKeyboardTarget: () => boolean;
  readonly isKeyboardTargetBound: () => boolean;
  readonly listenerCount: () => number;
  readonly dispose: () => boolean;
  readonly isDisposed: () => boolean;
}

export interface CreateRuntimeWorkbenchShellDomSessionOptions {
  readonly adapter: RuntimeWorkbenchShellAdapter;
  readonly keyboardTarget?: RuntimeWorkbenchShellKeyboardDomEventTarget;
  readonly keyboardOptions?: RuntimeWorkbenchShellDomSessionKeyboardOptions;
}

export function createRuntimeWorkbenchShellDomSession(
  options: CreateRuntimeWorkbenchShellDomSessionOptions,
): RuntimeWorkbenchShellDomSession {
  let keyboardUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let disposed = false;

  const isDisposed = (): boolean => disposed || options.adapter.isDisposed();

  const unbindKeyboardTarget = (): boolean => {
    if (keyboardUnsubscribe === undefined) {
      return false;
    }
    const unsubscribe = keyboardUnsubscribe;
    keyboardUnsubscribe = undefined;
    return unsubscribe();
  };

  const bindKeyboardTarget = (
    target: RuntimeWorkbenchShellKeyboardDomEventTarget,
    keyboardOptions: RuntimeWorkbenchShellDomSessionKeyboardOptions = {},
  ): boolean => {
    if (isDisposed()) {
      return false;
    }
    unbindKeyboardTarget();
    keyboardUnsubscribe = bindRuntimeWorkbenchShellKeyboardDomTarget(
      options.adapter,
      target,
      keyboardOptions,
    );
    return true;
  };

  if (options.keyboardTarget !== undefined) {
    bindKeyboardTarget(options.keyboardTarget, options.keyboardOptions);
  }

  return {
    getSnapshot: () => options.adapter.getSnapshot(),
    getServerSnapshot: () => options.adapter.getServerSnapshot(),
    subscribe: (listener) => {
      if (isDisposed()) {
        return () => false;
      }
      return options.adapter.subscribe(listener);
    },
    dispatch: (command) => options.adapter.dispatch(command),
    setActivePanel: (panel) => options.adapter.setActivePanel(panel),
    resolveKeyEvent: (event) => options.adapter.resolveKeyEvent(event),
    handleKeyEvent: (event) => options.adapter.handleKeyEvent(event),
    bindKeyboardTarget,
    unbindKeyboardTarget,
    isKeyboardTargetBound: () => keyboardUnsubscribe !== undefined,
    listenerCount: () => options.adapter.listenerCount(),
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      unbindKeyboardTarget();
      options.adapter.dispose();
      return true;
    },
    isDisposed,
  };
}
