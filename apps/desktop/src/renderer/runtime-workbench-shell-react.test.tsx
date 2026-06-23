import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { renderToString } from "react-dom/server";
import type {
  RuntimeBridge,
  RuntimeConnectionInfo,
  RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import type { RuntimeLifecyclePanelSessionSnapshot } from "./runtime-lifecycle-panel-session.js";
import type { RuntimeStreamReconnectScheduler } from "./runtime-stream-client.js";
import { createRuntimeFetchEventSourceFactory } from "./runtime-stream-fetch-event-source.js";
import { DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS } from "./runtime-workbench-shortcuts.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import {
  RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS,
  type RuntimeWorkbenchInteractionCommand,
} from "./runtime-workbench-interaction.js";
import type { RuntimeWorkbenchPanelId } from "./runtime-workbench-session.js";
import type { RuntimeWorkbenchShellKeyboardDomEventTarget } from "./runtime-workbench-shell-keyboard-dom-adapter.js";
import type { RuntimeWorkbenchShellDomSession } from "./runtime-workbench-shell-dom-session.js";
import { createRuntimeWorkbenchShellReactSession } from "./runtime-workbench-shell-react-session.js";
import {
  buildRuntimeWorkbenchShellSnapshot,
  type RuntimeWorkbenchShellAction,
  type RuntimeWorkbenchShellSnapshot,
} from "./runtime-workbench-shell-presenter.js";
import {
  RuntimeWorkbenchShellReactView,
  bindRuntimeWorkbenchShellReactKeyboardTarget,
  buildRuntimeWorkbenchShellReactStreamSessionOptions,
  createRuntimeWorkbenchShellReactStreamOptionsFormState,
  isRuntimeWorkbenchShellReactActionEnabled,
  runtimeWorkbenchShellLifecyclePanelCommandToWorkbenchCommand,
  runtimeWorkbenchShellActionToCommand,
  runtimeWorkbenchShellStreamPanelCommandToWorkbenchCommand,
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
  assert.match(markup, /Canvas/u);
  assert.match(markup, /Lifecycle/u);
  assert.match(markup, /Stream/u);
  assert.match(markup, /File Tree/u);
  assert.match(markup, /Accepted specs/u);
  assert.match(markup, /Version Snapshots/u);
  assert.match(markup, /Git snapshot/u);
  assert.match(markup, /Task Drawer/u);
  assert.match(markup, /Collapse drawer/u);
  assert.match(markup, /Chat Box/u);
  assert.match(markup, /Collapse chat/u);
  assert.equal(session.serverSnapshotCount(), 1);
  assert.equal(session.listenerCount(), 0);
  assert.equal(session.bindKeyboardTargetCount(), 0);
  assert.equal(target.listenerCount("keydown"), 0);
});

test("renderer runtime workbench React shell renders stream options readiness", () => {
  const snapshot = createRuntimeWorkbenchShellReactSnapshot();
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  const markup = renderToString(
    <RuntimeWorkbenchShellReactView
      defaultRuntimeStreamOptionsFormState={{
        categories: ["model", "tool"],
        displayLevel: "detailed",
        runId: "run_ssr_stream",
      }}
      session={session}
      title="Stream Options Runtime Workbench"
    />,
  );

  assert.match(markup, /Runtime stream options/u);
  assert.match(markup, /Run id/u);
  assert.match(markup, /run_ssr_stream/u);
  assert.match(markup, /Detailed/u);
  assert.match(markup, /Ready/u);
});

test("renderer runtime workbench React shell renders active stream panel events", () => {
  const snapshot = createRuntimeWorkbenchShellReactStreamSnapshot();
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  const markup = renderToString(
    <RuntimeWorkbenchShellReactView
      session={session}
      title="Stream Panel Runtime Workbench"
    />,
  );

  assert.match(markup, /Stream Panel Runtime Workbench/u);
  assert.match(markup, /Runtime stream/u);
  assert.match(markup, /Run run_react_stream/u);
  assert.match(markup, /Model delta/u);
  assert.match(markup, /delta content/u);
  assert.match(markup, /Search[\s\S]*delta[\s\S]*1[\s\S]*matches/u);
  assert.match(markup, /Full reload required/u);
  assert.match(markup, /Replay point expired/u);
  assert.match(markup, /Selection/u);
  assert.match(markup, /Task Drawer[\s\S]*Run run_react_stream/u);
  assert.match(markup, /Unread[\s\S]*1/u);
  assert.match(markup, /model.text_delta/u);
  assert.match(markup, /Search events/u);
  assert.match(markup, /Previous/u);
  assert.match(markup, /Next/u);
  assert.match(markup, /Select match/u);
  assert.match(markup, /Mark read/u);
  assert.match(markup, /Acknowledge/u);
  assert.match(markup, /Select/u);
  assert.match(markup, /Expand/u);
  assert.match(markup, /Clear selection/u);
});

test("renderer runtime workbench React shell renders lifecycle panel events", () => {
  const snapshot = createRuntimeWorkbenchShellReactLifecycleSnapshot();
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  const markup = renderToString(
    <RuntimeWorkbenchShellReactView
      session={session}
      title="Lifecycle Runtime Workbench"
    />,
  );

  assert.match(markup, /Lifecycle Runtime Workbench/u);
  assert.match(markup, /Runtime lifecycle ready/u);
  assert.match(markup, /Sidecar accepted the desktop token/u);
  assert.match(markup, /Start runtime/u);
  assert.match(markup, /Refresh/u);
  assert.match(markup, /Stop tracking/u);
  assert.match(markup, /Lifecycle timeline/u);
  assert.match(markup, /Runtime READY emitted/u);
  assert.match(markup, /Startup complete/u);
  assert.match(markup, /Lifecycle selection/u);
  assert.match(markup, /READY stdout captured/u);
  assert.match(markup, /Select focused/u);
  assert.match(markup, /Clear selection/u);
});

test("renderer runtime workbench React shell toggles task drawer collapse", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactStreamSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Task Drawer Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerExpanded",
        "true",
      ).getAttribute("data-task-drawer-expanded"),
      "true",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Active panel[\s\S]*Stream/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(
          dom.container,
          "Collapse drawer",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerExpanded",
        "false",
      ).getAttribute("data-task-drawer-expanded"),
      "false",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Stream focus, 1 visible, 1 unread/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Expand drawer"),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerExpanded",
        "true",
      ).getAttribute("data-task-drawer-expanded"),
      "true",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Unread[\s\S]*1/u,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell toggles chat box collapse", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactStreamSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Chat Box Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatBoxExpanded",
        "true",
      ).getAttribute("data-chat-box-expanded"),
      "true",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Chat Box[\s\S]*Collapse chat[\s\S]*Send/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Collapse chat"),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatBoxExpanded",
        "false",
      ).getAttribute("data-chat-box-expanded"),
      "false",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Stream focus, chat idle/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Expand chat"),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatBoxExpanded",
        "true",
      ).getAttribute("data-chat-box-expanded"),
      "true",
    );
    assert.match(fakeRuntimeWorkbenchNodeTextContent(dom.container), /Send/u);

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
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
  assert.deepEqual(
    runtimeWorkbenchShellStreamPanelCommandToWorkbenchCommand({
      type: "set_search_query",
      query: "delta",
    }),
    {
      type: "dispatch_runtime_stream",
      command: {
        type: "set_search_query",
        query: "delta",
      },
    },
  );
  assert.deepEqual(
    runtimeWorkbenchShellStreamPanelCommandToWorkbenchCommand({
      type: "toggle_expanded",
      eventId: "evt_react_stream",
    }),
    {
      type: "dispatch_runtime_stream",
      command: {
        type: "toggle_expanded",
        eventId: "evt_react_stream",
      },
    },
  );
  assert.deepEqual(
    runtimeWorkbenchShellLifecyclePanelCommandToWorkbenchCommand(
      "refresh_status",
    ),
    {
      type: "dispatch_lifecycle_panel",
      command: "refresh_status",
    },
  );
});

test("renderer runtime workbench React shell dispatches lifecycle panel buttons", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactLifecycleSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Lifecycle Command Runtime Workbench"
        />,
      );
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Refresh"),
      );
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "dispatch_lifecycle_panel",
      command: "refresh_status",
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Next"),
      );
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "dispatch_lifecycle_panel",
      command: "focus_next_timeline_item",
    });

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell opens loopback SSE and resets full reload", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  const loopback = await createRuntimeWorkbenchLoopbackSseServer();
  const errors: unknown[] = [];
  const runtime = createLoopbackRuntimeBridge({
    base_url: loopback.baseUrl,
    token: "loopback-token",
  });
  const [{ createRoot }, { act }] = await Promise.all([
    import("react-dom/client"),
    import("react"),
  ]);
  const session = createRuntimeWorkbenchShellReactSession({
    runtime,
    eventSourceFactory: createRuntimeFetchEventSourceFactory(),
    onError: (error) => {
      errors.push(error);
    },
  });
  const commands: RuntimeWorkbenchInteractionCommand[] = [];
  const pendingDispatches: Array<ReturnType<typeof session.dispatch>> = [];
  const drainDispatches = async (): Promise<void> => {
    for (;;) {
      const pendingDispatch = pendingDispatches.shift();
      if (pendingDispatch === undefined) {
        return;
      }
      await pendingDispatch;
    }
  };
  const reactSession = {
    ...session,
    dispatch: async (command: RuntimeWorkbenchInteractionCommand) => {
      commands.push(command);
      const pendingDispatch = session.dispatch(command);
      pendingDispatches.push(pendingDispatch);
      return pendingDispatch;
    },
  };
  const root = createRoot(dom.container as unknown as Element);

  try {
    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          defaultRuntimeStreamOptionsFormState={{
            categories: ["model", "system"],
            displayLevel: "default",
            projectId: "project_live",
            runId: "run_live_smoke",
          }}
          runtimeStreamSessionOptions={{
            channel: { kind: "run", runId: "run_live_smoke" },
            filters: { level: "default", category: ["model", "system"] },
            projectId: "project_live",
            scheduler: createImmediateRuntimeStreamScheduler(),
          }}
          session={reactSession}
          title="Live Smoke Runtime Workbench"
        />,
      );
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "actionId",
          "open_runtime_stream_session",
        ),
      );
      await drainDispatches();
    });

    await act(async () => {
      await waitFor(() => session.getSnapshot().activePanel === "stream");
      await waitFor(() => loopback.requests.length >= 1);
      await waitFor(
        () =>
          requireRuntimeStreamPanel(session.getSnapshot()).timelineItems[0]
            ?.id === "evt_live_model",
      );
    });
    assert.equal(session.getSnapshot().runtimeStreamStatus, "active");
    assert.equal(
      loopback.requests[0]?.url,
      "/cw/v1/runs/run_live_smoke/stream?level=default&category=model%2Csystem",
    );
    assert.equal(
      loopback.requests[0]?.headers.authorization,
      "Bearer loopback-token",
    );
    assert.equal(loopback.requests[0]?.headers.accept, "text/event-stream");
    assert.equal(loopback.requests[0]?.headers["x-project-id"], "project_live");
    assert.equal(
      loopback.requests[0]?.headers["x-cw-client"],
      "electron-renderer",
    );
    assert.equal(loopback.requests[0]?.headers["last-event-id"], undefined);

    let panel = requireRuntimeStreamPanel(session.getSnapshot());
    assert.equal(panel.status, "running");
    assert.equal(panel.totalEvents, 1);
    assert.equal(panel.timelineItems[0]?.title, "Live model response");
    assert.equal(panel.read.unreadCount, 1);

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByInputType(dom.container, "search"),
        "live",
      );
      assert.deepEqual(commands.at(-1), {
        type: "dispatch_runtime_stream",
        command: { type: "set_search_query", query: "live" },
      });
      await drainDispatches();
      await waitFor(
        () =>
          requireRuntimeStreamPanel(session.getSnapshot()).search.matchCount ===
          1,
      );
    });
    panel = requireRuntimeStreamPanel(session.getSnapshot());
    assert.equal(panel.search.matchCount, 1);
    assert.equal(panel.search.activeEventId, "evt_live_model");

    await act(async () => {
      await waitFor(
        () =>
          !requireFakeRuntimeWorkbenchButtonByText(
            dom.container,
            "Select match",
          ).disabled,
      );
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Select match"),
      );
      await drainDispatches();
    });
    await waitFor(
      () =>
        requireRuntimeStreamPanel(session.getSnapshot()).selectedEvent?.id ===
        "evt_live_model",
    );
    panel = requireRuntimeStreamPanel(session.getSnapshot());
    assert.equal(panel.selectedEvent?.id, "evt_live_model");

    await act(async () => {
      await waitFor(
        () =>
          !requireFakeRuntimeWorkbenchButtonByText(dom.container, "Mark read")
            .disabled,
      );
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Mark read"),
      );
      await drainDispatches();
    });
    await waitFor(
      () =>
        requireRuntimeStreamPanel(session.getSnapshot()).read.unreadCount === 0,
    );
    assert.equal(
      requireRuntimeStreamPanel(session.getSnapshot()).read.unreadCount,
      0,
    );

    await act(async () => {
      loopback.closeActiveStream();
      await waitFor(() => loopback.requests.length >= 2);
      await waitFor(
        () =>
          requireRuntimeStreamPanel(session.getSnapshot()).status ===
          "full_reload_required",
      );
    });
    assert.equal(
      loopback.requests[1]?.headers["last-event-id"],
      "evt_live_model",
    );
    panel = requireRuntimeStreamPanel(session.getSnapshot());
    assert.equal(panel.fullReload?.status, 412);
    assert.equal(panel.fullReload?.errorCode, "SE_SSE_REPLAY_NOT_FOUND");

    await act(async () => {
      await waitFor(
        () =>
          !requireFakeRuntimeWorkbenchButtonByText(dom.container, "Acknowledge")
            .disabled,
      );
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchButtonByText(dom.container, "Acknowledge"),
      );
      await drainDispatches();
      await waitFor(
        () =>
          requireRuntimeStreamPanel(session.getSnapshot()).fullReload === null,
      );
      await waitFor(() => loopback.requests.length >= 3);
      await waitFor(
        () =>
          requireRuntimeStreamPanel(session.getSnapshot()).timelineItems[0]
            ?.id === "evt_live_after_reset",
      );
    });
    panel = requireRuntimeStreamPanel(session.getSnapshot());
    assert.equal(panel.fullReload, null);
    assert.equal(loopback.requests[2]?.headers["last-event-id"], undefined);
    panel = requireRuntimeStreamPanel(session.getSnapshot());
    assert.equal(panel.status, "running");
    assert.equal(panel.totalEvents, 1);
    assert.equal(panel.timelineItems[0]?.title, "Live model after reset");
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => {
      root.unmount();
    });
    session.dispose();
    await loopback.close();
    dom.restore();
  }
});

test("renderer runtime workbench React shell builds run stream options from form state", () => {
  const state = createRuntimeWorkbenchShellReactStreamOptionsFormState({
    categories: ["model", "tool", "model", "planning"],
    displayLevel: "detailed",
    projectId: " project_alpha ",
    runId: " run_stream_1 ",
    sinceSeq: "7",
    untilSeq: "11",
  });

  assert.deepEqual(buildRuntimeWorkbenchShellReactStreamSessionOptions(state), {
    channel: { kind: "run", runId: "run_stream_1" },
    projectId: "project_alpha",
    filters: {
      level: "detailed",
      category: ["model", "tool"],
      sinceSeq: 7,
      untilSeq: 11,
    },
  });
});

test("renderer runtime workbench React shell builds planning stream options from form state", () => {
  const state = createRuntimeWorkbenchShellReactStreamOptionsFormState({
    categories: ["planning", "system", "model"],
    channelKind: "planning",
    displayLevel: "minimal",
    planningSessionId: "ps_stream_1",
  });

  assert.deepEqual(buildRuntimeWorkbenchShellReactStreamSessionOptions(state), {
    channel: { kind: "planning", sessionId: "ps_stream_1" },
    filters: {
      level: "minimal",
      category: ["planning", "system"],
    },
  });
});

test("renderer runtime workbench React shell rejects incomplete or unsafe stream options", () => {
  assert.equal(
    buildRuntimeWorkbenchShellReactStreamSessionOptions(
      createRuntimeWorkbenchShellReactStreamOptionsFormState(),
    ),
    null,
  );
  assert.equal(
    buildRuntimeWorkbenchShellReactStreamSessionOptions(
      createRuntimeWorkbenchShellReactStreamOptionsFormState({
        runId: "run/unsafe",
      }),
    ),
    null,
  );
  assert.equal(
    buildRuntimeWorkbenchShellReactStreamSessionOptions(
      createRuntimeWorkbenchShellReactStreamOptionsFormState({
        projectId: "project\r\ninjected",
        runId: "run_safe",
      }),
    ),
    null,
  );
  assert.equal(
    buildRuntimeWorkbenchShellReactStreamSessionOptions(
      createRuntimeWorkbenchShellReactStreamOptionsFormState({
        runId: "run_safe",
        sinceSeq: "12",
        untilSeq: "3",
      }),
    ),
    null,
  );
});

interface RuntimeWorkbenchLoopbackSseRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

interface RuntimeWorkbenchLoopbackSseServer {
  readonly baseUrl: string;
  readonly requests: RuntimeWorkbenchLoopbackSseRequest[];
  readonly closeActiveStream: () => void;
  readonly close: () => Promise<void>;
}

async function createRuntimeWorkbenchLoopbackSseServer(): Promise<RuntimeWorkbenchLoopbackSseServer> {
  const requests: RuntimeWorkbenchLoopbackSseRequest[] = [];
  let activeStreamResponse: ServerResponse | null = null;
  let acceptedStreamCount = 0;

  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      requests.push({
        url: request.url ?? "",
        headers: {
          accept: request.headers.accept,
          authorization: request.headers.authorization,
          "last-event-id": firstRequestHeaderValue(
            request.headers["last-event-id"],
          ),
          "x-cw-client": firstRequestHeaderValue(
            request.headers["x-cw-client"],
          ),
          "x-project-id": firstRequestHeaderValue(
            request.headers["x-project-id"],
          ),
        },
      });

      if (!request.url?.startsWith("/cw/v1/runs/run_live_smoke/stream")) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error_code: "RES_NOT_FOUND" }));
        return;
      }

      if (request.headers["last-event-id"] === "evt_live_model") {
        response.writeHead(412, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            schema_version: "0.1.0",
            error_code: "SE_SSE_REPLAY_NOT_FOUND",
            message: "Replay point expired",
          }),
        );
        return;
      }

      acceptedStreamCount += 1;
      response.writeHead(200, {
        "cache-control": "no-cache",
        "content-type": "text/event-stream; charset=utf-8",
      });
      activeStreamResponse = response;
      response.on("close", () => {
        if (activeStreamResponse === response) {
          activeStreamResponse = null;
        }
      });
      const event =
        acceptedStreamCount === 1
          ? createRuntimeWorkbenchLoopbackStreamEvent({
              content: "live streamed content",
              eventId: "evt_live_model",
              seq: 1,
              title: "Live model response",
            })
          : createRuntimeWorkbenchLoopbackStreamEvent({
              content: "content after reset",
              eventId: "evt_live_after_reset",
              seq: 1,
              title: "Live model after reset",
            });
      response.write(encodeRuntimeWorkbenchLoopbackSseFrame(event));
    },
  );

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) {
    throw new Error("Loopback SSE test server did not bind an address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/cw/v1`,
    requests,
    closeActiveStream: () => {
      activeStreamResponse?.end();
      activeStreamResponse = null;
    },
    close: async () => {
      activeStreamResponse?.end();
      activeStreamResponse = null;
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function createRuntimeWorkbenchLoopbackStreamEvent(options: {
  readonly eventId: string;
  readonly seq: number;
  readonly title: string;
  readonly content: string;
}): Record<string, unknown> {
  return {
    event_id: options.eventId,
    schema_version: "0.1.0",
    seq: options.seq,
    parent_event_id: null,
    correlation_id: null,
    run_id: "run_live_smoke",
    node_id: null,
    attempt_id: null,
    type: "model.text_delta",
    category: "model",
    phase: "attempt.streaming",
    title: options.title,
    summary: null,
    content: options.content,
    payload: { delta_text: options.content },
    artifact_refs: [],
    display_level: "default",
    severity: "info",
    sensitivity: "project",
    expandable: true,
    created_at: "2026-06-23T00:00:00.000Z",
    metadata: {},
  };
}

function firstRequestHeaderValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function encodeRuntimeWorkbenchLoopbackSseFrame(
  event: Readonly<Record<string, unknown>>,
): string {
  return [
    `id: ${String(event.event_id)}`,
    `event: ${String(event.type)}`,
    "retry: 3000",
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}

function createLoopbackRuntimeBridge(
  connectionInfo: RuntimeConnectionInfo,
): RuntimeBridge {
  const noopSubscribe = (): RuntimeStatusUnsubscribe => () => false;
  return {
    startupStatus: async () => [],
    onStartupStatus: noopSubscribe,
    shutdownStatus: async () => [],
    onShutdownStatus: noopSubscribe,
    connectionInfo: async () => connectionInfo,
    fetch: async () => {
      throw new Error("Loopback stream smoke does not use runtime.fetch");
    },
  };
}

function createImmediateRuntimeStreamScheduler(): RuntimeStreamReconnectScheduler {
  return (_delayMs, reconnect) => {
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      active = false;
      reconnect();
    });
    return {
      cancel: () => {
        if (!active) {
          return false;
        }
        active = false;
        return true;
      },
    };
  };
}

function requireRuntimeStreamPanel(
  snapshot: RuntimeWorkbenchShellSnapshot,
): NonNullable<RuntimeWorkbenchShellSnapshot["runtimeStreamPanel"]> {
  const panel = snapshot.runtimeStreamPanel;
  if (panel === null) {
    throw new Error("Expected active runtime stream panel");
  }
  return panel;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function createRuntimeWorkbenchShellReactSnapshot(): RuntimeWorkbenchShellSnapshot {
  return buildRuntimeWorkbenchShellSnapshot({
    activePanel: "lifecycle",
    lifecyclePanel: Object.freeze({
      active: false,
      disposed: false,
      activeSession: null,
    }),
    runtimeStream: Object.freeze({
      active: false,
      activeChannel: null,
      disposed: false,
    }),
    runtimeStreamPanel: null,
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

function createRuntimeWorkbenchShellReactStreamSnapshot(): RuntimeWorkbenchShellSnapshot {
  return buildRuntimeWorkbenchShellSnapshot({
    activePanel: "stream",
    lifecyclePanel: Object.freeze({
      active: false,
      disposed: false,
      activeSession: null,
    }),
    runtimeStream: Object.freeze({
      active: true,
      activeChannel: { kind: "run", runId: "run_react_stream" } as const,
      disposed: false,
    }),
    runtimeStreamPanel: Object.freeze({
      status: "full_reload_required",
      totalEvents: 3,
      bufferedEventCount: 3,
      matchingEventCount: 1,
      visibleEventCount: 1,
      hiddenEventCount: 2,
      foldedChildCount: 0,
      read: Object.freeze({
        lastSeenTotalEvents: 2,
        unreadCount: 1,
      }),
      search: Object.freeze({
        query: "delta",
        matchCount: 1,
        activeMatchIndex: 0,
        activeEventId: "evt_react_stream",
      }),
      summaryItems: Object.freeze([]),
      timelineItems: Object.freeze([
        Object.freeze({
          id: "evt_react_stream",
          seq: 7,
          type: "model.text_delta",
          category: "model",
          displayLevel: "default",
          severity: "info",
          title: "Model delta",
          summary: "delta summary",
          content: "delta content",
          expandable: true,
          expanded: false,
          childCount: 0,
          children: Object.freeze([]),
          createdAt: "2026-06-22T02:00:00.000Z",
        }),
      ]),
      selectedEvent: Object.freeze({
        id: "evt_react_stream",
        seq: 7,
        type: "model.text_delta",
        category: "model",
        displayLevel: "default",
        severity: "info",
        title: "Model delta",
        summary: "delta summary",
        content: "delta content",
        expandable: true,
        expanded: false,
        childCount: 0,
        children: Object.freeze([]),
        createdAt: "2026-06-22T02:00:00.000Z",
      }),
      fullReload: Object.freeze({
        acknowledged: false,
        lastEventId: "evt_old",
        reason: "Replay point expired",
        status: 412,
        errorCode: "SE_SSE_REPLAY_NOT_FOUND",
      }),
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

function createRuntimeWorkbenchShellReactLifecycleSnapshot(): RuntimeWorkbenchShellSnapshot {
  return buildRuntimeWorkbenchShellSnapshot({
    activePanel: "lifecycle",
    lifecyclePanel: Object.freeze({
      active: true,
      disposed: false,
      activeSession: createRuntimeWorkbenchShellReactLifecycleSessionSnapshot(),
    }),
    runtimeStream: Object.freeze({
      active: false,
      activeChannel: null,
      disposed: false,
    }),
    runtimeStreamPanel: null,
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

function createRuntimeWorkbenchShellReactLifecycleSessionSnapshot(): RuntimeLifecyclePanelSessionSnapshot {
  const timelineItems = Object.freeze([
    Object.freeze({
      id: "startup:0:runtime_ready",
      source: "startup",
      sourceLabel: "Startup",
      kind: "runtime_ready",
      phase: "ready",
      tone: "success",
      statusLabel: "Ready",
      title: "Runtime READY emitted",
      summary: "READY stdout captured",
      badges: Object.freeze(["startup", "complete"] as const),
    }),
    Object.freeze({
      id: "startup:1:startup_complete",
      source: "startup",
      sourceLabel: "Startup",
      kind: "startup_complete",
      phase: "ready",
      tone: "success",
      statusLabel: "Ready",
      title: "Startup complete",
      summary: "Sidecar accepted the desktop token",
      badges: Object.freeze(["startup", "complete"] as const),
    }),
  ] satisfies RuntimeLifecyclePanelSessionSnapshot["interaction"]["view"]["visibleTimelineItems"]);
  const selectedTimelineItem = timelineItems[0] ?? null;
  return Object.freeze({
    disposed: false,
    interaction: Object.freeze({
      view: Object.freeze({
        panel: Object.freeze({
          readiness: "ready",
          tone: "success",
          statusLabel: "Ready",
          title: "Runtime lifecycle ready",
          summary: "Sidecar accepted the desktop token",
          runtimeReady: true,
          busy: false,
          terminal: false,
          lifecycleComplete: true,
          userActionRequired: false,
          retryable: false,
          startupTotal: 2,
          shutdownTotal: 0,
          started: true,
          disposed: false,
          ariaLive: "polite",
          primaryCommand: Object.freeze({
            id: "start_runtime",
            role: "primary",
            label: "Start runtime",
            title: "Start runtime lifecycle tracking.",
            enabled: true,
            busy: false,
            tone: "accent",
          }),
          secondaryCommands: Object.freeze([
            Object.freeze({
              id: "refresh_status",
              role: "secondary",
              label: "Refresh",
              title: "Refresh runtime lifecycle status.",
              enabled: true,
              busy: false,
              tone: "neutral",
            }),
            Object.freeze({
              id: "stop_runtime",
              role: "secondary",
              label: "Stop tracking",
              title: "Stop runtime lifecycle tracking.",
              enabled: true,
              busy: false,
              tone: "neutral",
            }),
          ]),
          timelineItems,
          emptyState: null,
        }),
        disposed: false,
        timelineFilter: "all",
        timelineFilterOptions: Object.freeze([
          Object.freeze({
            id: "all",
            label: "All",
            count: 2,
            active: true,
          }),
          Object.freeze({
            id: "startup",
            label: "Startup",
            count: 2,
            active: false,
          }),
          Object.freeze({
            id: "shutdown",
            label: "Shutdown",
            count: 0,
            active: false,
          }),
          Object.freeze({
            id: "action_required",
            label: "Action required",
            count: 0,
            active: false,
          }),
          Object.freeze({
            id: "retryable",
            label: "Retryable",
            count: 0,
            active: false,
          }),
          Object.freeze({
            id: "error",
            label: "Errors",
            count: 0,
            active: false,
          }),
        ]),
        visibleTimelineItems: timelineItems,
        selectedTimelineItemId: selectedTimelineItem?.id ?? null,
        selectedTimelineItem,
        totalTimelineItems: 2,
        visibleTimelineItemCount: 2,
        hiddenTimelineItemCount: 0,
      }),
      disposed: false,
      focusTarget: "timeline_item",
      focusedCommandId: "start_runtime",
      focusedTimelineItemId: "startup:0:runtime_ready",
      availableCommandIds: Object.freeze([
        "start_runtime",
        "refresh_status",
        "stop_runtime",
      ] as const),
      enabledCommandIds: Object.freeze([
        "start_runtime",
        "refresh_status",
        "stop_runtime",
      ] as const),
      canActivateFocusedCommand: true,
      canSelectFocusedTimelineItem: true,
    }),
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
  readonly dispatchedCommands: () => readonly RuntimeWorkbenchInteractionCommand[];
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
    dispatchedCommands: () => [...commands],
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
  | "HTMLInputElement"
  | "HTMLElement"
  | "HTMLButtonElement"
  | "Node"
  | "SVGElement"
  | "window"
  | "IS_REACT_ACT_ENVIRONMENT";

type RuntimeWorkbenchReactDomGlobalObject = typeof globalThis & {
  document?: unknown;
  Element?: unknown;
  HTMLInputElement?: unknown;
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
    if (event.target === null) {
      setFakeRuntimeWorkbenchEventProperty(event, "target", this);
    }
    setFakeRuntimeWorkbenchEventProperty(event, "currentTarget", this);
    const listeners = this.eventListeners.get(event.type) ?? new Set();
    for (const listener of listeners) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
    if (event.bubbles && !event.cancelBubble && this.parentNode !== null) {
      return this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }
}

class FakeRuntimeWorkbenchElement extends FakeRuntimeWorkbenchNode {
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly namespaceURI: string;
  readonly style: Record<string, string> = {};
  checked = false;
  className = "";
  disabled = false;
  tagName: string;
  title = "";
  type = "";
  value = "";

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
    if (name === "checked") {
      this.checked = true;
    }
    if (name === "disabled") {
      this.disabled = true;
    }
    if (name === "type") {
      this.type = stringValue;
    }
    if (name === "value") {
      this.value = stringValue;
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
    if (name === "checked") {
      this.checked = false;
    }
    if (name === "disabled") {
      this.disabled = false;
    }
    if (name === "type") {
      this.type = "";
    }
    if (name === "value") {
      this.value = "";
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
  onchange: EventListener | null = null;
  oninput: EventListener | null = null;

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
    HTMLInputElement: FakeRuntimeWorkbenchElement,
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
    "HTMLInputElement",
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
    HTMLInputElement: {
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

function clickFakeRuntimeWorkbenchElement(
  element: FakeRuntimeWorkbenchElement,
): void {
  assert.equal(element.disabled, false);
  element.dispatchEvent(
    new Event("click", { bubbles: true, cancelable: true }),
  );
}

function inputFakeRuntimeWorkbenchElement(
  element: FakeRuntimeWorkbenchElement,
  value: string,
): void {
  assert.equal(element.disabled, false);
  element.value = value;
  callFakeRuntimeWorkbenchReactInputOnChange(element);
}

function requireFakeRuntimeWorkbenchElementByData(
  root: FakeRuntimeWorkbenchNode,
  dataKey: string,
  value: string,
): FakeRuntimeWorkbenchElement {
  return requireFakeRuntimeWorkbenchElement(
    root,
    (element) => element.dataset[dataKey] === value,
    `data-${dataKey}=${value}`,
  );
}

function requireFakeRuntimeWorkbenchElementByInputType(
  root: FakeRuntimeWorkbenchNode,
  type: string,
): FakeRuntimeWorkbenchElement {
  return requireFakeRuntimeWorkbenchElement(
    root,
    (element) => element.tagName === "INPUT" && element.type === type,
    `input[type=${type}]`,
  );
}

function requireFakeRuntimeWorkbenchButtonByText(
  root: FakeRuntimeWorkbenchNode,
  text: string,
): FakeRuntimeWorkbenchElement {
  return requireFakeRuntimeWorkbenchElement(
    root,
    (element) =>
      element.tagName === "BUTTON" &&
      fakeRuntimeWorkbenchNodeTextContent(element).trim() === text,
    `button text ${text}`,
  );
}

function requireFakeRuntimeWorkbenchElement(
  root: FakeRuntimeWorkbenchNode,
  predicate: (element: FakeRuntimeWorkbenchElement) => boolean,
  label: string,
): FakeRuntimeWorkbenchElement {
  const found = findFakeRuntimeWorkbenchElement(root, predicate);
  if (found === null) {
    throw new Error(`Expected fake DOM element for ${label}`);
  }
  return found;
}

function findFakeRuntimeWorkbenchElement(
  root: FakeRuntimeWorkbenchNode,
  predicate: (element: FakeRuntimeWorkbenchElement) => boolean,
): FakeRuntimeWorkbenchElement | null {
  if (root instanceof FakeRuntimeWorkbenchElement && predicate(root)) {
    return root;
  }
  for (const child of root.childNodes) {
    const found = findFakeRuntimeWorkbenchElement(child, predicate);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function fakeRuntimeWorkbenchNodeTextContent(
  root: FakeRuntimeWorkbenchNode,
): string {
  if (root.nodeType === 3) {
    return root.nodeValue ?? "";
  }
  if (root.childNodes.length === 0) {
    return root.textContent;
  }
  return root.childNodes.map(fakeRuntimeWorkbenchNodeTextContent).join("");
}

function setFakeRuntimeWorkbenchEventProperty(
  event: Event,
  name: "currentTarget" | "target",
  value: FakeRuntimeWorkbenchNode | null,
): void {
  Object.defineProperty(event, name, {
    configurable: true,
    value,
  });
}

function callFakeRuntimeWorkbenchReactInputOnChange(
  element: FakeRuntimeWorkbenchElement,
): void {
  const props = getFakeRuntimeWorkbenchReactProps(element);
  const onChange = props.onChange;
  if (typeof onChange !== "function") {
    throw new Error("Expected fake DOM input to expose a React onChange prop");
  }
  const handleChange = onChange as (event: {
    readonly currentTarget: FakeRuntimeWorkbenchElement;
  }) => void;
  handleChange({ currentTarget: element });
}

function getFakeRuntimeWorkbenchReactProps(
  element: FakeRuntimeWorkbenchElement,
): Record<string, unknown> {
  const reactPropsKey = Object.getOwnPropertyNames(element).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (reactPropsKey === undefined) {
    throw new Error("Expected fake DOM element to expose React props");
  }
  const props = (element as unknown as Record<string, unknown>)[reactPropsKey];
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    throw new Error("Expected fake DOM React props to be an object");
  }
  return props as Record<string, unknown>;
}
