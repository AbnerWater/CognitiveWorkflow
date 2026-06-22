import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import type { RuntimeStatusUnsubscribe } from "../preload/contract.js";
import { DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS } from "./runtime-workbench-shortcuts.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import {
  RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS,
  type RuntimeWorkbenchInteractionCommand,
} from "./runtime-workbench-interaction.js";
import type { RuntimeWorkbenchPanelId } from "./runtime-workbench-session.js";
import type { RuntimeWorkbenchShellKeyboardDomEventTarget } from "./runtime-workbench-shell-keyboard-dom-adapter.js";
import type { RuntimeWorkbenchShellDomSession } from "./runtime-workbench-shell-dom-session.js";
import {
  buildRuntimeWorkbenchShellSnapshot,
  type RuntimeWorkbenchShellAction,
  type RuntimeWorkbenchShellSnapshot,
} from "./runtime-workbench-shell-presenter.js";
import {
  RuntimeWorkbenchShellReactView,
  bindRuntimeWorkbenchShellReactKeyboardTarget,
  isRuntimeWorkbenchShellReactActionEnabled,
  runtimeWorkbenchShellActionToCommand,
} from "./runtime-workbench-shell-react.js";

test("renderer runtime workbench React shell renders server snapshot without DOM binding", () => {
  const snapshot = createRuntimeWorkbenchShellReactSnapshot();
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  const target = createFakeRuntimeWorkbenchShellReactKeyboardTarget();
  const markup = renderToString(
    <RuntimeWorkbenchShellReactView
      keyboardTarget={target}
      session={session}
      title="Test Runtime Workbench"
    />,
  );

  assert.match(markup, /Test Runtime Workbench/u);
  assert.match(markup, /Lifecycle/u);
  assert.match(markup, /Stream/u);
  assert.equal(session.serverSnapshotCount(), 1);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.bindKeyboardTargetCount(), 0);
  assert.equal(target.listenerCount("keydown"), 0);
});

test("renderer runtime workbench React shell binds keyboard lifecycle on client mount", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const target = createFakeRuntimeWorkbenchShellReactKeyboardTarget();
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          keyboardTarget={target}
          session={session}
          title="Client Runtime Workbench"
        />,
      );
    });

    assert.equal(session.listenerCount(), 1);
    assert.equal(session.bindKeyboardTargetCount(), 1);
    assert.equal(session.isKeyboardTargetBound(), true);
    assert.equal(target.listenerCount("keydown"), 1);

    await act(async () => {
      root.unmount();
    });

    assert.equal(session.listenerCount(), 0);
    assert.equal(session.isKeyboardTargetBound(), false);
    assert.equal(target.listenerCount("keydown"), 0);
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell keyboard binding helper owns target lifecycle", () => {
  const session = createFakeRuntimeWorkbenchShellReactSession(
    createRuntimeWorkbenchShellReactSnapshot(),
  );
  const target = createFakeRuntimeWorkbenchShellReactKeyboardTarget();
  const unsubscribe = bindRuntimeWorkbenchShellReactKeyboardTarget(
    session,
    target,
  );

  assert.equal(session.bindKeyboardTargetCount(), 1);
  assert.equal(session.isKeyboardTargetBound(), true);
  assert.equal(target.listenerCount("keydown"), 1);
  assert.equal(unsubscribe(), true);
  assert.equal(session.isKeyboardTargetBound(), false);
  assert.equal(target.listenerCount("keydown"), 0);
  assert.equal(unsubscribe(), false);

  session.dispose();
  const disposedUnsubscribe = bindRuntimeWorkbenchShellReactKeyboardTarget(
    session,
    target,
  );
  assert.equal(disposedUnsubscribe(), false);
  assert.equal(session.bindKeyboardTargetCount(), 1);
});

test("renderer runtime workbench React shell maps actions to commands", () => {
  const snapshot = createRuntimeWorkbenchShellReactSnapshot();
  const showStream = requireRuntimeWorkbenchShellReactAction(
    snapshot,
    "show_stream_panel",
  );
  const openStream = requireRuntimeWorkbenchShellReactAction(
    snapshot,
    "open_runtime_stream_session",
  );
  const streamOptions = {
    channel: { kind: "run", runId: "run_react_shell" },
  } as const;

  assert.deepEqual(runtimeWorkbenchShellActionToCommand(showStream), {
    type: "show_stream_panel",
  });
  assert.equal(isRuntimeWorkbenchShellReactActionEnabled(openStream), false);
  assert.equal(runtimeWorkbenchShellActionToCommand(openStream), null);
  assert.equal(
    isRuntimeWorkbenchShellReactActionEnabled(openStream, {
      runtimeStreamSessionOptions: streamOptions,
    }),
    true,
  );
  assert.deepEqual(
    runtimeWorkbenchShellActionToCommand(openStream, {
      runtimeStreamSessionOptions: streamOptions,
    }),
    {
      type: "open_runtime_stream_session",
      options: streamOptions,
    },
  );
});

function createRuntimeWorkbenchShellReactSnapshot(): RuntimeWorkbenchShellSnapshot {
  return buildRuntimeWorkbenchShellSnapshot({
    activePanel: "lifecycle",
    lifecyclePanel: Object.freeze({ active: false, disposed: false }),
    runtimeStream: Object.freeze({
      active: false,
      activeChannel: null,
      disposed: false,
    }),
    availableCommandIds: Object.freeze([
      ...RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS,
    ]),
    enabledCommandIds: Object.freeze([
      ...RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS,
    ]),
    availableShortcutIds: Object.freeze(
      DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS.map((binding) => binding.id),
    ),
    enabledShortcutIds: Object.freeze(
      DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS.map((binding) => binding.id),
    ),
    lastHandledShortcutId: null,
    disposed: false,
  });
}

function requireRuntimeWorkbenchShellReactAction(
  snapshot: RuntimeWorkbenchShellSnapshot,
  actionId: RuntimeWorkbenchShellAction["id"],
): RuntimeWorkbenchShellAction {
  const action = snapshot.actions.find(
    (candidate) => candidate.id === actionId,
  );
  if (action === undefined) {
    throw new Error(`Missing runtime workbench shell action: ${actionId}`);
  }
  return action;
}

function createFakeRuntimeWorkbenchShellReactSession(
  initialSnapshot: RuntimeWorkbenchShellSnapshot,
): RuntimeWorkbenchShellDomSession & {
  readonly bindKeyboardTargetCount: () => number;
  readonly serverSnapshotCount: () => number;
} {
  const listeners = new Set<() => void>();
  const commands: RuntimeWorkbenchInteractionCommand[] = [];
  const selectedPanels: RuntimeWorkbenchPanelId[] = [];
  let snapshot = initialSnapshot;
  let disposed = false;
  let keyboardTargetBound = false;
  let keyboardTargetUnsubscribe: RuntimeStatusUnsubscribe | undefined;
  let bindCount = 0;
  let serverSnapshotCount = 0;

  const unbindKeyboardTarget = (): boolean => {
    if (keyboardTargetUnsubscribe === undefined) {
      return false;
    }
    const unsubscribe = keyboardTargetUnsubscribe;
    keyboardTargetUnsubscribe = undefined;
    keyboardTargetBound = false;
    return unsubscribe();
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => {
      serverSnapshotCount += 1;
      return snapshot;
    },
    subscribe: (listener) => {
      if (disposed) {
        return () => false;
      }
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        return listeners.delete(listener);
      };
    },
    dispatch: async (command) => {
      commands.push(command);
      return snapshot;
    },
    setActivePanel: (panel) => {
      selectedPanels.push(panel);
      return snapshot;
    },
    resolveKeyEvent: () => null,
    handleKeyEvent: async (_event: RuntimeWorkbenchShortcutKeyEvent) =>
      snapshot,
    bindKeyboardTarget: (target) => {
      if (disposed) {
        return false;
      }
      unbindKeyboardTarget();
      bindCount += 1;
      keyboardTargetBound = true;
      const listener = (): void => undefined;
      target.addEventListener("keydown", listener);
      keyboardTargetUnsubscribe = () => {
        target.removeEventListener("keydown", listener);
        return true;
      };
      return true;
    },
    unbindKeyboardTarget,
    isKeyboardTargetBound: () => keyboardTargetBound,
    listenerCount: () => listeners.size,
    dispose: () => {
      if (disposed) {
        return false;
      }
      disposed = true;
      listeners.clear();
      unbindKeyboardTarget();
      return true;
    },
    isDisposed: () => disposed,
    bindKeyboardTargetCount: () => bindCount,
    serverSnapshotCount: () => serverSnapshotCount,
  };
}

function createFakeRuntimeWorkbenchShellReactKeyboardTarget(): RuntimeWorkbenchShellKeyboardDomEventTarget & {
  readonly listenerCount: (eventType: string) => number;
} {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener: (eventType, listener) => {
      const eventListeners = listeners.get(eventType) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventType, eventListeners);
    },
    removeEventListener: (eventType, listener) => {
      listeners.get(eventType)?.delete(listener);
    },
    listenerCount: (eventType) => listeners.get(eventType)?.size ?? 0,
  };
}

interface FakeRuntimeWorkbenchReactDomInstallation {
  readonly container: FakeRuntimeWorkbenchElement;
  readonly restore: () => void;
}

type RuntimeWorkbenchReactDomGlobalName =
  | "document"
  | "Element"
  | "HTMLElement"
  | "HTMLButtonElement"
  | "Node"
  | "SVGElement"
  | "window"
  | "IS_REACT_ACT_ENVIRONMENT";

type RuntimeWorkbenchReactDomGlobalObject = typeof globalThis & {
  document?: unknown;
  Element?: unknown;
  HTMLElement?: unknown;
  HTMLButtonElement?: unknown;
  Node?: unknown;
  SVGElement?: unknown;
  window?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: unknown;
};

class FakeRuntimeWorkbenchNode {
  readonly childNodes: FakeRuntimeWorkbenchNode[] = [];
  readonly nodeName: string;
  readonly nodeType: number;
  ownerDocument: FakeRuntimeWorkbenchDocument | null;
  parentNode: FakeRuntimeWorkbenchNode | null = null;
  nodeValue: string | null = null;
  textContent = "";
  private readonly eventListeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  constructor(
    nodeType: number,
    nodeName: string,
    ownerDocument: FakeRuntimeWorkbenchDocument | null,
  ) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  appendChild<TNode extends FakeRuntimeWorkbenchNode>(node: TNode): TNode {
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore<TNode extends FakeRuntimeWorkbenchNode>(
    node: TNode,
    referenceNode: FakeRuntimeWorkbenchNode | null,
  ): TNode {
    if (referenceNode === null) {
      return this.appendChild(node);
    }
    const referenceIndex = this.childNodes.indexOf(referenceNode);
    if (referenceIndex < 0) {
      throw new Error("Reference node is not a child of this fake DOM node");
    }
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    this.childNodes.splice(referenceIndex, 0, node);
    return node;
  }

  removeChild<TNode extends FakeRuntimeWorkbenchNode>(node: TNode): TNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) {
      throw new Error("Node is not a child of this fake DOM node");
    }
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  contains(node: FakeRuntimeWorkbenchNode | null): boolean {
    if (node === null) {
      return false;
    }
    if (node === this) {
      return true;
    }
    return this.childNodes.some((child) => child.contains(node));
  }

  addEventListener(
    eventType: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (listener === null) {
      return;
    }
    const listeners = this.eventListeners.get(eventType) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(eventType, listeners);
  }

  removeEventListener(
    eventType: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (listener === null) {
      return;
    }
    this.eventListeners.get(eventType)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.eventListeners.get(event.type) ?? new Set();
    for (const listener of listeners) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
    return !event.defaultPrevented;
  }
}

class FakeRuntimeWorkbenchElement extends FakeRuntimeWorkbenchNode {
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly namespaceURI: string;
  readonly style: Record<string, string> = {};
  className = "";
  disabled = false;
  tagName: string;
  title = "";

  constructor(
    tagName: string,
    ownerDocument: FakeRuntimeWorkbenchDocument,
    namespaceURI = "http://www.w3.org/1999/xhtml",
  ) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = namespaceURI;
  }

  setAttribute(name: string, value: string): void {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") {
      this.className = stringValue;
    }
    if (name.startsWith("data-")) {
      this.dataset[dataAttributeNameToProperty(name)] = stringValue;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "class") {
      this.className = "";
    }
    if (name.startsWith("data-")) {
      delete this.dataset[dataAttributeNameToProperty(name)];
    }
  }
}

class FakeRuntimeWorkbenchTextNode extends FakeRuntimeWorkbenchNode {
  constructor(text: string, ownerDocument: FakeRuntimeWorkbenchDocument) {
    super(3, "#text", ownerDocument);
    this.nodeValue = text;
    this.textContent = text;
  }
}

class FakeRuntimeWorkbenchCommentNode extends FakeRuntimeWorkbenchNode {
  constructor(text: string, ownerDocument: FakeRuntimeWorkbenchDocument) {
    super(8, "#comment", ownerDocument);
    this.nodeValue = text;
    this.textContent = text;
  }
}

class FakeRuntimeWorkbenchDocument extends FakeRuntimeWorkbenchNode {
  activeElement: FakeRuntimeWorkbenchElement | null = null;
  body: FakeRuntimeWorkbenchElement;
  defaultView: Record<string, unknown> | null = null;
  documentElement: FakeRuntimeWorkbenchElement;

  constructor() {
    super(9, "#document", null);
    this.ownerDocument = this;
    this.documentElement = new FakeRuntimeWorkbenchElement("html", this);
    this.body = new FakeRuntimeWorkbenchElement("body", this);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tagName: string): FakeRuntimeWorkbenchElement {
    return new FakeRuntimeWorkbenchElement(tagName, this);
  }

  createElementNS(
    namespaceURI: string,
    tagName: string,
  ): FakeRuntimeWorkbenchElement {
    return new FakeRuntimeWorkbenchElement(tagName, this, namespaceURI);
  }

  createTextNode(text: string): FakeRuntimeWorkbenchTextNode {
    return new FakeRuntimeWorkbenchTextNode(text, this);
  }

  createComment(text: string): FakeRuntimeWorkbenchCommentNode {
    return new FakeRuntimeWorkbenchCommentNode(text, this);
  }
}

function installFakeRuntimeWorkbenchReactDom(): FakeRuntimeWorkbenchReactDomInstallation {
  const document = new FakeRuntimeWorkbenchDocument();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const iframeElement = class FakeRuntimeWorkbenchIFrameElement {};
  const windowLike = {
    document,
    Element: FakeRuntimeWorkbenchElement,
    Event,
    HTMLButtonElement: FakeRuntimeWorkbenchElement,
    HTMLElement: FakeRuntimeWorkbenchElement,
    HTMLIFrameElement: iframeElement,
    Node: FakeRuntimeWorkbenchNode,
    SVGElement: FakeRuntimeWorkbenchElement,
    addEventListener: document.addEventListener.bind(document),
    dispatchEvent: document.dispatchEvent.bind(document),
    getComputedStyle: () => ({}),
    location: { protocol: "http:" },
    removeEventListener: document.removeEventListener.bind(document),
  };
  document.defaultView = windowLike;

  const globalObject = globalThis as RuntimeWorkbenchReactDomGlobalObject;
  const globalNames: readonly RuntimeWorkbenchReactDomGlobalName[] = [
    "document",
    "Element",
    "HTMLElement",
    "HTMLButtonElement",
    "Node",
    "SVGElement",
    "window",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previousDescriptors = new Map<
    RuntimeWorkbenchReactDomGlobalName,
    PropertyDescriptor | undefined
  >();
  for (const name of globalNames) {
    previousDescriptors.set(
      name,
      Object.getOwnPropertyDescriptor(globalObject, name),
    );
  }

  Object.defineProperties(globalObject, {
    document: { configurable: true, value: document, writable: true },
    Element: {
      configurable: true,
      value: FakeRuntimeWorkbenchElement,
      writable: true,
    },
    HTMLElement: {
      configurable: true,
      value: FakeRuntimeWorkbenchElement,
      writable: true,
    },
    HTMLButtonElement: {
      configurable: true,
      value: FakeRuntimeWorkbenchElement,
      writable: true,
    },
    Node: {
      configurable: true,
      value: FakeRuntimeWorkbenchNode,
      writable: true,
    },
    SVGElement: {
      configurable: true,
      value: FakeRuntimeWorkbenchElement,
      writable: true,
    },
    window: { configurable: true, value: windowLike, writable: true },
    IS_REACT_ACT_ENVIRONMENT: {
      configurable: true,
      value: true,
      writable: true,
    },
  });

  return {
    container,
    restore: () => {
      for (const name of globalNames) {
        const descriptor = previousDescriptors.get(name);
        if (descriptor === undefined) {
          delete globalObject[name];
        } else {
          Object.defineProperty(globalObject, name, descriptor);
        }
      }
    },
  };
}

function dataAttributeNameToProperty(name: string): string {
  return name
    .slice("data-".length)
    .replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
}
