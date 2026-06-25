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
  RuntimeRequestInit,
  RuntimeRequestPath,
  RuntimeResponse,
  RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import type { RuntimeLifecyclePanelSessionSnapshot } from "./runtime-lifecycle-panel-session.js";
import type { RuntimeLifecyclePanelSessionController } from "./runtime-lifecycle-panel-session.js";
import type { RuntimeStreamReconnectScheduler } from "./runtime-stream-client.js";
import { createRuntimeFetchEventSourceFactory } from "./runtime-stream-fetch-event-source.js";
import type {
  RuntimeStreamInteractionSessionController,
  RuntimeStreamInteractionSessionControllerListener,
} from "./runtime-stream-session.js";
import { DEFAULT_RUNTIME_WORKBENCH_SHORTCUT_BINDINGS } from "./runtime-workbench-shortcuts.js";
import type { RuntimeWorkbenchShortcutKeyEvent } from "./runtime-workbench-shortcuts.js";
import {
  RUNTIME_WORKBENCH_INTERACTION_COMMAND_IDS,
  type RuntimeWorkbenchInteractionCommand,
} from "./runtime-workbench-interaction.js";
import {
  createRuntimeWorkbenchSession,
  type RuntimeWorkbenchExecutionMode,
  type RuntimeWorkbenchPanelId,
} from "./runtime-workbench-session.js";
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
  createRuntimeWorkbenchShellReactProjectCreationFormState,
  createRuntimeWorkbenchShellReactReferenceImportFormState,
  createRuntimeWorkbenchShellReactSkillManagementFormState,
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
  assert.match(markup, /Execution mode/u);
  assert.match(markup, /Step/u);
  assert.match(markup, /Semi-auto/u);
  assert.match(markup, /Auto/u);
  assert.match(markup, /Reference management/u);
  assert.match(markup, /Auto chunk/u);
  assert.match(markup, /File Tree/u);
  assert.match(markup, /Accepted specs/u);
  assert.match(markup, /Status[\s\S]*Open[\s\S]*Path[\s\S]*workspace root/u);
  assert.match(markup, /Version Snapshots/u);
  assert.match(markup, /Git snapshot/u);
  assert.match(markup, /Version snapshot selection details/u);
  assert.match(markup, /Workflow Canvas/u);
  assert.match(markup, /Review result/u);
  assert.match(markup, /repair_task/u);
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

test("renderer runtime workbench React shell folds and labels unknown stream event types", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot =
      createRuntimeWorkbenchShellReactUnknownStreamEventSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Unknown Stream Event Runtime Workbench"
        />,
      );
    });

    const unknownEvent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamEventKnownType",
      "false",
    );
    assert.equal(
      unknownEvent.getAttribute("data-stream-event-expanded"),
      "false",
    );
    assert.match(
      unknownEvent.getAttribute("class") ?? "",
      /cw-workbench__stream-event--unknown-type/u,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(unknownEvent),
      /Experimental adapter event[\s\S]*adapter\.experimental_event[\s\S]*Unknown event/u,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        unknownEvent,
        (element) => element.dataset.streamEventDetail === "true",
      ),
      0,
    );

    const selectedEvent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamSelectedEventKnownType",
      "false",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-type"),
      "adapter.experimental_event",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        selectedEvent,
        "streamSelectedEventTypeStatus",
        "unknown",
      ).textContent,
      "Unknown event",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-payload-present"),
      "yes",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-payload-kind"),
      "object",
    );
    assert.equal(
      selectedEvent.getAttribute(
        "data-stream-selected-event-payload-key-count",
      ),
      "1",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(selectedEvent),
      /Type status[\s\S]*Unknown event type[\s\S]*Payload[\s\S]*object \(1 key\)/u,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(selectedEvent),
      /secret_payload_value|payload_token/u,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell renders expanded stream event detail", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot =
      createRuntimeWorkbenchShellReactExpandedStreamEventSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Stream Event Detail Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventExpanded",
        "true",
      ).getAttribute("data-stream-event-parent-id"),
      "evt_react_parent",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventId",
        "evt_react_stream",
      ).textContent,
      "Select",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamEventDetail === "true",
      ),
      1,
    );
    const detail = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamEventDetail",
      "true",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-parent-id"),
      "evt_react_parent",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-child-count"),
      "0",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-artifact-count"),
      "1",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-event-id"),
      "evt_react_stream",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-type"),
      "model.text_delta",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-title"),
      "Model delta",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-summary"),
      "delta summary",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-expandable"),
      "yes",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-payload-present"),
      "yes",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-payload-kind"),
      "object",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-payload-key-count"),
      "1",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-metadata-present"),
      "yes",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-metadata-kind"),
      "object",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-metadata-key-count"),
      "2",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-schema-version"),
      "0.1.0",
    );
    assert.equal(detail.getAttribute("data-stream-event-detail-seq"), "7");
    assert.equal(
      detail.getAttribute("data-stream-event-detail-created-at"),
      "2026-06-22T02:00:00.000Z",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-category"),
      "model",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-display-level"),
      "default",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-severity"),
      "info",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-run-id"),
      "run_react_stream",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-node-id"),
      "node_react_model",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-attempt-id"),
      "attempt_react_stream",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-correlation-id"),
      "trace_react_stream",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-phase"),
      "attempt.streaming",
    );
    assert.equal(
      detail.getAttribute("data-stream-event-detail-sensitivity"),
      "project",
    );
    const eventArtifact = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamArtifactRef",
      "event-detail",
    );
    assert.equal(
      eventArtifact.getAttribute("data-stream-artifact-ref-id"),
      "artifact_react_report",
    );
    assert.equal(
      eventArtifact.getAttribute("data-stream-artifact-ref-kind"),
      "file",
    );
    assert.equal(
      eventArtifact.getAttribute("data-stream-artifact-ref-path"),
      "artifacts/report.md",
    );
    const detailContent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamContent",
      "event-detail",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-heading-count"),
      "1",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-list-count"),
      "1",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-code-block-count"),
      "1",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-table-count"),
      "1",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-fallback"),
      "false",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-fallback-reason"),
      "none",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-link-count"),
      "1",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-mark-count"),
      "1",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-blocked-html-count"),
      "2",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-blocked-image-count"),
      "1",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-blocked-link-count"),
      "1",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        detailContent,
        (element) => element.tagName === "SCRIPT" || element.tagName === "IMG",
      ),
      0,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElement(
        detailContent,
        (element) => element.tagName === "A",
        "stream detail markdown link",
      ).getAttribute("href"),
      "/artifacts/report.md",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        detailContent,
        (element) => element.tagName === "MARK",
      ),
      1,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(detailContent),
      /javascript:|example\.invalid/u,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(detail),
      /delta content[\s\S]*inline_code[\s\S]*marked token[\s\S]*trusted link[\s\S]*blocked link[\s\S]*blocked image[\s\S]*Markdown detail[\s\S]*first item[\s\S]*Metric[\s\S]*Value[\s\S]*const result = "ok";[\s\S]*Artifact refs[\s\S]*Report draft[\s\S]*File[\s\S]*artifacts\/report\.md[\s\S]*text\/markdown[\s\S]*128 bytes[\s\S]*Report preview[\s\S]*Event ID[\s\S]*evt_react_stream[\s\S]*Type[\s\S]*model\.text_delta[\s\S]*Title[\s\S]*Model delta[\s\S]*Summary[\s\S]*delta summary[\s\S]*Expandable[\s\S]*yes[\s\S]*Payload[\s\S]*object \(1 key\)[\s\S]*Metadata[\s\S]*object \(2 keys\)[\s\S]*Schema[\s\S]*0\.1\.0[\s\S]*Seq[\s\S]*7[\s\S]*Created[\s\S]*2026-06-22T02:00:00\.000Z[\s\S]*Category[\s\S]*model[\s\S]*Display level[\s\S]*default[\s\S]*Severity[\s\S]*info[\s\S]*Run[\s\S]*run_react_stream[\s\S]*Node[\s\S]*node_react_model[\s\S]*Attempt[\s\S]*attempt_react_stream[\s\S]*Correlation[\s\S]*trace_react_stream[\s\S]*Phase[\s\S]*attempt\.streaming[\s\S]*Sensitivity[\s\S]*Project[\s\S]*Parent event[\s\S]*evt_react_parent[\s\S]*Child count[\s\S]*0/u,
    );
    const selectedEvent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamSelectedEvent",
      "true",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-artifact-count"),
      "1",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-id"),
      "evt_react_stream",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-type"),
      "model.text_delta",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-title"),
      "Model delta",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-summary"),
      "delta summary",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-expandable"),
      "yes",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-payload-present"),
      "yes",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-payload-kind"),
      "object",
    );
    assert.equal(
      selectedEvent.getAttribute(
        "data-stream-selected-event-payload-key-count",
      ),
      "1",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-metadata-present"),
      "yes",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-metadata-kind"),
      "object",
    );
    assert.equal(
      selectedEvent.getAttribute(
        "data-stream-selected-event-metadata-key-count",
      ),
      "2",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-schema-version"),
      "0.1.0",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-seq"),
      "7",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-created-at"),
      "2026-06-22T02:00:00.000Z",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-category"),
      "model",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-display-level"),
      "default",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-severity"),
      "info",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-run-id"),
      "run_react_stream",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-node-id"),
      "node_react_model",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-attempt-id"),
      "attempt_react_stream",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-correlation-id"),
      "trace_react_stream",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-phase"),
      "attempt.streaming",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-sensitivity"),
      "project",
    );
    const selectedArtifact = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamArtifactRef",
      "selection",
    );
    assert.equal(
      selectedArtifact.getAttribute("data-stream-artifact-ref-id"),
      "artifact_react_report",
    );
    const selectedContent = requireFakeRuntimeWorkbenchElementByData(
      selectedEvent,
      "streamContent",
      "selection",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-heading-count"),
      "1",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-list-count"),
      "1",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-table-count"),
      "1",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-code-block-count"),
      "1",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-fallback"),
      "false",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-fallback-reason"),
      "none",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-link-count"),
      "1",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-mark-count"),
      "1",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-blocked-html-count"),
      "2",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-blocked-image-count"),
      "1",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-blocked-link-count"),
      "1",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        selectedContent,
        (element) => element.tagName === "SCRIPT" || element.tagName === "IMG",
      ),
      0,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(selectedContent),
      /javascript:|example\.invalid/u,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell falls back to plain text when stream content rendering fails", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const fallbackText =
      "fallback plain text with [trusted link](/blocked) and <script>blocked</script>";
    const snapshot =
      createRuntimeWorkbenchShellReactExpandedStreamEventContentSnapshot(
        createThrowingRuntimeWorkbenchStreamContent(fallbackText),
      );
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Stream Content Fallback Runtime Workbench"
        />,
      );
    });

    const detailContent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamContent",
      "event-detail",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-fallback"),
      "true",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-fallback-reason"),
      "render_failed",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-heading-count"),
      "0",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-link-count"),
      "0",
    );
    assert.equal(
      detailContent.getAttribute("data-stream-content-blocked-html-count"),
      "0",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(detailContent),
      /fallback plain text with \[trusted link\]\(\/blocked\) and <script>blocked<\/script>/u,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        detailContent,
        (element) =>
          element.tagName === "A" ||
          element.tagName === "SCRIPT" ||
          element.tagName === "IMG",
      ),
      0,
    );

    const selectedContent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamContent",
      "selection",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-fallback"),
      "true",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-fallback-reason"),
      "render_failed",
    );
    assert.equal(
      selectedContent.getAttribute("data-stream-content-table-count"),
      "0",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        selectedContent,
        (element) =>
          element.tagName === "A" ||
          element.tagName === "SCRIPT" ||
          element.tagName === "IMG",
      ),
      0,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell toggles stream full reload details locally", async () => {
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
          title="Stream Full Reload Details Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadExpanded",
        "false",
      ).getAttribute("data-stream-full-reload-status"),
      "412",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadExpanded",
        "false",
      ).getAttribute("data-stream-full-reload-last-event-id"),
      "evt_old",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadDetailsToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadAcknowledge",
        "true",
      ).textContent,
      "Acknowledge",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamFullReloadDetails === "true",
      ),
      0,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamFullReloadDetailsToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadExpanded",
        "true",
      ).dataset.streamFullReloadExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadDetailsToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "true",
    );
    const details = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamFullReloadDetails",
      "true",
    );
    assert.equal(
      details.getAttribute("data-stream-full-reload-details-status"),
      "412",
    );
    assert.equal(
      details.getAttribute("data-stream-full-reload-details-error-code"),
      "SE_SSE_REPLAY_NOT_FOUND",
    );
    assert.equal(
      details.getAttribute("data-stream-full-reload-details-last-event-id"),
      "evt_old",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(details),
      /HTTP status[\s\S]*412[\s\S]*Error code[\s\S]*SE_SSE_REPLAY_NOT_FOUND[\s\S]*Last event id[\s\S]*evt_old/u,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsBody",
        "true",
      ).className,
      "cw-workbench__stream-controls-body",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "timeline",
      ).dataset.streamEventGroupExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectedEvent",
        "true",
      ).getAttribute("data-stream-selected-event-id"),
      "evt_react_stream",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamFullReloadDetailsToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadExpanded",
        "false",
      ).dataset.streamFullReloadExpanded,
      "false",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamFullReloadDetails === "true",
      ),
      0,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell toggles stream panel collapse locally", async () => {
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
          title="Stream Collapse Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelExpanded",
        "true",
      ).dataset.streamPanelExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventId",
        "evt_react_stream",
      ).textContent,
      "Select",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamPanelToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelExpanded",
        "false",
      ).dataset.streamPanelExpanded,
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelCollapsedSummary",
        "true",
      ).textContent,
      "Run run_react_stream, 1 visible, 1 unread",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelCollapsedSummary",
        "true",
      ).getAttribute("data-stream-panel-collapsed-visible"),
      "1",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamEventId === "evt_react_stream",
      ),
      0,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.className === "cw-workbench__stream-controls",
      ),
      0,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.className === "cw-workbench__stream-full-reload",
      ),
      0,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamPanelToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelExpanded",
        "true",
      ).dataset.streamPanelExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventId",
        "evt_react_stream",
      ).textContent,
      "Select",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell toggles stream controls locally", async () => {
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
          title="Stream Controls Collapse Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsExpanded",
        "true",
      ).getAttribute("data-stream-controls-query"),
      "delta",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsExpanded",
        "true",
      ).getAttribute("data-stream-controls-matches"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsBody",
        "true",
      ).className,
      "cw-workbench__stream-controls-body",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByInputType(dom.container, "search")
        .value,
      "delta",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamControlsToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsExpanded",
        "false",
      ).getAttribute("data-stream-controls-unread"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamControlsCollapsedSummary",
          "true",
        ),
      ),
      'Search "delta", 1 match, 1 unread',
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsCollapsedSummary",
        "true",
      ).getAttribute("data-stream-controls-collapsed-query"),
      "delta",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsCollapsedSummary",
        "true",
      ).getAttribute("data-stream-controls-collapsed-unread"),
      "1",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamControlsBody === "true",
      ),
      0,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.tagName === "INPUT" && element.type === "search",
      ),
      0,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelExpanded",
        "true",
      ).dataset.streamPanelExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "timeline",
      ).dataset.streamEventGroupExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectedEvent",
        "true",
      ).getAttribute("data-stream-selected-event-id"),
      "evt_react_stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventId",
        "evt_react_stream",
      ).textContent,
      "Select",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamControlsToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsExpanded",
        "true",
      ).dataset.streamControlsExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsBody",
        "true",
      ).className,
      "cw-workbench__stream-controls-body",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell toggles selected stream metadata locally", async () => {
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
          title="Stream Metadata Runtime Workbench"
        />,
      );
    });

    const selectedEvent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamSelectedEvent",
      "true",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-parent-id"),
      "evt_react_parent",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-child-count"),
      "0",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-id"),
      "evt_react_stream",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-type"),
      "model.text_delta",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-title"),
      "Model delta",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-summary"),
      "delta summary",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-expandable"),
      "yes",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-payload-present"),
      "yes",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-payload-kind"),
      "object",
    );
    assert.equal(
      selectedEvent.getAttribute(
        "data-stream-selected-event-payload-key-count",
      ),
      "1",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-metadata-present"),
      "yes",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-metadata-kind"),
      "object",
    );
    assert.equal(
      selectedEvent.getAttribute(
        "data-stream-selected-event-metadata-key-count",
      ),
      "2",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-schema-version"),
      "0.1.0",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-seq"),
      "7",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-created-at"),
      "2026-06-22T02:00:00.000Z",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-category"),
      "model",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-display-level"),
      "default",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-severity"),
      "info",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionMetadataToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamSelectionMetadata === "true",
      ),
      0,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamSelectionMetadataToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionMetadataToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "true",
    );
    const metadata = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamSelectionMetadata",
      "true",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-category"),
      "model",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-event-id"),
      "evt_react_stream",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-type"),
      "model.text_delta",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-title"),
      "Model delta",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-summary"),
      "delta summary",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-payload-present"),
      "yes",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-payload-kind"),
      "object",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-payload-key-count"),
      "1",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-metadata-present"),
      "yes",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-metadata-kind"),
      "object",
    );
    assert.equal(
      metadata.getAttribute(
        "data-stream-selection-metadata-metadata-key-count",
      ),
      "2",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-schema-version"),
      "0.1.0",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-seq"),
      "7",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-created-at"),
      "2026-06-22T02:00:00.000Z",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-run-id"),
      "run_react_stream",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-node-id"),
      "node_react_model",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-attempt-id"),
      "attempt_react_stream",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-correlation-id"),
      "trace_react_stream",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-phase"),
      "attempt.streaming",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-sensitivity"),
      "project",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-display-level"),
      "default",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-severity"),
      "info",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-parent-id"),
      "evt_react_parent",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-child-count"),
      "0",
    );
    assert.equal(
      metadata.getAttribute("data-stream-selection-metadata-expandable"),
      "yes",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(metadata),
      /Event ID[\s\S]*evt_react_stream[\s\S]*Type[\s\S]*model\.text_delta[\s\S]*Title[\s\S]*Model delta[\s\S]*Summary[\s\S]*delta summary[\s\S]*Payload[\s\S]*object \(1 key\)[\s\S]*Metadata[\s\S]*object \(2 keys\)[\s\S]*Schema[\s\S]*0\.1\.0[\s\S]*Seq[\s\S]*7[\s\S]*Created[\s\S]*2026-06-22T02:00:00\.000Z[\s\S]*Category[\s\S]*model[\s\S]*Run[\s\S]*run_react_stream[\s\S]*Node[\s\S]*node_react_model[\s\S]*Attempt[\s\S]*attempt_react_stream[\s\S]*Correlation[\s\S]*trace_react_stream[\s\S]*Phase[\s\S]*attempt\.streaming[\s\S]*Sensitivity[\s\S]*Project[\s\S]*Display level[\s\S]*default[\s\S]*Severity[\s\S]*info[\s\S]*Parent event[\s\S]*evt_react_parent[\s\S]*Child count[\s\S]*0[\s\S]*Expandable[\s\S]*yes/u,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamControlsBody",
        "true",
      ).className,
      "cw-workbench__stream-controls-body",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "timeline",
      ).dataset.streamEventGroupExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamFullReloadExpanded",
        "false",
      ).dataset.streamFullReloadExpanded,
      "false",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamSelectionMetadataToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionMetadataToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamSelectionMetadata === "true",
      ),
      0,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell toggles stream event groups locally", async () => {
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
          title="Stream Group Collapse Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelExpanded",
        "true",
      ).dataset.streamPanelExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "summary",
      ).dataset.streamEventGroupExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "timeline",
      ).dataset.streamEventGroupCount,
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroupToggle",
        "timeline",
      ).getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventId",
        "evt_react_stream",
      ).textContent,
      "Select",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamEventGroupToggle",
          "timeline",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "timeline",
      ).dataset.streamEventGroupExpanded,
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroupToggle",
        "timeline",
      ).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamEventGroupCollapsedSummary",
          "timeline",
        ),
      ),
      "Timeline hidden, 1 event",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroupCollapsedSummary",
        "timeline",
      ).getAttribute("data-stream-event-group-collapsed-count"),
      "1",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamEventId === "evt_react_stream",
      ),
      0,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "summary",
      ).dataset.streamEventGroupExpanded,
      "true",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamEventGroupToggle",
          "timeline",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "timeline",
      ).dataset.streamEventGroupExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventId",
        "evt_react_stream",
      ).textContent,
      "Select",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamEventGroupToggle",
          "summary",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "summary",
      ).dataset.streamEventGroupExpanded,
      "false",
    );
    assert.equal(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamEventGroupCollapsedSummary",
          "summary",
        ),
      ),
      "Summary hidden, 0 events",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroupCollapsedSummary",
        "summary",
      ).getAttribute("data-stream-event-group-collapsed-count"),
      "0",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell toggles stream selection locally", async () => {
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
          title="Stream Selection Collapse Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionExpanded",
        "true",
      ).getAttribute("data-stream-selection-selected-id"),
      "evt_react_stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectedEvent",
        "true",
      ).getAttribute("data-stream-selected-event-id"),
      "evt_react_stream",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamSelectionToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionExpanded",
        "false",
      ).getAttribute("data-stream-selection-selected-id"),
      "evt_react_stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionToggle",
        "true",
      ).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamSelectionCollapsedSummary",
          "true",
        ),
      ),
      "Model delta, model.text_delta",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionCollapsedSummary",
        "true",
      ).getAttribute("data-stream-selection-collapsed-selected-id"),
      "evt_react_stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionCollapsedSummary",
        "true",
      ).getAttribute("data-stream-selection-collapsed-selected-type"),
      "model.text_delta",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.streamSelectedEvent === "true",
      ),
      0,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamPanelExpanded",
        "true",
      ).dataset.streamPanelExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventGroup",
        "timeline",
      ).dataset.streamEventGroupExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamEventId",
        "evt_react_stream",
      ).textContent,
      "Select",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamSelectionToggle",
          "true",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectionExpanded",
        "true",
      ).dataset.streamSelectionExpanded,
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "streamSelectedEvent",
        "true",
      ).getAttribute("data-stream-selected-event-id"),
      "evt_react_stream",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
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

test("renderer runtime workbench React shell selects task drawer item locally", async () => {
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
          title="Task Drawer Selection Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerItemSelected",
        "true",
      ).getAttribute("data-task-drawer-item"),
      "active_panel",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "active_panel",
      ).getAttribute("data-task-drawer-details-value"),
      "Stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "active_panel",
      ).getAttribute("data-task-drawer-details-tone"),
      "neutral",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "taskDrawerItemSelect",
          "unread_events",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerItemSelected",
        "true",
      ).getAttribute("data-task-drawer-item"),
      "unread_events",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "unread_events",
      ).getAttribute("data-task-drawer-details-value"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "unread_events",
      ).getAttribute("data-task-drawer-details-tone"),
      "accent",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "taskDrawerDetails",
          "unread_events",
        ),
      ),
      /Unread[\s\S]*Value[\s\S]*1[\s\S]*Tone[\s\S]*accent/u,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.taskDrawerItemSelected === "true",
      ),
      1,
    );

    await act(async () => {
      keydownFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "taskDrawerItemSelect",
          "visible_items",
        ),
        " ",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerItemSelected",
        "true",
      ).getAttribute("data-task-drawer-item"),
      "visible_items",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "visible_items",
      ).getAttribute("data-task-drawer-details-value"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "visible_items",
      ).getAttribute("data-task-drawer-details-tone"),
      "neutral",
    );

    await act(async () => {
      keydownFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "taskDrawerItemSelect",
          "runtime_stream",
        ),
        "Enter",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerItemSelected",
        "true",
      ).getAttribute("data-task-drawer-item"),
      "runtime_stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "runtime_stream",
      ).getAttribute("data-task-drawer-details-value"),
      "Run run_react_stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "taskDrawerDetails",
        "runtime_stream",
      ).getAttribute("data-task-drawer-details-tone"),
      "success",
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

    const expandChatButton = requireFakeRuntimeWorkbenchButtonByText(
      dom.container,
      "Expand chat",
    );
    expandChatButton.focus();
    assert.equal(dom.container.ownerDocument?.activeElement, expandChatButton);
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(expandChatButton);
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
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftInput",
        "true",
      ),
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell drafts chat box text locally", async () => {
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
          title="Chat Draft Runtime Workbench"
        />,
      );
    });

    const chatDraftInput = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftInput",
      "true",
    );
    assert.equal(chatDraftInput.disabled, false);
    assert.equal(chatDraftInput.value, "");
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-length"),
      "0",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-words"),
      "0",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-enabled"),
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-reason"),
      "empty_draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "ask",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftIntent",
        "ask",
      ).getAttribute("data-chat-draft-intent-active"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftClear",
        "true",
      ).getAttribute("data-chat-draft-clear-disabled"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).getAttribute("data-chat-send-disabled"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).getAttribute("data-chat-send-reason"),
      "empty_draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).getAttribute("aria-describedby"),
      "cw-workbench-chat-send-guard",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).getAttribute("data-chat-send-guard-enabled"),
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).getAttribute("data-chat-send-guard-reason"),
      "empty_draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).textContent,
      "Send unavailable: Draft is empty",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-state"),
      "empty",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-reason"),
      "empty_draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-ready"),
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-target"),
      "workflow",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-action"),
      "question",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftPreview",
          "true",
        ),
      ),
      /Preview[\s\S]*Empty[\s\S]*No draft text[\s\S]*Intent[\s\S]*Ask[\s\S]*Target[\s\S]*Current workflow[\s\S]*Action[\s\S]*Question[\s\S]*Reason[\s\S]*Draft is empty/u,
    );

    const invalidIntentButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftIntent",
      "ask",
    );
    invalidIntentButton.setAttribute("data-chat-draft-intent", "malformed");
    invalidIntentButton.focus();
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      invalidIntentButton,
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(invalidIntentButton);
    });
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      invalidIntentButton,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "ask",
    );
    invalidIntentButton.setAttribute("data-chat-draft-intent", "ask");

    const reviseIntentButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftIntent",
      "revise",
    );
    reviseIntentButton.focus();
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      reviseIntentButton,
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(reviseIntentButton);
    });

    assert.equal(dom.container.ownerDocument?.activeElement, chatDraftInput);
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "revise",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent-label"),
      "Revise",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-target"),
      "draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-action"),
      "change_request",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftPreview",
          "true",
        ),
      ),
      /Target[\s\S]*Workflow draft[\s\S]*Action[\s\S]*Change request/u,
    );

    const repairIntentButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftIntent",
      "repair",
    );
    repairIntentButton.focus();
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      repairIntentButton,
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(repairIntentButton);
    });

    assert.equal(dom.container.ownerDocument?.activeElement, chatDraftInput);
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "repair",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent-label"),
      "Repair",
    );

    const askIntentButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftIntent",
      "ask",
    );
    askIntentButton.focus();
    assert.equal(dom.container.ownerDocument?.activeElement, askIntentButton);
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(askIntentButton);
    });

    assert.equal(dom.container.ownerDocument?.activeElement, chatDraftInput);
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "ask",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-target"),
      "workflow",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-action"),
      "question",
    );

    const restoredRepairIntentButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftIntent",
      "repair",
    );
    restoredRepairIntentButton.focus();
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      restoredRepairIntentButton,
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(restoredRepairIntentButton);
    });
    assert.equal(dom.container.ownerDocument?.activeElement, chatDraftInput);
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "repair",
    );

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(
        chatDraftInput,
        "Review repair plan now",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-length"),
      "22",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-words"),
      "4",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-status"),
      "Idle",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftDetails",
          "true",
        ),
      ),
      /Draft[\s\S]*Characters[\s\S]*22[\s\S]*Words[\s\S]*4[\s\S]*Status[\s\S]*Idle[\s\S]*Intent[\s\S]*Repair/u,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftClear",
        "true",
      ).getAttribute("data-chat-draft-clear-disabled"),
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).getAttribute("data-chat-send-disabled"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).getAttribute("data-chat-send-reason"),
      "chat_disabled",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-reason"),
      "chat_disabled",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).textContent,
      "Send unavailable: Chat disabled",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-state"),
      "blocked",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-reason"),
      "chat_disabled",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-intent"),
      "repair",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-intent-label"),
      "Repair",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-target"),
      "repair",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-action"),
      "repair_review",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftPreview",
          "true",
        ),
      ),
      /Preview[\s\S]*Blocked[\s\S]*Review repair plan now[\s\S]*Intent[\s\S]*Repair[\s\S]*Target[\s\S]*Repair plan[\s\S]*Action[\s\S]*Repair review[\s\S]*Reason[\s\S]*Chat disabled/u,
    );

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(chatDraftInput, "Enter", {
          ctrlKey: true,
        }),
        false,
      );
    });
    assert.equal(session.dispatchedCommands().length, 0);
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.chatLocalSubmit === "true",
      ),
      0,
    );
    assert.equal(chatDraftInput.value, "Review repair plan now");

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

    const expandChatButton = requireFakeRuntimeWorkbenchButtonByText(
      dom.container,
      "Expand chat",
    );
    expandChatButton.focus();
    assert.equal(dom.container.ownerDocument?.activeElement, expandChatButton);
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(expandChatButton);
    });

    const expandedChatDraftInput = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftInput",
      "true",
    );
    assert.equal(expandedChatDraftInput.value, "Review repair plan now");
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      expandedChatDraftInput,
    );

    const draftClearButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftClear",
      "true",
    );
    draftClearButton.focus();
    assert.equal(dom.container.ownerDocument?.activeElement, draftClearButton);
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(draftClearButton);
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftInput",
        "true",
      ).value,
      "",
    );
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      expandedChatDraftInput,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-length"),
      "0",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-words"),
      "0",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-reason"),
      "empty_draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "repair",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-state"),
      "empty",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-intent"),
      "repair",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-target"),
      "repair",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-action"),
      "repair_review",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreviewBody",
        "empty",
      ).textContent,
      "No draft text",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).getAttribute("data-chat-send-guard-reason"),
      "empty_draft",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell marks chat send guard ready locally", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactChatEnabledSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Chat Send Guard Runtime Workbench"
        />,
      );
    });

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftInput",
          "true",
        ),
        "Ask the workflow status",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).getAttribute("data-chat-send-disabled"),
      "false",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).getAttribute("data-chat-send-reason"),
      "ready",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSend",
        "true",
      ).disabled,
      false,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).getAttribute("data-chat-send-guard-enabled"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).getAttribute("data-chat-send-guard-reason"),
      "ready",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatSendGuard",
        "true",
      ).textContent,
      "Send ready",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-enabled"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-reason"),
      "ready",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreview",
        "true",
      ).getAttribute("data-chat-draft-preview-state"),
      "ready",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell records local chat send receipt", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactChatEnabledSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Chat Local Send Runtime Workbench"
        />,
      );
    });

    const draftInput = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftInput",
      "true",
    );
    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Ask the workflow status");
    });

    const sendButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatSend",
      "true",
    );
    sendButton.focus();
    assert.equal(dom.container.ownerDocument?.activeElement, sendButton);
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(sendButton);
    });

    const localSubmission = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatLocalSubmit",
      "true",
    );
    assert.equal(session.dispatchedCommands().length, 0);
    assert.equal(draftInput.value, "");
    assert.equal(dom.container.ownerDocument?.activeElement, draftInput);
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-status"),
      "queued_local",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-sequence"),
      "1",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-count"),
      "1",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-intent"),
      "ask",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-intent-label"),
      "Ask",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-target"),
      "workflow",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-action"),
      "question",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-characters"),
      "23",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-words"),
      "4",
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(localSubmission),
      /Ask the workflow status/u,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchElementAttributeValues(localSubmission).join(" "),
      /Ask the workflow status/u,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(localSubmission),
      /Recent requests[\s\S]*#1[\s\S]*Queued locally[\s\S]*Ask[\s\S]*Current workflow[\s\S]*Question[\s\S]*23 chars[\s\S]*4 words/u,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        localSubmission,
        (element) => element.dataset.chatLocalSubmitHistoryItem !== undefined,
      ),
      1,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        localSubmission,
        "chatLocalSubmitHistoryItem",
        "1",
      ).getAttribute("data-chat-local-submit-history-current"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-reason"),
      "empty_draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftPreviewBody",
        "empty",
      ).textContent,
      "No draft text",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell submits chat draft with keyboard shortcut", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactChatEnabledSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Chat Keyboard Send Runtime Workbench"
        />,
      );
    });

    const draftInput = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftInput",
      "true",
    );

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(draftInput, "Enter", {
          ctrlKey: true,
        }),
        false,
      );
    });
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.chatLocalSubmit === "true",
      ),
      0,
    );

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Send with keyboard now");
    });
    draftInput.focus();
    assert.equal(dom.container.ownerDocument?.activeElement, draftInput);
    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(draftInput, "Enter"),
        true,
      );
    });
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.chatLocalSubmit === "true",
      ),
      0,
    );

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(draftInput, "Enter", {
          ctrlKey: true,
        }),
        false,
      );
    });

    let localSubmission = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatLocalSubmit",
      "true",
    );
    assert.equal(session.dispatchedCommands().length, 0);
    assert.equal(draftInput.value, "");
    assert.equal(dom.container.ownerDocument?.activeElement, draftInput);
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-sequence"),
      "1",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-count"),
      "1",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-characters"),
      "22",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-words"),
      "4",
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(localSubmission),
      /Send with keyboard now/u,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchElementAttributeValues(localSubmission).join(" "),
      /Send with keyboard now/u,
    );

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Meta send request");
    });
    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(draftInput, "Enter", {
          metaKey: true,
        }),
        false,
      );
    });

    localSubmission = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatLocalSubmit",
      "true",
    );
    assert.equal(dom.container.ownerDocument?.activeElement, draftInput);
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-sequence"),
      "2",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-count"),
      "2",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-characters"),
      "17",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-words"),
      "3",
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(localSubmission),
      /Meta send request/u,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchElementAttributeValues(localSubmission).join(" "),
      /Meta send request/u,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell tracks local chat send history", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactChatEnabledSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Chat Local History Runtime Workbench"
        />,
      );
    });

    const draftInput = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftInput",
      "true",
    );
    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Ask the workflow status");
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatSend",
          "true",
        ),
      );
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftIntent",
          "revise",
        ),
      );
    });
    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Revise draft title");
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatSend",
          "true",
        ),
      );
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftIntent",
          "repair",
        ),
      );
    });
    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Repair broken node");
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatSend",
          "true",
        ),
      );
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftIntent",
          "ask",
        ),
      );
    });
    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Ask about status");
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatSend",
          "true",
        ),
      );
    });

    const localSubmission = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatLocalSubmit",
      "true",
    );
    const latestHistoryItem = requireFakeRuntimeWorkbenchElementByData(
      localSubmission,
      "chatLocalSubmitHistoryItem",
      "4",
    );
    const previousHistoryItem = requireFakeRuntimeWorkbenchElementByData(
      localSubmission,
      "chatLocalSubmitHistoryItem",
      "3",
    );
    assert.equal(session.dispatchedCommands().length, 0);
    assert.equal(draftInput.value, "");
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-count"),
      "3",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-sequence"),
      "4",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-intent"),
      "ask",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-target"),
      "workflow",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-action"),
      "question",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-characters"),
      "16",
    );
    assert.equal(
      localSubmission.getAttribute("data-chat-local-submit-words"),
      "3",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        localSubmission,
        (element) => element.dataset.chatLocalSubmitHistoryItem !== undefined,
      ),
      3,
    );
    assert.equal(
      latestHistoryItem.getAttribute("data-chat-local-submit-history-current"),
      "true",
    );
    assert.equal(
      latestHistoryItem.getAttribute("data-chat-local-submit-history-status"),
      "queued_local",
    );
    assert.equal(
      previousHistoryItem.getAttribute(
        "data-chat-local-submit-history-current",
      ),
      "false",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        localSubmission,
        (element) => element.dataset.chatLocalSubmitHistoryItem === "1",
      ),
      0,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(localSubmission),
      /Recent requests[\s\S]*#4[\s\S]*Queued locally[\s\S]*Ask[\s\S]*Current workflow[\s\S]*Question[\s\S]*16 chars[\s\S]*3 words[\s\S]*#3[\s\S]*Queued locally[\s\S]*Repair[\s\S]*Repair plan[\s\S]*Repair review[\s\S]*18 chars[\s\S]*3 words[\s\S]*#2[\s\S]*Queued locally[\s\S]*Revise[\s\S]*Workflow draft[\s\S]*Change request[\s\S]*18 chars[\s\S]*3 words/u,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(localSubmission),
      /Ask the workflow status|Revise draft title|Repair broken node|Ask about status/u,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchElementAttributeValues(localSubmission).join(" "),
      /Ask the workflow status|Revise draft title|Repair broken node|Ask about status/u,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell clears local chat send history", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactChatEnabledSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Chat Local History Clear Runtime Workbench"
        />,
      );
    });

    const draftInput = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatDraftInput",
      "true",
    );
    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Ask the workflow status");
    });
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatSend",
          "true",
        ),
      );
    });

    const initialLocalSubmission = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatLocalSubmit",
      "true",
    );
    assert.equal(
      initialLocalSubmission.getAttribute("data-chat-local-submit-sequence"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        initialLocalSubmission,
        "chatLocalSubmitClear",
        "true",
      ).getAttribute("data-chat-local-submit-clear-count"),
      "1",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatDraftIntent",
          "revise",
        ),
      );
    });
    await act(async () => {
      inputFakeRuntimeWorkbenchElement(draftInput, "Revise after clear");
    });
    const clearLocalSubmissionsButton =
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatLocalSubmitClear",
        "true",
      );
    clearLocalSubmissionsButton.focus();
    assert.equal(
      dom.container.ownerDocument?.activeElement,
      clearLocalSubmissionsButton,
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(clearLocalSubmissionsButton);
    });

    assert.equal(session.dispatchedCommands().length, 0);
    assert.equal(draftInput.value, "Revise after clear");
    assert.equal(dom.container.ownerDocument?.activeElement, draftInput);
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.chatLocalSubmit === "true",
      ),
      0,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-intent"),
      "revise",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "chatDraftDetails",
        "true",
      ).getAttribute("data-chat-draft-send-reason"),
      "ready",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "chatSend",
          "true",
        ),
      );
    });

    const nextLocalSubmission = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "chatLocalSubmit",
      "true",
    );
    assert.equal(session.dispatchedCommands().length, 0);
    assert.equal(draftInput.value, "");
    assert.equal(
      nextLocalSubmission.getAttribute("data-chat-local-submit-sequence"),
      "2",
    );
    assert.equal(
      nextLocalSubmission.getAttribute("data-chat-local-submit-count"),
      "1",
    );
    assert.equal(
      nextLocalSubmission.getAttribute("data-chat-local-submit-intent"),
      "revise",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        nextLocalSubmission,
        (element) => element.dataset.chatLocalSubmitHistoryItem !== undefined,
      ),
      1,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(nextLocalSubmission),
      /Revise after clear/u,
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchElementAttributeValues(nextLocalSubmission).join(" "),
      /Revise after clear/u,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(nextLocalSubmission),
      /Recent requests[\s\S]*#2[\s\S]*Queued locally[\s\S]*Revise[\s\S]*Workflow draft[\s\S]*Change request[\s\S]*18 chars[\s\S]*3 words/u,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell selects file tree node locally", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="File Tree Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeNodeSelected",
        "true",
      ).getAttribute("data-file-tree-node"),
      "workspace_root",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "workspace_root",
      ).getAttribute("data-file-tree-details-path"),
      "workspace root",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "workspace_root",
      ).getAttribute("data-file-tree-details-status"),
      "Open",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "fileTreeNodeSelect",
          "workflow_graph",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeNodeSelected",
        "true",
      ).getAttribute("data-file-tree-node"),
      "workflow_graph",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "workflow_graph",
      ).getAttribute("data-file-tree-details-path"),
      "specs/schemas/workflow_graph.md",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "workflow_graph",
      ).getAttribute("data-file-tree-details-status"),
      "Spec",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.fileTreeNodeSelected === "true",
      ),
      1,
    );

    await act(async () => {
      keydownFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "fileTreeNodeSelect",
          "runtime_stream",
        ),
        " ",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeNodeSelected",
        "true",
      ).getAttribute("data-file-tree-node"),
      "runtime_stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "runtime_stream",
      ).getAttribute("data-file-tree-details-path"),
      "No active stream",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "runtime_stream",
      ).getAttribute("data-file-tree-details-status"),
      "Idle",
    );

    await act(async () => {
      keydownFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "fileTreeNodeSelect",
          "accepted_specs",
        ),
        "Enter",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeNodeSelected",
        "true",
      ).getAttribute("data-file-tree-node"),
      "accepted_specs",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "accepted_specs",
      ).getAttribute("data-file-tree-details-path"),
      "specs",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "fileTreeDetails",
        "accepted_specs",
      ).getAttribute("data-file-tree-details-status"),
      "Read-only",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell selects version snapshot locally", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const snapshot = createRuntimeWorkbenchShellReactSnapshot();
    const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Version Snapshot Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotSelected",
        "true",
      ).getAttribute("data-version-snapshot"),
      "validation",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "validation",
      ).getAttribute("data-version-snapshot-details-status"),
      "Idle",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "validation",
      ).getAttribute("data-version-snapshot-details-value"),
      "0 visible",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "validation",
      ).getAttribute("data-version-snapshot-details-active"),
      "true",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "versionSnapshotDetails",
          "validation",
        ),
      ),
      /Status[\s\S]*Idle[\s\S]*Value[\s\S]*0 visible[\s\S]*Active[\s\S]*Yes/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "versionSnapshotSelect",
          "git_snapshot",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotSelected",
        "true",
      ).getAttribute("data-version-snapshot"),
      "git_snapshot",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "git_snapshot",
      ).getAttribute("data-version-snapshot-details-status"),
      "Not created",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "git_snapshot",
      ).getAttribute("data-version-snapshot-details-value"),
      "Not created",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "git_snapshot",
      ).getAttribute("data-version-snapshot-details-active"),
      "false",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "versionSnapshotDetails",
          "git_snapshot",
        ),
      ),
      /Status[\s\S]*Not created[\s\S]*Value[\s\S]*Not created[\s\S]*Active[\s\S]*No/u,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.versionSnapshotSelected === "true",
      ),
      1,
    );

    await act(async () => {
      keydownFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "versionSnapshotSelect",
          "runtime",
        ),
        " ",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotSelected",
        "true",
      ).getAttribute("data-version-snapshot"),
      "runtime",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "runtime",
      ).getAttribute("data-version-snapshot-details-status"),
      "Idle",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "runtime",
      ).getAttribute("data-version-snapshot-details-value"),
      "No active stream",
    );

    await act(async () => {
      keydownFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "versionSnapshotSelect",
          "draft",
        ),
        "Enter",
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotSelected",
        "true",
      ).getAttribute("data-version-snapshot"),
      "draft",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "draft",
      ).getAttribute("data-version-snapshot-details-status"),
      "Read-only",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "versionSnapshotDetails",
        "draft",
      ).getAttribute("data-version-snapshot-details-value"),
      "v0",
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    dom.restore();
  }
});

test("renderer runtime workbench React shell selects focused canvas node locally", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  const session = createRuntimeWorkbenchShellReactSession({
    runtime: createLoopbackRuntimeBridge({
      base_url: "http://127.0.0.1:1/cw/v1",
      token: "canvas-token",
    }),
  });
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Canvas Inspector Runtime Workbench"
        />,
      );
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "panel",
          "canvas",
        ),
      );
      await waitFor(() => session.getSnapshot().activePanel === "canvas");
    });

    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Canvas Inspector Runtime Workbench/u,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "context_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "context_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "0",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "0",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasSummary === "true",
      ),
      1,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummaryMetric",
        "nodes",
      ).getAttribute("data-workflow-canvas-summary-value"),
      "5",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummaryMetric",
        "edges",
      ).getAttribute("data-workflow-canvas-summary-value"),
      "5",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummaryMetric",
        "active_nodes",
      ).getAttribute("data-workflow-canvas-summary-value"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummaryMetric",
        "entry_nodes",
      ).getAttribute("data-workflow-canvas-summary-value"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummaryMetric",
        "terminal_nodes",
      ).getAttribute("data-workflow-canvas-summary-value"),
      "1",
    );
    for (const nodeType of [
      "start",
      "execution_task",
      "evaluation_task",
      "repair_task",
      "end",
    ]) {
      assert.equal(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "workflowCanvasSummaryNodeType",
          nodeType,
        ).getAttribute("data-workflow-canvas-summary-count"),
        "1",
      );
    }
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummaryEdgeType",
        "normal",
      ).getAttribute("data-workflow-canvas-summary-count"),
      "2",
    );
    for (const edgeType of ["pass", "fail", "repair"]) {
      assert.equal(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "workflowCanvasSummaryEdgeType",
          edgeType,
        ).getAttribute("data-workflow-canvas-summary-count"),
        "1",
      );
    }

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElement(
          dom.container,
          (element) =>
            element.dataset.workflowCanvasTypeFocusKind === "node" &&
            element.dataset.workflowCanvasTypeFocusValue === "repair_task",
          "repair_task node type focus",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummary",
        "true",
      ).getAttribute("data-workflow-canvas-type-focus-kind"),
      "node",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummary",
        "true",
      ).getAttribute("data-workflow-canvas-type-focus-value"),
      "repair_task",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasTypeFocusActive === "true",
      ),
      1,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasNodeTypeFocused",
        "true",
      ).getAttribute("data-workflow-canvas-node"),
      "repair_task",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasEdgeTypeFocused === "true",
      ),
      0,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasTypeFocusDetails",
        "node",
      ).getAttribute("data-workflow-canvas-type-focus-details-value"),
      "repair_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasTypeFocusDetails",
        "node",
      ).getAttribute("data-workflow-canvas-type-focus-match-count"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasTypeFocusNodeMatch",
        "repair_task",
      ).getAttribute("data-workflow-canvas-type-focus-node-match"),
      "repair_task",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "workflowCanvasTypeFocusNodeSelect",
          "repair_task",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasNodeSelected",
        "true",
      ).getAttribute("data-workflow-canvas-node"),
      "repair_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "1",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "1",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "repair_task");

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElement(
          dom.container,
          (element) =>
            element.dataset.workflowCanvasTypeFocusKind === "edge" &&
            element.dataset.workflowCanvasTypeFocusValue === "normal",
          "normal edge type focus",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummary",
        "true",
      ).getAttribute("data-workflow-canvas-type-focus-kind"),
      "edge",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasSummary",
        "true",
      ).getAttribute("data-workflow-canvas-type-focus-value"),
      "normal",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasNodeTypeFocused === "true",
      ),
      0,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasEdgeTypeFocused === "true",
      ),
      2,
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasTypeFocusDetails",
        "edge",
      ).getAttribute("data-workflow-canvas-type-focus-details-value"),
      "normal",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasTypeFocusDetails",
        "edge",
      ).getAttribute("data-workflow-canvas-type-focus-match-count"),
      "2",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElement(
        dom.container,
        (element) =>
          element.dataset.workflowCanvasEdge === "context_to_review" &&
          element.dataset.workflowCanvasEdgeTypeFocused === "true",
        "focused context_to_review normal edge",
      ).getAttribute("data-workflow-canvas-edge-type-focused"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElement(
        dom.container,
        (element) =>
          element.dataset.workflowCanvasEdge === "start_to_context" &&
          element.dataset.workflowCanvasEdgeTypeFocused === "true",
        "focused start_to_context normal edge",
      ).getAttribute("data-workflow-canvas-edge-type-focused"),
      "true",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasTypeFocusEdgeMatch",
        "context_to_review",
      ).getAttribute("data-workflow-canvas-type-focus-edge-match"),
      "context_to_review",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasTypeFocusEdgeMatch",
        "start_to_context",
      ).getAttribute("data-workflow-canvas-type-focus-edge-match"),
      "start_to_context",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "workflowCanvasTypeFocusClear",
          "true",
        ),
      );
    });

    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasTypeFocusActive === "true",
      ),
      0,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasNodeTypeFocused === "true",
      ),
      0,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasEdgeTypeFocused === "true",
      ),
      0,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) =>
          element.dataset.workflowCanvasTypeFocusDetails !== undefined,
      ),
      0,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "workflowCanvasNodeSelect",
          "repair_task",
        ),
      );
    });

    assert.equal(session.getSnapshot().activePanel, "canvas");
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "repair_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "1",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "1",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "context_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "context_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasNodeSelected",
        "true",
      ).getAttribute("data-workflow-canvas-node"),
      "repair_task",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasEdgeSelected === "true",
      ),
      2,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasEdgeDirection === "incoming",
      ),
      1,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasEdgeDirection === "outgoing",
      ),
      1,
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasRouteSelect !== undefined,
      ),
      2,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Repair loop[\s\S]*Type[\s\S]*repair_task[\s\S]*Incoming[\s\S]*1[\s\S]*Outgoing[\s\S]*1[\s\S]*Incoming edges[\s\S]*review_task[\s\S]*repair_task[\s\S]*Outgoing edges[\s\S]*repair_task[\s\S]*context_task/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElement(
          dom.container,
          (element) =>
            element.dataset.workflowCanvasInspectorEdgeRoute ===
              "review_to_repair" &&
            element.dataset.workflowCanvasRouteSelect === "review_task",
          "incoming repair route select",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "review_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "review_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "2",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "2",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "repair_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasNodeSelected",
        "true",
      ).getAttribute("data-workflow-canvas-node"),
      "review_task",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasEdgeSelected === "true",
      ),
      3,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /Review result[\s\S]*Incoming[\s\S]*1[\s\S]*Outgoing[\s\S]*2[\s\S]*context_task[\s\S]*review_task[\s\S]*review_task[\s\S]*end[\s\S]*review_task[\s\S]*repair_task/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElement(
          dom.container,
          (element) =>
            element.dataset.workflowCanvasInspectorEdgeRoute ===
              "review_to_end" &&
            element.dataset.workflowCanvasRouteSelect === "end",
          "outgoing review route select",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "end",
      ).getAttribute("data-workflow-canvas-inspector"),
      "end",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "3",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "3",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "review_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "review_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasNodeSelected",
        "true",
      ).getAttribute("data-workflow-canvas-node"),
      "end",
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(dom.container),
      /End[\s\S]*Incoming[\s\S]*1[\s\S]*Outgoing[\s\S]*0[\s\S]*No outgoing edges/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "workflowCanvasInspectorBack",
          "true",
        ),
      );
    });

    assert.equal(session.getSnapshot().activePanel, "canvas");
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "review_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "review_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "2",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "2",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasNodeSelected",
        "true",
      ).getAttribute("data-workflow-canvas-node"),
      "review_task",
    );

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(
          requireFakeRuntimeWorkbenchElementByData(
            dom.container,
            "workflowCanvasNodeSelect",
            "review_task",
          ),
          "ArrowRight",
        ),
        false,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "repair_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "3",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "3",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "review_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "review_task",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "repair_task");

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(
          requireFakeRuntimeWorkbenchElementByData(
            dom.container,
            "workflowCanvasNodeSelect",
            "repair_task",
          ),
          "ArrowDown",
        ),
        false,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "end",
      ).getAttribute("data-workflow-canvas-inspector"),
      "end",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "4",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "4",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "repair_task",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "end");

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(
          requireFakeRuntimeWorkbenchElementByData(
            dom.container,
            "workflowCanvasNodeSelect",
            "end",
          ),
          "ArrowRight",
        ),
        false,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "end",
      ).getAttribute("data-workflow-canvas-inspector"),
      "end",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "4",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "4",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "repair_task",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "end");

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(
          requireFakeRuntimeWorkbenchElementByData(
            dom.container,
            "workflowCanvasNodeSelect",
            "end",
          ),
          "ArrowLeft",
        ),
        false,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "repair_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "5",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "5",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "end",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "end",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "repair_task");

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(
          requireFakeRuntimeWorkbenchElementByData(
            dom.container,
            "workflowCanvasNodeSelect",
            "repair_task",
          ),
          "ArrowUp",
        ),
        false,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "review_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "review_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "6",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "6",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "repair_task",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "review_task");

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(
          requireFakeRuntimeWorkbenchElementByData(
            dom.container,
            "workflowCanvasNodeSelect",
            "review_task",
          ),
          "Home",
        ),
        false,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "start",
      ).getAttribute("data-workflow-canvas-inspector"),
      "start",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "7",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "7",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "review_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "review_task",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "start");

    await act(async () => {
      assert.equal(
        keydownFakeRuntimeWorkbenchElement(
          requireFakeRuntimeWorkbenchElementByData(
            dom.container,
            "workflowCanvasNodeSelect",
            "start",
          ),
          "End",
        ),
        false,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "end",
      ).getAttribute("data-workflow-canvas-inspector"),
      "end",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "8",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "8",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "start",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "start",
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "end");

    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasHistorySelect !== undefined,
      ),
      8,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElement(
          dom.container,
          (element) =>
            element.dataset.workflowCanvasHistoryIndex === "2" &&
            element.dataset.workflowCanvasHistorySelect === "review_task",
          "canvas history trail review_task item",
        ),
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspector",
        "review_task",
      ).getAttribute("data-workflow-canvas-inspector"),
      "review_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorHistoryDepth",
        "2",
      ).getAttribute("data-workflow-canvas-inspector-history-depth"),
      "2",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasInspectorBackTarget",
        "repair_task",
      ).getAttribute("data-workflow-canvas-inspector-back-target"),
      "repair_task",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "workflowCanvasNodeSelected",
        "true",
      ).getAttribute("data-workflow-canvas-node"),
      "review_task",
    );
    assert.equal(
      countFakeRuntimeWorkbenchElements(
        dom.container,
        (element) => element.dataset.workflowCanvasHistorySelect !== undefined,
      ),
      2,
    );
    assertFakeRuntimeWorkbenchFocusedNode(dom.container, "review_task");

    await act(async () => {
      root.unmount();
    });
  } finally {
    session.dispose();
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

test("renderer runtime workbench React shell dispatches execution mode controls", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  const snapshot = createRuntimeWorkbenchShellReactSnapshot({
    activePanel: "canvas",
    executionMode: "step",
  });
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          defaultRuntimeStreamOptionsFormState={{
            runId: " run_step ",
            projectId: " project_step ",
          }}
          session={session}
          title="Execution Mode Runtime Workbench"
        />,
      );
    });

    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "executionModeControl",
        "true",
      ).getAttribute("data-execution-mode"),
      "step",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        dom.container,
        "executionRunOnce",
        "true",
      ).getAttribute("data-execution-run-once-enabled"),
      "true",
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "executionModeOption",
          "auto",
        ),
      );
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "set_execution_mode",
      mode: "auto",
    });

    const runOnceButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "executionRunOnce",
      "true",
    );
    const nodeId = runOnceButton.dataset.executionRunOnceNodeId;
    assert.notEqual(nodeId, undefined);
    assert.notEqual(nodeId, "");

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(runOnceButton);
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "run_node_once",
      runId: "run_step",
      nodeId,
      projectId: "project_step",
    });

    await act(async () => {
      root.unmount();
    });
  } finally {
    session.dispose();
    dom.restore();
  }
});

test("renderer runtime workbench React shell dispatches project creation without task background payload", async () => {
  assert.deepEqual(
    createRuntimeWorkbenchShellReactProjectCreationFormState({
      displayName: "Draft",
    }),
    {
      displayName: "Draft",
      hostPath: "",
      taskBackground: "",
    },
  );
  const dom = installFakeRuntimeWorkbenchReactDom();
  const snapshot = createRuntimeWorkbenchShellReactSnapshot();
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          session={session}
          title="Project Creation Runtime Workbench"
        />,
      );
    });

    const projectCreationControl = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "projectCreationControl",
      "true",
    );
    assert.equal(
      projectCreationControl.getAttribute("data-project-creation-status"),
      "idle",
    );
    assert.equal(
      projectCreationControl.getAttribute(
        "data-project-creation-git-initialized",
      ),
      "unknown",
    );
    const submitButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "projectCreateSubmit",
      "true",
    );
    assert.equal(
      submitButton.getAttribute("data-project-create-enabled"),
      "false",
    );
    assert.equal(
      findFakeRuntimeWorkbenchElement(
        dom.container,
        (element) => element.dataset.projectCreateGitBypass === "true",
      ),
      null,
    );

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "projectCreateField",
          "displayName",
        ),
        " W1.5 project ",
      );
      inputFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "projectCreateField",
          "hostPath",
        ),
        " D:/CW/W1_5_Project ",
      );
      inputFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "projectCreateField",
          "taskBackground",
        ),
        "Create a first runtime-backed workflow",
      );
    });

    const readySubmitButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "projectCreateSubmit",
      "true",
    );
    assert.equal(
      readySubmitButton.getAttribute("data-project-create-enabled"),
      "true",
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(readySubmitButton);
    });

    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "create_project",
      displayName: "W1.5 project",
      hostPath: "D:/CW/W1_5_Project",
    });
    assert.equal(
      JSON.stringify(session.dispatchedCommands().at(-1)).includes(
        "Create a first runtime-backed workflow",
      ),
      false,
    );

    await act(async () => {
      root.unmount();
    });
  } finally {
    session.dispose();
    dom.restore();
  }
});

test("renderer runtime workbench React shell dispatches reference management commands without rendering file content", async () => {
  assert.deepEqual(
    createRuntimeWorkbenchShellReactReferenceImportFormState({
      fileName: "guide.md",
      kind: "md",
      projectId: "project_refs",
    }),
    {
      projectId: "project_refs",
      kind: "md",
      fileName: "guide.md",
      fileContentBase64: "",
      sourceUrl: "",
      sensitive: false,
      autoChunk: true,
      fileLabel: "guide.md",
      fileByteLength: null,
    },
  );
  const fileContentBase64 = btoa("raw_reference_content");
  const dom = installFakeRuntimeWorkbenchReactDom();
  const snapshot = createRuntimeWorkbenchShellReactSnapshot({
    referenceManagement: {
      status: "succeeded",
      activeProjectId: "project_refs",
      entries: Object.freeze([
        Object.freeze({
          referenceId: "ref_docs",
          path: "references/ref_docs.md",
          kind: "md",
          enabled: true,
          sourceUrl: null,
          contentHash:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chunkStatus: "indexed",
          chunkSizeTokens: 128,
          sensitive: false,
          importedAt: "2026-06-25T00:00:00.000Z",
        }),
      ]),
      indexSnapshotId: "idx_refs",
      lastReferenceId: "ref_docs",
    },
  });
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          defaultReferenceImportFormState={{
            projectId: " project_refs ",
            kind: "md",
            fileName: " guide.md ",
            fileContentBase64,
            sourceUrl: " https://example.invalid/spec ",
            sensitive: true,
            autoChunk: false,
            fileLabel: "guide.md",
            fileByteLength: 21,
          }}
          session={session}
          title="Reference Runtime Workbench"
        />,
      );
    });

    const referenceControl = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "referenceManagementControl",
      "true",
    );
    assert.equal(
      referenceControl.getAttribute("data-reference-management-status"),
      "succeeded",
    );
    assert.equal(
      referenceControl.getAttribute("data-reference-management-entry-count"),
      "1",
    );
    assert.equal(
      fakeRuntimeWorkbenchNodeTextContent(dom.container).includes(
        "raw_reference_content",
      ),
      false,
    );
    assert.equal(
      fakeRuntimeWorkbenchElementAttributeValues(dom.container).includes(
        fileContentBase64,
      ),
      false,
    );

    const refreshButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "referenceRefreshSubmit",
      "true",
    );
    assert.equal(
      refreshButton.getAttribute("data-reference-refresh-enabled"),
      "true",
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(refreshButton);
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "refresh_references",
      projectId: "project_refs",
    });

    const importButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "referenceImportSubmit",
      "true",
    );
    assert.equal(
      importButton.getAttribute("data-reference-import-enabled"),
      "true",
    );
    assert.equal(
      importButton.getAttribute("data-reference-import-file-ready"),
      "true",
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(importButton);
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "import_reference",
      projectId: "project_refs",
      fileName: "guide.md",
      fileContentBase64,
      kind: "md",
      sensitive: true,
      autoChunk: false,
      sourceUrl: "https://example.invalid/spec",
    });
    const clearedImportButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "referenceImportSubmit",
      "true",
    );
    assert.equal(
      clearedImportButton.getAttribute("data-reference-import-file-ready"),
      "false",
    );
    assert.equal(
      fakeRuntimeWorkbenchNodeTextContent(dom.container).includes("No file"),
      true,
    );
    assert.equal(
      fakeRuntimeWorkbenchElementAttributeValues(dom.container).includes(
        fileContentBase64,
      ),
      false,
    );

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "referenceField",
          "projectId",
        ),
        "project_other",
      );
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "referenceToggleId",
          "ref_docs",
        ),
      );
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "set_reference_enabled",
      projectId: "project_refs",
      referenceId: "ref_docs",
      enabled: false,
    });

    await act(async () => {
      root.unmount();
    });
  } finally {
    session.dispose();
    dom.restore();
  }
});

test("renderer runtime workbench React shell dispatches skill management commands without rendering params", async () => {
  assert.deepEqual(
    createRuntimeWorkbenchShellReactSkillManagementFormState({
      projectId: "project_skills",
      skillId: "citation_checker",
    }),
    {
      projectId: "project_skills",
      skillId: "citation_checker",
      version: "latest",
    },
  );
  const dom = installFakeRuntimeWorkbenchReactDom();
  const snapshot = createRuntimeWorkbenchShellReactSnapshot({
    skillManagement: {
      status: "succeeded",
      activeProjectId: "project_skills",
      entries: Object.freeze([
        Object.freeze({
          skillId: "citation_checker",
          version: "1.0.0",
          enabled: true,
          paramKeys: Object.freeze(["mode", "secret"]),
        }),
      ]),
      lastSkillId: "citation_checker",
    },
  });
  const session = createFakeRuntimeWorkbenchShellReactSession(snapshot);
  try {
    const [{ createRoot }, { act }] = await Promise.all([
      import("react-dom/client"),
      import("react"),
    ]);
    const root = createRoot(dom.container as unknown as Element);

    await act(async () => {
      root.render(
        <RuntimeWorkbenchShellReactView
          defaultSkillManagementFormState={{
            projectId: " project_skills ",
            skillId: " citation_checker ",
            version: " 1.0.0 ",
          }}
          session={session}
          title="Skill Runtime Workbench"
        />,
      );
    });

    const skillControl = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "skillManagementControl",
      "true",
    );
    assert.equal(
      skillControl.getAttribute("data-skill-management-status"),
      "succeeded",
    );
    assert.equal(
      skillControl.getAttribute("data-skill-management-entry-count"),
      "1",
    );
    assert.equal(
      fakeRuntimeWorkbenchNodeTextContent(dom.container).includes(
        "raw_skill_param_value",
      ),
      false,
    );
    assert.equal(
      fakeRuntimeWorkbenchElementAttributeValues(dom.container).includes(
        "raw_skill_param_value",
      ),
      false,
    );

    const refreshButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "skillRefreshSubmit",
      "true",
    );
    assert.equal(
      refreshButton.getAttribute("data-skill-refresh-enabled"),
      "true",
    );
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(refreshButton);
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "refresh_skills",
      projectId: "project_skills",
    });

    const setButton = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "skillSetSubmit",
      "true",
    );
    assert.equal(setButton.getAttribute("data-skill-set-enabled"), "true");
    await act(async () => {
      clickFakeRuntimeWorkbenchElement(setButton);
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "set_skill_enabled",
      projectId: "project_skills",
      skillId: "citation_checker",
      enabled: true,
      version: "1.0.0",
    });

    await act(async () => {
      inputFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "skillField",
          "projectId",
        ),
        "project_other",
      );
    });

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "skillToggleId",
          "citation_checker",
        ),
      );
    });
    assert.deepEqual(session.dispatchedCommands().at(-1), {
      type: "set_skill_enabled",
      projectId: "project_skills",
      skillId: "citation_checker",
      enabled: false,
    });

    await act(async () => {
      root.unmount();
    });
  } finally {
    session.dispose();
    dom.restore();
  }
});

test("renderer runtime workbench session dispatches run-once through runtime fetch", async () => {
  const { runtime, calls } = createFakeRuntimeWorkbenchRunOnceRuntime({
    body: Object.freeze({ raw_model_output: "must not be retained" }),
    ok: true,
    status: 202,
  });
  const session = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "step",
  });

  const snapshot = await session.runNodeOnce({
    runId: " run_step_1 ",
    nodeId: "node_step.1",
    projectId: "project_exec",
    idempotencyKey: "idem_exec",
  });

  const call = requireRuntimeWorkbenchRunOnceRuntimeCall(calls);
  assert.equal(call.path, "/runs/run_step_1/nodes/node_step.1:run-once");
  assert.deepEqual(call.init, {
    method: "POST",
    projectId: "project_exec",
    idempotencyKey: "idem_exec",
  });
  assert.equal(
    Object.hasOwn(call.init ?? {}, "body"),
    false,
    "run-once dispatch must not send a request body from the workbench",
  );
  assert.deepEqual(snapshot.executionPolicy.runOnce, {
    status: "succeeded",
    method: "POST",
    path: "/runs/run_step_1/nodes/node_step.1:run-once",
    runId: "run_step_1",
    nodeId: "node_step.1",
    statusCode: 202,
    blockedReason: null,
  });
  assert.equal(
    JSON.stringify(snapshot.executionPolicy.runOnce).includes(
      "must not be retained",
    ),
    false,
  );
});

test("renderer runtime workbench session records failed run-once status without response body", async () => {
  const { runtime, calls } = createFakeRuntimeWorkbenchRunOnceRuntime({
    body: "raw failure details must not be retained",
    ok: false,
    status: 409,
  });
  const session = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "step",
  });

  const snapshot = await session.runNodeOnce({
    runId: "run_conflict",
    nodeId: "node_conflict",
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(snapshot.executionPolicy.runOnce, {
    status: "failed",
    method: "POST",
    path: "/runs/run_conflict/nodes/node_conflict:run-once",
    runId: "run_conflict",
    nodeId: "node_conflict",
    statusCode: 409,
    blockedReason: null,
  });
  assert.equal(
    JSON.stringify(snapshot.executionPolicy.runOnce).includes(
      "raw failure details",
    ),
    false,
  );
});

test("renderer runtime workbench session creates projects through runtime fetch with mandatory Git evidence", async () => {
  const { runtime, calls } = createFakeRuntimeWorkbenchRunOnceRuntime({
    body: Object.freeze({
      schema_version: "0.1.0",
      project_id: "prj_w1_5_181",
      host_path: "D:/CW/W1_5_Project",
      git_initialized: true,
      first_commit_sha: "9a8c7b6d5e4f3210",
      raw_runtime_detail: "must not be retained",
    }),
    ok: true,
    status: 201,
  });
  const session = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "semi_auto",
  });

  const snapshot = await session.createProject({
    displayName: " W1.5 project ",
    hostPath: " D:/CW/W1_5_Project ",
    idempotencyKey: "idem_project_create",
  });

  const call = requireRuntimeWorkbenchRunOnceRuntimeCall(calls);
  assert.equal(call.path, "/projects");
  assert.deepEqual(
    call.init === undefined ? null : JSON.parse(call.init.body ?? ""),
    {
      schema_version: "0.1.0",
      display_name: "W1.5 project",
      host_path: "D:/CW/W1_5_Project",
    },
  );
  assert.deepEqual(call.init, {
    method: "POST",
    body: JSON.stringify({
      schema_version: "0.1.0",
      display_name: "W1.5 project",
      host_path: "D:/CW/W1_5_Project",
    }),
    idempotencyKey: "idem_project_create",
  });
  assert.deepEqual(snapshot.projectCreation, {
    status: "succeeded",
    method: "POST",
    path: "/projects",
    displayName: "W1.5 project",
    hostPath: "D:/CW/W1_5_Project",
    projectId: "prj_w1_5_181",
    gitInitialized: true,
    firstCommitSha: "9a8c7b6d5e4f3210",
    statusCode: 201,
    blockedReason: null,
    canCreateProject: true,
  });
  assert.equal(
    JSON.stringify(snapshot.projectCreation).includes("raw_runtime_detail"),
    false,
  );
});

test("renderer runtime workbench session manages references through runtime fetch without retaining file content", async () => {
  const calls: RuntimeWorkbenchRunOnceRuntimeCall[] = [];
  const existingEntry = Object.freeze({
    reference_id: "ref_docs",
    path: "references/ref_docs.md",
    kind: "md",
    enabled: true,
    source_url: null,
    content_hash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    chunk_status: "indexed",
    chunk_size_tokens: 128,
    sensitive: false,
    imported_at: "2026-06-25T00:00:00.000Z",
  });
  const importedEntry = Object.freeze({
    reference_id: "ref_new",
    path: "references/ref_new.md",
    kind: "md",
    enabled: true,
    source_url: "https://example.invalid/spec",
    content_hash:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    chunk_status: "stale",
    chunk_size_tokens: null,
    sensitive: true,
    imported_at: "2026-06-25T00:01:00.000Z",
  });
  const runtime: Pick<RuntimeBridge, "fetch"> = Object.freeze({
    fetch: async <TBody,>(
      path: RuntimeRequestPath,
      init?: RuntimeRequestInit,
    ): Promise<RuntimeResponse<TBody>> => {
      calls.push(
        init === undefined
          ? { path }
          : { path, init: Object.freeze({ ...init }) },
      );
      if (path === "/projects/project_refs/references" && init === undefined) {
        return {
          ok: true,
          status: 200,
          headers: {},
          body: Object.freeze({
            schema_version: "0.1.0",
            entries: Object.freeze([existingEntry]),
            index_snapshot_id: "idx_refs",
          }) as TBody,
        };
      }
      if (
        path === "/projects/project_refs/references" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          status: 201,
          headers: {},
          body: importedEntry as TBody,
        };
      }
      if (
        path === "/projects/project_refs/references/ref_new" &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          status: 200,
          headers: {},
          body: Object.freeze({
            ...importedEntry,
            enabled: false,
          }) as TBody,
        };
      }
      return {
        ok: false,
        status: 404,
        headers: {},
        body: null,
      };
    },
  });
  const session = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "semi_auto",
  });

  const refreshed = await session.refreshReferences({
    projectId: " project_refs ",
  });
  assert.equal(calls[0]?.path, "/projects/project_refs/references");
  assert.equal(calls[0]?.init, undefined);
  assert.deepEqual(refreshed.referenceManagement.entries, [
    {
      referenceId: "ref_docs",
      path: "references/ref_docs.md",
      kind: "md",
      enabled: true,
      sourceUrl: null,
      contentHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chunkStatus: "indexed",
      chunkSizeTokens: 128,
      sensitive: false,
      importedAt: "2026-06-25T00:00:00.000Z",
    },
  ]);
  assert.equal(refreshed.referenceManagement.indexSnapshotId, "idx_refs");

  const imported = await session.importReference({
    projectId: "project_refs",
    fileName: "guide.md",
    fileContentBase64: btoa("reference bytes"),
    kind: "md",
    sensitive: true,
    autoChunk: false,
    sourceUrl: "https://example.invalid/spec",
  });
  const importCall = calls[1];
  assert.equal(importCall?.path, "/projects/project_refs/references");
  assert.equal(importCall?.init?.method, "POST");
  assert.match(
    importCall?.init?.headers?.["Content-Type"] ?? "",
    /^multipart\/form-data; boundary=----cw-reference-/u,
  );
  assert.equal(Object.hasOwn(importCall?.init ?? {}, "body"), false);
  assert.ok(importCall?.init?.bodyBase64 !== undefined);
  const multipartText = Buffer.from(
    importCall.init.bodyBase64,
    "base64",
  ).toString("utf8");
  assert.match(multipartText, /"kind":"md"/u);
  assert.match(multipartText, /"auto_chunk":false/u);
  assert.match(multipartText, /reference bytes/u);
  assert.equal(imported.referenceManagement.lastReferenceId, "ref_new");
  assert.equal(imported.referenceManagement.entries.length, 2);
  assert.equal(
    JSON.stringify(imported.referenceManagement).includes("reference bytes"),
    false,
  );

  const toggled = await session.setReferenceEnabled({
    projectId: "project_refs",
    referenceId: "ref_new",
    enabled: false,
  });
  const toggleCall = calls[2];
  assert.equal(toggleCall?.path, "/projects/project_refs/references/ref_new");
  assert.deepEqual(
    JSON.parse(toggleCall?.init?.body ?? "{}") as Record<string, unknown>,
    {
      schema_version: "0.1.0",
      enabled: false,
    },
  );
  assert.equal(
    toggled.referenceManagement.entries.find(
      (entry) => entry.referenceId === "ref_new",
    )?.enabled,
    false,
  );
});

test("renderer runtime workbench session manages skills through runtime fetch without retaining params", async () => {
  const calls: RuntimeWorkbenchRunOnceRuntimeCall[] = [];
  const existingEntry = Object.freeze({
    skill_id: "citation_checker",
    version: "1.0.0",
    enabled: true,
    params: Object.freeze({
      mode: "strict",
      secret: "raw_skill_param_value",
    }),
  });
  const runtime: Pick<RuntimeBridge, "fetch"> = Object.freeze({
    fetch: async <TBody,>(
      path: RuntimeRequestPath,
      init?: RuntimeRequestInit,
    ): Promise<RuntimeResponse<TBody>> => {
      calls.push(
        init === undefined
          ? { path }
          : { path, init: Object.freeze({ ...init }) },
      );
      if (path === "/projects/project_skills/skills" && init === undefined) {
        return {
          ok: true,
          status: 200,
          headers: {},
          body: Object.freeze([existingEntry]) as TBody,
        };
      }
      if (
        path === "/projects/project_skills/skills" &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          status: 200,
          headers: {},
          body: Object.freeze({
            ...existingEntry,
            enabled: false,
          }) as TBody,
        };
      }
      return {
        ok: false,
        status: 404,
        headers: {},
        body: null,
      };
    },
  });
  const session = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "semi_auto",
  });

  const refreshed = await session.refreshSkills({
    projectId: " project_skills ",
  });
  assert.equal(calls[0]?.path, "/projects/project_skills/skills");
  assert.equal(calls[0]?.init, undefined);
  assert.deepEqual(refreshed.skillManagement.entries, [
    {
      skillId: "citation_checker",
      version: "1.0.0",
      enabled: true,
      paramKeys: [],
    },
  ]);
  assert.equal(
    JSON.stringify(refreshed.skillManagement).includes("strict"),
    false,
  );
  assert.equal(
    JSON.stringify(refreshed.skillManagement).includes("raw_skill_param_value"),
    false,
  );

  const toggled = await session.setSkillEnabled({
    projectId: "project_skills",
    skillId: "citation_checker",
    enabled: false,
    version: "1.0.0",
  });
  const toggleCall = calls[1];
  assert.equal(toggleCall?.path, "/projects/project_skills/skills");
  assert.deepEqual(
    JSON.parse(toggleCall?.init?.body ?? "{}") as Record<string, unknown>,
    {
      schema_version: "0.1.0",
      skill_id: "citation_checker",
      enabled: false,
      version: "1.0.0",
    },
  );
  assert.equal(
    toggled.skillManagement.entries.find(
      (entry) => entry.skillId === "citation_checker",
    )?.enabled,
    false,
  );
  assert.equal(
    JSON.stringify(toggled.skillManagement).includes("raw_skill_param_value"),
    false,
  );
});

test("renderer runtime workbench session blocks project creation without valid input or runtime", async () => {
  const { runtime, calls } = createFakeRuntimeWorkbenchRunOnceRuntime();
  const invalidInputSession = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "semi_auto",
  });
  await assert.rejects(
    () =>
      invalidInputSession.createProject({
        displayName: "",
        hostPath: "D:/CW/Project",
      }),
    /input is invalid/u,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(invalidInputSession.snapshot().projectCreation, {
    status: "blocked",
    method: "POST",
    path: "/projects",
    displayName: null,
    hostPath: "D:/CW/Project",
    projectId: null,
    gitInitialized: null,
    firstCommitSha: null,
    statusCode: null,
    blockedReason: "invalid_input",
    canCreateProject: true,
  });

  const unavailableSession = createRuntimeWorkbenchRunOnceSession({
    executionMode: "semi_auto",
  });
  await assert.rejects(
    () =>
      unavailableSession.createProject({
        displayName: "Project",
        hostPath: "D:/CW/Project",
      }),
    /runtime bridge is unavailable/u,
  );
  assert.deepEqual(unavailableSession.snapshot().projectCreation, {
    status: "blocked",
    method: "POST",
    path: "/projects",
    displayName: "Project",
    hostPath: "D:/CW/Project",
    projectId: null,
    gitInitialized: null,
    firstCommitSha: null,
    statusCode: null,
    blockedReason: "runtime_unavailable",
    canCreateProject: false,
  });
});

test("renderer runtime workbench session rejects project creation when Git initialization is not proven", async () => {
  const { runtime } = createFakeRuntimeWorkbenchRunOnceRuntime({
    body: Object.freeze({
      schema_version: "0.1.0",
      project_id: "prj_without_git",
      host_path: "D:/CW/NoGit",
      git_initialized: false,
      first_commit_sha: null,
    }),
    ok: true,
    status: 201,
  });
  const session = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "auto",
  });

  await assert.rejects(
    () =>
      session.createProject({
        displayName: "No Git project",
        hostPath: "D:/CW/NoGit",
      }),
    /did not initialize Git/u,
  );
  assert.deepEqual(session.snapshot().projectCreation, {
    status: "failed",
    method: "POST",
    path: "/projects",
    displayName: "No Git project",
    hostPath: "D:/CW/NoGit",
    projectId: "prj_without_git",
    gitInitialized: false,
    firstCommitSha: null,
    statusCode: 201,
    blockedReason: "git_not_initialized",
    canCreateProject: true,
  });
});

test("renderer runtime workbench session blocks run-once outside step/runtime availability", async () => {
  const { runtime, calls } = createFakeRuntimeWorkbenchRunOnceRuntime();
  const semiAutoSession = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "semi_auto",
  });

  await assert.rejects(
    () =>
      semiAutoSession.runNodeOnce({
        runId: "run_blocked",
        nodeId: "node_blocked",
      }),
    /requires step mode/u,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(semiAutoSession.snapshot().executionPolicy.runOnce, {
    status: "blocked",
    method: "POST",
    path: "/runs/run_blocked/nodes/node_blocked:run-once",
    runId: "run_blocked",
    nodeId: "node_blocked",
    statusCode: null,
    blockedReason: "mode_not_step",
  });

  const unavailableSession = createRuntimeWorkbenchRunOnceSession({
    executionMode: "step",
  });
  await assert.rejects(
    () =>
      unavailableSession.runNodeOnce({
        runId: "run_unavailable",
        nodeId: "node_unavailable",
      }),
    /runtime bridge is unavailable/u,
  );
  assert.deepEqual(unavailableSession.snapshot().executionPolicy.runOnce, {
    status: "blocked",
    method: "POST",
    path: "/runs/run_unavailable/nodes/node_unavailable:run-once",
    runId: "run_unavailable",
    nodeId: "node_unavailable",
    statusCode: null,
    blockedReason: "runtime_unavailable",
  });

  const invalidTargetSession = createRuntimeWorkbenchRunOnceSession({
    runtime,
    executionMode: "step",
  });
  await assert.rejects(
    () =>
      invalidTargetSession.runNodeOnce({
        runId: "../run",
        nodeId: "node_invalid",
      }),
    /target is invalid/u,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(invalidTargetSession.snapshot().executionPolicy.runOnce, {
    status: "blocked",
    method: "POST",
    path: null,
    runId: null,
    nodeId: null,
    statusCode: null,
    blockedReason: "invalid_target",
  });
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
  const showCanvas = requireRuntimeWorkbenchShellReactAction(
    snapshot,
    "show_canvas_panel",
  );
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
  assert.deepEqual(runtimeWorkbenchShellActionToCommand(showCanvas), {
    type: "show_canvas_panel",
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
    assert.deepEqual(panel.selectedEvent?.payloadSummary, {
      present: true,
      kind: "object",
      keyCount: 1,
    });
    assert.deepEqual(panel.selectedEvent?.metadataSummary, {
      present: true,
      kind: "object",
      keyCount: 2,
    });
    const liveSelectedEvent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamSelectedEvent",
      "true",
    );
    assert.equal(
      liveSelectedEvent.getAttribute("data-stream-selected-event-payload-kind"),
      "object",
    );
    assert.equal(
      liveSelectedEvent.getAttribute(
        "data-stream-selected-event-payload-key-count",
      ),
      "1",
    );
    assert.equal(
      liveSelectedEvent.getAttribute(
        "data-stream-selected-event-metadata-kind",
      ),
      "object",
    );
    assert.equal(
      liveSelectedEvent.getAttribute(
        "data-stream-selected-event-metadata-key-count",
      ),
      "2",
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(liveSelectedEvent),
      /delta_text|cw\.trace|hidden metadata value/u,
    );

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

test("renderer runtime workbench React shell labels unknown loopback SSE events", async () => {
  const dom = installFakeRuntimeWorkbenchReactDom();
  const loopback = await createRuntimeWorkbenchLoopbackSseServer({
    firstStreamEvents: [createRuntimeWorkbenchLoopbackUnknownStreamEvent()],
  });
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
          title="Unknown Loopback Runtime Workbench"
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
            ?.id === "evt_live_unknown",
      );
    });

    const panel = requireRuntimeStreamPanel(session.getSnapshot());
    assert.equal(panel.status, "running");
    assert.equal(panel.totalEvents, 1);
    assert.equal(panel.timelineItems[0]?.type, "adapter.experimental_event");
    assert.equal(panel.timelineItems[0]?.title, "Experimental adapter event");
    assert.equal(panel.timelineItems[0]?.category, "system");

    const unknownEvent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamEventKnownType",
      "false",
    );
    assert.match(
      unknownEvent.getAttribute("class") ?? "",
      /cw-workbench__stream-event--unknown-type/u,
    );
    assert.match(
      fakeRuntimeWorkbenchNodeTextContent(unknownEvent),
      /Experimental adapter event[\s\S]*adapter\.experimental_event[\s\S]*Unknown event/u,
    );

    await act(async () => {
      clickFakeRuntimeWorkbenchElement(
        requireFakeRuntimeWorkbenchElementByData(
          dom.container,
          "streamEventSelect",
          "evt_live_unknown",
        ),
      );
      await drainDispatches();
      await waitFor(
        () =>
          requireRuntimeStreamPanel(session.getSnapshot()).selectedEvent?.id ===
          "evt_live_unknown",
      );
    });

    const selectedEvent = requireFakeRuntimeWorkbenchElementByData(
      dom.container,
      "streamSelectedEventKnownType",
      "false",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-type"),
      "adapter.experimental_event",
    );
    assert.equal(
      requireFakeRuntimeWorkbenchElementByData(
        selectedEvent,
        "streamSelectedEventTypeStatus",
        "unknown",
      ).textContent,
      "Unknown event",
    );
    assert.equal(
      selectedEvent.getAttribute("data-stream-selected-event-payload-kind"),
      "object",
    );
    assert.equal(
      selectedEvent.getAttribute(
        "data-stream-selected-event-payload-key-count",
      ),
      "1",
    );
    assert.doesNotMatch(
      fakeRuntimeWorkbenchNodeTextContent(selectedEvent),
      /secret_payload_value|payload_token|hidden metadata value/u,
    );
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

interface RuntimeWorkbenchLoopbackSseServerOptions {
  readonly firstStreamEvents?: readonly Readonly<Record<string, unknown>>[];
}

async function createRuntimeWorkbenchLoopbackSseServer(
  options: RuntimeWorkbenchLoopbackSseServerOptions = {},
): Promise<RuntimeWorkbenchLoopbackSseServer> {
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
      const events =
        acceptedStreamCount === 1
          ? (options.firstStreamEvents ?? [
              createRuntimeWorkbenchLoopbackStreamEvent({
                content: "live streamed content",
                eventId: "evt_live_model",
                seq: 1,
                title: "Live model response",
              }),
            ])
          : [
              createRuntimeWorkbenchLoopbackStreamEvent({
                content: "content after reset",
                eventId: "evt_live_after_reset",
                seq: 1,
                title: "Live model after reset",
              }),
            ];
      for (const event of events) {
        response.write(encodeRuntimeWorkbenchLoopbackSseFrame(event));
      }
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
    metadata: {
      "cw.trace": { value: "hidden metadata value" },
      "cw.ui": { value: "hidden metadata value" },
    },
  };
}

function createRuntimeWorkbenchLoopbackUnknownStreamEvent(): Record<
  string,
  unknown
> {
  return {
    event_id: "evt_live_unknown",
    schema_version: "0.1.0",
    seq: 1,
    parent_event_id: null,
    correlation_id: "trace_live_unknown",
    run_id: "run_live_smoke",
    node_id: null,
    attempt_id: null,
    type: "adapter.experimental_event",
    category: "system",
    phase: "attempt.streaming",
    title: "Experimental adapter event",
    summary: "Forward compatible event",
    content: "unknown live content",
    payload: { secret_payload_value: "payload_token" },
    artifact_refs: [],
    display_level: "default",
    severity: "info",
    sensitivity: "project",
    expandable: false,
    created_at: "2026-06-23T00:00:00.000Z",
    metadata: {
      "cw.trace": { value: "hidden metadata value" },
    },
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

interface RuntimeWorkbenchRunOnceRuntimeCall {
  readonly path: RuntimeRequestPath;
  readonly init?: RuntimeRequestInit;
}

function createRuntimeWorkbenchRunOnceSession(options: {
  readonly executionMode: RuntimeWorkbenchExecutionMode;
  readonly runtime?: Pick<RuntimeBridge, "fetch">;
}) {
  return createRuntimeWorkbenchSession({
    lifecyclePanelController:
      createFakeRuntimeWorkbenchLifecyclePanelController(),
    runtimeStreamController: createFakeRuntimeWorkbenchStreamController(),
    ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
    executionMode: options.executionMode,
  });
}

function createFakeRuntimeWorkbenchRunOnceRuntime(
  options: {
    readonly body?: unknown;
    readonly ok?: boolean;
    readonly status?: number;
  } = {},
): {
  readonly runtime: Pick<RuntimeBridge, "fetch">;
  readonly calls: readonly RuntimeWorkbenchRunOnceRuntimeCall[];
} {
  const calls: RuntimeWorkbenchRunOnceRuntimeCall[] = [];
  const runtime: Pick<RuntimeBridge, "fetch"> = Object.freeze({
    fetch: async <TBody,>(
      path: RuntimeRequestPath,
      init?: RuntimeRequestInit,
    ): Promise<RuntimeResponse<TBody>> => {
      calls.push(
        init === undefined
          ? { path }
          : { path, init: Object.freeze({ ...init }) },
      );
      return Object.freeze({
        ok: options.ok ?? true,
        status: options.status ?? 204,
        headers: Object.freeze({}),
        body: (options.body ?? null) as TBody | null,
      });
    },
  });
  return { runtime, calls };
}

function requireRuntimeWorkbenchRunOnceRuntimeCall(
  calls: readonly RuntimeWorkbenchRunOnceRuntimeCall[],
): RuntimeWorkbenchRunOnceRuntimeCall {
  const call = calls[0];
  if (call === undefined) {
    throw new Error("Expected runtime.fetch to be called");
  }
  return call;
}

function createFakeRuntimeWorkbenchLifecyclePanelController(): RuntimeLifecyclePanelSessionController {
  const listeners = new Set<() => void>();
  const snapshot = Object.freeze({
    activeSession: null,
    disposed: false,
  });
  return {
    activeSession: () => null,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    snapshot: () => snapshot,
    subscribe: (listener) => {
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
    openSession: () => {
      throw new Error("Lifecycle panel session is not used in this test");
    },
    disposeActiveSession: () => false,
    listenerCount: () => listeners.size,
    dispose: () => {
      listeners.clear();
      return true;
    },
    isDisposed: () => false,
  };
}

function createFakeRuntimeWorkbenchStreamController(): RuntimeStreamInteractionSessionController {
  const listeners =
    new Set<RuntimeStreamInteractionSessionControllerListener>();
  const snapshot = Object.freeze({
    activeChannel: null,
    activeSession: null,
    disposed: false,
  });
  return {
    activeSession: () => null,
    activeChannel: () => null,
    snapshot: () => snapshot,
    subscribe: (listener) => {
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
    openSession: () => {
      throw new Error("Runtime stream session is not used in this test");
    },
    disposeActiveSession: () => false,
    listenerCount: () => listeners.size,
    dispose: () => {
      listeners.clear();
      return true;
    },
    isDisposed: () => false,
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

function createRuntimeWorkbenchShellReactExecutionPolicy(
  mode: RuntimeWorkbenchShellSnapshot["executionPolicy"]["mode"] = "semi_auto",
): RuntimeWorkbenchShellSnapshot["executionPolicy"] {
  return Object.freeze({
    mode,
    availableModes: Object.freeze(["step", "semi_auto", "auto"] as const),
    canChangeMode: true,
    canRunOnce: mode === "step",
    runOnce: Object.freeze({
      status: "idle",
      method: "POST",
      path: null,
      runId: null,
      nodeId: null,
      statusCode: null,
      blockedReason: null,
    }),
  });
}

function createRuntimeWorkbenchShellReactProjectCreationSnapshot(
  input: Partial<RuntimeWorkbenchShellSnapshot["projectCreation"]> = {},
): RuntimeWorkbenchShellSnapshot["projectCreation"] {
  return Object.freeze({
    status: input.status ?? "idle",
    method: "POST",
    path: input.path ?? "/projects",
    displayName: input.displayName ?? null,
    hostPath: input.hostPath ?? null,
    projectId: input.projectId ?? null,
    gitInitialized: input.gitInitialized ?? null,
    firstCommitSha: input.firstCommitSha ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    canCreateProject: input.canCreateProject ?? true,
  });
}

function createRuntimeWorkbenchShellReactReferenceManagementSnapshot(
  input: Partial<RuntimeWorkbenchShellSnapshot["referenceManagement"]> = {},
): RuntimeWorkbenchShellSnapshot["referenceManagement"] {
  return Object.freeze({
    status: input.status ?? "idle",
    activeProjectId: input.activeProjectId ?? null,
    method: input.method ?? null,
    path: input.path ?? null,
    entries: input.entries ?? Object.freeze([]),
    indexSnapshotId: input.indexSnapshotId ?? null,
    lastReferenceId: input.lastReferenceId ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    canRefreshReferences: input.canRefreshReferences ?? true,
    canImportReference: input.canImportReference ?? true,
    canUpdateReference: input.canUpdateReference ?? true,
  });
}

function createRuntimeWorkbenchShellReactSkillManagementSnapshot(
  input: Partial<RuntimeWorkbenchShellSnapshot["skillManagement"]> = {},
): RuntimeWorkbenchShellSnapshot["skillManagement"] {
  return Object.freeze({
    status: input.status ?? "idle",
    activeProjectId: input.activeProjectId ?? null,
    method: input.method ?? null,
    path: input.path ?? null,
    entries: input.entries ?? Object.freeze([]),
    lastSkillId: input.lastSkillId ?? null,
    statusCode: input.statusCode ?? null,
    blockedReason: input.blockedReason ?? null,
    canRefreshSkills: input.canRefreshSkills ?? true,
    canUpdateSkill: input.canUpdateSkill ?? true,
  });
}

function createRuntimeWorkbenchShellReactSnapshot(
  options: {
    readonly activePanel?: RuntimeWorkbenchPanelId;
    readonly executionMode?: RuntimeWorkbenchShellSnapshot["executionPolicy"]["mode"];
    readonly referenceManagement?: Partial<
      RuntimeWorkbenchShellSnapshot["referenceManagement"]
    >;
    readonly skillManagement?: Partial<
      RuntimeWorkbenchShellSnapshot["skillManagement"]
    >;
  } = {},
): RuntimeWorkbenchShellSnapshot {
  return buildRuntimeWorkbenchShellSnapshot({
    activePanel: options.activePanel ?? "lifecycle",
    executionPolicy: createRuntimeWorkbenchShellReactExecutionPolicy(
      options.executionMode,
    ),
    projectCreation: createRuntimeWorkbenchShellReactProjectCreationSnapshot(),
    referenceManagement:
      createRuntimeWorkbenchShellReactReferenceManagementSnapshot(
        options.referenceManagement,
      ),
    skillManagement: createRuntimeWorkbenchShellReactSkillManagementSnapshot(
      options.skillManagement,
    ),
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

const RUNTIME_WORKBENCH_SHELL_REACT_MARKDOWN_STREAM_CONTENT = [
  "delta content with `inline_code` and <mark>marked token</mark> [trusted link](/artifacts/report.md) [blocked link](javascript:alert(1)).",
  "![blocked image](https://example.invalid/plot.png) <script>alert(1)</script>",
  "",
  "## Markdown detail",
  "- first item",
  "- second item",
  "",
  "| Metric | Value |",
  "| --- | --- |",
  "| status | ok |",
  "",
  "```",
  'const result = "ok";',
  "```",
].join("\n");

function createRuntimeWorkbenchShellReactStreamSnapshot(): RuntimeWorkbenchShellSnapshot {
  return buildRuntimeWorkbenchShellSnapshot({
    activePanel: "stream",
    executionPolicy: createRuntimeWorkbenchShellReactExecutionPolicy(),
    projectCreation: createRuntimeWorkbenchShellReactProjectCreationSnapshot(),
    referenceManagement:
      createRuntimeWorkbenchShellReactReferenceManagementSnapshot(),
    skillManagement: createRuntimeWorkbenchShellReactSkillManagementSnapshot(),
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
          schemaVersion: "0.1.0",
          seq: 7,
          parentEventId: "evt_react_parent",
          correlationId: "trace_react_stream",
          runId: "run_react_stream",
          nodeId: "node_react_model",
          attemptId: "attempt_react_stream",
          type: "model.text_delta",
          category: "model",
          phase: "attempt.streaming",
          displayLevel: "default",
          severity: "info",
          sensitivity: "project",
          title: "Model delta",
          summary: "delta summary",
          content: RUNTIME_WORKBENCH_SHELL_REACT_MARKDOWN_STREAM_CONTENT,
          expandable: true,
          payloadSummary: Object.freeze({
            present: true,
            kind: "object",
            keyCount: 1,
          }),
          metadataSummary: Object.freeze({
            present: true,
            kind: "object",
            keyCount: 2,
          }),
          expanded: false,
          childCount: 0,
          children: Object.freeze([]),
          artifactRefs: Object.freeze([
            Object.freeze({
              artifactId: "artifact_react_report",
              kind: "file",
              displayName: "Report draft",
              mimeType: "text/markdown",
              sizeBytes: 128,
              previewText: "Report preview",
              path: "artifacts/report.md",
            }),
          ]),
          createdAt: "2026-06-22T02:00:00.000Z",
        }),
      ]),
      selectedEvent: Object.freeze({
        id: "evt_react_stream",
        schemaVersion: "0.1.0",
        seq: 7,
        parentEventId: "evt_react_parent",
        correlationId: "trace_react_stream",
        runId: "run_react_stream",
        nodeId: "node_react_model",
        attemptId: "attempt_react_stream",
        type: "model.text_delta",
        category: "model",
        phase: "attempt.streaming",
        displayLevel: "default",
        severity: "info",
        sensitivity: "project",
        title: "Model delta",
        summary: "delta summary",
        content: RUNTIME_WORKBENCH_SHELL_REACT_MARKDOWN_STREAM_CONTENT,
        expandable: true,
        payloadSummary: Object.freeze({
          present: true,
          kind: "object",
          keyCount: 1,
        }),
        metadataSummary: Object.freeze({
          present: true,
          kind: "object",
          keyCount: 2,
        }),
        expanded: false,
        childCount: 0,
        children: Object.freeze([]),
        artifactRefs: Object.freeze([
          Object.freeze({
            artifactId: "artifact_react_report",
            kind: "file",
            displayName: "Report draft",
            mimeType: "text/markdown",
            sizeBytes: 128,
            previewText: "Report preview",
            path: "artifacts/report.md",
          }),
        ]),
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

function createRuntimeWorkbenchShellReactExpandedStreamEventSnapshot(): RuntimeWorkbenchShellSnapshot {
  const snapshot = createRuntimeWorkbenchShellReactStreamSnapshot();
  const panel = requireRuntimeStreamPanel(snapshot);
  const event = panel.timelineItems[0];
  if (event === undefined) {
    throw new Error("Expected stream event fixture");
  }
  const expandedEvent = Object.freeze({
    ...event,
    expanded: true,
  });
  return Object.freeze({
    ...snapshot,
    runtimeStreamPanel: Object.freeze({
      ...panel,
      timelineItems: Object.freeze([expandedEvent]),
      selectedEvent: expandedEvent,
    }),
  });
}

function createRuntimeWorkbenchShellReactUnknownStreamEventSnapshot(): RuntimeWorkbenchShellSnapshot {
  const snapshot = createRuntimeWorkbenchShellReactStreamSnapshot();
  const panel = requireRuntimeStreamPanel(snapshot);
  const event = panel.timelineItems[0];
  if (event === undefined) {
    throw new Error("Expected stream event fixture");
  }
  const unknownEvent = Object.freeze({
    ...event,
    id: "evt_react_unknown",
    seq: 11,
    parentEventId: null,
    correlationId: "trace_react_unknown",
    runId: "run_react_stream",
    nodeId: "node_react_adapter",
    attemptId: "attempt_react_unknown",
    type: "adapter.experimental_event",
    category: "system",
    phase: null,
    title: "Experimental adapter event",
    summary: "Forward-compatible event from a newer runtime",
    content: null,
    payloadSummary: Object.freeze({
      present: true,
      kind: "object",
      keyCount: 1,
    }),
    metadataSummary: Object.freeze({
      present: false,
      kind: "null",
      keyCount: 0,
    }),
    expanded: false,
    childCount: 0,
    children: Object.freeze([]),
    artifactRefs: Object.freeze([]),
    createdAt: "2026-06-24T02:30:00.000Z",
  });
  return Object.freeze({
    ...snapshot,
    runtimeStreamPanel: Object.freeze({
      ...panel,
      totalEvents: 1,
      bufferedEventCount: 1,
      matchingEventCount: 1,
      visibleEventCount: 1,
      hiddenEventCount: 0,
      search: Object.freeze({
        query: "experimental",
        matchCount: 1,
        activeMatchIndex: 0,
        activeEventId: "evt_react_unknown",
      }),
      timelineItems: Object.freeze([unknownEvent]),
      selectedEvent: unknownEvent,
    }),
  });
}

function createRuntimeWorkbenchShellReactExpandedStreamEventContentSnapshot(
  content: string,
): RuntimeWorkbenchShellSnapshot {
  const snapshot = createRuntimeWorkbenchShellReactStreamSnapshot();
  const panel = requireRuntimeStreamPanel(snapshot);
  const event = panel.timelineItems[0];
  if (event === undefined) {
    throw new Error("Expected stream event fixture");
  }
  const expandedEvent = Object.freeze({
    ...event,
    content,
    expanded: true,
  });
  return Object.freeze({
    ...snapshot,
    runtimeStreamPanel: Object.freeze({
      ...panel,
      timelineItems: Object.freeze([expandedEvent]),
      selectedEvent: expandedEvent,
    }),
  });
}

function createThrowingRuntimeWorkbenchStreamContent(text: string): string {
  return {
    replace(): never {
      throw new Error("Forced stream content render failure");
    },
    toString(): string {
      return text;
    },
  } as unknown as string;
}

function createRuntimeWorkbenchShellReactChatEnabledSnapshot(): RuntimeWorkbenchShellSnapshot {
  const snapshot = createRuntimeWorkbenchShellReactStreamSnapshot();
  return Object.freeze({
    ...snapshot,
    chrome: Object.freeze({
      ...snapshot.chrome,
      chatBox: Object.freeze({
        ...snapshot.chrome.chatBox,
        enabled: true,
        statusLabel: "Ready",
        collapsedSummary: "Stream focus, chat ready",
      }),
    }),
  });
}

function createRuntimeWorkbenchShellReactLifecycleSnapshot(): RuntimeWorkbenchShellSnapshot {
  return buildRuntimeWorkbenchShellSnapshot({
    activePanel: "lifecycle",
    executionPolicy: createRuntimeWorkbenchShellReactExecutionPolicy(),
    projectCreation: createRuntimeWorkbenchShellReactProjectCreationSnapshot(),
    referenceManagement:
      createRuntimeWorkbenchShellReactReferenceManagementSnapshot(),
    skillManagement: createRuntimeWorkbenchShellReactSkillManagementSnapshot(),
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
  multiple = false;
  selected = false;
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
    if (name === "multiple") {
      this.multiple = true;
    }
    if (name === "selected") {
      this.selected = true;
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
    if (name === "multiple") {
      this.multiple = false;
    }
    if (name === "selected") {
      this.selected = false;
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

  focus(_options?: FocusOptions): void {
    if (this.ownerDocument !== null) {
      this.ownerDocument.activeElement = this;
    }
  }

  get options(): readonly FakeRuntimeWorkbenchElement[] {
    return this.childNodes.filter(
      (child): child is FakeRuntimeWorkbenchElement =>
        child instanceof FakeRuntimeWorkbenchElement &&
        child.tagName === "OPTION",
    );
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

function keydownFakeRuntimeWorkbenchElement(
  element: FakeRuntimeWorkbenchElement,
  key: string,
  options: {
    readonly altKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly shiftKey?: boolean;
  } = {},
): boolean {
  assert.equal(element.disabled, false);
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", {
    configurable: true,
    value: key,
  });
  for (const [name, value] of Object.entries(options)) {
    Object.defineProperty(event, name, {
      configurable: true,
      value,
    });
  }
  return element.dispatchEvent(event);
}

function assertFakeRuntimeWorkbenchFocusedNode(
  root: FakeRuntimeWorkbenchElement,
  nodeId: string,
): void {
  const ownerDocument = root.ownerDocument;
  if (ownerDocument === null) {
    throw new Error("Expected fake DOM root to have an owner document");
  }
  assert.equal(
    ownerDocument.activeElement?.dataset.workflowCanvasNodeSelect,
    nodeId,
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

function countFakeRuntimeWorkbenchElements(
  root: FakeRuntimeWorkbenchNode,
  predicate: (element: FakeRuntimeWorkbenchElement) => boolean,
): number {
  const current =
    root instanceof FakeRuntimeWorkbenchElement && predicate(root) ? 1 : 0;
  return (
    current +
    root.childNodes.reduce(
      (count, child) =>
        count + countFakeRuntimeWorkbenchElements(child, predicate),
      0,
    )
  );
}

function fakeRuntimeWorkbenchElementAttributeValues(
  root: FakeRuntimeWorkbenchNode,
): string[] {
  const current =
    root instanceof FakeRuntimeWorkbenchElement
      ? Array.from(root.attributes.values())
      : [];
  return [
    ...current,
    ...root.childNodes.flatMap(fakeRuntimeWorkbenchElementAttributeValues),
  ];
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
