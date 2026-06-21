import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import type {
  RuntimeWorkbenchShortcutKeyEvent,
  RuntimeWorkbenchShortcutKeyEventTarget,
} from "./runtime-workbench-shortcuts.js";

export type RuntimeWorkbenchShellKeyboardBindingErrorHandler = (
  error: unknown,
) => void;

export interface RuntimeWorkbenchShellKeyboardEventTargetInfo {
  readonly tagName?: string | null;
  readonly role?: string | null;
  readonly type?: string | null;
  readonly isContentEditable?: boolean | null;
}

export type RuntimeWorkbenchShellKeyboardEvent = Omit<
  RuntimeWorkbenchShortcutKeyEvent,
  "target"
> & {
  readonly target?: RuntimeWorkbenchShellKeyboardEventTargetInfo | null;
};

export type RuntimeWorkbenchShellKeyboardEventListener = (
  event: RuntimeWorkbenchShellKeyboardEvent,
) => void | Promise<void>;

export interface RuntimeWorkbenchShellKeyboardAdapter {
  readonly handleKeyEvent: (
    event: RuntimeWorkbenchShortcutKeyEvent,
  ) => unknown | Promise<unknown>;
  readonly isDisposed: () => boolean;
}

export interface RuntimeWorkbenchShellKeyboardEventTarget {
  readonly addEventListener: (
    type: string,
    listener: RuntimeWorkbenchShellKeyboardEventListener,
  ) => void;
  readonly removeEventListener: (
    type: string,
    listener: RuntimeWorkbenchShellKeyboardEventListener,
  ) => void;
}

export interface BindRuntimeWorkbenchShellKeyboardTargetOptions {
  readonly eventType?: string;
  readonly onError?: RuntimeWorkbenchShellKeyboardBindingErrorHandler;
}

export function bindRuntimeWorkbenchShellKeyboardTarget(
  adapter: RuntimeWorkbenchShellKeyboardAdapter,
  target: RuntimeWorkbenchShellKeyboardEventTarget,
  options: BindRuntimeWorkbenchShellKeyboardTargetOptions = {},
): RuntimeStatusUnsubscribe {
  if (adapter.isDisposed()) {
    return () => false;
  }
  const eventType = normalizeKeyboardEventType(options.eventType ?? "keydown");
  let bound = true;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Renderer diagnostics must not break keyboard target bindings.
    }
  };

  const handleKeyboardEvent = async (
    event: RuntimeWorkbenchShellKeyboardEvent,
  ): Promise<void> => {
    if (!bound || adapter.isDisposed()) {
      return;
    }
    try {
      await adapter.handleKeyEvent(cloneKeyboardEvent(event));
    } catch (error) {
      reportError(error);
    }
  };

  target.addEventListener(eventType, handleKeyboardEvent);

  return () => {
    if (!bound) {
      return false;
    }
    bound = false;
    target.removeEventListener(eventType, handleKeyboardEvent);
    return true;
  };
}

function normalizeKeyboardEventType(eventType: string): string {
  if (eventType.trim() === "" || /[\r\n]/u.test(eventType)) {
    throw new Error("Invalid runtime workbench shell keyboard event type");
  }
  return eventType;
}

function cloneKeyboardEvent(
  event: RuntimeWorkbenchShellKeyboardEvent,
): RuntimeWorkbenchShortcutKeyEvent {
  return {
    key: event.key,
    ...(event.code !== undefined ? { code: event.code } : {}),
    ...(event.altKey !== undefined ? { altKey: event.altKey } : {}),
    ...(event.ctrlKey !== undefined ? { ctrlKey: event.ctrlKey } : {}),
    ...(event.metaKey !== undefined ? { metaKey: event.metaKey } : {}),
    ...(event.shiftKey !== undefined ? { shiftKey: event.shiftKey } : {}),
    ...(event.repeat !== undefined ? { repeat: event.repeat } : {}),
    ...(event.defaultPrevented !== undefined
      ? { defaultPrevented: event.defaultPrevented }
      : {}),
    ...(event.target != null
      ? { target: cloneKeyboardEventTarget(event.target) }
      : {}),
    ...(event.preventDefault !== undefined
      ? {
          preventDefault: () => {
            event.preventDefault?.();
          },
        }
      : {}),
  };
}

function cloneKeyboardEventTarget(
  target: RuntimeWorkbenchShellKeyboardEventTargetInfo,
): RuntimeWorkbenchShortcutKeyEventTarget {
  return {
    ...(typeof target.tagName === "string" ? { tagName: target.tagName } : {}),
    ...(typeof target.role === "string" ? { role: target.role } : {}),
    ...(typeof target.type === "string" ? { type: target.type } : {}),
    ...(typeof target.isContentEditable === "boolean"
      ? { isContentEditable: target.isContentEditable }
      : {}),
  };
}
