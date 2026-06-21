import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import {
  bindRuntimeWorkbenchShellKeyboardTarget,
  type BindRuntimeWorkbenchShellKeyboardTargetOptions,
  type RuntimeWorkbenchShellKeyboardAdapter,
  type RuntimeWorkbenchShellKeyboardEvent,
  type RuntimeWorkbenchShellKeyboardEventTarget,
  type RuntimeWorkbenchShellKeyboardEventTargetInfo,
} from "./runtime-workbench-shell-keyboard-binding.js";

export interface RuntimeWorkbenchShellKeyboardDomEventTarget {
  readonly addEventListener: (
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  readonly removeEventListener: (
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) => void;
}

export interface BindRuntimeWorkbenchShellKeyboardDomTargetOptions extends BindRuntimeWorkbenchShellKeyboardTargetOptions {
  readonly listenerOptions?: boolean | AddEventListenerOptions;
}

export function bindRuntimeWorkbenchShellKeyboardDomTarget(
  adapter: RuntimeWorkbenchShellKeyboardAdapter,
  target: RuntimeWorkbenchShellKeyboardDomEventTarget,
  options: BindRuntimeWorkbenchShellKeyboardDomTargetOptions = {},
): RuntimeStatusUnsubscribe {
  const { listenerOptions, ...bindingOptions } = options;
  let activeDomListener: EventListener | undefined;
  const structuralTarget: RuntimeWorkbenchShellKeyboardEventTarget = {
    addEventListener: (eventType, listener) => {
      const domListener: EventListener = (event) => {
        const keyboardEvent = toRuntimeWorkbenchShellKeyboardEvent(event);
        if (keyboardEvent === null) {
          return;
        }
        void listener(keyboardEvent);
      };
      target.addEventListener(eventType, domListener, listenerOptions);
      activeDomListener = domListener;
    },
    removeEventListener: (eventType) => {
      if (activeDomListener === undefined) {
        return;
      }
      target.removeEventListener(eventType, activeDomListener, listenerOptions);
      activeDomListener = undefined;
    },
  };

  return bindRuntimeWorkbenchShellKeyboardTarget(
    adapter,
    structuralTarget,
    bindingOptions,
  );
}

function toRuntimeWorkbenchShellKeyboardEvent(
  event: Event,
): RuntimeWorkbenchShellKeyboardEvent | null {
  if (!isKeyboardEventLike(event)) {
    return null;
  }
  const target = toRuntimeWorkbenchShellKeyboardTargetInfo(event.target);
  return {
    key: event.key,
    ...(typeof event.code === "string" ? { code: event.code } : {}),
    ...(typeof event.altKey === "boolean" ? { altKey: event.altKey } : {}),
    ...(typeof event.ctrlKey === "boolean" ? { ctrlKey: event.ctrlKey } : {}),
    ...(typeof event.metaKey === "boolean" ? { metaKey: event.metaKey } : {}),
    ...(typeof event.shiftKey === "boolean"
      ? { shiftKey: event.shiftKey }
      : {}),
    ...(typeof event.repeat === "boolean" ? { repeat: event.repeat } : {}),
    ...(typeof event.defaultPrevented === "boolean"
      ? { defaultPrevented: event.defaultPrevented }
      : {}),
    ...(target !== undefined ? { target } : {}),
    preventDefault: () => {
      event.preventDefault();
    },
  };
}

function isKeyboardEventLike(event: Event): event is Event & {
  readonly key: string;
  readonly code?: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
  readonly defaultPrevented?: boolean;
} {
  return isRecord(event) && typeof event.key === "string";
}

function toRuntimeWorkbenchShellKeyboardTargetInfo(
  target: EventTarget | null,
): RuntimeWorkbenchShellKeyboardEventTargetInfo | undefined {
  if (!isRecord(target)) {
    return undefined;
  }
  const output: RuntimeWorkbenchShellKeyboardEventTargetInfo = {
    ...stringOrNullField(target, "tagName"),
    ...stringOrNullField(target, "role"),
    ...stringOrNullField(target, "type"),
    ...booleanOrNullField(target, "isContentEditable"),
  };
  return Object.keys(output).length === 0 ? undefined : output;
}

function stringOrNullField<TField extends string>(
  value: Record<string, unknown>,
  field: TField,
): Partial<Record<TField, string | null>> {
  const fieldValue = value[field];
  return typeof fieldValue === "string" || fieldValue === null
    ? ({ [field]: fieldValue } as Partial<Record<TField, string | null>>)
    : {};
}

function booleanOrNullField<TField extends string>(
  value: Record<string, unknown>,
  field: TField,
): Partial<Record<TField, boolean | null>> {
  const fieldValue = value[field];
  return typeof fieldValue === "boolean" || fieldValue === null
    ? ({ [field]: fieldValue } as Partial<Record<TField, boolean | null>>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
