const fs = require("node:fs/promises");
const {
  resolveVisualSmokePreflight,
} = require("./runtime-workbench-visual-smoke-preflight.cjs");

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

const {
  targetUrl,
  outputPath,
  width,
  height,
  scrollY,
  targetLocation,
  outputEvidence,
  streamEventMode,
  chatBoxMode,
} = resolveVisualSmokePreflight(process.env);
const expectedSelectedTitle = "Startup timed out after bounded wait";

const { app, BrowserWindow } = require("electron");

function expectedStreamEvent(mode) {
  if (mode === "unknown") {
    return {
      category: "system",
      collapsedSelectionTitle: "Unknown event",
      knownType: "false",
      nodeId: "node_visual_adapter",
      summary: "forward compatible visual summary",
      title: "Visual experimental adapter event",
      type: "adapter.experimental_event",
      typeStatusLabel: "Unknown event type",
      unknownBadgeCount: 1,
    };
  }
  return {
    category: "model",
    collapsedSelectionTitle: "Visual stream delta",
    knownType: "true",
    nodeId: "node_visual_model",
    summary: "delta summary",
    title: "Visual stream delta",
    type: "model.text_delta",
    typeStatusLabel: "Known event type",
    unknownBadgeCount: 0,
  };
}

function countChatDraftWords(draft) {
  const trimmedDraft = draft.trim();
  if (trimmedDraft.length === 0) {
    return 0;
  }
  return trimmedDraft.split(/\s+/u).length;
}

async function readMetrics(window) {
  return window.webContents.executeJavaScript(`
    (() => ({
      hasRoot: document.querySelector('.cw-workbench') !== null,
      hasDock: document.querySelector('.cw-workbench__dock') !== null,
      hasFileTree: document.querySelector('.cw-workbench__file-tree') !== null,
      hasVersionSnapshots:
        document.querySelector('.cw-workbench__version-snapshots') !== null,
      hasWorkflowCanvas:
        document.querySelector('.cw-workbench__workflow-canvas') !== null,
      activePanelText:
        document.querySelector('.cw-workbench__status dd')?.textContent ?? null,
      activePanelTabs:
        document.querySelectorAll('.cw-workbench__tab[aria-current="page"]').length,
      canvasTabActive:
        document.querySelector('.cw-workbench__tab[data-panel="canvas"][aria-current="page"]') !== null,
      lifecycleTabActive:
        document.querySelector('.cw-workbench__tab[data-panel="lifecycle"][aria-current="page"]') !== null,
      canvasDockActive:
        document.querySelector('.cw-workbench__dock-item[data-panel="canvas"][aria-current="page"]') !== null,
      hasLifecyclePanel: document.querySelector('.cw-workbench__lifecycle-panel') !== null,
      hasStreamPanel: document.querySelector('.cw-workbench__stream-panel') !== null,
      streamPanelExpanded:
        document.querySelector('.cw-workbench__stream-panel')?.getAttribute('data-stream-panel-expanded') ?? null,
      streamPanelToggleButtons:
        document.querySelectorAll('[data-stream-panel-toggle="true"]').length,
      streamPanelToggleExpanded:
        document.querySelector('[data-stream-panel-toggle="true"]')?.getAttribute('aria-expanded') ?? null,
      streamPanelControls:
        document.querySelectorAll('.cw-workbench__stream-controls').length,
      streamControlsExpanded:
        document.querySelector('.cw-workbench__stream-controls')?.getAttribute('data-stream-controls-expanded') ?? null,
      streamControlsToggleButtons:
        document.querySelectorAll('[data-stream-controls-toggle="true"]').length,
      streamControlsToggleExpanded:
        document.querySelector('[data-stream-controls-toggle="true"]')?.getAttribute('aria-expanded') ?? null,
      streamControlsBodies:
        document.querySelectorAll('[data-stream-controls-body="true"]').length,
      streamControlsCollapsedSummary:
        document.querySelector('[data-stream-controls-collapsed-summary="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamControlsCollapsedQuery:
        document.querySelector('[data-stream-controls-collapsed-summary="true"]')?.getAttribute('data-stream-controls-collapsed-query') ?? null,
      streamControlsCollapsedMatches:
        document.querySelector('[data-stream-controls-collapsed-summary="true"]')?.getAttribute('data-stream-controls-collapsed-matches') ?? null,
      streamControlsCollapsedUnread:
        document.querySelector('[data-stream-controls-collapsed-summary="true"]')?.getAttribute('data-stream-controls-collapsed-unread') ?? null,
      streamPanelBodies:
        document.querySelectorAll('.cw-workbench__stream-panel-body').length,
      streamFullReloads:
        document.querySelectorAll('.cw-workbench__stream-full-reload').length,
      streamFullReloadExpanded:
        document.querySelector('.cw-workbench__stream-full-reload')?.getAttribute('data-stream-full-reload-expanded') ?? null,
      streamFullReloadStatus:
        document.querySelector('.cw-workbench__stream-full-reload')?.getAttribute('data-stream-full-reload-status') ?? null,
      streamFullReloadLastEventId:
        document.querySelector('.cw-workbench__stream-full-reload')?.getAttribute('data-stream-full-reload-last-event-id') ?? null,
      streamFullReloadDetailToggles:
        document.querySelectorAll('[data-stream-full-reload-details-toggle="true"]').length,
      streamFullReloadDetailToggleExpanded:
        document.querySelector('[data-stream-full-reload-details-toggle="true"]')?.getAttribute('aria-expanded') ?? null,
      streamFullReloadDetails:
        document.querySelectorAll('[data-stream-full-reload-details="true"]').length,
      streamFullReloadDetailsStatus:
        document.querySelector('[data-stream-full-reload-details="true"]')?.getAttribute('data-stream-full-reload-details-status') ?? null,
      streamFullReloadDetailsErrorCode:
        document.querySelector('[data-stream-full-reload-details="true"]')?.getAttribute('data-stream-full-reload-details-error-code') ?? null,
      streamFullReloadDetailsLastEventId:
        document.querySelector('[data-stream-full-reload-details="true"]')?.getAttribute('data-stream-full-reload-details-last-event-id') ?? null,
      streamFullReloadAcknowledgeButtons:
        document.querySelectorAll('[data-stream-full-reload-acknowledge="true"]').length,
      streamEventSelectButtons:
        document.querySelectorAll('[data-stream-event-id]').length,
      streamExpandedEvents:
        document.querySelectorAll('[data-stream-event-expanded="true"]').length,
      streamEventKnownType:
        document.querySelector('[data-stream-event-known-type]')?.getAttribute('data-stream-event-known-type') ?? null,
      streamEventTypeStatusBadges:
        document.querySelectorAll('[data-stream-event-type-status="unknown"]').length,
      streamEventExpandToggleButtons:
        document.querySelectorAll('[data-stream-event-expand-toggle]').length,
      streamEventExpandToggleExpanded:
        document.querySelector('[data-stream-event-expand-toggle="evt_visual_stream"]')?.getAttribute('aria-expanded') ?? null,
      streamEventDetails:
        document.querySelectorAll('[data-stream-event-detail="true"]').length,
      streamEventDetailText:
        document.querySelector('[data-stream-event-detail="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamEventDetailContent:
        document.querySelector('[data-stream-event-detail-content="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamEventDetailContentHeadingCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-heading-count') ?? null,
      streamEventDetailContentListCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-list-count') ?? null,
      streamEventDetailContentCodeBlockCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-code-block-count') ?? null,
      streamEventDetailContentFallback:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-fallback') ?? null,
      streamEventDetailContentFallbackReason:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-fallback-reason') ?? null,
      streamEventDetailContentTableCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-table-count') ?? null,
      streamEventDetailContentLinkCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-link-count') ?? null,
      streamEventDetailContentMarkCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-mark-count') ?? null,
      streamEventDetailContentBlockedHtmlCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-blocked-html-count') ?? null,
      streamEventDetailContentBlockedImageCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-blocked-image-count') ?? null,
      streamEventDetailContentBlockedLinkCount:
        document.querySelector('[data-stream-content="event-detail"]')?.getAttribute('data-stream-content-blocked-link-count') ?? null,
      streamEventDetailContentLinkHref:
        document.querySelector('[data-stream-content="event-detail"] a')?.getAttribute('href') ?? null,
      streamEventDetailContentScriptCount:
        document.querySelectorAll('[data-stream-content="event-detail"] script').length,
      streamEventDetailContentImageCount:
        document.querySelectorAll('[data-stream-content="event-detail"] img').length,
      streamEventDetailSchemaVersion:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-schema-version') ?? null,
      streamEventDetailSeq:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-seq') ?? null,
      streamEventDetailCreatedAt:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-created-at') ?? null,
      streamEventDetailCategory:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-category') ?? null,
      streamEventDetailDisplayLevel:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-display-level') ?? null,
      streamEventDetailSeverity:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-severity') ?? null,
      streamEventDetailEventId:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-event-id') ?? null,
      streamEventDetailType:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-type') ?? null,
      streamEventDetailTitle:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-title') ?? null,
      streamEventDetailSummary:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-summary') ?? null,
      streamEventDetailExpandable:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-expandable') ?? null,
      streamEventDetailKnownType:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-known-type') ?? null,
      streamEventDetailPayloadPresent:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-payload-present') ?? null,
      streamEventDetailPayloadKind:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-payload-kind') ?? null,
      streamEventDetailPayloadKeyCount:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-payload-key-count') ?? null,
      streamEventDetailMetadataPresent:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-metadata-present') ?? null,
      streamEventDetailMetadataKind:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-metadata-kind') ?? null,
      streamEventDetailMetadataKeyCount:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-metadata-key-count') ?? null,
      streamEventDetailParentId:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-parent-id') ?? null,
      streamEventDetailCorrelationId:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-correlation-id') ?? null,
      streamEventDetailRunId:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-run-id') ?? null,
      streamEventDetailNodeId:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-node-id') ?? null,
      streamEventDetailAttemptId:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-attempt-id') ?? null,
      streamEventDetailPhase:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-phase') ?? null,
      streamEventDetailSensitivity:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-sensitivity') ?? null,
      streamEventDetailChildCount:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-child-count') ?? null,
      streamEventDetailArtifactCount:
        document.querySelector('[data-stream-event-detail="true"]')?.getAttribute('data-stream-event-detail-artifact-count') ?? null,
      streamEventDetailArtifactRefs:
        document.querySelectorAll('[data-stream-artifact-ref="event-detail"]').length,
      streamEventDetailArtifactId:
        document.querySelector('[data-stream-artifact-ref="event-detail"]')?.getAttribute('data-stream-artifact-ref-id') ?? null,
      streamEventDetailArtifactKind:
        document.querySelector('[data-stream-artifact-ref="event-detail"]')?.getAttribute('data-stream-artifact-ref-kind') ?? null,
      streamEventDetailArtifactPath:
        document.querySelector('[data-stream-artifact-ref="event-detail"]')?.getAttribute('data-stream-artifact-ref-path') ?? null,
      streamEventGroups:
        document.querySelectorAll('[data-stream-event-group]').length,
      streamEventGroupToggleButtons:
        document.querySelectorAll('[data-stream-event-group-toggle]').length,
      streamSummaryGroupExpanded:
        document.querySelector('[data-stream-event-group="summary"]')?.getAttribute('data-stream-event-group-expanded') ?? null,
      streamTimelineGroupExpanded:
        document.querySelector('[data-stream-event-group="timeline"]')?.getAttribute('data-stream-event-group-expanded') ?? null,
      streamTimelineGroupCount:
        document.querySelector('[data-stream-event-group="timeline"]')?.getAttribute('data-stream-event-group-count') ?? null,
      streamTimelineGroupToggleExpanded:
        document.querySelector('[data-stream-event-group-toggle="timeline"]')?.getAttribute('aria-expanded') ?? null,
      streamTimelineGroupCollapsedSummary:
        document.querySelector('[data-stream-event-group-collapsed-summary="timeline"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamTimelineGroupCollapsedCount:
        document.querySelector('[data-stream-event-group-collapsed-summary="timeline"]')?.getAttribute('data-stream-event-group-collapsed-count') ?? null,
      streamSelectionExpanded:
        document.querySelector('.cw-workbench__stream-selection')?.getAttribute('data-stream-selection-expanded') ?? null,
      streamSelectionSelectedId:
        document.querySelector('.cw-workbench__stream-selection')?.getAttribute('data-stream-selection-selected-id') ?? null,
      streamSelectionToggleButtons:
        document.querySelectorAll('[data-stream-selection-toggle="true"]').length,
      streamSelectionToggleExpanded:
        document.querySelector('[data-stream-selection-toggle="true"]')?.getAttribute('aria-expanded') ?? null,
      streamSelectedEventBodies:
        document.querySelectorAll('[data-stream-selected-event="true"]').length,
      streamSelectedEventKnownType:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-known-type') ?? null,
      streamSelectedEventTypeStatusBadges:
        document.querySelectorAll('[data-stream-selected-event-type-status="unknown"]').length,
      streamSelectedEventContentText:
        document.querySelector('[data-stream-content="selection"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamSelectedEventContentHeadingCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-heading-count') ?? null,
      streamSelectedEventContentListCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-list-count') ?? null,
      streamSelectedEventContentCodeBlockCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-code-block-count') ?? null,
      streamSelectedEventContentFallback:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-fallback') ?? null,
      streamSelectedEventContentFallbackReason:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-fallback-reason') ?? null,
      streamSelectedEventContentTableCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-table-count') ?? null,
      streamSelectedEventContentLinkCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-link-count') ?? null,
      streamSelectedEventContentMarkCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-mark-count') ?? null,
      streamSelectedEventContentBlockedHtmlCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-blocked-html-count') ?? null,
      streamSelectedEventContentBlockedImageCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-blocked-image-count') ?? null,
      streamSelectedEventContentBlockedLinkCount:
        document.querySelector('[data-stream-content="selection"]')?.getAttribute('data-stream-content-blocked-link-count') ?? null,
      streamSelectedEventContentScriptCount:
        document.querySelectorAll('[data-stream-content="selection"] script').length,
      streamSelectedEventContentImageCount:
        document.querySelectorAll('[data-stream-content="selection"] img').length,
      streamSelectedEventSchemaVersion:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-schema-version') ?? null,
      streamSelectedEventSeq:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-seq') ?? null,
      streamSelectedEventCreatedAt:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-created-at') ?? null,
      streamSelectedEventCategory:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-category') ?? null,
      streamSelectedEventDisplayLevel:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-display-level') ?? null,
      streamSelectedEventSeverity:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-severity') ?? null,
      streamSelectedEventId:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-id') ?? null,
      streamSelectedEventType:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-type') ?? null,
      streamSelectedEventTitle:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-title') ?? null,
      streamSelectedEventSummary:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-summary') ?? null,
      streamSelectedEventExpandable:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-expandable') ?? null,
      streamSelectedEventPayloadPresent:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-payload-present') ?? null,
      streamSelectedEventPayloadKind:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-payload-kind') ?? null,
      streamSelectedEventPayloadKeyCount:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-payload-key-count') ?? null,
      streamSelectedEventMetadataPresent:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-metadata-present') ?? null,
      streamSelectedEventMetadataKind:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-metadata-kind') ?? null,
      streamSelectedEventMetadataKeyCount:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-metadata-key-count') ?? null,
      streamSelectedEventParentId:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-parent-id') ?? null,
      streamSelectedEventCorrelationId:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-correlation-id') ?? null,
      streamSelectedEventRunId:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-run-id') ?? null,
      streamSelectedEventNodeId:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-node-id') ?? null,
      streamSelectedEventAttemptId:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-attempt-id') ?? null,
      streamSelectedEventPhase:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-phase') ?? null,
      streamSelectedEventSensitivity:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-sensitivity') ?? null,
      streamSelectedEventChildCount:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-child-count') ?? null,
      streamSelectedEventArtifactCount:
        document.querySelector('[data-stream-selected-event="true"]')?.getAttribute('data-stream-selected-event-artifact-count') ?? null,
      streamSelectedEventArtifactRefs:
        document.querySelectorAll('[data-stream-artifact-ref="selection"]').length,
      streamSelectedEventArtifactId:
        document.querySelector('[data-stream-artifact-ref="selection"]')?.getAttribute('data-stream-artifact-ref-id') ?? null,
      streamSelectedEventArtifactKind:
        document.querySelector('[data-stream-artifact-ref="selection"]')?.getAttribute('data-stream-artifact-ref-kind') ?? null,
      streamSelectedEventArtifactPath:
        document.querySelector('[data-stream-artifact-ref="selection"]')?.getAttribute('data-stream-artifact-ref-path') ?? null,
      streamSelectionMetadataToggles:
        document.querySelectorAll('[data-stream-selection-metadata-toggle="true"]').length,
      streamSelectionMetadataToggleExpanded:
        document.querySelector('[data-stream-selection-metadata-toggle="true"]')?.getAttribute('aria-expanded') ?? null,
      streamSelectionMetadataDetails:
        document.querySelectorAll('[data-stream-selection-metadata="true"]').length,
      streamSelectionMetadataText:
        document.querySelector('[data-stream-selection-metadata="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamSelectionMetadataCategory:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-category') ?? null,
      streamSelectionMetadataDisplayLevel:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-display-level') ?? null,
      streamSelectionMetadataSeverity:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-severity') ?? null,
      streamSelectionMetadataEventId:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-event-id') ?? null,
      streamSelectionMetadataType:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-type') ?? null,
      streamSelectionMetadataTitle:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-title') ?? null,
      streamSelectionMetadataSummary:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-summary') ?? null,
      streamSelectionMetadataPayloadPresent:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-payload-present') ?? null,
      streamSelectionMetadataPayloadKind:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-payload-kind') ?? null,
      streamSelectionMetadataPayloadKeyCount:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-payload-key-count') ?? null,
      streamSelectionMetadataMetadataPresent:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-metadata-present') ?? null,
      streamSelectionMetadataMetadataKind:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-metadata-kind') ?? null,
      streamSelectionMetadataMetadataKeyCount:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-metadata-key-count') ?? null,
      streamSelectionMetadataSchemaVersion:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-schema-version') ?? null,
      streamSelectionMetadataSeq:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-seq') ?? null,
      streamSelectionMetadataCreatedAt:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-created-at') ?? null,
      streamSelectionMetadataCorrelationId:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-correlation-id') ?? null,
      streamSelectionMetadataRunId:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-run-id') ?? null,
      streamSelectionMetadataNodeId:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-node-id') ?? null,
      streamSelectionMetadataAttemptId:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-attempt-id') ?? null,
      streamSelectionMetadataPhase:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-phase') ?? null,
      streamSelectionMetadataSensitivity:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-sensitivity') ?? null,
      streamSelectionMetadataParentId:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-parent-id') ?? null,
      streamSelectionMetadataChildCount:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-child-count') ?? null,
      streamSelectionMetadataExpandable:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-expandable') ?? null,
      streamSelectionMetadataKnownType:
        document.querySelector('[data-stream-selection-metadata="true"]')?.getAttribute('data-stream-selection-metadata-known-type') ?? null,
      streamSelectionCollapsedSummary:
        document.querySelector('[data-stream-selection-collapsed-summary="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamSelectionCollapsedSelectedId:
        document.querySelector('[data-stream-selection-collapsed-summary="true"]')?.getAttribute('data-stream-selection-collapsed-selected-id') ?? null,
      streamSelectionCollapsedSelectedType:
        document.querySelector('[data-stream-selection-collapsed-summary="true"]')?.getAttribute('data-stream-selection-collapsed-selected-type') ?? null,
      streamPanelCollapsedSummary:
        document.querySelector('[data-stream-panel-collapsed-summary="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      streamPanelCollapsedVisible:
        document.querySelector('[data-stream-panel-collapsed-summary="true"]')?.getAttribute('data-stream-panel-collapsed-visible') ?? null,
      streamPanelCollapsedUnread:
        document.querySelector('[data-stream-panel-collapsed-summary="true"]')?.getAttribute('data-stream-panel-collapsed-unread') ?? null,
      hasTaskDrawer: document.querySelector('.cw-workbench__task-drawer') !== null,
      hasChatBox: document.querySelector('.cw-workbench__chat') !== null,
      dockItems: document.querySelectorAll('.cw-workbench__dock-item').length,
      fileTreeNodes: document.querySelectorAll('.cw-workbench__file-tree-node').length,
      fileTreeSelectableNodes:
        document.querySelectorAll('[data-file-tree-node-select]').length,
      selectedFileTreeNodes:
        document.querySelectorAll('[data-file-tree-node-selected="true"]').length,
      selectedFileTreeNodeId:
        document.querySelector('[data-file-tree-node-selected="true"]')?.getAttribute('data-file-tree-node') ?? null,
      fileTreeDetailsNodeId:
        document.querySelector('[data-file-tree-details]')?.getAttribute('data-file-tree-details') ?? null,
      fileTreeDetailsPath:
        document.querySelector('[data-file-tree-details]')?.getAttribute('data-file-tree-details-path') ?? null,
      fileTreeDetailsStatus:
        document.querySelector('[data-file-tree-details]')?.getAttribute('data-file-tree-details-status') ?? null,
      fileTreeDetailsDepth:
        document.querySelector('[data-file-tree-details]')?.getAttribute('data-file-tree-details-depth') ?? null,
      versionSnapshotItems:
        document.querySelectorAll('.cw-workbench__version-snapshot-item').length,
      activeVersionSnapshotItems:
        document.querySelectorAll('.cw-workbench__version-snapshot-item--active').length,
      versionSnapshotSelectableItems:
        document.querySelectorAll('[data-version-snapshot-select]').length,
      selectedVersionSnapshotItems:
        document.querySelectorAll('[data-version-snapshot-selected="true"]').length,
      selectedVersionSnapshotId:
        document.querySelector('[data-version-snapshot-selected="true"]')?.getAttribute('data-version-snapshot') ?? null,
      versionSnapshotDetailsId:
        document.querySelector('[data-version-snapshot-details]')?.getAttribute('data-version-snapshot-details') ?? null,
      versionSnapshotDetailsValue:
        document.querySelector('[data-version-snapshot-details]')?.getAttribute('data-version-snapshot-details-value') ?? null,
      versionSnapshotDetailsStatus:
        document.querySelector('[data-version-snapshot-details]')?.getAttribute('data-version-snapshot-details-status') ?? null,
      versionSnapshotDetailsActive:
        document.querySelector('[data-version-snapshot-details]')?.getAttribute('data-version-snapshot-details-active') ?? null,
      versionSnapshotDetailsText:
        document.querySelector('[data-version-snapshot-details]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      workflowCanvasNodes:
        document.querySelectorAll('.cw-workbench__workflow-canvas-node').length,
      workflowCanvasEdges:
        document.querySelectorAll('.cw-workbench__workflow-canvas-edge').length,
      previewWorkflowCanvasSurfaces:
        document.querySelectorAll('[data-workflow-canvas-surface="preview"]').length,
      focusedWorkflowCanvasSurfaces:
        document.querySelectorAll('[data-workflow-canvas-surface="focused"]').length,
      workflowCanvasSummaries:
        document.querySelectorAll('[data-workflow-canvas-summary="true"]').length,
      workflowCanvasSummaryNodes:
        document.querySelector('[data-workflow-canvas-summary="true"]')?.getAttribute('data-workflow-canvas-summary-nodes') ?? null,
      workflowCanvasSummaryEdges:
        document.querySelector('[data-workflow-canvas-summary="true"]')?.getAttribute('data-workflow-canvas-summary-edges') ?? null,
      workflowCanvasSummaryActiveNodes:
        document.querySelector('[data-workflow-canvas-summary="true"]')?.getAttribute('data-workflow-canvas-summary-active-nodes') ?? null,
      workflowCanvasSummaryEntryNodes:
        document.querySelector('[data-workflow-canvas-summary="true"]')?.getAttribute('data-workflow-canvas-summary-entry-nodes') ?? null,
      workflowCanvasSummaryTerminalNodes:
        document.querySelector('[data-workflow-canvas-summary="true"]')?.getAttribute('data-workflow-canvas-summary-terminal-nodes') ?? null,
      workflowCanvasSummaryNodeTypes:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-summary-node-type]'),
          (element) =>
            (element.getAttribute('data-workflow-canvas-summary-node-type') ?? '') +
            ':' +
            (element.getAttribute('data-workflow-canvas-summary-count') ?? '')
        ).filter(Boolean).sort(),
      workflowCanvasSummaryEdgeTypes:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-summary-edge-type]'),
          (element) =>
            (element.getAttribute('data-workflow-canvas-summary-edge-type') ?? '') +
            ':' +
            (element.getAttribute('data-workflow-canvas-summary-count') ?? '')
        ).filter(Boolean).sort(),
      workflowCanvasTypeFocusButtons:
        document.querySelectorAll('button[data-workflow-canvas-type-focus-kind][data-workflow-canvas-type-focus-value]').length,
      workflowCanvasTypeFocusActiveButtons:
        document.querySelectorAll('[data-workflow-canvas-type-focus-active="true"]').length,
      workflowCanvasTypeFocusKind:
        document.querySelector('[data-workflow-canvas-summary="true"]')?.getAttribute('data-workflow-canvas-type-focus-kind') ?? null,
      workflowCanvasTypeFocusValue:
        document.querySelector('[data-workflow-canvas-summary="true"]')?.getAttribute('data-workflow-canvas-type-focus-value') ?? null,
      workflowCanvasTypeFocusDetailsKind:
        document.querySelector('[data-workflow-canvas-type-focus-details]')?.getAttribute('data-workflow-canvas-type-focus-details') ?? null,
      workflowCanvasTypeFocusDetailsValue:
        document.querySelector('[data-workflow-canvas-type-focus-details]')?.getAttribute('data-workflow-canvas-type-focus-details-value') ?? null,
      workflowCanvasTypeFocusMatchCount:
        document.querySelector('[data-workflow-canvas-type-focus-details]')?.getAttribute('data-workflow-canvas-type-focus-match-count') ?? null,
      workflowCanvasTypeFocusNodeMatches:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-type-focus-node-match]'),
          (element) => element.getAttribute('data-workflow-canvas-type-focus-node-match')
        ).filter(Boolean).sort(),
      workflowCanvasTypeFocusNodeSelectButtons:
        document.querySelectorAll('[data-workflow-canvas-type-focus-node-select]').length,
      workflowCanvasTypeFocusEdgeMatches:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-type-focus-edge-match]'),
          (element) => element.getAttribute('data-workflow-canvas-type-focus-edge-match')
        ).filter(Boolean).sort(),
      activeWorkflowCanvasNodes:
        document.querySelectorAll('.cw-workbench__workflow-canvas-node--active').length,
      selectedWorkflowCanvasNodes:
        document.querySelectorAll('[data-workflow-canvas-node-selected="true"]').length,
      selectedWorkflowCanvasNodeId:
        document.querySelector('[data-workflow-canvas-node-selected="true"]')?.getAttribute('data-workflow-canvas-node') ?? null,
      focusedWorkflowCanvasNodeId:
        document.activeElement instanceof HTMLElement
          ? document.activeElement.getAttribute('data-workflow-canvas-node-select')
          : null,
      selectableWorkflowCanvasNodes:
        document.querySelectorAll('[data-workflow-canvas-node-select]').length,
      typeFocusedWorkflowCanvasNodes:
        document.querySelectorAll('[data-workflow-canvas-node-type-focused="true"]').length,
      typeFocusedWorkflowCanvasNodeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-node-type-focused="true"]'),
          (element) => element.getAttribute('data-workflow-canvas-node')
        ).filter(Boolean).sort(),
      selectedWorkflowCanvasEdges:
        document.querySelectorAll('[data-workflow-canvas-edge-selected="true"]').length,
      selectedWorkflowCanvasEdgeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-edge-selected="true"]'),
          (element) => element.getAttribute('data-workflow-canvas-edge')
        ).filter(Boolean).sort(),
      typeFocusedWorkflowCanvasEdges:
        document.querySelectorAll('[data-workflow-canvas-edge-type-focused="true"]').length,
      typeFocusedWorkflowCanvasEdgeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-edge-type-focused="true"]'),
          (element) => element.getAttribute('data-workflow-canvas-edge')
        ).filter(Boolean).sort(),
      incomingWorkflowCanvasEdges:
        document.querySelectorAll('[data-workflow-canvas-edge-direction="incoming"]').length,
      incomingWorkflowCanvasEdgeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-edge-direction="incoming"]'),
          (element) => element.getAttribute('data-workflow-canvas-edge')
        ).filter(Boolean).sort(),
      outgoingWorkflowCanvasEdges:
        document.querySelectorAll('[data-workflow-canvas-edge-direction="outgoing"]').length,
      outgoingWorkflowCanvasEdgeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-edge-direction="outgoing"]'),
          (element) => element.getAttribute('data-workflow-canvas-edge')
        ).filter(Boolean).sort(),
      workflowCanvasInspectorNodeId:
        document.querySelector('.cw-workbench__workflow-canvas-inspector')?.getAttribute('data-workflow-canvas-inspector') ?? null,
      workflowCanvasInspectorTitle:
        document.querySelector('.cw-workbench__workflow-canvas-inspector h3')?.textContent ?? null,
      workflowCanvasInspectorHistoryDepth:
        document.querySelector('.cw-workbench__workflow-canvas-inspector')?.getAttribute('data-workflow-canvas-inspector-history-depth') ?? null,
      workflowCanvasInspectorBackButtons:
        document.querySelectorAll('[data-workflow-canvas-inspector-back="true"]').length,
      workflowCanvasInspectorBackTarget:
        document.querySelector('[data-workflow-canvas-inspector-back="true"]')?.getAttribute('data-workflow-canvas-inspector-back-target') ?? null,
      workflowCanvasHistoryTrailItems:
        document.querySelectorAll('[data-workflow-canvas-history-select]').length,
      workflowCanvasHistoryTrailNodeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-history-select]'),
          (element) =>
            (element.getAttribute('data-workflow-canvas-history-index') ?? '') +
            ':' +
            (element.getAttribute('data-workflow-canvas-history-select') ?? '')
        ).filter(Boolean),
      workflowCanvasInspectorEdges:
        document.querySelectorAll('[data-workflow-canvas-inspector-edge]').length,
      workflowCanvasInspectorEdgeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-inspector-edge]'),
          (element) => element.getAttribute('data-workflow-canvas-inspector-edge')
        ).filter(Boolean).sort(),
      workflowCanvasInspectorRouteButtons:
        document.querySelectorAll('[data-workflow-canvas-route-select]').length,
      workflowCanvasInspectorRouteSelectNodeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-route-select]'),
          (element) => element.getAttribute('data-workflow-canvas-route-select')
        ).filter(Boolean).sort(),
      activeFileTreeNodes:
        document.querySelectorAll('.cw-workbench__file-tree-node--active').length,
      hasRuntimeStreamFileNode:
        document.querySelector('[data-file-tree-node="runtime_stream"]') !== null,
      hasGitSnapshotItem:
        document.querySelector('[data-version-snapshot="git_snapshot"]') !== null,
      hasRepairCanvasEdge:
        document.querySelector('[data-workflow-canvas-edge="repair_to_context"]') !== null,
      hasTaskDrawerToggle: document.querySelector('[data-task-drawer-toggle="true"]') !== null,
      hasChatBoxToggle: document.querySelector('[data-chat-box-toggle="true"]') !== null,
      taskDrawerExpanded:
        document.querySelector('.cw-workbench__task-drawer')?.getAttribute('data-task-drawer-expanded') ?? null,
      taskDrawerItems: document.querySelectorAll('.cw-workbench__task-drawer-item').length,
      taskDrawerSelectableItems:
        document.querySelectorAll('[data-task-drawer-item-select]').length,
      selectedTaskDrawerItems:
        document.querySelectorAll('[data-task-drawer-item-selected="true"]').length,
      selectedTaskDrawerItemId:
        document.querySelector('[data-task-drawer-item-selected="true"]')?.getAttribute('data-task-drawer-item') ?? null,
      taskDrawerDetailsId:
        document.querySelector('[data-task-drawer-details]')?.getAttribute('data-task-drawer-details') ?? null,
      taskDrawerDetailsLabel:
        document.querySelector('[data-task-drawer-details]')?.getAttribute('data-task-drawer-details-label') ?? null,
      taskDrawerDetailsTone:
        document.querySelector('[data-task-drawer-details]')?.getAttribute('data-task-drawer-details-tone') ?? null,
      taskDrawerDetailsValue:
        document.querySelector('[data-task-drawer-details]')?.getAttribute('data-task-drawer-details-value') ?? null,
      taskDrawerDetailsText:
        document.querySelector('[data-task-drawer-details]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      taskDrawerCollapsedSummary:
        document.querySelector('.cw-workbench__task-drawer-collapsed')?.textContent ?? null,
      chatBoxExpanded:
        document.querySelector('.cw-workbench__chat')?.getAttribute('data-chat-box-expanded') ?? null,
      chatComposeControls:
        document.querySelectorAll('.cw-workbench__chat-compose textarea, .cw-workbench__chat-compose button').length,
      chatDraftIntentButtons:
        document.querySelectorAll('[data-chat-draft-intent][data-chat-draft-intent-active]').length,
      activeChatDraftIntentButtons:
        document.querySelectorAll('[data-chat-draft-intent-active="true"]').length,
      activeChatDraftIntent:
        document.querySelector('[data-chat-draft-intent-active="true"]')?.getAttribute('data-chat-draft-intent') ?? null,
      chatDraftInputs:
        document.querySelectorAll('[data-chat-draft-input="true"]').length,
      chatDraftValue:
        document.querySelector('[data-chat-draft-input="true"]')?.value ?? null,
      chatDraftIntent:
        document.querySelector('[data-chat-draft-details="true"]')?.getAttribute('data-chat-draft-intent') ?? null,
      chatDraftIntentLabel:
        document.querySelector('[data-chat-draft-details="true"]')?.getAttribute('data-chat-draft-intent-label') ?? null,
      chatDraftLength:
        document.querySelector('[data-chat-draft-details="true"]')?.getAttribute('data-chat-draft-length') ?? null,
      chatDraftWords:
        document.querySelector('[data-chat-draft-details="true"]')?.getAttribute('data-chat-draft-words') ?? null,
      chatDraftStatus:
        document.querySelector('[data-chat-draft-details="true"]')?.getAttribute('data-chat-draft-status') ?? null,
      chatDraftSendEnabled:
        document.querySelector('[data-chat-draft-details="true"]')?.getAttribute('data-chat-draft-send-enabled') ?? null,
      chatDraftSendReason:
        document.querySelector('[data-chat-draft-details="true"]')?.getAttribute('data-chat-draft-send-reason') ?? null,
      chatDraftDetailsText:
        document.querySelector('[data-chat-draft-details="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      chatDraftPreviewState:
        document.querySelector('[data-chat-draft-preview="true"]')?.getAttribute('data-chat-draft-preview-state') ?? null,
      chatDraftPreviewReason:
        document.querySelector('[data-chat-draft-preview="true"]')?.getAttribute('data-chat-draft-preview-reason') ?? null,
      chatDraftPreviewReady:
        document.querySelector('[data-chat-draft-preview="true"]')?.getAttribute('data-chat-draft-preview-ready') ?? null,
      chatDraftPreviewIntent:
        document.querySelector('[data-chat-draft-preview="true"]')?.getAttribute('data-chat-draft-preview-intent') ?? null,
      chatDraftPreviewIntentLabel:
        document.querySelector('[data-chat-draft-preview="true"]')?.getAttribute('data-chat-draft-preview-intent-label') ?? null,
      chatDraftPreviewTarget:
        document.querySelector('[data-chat-draft-preview="true"]')?.getAttribute('data-chat-draft-preview-target') ?? null,
      chatDraftPreviewAction:
        document.querySelector('[data-chat-draft-preview="true"]')?.getAttribute('data-chat-draft-preview-action') ?? null,
      chatDraftPreviewBody:
        document.querySelector('[data-chat-draft-preview-body]')?.getAttribute('data-chat-draft-preview-body') ?? null,
      chatDraftPreviewText:
        document.querySelector('[data-chat-draft-preview="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      chatDraftClearButtons:
        document.querySelectorAll('[data-chat-draft-clear="true"]').length,
      chatSendDisabled:
        document.querySelector('[data-chat-send="true"]')?.disabled ?? null,
      chatSendReason:
        document.querySelector('[data-chat-send="true"]')?.getAttribute('data-chat-send-reason') ?? null,
      chatSendGuardEnabled:
        document.querySelector('[data-chat-send-guard="true"]')?.getAttribute('data-chat-send-guard-enabled') ?? null,
      chatSendGuardReason:
        document.querySelector('[data-chat-send-guard="true"]')?.getAttribute('data-chat-send-guard-reason') ?? null,
      chatSendGuardText:
        document.querySelector('[data-chat-send-guard="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      chatLocalSubmissionPresent:
        document.querySelector('[data-chat-local-submit="true"]') !== null,
      chatLocalSubmissionAction:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-action') ?? null,
      chatLocalSubmissionCharacters:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-characters') ?? null,
      chatLocalSubmissionCount:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-count') ?? null,
      chatLocalSubmissionIntent:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-intent') ?? null,
      chatLocalSubmissionIntentLabel:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-intent-label') ?? null,
      chatLocalSubmissionSequence:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-sequence') ?? null,
      chatLocalSubmissionStatus:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-status') ?? null,
      chatLocalSubmissionTarget:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-target') ?? null,
      chatLocalSubmissionWords:
        document.querySelector('[data-chat-local-submit="true"]')?.getAttribute('data-chat-local-submit-words') ?? null,
      chatLocalSubmissionClearButtons:
        document.querySelectorAll('[data-chat-local-submit-clear="true"]').length,
      chatLocalSubmissionClearCount:
        document.querySelector('[data-chat-local-submit-clear="true"]')?.getAttribute('data-chat-local-submit-clear-count') ?? null,
      chatLocalSubmissionHistoryItems:
        document.querySelectorAll('[data-chat-local-submit-history-item]').length,
      chatLocalSubmissionHistoryItemIds:
        Array.from(
          document.querySelectorAll('[data-chat-local-submit-history-item]'),
          (element) => element.getAttribute('data-chat-local-submit-history-item')
        ).filter(Boolean),
      chatLocalSubmissionHistoryCurrentItem:
        document.querySelector('[data-chat-local-submit-history-current="true"]')?.getAttribute('data-chat-local-submit-history-item') ?? null,
      chatLocalSubmissionHistoryStatuses:
        Array.from(
          document.querySelectorAll('[data-chat-local-submit-history-status]'),
          (element) => element.getAttribute('data-chat-local-submit-history-status')
        ).filter(Boolean),
      chatLocalSubmissionText:
        document.querySelector('[data-chat-local-submit="true"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      chatCollapsedSummary:
        document.querySelector('.cw-workbench__chat-collapsed')?.textContent ?? null,
      timelineItems: document.querySelectorAll('.cw-workbench__lifecycle-item').length,
      commandButtons: document.querySelectorAll('.cw-workbench__lifecycle-command').length,
      selectedText: document.querySelector('.cw-workbench__lifecycle-selected-item strong')?.textContent ?? null,
      selectedTimelineText: document.querySelector('.cw-workbench__lifecycle-item--selected h4')?.textContent ?? null,
      focusedCount: document.querySelectorAll('.cw-workbench__lifecycle-item--focused').length,
      selectedCount: document.querySelectorAll('.cw-workbench__lifecycle-item--selected').length,
      horizontalOverflow: Math.max(
        document.body.scrollWidth - document.body.clientWidth,
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      ),
      scroll: {
        x: window.scrollX,
        y: window.scrollY,
        maxY: Math.max(
          0,
          document.body.scrollHeight - window.innerHeight,
          document.documentElement.scrollHeight - window.innerHeight
        ),
      },
      frameworkOverlayText:
        document.body.textContent?.includes('Internal server error') ||
        document.body.textContent?.includes('[plugin:vite]') ||
        false,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))()
  `);
}

async function clickFileTreeNode(window, nodeId) {
  const nodeLiteral = JSON.stringify(nodeId);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedNodeId = ${nodeLiteral};
      const startedAt = Date.now();
      const selectFileTreeNode = () => {
        const node = document.querySelector(
          '[data-file-tree-node-select="' + expectedNodeId + '"]'
        );
        if (node instanceof HTMLElement) {
          node.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing file tree node: ' + expectedNodeId,
            nodes: Array.from(
              document.querySelectorAll('[data-file-tree-node-select]'),
              (element) => element.getAttribute('data-file-tree-node-select')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectFileTreeNode);
      };
      selectFileTreeNode();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickVersionSnapshot(window, snapshotId) {
  const snapshotLiteral = JSON.stringify(snapshotId);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedSnapshotId = ${snapshotLiteral};
      const startedAt = Date.now();
      const selectVersionSnapshot = () => {
        const snapshot = document.querySelector(
          '[data-version-snapshot-select="' + expectedSnapshotId + '"]'
        );
        if (snapshot instanceof HTMLElement) {
          snapshot.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing version snapshot: ' + expectedSnapshotId,
            snapshots: Array.from(
              document.querySelectorAll('[data-version-snapshot-select]'),
              (element) => element.getAttribute('data-version-snapshot-select')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectVersionSnapshot);
      };
      selectVersionSnapshot();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function keyVersionSnapshot(window, snapshotId, key) {
  const snapshotLiteral = JSON.stringify(snapshotId);
  const keyLiteral = JSON.stringify(key);
  const keyCode = runtimeWorkbenchVisualSmokeElectronKeyCode(key);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedSnapshotId = ${snapshotLiteral};
      const expectedKey = ${keyLiteral};
      const startedAt = Date.now();
      const focusVersionSnapshot = () => {
        const snapshot = document.querySelector(
          '[data-version-snapshot-select="' + expectedSnapshotId + '"]'
        );
        if (snapshot instanceof HTMLElement) {
          snapshot.focus({ preventScroll: true });
          resolve({
            ok: document.activeElement === snapshot,
            focusedSnapshot: document.activeElement instanceof HTMLElement
              ? document.activeElement.getAttribute('data-version-snapshot-select')
              : null,
          });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing version snapshot for key ' + expectedKey + ': ' + expectedSnapshotId,
            snapshots: Array.from(
              document.querySelectorAll('[data-version-snapshot-select]'),
              (element) => element.getAttribute('data-version-snapshot-select')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(focusVersionSnapshot);
      };
      focusVersionSnapshot();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
  window.webContents.sendInputEvent({ keyCode, type: "keyDown" });
  window.webContents.sendInputEvent({ keyCode, type: "keyUp" });
  const waitResult = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedSnapshotId = ${snapshotLiteral};
      const startedAt = Date.now();
      const waitForSelection = () => {
        const selectedSnapshot = document.querySelector('[data-version-snapshot-selected="true"]')?.getAttribute('data-version-snapshot') ?? null;
        const detailsSnapshot = document.querySelector('[data-version-snapshot-details]')?.getAttribute('data-version-snapshot-details') ?? null;
        const focusedSnapshot = document.activeElement instanceof HTMLElement
          ? document.activeElement.getAttribute('data-version-snapshot-select')
          : null;
        if (
          selectedSnapshot === expectedSnapshotId &&
          detailsSnapshot === expectedSnapshotId &&
          focusedSnapshot === expectedSnapshotId
        ) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Keyboard selection did not select version snapshot ' + expectedSnapshotId,
            selectedSnapshot,
            detailsSnapshot,
            focusedSnapshot,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(waitForSelection);
      };
      waitForSelection();
    })
  `);
  if (waitResult?.ok !== true) {
    throw new Error(JSON.stringify(waitResult));
  }
}

async function clickLifecycleCommand(window, command) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const startedAt = Date.now();
      const clickCommand = () => {
        const button = document.querySelector('[data-lifecycle-navigation-command="${command}"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing lifecycle navigation button: ${command}',
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(clickCommand);
      };
      clickCommand();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickPanel(window, panel) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const startedAt = Date.now();
      const clickPanelButton = () => {
        const button = document.querySelector('.cw-workbench__dock-item[data-panel="${panel}"], .cw-workbench__tab[data-panel="${panel}"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 1500) {
          resolve({
            ok: false,
            message: 'Missing workbench panel button: ${panel}',
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(clickPanelButton);
      };
      clickPanelButton();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickWorkflowCanvasNode(window, nodeId) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const startedAt = Date.now();
      const selectNode = () => {
        const button = document.querySelector('[data-workflow-canvas-surface="focused"] [data-workflow-canvas-node-select="${nodeId}"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing focused workflow canvas node button: ${nodeId}',
            focusedSurfaces: document.querySelectorAll('[data-workflow-canvas-surface="focused"]').length,
            selectableNodes: document.querySelectorAll('[data-workflow-canvas-node-select]').length,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectNode);
      };
      selectNode();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickWorkflowCanvasInspectorRoute(window, edgeId, nodeId) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const startedAt = Date.now();
      const selectRoute = () => {
        const button = document.querySelector('[data-workflow-canvas-inspector-edge-route="${edgeId}"][data-workflow-canvas-route-select="${nodeId}"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing workflow canvas inspector route button: ${edgeId} -> ${nodeId}',
            inspectorEdges: Array.from(
              document.querySelectorAll('[data-workflow-canvas-inspector-edge]'),
              (element) => element.getAttribute('data-workflow-canvas-inspector-edge')
            ),
            routeTargets: Array.from(
              document.querySelectorAll('[data-workflow-canvas-route-select]'),
              (element) => element.getAttribute('data-workflow-canvas-route-select')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectRoute);
      };
      selectRoute();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickWorkflowCanvasInspectorBack(window, nodeId) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const startedAt = Date.now();
      const selectBack = () => {
        const button = document.querySelector('[data-workflow-canvas-inspector-back="true"][data-workflow-canvas-inspector-back-target="${nodeId}"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing workflow canvas inspector back button: ${nodeId}',
            backTarget: document.querySelector('[data-workflow-canvas-inspector-back="true"]')?.getAttribute('data-workflow-canvas-inspector-back-target') ?? null,
            historyDepth: document.querySelector('.cw-workbench__workflow-canvas-inspector')?.getAttribute('data-workflow-canvas-inspector-history-depth') ?? null,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectBack);
      };
      selectBack();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickWorkflowCanvasHistoryTrail(window, nodeId, index) {
  const nodeLiteral = JSON.stringify(nodeId);
  const indexLiteral = JSON.stringify(String(index));
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedNodeId = ${nodeLiteral};
      const expectedIndex = ${indexLiteral};
      const startedAt = Date.now();
      const selectHistory = () => {
        const button = document.querySelector(
          '[data-workflow-canvas-history-select="' +
            expectedNodeId +
            '"][data-workflow-canvas-history-index="' +
            expectedIndex +
            '"]'
        );
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing workflow canvas history item: ' + expectedIndex + ':' + expectedNodeId,
            historyItems: Array.from(
              document.querySelectorAll('[data-workflow-canvas-history-select]'),
              (element) =>
                (element.getAttribute('data-workflow-canvas-history-index') ?? '') +
                ':' +
                (element.getAttribute('data-workflow-canvas-history-select') ?? '')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectHistory);
      };
      selectHistory();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickWorkflowCanvasTypeFocus(window, kind, value) {
  const kindLiteral = JSON.stringify(kind);
  const valueLiteral = JSON.stringify(value);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedKind = ${kindLiteral};
      const expectedValue = ${valueLiteral};
      const startedAt = Date.now();
      const selectTypeFocus = () => {
        const button = document.querySelector(
          'button[data-workflow-canvas-type-focus-kind="' +
            expectedKind +
            '"][data-workflow-canvas-type-focus-value="' +
            expectedValue +
            '"]'
        );
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing workflow canvas type focus button: ' + expectedKind + ':' + expectedValue,
            buttons: Array.from(
              document.querySelectorAll('button[data-workflow-canvas-type-focus-kind][data-workflow-canvas-type-focus-value]'),
              (element) =>
                (element.getAttribute('data-workflow-canvas-type-focus-kind') ?? '') +
                ':' +
                (element.getAttribute('data-workflow-canvas-type-focus-value') ?? '')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectTypeFocus);
      };
      selectTypeFocus();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickWorkflowCanvasTypeFocusNodeMatch(window, nodeId) {
  const nodeLiteral = JSON.stringify(nodeId);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedNodeId = ${nodeLiteral};
      const startedAt = Date.now();
      const selectNodeMatch = () => {
        const button = document.querySelector(
          '[data-workflow-canvas-type-focus-node-select="' + expectedNodeId + '"]'
        );
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing workflow canvas type focus node match: ' + expectedNodeId,
            matches: Array.from(
              document.querySelectorAll('[data-workflow-canvas-type-focus-node-match]'),
              (element) => element.getAttribute('data-workflow-canvas-type-focus-node-match')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectNodeMatch);
      };
      selectNodeMatch();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clearWorkflowCanvasTypeFocus(window) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const startedAt = Date.now();
      const clearTypeFocus = () => {
        const button = document.querySelector('[data-workflow-canvas-type-focus-clear="true"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing workflow canvas type focus clear button',
            activeButtons: document.querySelectorAll('[data-workflow-canvas-type-focus-active="true"]').length,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(clearTypeFocus);
      };
      clearTypeFocus();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function keyWorkflowCanvasSelectedNode(window, key, expectedNodeId) {
  const keyLiteral = JSON.stringify(key);
  const expectedNodeLiteral = JSON.stringify(expectedNodeId);
  const keyCode = runtimeWorkbenchVisualSmokeElectronKeyCode(key);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedKey = ${keyLiteral};
      const startedAt = Date.now();
      const focusSelectedNode = () => {
        const button = document.querySelector('[data-workflow-canvas-node-selected="true"] [data-workflow-canvas-node-select]');
        if (button instanceof HTMLButtonElement) {
          button.focus({ preventScroll: true });
          resolve({
            ok: document.activeElement === button,
            focusedNode: document.activeElement instanceof HTMLElement
              ? document.activeElement.getAttribute('data-workflow-canvas-node-select')
              : null,
          });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing selected workflow canvas node button for key ' + expectedKey,
            selectedNode: document.querySelector('[data-workflow-canvas-node-selected="true"]')?.getAttribute('data-workflow-canvas-node') ?? null,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(focusSelectedNode);
      };
      focusSelectedNode();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
  window.webContents.sendInputEvent({ keyCode, type: "keyDown" });
  window.webContents.sendInputEvent({ keyCode, type: "keyUp" });
  const waitResult = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedNodeId = ${expectedNodeLiteral};
      const startedAt = Date.now();
      const waitForSelection = () => {
        const selectedNode = document.querySelector('[data-workflow-canvas-node-selected="true"]')?.getAttribute('data-workflow-canvas-node') ?? null;
        const focusedNode = document.activeElement instanceof HTMLElement
          ? document.activeElement.getAttribute('data-workflow-canvas-node-select')
          : null;
        if (selectedNode === expectedNodeId && focusedNode === expectedNodeId) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Keyboard traversal did not select and focus ' + expectedNodeId,
            selectedNode,
            focusedNode,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(waitForSelection);
      };
      waitForSelection();
    })
  `);
  if (waitResult?.ok !== true) {
    throw new Error(JSON.stringify(waitResult));
  }
}

function runtimeWorkbenchVisualSmokeElectronKeyCode(key) {
  switch (key) {
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "ArrowUp":
      return "Up";
    default:
      return key;
  }
}

async function clickTaskDrawerToggle(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-task-drawer-toggle="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing task drawer toggle button');
      }
      button.click();
    })()
  `);
}

async function clickTaskDrawerItem(window, itemId) {
  const itemLiteral = JSON.stringify(itemId);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedItemId = ${itemLiteral};
      const startedAt = Date.now();
      const selectTaskDrawerItem = () => {
        const item = document.querySelector(
          '[data-task-drawer-item-select="' + expectedItemId + '"]'
        );
        if (item instanceof HTMLElement) {
          item.click();
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing task drawer item: ' + expectedItemId,
            items: Array.from(
              document.querySelectorAll('[data-task-drawer-item-select]'),
              (element) => element.getAttribute('data-task-drawer-item-select')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(selectTaskDrawerItem);
      };
      selectTaskDrawerItem();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function keyTaskDrawerItem(window, itemId, key) {
  const itemLiteral = JSON.stringify(itemId);
  const keyLiteral = JSON.stringify(key);
  const keyCode = runtimeWorkbenchVisualSmokeElectronKeyCode(key);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedItemId = ${itemLiteral};
      const expectedKey = ${keyLiteral};
      const startedAt = Date.now();
      const focusTaskDrawerItem = () => {
        const item = document.querySelector(
          '[data-task-drawer-item-select="' + expectedItemId + '"]'
        );
        if (item instanceof HTMLElement) {
          item.focus({ preventScroll: true });
          resolve({
            ok: document.activeElement === item,
            focusedItem: document.activeElement instanceof HTMLElement
              ? document.activeElement.getAttribute('data-task-drawer-item-select')
              : null,
          });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Missing task drawer item for key ' + expectedKey + ': ' + expectedItemId,
            items: Array.from(
              document.querySelectorAll('[data-task-drawer-item-select]'),
              (element) => element.getAttribute('data-task-drawer-item-select')
            ),
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(focusTaskDrawerItem);
      };
      focusTaskDrawerItem();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
  window.webContents.sendInputEvent({ keyCode, type: "keyDown" });
  window.webContents.sendInputEvent({ keyCode, type: "keyUp" });
  const waitResult = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedItemId = ${itemLiteral};
      const startedAt = Date.now();
      const waitForSelection = () => {
        const selectedItem = document.querySelector('[data-task-drawer-item-selected="true"]')?.getAttribute('data-task-drawer-item') ?? null;
        const detailsItem = document.querySelector('[data-task-drawer-details]')?.getAttribute('data-task-drawer-details') ?? null;
        const focusedItem = document.activeElement instanceof HTMLElement
          ? document.activeElement.getAttribute('data-task-drawer-item-select')
          : null;
        if (
          selectedItem === expectedItemId &&
          detailsItem === expectedItemId &&
          focusedItem === expectedItemId
        ) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Keyboard selection did not select task drawer item ' + expectedItemId,
            selectedItem,
            detailsItem,
            focusedItem,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(waitForSelection);
      };
      waitForSelection();
    })
  `);
  if (waitResult?.ok !== true) {
    throw new Error(JSON.stringify(waitResult));
  }
}

async function inputChatDraft(window, draft) {
  const draftLiteral = JSON.stringify(draft);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedDraft = ${draftLiteral};
      const expectedLength = String(expectedDraft.length);
      const expectedWords = String(
        expectedDraft.trim().length === 0
          ? 0
          : expectedDraft.trim().split(/\\s+/u).length
      );
      const input = document.querySelector('[data-chat-draft-input="true"]');
      if (!(input instanceof HTMLTextAreaElement)) {
        resolve({ ok: false, message: 'Missing chat draft input' });
        return;
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      );
      descriptor?.set?.call(input, expectedDraft);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const startedAt = Date.now();
      const waitForDraft = () => {
        const details = document.querySelector('[data-chat-draft-details="true"]');
        const actualLength = details?.getAttribute('data-chat-draft-length') ?? null;
        const actualWords = details?.getAttribute('data-chat-draft-words') ?? null;
        if (
          input.value === expectedDraft &&
          actualLength === expectedLength &&
          actualWords === expectedWords
        ) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Chat draft did not update',
            actualValue: input.value,
            actualLength,
            actualWords,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(waitForDraft);
      };
      waitForDraft();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clearChatDraft(window) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const button = document.querySelector('[data-chat-draft-clear="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        resolve({ ok: false, message: 'Missing chat draft clear button' });
        return;
      }
      button.click();
      const startedAt = Date.now();
      const waitForClear = () => {
        const input = document.querySelector('[data-chat-draft-input="true"]');
        const details = document.querySelector('[data-chat-draft-details="true"]');
        const actualLength = details?.getAttribute('data-chat-draft-length') ?? null;
        const actualWords = details?.getAttribute('data-chat-draft-words') ?? null;
        if (
          input instanceof HTMLTextAreaElement &&
          input.value === '' &&
          actualLength === '0' &&
          actualWords === '0'
        ) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Chat draft did not clear',
            actualValue: input instanceof HTMLTextAreaElement ? input.value : null,
            actualLength,
            actualWords,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(waitForClear);
      };
      waitForClear();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function sendChatDraft(window, draft, expected) {
  await inputChatDraft(window, draft);
  const expectedSubmission = {
    sequence: String(expected.sequence),
    count: String(expected.count),
    status: expected.status,
    intent: expected.intent,
    target: expected.target,
    action: expected.action,
    characters: String(draft.length),
    words: String(countChatDraftWords(draft)),
    forbiddenDraft: draft,
  };
  const expectedLiteral = JSON.stringify(expectedSubmission);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expected = ${expectedLiteral};
      const button = document.querySelector('[data-chat-send="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        resolve({ ok: false, message: 'Missing chat send button' });
        return;
      }
      if (button.disabled) {
        resolve({
          ok: false,
          message: 'Chat send button is disabled',
          sendReason: button.getAttribute('data-chat-send-reason') ?? null,
        });
        return;
      }
      button.click();
      const startedAt = Date.now();
      const readSubmission = () => {
        const section = document.querySelector('[data-chat-local-submit="true"]');
        const historyItems = Array.from(
          document.querySelectorAll('[data-chat-local-submit-history-item]'),
          (element) => element.getAttribute('data-chat-local-submit-history-item')
        ).filter(Boolean);
        const historyStatuses = Array.from(
          document.querySelectorAll('[data-chat-local-submit-history-status]'),
          (element) => element.getAttribute('data-chat-local-submit-history-status')
        ).filter(Boolean);
        const attributesContainRawDraft = section === null
          ? false
          : Array.from(section.querySelectorAll('*')).some((element) =>
              Array.from(element.attributes).some((attribute) =>
                attribute.value.includes(expected.forbiddenDraft)
              )
            ) ||
            Array.from(section.attributes).some((attribute) =>
              attribute.value.includes(expected.forbiddenDraft)
            );
        const textContainsRawDraft =
          section?.textContent?.includes(expected.forbiddenDraft) ?? false;
        return {
          present: section !== null,
          action:
            section?.getAttribute('data-chat-local-submit-action') ?? null,
          characters:
            section?.getAttribute('data-chat-local-submit-characters') ?? null,
          count: section?.getAttribute('data-chat-local-submit-count') ?? null,
          intent: section?.getAttribute('data-chat-local-submit-intent') ?? null,
          sequence:
            section?.getAttribute('data-chat-local-submit-sequence') ?? null,
          status: section?.getAttribute('data-chat-local-submit-status') ?? null,
          target: section?.getAttribute('data-chat-local-submit-target') ?? null,
          words: section?.getAttribute('data-chat-local-submit-words') ?? null,
          historyItems,
          historyStatuses,
          containsRawDraft: attributesContainRawDraft || textContainsRawDraft,
          draftValue:
            document.querySelector('[data-chat-draft-input="true"]')?.value ?? null,
        };
      };
      const waitForSubmission = () => {
        const actual = readSubmission();
        if (
          actual.present === true &&
          actual.sequence === expected.sequence &&
          actual.count === expected.count &&
          actual.status === expected.status &&
          actual.intent === expected.intent &&
          actual.target === expected.target &&
          actual.action === expected.action &&
          actual.characters === expected.characters &&
          actual.words === expected.words &&
          actual.draftValue === '' &&
          actual.containsRawDraft === false
        ) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Chat local submission did not match expected metadata',
            actual,
          });
          return;
        }
        window.requestAnimationFrame(waitForSubmission);
      };
      waitForSubmission();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clearChatLocalSubmissionHistory(window) {
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const button = document.querySelector('[data-chat-local-submit-clear="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        resolve({ ok: false, message: 'Missing chat local history clear button' });
        return;
      }
      button.click();
      const startedAt = Date.now();
      const waitForClear = () => {
        const section = document.querySelector('[data-chat-local-submit="true"]');
        const clearButtons = document.querySelectorAll(
          '[data-chat-local-submit-clear="true"]'
        ).length;
        const historyItems = document.querySelectorAll(
          '[data-chat-local-submit-history-item]'
        ).length;
        if (section === null && clearButtons === 0 && historyItems === 0) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Chat local submission history did not clear',
            present: section !== null,
            clearButtons,
            historyItems,
          });
          return;
        }
        window.requestAnimationFrame(waitForClear);
      };
      waitForClear();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickChatDraftIntent(window, intent) {
  const intentLiteral = JSON.stringify(intent);
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const expectedIntent = ${intentLiteral};
      const button = document.querySelector(
        '[data-chat-draft-intent="' + expectedIntent + '"][data-chat-draft-intent-active]'
      );
      if (!(button instanceof HTMLButtonElement)) {
        resolve({
          ok: false,
          message: 'Missing chat draft intent button: ' + expectedIntent,
          intents: Array.from(
            document.querySelectorAll('[data-chat-draft-intent][data-chat-draft-intent-active]'),
            (element) => element.getAttribute('data-chat-draft-intent')
          ),
        });
        return;
      }
      button.click();
      const startedAt = Date.now();
      const waitForIntent = () => {
        const activeIntent = document
          .querySelector('[data-chat-draft-intent-active="true"]')
          ?.getAttribute('data-chat-draft-intent') ?? null;
        const detailsIntent = document
          .querySelector('[data-chat-draft-details="true"]')
          ?.getAttribute('data-chat-draft-intent') ?? null;
        if (activeIntent === expectedIntent && detailsIntent === expectedIntent) {
          resolve({ ok: true });
          return;
        }
        if (Date.now() - startedAt > 2000) {
          resolve({
            ok: false,
            message: 'Chat draft intent did not update',
            activeIntent,
            detailsIntent,
            bodyText: document.body.textContent?.slice(0, 500) ?? '',
          });
          return;
        }
        window.requestAnimationFrame(waitForIntent);
      };
      waitForIntent();
    })
  `);
  if (result?.ok !== true) {
    throw new Error(JSON.stringify(result));
  }
}

async function clickChatBoxToggle(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-chat-box-toggle="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing chat box toggle button');
      }
      button.click();
    })()
  `);
}

async function clickStreamPanelToggle(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-stream-panel-toggle="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing stream panel toggle button');
      }
      button.click();
    })()
  `);
}

async function clickStreamFullReloadDetailsToggle(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-stream-full-reload-details-toggle="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing stream full reload details toggle button');
      }
      button.click();
    })()
  `);
}

async function clickStreamEventExpandToggle(window, eventId) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-stream-event-expand-toggle="${eventId}"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing stream event expand toggle button: ${eventId}');
      }
      button.click();
    })()
  `);
}

async function clickStreamControlsToggle(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-stream-controls-toggle="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing stream controls toggle button');
      }
      button.click();
    })()
  `);
}

async function clickStreamEventGroupToggle(window, groupId) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-stream-event-group-toggle="${groupId}"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing stream event group toggle button: ${groupId}');
      }
      button.click();
    })()
  `);
}

async function clickStreamSelectionToggle(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-stream-selection-toggle="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing stream selection toggle button');
      }
      button.click();
    })()
  `);
}

async function clickStreamSelectionMetadataToggle(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-stream-selection-metadata-toggle="true"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing stream selection metadata toggle button');
      }
      button.click();
    })()
  `);
}

async function runSmokeStep(label, action) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
}

function pushStreamContentMetricFailures(
  failures,
  metrics,
  prefix,
  textKey,
  label,
  expectedLinkHref,
) {
  const expectedCounts = {
    HeadingCount: "1",
    ListCount: "1",
    CodeBlockCount: "1",
    TableCount: "1",
    LinkCount: "1",
    MarkCount: "1",
    BlockedHtmlCount: "2",
    BlockedImageCount: "1",
    BlockedLinkCount: "1",
  };
  for (const [suffix, expected] of Object.entries(expectedCounts)) {
    const key = `${prefix}${suffix}`;
    if (metrics[key] !== expected) {
      failures.push(
        `expected ${label} ${suffix} ${expected}, got ${metrics[key]}`,
      );
    }
  }
  if (metrics[`${prefix}Fallback`] !== "false") {
    failures.push(
      `expected ${label} fallback false, got ${metrics[`${prefix}Fallback`]}`,
    );
  }
  if (metrics[`${prefix}FallbackReason`] !== "none") {
    failures.push(
      `expected ${label} fallback reason none, got ${metrics[`${prefix}FallbackReason`]}`,
    );
  }
  if (metrics[`${prefix}ScriptCount`] !== 0) {
    failures.push(
      `expected ${label} to render no script elements, got ${metrics[`${prefix}ScriptCount`]}`,
    );
  }
  if (metrics[`${prefix}ImageCount`] !== 0) {
    failures.push(
      `expected ${label} to render no image elements, got ${metrics[`${prefix}ImageCount`]}`,
    );
  }
  if (
    expectedLinkHref !== undefined &&
    metrics[`${prefix}LinkHref`] !== expectedLinkHref
  ) {
    failures.push(
      `expected ${label} safe link href ${expectedLinkHref}, got ${metrics[`${prefix}LinkHref`]}`,
    );
  }
  const text = metrics[textKey] ?? "";
  if (text.includes("javascript:") || text.includes("example.invalid")) {
    failures.push(`expected ${label} to hide unsafe link targets, got ${text}`);
  }
}

function collectVisualSmokeFailures(
  metrics,
  messages,
  requestedWidth,
  requestedStreamEventMode,
  requestedChatBoxMode,
  initialStreamMetrics,
  streamEventExpandedMetrics,
  streamEventCollapsedMetrics,
  streamFullReloadExpandedMetrics,
  streamFullReloadCollapsedMetrics,
  streamControlsCollapsedMetrics,
  streamControlsExpandedMetrics,
  streamGroupCollapsedMetrics,
  streamGroupExpandedMetrics,
  streamSelectionCollapsedMetrics,
  streamSelectionExpandedMetrics,
  streamSelectionMetadataExpandedMetrics,
  streamSelectionMetadataCollapsedMetrics,
  streamCollapsedMetrics,
  streamExpandedMetrics,
  initialFileTreeMetrics,
  fileTreeSelectMetrics,
  initialVersionSnapshotMetrics,
  versionSnapshotSelectMetrics,
  versionSnapshotKeyboardMetrics,
  initialTaskDrawerMetrics,
  taskDrawerSelectMetrics,
  taskDrawerSpaceMetrics,
  taskDrawerKeyboardMetrics,
  collapsedMetrics,
  chatCollapsedMetrics,
  chatInitialMetrics,
  chatDraftMetrics,
  chatClearedMetrics,
  chatLocalSubmitMetrics,
  chatLocalHistoryMetrics,
  chatLocalHistoryClearedMetrics,
  chatLocalResendMetrics,
  canvasMetrics,
  canvasNodeTypeFocusMetrics,
  canvasNodeTypeFocusPreMatchMetrics,
  canvasNodeTypeFocusMatchMetrics,
  canvasEdgeTypeFocusMetrics,
  canvasTypeFocusClearMetrics,
  canvasRouteMetrics,
  canvasBackMetrics,
  canvasKeyboardNextMetrics,
  canvasKeyboardNoopMetrics,
  canvasKeyboardPreviousMetrics,
  canvasKeyboardUpMetrics,
  canvasKeyboardDownMetrics,
  canvasHistorySelectMetrics,
) {
  const failures = [];
  const expectedRuntimeStreamEvent = expectedStreamEvent(
    requestedStreamEventMode,
  );
  const selectedWorkflowCanvasEdgeIds = Array.isArray(
    canvasMetrics.selectedWorkflowCanvasEdgeIds,
  )
    ? canvasMetrics.selectedWorkflowCanvasEdgeIds.join(",")
    : "";
  const incomingWorkflowCanvasEdgeIds = Array.isArray(
    canvasMetrics.incomingWorkflowCanvasEdgeIds,
  )
    ? canvasMetrics.incomingWorkflowCanvasEdgeIds.join(",")
    : "";
  const outgoingWorkflowCanvasEdgeIds = Array.isArray(
    canvasMetrics.outgoingWorkflowCanvasEdgeIds,
  )
    ? canvasMetrics.outgoingWorkflowCanvasEdgeIds.join(",")
    : "";
  const workflowCanvasInspectorEdgeIds = Array.isArray(
    canvasMetrics.workflowCanvasInspectorEdgeIds,
  )
    ? canvasMetrics.workflowCanvasInspectorEdgeIds.join(",")
    : "";
  const workflowCanvasInspectorRouteSelectNodeIds = Array.isArray(
    canvasMetrics.workflowCanvasInspectorRouteSelectNodeIds,
  )
    ? canvasMetrics.workflowCanvasInspectorRouteSelectNodeIds.join(",")
    : "";
  const nodeTypeFocusNodeIds = Array.isArray(
    canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasNodeIds,
  )
    ? canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasNodeIds.join(",")
    : "";
  const nodeTypeFocusEdgeIds = Array.isArray(
    canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasEdgeIds,
  )
    ? canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasEdgeIds.join(",")
    : "";
  const nodeTypeFocusMatches = Array.isArray(
    canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusNodeMatches,
  )
    ? canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusNodeMatches.join(",")
    : "";
  const nodeTypeFocusMatchEdges = Array.isArray(
    canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusEdgeMatches,
  )
    ? canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusEdgeMatches.join(",")
    : "";
  const nodeTypeFocusMatchClickNodes = Array.isArray(
    canvasNodeTypeFocusMatchMetrics.workflowCanvasTypeFocusNodeMatches,
  )
    ? canvasNodeTypeFocusMatchMetrics.workflowCanvasTypeFocusNodeMatches.join(
        ",",
      )
    : "";
  const nodeTypeFocusPreMatchNodes = Array.isArray(
    canvasNodeTypeFocusPreMatchMetrics.workflowCanvasTypeFocusNodeMatches,
  )
    ? canvasNodeTypeFocusPreMatchMetrics.workflowCanvasTypeFocusNodeMatches.join(
        ",",
      )
    : "";
  const edgeTypeFocusNodeIds = Array.isArray(
    canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasNodeIds,
  )
    ? canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasNodeIds.join(",")
    : "";
  const edgeTypeFocusEdgeIds = Array.isArray(
    canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasEdgeIds,
  )
    ? canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasEdgeIds.join(",")
    : "";
  const edgeTypeFocusNodeMatches = Array.isArray(
    canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusNodeMatches,
  )
    ? canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusNodeMatches.join(",")
    : "";
  const edgeTypeFocusMatches = Array.isArray(
    canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusEdgeMatches,
  )
    ? canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusEdgeMatches.join(",")
    : "";
  const routeWorkflowCanvasEdgeIds = Array.isArray(
    canvasRouteMetrics.selectedWorkflowCanvasEdgeIds,
  )
    ? canvasRouteMetrics.selectedWorkflowCanvasEdgeIds.join(",")
    : "";
  const routeIncomingWorkflowCanvasEdgeIds = Array.isArray(
    canvasRouteMetrics.incomingWorkflowCanvasEdgeIds,
  )
    ? canvasRouteMetrics.incomingWorkflowCanvasEdgeIds.join(",")
    : "";
  const routeOutgoingWorkflowCanvasEdgeIds = Array.isArray(
    canvasRouteMetrics.outgoingWorkflowCanvasEdgeIds,
  )
    ? canvasRouteMetrics.outgoingWorkflowCanvasEdgeIds.join(",")
    : "";
  const routeWorkflowCanvasInspectorEdgeIds = Array.isArray(
    canvasRouteMetrics.workflowCanvasInspectorEdgeIds,
  )
    ? canvasRouteMetrics.workflowCanvasInspectorEdgeIds.join(",")
    : "";
  const routeWorkflowCanvasInspectorRouteSelectNodeIds = Array.isArray(
    canvasRouteMetrics.workflowCanvasInspectorRouteSelectNodeIds,
  )
    ? canvasRouteMetrics.workflowCanvasInspectorRouteSelectNodeIds.join(",")
    : "";

  if (messages.length > 0) {
    failures.push(
      `captured console warning/error messages: ${messages.length}`,
    );
  }
  if (metrics.hasRoot !== true) {
    failures.push("missing .cw-workbench root");
  }
  if (metrics.hasDock !== true) {
    failures.push("missing shell dock");
  }
  if (initialStreamMetrics.hasStreamPanel !== true) {
    failures.push("missing runtime stream panel");
  }
  if (initialStreamMetrics.streamPanelExpanded !== "true") {
    failures.push(
      `expected initial stream panel expanded, got ${initialStreamMetrics.streamPanelExpanded}`,
    );
  }
  if (initialStreamMetrics.streamPanelToggleButtons !== 1) {
    failures.push(
      `expected one stream panel toggle button, got ${initialStreamMetrics.streamPanelToggleButtons}`,
    );
  }
  if (initialStreamMetrics.streamPanelToggleExpanded !== "true") {
    failures.push(
      `expected initial stream panel toggle aria-expanded true, got ${initialStreamMetrics.streamPanelToggleExpanded}`,
    );
  }
  if (initialStreamMetrics.streamPanelControls !== 1) {
    failures.push(
      `expected initial stream panel controls, got ${initialStreamMetrics.streamPanelControls}`,
    );
  }
  if (initialStreamMetrics.streamControlsExpanded !== "true") {
    failures.push(
      `expected initial stream controls expanded true, got ${initialStreamMetrics.streamControlsExpanded}`,
    );
  }
  if (initialStreamMetrics.streamControlsToggleButtons !== 1) {
    failures.push(
      `expected one stream controls toggle button, got ${initialStreamMetrics.streamControlsToggleButtons}`,
    );
  }
  if (initialStreamMetrics.streamControlsBodies !== 1) {
    failures.push(
      `expected initial stream controls body, got ${initialStreamMetrics.streamControlsBodies}`,
    );
  }
  if (initialStreamMetrics.streamPanelBodies !== 1) {
    failures.push(
      `expected initial stream panel body, got ${initialStreamMetrics.streamPanelBodies}`,
    );
  }
  if (initialStreamMetrics.streamFullReloads !== 1) {
    failures.push(
      `expected initial stream full reload banner, got ${initialStreamMetrics.streamFullReloads}`,
    );
  }
  if (initialStreamMetrics.streamFullReloadExpanded !== "false") {
    failures.push(
      `expected initial stream full reload details collapsed, got ${initialStreamMetrics.streamFullReloadExpanded}`,
    );
  }
  if (initialStreamMetrics.streamFullReloadStatus !== "412") {
    failures.push(
      `expected initial stream full reload status 412, got ${initialStreamMetrics.streamFullReloadStatus}`,
    );
  }
  if (initialStreamMetrics.streamFullReloadLastEventId !== "evt_old") {
    failures.push(
      `expected initial stream full reload last event evt_old, got ${initialStreamMetrics.streamFullReloadLastEventId}`,
    );
  }
  if (initialStreamMetrics.streamFullReloadDetailToggles !== 1) {
    failures.push(
      `expected one stream full reload details toggle, got ${initialStreamMetrics.streamFullReloadDetailToggles}`,
    );
  }
  if (initialStreamMetrics.streamFullReloadDetailToggleExpanded !== "false") {
    failures.push(
      `expected initial stream full reload details toggle aria-expanded false, got ${initialStreamMetrics.streamFullReloadDetailToggleExpanded}`,
    );
  }
  if (initialStreamMetrics.streamFullReloadDetails !== 0) {
    failures.push(
      `expected initial stream full reload details hidden, got ${initialStreamMetrics.streamFullReloadDetails}`,
    );
  }
  if (initialStreamMetrics.streamFullReloadAcknowledgeButtons !== 1) {
    failures.push(
      `expected one stream full reload acknowledge button, got ${initialStreamMetrics.streamFullReloadAcknowledgeButtons}`,
    );
  }
  if (initialStreamMetrics.streamEventGroups !== 2) {
    failures.push(
      `expected two initial stream event groups, got ${initialStreamMetrics.streamEventGroups}`,
    );
  }
  if (initialStreamMetrics.streamEventGroupToggleButtons !== 2) {
    failures.push(
      `expected two initial stream event group toggles, got ${initialStreamMetrics.streamEventGroupToggleButtons}`,
    );
  }
  if (initialStreamMetrics.streamSummaryGroupExpanded !== "true") {
    failures.push(
      `expected initial summary stream group expanded true, got ${initialStreamMetrics.streamSummaryGroupExpanded}`,
    );
  }
  if (initialStreamMetrics.streamTimelineGroupExpanded !== "true") {
    failures.push(
      `expected initial timeline stream group expanded true, got ${initialStreamMetrics.streamTimelineGroupExpanded}`,
    );
  }
  if (initialStreamMetrics.streamTimelineGroupCount !== "1") {
    failures.push(
      `expected initial timeline stream group count 1, got ${initialStreamMetrics.streamTimelineGroupCount}`,
    );
  }
  if (initialStreamMetrics.streamSelectionExpanded !== "true") {
    failures.push(
      `expected initial stream selection expanded true, got ${initialStreamMetrics.streamSelectionExpanded}`,
    );
  }
  if (initialStreamMetrics.streamSelectionSelectedId !== "evt_visual_stream") {
    failures.push(
      `expected initial stream selection selected id evt_visual_stream, got ${initialStreamMetrics.streamSelectionSelectedId}`,
    );
  }
  if (initialStreamMetrics.streamSelectionToggleButtons !== 1) {
    failures.push(
      `expected one stream selection toggle button, got ${initialStreamMetrics.streamSelectionToggleButtons}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventBodies !== 1) {
    failures.push(
      `expected initial stream selected event body, got ${initialStreamMetrics.streamSelectedEventBodies}`,
    );
  }
  if (
    initialStreamMetrics.streamEventKnownType !==
    expectedRuntimeStreamEvent.knownType
  ) {
    failures.push(
      `expected initial stream timeline event known type ${expectedRuntimeStreamEvent.knownType}, got ${initialStreamMetrics.streamEventKnownType}`,
    );
  }
  if (
    initialStreamMetrics.streamEventTypeStatusBadges !==
    expectedRuntimeStreamEvent.unknownBadgeCount
  ) {
    failures.push(
      `expected ${expectedRuntimeStreamEvent.unknownBadgeCount} initial stream unknown type badges, got ${initialStreamMetrics.streamEventTypeStatusBadges}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventKnownType !==
    expectedRuntimeStreamEvent.knownType
  ) {
    failures.push(
      `expected initial selected stream event known type ${expectedRuntimeStreamEvent.knownType}, got ${initialStreamMetrics.streamSelectedEventKnownType}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventTypeStatusBadges !==
    expectedRuntimeStreamEvent.unknownBadgeCount
  ) {
    failures.push(
      `expected ${expectedRuntimeStreamEvent.unknownBadgeCount} initial selected stream unknown type badges, got ${initialStreamMetrics.streamSelectedEventTypeStatusBadges}`,
    );
  }
  pushStreamContentMetricFailures(
    failures,
    initialStreamMetrics,
    "streamSelectedEventContent",
    "streamSelectedEventContentText",
    "initial stream selected event content",
  );
  if (initialStreamMetrics.streamSelectedEventArtifactCount !== "1") {
    failures.push(
      `expected initial stream selected event artifact count 1, got ${initialStreamMetrics.streamSelectedEventArtifactCount}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventArtifactRefs !== 1) {
    failures.push(
      `expected initial stream selected event artifact ref, got ${initialStreamMetrics.streamSelectedEventArtifactRefs}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventArtifactId !==
    "artifact_visual_report"
  ) {
    failures.push(
      `expected initial stream selected event artifact id artifact_visual_report, got ${initialStreamMetrics.streamSelectedEventArtifactId}`,
    );
  }
  if (initialStreamMetrics.streamExpandedEvents !== 0) {
    failures.push(
      `expected initial expanded stream events 0, got ${initialStreamMetrics.streamExpandedEvents}`,
    );
  }
  if (initialStreamMetrics.streamEventExpandToggleButtons !== 1) {
    failures.push(
      `expected one stream event expand toggle, got ${initialStreamMetrics.streamEventExpandToggleButtons}`,
    );
  }
  if (initialStreamMetrics.streamEventExpandToggleExpanded !== "false") {
    failures.push(
      `expected initial stream event expand toggle aria-expanded false, got ${initialStreamMetrics.streamEventExpandToggleExpanded}`,
    );
  }
  if (initialStreamMetrics.streamEventDetails !== 0) {
    failures.push(
      `expected initial stream event detail hidden, got ${initialStreamMetrics.streamEventDetails}`,
    );
  }
  if (streamEventExpandedMetrics.streamExpandedEvents !== 1) {
    failures.push(
      `expected expanded stream event count 1, got ${streamEventExpandedMetrics.streamExpandedEvents}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventExpandToggleExpanded !== "true") {
    failures.push(
      `expected expanded stream event toggle aria-expanded true, got ${streamEventExpandedMetrics.streamEventExpandToggleExpanded}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetails !== 1) {
    failures.push(
      `expected expanded stream event detail body, got ${streamEventExpandedMetrics.streamEventDetails}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailKnownType !==
    expectedRuntimeStreamEvent.knownType
  ) {
    failures.push(
      `expected expanded stream event detail known type ${expectedRuntimeStreamEvent.knownType}, got ${streamEventExpandedMetrics.streamEventDetailKnownType}`,
    );
  }
  if (
    !String(streamEventExpandedMetrics.streamEventDetailText ?? "").includes(
      expectedRuntimeStreamEvent.typeStatusLabel,
    )
  ) {
    failures.push(
      `expected expanded stream event detail type status ${expectedRuntimeStreamEvent.typeStatusLabel}, got ${streamEventExpandedMetrics.streamEventDetailText}`,
    );
  }
  if (
    !String(streamEventExpandedMetrics.streamEventDetailContent ?? "").includes(
      "delta content",
    ) ||
    !String(streamEventExpandedMetrics.streamEventDetailContent ?? "").includes(
      "Visual markdown detail",
    )
  ) {
    failures.push(
      `expected expanded stream event detail markdown content, got ${streamEventExpandedMetrics.streamEventDetailContent}`,
    );
  }
  pushStreamContentMetricFailures(
    failures,
    streamEventExpandedMetrics,
    "streamEventDetailContent",
    "streamEventDetailContent",
    "expanded stream event detail content",
    "/artifacts/visual-report.md",
  );
  if (streamEventExpandedMetrics.streamEventDetailSchemaVersion !== "0.1.0") {
    failures.push(
      `expected expanded stream event detail schema version 0.1.0, got ${streamEventExpandedMetrics.streamEventDetailSchemaVersion}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailSeq !== "12") {
    failures.push(
      `expected expanded stream event detail seq 12, got ${streamEventExpandedMetrics.streamEventDetailSeq}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailCreatedAt !==
    "2026-06-23T00:00:00.000Z"
  ) {
    failures.push(
      `expected expanded stream event detail created 2026-06-23T00:00:00.000Z, got ${streamEventExpandedMetrics.streamEventDetailCreatedAt}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailCategory !==
    expectedRuntimeStreamEvent.category
  ) {
    failures.push(
      `expected expanded stream event detail category ${expectedRuntimeStreamEvent.category}, got ${streamEventExpandedMetrics.streamEventDetailCategory}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailDisplayLevel !== "default") {
    failures.push(
      `expected expanded stream event detail display level default, got ${streamEventExpandedMetrics.streamEventDetailDisplayLevel}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailSeverity !== "info") {
    failures.push(
      `expected expanded stream event detail severity info, got ${streamEventExpandedMetrics.streamEventDetailSeverity}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailEventId !== "evt_visual_stream"
  ) {
    failures.push(
      `expected expanded stream event detail id evt_visual_stream, got ${streamEventExpandedMetrics.streamEventDetailEventId}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailType !==
    expectedRuntimeStreamEvent.type
  ) {
    failures.push(
      `expected expanded stream event detail type ${expectedRuntimeStreamEvent.type}, got ${streamEventExpandedMetrics.streamEventDetailType}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailTitle !==
    expectedRuntimeStreamEvent.title
  ) {
    failures.push(
      `expected expanded stream event detail title ${expectedRuntimeStreamEvent.title}, got ${streamEventExpandedMetrics.streamEventDetailTitle}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailSummary !==
    expectedRuntimeStreamEvent.summary
  ) {
    failures.push(
      `expected expanded stream event detail summary ${expectedRuntimeStreamEvent.summary}, got ${streamEventExpandedMetrics.streamEventDetailSummary}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailExpandable !== "yes") {
    failures.push(
      `expected expanded stream event detail expandable yes, got ${streamEventExpandedMetrics.streamEventDetailExpandable}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailPayloadPresent !== "yes") {
    failures.push(
      `expected expanded stream event detail payload present yes, got ${streamEventExpandedMetrics.streamEventDetailPayloadPresent}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailPayloadKind !== "object") {
    failures.push(
      `expected expanded stream event detail payload kind object, got ${streamEventExpandedMetrics.streamEventDetailPayloadKind}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailPayloadKeyCount !== "1") {
    failures.push(
      `expected expanded stream event detail payload key count 1, got ${streamEventExpandedMetrics.streamEventDetailPayloadKeyCount}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailMetadataPresent !== "yes") {
    failures.push(
      `expected expanded stream event detail metadata present yes, got ${streamEventExpandedMetrics.streamEventDetailMetadataPresent}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailMetadataKind !== "object") {
    failures.push(
      `expected expanded stream event detail metadata kind object, got ${streamEventExpandedMetrics.streamEventDetailMetadataKind}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailMetadataKeyCount !== "2") {
    failures.push(
      `expected expanded stream event detail metadata key count 2, got ${streamEventExpandedMetrics.streamEventDetailMetadataKeyCount}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailParentId !== "evt_visual_parent"
  ) {
    failures.push(
      `expected expanded stream event detail parent evt_visual_parent, got ${streamEventExpandedMetrics.streamEventDetailParentId}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailCorrelationId !==
    "trace_visual_stream"
  ) {
    failures.push(
      `expected expanded stream event detail correlation trace_visual_stream, got ${streamEventExpandedMetrics.streamEventDetailCorrelationId}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailRunId !== "run_visual_stream"
  ) {
    failures.push(
      `expected expanded stream event detail run run_visual_stream, got ${streamEventExpandedMetrics.streamEventDetailRunId}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailNodeId !==
    expectedRuntimeStreamEvent.nodeId
  ) {
    failures.push(
      `expected expanded stream event detail node ${expectedRuntimeStreamEvent.nodeId}, got ${streamEventExpandedMetrics.streamEventDetailNodeId}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailAttemptId !==
    "attempt_visual_stream"
  ) {
    failures.push(
      `expected expanded stream event detail attempt attempt_visual_stream, got ${streamEventExpandedMetrics.streamEventDetailAttemptId}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailPhase !== "attempt.streaming"
  ) {
    failures.push(
      `expected expanded stream event detail phase attempt.streaming, got ${streamEventExpandedMetrics.streamEventDetailPhase}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailSensitivity !== "sensitive") {
    failures.push(
      `expected expanded stream event detail sensitivity sensitive, got ${streamEventExpandedMetrics.streamEventDetailSensitivity}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailChildCount !== "0") {
    failures.push(
      `expected expanded stream event detail child count 0, got ${streamEventExpandedMetrics.streamEventDetailChildCount}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailArtifactCount !== "1") {
    failures.push(
      `expected expanded stream event detail artifact count 1, got ${streamEventExpandedMetrics.streamEventDetailArtifactCount}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailArtifactRefs !== 1) {
    failures.push(
      `expected expanded stream event detail artifact ref, got ${streamEventExpandedMetrics.streamEventDetailArtifactRefs}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailArtifactId !==
    "artifact_visual_report"
  ) {
    failures.push(
      `expected expanded stream event detail artifact id artifact_visual_report, got ${streamEventExpandedMetrics.streamEventDetailArtifactId}`,
    );
  }
  if (streamEventExpandedMetrics.streamEventDetailArtifactKind !== "file") {
    failures.push(
      `expected expanded stream event detail artifact kind file, got ${streamEventExpandedMetrics.streamEventDetailArtifactKind}`,
    );
  }
  if (
    streamEventExpandedMetrics.streamEventDetailArtifactPath !==
    "artifacts/visual-report.md"
  ) {
    failures.push(
      `expected expanded stream event detail artifact path artifacts/visual-report.md, got ${streamEventExpandedMetrics.streamEventDetailArtifactPath}`,
    );
  }
  if (streamEventExpandedMetrics.streamControlsBodies !== 1) {
    failures.push(
      `expected stream event detail expansion to keep controls body visible, got ${streamEventExpandedMetrics.streamControlsBodies}`,
    );
  }
  if (streamEventExpandedMetrics.streamSelectedEventBodies !== 1) {
    failures.push(
      `expected stream event detail expansion to keep selection body visible, got ${streamEventExpandedMetrics.streamSelectedEventBodies}`,
    );
  }
  if (streamEventCollapsedMetrics.streamExpandedEvents !== 0) {
    failures.push(
      `expected collapsed stream event count 0, got ${streamEventCollapsedMetrics.streamExpandedEvents}`,
    );
  }
  if (streamEventCollapsedMetrics.streamEventExpandToggleExpanded !== "false") {
    failures.push(
      `expected collapsed stream event toggle aria-expanded false, got ${streamEventCollapsedMetrics.streamEventExpandToggleExpanded}`,
    );
  }
  if (streamEventCollapsedMetrics.streamEventDetails !== 0) {
    failures.push(
      `expected collapsed stream event detail hidden, got ${streamEventCollapsedMetrics.streamEventDetails}`,
    );
  }
  if (streamFullReloadExpandedMetrics.streamPanelExpanded !== "true") {
    failures.push(
      `expected stream panel to stay expanded while full reload details are expanded, got ${streamFullReloadExpandedMetrics.streamPanelExpanded}`,
    );
  }
  if (streamFullReloadExpandedMetrics.streamFullReloadExpanded !== "true") {
    failures.push(
      `expected expanded stream full reload details true, got ${streamFullReloadExpandedMetrics.streamFullReloadExpanded}`,
    );
  }
  if (
    streamFullReloadExpandedMetrics.streamFullReloadDetailToggleExpanded !==
    "true"
  ) {
    failures.push(
      `expected expanded stream full reload details toggle aria-expanded true, got ${streamFullReloadExpandedMetrics.streamFullReloadDetailToggleExpanded}`,
    );
  }
  if (streamFullReloadExpandedMetrics.streamFullReloadDetails !== 1) {
    failures.push(
      `expected expanded stream full reload details body, got ${streamFullReloadExpandedMetrics.streamFullReloadDetails}`,
    );
  }
  if (streamFullReloadExpandedMetrics.streamFullReloadDetailsStatus !== "412") {
    failures.push(
      `expected expanded stream full reload details status 412, got ${streamFullReloadExpandedMetrics.streamFullReloadDetailsStatus}`,
    );
  }
  if (
    streamFullReloadExpandedMetrics.streamFullReloadDetailsErrorCode !==
    "SE_SSE_REPLAY_NOT_FOUND"
  ) {
    failures.push(
      `expected expanded stream full reload details error code SE_SSE_REPLAY_NOT_FOUND, got ${streamFullReloadExpandedMetrics.streamFullReloadDetailsErrorCode}`,
    );
  }
  if (
    streamFullReloadExpandedMetrics.streamFullReloadDetailsLastEventId !==
    "evt_old"
  ) {
    failures.push(
      `expected expanded stream full reload details last event evt_old, got ${streamFullReloadExpandedMetrics.streamFullReloadDetailsLastEventId}`,
    );
  }
  if (streamFullReloadExpandedMetrics.streamControlsBodies !== 1) {
    failures.push(
      `expected full reload details expansion to keep controls body visible, got ${streamFullReloadExpandedMetrics.streamControlsBodies}`,
    );
  }
  if (streamFullReloadExpandedMetrics.streamEventSelectButtons !== 2) {
    failures.push(
      `expected full reload details expansion to keep event actions visible, got ${streamFullReloadExpandedMetrics.streamEventSelectButtons}`,
    );
  }
  if (streamFullReloadExpandedMetrics.streamSelectedEventBodies !== 1) {
    failures.push(
      `expected full reload details expansion to keep selection body visible, got ${streamFullReloadExpandedMetrics.streamSelectedEventBodies}`,
    );
  }
  if (streamFullReloadCollapsedMetrics.streamFullReloadExpanded !== "false") {
    failures.push(
      `expected collapsed stream full reload details false, got ${streamFullReloadCollapsedMetrics.streamFullReloadExpanded}`,
    );
  }
  if (streamFullReloadCollapsedMetrics.streamFullReloadDetails !== 0) {
    failures.push(
      `expected collapsed stream full reload details hidden, got ${streamFullReloadCollapsedMetrics.streamFullReloadDetails}`,
    );
  }
  if (streamFullReloadCollapsedMetrics.streamControlsBodies !== 1) {
    failures.push(
      `expected full reload details collapse to keep controls body visible, got ${streamFullReloadCollapsedMetrics.streamControlsBodies}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamPanelExpanded !== "true") {
    failures.push(
      `expected stream panel to stay expanded while controls are collapsed, got ${streamControlsCollapsedMetrics.streamPanelExpanded}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamControlsExpanded !== "false") {
    failures.push(
      `expected collapsed stream controls expanded false, got ${streamControlsCollapsedMetrics.streamControlsExpanded}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamControlsToggleExpanded !== "false") {
    failures.push(
      `expected collapsed stream controls toggle aria-expanded false, got ${streamControlsCollapsedMetrics.streamControlsToggleExpanded}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamControlsBodies !== 0) {
    failures.push(
      `expected collapsed stream controls body hidden, got ${streamControlsCollapsedMetrics.streamControlsBodies}`,
    );
  }
  if (
    streamControlsCollapsedMetrics.streamControlsCollapsedSummary !==
    'Search "delta", 1 match, 1 unread'
  ) {
    failures.push(
      `expected collapsed stream controls summary, got ${streamControlsCollapsedMetrics.streamControlsCollapsedSummary}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamControlsCollapsedQuery !== "delta") {
    failures.push(
      `expected collapsed stream controls query delta, got ${streamControlsCollapsedMetrics.streamControlsCollapsedQuery}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamControlsCollapsedMatches !== "1") {
    failures.push(
      `expected collapsed stream controls matches 1, got ${streamControlsCollapsedMetrics.streamControlsCollapsedMatches}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamControlsCollapsedUnread !== "1") {
    failures.push(
      `expected collapsed stream controls unread 1, got ${streamControlsCollapsedMetrics.streamControlsCollapsedUnread}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamEventSelectButtons !== 2) {
    failures.push(
      `expected controls collapse to keep event actions visible, got ${streamControlsCollapsedMetrics.streamEventSelectButtons}`,
    );
  }
  if (streamControlsCollapsedMetrics.streamSelectedEventBodies !== 1) {
    failures.push(
      `expected controls collapse to keep selection body visible, got ${streamControlsCollapsedMetrics.streamSelectedEventBodies}`,
    );
  }
  if (streamControlsExpandedMetrics.streamControlsExpanded !== "true") {
    failures.push(
      `expected re-expanded stream controls expanded true, got ${streamControlsExpandedMetrics.streamControlsExpanded}`,
    );
  }
  if (streamControlsExpandedMetrics.streamControlsBodies !== 1) {
    failures.push(
      `expected re-expanded stream controls body, got ${streamControlsExpandedMetrics.streamControlsBodies}`,
    );
  }
  if (streamGroupCollapsedMetrics.streamPanelExpanded !== "true") {
    failures.push(
      `expected stream panel to stay expanded while group is collapsed, got ${streamGroupCollapsedMetrics.streamPanelExpanded}`,
    );
  }
  if (streamGroupCollapsedMetrics.streamSummaryGroupExpanded !== "true") {
    failures.push(
      `expected summary stream group to remain expanded, got ${streamGroupCollapsedMetrics.streamSummaryGroupExpanded}`,
    );
  }
  if (streamGroupCollapsedMetrics.streamTimelineGroupExpanded !== "false") {
    failures.push(
      `expected collapsed timeline stream group expanded false, got ${streamGroupCollapsedMetrics.streamTimelineGroupExpanded}`,
    );
  }
  if (
    streamGroupCollapsedMetrics.streamTimelineGroupToggleExpanded !== "false"
  ) {
    failures.push(
      `expected collapsed timeline stream group toggle aria-expanded false, got ${streamGroupCollapsedMetrics.streamTimelineGroupToggleExpanded}`,
    );
  }
  if (
    streamGroupCollapsedMetrics.streamTimelineGroupCollapsedSummary !==
    "Timeline hidden, 1 event"
  ) {
    failures.push(
      `expected collapsed timeline stream group summary, got ${streamGroupCollapsedMetrics.streamTimelineGroupCollapsedSummary}`,
    );
  }
  if (streamGroupCollapsedMetrics.streamTimelineGroupCollapsedCount !== "1") {
    failures.push(
      `expected collapsed timeline stream group count 1, got ${streamGroupCollapsedMetrics.streamTimelineGroupCollapsedCount}`,
    );
  }
  if (streamGroupCollapsedMetrics.streamEventSelectButtons !== 0) {
    failures.push(
      `expected collapsed timeline stream group to hide event actions, got ${streamGroupCollapsedMetrics.streamEventSelectButtons}`,
    );
  }
  if (streamGroupExpandedMetrics.streamTimelineGroupExpanded !== "true") {
    failures.push(
      `expected re-expanded timeline stream group expanded true, got ${streamGroupExpandedMetrics.streamTimelineGroupExpanded}`,
    );
  }
  if (streamGroupExpandedMetrics.streamEventSelectButtons !== 2) {
    failures.push(
      `expected re-expanded timeline stream group event actions, got ${streamGroupExpandedMetrics.streamEventSelectButtons}`,
    );
  }
  if (streamSelectionCollapsedMetrics.streamPanelExpanded !== "true") {
    failures.push(
      `expected stream panel to stay expanded while selection is collapsed, got ${streamSelectionCollapsedMetrics.streamPanelExpanded}`,
    );
  }
  if (streamSelectionCollapsedMetrics.streamTimelineGroupExpanded !== "true") {
    failures.push(
      `expected timeline group to stay expanded while selection is collapsed, got ${streamSelectionCollapsedMetrics.streamTimelineGroupExpanded}`,
    );
  }
  if (streamSelectionCollapsedMetrics.streamSelectionExpanded !== "false") {
    failures.push(
      `expected collapsed stream selection expanded false, got ${streamSelectionCollapsedMetrics.streamSelectionExpanded}`,
    );
  }
  if (
    streamSelectionCollapsedMetrics.streamSelectionToggleExpanded !== "false"
  ) {
    failures.push(
      `expected collapsed stream selection toggle aria-expanded false, got ${streamSelectionCollapsedMetrics.streamSelectionToggleExpanded}`,
    );
  }
  if (
    streamSelectionCollapsedMetrics.streamSelectionCollapsedSummary !==
    `${expectedRuntimeStreamEvent.collapsedSelectionTitle}, ${expectedRuntimeStreamEvent.type}`
  ) {
    failures.push(
      `expected collapsed stream selection summary, got ${streamSelectionCollapsedMetrics.streamSelectionCollapsedSummary}`,
    );
  }
  if (
    streamSelectionCollapsedMetrics.streamSelectionCollapsedSelectedId !==
    "evt_visual_stream"
  ) {
    failures.push(
      `expected collapsed stream selection selected id evt_visual_stream, got ${streamSelectionCollapsedMetrics.streamSelectionCollapsedSelectedId}`,
    );
  }
  if (
    streamSelectionCollapsedMetrics.streamSelectionCollapsedSelectedType !==
    expectedRuntimeStreamEvent.type
  ) {
    failures.push(
      `expected collapsed stream selection selected type ${expectedRuntimeStreamEvent.type}, got ${streamSelectionCollapsedMetrics.streamSelectionCollapsedSelectedType}`,
    );
  }
  if (streamSelectionCollapsedMetrics.streamSelectedEventBodies !== 0) {
    failures.push(
      `expected collapsed stream selection body hidden, got ${streamSelectionCollapsedMetrics.streamSelectedEventBodies}`,
    );
  }
  if (streamSelectionCollapsedMetrics.streamEventSelectButtons !== 2) {
    failures.push(
      `expected selection collapse to keep event actions visible, got ${streamSelectionCollapsedMetrics.streamEventSelectButtons}`,
    );
  }
  if (streamSelectionExpandedMetrics.streamSelectionExpanded !== "true") {
    failures.push(
      `expected re-expanded stream selection expanded true, got ${streamSelectionExpandedMetrics.streamSelectionExpanded}`,
    );
  }
  if (streamSelectionExpandedMetrics.streamSelectedEventBodies !== 1) {
    failures.push(
      `expected re-expanded stream selection body, got ${streamSelectionExpandedMetrics.streamSelectedEventBodies}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventParentId !== "evt_visual_parent"
  ) {
    failures.push(
      `expected initial selected stream parent evt_visual_parent, got ${initialStreamMetrics.streamSelectedEventParentId}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventSchemaVersion !== "0.1.0") {
    failures.push(
      `expected initial selected stream schema version 0.1.0, got ${initialStreamMetrics.streamSelectedEventSchemaVersion}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventSeq !== "12") {
    failures.push(
      `expected initial selected stream seq 12, got ${initialStreamMetrics.streamSelectedEventSeq}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventCreatedAt !==
    "2026-06-23T00:00:00.000Z"
  ) {
    failures.push(
      `expected initial selected stream created 2026-06-23T00:00:00.000Z, got ${initialStreamMetrics.streamSelectedEventCreatedAt}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventCategory !==
    expectedRuntimeStreamEvent.category
  ) {
    failures.push(
      `expected initial selected stream category ${expectedRuntimeStreamEvent.category}, got ${initialStreamMetrics.streamSelectedEventCategory}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventDisplayLevel !== "default") {
    failures.push(
      `expected initial selected stream display level default, got ${initialStreamMetrics.streamSelectedEventDisplayLevel}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventSeverity !== "info") {
    failures.push(
      `expected initial selected stream severity info, got ${initialStreamMetrics.streamSelectedEventSeverity}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventId !== "evt_visual_stream") {
    failures.push(
      `expected initial selected stream id evt_visual_stream, got ${initialStreamMetrics.streamSelectedEventId}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventType !==
    expectedRuntimeStreamEvent.type
  ) {
    failures.push(
      `expected initial selected stream type ${expectedRuntimeStreamEvent.type}, got ${initialStreamMetrics.streamSelectedEventType}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventTitle !==
    expectedRuntimeStreamEvent.title
  ) {
    failures.push(
      `expected initial selected stream title ${expectedRuntimeStreamEvent.title}, got ${initialStreamMetrics.streamSelectedEventTitle}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventSummary !==
    expectedRuntimeStreamEvent.summary
  ) {
    failures.push(
      `expected initial selected stream summary ${expectedRuntimeStreamEvent.summary}, got ${initialStreamMetrics.streamSelectedEventSummary}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventExpandable !== "yes") {
    failures.push(
      `expected initial selected stream expandable yes, got ${initialStreamMetrics.streamSelectedEventExpandable}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventPayloadPresent !== "yes") {
    failures.push(
      `expected initial selected stream payload present yes, got ${initialStreamMetrics.streamSelectedEventPayloadPresent}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventPayloadKind !== "object") {
    failures.push(
      `expected initial selected stream payload kind object, got ${initialStreamMetrics.streamSelectedEventPayloadKind}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventPayloadKeyCount !== "1") {
    failures.push(
      `expected initial selected stream payload key count 1, got ${initialStreamMetrics.streamSelectedEventPayloadKeyCount}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventMetadataPresent !== "yes") {
    failures.push(
      `expected initial selected stream metadata present yes, got ${initialStreamMetrics.streamSelectedEventMetadataPresent}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventMetadataKind !== "object") {
    failures.push(
      `expected initial selected stream metadata kind object, got ${initialStreamMetrics.streamSelectedEventMetadataKind}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventMetadataKeyCount !== "2") {
    failures.push(
      `expected initial selected stream metadata key count 2, got ${initialStreamMetrics.streamSelectedEventMetadataKeyCount}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventCorrelationId !==
    "trace_visual_stream"
  ) {
    failures.push(
      `expected initial selected stream correlation trace_visual_stream, got ${initialStreamMetrics.streamSelectedEventCorrelationId}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventRunId !== "run_visual_stream") {
    failures.push(
      `expected initial selected stream run run_visual_stream, got ${initialStreamMetrics.streamSelectedEventRunId}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventNodeId !==
    expectedRuntimeStreamEvent.nodeId
  ) {
    failures.push(
      `expected initial selected stream node ${expectedRuntimeStreamEvent.nodeId}, got ${initialStreamMetrics.streamSelectedEventNodeId}`,
    );
  }
  if (
    initialStreamMetrics.streamSelectedEventAttemptId !==
    "attempt_visual_stream"
  ) {
    failures.push(
      `expected initial selected stream attempt attempt_visual_stream, got ${initialStreamMetrics.streamSelectedEventAttemptId}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventPhase !== "attempt.streaming") {
    failures.push(
      `expected initial selected stream phase attempt.streaming, got ${initialStreamMetrics.streamSelectedEventPhase}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventSensitivity !== "sensitive") {
    failures.push(
      `expected initial selected stream sensitivity sensitive, got ${initialStreamMetrics.streamSelectedEventSensitivity}`,
    );
  }
  if (initialStreamMetrics.streamSelectedEventChildCount !== "0") {
    failures.push(
      `expected initial selected stream child count 0, got ${initialStreamMetrics.streamSelectedEventChildCount}`,
    );
  }
  if (initialStreamMetrics.streamSelectionMetadataToggles !== 1) {
    failures.push(
      `expected one stream selection metadata toggle, got ${initialStreamMetrics.streamSelectionMetadataToggles}`,
    );
  }
  if (initialStreamMetrics.streamSelectionMetadataToggleExpanded !== "false") {
    failures.push(
      `expected initial stream selection metadata toggle aria-expanded false, got ${initialStreamMetrics.streamSelectionMetadataToggleExpanded}`,
    );
  }
  if (initialStreamMetrics.streamSelectionMetadataDetails !== 0) {
    failures.push(
      `expected initial stream selection metadata hidden, got ${initialStreamMetrics.streamSelectionMetadataDetails}`,
    );
  }
  if (streamSelectionMetadataExpandedMetrics.streamPanelExpanded !== "true") {
    failures.push(
      `expected stream panel to stay expanded while selection metadata is expanded, got ${streamSelectionMetadataExpandedMetrics.streamPanelExpanded}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionExpanded !== "true"
  ) {
    failures.push(
      `expected selection to stay expanded while metadata is expanded, got ${streamSelectionMetadataExpandedMetrics.streamSelectionExpanded}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataToggleExpanded !==
    "true"
  ) {
    failures.push(
      `expected expanded stream selection metadata toggle aria-expanded true, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataToggleExpanded}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataDetails !== 1
  ) {
    failures.push(
      `expected expanded stream selection metadata body, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataDetails}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataKnownType !==
    expectedRuntimeStreamEvent.knownType
  ) {
    failures.push(
      `expected expanded stream selection metadata known type ${expectedRuntimeStreamEvent.knownType}, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataKnownType}`,
    );
  }
  if (
    !String(
      streamSelectionMetadataExpandedMetrics.streamSelectionMetadataText ?? "",
    ).includes(expectedRuntimeStreamEvent.typeStatusLabel)
  ) {
    failures.push(
      `expected expanded stream selection metadata type status ${expectedRuntimeStreamEvent.typeStatusLabel}, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataText}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataCategory !==
    expectedRuntimeStreamEvent.category
  ) {
    failures.push(
      `expected expanded stream selection metadata category ${expectedRuntimeStreamEvent.category}, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataCategory}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataDisplayLevel !==
    "default"
  ) {
    failures.push(
      `expected expanded stream selection metadata display level default, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataDisplayLevel}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSeverity !==
    "info"
  ) {
    failures.push(
      `expected expanded stream selection metadata severity info, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSeverity}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataEventId !==
    "evt_visual_stream"
  ) {
    failures.push(
      `expected expanded stream selection metadata id evt_visual_stream, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataEventId}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataType !==
    expectedRuntimeStreamEvent.type
  ) {
    failures.push(
      `expected expanded stream selection metadata type ${expectedRuntimeStreamEvent.type}, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataType}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataTitle !==
    expectedRuntimeStreamEvent.title
  ) {
    failures.push(
      `expected expanded stream selection metadata title ${expectedRuntimeStreamEvent.title}, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataTitle}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSummary !==
    expectedRuntimeStreamEvent.summary
  ) {
    failures.push(
      `expected expanded stream selection metadata summary ${expectedRuntimeStreamEvent.summary}, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSummary}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPayloadPresent !==
    "yes"
  ) {
    failures.push(
      `expected expanded stream selection metadata payload present yes, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPayloadPresent}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPayloadKind !==
    "object"
  ) {
    failures.push(
      `expected expanded stream selection metadata payload kind object, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPayloadKind}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPayloadKeyCount !==
    "1"
  ) {
    failures.push(
      `expected expanded stream selection metadata payload key count 1, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPayloadKeyCount}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataMetadataPresent !==
    "yes"
  ) {
    failures.push(
      `expected expanded stream selection metadata metadata present yes, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataMetadataPresent}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataMetadataKind !==
    "object"
  ) {
    failures.push(
      `expected expanded stream selection metadata metadata kind object, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataMetadataKind}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataMetadataKeyCount !==
    "2"
  ) {
    failures.push(
      `expected expanded stream selection metadata metadata key count 2, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataMetadataKeyCount}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSchemaVersion !==
    "0.1.0"
  ) {
    failures.push(
      `expected expanded stream selection metadata schema version 0.1.0, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSchemaVersion}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSeq !== "12"
  ) {
    failures.push(
      `expected expanded stream selection metadata seq 12, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSeq}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataCreatedAt !==
    "2026-06-23T00:00:00.000Z"
  ) {
    failures.push(
      `expected expanded stream selection metadata created 2026-06-23T00:00:00.000Z, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataCreatedAt}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataCorrelationId !==
    "trace_visual_stream"
  ) {
    failures.push(
      `expected expanded stream selection metadata correlation trace_visual_stream, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataCorrelationId}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataRunId !==
    "run_visual_stream"
  ) {
    failures.push(
      `expected expanded stream selection metadata run run_visual_stream, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataRunId}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataNodeId !==
    expectedRuntimeStreamEvent.nodeId
  ) {
    failures.push(
      `expected expanded stream selection metadata node ${expectedRuntimeStreamEvent.nodeId}, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataNodeId}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataAttemptId !==
    "attempt_visual_stream"
  ) {
    failures.push(
      `expected expanded stream selection metadata attempt attempt_visual_stream, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataAttemptId}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPhase !==
    "attempt.streaming"
  ) {
    failures.push(
      `expected expanded stream selection metadata phase attempt.streaming, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataPhase}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSensitivity !==
    "sensitive"
  ) {
    failures.push(
      `expected expanded stream selection metadata sensitivity sensitive, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataSensitivity}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataParentId !==
    "evt_visual_parent"
  ) {
    failures.push(
      `expected expanded stream selection metadata parent evt_visual_parent, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataParentId}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataChildCount !==
    "0"
  ) {
    failures.push(
      `expected expanded stream selection metadata child count 0, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataChildCount}`,
    );
  }
  if (
    streamSelectionMetadataExpandedMetrics.streamSelectionMetadataExpandable !==
    "yes"
  ) {
    failures.push(
      `expected expanded stream selection metadata expandable yes, got ${streamSelectionMetadataExpandedMetrics.streamSelectionMetadataExpandable}`,
    );
  }
  if (streamSelectionMetadataExpandedMetrics.streamControlsBodies !== 1) {
    failures.push(
      `expected selection metadata expansion to keep controls body visible, got ${streamSelectionMetadataExpandedMetrics.streamControlsBodies}`,
    );
  }
  if (streamSelectionMetadataExpandedMetrics.streamEventSelectButtons !== 2) {
    failures.push(
      `expected selection metadata expansion to keep event actions visible, got ${streamSelectionMetadataExpandedMetrics.streamEventSelectButtons}`,
    );
  }
  if (
    streamSelectionMetadataCollapsedMetrics.streamSelectionMetadataToggleExpanded !==
    "false"
  ) {
    failures.push(
      `expected collapsed stream selection metadata toggle aria-expanded false, got ${streamSelectionMetadataCollapsedMetrics.streamSelectionMetadataToggleExpanded}`,
    );
  }
  if (
    streamSelectionMetadataCollapsedMetrics.streamSelectionMetadataDetails !== 0
  ) {
    failures.push(
      `expected collapsed stream selection metadata hidden, got ${streamSelectionMetadataCollapsedMetrics.streamSelectionMetadataDetails}`,
    );
  }
  if (streamCollapsedMetrics.streamPanelExpanded !== "false") {
    failures.push(
      `expected collapsed stream panel expanded false, got ${streamCollapsedMetrics.streamPanelExpanded}`,
    );
  }
  if (streamCollapsedMetrics.streamPanelToggleExpanded !== "false") {
    failures.push(
      `expected collapsed stream panel toggle aria-expanded false, got ${streamCollapsedMetrics.streamPanelToggleExpanded}`,
    );
  }
  if (streamCollapsedMetrics.streamPanelControls !== 0) {
    failures.push(
      `expected collapsed stream panel controls hidden, got ${streamCollapsedMetrics.streamPanelControls}`,
    );
  }
  if (streamCollapsedMetrics.streamPanelBodies !== 0) {
    failures.push(
      `expected collapsed stream panel body hidden, got ${streamCollapsedMetrics.streamPanelBodies}`,
    );
  }
  if (streamCollapsedMetrics.streamFullReloads !== 0) {
    failures.push(
      `expected collapsed stream full reload hidden, got ${streamCollapsedMetrics.streamFullReloads}`,
    );
  }
  if (streamCollapsedMetrics.streamEventSelectButtons !== 0) {
    failures.push(
      `expected collapsed stream event actions hidden, got ${streamCollapsedMetrics.streamEventSelectButtons}`,
    );
  }
  if (
    streamCollapsedMetrics.streamPanelCollapsedSummary !==
    "Run run_live_smoke, 1 visible, 1 unread"
  ) {
    failures.push(
      `expected collapsed stream summary, got ${streamCollapsedMetrics.streamPanelCollapsedSummary}`,
    );
  }
  if (streamCollapsedMetrics.streamPanelCollapsedVisible !== "1") {
    failures.push(
      `expected collapsed stream visible count 1, got ${streamCollapsedMetrics.streamPanelCollapsedVisible}`,
    );
  }
  if (streamCollapsedMetrics.streamPanelCollapsedUnread !== "1") {
    failures.push(
      `expected collapsed stream unread count 1, got ${streamCollapsedMetrics.streamPanelCollapsedUnread}`,
    );
  }
  if (streamExpandedMetrics.streamPanelExpanded !== "true") {
    failures.push(
      `expected re-expanded stream panel expanded true, got ${streamExpandedMetrics.streamPanelExpanded}`,
    );
  }
  if (streamExpandedMetrics.streamPanelControls !== 1) {
    failures.push(
      `expected re-expanded stream panel controls, got ${streamExpandedMetrics.streamPanelControls}`,
    );
  }
  if (streamExpandedMetrics.streamPanelBodies !== 1) {
    failures.push(
      `expected re-expanded stream panel body, got ${streamExpandedMetrics.streamPanelBodies}`,
    );
  }
  if (metrics.hasFileTree !== true) {
    failures.push("missing file tree");
  }
  if (metrics.hasVersionSnapshots !== true) {
    failures.push("missing version snapshots");
  }
  if (metrics.hasWorkflowCanvas !== true) {
    failures.push("missing workflow canvas");
  }
  if (metrics.activePanelText !== "Lifecycle") {
    failures.push(
      `expected Lifecycle active panel, got ${metrics.activePanelText}`,
    );
  }
  if (metrics.activePanelTabs !== 1) {
    failures.push(
      `expected one active panel tab, got ${metrics.activePanelTabs}`,
    );
  }
  if (metrics.lifecycleTabActive !== true) {
    failures.push("missing active lifecycle tab after smoke reset");
  }
  if (metrics.hasLifecyclePanel !== true) {
    failures.push("missing lifecycle panel");
  }
  if (metrics.hasTaskDrawer !== true) {
    failures.push("missing task drawer");
  }
  if (metrics.hasChatBox !== true) {
    failures.push("missing chat box");
  }
  if (metrics.dockItems !== 4) {
    failures.push(`expected 4 dock items, got ${metrics.dockItems}`);
  }
  if (metrics.fileTreeNodes !== 5) {
    failures.push(`expected 5 file tree nodes, got ${metrics.fileTreeNodes}`);
  }
  if (initialFileTreeMetrics.fileTreeSelectableNodes !== 5) {
    failures.push(
      `expected 5 selectable file tree nodes, got ${initialFileTreeMetrics.fileTreeSelectableNodes}`,
    );
  }
  if (initialFileTreeMetrics.selectedFileTreeNodes !== 1) {
    failures.push(
      `expected one selected file tree node initially, got ${initialFileTreeMetrics.selectedFileTreeNodes}`,
    );
  }
  if (initialFileTreeMetrics.selectedFileTreeNodeId !== "workspace_root") {
    failures.push(
      `expected initial file tree selection workspace_root, got ${initialFileTreeMetrics.selectedFileTreeNodeId}`,
    );
  }
  if (initialFileTreeMetrics.fileTreeDetailsNodeId !== "workspace_root") {
    failures.push(
      `expected initial file tree details workspace_root, got ${initialFileTreeMetrics.fileTreeDetailsNodeId}`,
    );
  }
  if (initialFileTreeMetrics.fileTreeDetailsPath !== "workspace root") {
    failures.push(
      `expected initial file tree details path workspace root, got ${initialFileTreeMetrics.fileTreeDetailsPath}`,
    );
  }
  if (fileTreeSelectMetrics.selectedFileTreeNodes !== 1) {
    failures.push(
      `expected one selected file tree node after click, got ${fileTreeSelectMetrics.selectedFileTreeNodes}`,
    );
  }
  if (fileTreeSelectMetrics.selectedFileTreeNodeId !== "workflow_graph") {
    failures.push(
      `expected workflow_graph file tree selection after click, got ${fileTreeSelectMetrics.selectedFileTreeNodeId}`,
    );
  }
  if (fileTreeSelectMetrics.fileTreeDetailsNodeId !== "workflow_graph") {
    failures.push(
      `expected workflow_graph file tree details after click, got ${fileTreeSelectMetrics.fileTreeDetailsNodeId}`,
    );
  }
  if (
    fileTreeSelectMetrics.fileTreeDetailsPath !==
    "specs/schemas/workflow_graph.md"
  ) {
    failures.push(
      `expected workflow_graph file tree details path specs/schemas/workflow_graph.md, got ${fileTreeSelectMetrics.fileTreeDetailsPath}`,
    );
  }
  if (fileTreeSelectMetrics.fileTreeDetailsStatus !== "Spec") {
    failures.push(
      `expected workflow_graph file tree details status Spec, got ${fileTreeSelectMetrics.fileTreeDetailsStatus}`,
    );
  }
  if (fileTreeSelectMetrics.fileTreeDetailsDepth !== "1") {
    failures.push(
      `expected workflow_graph file tree details depth 1, got ${fileTreeSelectMetrics.fileTreeDetailsDepth}`,
    );
  }
  if (metrics.versionSnapshotItems !== 4) {
    failures.push(
      `expected 4 version snapshot items, got ${metrics.versionSnapshotItems}`,
    );
  }
  if (metrics.workflowCanvasNodes !== 5) {
    failures.push(
      `expected 5 workflow canvas nodes, got ${metrics.workflowCanvasNodes}`,
    );
  }
  if (metrics.workflowCanvasEdges !== 5) {
    failures.push(
      `expected 5 workflow canvas edges, got ${metrics.workflowCanvasEdges}`,
    );
  }
  if (metrics.activeVersionSnapshotItems !== 1) {
    failures.push(
      `expected one active version snapshot item, got ${metrics.activeVersionSnapshotItems}`,
    );
  }
  if (initialVersionSnapshotMetrics.versionSnapshotSelectableItems !== 4) {
    failures.push(
      `expected 4 selectable version snapshots, got ${initialVersionSnapshotMetrics.versionSnapshotSelectableItems}`,
    );
  }
  if (initialVersionSnapshotMetrics.selectedVersionSnapshotItems !== 1) {
    failures.push(
      `expected one selected version snapshot initially, got ${initialVersionSnapshotMetrics.selectedVersionSnapshotItems}`,
    );
  }
  if (
    initialVersionSnapshotMetrics.selectedVersionSnapshotId !== "validation"
  ) {
    failures.push(
      `expected initial version snapshot selection validation, got ${initialVersionSnapshotMetrics.selectedVersionSnapshotId}`,
    );
  }
  if (initialVersionSnapshotMetrics.versionSnapshotDetailsId !== "validation") {
    failures.push(
      `expected initial version snapshot details validation, got ${initialVersionSnapshotMetrics.versionSnapshotDetailsId}`,
    );
  }
  if (initialVersionSnapshotMetrics.versionSnapshotDetailsStatus !== "Active") {
    failures.push(
      `expected initial version snapshot details status Active, got ${initialVersionSnapshotMetrics.versionSnapshotDetailsStatus}`,
    );
  }
  if (
    initialVersionSnapshotMetrics.versionSnapshotDetailsValue !== "5 visible"
  ) {
    failures.push(
      `expected initial version snapshot details value 5 visible, got ${initialVersionSnapshotMetrics.versionSnapshotDetailsValue}`,
    );
  }
  if (initialVersionSnapshotMetrics.versionSnapshotDetailsActive !== "true") {
    failures.push(
      `expected initial version snapshot details active true, got ${initialVersionSnapshotMetrics.versionSnapshotDetailsActive}`,
    );
  }
  if (
    !initialVersionSnapshotMetrics.versionSnapshotDetailsText?.includes(
      "ActiveYes",
    )
  ) {
    failures.push(
      `expected initial version snapshot visible details to include ActiveYes, got ${initialVersionSnapshotMetrics.versionSnapshotDetailsText}`,
    );
  }
  if (versionSnapshotSelectMetrics.selectedVersionSnapshotItems !== 1) {
    failures.push(
      `expected one selected version snapshot after click, got ${versionSnapshotSelectMetrics.selectedVersionSnapshotItems}`,
    );
  }
  if (
    versionSnapshotSelectMetrics.selectedVersionSnapshotId !== "git_snapshot"
  ) {
    failures.push(
      `expected git_snapshot version snapshot selection after click, got ${versionSnapshotSelectMetrics.selectedVersionSnapshotId}`,
    );
  }
  if (
    versionSnapshotSelectMetrics.versionSnapshotDetailsId !== "git_snapshot"
  ) {
    failures.push(
      `expected git_snapshot version snapshot details after click, got ${versionSnapshotSelectMetrics.versionSnapshotDetailsId}`,
    );
  }
  if (versionSnapshotSelectMetrics.versionSnapshotDetailsStatus !== "Future") {
    failures.push(
      `expected git_snapshot version snapshot details status Future, got ${versionSnapshotSelectMetrics.versionSnapshotDetailsStatus}`,
    );
  }
  if (
    versionSnapshotSelectMetrics.versionSnapshotDetailsValue !== "Not created"
  ) {
    failures.push(
      `expected git_snapshot version snapshot details value Not created, got ${versionSnapshotSelectMetrics.versionSnapshotDetailsValue}`,
    );
  }
  if (versionSnapshotSelectMetrics.versionSnapshotDetailsActive !== "false") {
    failures.push(
      `expected git_snapshot version snapshot details active false, got ${versionSnapshotSelectMetrics.versionSnapshotDetailsActive}`,
    );
  }
  if (
    !versionSnapshotSelectMetrics.versionSnapshotDetailsText?.includes(
      "ActiveNo",
    )
  ) {
    failures.push(
      `expected git_snapshot version snapshot visible details to include ActiveNo, got ${versionSnapshotSelectMetrics.versionSnapshotDetailsText}`,
    );
  }
  if (versionSnapshotKeyboardMetrics.selectedVersionSnapshotItems !== 1) {
    failures.push(
      `expected one selected version snapshot after keyboard, got ${versionSnapshotKeyboardMetrics.selectedVersionSnapshotItems}`,
    );
  }
  if (versionSnapshotKeyboardMetrics.selectedVersionSnapshotId !== "runtime") {
    failures.push(
      `expected runtime version snapshot selection after keyboard, got ${versionSnapshotKeyboardMetrics.selectedVersionSnapshotId}`,
    );
  }
  if (versionSnapshotKeyboardMetrics.versionSnapshotDetailsId !== "runtime") {
    failures.push(
      `expected runtime version snapshot details after keyboard, got ${versionSnapshotKeyboardMetrics.versionSnapshotDetailsId}`,
    );
  }
  if (versionSnapshotKeyboardMetrics.versionSnapshotDetailsStatus !== "Idle") {
    failures.push(
      `expected runtime version snapshot details status Idle after keyboard, got ${versionSnapshotKeyboardMetrics.versionSnapshotDetailsStatus}`,
    );
  }
  if (
    versionSnapshotKeyboardMetrics.versionSnapshotDetailsValue !==
    "No active stream"
  ) {
    failures.push(
      `expected runtime version snapshot details value No active stream after keyboard, got ${versionSnapshotKeyboardMetrics.versionSnapshotDetailsValue}`,
    );
  }
  if (versionSnapshotKeyboardMetrics.versionSnapshotDetailsActive !== "false") {
    failures.push(
      `expected runtime version snapshot details active false after keyboard, got ${versionSnapshotKeyboardMetrics.versionSnapshotDetailsActive}`,
    );
  }
  if (metrics.activeWorkflowCanvasNodes !== 1) {
    failures.push(
      `expected one active workflow canvas node, got ${metrics.activeWorkflowCanvasNodes}`,
    );
  }
  if (metrics.previewWorkflowCanvasSurfaces !== 1) {
    failures.push(
      `expected one preview workflow canvas surface, got ${metrics.previewWorkflowCanvasSurfaces}`,
    );
  }
  if (metrics.focusedWorkflowCanvasSurfaces !== 0) {
    failures.push(
      `expected no focused workflow canvas surface in lifecycle smoke, got ${metrics.focusedWorkflowCanvasSurfaces}`,
    );
  }
  if (metrics.workflowCanvasSummaries !== 0) {
    failures.push(
      `expected no focused canvas summary in lifecycle smoke, got ${metrics.workflowCanvasSummaries}`,
    );
  }
  if (metrics.workflowCanvasTypeFocusButtons !== 0) {
    failures.push(
      `expected no canvas type focus buttons in lifecycle smoke, got ${metrics.workflowCanvasTypeFocusButtons}`,
    );
  }
  if (metrics.selectedWorkflowCanvasEdges !== 0) {
    failures.push(
      `expected no selected workflow canvas edges in lifecycle smoke, got ${metrics.selectedWorkflowCanvasEdges}`,
    );
  }
  if (canvasMetrics.activePanelText !== "Canvas") {
    failures.push(
      `expected Canvas active panel, got ${canvasMetrics.activePanelText}`,
    );
  }
  if (canvasMetrics.canvasTabActive !== true) {
    failures.push("missing active canvas tab after canvas click");
  }
  if (canvasMetrics.canvasDockActive !== true) {
    failures.push("missing active canvas dock item after canvas click");
  }
  if (canvasMetrics.previewWorkflowCanvasSurfaces !== 1) {
    failures.push(
      `expected one preview canvas surface after canvas click, got ${canvasMetrics.previewWorkflowCanvasSurfaces}`,
    );
  }
  if (canvasMetrics.focusedWorkflowCanvasSurfaces !== 1) {
    failures.push(
      `expected one focused canvas surface after canvas click, got ${canvasMetrics.focusedWorkflowCanvasSurfaces}`,
    );
  }
  if (canvasMetrics.selectableWorkflowCanvasNodes !== 5) {
    failures.push(
      `expected 5 selectable focused canvas nodes, got ${canvasMetrics.selectableWorkflowCanvasNodes}`,
    );
  }
  if (canvasMetrics.workflowCanvasSummaries !== 1) {
    failures.push(
      `expected one focused canvas summary, got ${canvasMetrics.workflowCanvasSummaries}`,
    );
  }
  if (canvasMetrics.workflowCanvasTypeFocusButtons !== 9) {
    failures.push(
      `expected 9 focused canvas type focus buttons, got ${canvasMetrics.workflowCanvasTypeFocusButtons}`,
    );
  }
  if (canvasMetrics.workflowCanvasTypeFocusActiveButtons !== 0) {
    failures.push(
      `expected no active canvas type focus before selection, got ${canvasMetrics.workflowCanvasTypeFocusActiveButtons}`,
    );
  }
  if (canvasMetrics.workflowCanvasSummaryNodes !== "5") {
    failures.push(
      `expected focused canvas summary nodes 5, got ${canvasMetrics.workflowCanvasSummaryNodes}`,
    );
  }
  if (canvasMetrics.workflowCanvasSummaryEdges !== "5") {
    failures.push(
      `expected focused canvas summary edges 5, got ${canvasMetrics.workflowCanvasSummaryEdges}`,
    );
  }
  if (canvasMetrics.workflowCanvasSummaryActiveNodes !== "1") {
    failures.push(
      `expected focused canvas summary active nodes 1, got ${canvasMetrics.workflowCanvasSummaryActiveNodes}`,
    );
  }
  if (canvasMetrics.workflowCanvasSummaryEntryNodes !== "1") {
    failures.push(
      `expected focused canvas summary entry nodes 1, got ${canvasMetrics.workflowCanvasSummaryEntryNodes}`,
    );
  }
  if (canvasMetrics.workflowCanvasSummaryTerminalNodes !== "1") {
    failures.push(
      `expected focused canvas summary terminal nodes 1, got ${canvasMetrics.workflowCanvasSummaryTerminalNodes}`,
    );
  }
  const workflowCanvasSummaryNodeTypes = Array.isArray(
    canvasMetrics.workflowCanvasSummaryNodeTypes,
  )
    ? canvasMetrics.workflowCanvasSummaryNodeTypes.join(",")
    : "";
  if (
    workflowCanvasSummaryNodeTypes !==
    "end:1,evaluation_task:1,execution_task:1,repair_task:1,start:1"
  ) {
    failures.push(
      `expected focused canvas summary node types end/evaluation/execution/repair/start, got ${workflowCanvasSummaryNodeTypes}`,
    );
  }
  const workflowCanvasSummaryEdgeTypes = Array.isArray(
    canvasMetrics.workflowCanvasSummaryEdgeTypes,
  )
    ? canvasMetrics.workflowCanvasSummaryEdgeTypes.join(",")
    : "";
  if (workflowCanvasSummaryEdgeTypes !== "fail:1,normal:2,pass:1,repair:1") {
    failures.push(
      `expected focused canvas summary edge types fail/normal/pass/repair, got ${workflowCanvasSummaryEdgeTypes}`,
    );
  }
  if (canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusKind !== "node") {
    failures.push(
      `expected node type focus kind node, got ${canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusKind}`,
    );
  }
  if (
    canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusValue !== "repair_task"
  ) {
    failures.push(
      `expected node type focus value repair_task, got ${canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusValue}`,
    );
  }
  if (canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusActiveButtons !== 1) {
    failures.push(
      `expected one active node type focus button, got ${canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusActiveButtons}`,
    );
  }
  if (canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasNodes !== 1) {
    failures.push(
      `expected one node highlighted by node type focus, got ${canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasNodes}`,
    );
  }
  if (nodeTypeFocusNodeIds !== "repair_task") {
    failures.push(
      `expected node type focus to highlight repair_task, got ${nodeTypeFocusNodeIds}`,
    );
  }
  if (canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasEdges !== 0) {
    failures.push(
      `expected node type focus to leave edges unhighlighted, got ${canvasNodeTypeFocusMetrics.typeFocusedWorkflowCanvasEdges}`,
    );
  }
  if (nodeTypeFocusEdgeIds !== "") {
    failures.push(
      `expected no edge ids during node type focus, got ${nodeTypeFocusEdgeIds}`,
    );
  }
  if (
    canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusDetailsKind !== "node"
  ) {
    failures.push(
      `expected node type focus details kind node, got ${canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusDetailsKind}`,
    );
  }
  if (
    canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusDetailsValue !==
    "repair_task"
  ) {
    failures.push(
      `expected node type focus details value repair_task, got ${canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusDetailsValue}`,
    );
  }
  if (canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusMatchCount !== "1") {
    failures.push(
      `expected one node type focus match, got ${canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusMatchCount}`,
    );
  }
  if (nodeTypeFocusMatches !== "repair_task") {
    failures.push(
      `expected repair_task node type focus match, got ${nodeTypeFocusMatches}`,
    );
  }
  if (nodeTypeFocusMatchEdges !== "") {
    failures.push(
      `expected no edge matches during node type focus, got ${nodeTypeFocusMatchEdges}`,
    );
  }
  if (
    canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusNodeSelectButtons !== 1
  ) {
    failures.push(
      `expected one node type focus match button, got ${canvasNodeTypeFocusMetrics.workflowCanvasTypeFocusNodeSelectButtons}`,
    );
  }
  if (
    canvasNodeTypeFocusPreMatchMetrics.selectedWorkflowCanvasNodeId !==
    "context_task"
  ) {
    failures.push(
      `expected node type focus pre-match selection context_task, got ${canvasNodeTypeFocusPreMatchMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (nodeTypeFocusPreMatchNodes !== "repair_task") {
    failures.push(
      `expected node type focus pre-match details to keep repair_task match, got ${nodeTypeFocusPreMatchNodes}`,
    );
  }
  if (
    canvasNodeTypeFocusMatchMetrics.selectedWorkflowCanvasNodeId !==
    "repair_task"
  ) {
    failures.push(
      `expected node type focus match click to select repair_task, got ${canvasNodeTypeFocusMatchMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (
    canvasNodeTypeFocusMatchMetrics.focusedWorkflowCanvasNodeId !==
    "repair_task"
  ) {
    failures.push(
      `expected node type focus match click to focus repair_task, got ${canvasNodeTypeFocusMatchMetrics.focusedWorkflowCanvasNodeId}`,
    );
  }
  if (nodeTypeFocusMatchClickNodes !== "repair_task") {
    failures.push(
      `expected node type focus match click metrics to keep repair_task match, got ${nodeTypeFocusMatchClickNodes}`,
    );
  }
  if (canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusKind !== "edge") {
    failures.push(
      `expected edge type focus kind edge, got ${canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusKind}`,
    );
  }
  if (canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusValue !== "normal") {
    failures.push(
      `expected edge type focus value normal, got ${canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusValue}`,
    );
  }
  if (canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusActiveButtons !== 1) {
    failures.push(
      `expected one active edge type focus button, got ${canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusActiveButtons}`,
    );
  }
  if (canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasNodes !== 0) {
    failures.push(
      `expected edge type focus to leave nodes unhighlighted, got ${canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasNodes}`,
    );
  }
  if (edgeTypeFocusNodeIds !== "") {
    failures.push(
      `expected no node ids during edge type focus, got ${edgeTypeFocusNodeIds}`,
    );
  }
  if (canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasEdges !== 2) {
    failures.push(
      `expected two edges highlighted by normal type focus, got ${canvasEdgeTypeFocusMetrics.typeFocusedWorkflowCanvasEdges}`,
    );
  }
  if (edgeTypeFocusEdgeIds !== "context_to_review,start_to_context") {
    failures.push(
      `expected normal edge type focus to highlight context_to_review,start_to_context, got ${edgeTypeFocusEdgeIds}`,
    );
  }
  if (
    canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusDetailsKind !== "edge"
  ) {
    failures.push(
      `expected edge type focus details kind edge, got ${canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusDetailsKind}`,
    );
  }
  if (
    canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusDetailsValue !== "normal"
  ) {
    failures.push(
      `expected edge type focus details value normal, got ${canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusDetailsValue}`,
    );
  }
  if (canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusMatchCount !== "2") {
    failures.push(
      `expected two edge type focus matches, got ${canvasEdgeTypeFocusMetrics.workflowCanvasTypeFocusMatchCount}`,
    );
  }
  if (edgeTypeFocusNodeMatches !== "") {
    failures.push(
      `expected no node matches during edge type focus, got ${edgeTypeFocusNodeMatches}`,
    );
  }
  if (edgeTypeFocusMatches !== "context_to_review,start_to_context") {
    failures.push(
      `expected normal edge type focus matches context_to_review,start_to_context, got ${edgeTypeFocusMatches}`,
    );
  }
  if (canvasTypeFocusClearMetrics.workflowCanvasTypeFocusKind !== null) {
    failures.push(
      `expected clear type focus kind null, got ${canvasTypeFocusClearMetrics.workflowCanvasTypeFocusKind}`,
    );
  }
  if (canvasTypeFocusClearMetrics.workflowCanvasTypeFocusValue !== null) {
    failures.push(
      `expected clear type focus value null, got ${canvasTypeFocusClearMetrics.workflowCanvasTypeFocusValue}`,
    );
  }
  if (canvasTypeFocusClearMetrics.workflowCanvasTypeFocusActiveButtons !== 0) {
    failures.push(
      `expected no active type focus after clear, got ${canvasTypeFocusClearMetrics.workflowCanvasTypeFocusActiveButtons}`,
    );
  }
  if (canvasTypeFocusClearMetrics.typeFocusedWorkflowCanvasNodes !== 0) {
    failures.push(
      `expected no node type focus after clear, got ${canvasTypeFocusClearMetrics.typeFocusedWorkflowCanvasNodes}`,
    );
  }
  if (canvasTypeFocusClearMetrics.typeFocusedWorkflowCanvasEdges !== 0) {
    failures.push(
      `expected no edge type focus after clear, got ${canvasTypeFocusClearMetrics.typeFocusedWorkflowCanvasEdges}`,
    );
  }
  if (canvasTypeFocusClearMetrics.workflowCanvasTypeFocusDetailsKind !== null) {
    failures.push(
      `expected no type focus details after clear, got ${canvasTypeFocusClearMetrics.workflowCanvasTypeFocusDetailsKind}`,
    );
  }
  if (canvasTypeFocusClearMetrics.workflowCanvasTypeFocusMatchCount !== null) {
    failures.push(
      `expected no type focus match count after clear, got ${canvasTypeFocusClearMetrics.workflowCanvasTypeFocusMatchCount}`,
    );
  }
  if (canvasMetrics.selectedWorkflowCanvasNodes !== 1) {
    failures.push(
      `expected one selected focused canvas node, got ${canvasMetrics.selectedWorkflowCanvasNodes}`,
    );
  }
  if (canvasMetrics.selectedWorkflowCanvasNodeId !== "repair_task") {
    failures.push(
      `expected selected repair_task canvas node, got ${canvasMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasMetrics.workflowCanvasInspectorNodeId !== "repair_task") {
    failures.push(
      `expected repair_task canvas inspector, got ${canvasMetrics.workflowCanvasInspectorNodeId}`,
    );
  }
  if (canvasMetrics.workflowCanvasInspectorTitle !== "Repair loop") {
    failures.push(
      `expected Repair loop canvas inspector title, got ${canvasMetrics.workflowCanvasInspectorTitle}`,
    );
  }
  if (canvasMetrics.selectedWorkflowCanvasEdges !== 2) {
    failures.push(
      `expected 2 selected repair_task canvas edges, got ${canvasMetrics.selectedWorkflowCanvasEdges}`,
    );
  }
  if (selectedWorkflowCanvasEdgeIds !== "repair_to_context,review_to_repair") {
    failures.push(
      `expected selected repair_task canvas edges repair_to_context,review_to_repair, got ${selectedWorkflowCanvasEdgeIds}`,
    );
  }
  if (canvasMetrics.incomingWorkflowCanvasEdges !== 1) {
    failures.push(
      `expected 1 incoming repair_task canvas edge, got ${canvasMetrics.incomingWorkflowCanvasEdges}`,
    );
  }
  if (incomingWorkflowCanvasEdgeIds !== "review_to_repair") {
    failures.push(
      `expected incoming repair_task canvas edge review_to_repair, got ${incomingWorkflowCanvasEdgeIds}`,
    );
  }
  if (canvasMetrics.outgoingWorkflowCanvasEdges !== 1) {
    failures.push(
      `expected 1 outgoing repair_task canvas edge, got ${canvasMetrics.outgoingWorkflowCanvasEdges}`,
    );
  }
  if (outgoingWorkflowCanvasEdgeIds !== "repair_to_context") {
    failures.push(
      `expected outgoing repair_task canvas edge repair_to_context, got ${outgoingWorkflowCanvasEdgeIds}`,
    );
  }
  if (canvasMetrics.workflowCanvasInspectorEdges !== 2) {
    failures.push(
      `expected 2 repair_task inspector edge rows, got ${canvasMetrics.workflowCanvasInspectorEdges}`,
    );
  }
  if (workflowCanvasInspectorEdgeIds !== "repair_to_context,review_to_repair") {
    failures.push(
      `expected repair_task inspector edge rows repair_to_context,review_to_repair, got ${workflowCanvasInspectorEdgeIds}`,
    );
  }
  if (canvasMetrics.workflowCanvasInspectorRouteButtons !== 2) {
    failures.push(
      `expected 2 repair_task inspector route buttons, got ${canvasMetrics.workflowCanvasInspectorRouteButtons}`,
    );
  }
  if (
    workflowCanvasInspectorRouteSelectNodeIds !== "context_task,review_task"
  ) {
    failures.push(
      `expected repair_task inspector route targets context_task,review_task, got ${workflowCanvasInspectorRouteSelectNodeIds}`,
    );
  }
  if (canvasMetrics.workflowCanvasInspectorHistoryDepth !== "1") {
    failures.push(
      `expected repair_task canvas history depth 1, got ${canvasMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (canvasMetrics.workflowCanvasInspectorBackButtons !== 1) {
    failures.push(
      `expected one repair_task canvas back button, got ${canvasMetrics.workflowCanvasInspectorBackButtons}`,
    );
  }
  if (canvasMetrics.workflowCanvasInspectorBackTarget !== "context_task") {
    failures.push(
      `expected repair_task canvas back target context_task, got ${canvasMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (canvasRouteMetrics.selectedWorkflowCanvasNodeId !== "review_task") {
    failures.push(
      `expected route navigation to select review_task, got ${canvasRouteMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasRouteMetrics.workflowCanvasInspectorNodeId !== "review_task") {
    failures.push(
      `expected route navigation inspector review_task, got ${canvasRouteMetrics.workflowCanvasInspectorNodeId}`,
    );
  }
  if (canvasRouteMetrics.workflowCanvasInspectorTitle !== "Review result") {
    failures.push(
      `expected route navigation inspector title Review result, got ${canvasRouteMetrics.workflowCanvasInspectorTitle}`,
    );
  }
  if (canvasRouteMetrics.selectedWorkflowCanvasEdges !== 3) {
    failures.push(
      `expected 3 selected review_task canvas edges, got ${canvasRouteMetrics.selectedWorkflowCanvasEdges}`,
    );
  }
  if (
    routeWorkflowCanvasEdgeIds !==
    "context_to_review,review_to_end,review_to_repair"
  ) {
    failures.push(
      `expected selected review_task canvas edges context_to_review,review_to_end,review_to_repair, got ${routeWorkflowCanvasEdgeIds}`,
    );
  }
  if (canvasRouteMetrics.incomingWorkflowCanvasEdges !== 1) {
    failures.push(
      `expected 1 incoming review_task canvas edge, got ${canvasRouteMetrics.incomingWorkflowCanvasEdges}`,
    );
  }
  if (routeIncomingWorkflowCanvasEdgeIds !== "context_to_review") {
    failures.push(
      `expected incoming review_task canvas edge context_to_review, got ${routeIncomingWorkflowCanvasEdgeIds}`,
    );
  }
  if (canvasRouteMetrics.outgoingWorkflowCanvasEdges !== 2) {
    failures.push(
      `expected 2 outgoing review_task canvas edges, got ${canvasRouteMetrics.outgoingWorkflowCanvasEdges}`,
    );
  }
  if (routeOutgoingWorkflowCanvasEdgeIds !== "review_to_end,review_to_repair") {
    failures.push(
      `expected outgoing review_task canvas edges review_to_end,review_to_repair, got ${routeOutgoingWorkflowCanvasEdgeIds}`,
    );
  }
  if (canvasRouteMetrics.workflowCanvasInspectorEdges !== 3) {
    failures.push(
      `expected 3 review_task inspector edge rows, got ${canvasRouteMetrics.workflowCanvasInspectorEdges}`,
    );
  }
  if (
    routeWorkflowCanvasInspectorEdgeIds !==
    "context_to_review,review_to_end,review_to_repair"
  ) {
    failures.push(
      `expected review_task inspector edge rows context_to_review,review_to_end,review_to_repair, got ${routeWorkflowCanvasInspectorEdgeIds}`,
    );
  }
  if (canvasRouteMetrics.workflowCanvasInspectorRouteButtons !== 3) {
    failures.push(
      `expected 3 review_task inspector route buttons, got ${canvasRouteMetrics.workflowCanvasInspectorRouteButtons}`,
    );
  }
  if (
    routeWorkflowCanvasInspectorRouteSelectNodeIds !==
    "context_task,end,repair_task"
  ) {
    failures.push(
      `expected review_task inspector route targets context_task,end,repair_task, got ${routeWorkflowCanvasInspectorRouteSelectNodeIds}`,
    );
  }
  if (canvasRouteMetrics.workflowCanvasInspectorHistoryDepth !== "4") {
    failures.push(
      `expected review_task canvas history depth 4, got ${canvasRouteMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (canvasRouteMetrics.workflowCanvasInspectorBackButtons !== 1) {
    failures.push(
      `expected one review_task canvas back button, got ${canvasRouteMetrics.workflowCanvasInspectorBackButtons}`,
    );
  }
  if (canvasRouteMetrics.workflowCanvasInspectorBackTarget !== "repair_task") {
    failures.push(
      `expected review_task canvas back target repair_task, got ${canvasRouteMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (canvasBackMetrics.selectedWorkflowCanvasNodeId !== "repair_task") {
    failures.push(
      `expected back navigation to select repair_task, got ${canvasBackMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasBackMetrics.workflowCanvasInspectorNodeId !== "repair_task") {
    failures.push(
      `expected back navigation inspector repair_task, got ${canvasBackMetrics.workflowCanvasInspectorNodeId}`,
    );
  }
  if (canvasBackMetrics.workflowCanvasInspectorHistoryDepth !== "3") {
    failures.push(
      `expected back navigation history depth 3, got ${canvasBackMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (canvasBackMetrics.workflowCanvasInspectorBackTarget !== "context_task") {
    failures.push(
      `expected back navigation target context_task, got ${canvasBackMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (canvasKeyboardNextMetrics.selectedWorkflowCanvasNodeId !== "end") {
    failures.push(
      `expected keyboard ArrowRight to select end, got ${canvasKeyboardNextMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardNextMetrics.workflowCanvasInspectorNodeId !== "end") {
    failures.push(
      `expected keyboard ArrowRight inspector end, got ${canvasKeyboardNextMetrics.workflowCanvasInspectorNodeId}`,
    );
  }
  if (canvasKeyboardNextMetrics.focusedWorkflowCanvasNodeId !== "end") {
    failures.push(
      `expected keyboard ArrowRight focus end, got ${canvasKeyboardNextMetrics.focusedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardNextMetrics.workflowCanvasInspectorHistoryDepth !== "4") {
    failures.push(
      `expected keyboard ArrowRight history depth 4, got ${canvasKeyboardNextMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (
    canvasKeyboardNextMetrics.workflowCanvasInspectorBackTarget !==
    "repair_task"
  ) {
    failures.push(
      `expected keyboard ArrowRight back target repair_task, got ${canvasKeyboardNextMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (canvasKeyboardNoopMetrics.selectedWorkflowCanvasNodeId !== "end") {
    failures.push(
      `expected keyboard same-target ArrowRight to keep end, got ${canvasKeyboardNoopMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardNoopMetrics.focusedWorkflowCanvasNodeId !== "end") {
    failures.push(
      `expected keyboard same-target ArrowRight focus end, got ${canvasKeyboardNoopMetrics.focusedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardNoopMetrics.workflowCanvasInspectorHistoryDepth !== "4") {
    failures.push(
      `expected keyboard same-target ArrowRight history depth 4, got ${canvasKeyboardNoopMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (
    canvasKeyboardNoopMetrics.workflowCanvasInspectorBackTarget !==
    "repair_task"
  ) {
    failures.push(
      `expected keyboard same-target ArrowRight back target repair_task, got ${canvasKeyboardNoopMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (
    canvasKeyboardPreviousMetrics.selectedWorkflowCanvasNodeId !== "repair_task"
  ) {
    failures.push(
      `expected keyboard ArrowLeft to select repair_task, got ${canvasKeyboardPreviousMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (
    canvasKeyboardPreviousMetrics.focusedWorkflowCanvasNodeId !== "repair_task"
  ) {
    failures.push(
      `expected keyboard ArrowLeft focus repair_task, got ${canvasKeyboardPreviousMetrics.focusedWorkflowCanvasNodeId}`,
    );
  }
  if (
    canvasKeyboardPreviousMetrics.workflowCanvasInspectorHistoryDepth !== "5"
  ) {
    failures.push(
      `expected keyboard ArrowLeft history depth 5, got ${canvasKeyboardPreviousMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (
    canvasKeyboardPreviousMetrics.workflowCanvasInspectorBackTarget !== "end"
  ) {
    failures.push(
      `expected keyboard ArrowLeft back target end, got ${canvasKeyboardPreviousMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (canvasKeyboardUpMetrics.selectedWorkflowCanvasNodeId !== "review_task") {
    failures.push(
      `expected keyboard ArrowUp to select review_task, got ${canvasKeyboardUpMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardUpMetrics.focusedWorkflowCanvasNodeId !== "review_task") {
    failures.push(
      `expected keyboard ArrowUp focus review_task, got ${canvasKeyboardUpMetrics.focusedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardUpMetrics.workflowCanvasInspectorHistoryDepth !== "6") {
    failures.push(
      `expected keyboard ArrowUp history depth 6, got ${canvasKeyboardUpMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (
    canvasKeyboardUpMetrics.workflowCanvasInspectorBackTarget !== "repair_task"
  ) {
    failures.push(
      `expected keyboard ArrowUp back target repair_task, got ${canvasKeyboardUpMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (
    canvasKeyboardDownMetrics.selectedWorkflowCanvasNodeId !== "repair_task"
  ) {
    failures.push(
      `expected keyboard ArrowDown to select repair_task, got ${canvasKeyboardDownMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardDownMetrics.focusedWorkflowCanvasNodeId !== "repair_task") {
    failures.push(
      `expected keyboard ArrowDown focus repair_task, got ${canvasKeyboardDownMetrics.focusedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasKeyboardDownMetrics.workflowCanvasInspectorHistoryDepth !== "7") {
    failures.push(
      `expected keyboard ArrowDown history depth 7, got ${canvasKeyboardDownMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (
    canvasKeyboardDownMetrics.workflowCanvasInspectorBackTarget !==
    "review_task"
  ) {
    failures.push(
      `expected keyboard ArrowDown back target review_task, got ${canvasKeyboardDownMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (canvasKeyboardDownMetrics.workflowCanvasHistoryTrailItems !== 7) {
    failures.push(
      `expected keyboard ArrowDown history trail count 7, got ${canvasKeyboardDownMetrics.workflowCanvasHistoryTrailItems}`,
    );
  }
  const canvasKeyboardDownHistoryTrail = Array.isArray(
    canvasKeyboardDownMetrics.workflowCanvasHistoryTrailNodeIds,
  )
    ? canvasKeyboardDownMetrics.workflowCanvasHistoryTrailNodeIds.join(",")
    : "";
  if (
    canvasKeyboardDownHistoryTrail !==
    "0:context_task,1:repair_task,2:context_task,3:repair_task,4:end,5:repair_task,6:review_task"
  ) {
    failures.push(
      `expected keyboard ArrowDown history trail context_task,repair_task,context_task,repair_task,end,repair_task,review_task, got ${canvasKeyboardDownHistoryTrail}`,
    );
  }
  if (canvasHistorySelectMetrics.selectedWorkflowCanvasNodeId !== "end") {
    failures.push(
      `expected history trail checkpoint to select end, got ${canvasHistorySelectMetrics.selectedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasHistorySelectMetrics.workflowCanvasInspectorNodeId !== "end") {
    failures.push(
      `expected history trail checkpoint inspector end, got ${canvasHistorySelectMetrics.workflowCanvasInspectorNodeId}`,
    );
  }
  if (canvasHistorySelectMetrics.focusedWorkflowCanvasNodeId !== "end") {
    failures.push(
      `expected history trail checkpoint focus end, got ${canvasHistorySelectMetrics.focusedWorkflowCanvasNodeId}`,
    );
  }
  if (canvasHistorySelectMetrics.workflowCanvasInspectorHistoryDepth !== "4") {
    failures.push(
      `expected history trail checkpoint history depth 4, got ${canvasHistorySelectMetrics.workflowCanvasInspectorHistoryDepth}`,
    );
  }
  if (
    canvasHistorySelectMetrics.workflowCanvasInspectorBackTarget !==
    "repair_task"
  ) {
    failures.push(
      `expected history trail checkpoint back target repair_task, got ${canvasHistorySelectMetrics.workflowCanvasInspectorBackTarget}`,
    );
  }
  if (canvasHistorySelectMetrics.workflowCanvasHistoryTrailItems !== 4) {
    failures.push(
      `expected history trail checkpoint trail count 4, got ${canvasHistorySelectMetrics.workflowCanvasHistoryTrailItems}`,
    );
  }
  const canvasHistorySelectTrail = Array.isArray(
    canvasHistorySelectMetrics.workflowCanvasHistoryTrailNodeIds,
  )
    ? canvasHistorySelectMetrics.workflowCanvasHistoryTrailNodeIds.join(",")
    : "";
  if (
    canvasHistorySelectTrail !==
    "0:context_task,1:repair_task,2:context_task,3:repair_task"
  ) {
    failures.push(
      `expected history trail checkpoint trail context_task,repair_task,context_task,repair_task, got ${canvasHistorySelectTrail}`,
    );
  }
  if (metrics.activeFileTreeNodes !== 0) {
    failures.push(
      `expected no active file tree node in lifecycle smoke, got ${metrics.activeFileTreeNodes}`,
    );
  }
  if (metrics.hasRuntimeStreamFileNode !== true) {
    failures.push("missing runtime stream file tree node");
  }
  if (metrics.hasGitSnapshotItem !== true) {
    failures.push("missing git snapshot scaffold item");
  }
  if (metrics.hasRepairCanvasEdge !== true) {
    failures.push("missing repair workflow canvas edge");
  }
  if (metrics.hasTaskDrawerToggle !== true) {
    failures.push("missing task drawer toggle");
  }
  if (metrics.hasChatBoxToggle !== true) {
    failures.push("missing chat box toggle");
  }
  if (metrics.taskDrawerExpanded !== "true") {
    failures.push(
      `expected expanded task drawer, got ${metrics.taskDrawerExpanded}`,
    );
  }
  if (metrics.taskDrawerItems !== 5) {
    failures.push(
      `expected 5 task drawer items, got ${metrics.taskDrawerItems}`,
    );
  }
  if (initialTaskDrawerMetrics.taskDrawerSelectableItems !== 5) {
    failures.push(
      `expected 5 selectable task drawer items, got ${initialTaskDrawerMetrics.taskDrawerSelectableItems}`,
    );
  }
  if (initialTaskDrawerMetrics.selectedTaskDrawerItems !== 1) {
    failures.push(
      `expected one selected task drawer item initially, got ${initialTaskDrawerMetrics.selectedTaskDrawerItems}`,
    );
  }
  if (initialTaskDrawerMetrics.selectedTaskDrawerItemId !== "active_panel") {
    failures.push(
      `expected initial task drawer selection active_panel, got ${initialTaskDrawerMetrics.selectedTaskDrawerItemId}`,
    );
  }
  if (initialTaskDrawerMetrics.taskDrawerDetailsId !== "active_panel") {
    failures.push(
      `expected initial task drawer details active_panel, got ${initialTaskDrawerMetrics.taskDrawerDetailsId}`,
    );
  }
  if (initialTaskDrawerMetrics.taskDrawerDetailsValue !== "Lifecycle") {
    failures.push(
      `expected initial task drawer details value Lifecycle, got ${initialTaskDrawerMetrics.taskDrawerDetailsValue}`,
    );
  }
  if (initialTaskDrawerMetrics.taskDrawerDetailsTone !== "neutral") {
    failures.push(
      `expected initial task drawer details tone neutral, got ${initialTaskDrawerMetrics.taskDrawerDetailsTone}`,
    );
  }
  if (taskDrawerSelectMetrics.selectedTaskDrawerItems !== 1) {
    failures.push(
      `expected one selected task drawer item after click, got ${taskDrawerSelectMetrics.selectedTaskDrawerItems}`,
    );
  }
  if (taskDrawerSelectMetrics.selectedTaskDrawerItemId !== "unread_events") {
    failures.push(
      `expected unread_events task drawer selection after click, got ${taskDrawerSelectMetrics.selectedTaskDrawerItemId}`,
    );
  }
  if (taskDrawerSelectMetrics.taskDrawerDetailsId !== "unread_events") {
    failures.push(
      `expected unread_events task drawer details after click, got ${taskDrawerSelectMetrics.taskDrawerDetailsId}`,
    );
  }
  if (taskDrawerSelectMetrics.taskDrawerDetailsValue !== "0") {
    failures.push(
      `expected unread_events task drawer details value 0, got ${taskDrawerSelectMetrics.taskDrawerDetailsValue}`,
    );
  }
  if (taskDrawerSelectMetrics.taskDrawerDetailsTone !== "neutral") {
    failures.push(
      `expected unread_events task drawer details tone neutral, got ${taskDrawerSelectMetrics.taskDrawerDetailsTone}`,
    );
  }
  if (
    !taskDrawerSelectMetrics.taskDrawerDetailsText?.includes("Tone") ||
    !taskDrawerSelectMetrics.taskDrawerDetailsText?.includes("neutral")
  ) {
    failures.push(
      `expected unread_events task drawer visible details to include Tone neutral, got ${taskDrawerSelectMetrics.taskDrawerDetailsText}`,
    );
  }
  if (taskDrawerSpaceMetrics.selectedTaskDrawerItems !== 1) {
    failures.push(
      `expected one selected task drawer item after Space, got ${taskDrawerSpaceMetrics.selectedTaskDrawerItems}`,
    );
  }
  if (taskDrawerSpaceMetrics.selectedTaskDrawerItemId !== "visible_items") {
    failures.push(
      `expected visible_items task drawer selection after Space, got ${taskDrawerSpaceMetrics.selectedTaskDrawerItemId}`,
    );
  }
  if (taskDrawerSpaceMetrics.taskDrawerDetailsId !== "visible_items") {
    failures.push(
      `expected visible_items task drawer details after Space, got ${taskDrawerSpaceMetrics.taskDrawerDetailsId}`,
    );
  }
  if (taskDrawerSpaceMetrics.taskDrawerDetailsValue !== "5") {
    failures.push(
      `expected visible_items task drawer details value 5 after Space, got ${taskDrawerSpaceMetrics.taskDrawerDetailsValue}`,
    );
  }
  if (taskDrawerSpaceMetrics.taskDrawerDetailsTone !== "neutral") {
    failures.push(
      `expected visible_items task drawer details tone neutral after Space, got ${taskDrawerSpaceMetrics.taskDrawerDetailsTone}`,
    );
  }
  if (taskDrawerKeyboardMetrics.selectedTaskDrawerItems !== 1) {
    failures.push(
      `expected one selected task drawer item after keyboard, got ${taskDrawerKeyboardMetrics.selectedTaskDrawerItems}`,
    );
  }
  if (taskDrawerKeyboardMetrics.selectedTaskDrawerItemId !== "runtime_stream") {
    failures.push(
      `expected runtime_stream task drawer selection after keyboard, got ${taskDrawerKeyboardMetrics.selectedTaskDrawerItemId}`,
    );
  }
  if (taskDrawerKeyboardMetrics.taskDrawerDetailsId !== "runtime_stream") {
    failures.push(
      `expected runtime_stream task drawer details after keyboard, got ${taskDrawerKeyboardMetrics.taskDrawerDetailsId}`,
    );
  }
  if (taskDrawerKeyboardMetrics.taskDrawerDetailsValue !== "Idle") {
    failures.push(
      `expected runtime_stream task drawer details value Idle after keyboard, got ${taskDrawerKeyboardMetrics.taskDrawerDetailsValue}`,
    );
  }
  if (taskDrawerKeyboardMetrics.taskDrawerDetailsTone !== "neutral") {
    failures.push(
      `expected runtime_stream task drawer details tone neutral after keyboard, got ${taskDrawerKeyboardMetrics.taskDrawerDetailsTone}`,
    );
  }
  if (collapsedMetrics.taskDrawerExpanded !== "false") {
    failures.push(
      `expected collapsed task drawer during toggle check, got ${collapsedMetrics.taskDrawerExpanded}`,
    );
  }
  if (collapsedMetrics.taskDrawerItems !== 0) {
    failures.push(
      `expected collapsed task drawer to hide items, got ${collapsedMetrics.taskDrawerItems}`,
    );
  }
  if (
    typeof collapsedMetrics.taskDrawerCollapsedSummary !== "string" ||
    collapsedMetrics.taskDrawerCollapsedSummary.length === 0
  ) {
    failures.push("missing collapsed task drawer summary");
  }
  if (metrics.chatBoxExpanded !== "true") {
    failures.push(`expected expanded chat box, got ${metrics.chatBoxExpanded}`);
  }
  if (metrics.chatComposeControls !== 3) {
    failures.push(
      `expected 3 chat compose controls, got ${metrics.chatComposeControls}`,
    );
  }
  if (chatInitialMetrics.chatDraftIntentButtons !== 3) {
    failures.push(
      `expected 3 chat draft intent buttons, got ${chatInitialMetrics.chatDraftIntentButtons}`,
    );
  }
  if (chatInitialMetrics.activeChatDraftIntentButtons !== 1) {
    failures.push(
      `expected one active chat draft intent, got ${chatInitialMetrics.activeChatDraftIntentButtons}`,
    );
  }
  if (chatInitialMetrics.activeChatDraftIntent !== "ask") {
    failures.push(
      `expected initial active chat draft intent ask, got ${chatInitialMetrics.activeChatDraftIntent}`,
    );
  }
  if (chatInitialMetrics.chatDraftIntent !== "ask") {
    failures.push(
      `expected initial chat draft details intent ask, got ${chatInitialMetrics.chatDraftIntent}`,
    );
  }
  if (chatInitialMetrics.chatDraftIntentLabel !== "Ask") {
    failures.push(
      `expected initial chat draft details intent label Ask, got ${chatInitialMetrics.chatDraftIntentLabel}`,
    );
  }
  if (chatInitialMetrics.chatDraftPreviewState !== "empty") {
    failures.push(
      `expected initial chat draft preview state empty, got ${chatInitialMetrics.chatDraftPreviewState}`,
    );
  }
  if (chatInitialMetrics.chatDraftPreviewReason !== "empty_draft") {
    failures.push(
      `expected initial chat draft preview reason empty_draft, got ${chatInitialMetrics.chatDraftPreviewReason}`,
    );
  }
  if (chatInitialMetrics.chatDraftPreviewReady !== "false") {
    failures.push(
      `expected initial chat draft preview ready false, got ${chatInitialMetrics.chatDraftPreviewReady}`,
    );
  }
  if (chatInitialMetrics.chatDraftPreviewIntent !== "ask") {
    failures.push(
      `expected initial chat draft preview intent ask, got ${chatInitialMetrics.chatDraftPreviewIntent}`,
    );
  }
  if (chatInitialMetrics.chatDraftPreviewBody !== "empty") {
    failures.push(
      `expected initial chat draft preview body empty, got ${chatInitialMetrics.chatDraftPreviewBody}`,
    );
  }
  if (chatInitialMetrics.chatDraftPreviewTarget !== "workflow") {
    failures.push(
      `expected initial chat draft preview target workflow, got ${chatInitialMetrics.chatDraftPreviewTarget}`,
    );
  }
  if (chatInitialMetrics.chatDraftPreviewAction !== "question") {
    failures.push(
      `expected initial chat draft preview action question, got ${chatInitialMetrics.chatDraftPreviewAction}`,
    );
  }
  if (
    !chatInitialMetrics.chatDraftPreviewText?.includes("Preview") ||
    !chatInitialMetrics.chatDraftPreviewText?.includes("Empty") ||
    !chatInitialMetrics.chatDraftPreviewText?.includes("No draft text") ||
    !chatInitialMetrics.chatDraftPreviewText?.includes("Ask") ||
    !chatInitialMetrics.chatDraftPreviewText?.includes("Current workflow") ||
    !chatInitialMetrics.chatDraftPreviewText?.includes("Question") ||
    !chatInitialMetrics.chatDraftPreviewText?.includes("Draft is empty")
  ) {
    failures.push(
      `expected initial chat draft preview text to include empty Ask context preview, got ${chatInitialMetrics.chatDraftPreviewText}`,
    );
  }
  if (metrics.chatDraftInputs !== 1) {
    failures.push(
      `expected one chat draft input, got ${metrics.chatDraftInputs}`,
    );
  }
  if (chatInitialMetrics.chatDraftLength !== "0") {
    failures.push(
      `expected initial chat draft length 0, got ${chatInitialMetrics.chatDraftLength}`,
    );
  }
  if (chatInitialMetrics.chatDraftWords !== "0") {
    failures.push(
      `expected initial chat draft words 0, got ${chatInitialMetrics.chatDraftWords}`,
    );
  }
  if (chatInitialMetrics.chatDraftStatus !== "Idle") {
    failures.push(
      `expected initial chat draft status Idle, got ${chatInitialMetrics.chatDraftStatus}`,
    );
  }
  if (chatInitialMetrics.chatDraftSendEnabled !== "false") {
    failures.push(
      `expected initial chat draft send-enabled false, got ${chatInitialMetrics.chatDraftSendEnabled}`,
    );
  }
  if (chatInitialMetrics.chatDraftSendReason !== "empty_draft") {
    failures.push(
      `expected initial chat draft send reason empty_draft, got ${chatInitialMetrics.chatDraftSendReason}`,
    );
  }
  if (metrics.chatSendDisabled !== true) {
    failures.push(
      `expected chat Send button disabled, got ${metrics.chatSendDisabled}`,
    );
  }
  if (chatInitialMetrics.chatSendReason !== "empty_draft") {
    failures.push(
      `expected initial chat send reason empty_draft, got ${chatInitialMetrics.chatSendReason}`,
    );
  }
  if (chatInitialMetrics.chatSendGuardEnabled !== "false") {
    failures.push(
      `expected initial chat send guard enabled false, got ${chatInitialMetrics.chatSendGuardEnabled}`,
    );
  }
  if (chatInitialMetrics.chatSendGuardReason !== "empty_draft") {
    failures.push(
      `expected initial chat send guard reason empty_draft, got ${chatInitialMetrics.chatSendGuardReason}`,
    );
  }
  if (
    chatInitialMetrics.chatSendGuardText !== "Send unavailable: Draft is empty"
  ) {
    failures.push(
      `expected initial chat send guard text for empty draft, got ${chatInitialMetrics.chatSendGuardText}`,
    );
  }
  if (chatCollapsedMetrics.chatBoxExpanded !== "false") {
    failures.push(
      `expected collapsed chat box during toggle check, got ${chatCollapsedMetrics.chatBoxExpanded}`,
    );
  }
  if (chatCollapsedMetrics.chatComposeControls !== 0) {
    failures.push(
      `expected collapsed chat box to hide compose controls, got ${chatCollapsedMetrics.chatComposeControls}`,
    );
  }
  if (
    typeof chatCollapsedMetrics.chatCollapsedSummary !== "string" ||
    chatCollapsedMetrics.chatCollapsedSummary.length === 0
  ) {
    failures.push("missing collapsed chat box summary");
  }
  if (chatDraftMetrics.chatDraftValue !== "Review repair plan now") {
    failures.push(
      `expected chat draft value Review repair plan now, got ${chatDraftMetrics.chatDraftValue}`,
    );
  }
  if (chatDraftMetrics.activeChatDraftIntent !== "repair") {
    failures.push(
      `expected active chat draft intent repair after click, got ${chatDraftMetrics.activeChatDraftIntent}`,
    );
  }
  if (chatDraftMetrics.chatDraftIntent !== "repair") {
    failures.push(
      `expected chat draft details intent repair, got ${chatDraftMetrics.chatDraftIntent}`,
    );
  }
  if (chatDraftMetrics.chatDraftIntentLabel !== "Repair") {
    failures.push(
      `expected chat draft details intent label Repair, got ${chatDraftMetrics.chatDraftIntentLabel}`,
    );
  }
  if (chatDraftMetrics.chatDraftPreviewIntent !== "repair") {
    failures.push(
      `expected chat draft preview intent repair, got ${chatDraftMetrics.chatDraftPreviewIntent}`,
    );
  }
  if (chatDraftMetrics.chatDraftPreviewIntentLabel !== "Repair") {
    failures.push(
      `expected chat draft preview intent label Repair, got ${chatDraftMetrics.chatDraftPreviewIntentLabel}`,
    );
  }
  if (chatDraftMetrics.chatDraftPreviewBody !== "draft") {
    failures.push(
      `expected chat draft preview body draft, got ${chatDraftMetrics.chatDraftPreviewBody}`,
    );
  }
  if (chatDraftMetrics.chatDraftPreviewTarget !== "repair") {
    failures.push(
      `expected chat draft preview target repair, got ${chatDraftMetrics.chatDraftPreviewTarget}`,
    );
  }
  if (chatDraftMetrics.chatDraftPreviewAction !== "repair_review") {
    failures.push(
      `expected chat draft preview action repair_review, got ${chatDraftMetrics.chatDraftPreviewAction}`,
    );
  }
  if (chatDraftMetrics.chatDraftLength !== "22") {
    failures.push(
      `expected chat draft length 22, got ${chatDraftMetrics.chatDraftLength}`,
    );
  }
  if (chatDraftMetrics.chatDraftWords !== "4") {
    failures.push(
      `expected chat draft words 4, got ${chatDraftMetrics.chatDraftWords}`,
    );
  }
  if (chatDraftMetrics.chatDraftStatus !== "Idle") {
    failures.push(
      `expected chat draft status Idle, got ${chatDraftMetrics.chatDraftStatus}`,
    );
  }
  if (
    !chatDraftMetrics.chatDraftDetailsText?.includes("Characters") ||
    !chatDraftMetrics.chatDraftDetailsText?.includes("22") ||
    !chatDraftMetrics.chatDraftDetailsText?.includes("Words") ||
    !chatDraftMetrics.chatDraftDetailsText?.includes("4") ||
    !chatDraftMetrics.chatDraftDetailsText?.includes("Intent") ||
    !chatDraftMetrics.chatDraftDetailsText?.includes("Repair")
  ) {
    failures.push(
      `expected chat draft visible details to include Characters 22, Words 4, and Intent Repair, got ${chatDraftMetrics.chatDraftDetailsText}`,
    );
  }
  if (requestedChatBoxMode === "enabled") {
    if (chatDraftMetrics.chatDraftPreviewState !== "ready") {
      failures.push(
        `expected enabled chat draft preview state ready, got ${chatDraftMetrics.chatDraftPreviewState}`,
      );
    }
    if (chatDraftMetrics.chatDraftPreviewReason !== "ready") {
      failures.push(
        `expected enabled chat draft preview reason ready, got ${chatDraftMetrics.chatDraftPreviewReason}`,
      );
    }
    if (chatDraftMetrics.chatDraftPreviewReady !== "true") {
      failures.push(
        `expected enabled chat draft preview ready true, got ${chatDraftMetrics.chatDraftPreviewReady}`,
      );
    }
    if (chatDraftMetrics.chatDraftSendEnabled !== "true") {
      failures.push(
        `expected enabled chat draft send-enabled true, got ${chatDraftMetrics.chatDraftSendEnabled}`,
      );
    }
    if (chatDraftMetrics.chatDraftSendReason !== "ready") {
      failures.push(
        `expected enabled chat draft send reason ready, got ${chatDraftMetrics.chatDraftSendReason}`,
      );
    }
    if (chatDraftMetrics.chatSendReason !== "ready") {
      failures.push(
        `expected enabled chat send reason ready after draft, got ${chatDraftMetrics.chatSendReason}`,
      );
    }
    if (chatDraftMetrics.chatSendGuardEnabled !== "true") {
      failures.push(
        `expected enabled chat send guard enabled true after draft, got ${chatDraftMetrics.chatSendGuardEnabled}`,
      );
    }
    if (chatDraftMetrics.chatSendGuardReason !== "ready") {
      failures.push(
        `expected enabled chat send guard reason ready after draft, got ${chatDraftMetrics.chatSendGuardReason}`,
      );
    }
    if (chatDraftMetrics.chatSendGuardText !== "Send ready") {
      failures.push(
        `expected enabled chat send guard text Send ready, got ${chatDraftMetrics.chatSendGuardText}`,
      );
    }
    if (
      !chatDraftMetrics.chatDraftPreviewText?.includes("Preview") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Ready") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Repair") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Repair plan") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Repair review") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Ready to send")
    ) {
      failures.push(
        `expected enabled chat draft preview text to include ready Repair context preview, got ${chatDraftMetrics.chatDraftPreviewText}`,
      );
    }
    const firstHistoryIds = Array.isArray(
      chatLocalSubmitMetrics?.chatLocalSubmissionHistoryItemIds,
    )
      ? chatLocalSubmitMetrics.chatLocalSubmissionHistoryItemIds.join(",")
      : "";
    if (chatLocalSubmitMetrics?.chatDraftValue !== "") {
      failures.push(
        `expected first local send to clear draft, got ${chatLocalSubmitMetrics?.chatDraftValue}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionPresent !== true) {
      failures.push("expected first local submission section to be present");
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionSequence !== "1") {
      failures.push(
        `expected first local submission sequence 1, got ${chatLocalSubmitMetrics?.chatLocalSubmissionSequence}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionCount !== "1") {
      failures.push(
        `expected first local submission count 1, got ${chatLocalSubmitMetrics?.chatLocalSubmissionCount}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionStatus !== "queued_local") {
      failures.push(
        `expected first local submission status queued_local, got ${chatLocalSubmitMetrics?.chatLocalSubmissionStatus}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionIntent !== "repair") {
      failures.push(
        `expected first local submission intent repair, got ${chatLocalSubmitMetrics?.chatLocalSubmissionIntent}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionTarget !== "repair") {
      failures.push(
        `expected first local submission target repair, got ${chatLocalSubmitMetrics?.chatLocalSubmissionTarget}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionAction !== "repair_review") {
      failures.push(
        `expected first local submission action repair_review, got ${chatLocalSubmitMetrics?.chatLocalSubmissionAction}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionCharacters !== "22") {
      failures.push(
        `expected first local submission characters 22, got ${chatLocalSubmitMetrics?.chatLocalSubmissionCharacters}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionWords !== "4") {
      failures.push(
        `expected first local submission words 4, got ${chatLocalSubmitMetrics?.chatLocalSubmissionWords}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionClearCount !== "1") {
      failures.push(
        `expected first local submission clear count 1, got ${chatLocalSubmitMetrics?.chatLocalSubmissionClearCount}`,
      );
    }
    if (chatLocalSubmitMetrics?.chatLocalSubmissionHistoryItems !== 1) {
      failures.push(
        `expected first local submission history item count 1, got ${chatLocalSubmitMetrics?.chatLocalSubmissionHistoryItems}`,
      );
    }
    if (firstHistoryIds !== "1") {
      failures.push(
        `expected first local submission history ids 1, got ${firstHistoryIds}`,
      );
    }
    const cappedHistoryIds = Array.isArray(
      chatLocalHistoryMetrics?.chatLocalSubmissionHistoryItemIds,
    )
      ? chatLocalHistoryMetrics.chatLocalSubmissionHistoryItemIds.join(",")
      : "";
    const cappedHistoryStatuses = Array.isArray(
      chatLocalHistoryMetrics?.chatLocalSubmissionHistoryStatuses,
    )
      ? chatLocalHistoryMetrics.chatLocalSubmissionHistoryStatuses.join(",")
      : "";
    if (chatLocalHistoryMetrics?.chatLocalSubmissionSequence !== "4") {
      failures.push(
        `expected capped local history latest sequence 4, got ${chatLocalHistoryMetrics?.chatLocalSubmissionSequence}`,
      );
    }
    if (chatLocalHistoryMetrics?.chatLocalSubmissionCount !== "3") {
      failures.push(
        `expected capped local history count 3, got ${chatLocalHistoryMetrics?.chatLocalSubmissionCount}`,
      );
    }
    if (chatLocalHistoryMetrics?.chatLocalSubmissionCharacters !== "24") {
      failures.push(
        `expected capped local history latest characters 24, got ${chatLocalHistoryMetrics?.chatLocalSubmissionCharacters}`,
      );
    }
    if (chatLocalHistoryMetrics?.chatLocalSubmissionWords !== "3") {
      failures.push(
        `expected capped local history latest words 3, got ${chatLocalHistoryMetrics?.chatLocalSubmissionWords}`,
      );
    }
    if (chatLocalHistoryMetrics?.chatLocalSubmissionClearCount !== "3") {
      failures.push(
        `expected capped local history clear count 3, got ${chatLocalHistoryMetrics?.chatLocalSubmissionClearCount}`,
      );
    }
    if (chatLocalHistoryMetrics?.chatLocalSubmissionHistoryItems !== 3) {
      failures.push(
        `expected capped local history item count 3, got ${chatLocalHistoryMetrics?.chatLocalSubmissionHistoryItems}`,
      );
    }
    if (cappedHistoryIds !== "4,3,2") {
      failures.push(
        `expected capped local history ids 4,3,2, got ${cappedHistoryIds}`,
      );
    }
    if (cappedHistoryStatuses !== "queued_local,queued_local,queued_local") {
      failures.push(
        `expected capped local history queued statuses, got ${cappedHistoryStatuses}`,
      );
    }
    if (
      !chatLocalHistoryMetrics?.chatLocalSubmissionText?.includes("#4") ||
      !chatLocalHistoryMetrics.chatLocalSubmissionText.includes("#3") ||
      !chatLocalHistoryMetrics.chatLocalSubmissionText.includes("#2") ||
      !chatLocalHistoryMetrics.chatLocalSubmissionText.includes("24 chars") ||
      !chatLocalHistoryMetrics.chatLocalSubmissionText.includes("3 words")
    ) {
      failures.push(
        `expected capped local history text to include metadata-only entries, got ${chatLocalHistoryMetrics?.chatLocalSubmissionText}`,
      );
    }
    if (chatLocalHistoryClearedMetrics?.chatLocalSubmissionPresent !== false) {
      failures.push("expected cleared local history section to be absent");
    }
    if (chatLocalHistoryClearedMetrics?.chatLocalSubmissionClearButtons !== 0) {
      failures.push(
        `expected no clear history buttons after local clear, got ${chatLocalHistoryClearedMetrics?.chatLocalSubmissionClearButtons}`,
      );
    }
    if (chatLocalHistoryClearedMetrics?.chatLocalSubmissionHistoryItems !== 0) {
      failures.push(
        `expected no history items after local clear, got ${chatLocalHistoryClearedMetrics?.chatLocalSubmissionHistoryItems}`,
      );
    }
    if (chatLocalHistoryClearedMetrics?.chatDraftIntent !== "repair") {
      failures.push(
        `expected local history clear to keep repair intent, got ${chatLocalHistoryClearedMetrics?.chatDraftIntent}`,
      );
    }
    if (chatLocalHistoryClearedMetrics?.chatDraftSendReason !== "empty_draft") {
      failures.push(
        `expected local history clear to leave empty draft reason, got ${chatLocalHistoryClearedMetrics?.chatDraftSendReason}`,
      );
    }
    if (chatLocalHistoryClearedMetrics?.chatDraftPreviewState !== "empty") {
      failures.push(
        `expected local history clear to leave empty preview, got ${chatLocalHistoryClearedMetrics?.chatDraftPreviewState}`,
      );
    }
    const resendHistoryIds = Array.isArray(
      chatLocalResendMetrics?.chatLocalSubmissionHistoryItemIds,
    )
      ? chatLocalResendMetrics.chatLocalSubmissionHistoryItemIds.join(",")
      : "";
    if (chatLocalResendMetrics?.chatLocalSubmissionSequence !== "5") {
      failures.push(
        `expected resend after local clear sequence 5, got ${chatLocalResendMetrics?.chatLocalSubmissionSequence}`,
      );
    }
    if (chatLocalResendMetrics?.chatLocalSubmissionCount !== "1") {
      failures.push(
        `expected resend after local clear count 1, got ${chatLocalResendMetrics?.chatLocalSubmissionCount}`,
      );
    }
    if (chatLocalResendMetrics?.chatLocalSubmissionCharacters !== "20") {
      failures.push(
        `expected resend after local clear characters 20, got ${chatLocalResendMetrics?.chatLocalSubmissionCharacters}`,
      );
    }
    if (chatLocalResendMetrics?.chatLocalSubmissionWords !== "3") {
      failures.push(
        `expected resend after local clear words 3, got ${chatLocalResendMetrics?.chatLocalSubmissionWords}`,
      );
    }
    if (resendHistoryIds !== "5") {
      failures.push(
        `expected resend after local clear history ids 5, got ${resendHistoryIds}`,
      );
    }
  } else {
    if (chatDraftMetrics.chatDraftPreviewState !== "blocked") {
      failures.push(
        `expected chat draft preview state blocked, got ${chatDraftMetrics.chatDraftPreviewState}`,
      );
    }
    if (chatDraftMetrics.chatDraftPreviewReason !== "chat_disabled") {
      failures.push(
        `expected chat draft preview reason chat_disabled, got ${chatDraftMetrics.chatDraftPreviewReason}`,
      );
    }
    if (chatDraftMetrics.chatDraftPreviewReady !== "false") {
      failures.push(
        `expected chat draft preview ready false, got ${chatDraftMetrics.chatDraftPreviewReady}`,
      );
    }
    if (chatDraftMetrics.chatDraftSendEnabled !== "false") {
      failures.push(
        `expected chat draft send-enabled false, got ${chatDraftMetrics.chatDraftSendEnabled}`,
      );
    }
    if (chatDraftMetrics.chatDraftSendReason !== "chat_disabled") {
      failures.push(
        `expected chat draft send reason chat_disabled, got ${chatDraftMetrics.chatDraftSendReason}`,
      );
    }
    if (chatDraftMetrics.chatSendReason !== "chat_disabled") {
      failures.push(
        `expected chat send reason chat_disabled after draft, got ${chatDraftMetrics.chatSendReason}`,
      );
    }
    if (chatDraftMetrics.chatSendGuardEnabled !== "false") {
      failures.push(
        `expected chat send guard enabled false after draft, got ${chatDraftMetrics.chatSendGuardEnabled}`,
      );
    }
    if (chatDraftMetrics.chatSendGuardReason !== "chat_disabled") {
      failures.push(
        `expected chat send guard reason chat_disabled after draft, got ${chatDraftMetrics.chatSendGuardReason}`,
      );
    }
    if (
      chatDraftMetrics.chatSendGuardText !== "Send unavailable: Chat disabled"
    ) {
      failures.push(
        `expected chat send guard text for disabled chat, got ${chatDraftMetrics.chatSendGuardText}`,
      );
    }
    if (
      !chatDraftMetrics.chatDraftPreviewText?.includes("Preview") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Blocked") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes(
        "Review repair plan now",
      ) ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Repair") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Repair plan") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Repair review") ||
      !chatDraftMetrics.chatDraftPreviewText?.includes("Chat disabled")
    ) {
      failures.push(
        `expected chat draft preview text to include blocked Repair context preview, got ${chatDraftMetrics.chatDraftPreviewText}`,
      );
    }
    if (chatClearedMetrics?.chatDraftValue !== "") {
      failures.push(
        `expected cleared chat draft value to be empty, got ${chatClearedMetrics?.chatDraftValue}`,
      );
    }
    if (chatClearedMetrics?.chatDraftLength !== "0") {
      failures.push(
        `expected cleared chat draft length 0, got ${chatClearedMetrics?.chatDraftLength}`,
      );
    }
    if (chatClearedMetrics?.chatDraftWords !== "0") {
      failures.push(
        `expected cleared chat draft words 0, got ${chatClearedMetrics?.chatDraftWords}`,
      );
    }
    if (chatClearedMetrics?.chatDraftIntent !== "repair") {
      failures.push(
        `expected cleared chat draft intent to remain repair, got ${chatClearedMetrics?.chatDraftIntent}`,
      );
    }
    if (chatClearedMetrics?.chatDraftSendReason !== "empty_draft") {
      failures.push(
        `expected cleared chat draft send reason empty_draft, got ${chatClearedMetrics?.chatDraftSendReason}`,
      );
    }
    if (chatClearedMetrics?.chatSendReason !== "empty_draft") {
      failures.push(
        `expected cleared chat send reason empty_draft, got ${chatClearedMetrics?.chatSendReason}`,
      );
    }
    if (chatClearedMetrics?.chatSendGuardEnabled !== "false") {
      failures.push(
        `expected cleared chat send guard enabled false, got ${chatClearedMetrics?.chatSendGuardEnabled}`,
      );
    }
    if (chatClearedMetrics?.chatSendGuardReason !== "empty_draft") {
      failures.push(
        `expected cleared chat send guard reason empty_draft, got ${chatClearedMetrics?.chatSendGuardReason}`,
      );
    }
    if (
      chatClearedMetrics?.chatSendGuardText !==
      "Send unavailable: Draft is empty"
    ) {
      failures.push(
        `expected cleared chat send guard text for empty draft, got ${chatClearedMetrics?.chatSendGuardText}`,
      );
    }
    if (chatClearedMetrics?.chatDraftPreviewState !== "empty") {
      failures.push(
        `expected cleared chat draft preview state empty, got ${chatClearedMetrics?.chatDraftPreviewState}`,
      );
    }
    if (chatClearedMetrics?.chatDraftPreviewReason !== "empty_draft") {
      failures.push(
        `expected cleared chat draft preview reason empty_draft, got ${chatClearedMetrics?.chatDraftPreviewReason}`,
      );
    }
    if (chatClearedMetrics?.chatDraftPreviewIntent !== "repair") {
      failures.push(
        `expected cleared chat draft preview intent repair, got ${chatClearedMetrics?.chatDraftPreviewIntent}`,
      );
    }
    if (chatClearedMetrics?.chatDraftPreviewBody !== "empty") {
      failures.push(
        `expected cleared chat draft preview body empty, got ${chatClearedMetrics?.chatDraftPreviewBody}`,
      );
    }
    if (chatClearedMetrics?.chatDraftPreviewTarget !== "repair") {
      failures.push(
        `expected cleared chat draft preview target repair, got ${chatClearedMetrics?.chatDraftPreviewTarget}`,
      );
    }
    if (chatClearedMetrics?.chatDraftPreviewAction !== "repair_review") {
      failures.push(
        `expected cleared chat draft preview action repair_review, got ${chatClearedMetrics?.chatDraftPreviewAction}`,
      );
    }
    if (
      !chatClearedMetrics?.chatDraftPreviewText?.includes("No draft text") ||
      !chatClearedMetrics.chatDraftPreviewText.includes("Repair") ||
      !chatClearedMetrics.chatDraftPreviewText.includes("Repair plan") ||
      !chatClearedMetrics.chatDraftPreviewText.includes("Repair review") ||
      !chatClearedMetrics.chatDraftPreviewText.includes("Draft is empty")
    ) {
      failures.push(
        `expected cleared chat draft preview text to include empty Repair context preview, got ${chatClearedMetrics?.chatDraftPreviewText}`,
      );
    }
  }
  if (metrics.timelineItems !== 5) {
    failures.push(`expected 5 timeline items, got ${metrics.timelineItems}`);
  }
  if (metrics.commandButtons !== 3) {
    failures.push(`expected 3 command buttons, got ${metrics.commandButtons}`);
  }
  if (metrics.selectedText !== expectedSelectedTitle) {
    failures.push(`unexpected selected detail: ${metrics.selectedText}`);
  }
  if (metrics.selectedTimelineText !== expectedSelectedTitle) {
    failures.push(
      `unexpected selected timeline item: ${metrics.selectedTimelineText}`,
    );
  }
  if (metrics.focusedCount !== 1) {
    failures.push(`expected 1 focused item, got ${metrics.focusedCount}`);
  }
  if (metrics.selectedCount !== 1) {
    failures.push(`expected 1 selected item, got ${metrics.selectedCount}`);
  }
  if (metrics.horizontalOverflow !== 0) {
    failures.push(
      `expected no horizontal overflow, got ${metrics.horizontalOverflow}`,
    );
  }
  if (metrics.frameworkOverlayText !== false) {
    failures.push("framework error overlay text was detected");
  }
  if (metrics.viewport.width <= 0 || metrics.viewport.height <= 0) {
    failures.push(
      `invalid viewport ${metrics.viewport.width}x${metrics.viewport.height}`,
    );
  }
  if (requestedWidth >= 1000 && metrics.viewport.width < 1000) {
    failures.push(
      `expected desktop viewport, got ${metrics.viewport.width}x${metrics.viewport.height}`,
    );
  }

  return failures;
}

async function main() {
  await app.whenReady();
  const messages = [];
  const window = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    useContentSize: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setContentSize(width, height);
  window.webContents.on("console-message", (details) => {
    if (details.level === "warning" || details.level === "error") {
      messages.push(details.message);
    }
  });
  await runSmokeStep("load renderer", () => window.loadURL(targetUrl));
  await runSmokeStep("show stream panel", () => clickPanel(window, "stream"));
  const initialStreamMetrics = await runSmokeStep(
    "read initial stream panel metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("expand stream event detail", () =>
    clickStreamEventExpandToggle(window, "evt_visual_stream"),
  );
  const streamEventExpandedMetrics = await runSmokeStep(
    "read expanded stream event detail metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("collapse stream event detail", () =>
    clickStreamEventExpandToggle(window, "evt_visual_stream"),
  );
  const streamEventCollapsedMetrics = await runSmokeStep(
    "read collapsed stream event detail metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("expand stream full reload details", () =>
    clickStreamFullReloadDetailsToggle(window),
  );
  const streamFullReloadExpandedMetrics = await runSmokeStep(
    "read expanded stream full reload details metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("collapse stream full reload details", () =>
    clickStreamFullReloadDetailsToggle(window),
  );
  const streamFullReloadCollapsedMetrics = await runSmokeStep(
    "read collapsed stream full reload details metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("collapse stream controls", () =>
    clickStreamControlsToggle(window),
  );
  const streamControlsCollapsedMetrics = await runSmokeStep(
    "read collapsed stream controls metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("expand stream controls", () =>
    clickStreamControlsToggle(window),
  );
  const streamControlsExpandedMetrics = await runSmokeStep(
    "read expanded stream controls metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("collapse timeline stream event group", () =>
    clickStreamEventGroupToggle(window, "timeline"),
  );
  const streamGroupCollapsedMetrics = await runSmokeStep(
    "read collapsed stream event group metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("expand timeline stream event group", () =>
    clickStreamEventGroupToggle(window, "timeline"),
  );
  const streamGroupExpandedMetrics = await runSmokeStep(
    "read expanded stream event group metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("collapse stream selection", () =>
    clickStreamSelectionToggle(window),
  );
  const streamSelectionCollapsedMetrics = await runSmokeStep(
    "read collapsed stream selection metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("expand stream selection", () =>
    clickStreamSelectionToggle(window),
  );
  const streamSelectionExpandedMetrics = await runSmokeStep(
    "read expanded stream selection metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("expand stream selection metadata", () =>
    clickStreamSelectionMetadataToggle(window),
  );
  const streamSelectionMetadataExpandedMetrics = await runSmokeStep(
    "read expanded stream selection metadata metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("collapse stream selection metadata", () =>
    clickStreamSelectionMetadataToggle(window),
  );
  const streamSelectionMetadataCollapsedMetrics = await runSmokeStep(
    "read collapsed stream selection metadata metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("collapse stream panel", () =>
    clickStreamPanelToggle(window),
  );
  const streamCollapsedMetrics = await runSmokeStep(
    "read collapsed stream panel metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("expand stream panel", () =>
    clickStreamPanelToggle(window),
  );
  const streamExpandedMetrics = await runSmokeStep(
    "read expanded stream panel metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("show lifecycle panel", () =>
    clickPanel(window, "lifecycle"),
  );
  const initialFileTreeMetrics = await runSmokeStep(
    "read initial file tree metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select workflow graph file tree node", () =>
    clickFileTreeNode(window, "workflow_graph"),
  );
  const fileTreeSelectMetrics = await runSmokeStep(
    "read selected file tree metrics",
    () => readMetrics(window),
  );
  const initialVersionSnapshotMetrics = await runSmokeStep(
    "read initial version snapshot metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select git version snapshot", () =>
    clickVersionSnapshot(window, "git_snapshot"),
  );
  const versionSnapshotSelectMetrics = await runSmokeStep(
    "read selected version snapshot metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select runtime version snapshot by keyboard", () =>
    keyVersionSnapshot(window, "runtime", "Enter"),
  );
  const versionSnapshotKeyboardMetrics = await runSmokeStep(
    "read keyboard-selected version snapshot metrics",
    () => readMetrics(window),
  );
  const initialTaskDrawerMetrics = await runSmokeStep(
    "read initial task drawer metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select unread task drawer item", () =>
    clickTaskDrawerItem(window, "unread_events"),
  );
  const taskDrawerSelectMetrics = await runSmokeStep(
    "read selected task drawer metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select visible task drawer item by Space", () =>
    keyTaskDrawerItem(window, "visible_items", "Space"),
  );
  const taskDrawerSpaceMetrics = await runSmokeStep(
    "read Space-selected task drawer metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select runtime task drawer item by keyboard", () =>
    keyTaskDrawerItem(window, "runtime_stream", "Enter"),
  );
  const taskDrawerKeyboardMetrics = await runSmokeStep(
    "read keyboard-selected task drawer metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("focus next lifecycle item", () =>
    clickLifecycleCommand(window, "focus_next_timeline_item"),
  );
  await runSmokeStep("select focused lifecycle item", () =>
    clickLifecycleCommand(window, "select_focused_timeline_item"),
  );
  await runSmokeStep("focus second lifecycle item", () =>
    clickLifecycleCommand(window, "focus_next_timeline_item"),
  );
  await runSmokeStep("select second lifecycle item", () =>
    clickLifecycleCommand(window, "select_focused_timeline_item"),
  );
  await runSmokeStep("collapse task drawer", () =>
    clickTaskDrawerToggle(window),
  );
  const collapsedMetrics = await runSmokeStep("read drawer metrics", () =>
    readMetrics(window),
  );
  await runSmokeStep("expand task drawer", () => clickTaskDrawerToggle(window));
  await runSmokeStep("collapse chat box", () => clickChatBoxToggle(window));
  const chatCollapsedMetrics = await runSmokeStep("read chat metrics", () =>
    readMetrics(window),
  );
  await runSmokeStep("expand chat box", () => clickChatBoxToggle(window));
  const chatInitialMetrics = await runSmokeStep(
    "read initial chat draft metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select revise chat draft intent", () =>
    clickChatDraftIntent(window, "revise"),
  );
  await runSmokeStep("select repair chat draft intent", () =>
    clickChatDraftIntent(window, "repair"),
  );
  await runSmokeStep("input chat draft", () =>
    inputChatDraft(window, "Review repair plan now"),
  );
  const chatDraftMetrics = await runSmokeStep("read chat draft metrics", () =>
    readMetrics(window),
  );
  let chatClearedMetrics = null;
  let chatLocalSubmitMetrics = null;
  let chatLocalHistoryMetrics = null;
  let chatLocalHistoryClearedMetrics = null;
  let chatLocalResendMetrics = null;
  if (chatBoxMode === "enabled") {
    await runSmokeStep("send first local chat draft", () =>
      sendChatDraft(window, "Review repair plan now", {
        sequence: 1,
        count: 1,
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
      }),
    );
    chatLocalSubmitMetrics = await runSmokeStep(
      "read first local chat send metrics",
      () => readMetrics(window),
    );
    await runSmokeStep("send second local chat draft", () =>
      sendChatDraft(window, "Audit repair evidence", {
        sequence: 2,
        count: 2,
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
      }),
    );
    await runSmokeStep("send third local chat draft", () =>
      sendChatDraft(window, "Trace runtime status", {
        sequence: 3,
        count: 3,
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
      }),
    );
    await runSmokeStep("send fourth local chat draft", () =>
      sendChatDraft(window, "Confirm workflow handoff", {
        sequence: 4,
        count: 3,
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
      }),
    );
    chatLocalHistoryMetrics = await runSmokeStep(
      "read capped local chat history metrics",
      () => readMetrics(window),
    );
    await runSmokeStep("clear local chat history", () =>
      clearChatLocalSubmissionHistory(window),
    );
    chatLocalHistoryClearedMetrics = await runSmokeStep(
      "read cleared local chat history metrics",
      () => readMetrics(window),
    );
    await runSmokeStep("send local chat draft after history clear", () =>
      sendChatDraft(window, "Resume local request", {
        sequence: 5,
        count: 1,
        status: "queued_local",
        intent: "repair",
        target: "repair",
        action: "repair_review",
      }),
    );
    chatLocalResendMetrics = await runSmokeStep(
      "read local chat resend metrics",
      () => readMetrics(window),
    );
  } else {
    await runSmokeStep("clear chat draft", () => clearChatDraft(window));
    chatClearedMetrics = await runSmokeStep(
      "read cleared chat draft metrics",
      () => readMetrics(window),
    );
  }
  await runSmokeStep("show canvas panel", () => clickPanel(window, "canvas"));
  await runSmokeStep("select repair canvas node", () =>
    clickWorkflowCanvasNode(window, "repair_task"),
  );
  const canvasMetrics = await runSmokeStep("read canvas metrics", () =>
    readMetrics(window),
  );
  await runSmokeStep("focus repair canvas node type", () =>
    clickWorkflowCanvasTypeFocus(window, "node", "repair_task"),
  );
  const canvasNodeTypeFocusMetrics = await runSmokeStep(
    "read canvas node type focus metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select context canvas node before type match", () =>
    clickWorkflowCanvasNode(window, "context_task"),
  );
  const canvasNodeTypeFocusPreMatchMetrics = await runSmokeStep(
    "read canvas node type focus pre-match metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select repair canvas node type match", () =>
    clickWorkflowCanvasTypeFocusNodeMatch(window, "repair_task"),
  );
  const canvasNodeTypeFocusMatchMetrics = await runSmokeStep(
    "read canvas node type focus match metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("focus normal canvas edge type", () =>
    clickWorkflowCanvasTypeFocus(window, "edge", "normal"),
  );
  const canvasEdgeTypeFocusMetrics = await runSmokeStep(
    "read canvas edge type focus metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("clear canvas type focus", () =>
    clearWorkflowCanvasTypeFocus(window),
  );
  const canvasTypeFocusClearMetrics = await runSmokeStep(
    "read canvas type focus clear metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select incoming repair route", () =>
    clickWorkflowCanvasInspectorRoute(
      window,
      "review_to_repair",
      "review_task",
    ),
  );
  const canvasRouteMetrics = await runSmokeStep(
    "read canvas route metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select previous canvas node", () =>
    clickWorkflowCanvasInspectorBack(window, "repair_task"),
  );
  const canvasBackMetrics = await runSmokeStep("read canvas back metrics", () =>
    readMetrics(window),
  );
  await runSmokeStep("select next canvas node by keyboard", () =>
    keyWorkflowCanvasSelectedNode(window, "ArrowRight", "end"),
  );
  const canvasKeyboardNextMetrics = await runSmokeStep(
    "read canvas keyboard next metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("keep edge canvas node by keyboard", () =>
    keyWorkflowCanvasSelectedNode(window, "ArrowRight", "end"),
  );
  const canvasKeyboardNoopMetrics = await runSmokeStep(
    "read canvas keyboard no-op metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select previous canvas node by keyboard", () =>
    keyWorkflowCanvasSelectedNode(window, "ArrowLeft", "repair_task"),
  );
  const canvasKeyboardPreviousMetrics = await runSmokeStep(
    "read canvas keyboard previous metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select upward canvas node by keyboard", () =>
    keyWorkflowCanvasSelectedNode(window, "ArrowUp", "review_task"),
  );
  const canvasKeyboardUpMetrics = await runSmokeStep(
    "read canvas keyboard up metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select downward canvas node by keyboard", () =>
    keyWorkflowCanvasSelectedNode(window, "ArrowDown", "repair_task"),
  );
  const canvasKeyboardDownMetrics = await runSmokeStep(
    "read canvas keyboard down metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("select canvas history checkpoint", () =>
    clickWorkflowCanvasHistoryTrail(window, "end", 4),
  );
  const canvasHistorySelectMetrics = await runSmokeStep(
    "read canvas history select metrics",
    () => readMetrics(window),
  );
  await runSmokeStep("show lifecycle panel", () =>
    clickPanel(window, "lifecycle"),
  );
  if (scrollY > 0) {
    await runSmokeStep("scroll viewport", () =>
      window.webContents.executeJavaScript(`window.scrollTo(0, ${scrollY})`),
    );
  }
  const metrics = await runSmokeStep("read final metrics", () =>
    readMetrics(window),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await window.webContents.capturePage();
  if (image.isEmpty()) {
    throw new Error("Electron visual smoke capture returned an empty image");
  }
  const captureSize = image.getSize();
  const failures = collectVisualSmokeFailures(
    metrics,
    messages,
    width,
    streamEventMode,
    chatBoxMode,
    initialStreamMetrics,
    streamEventExpandedMetrics,
    streamEventCollapsedMetrics,
    streamFullReloadExpandedMetrics,
    streamFullReloadCollapsedMetrics,
    streamControlsCollapsedMetrics,
    streamControlsExpandedMetrics,
    streamGroupCollapsedMetrics,
    streamGroupExpandedMetrics,
    streamSelectionCollapsedMetrics,
    streamSelectionExpandedMetrics,
    streamSelectionMetadataExpandedMetrics,
    streamSelectionMetadataCollapsedMetrics,
    streamCollapsedMetrics,
    streamExpandedMetrics,
    initialFileTreeMetrics,
    fileTreeSelectMetrics,
    initialVersionSnapshotMetrics,
    versionSnapshotSelectMetrics,
    versionSnapshotKeyboardMetrics,
    initialTaskDrawerMetrics,
    taskDrawerSelectMetrics,
    taskDrawerSpaceMetrics,
    taskDrawerKeyboardMetrics,
    collapsedMetrics,
    chatCollapsedMetrics,
    chatInitialMetrics,
    chatDraftMetrics,
    chatClearedMetrics,
    chatLocalSubmitMetrics,
    chatLocalHistoryMetrics,
    chatLocalHistoryClearedMetrics,
    chatLocalResendMetrics,
    canvasMetrics,
    canvasNodeTypeFocusMetrics,
    canvasNodeTypeFocusPreMatchMetrics,
    canvasNodeTypeFocusMatchMetrics,
    canvasEdgeTypeFocusMetrics,
    canvasTypeFocusClearMetrics,
    canvasRouteMetrics,
    canvasBackMetrics,
    canvasKeyboardNextMetrics,
    canvasKeyboardNoopMetrics,
    canvasKeyboardPreviousMetrics,
    canvasKeyboardUpMetrics,
    canvasKeyboardDownMetrics,
    canvasHistorySelectMetrics,
  );
  await fs.writeFile(outputPath, image.toPNG());
  await fs.writeFile(
    `${outputPath}.json`,
    JSON.stringify(
      {
        targetLocation,
        streamEventMode,
        chatBoxMode,
        requestedViewport: { width, height, scrollY },
        captureSize,
        metrics,
        initialStreamMetrics,
        streamEventExpandedMetrics,
        streamEventCollapsedMetrics,
        streamFullReloadExpandedMetrics,
        streamFullReloadCollapsedMetrics,
        streamControlsCollapsedMetrics,
        streamControlsExpandedMetrics,
        streamGroupCollapsedMetrics,
        streamGroupExpandedMetrics,
        streamSelectionCollapsedMetrics,
        streamSelectionExpandedMetrics,
        streamSelectionMetadataExpandedMetrics,
        streamSelectionMetadataCollapsedMetrics,
        streamCollapsedMetrics,
        streamExpandedMetrics,
        initialFileTreeMetrics,
        fileTreeSelectMetrics,
        initialVersionSnapshotMetrics,
        versionSnapshotSelectMetrics,
        versionSnapshotKeyboardMetrics,
        initialTaskDrawerMetrics,
        taskDrawerSelectMetrics,
        taskDrawerSpaceMetrics,
        taskDrawerKeyboardMetrics,
        collapsedMetrics,
        chatCollapsedMetrics,
        chatInitialMetrics,
        chatDraftMetrics,
        chatClearedMetrics,
        chatLocalSubmitMetrics,
        chatLocalHistoryMetrics,
        chatLocalHistoryClearedMetrics,
        chatLocalResendMetrics,
        canvasMetrics,
        canvasNodeTypeFocusMetrics,
        canvasNodeTypeFocusPreMatchMetrics,
        canvasNodeTypeFocusMatchMetrics,
        canvasEdgeTypeFocusMetrics,
        canvasTypeFocusClearMetrics,
        canvasRouteMetrics,
        canvasBackMetrics,
        canvasKeyboardNextMetrics,
        canvasKeyboardNoopMetrics,
        canvasKeyboardPreviousMetrics,
        canvasKeyboardUpMetrics,
        canvasKeyboardDownMetrics,
        canvasHistorySelectMetrics,
        messages,
        failures,
        outputEvidence,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) {
    throw new Error(`Electron visual smoke failed: ${failures.join("; ")}`);
  }
  window.destroy();
  await app.quit();
}

main().catch(async (error) => {
  console.error(error);
  await app.quit();
  process.exitCode = 1;
});
