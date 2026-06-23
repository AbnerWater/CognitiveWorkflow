const fs = require("node:fs/promises");

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

const { app, BrowserWindow } = require("electron");

const targetUrl = process.env.CW_VISUAL_SMOKE_URL;
const outputPath = process.env.CW_VISUAL_SMOKE_OUTPUT;
const width = Number(process.env.CW_VISUAL_SMOKE_WIDTH ?? "1280");
const height = Number(process.env.CW_VISUAL_SMOKE_HEIGHT ?? "720");
const scrollY = Number(process.env.CW_VISUAL_SMOKE_SCROLL_Y ?? "0");
const expectedSelectedTitle = "Startup timed out after bounded wait";

if (!targetUrl || !outputPath) {
  throw new Error(
    "CW_VISUAL_SMOKE_URL and CW_VISUAL_SMOKE_OUTPUT are required",
  );
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
      hasTaskDrawer: document.querySelector('.cw-workbench__task-drawer') !== null,
      hasChatBox: document.querySelector('.cw-workbench__chat') !== null,
      dockItems: document.querySelectorAll('.cw-workbench__dock-item').length,
      fileTreeNodes: document.querySelectorAll('.cw-workbench__file-tree-node').length,
      versionSnapshotItems:
        document.querySelectorAll('.cw-workbench__version-snapshot-item').length,
      activeVersionSnapshotItems:
        document.querySelectorAll('.cw-workbench__version-snapshot-item--active').length,
      workflowCanvasNodes:
        document.querySelectorAll('.cw-workbench__workflow-canvas-node').length,
      workflowCanvasEdges:
        document.querySelectorAll('.cw-workbench__workflow-canvas-edge').length,
      previewWorkflowCanvasSurfaces:
        document.querySelectorAll('[data-workflow-canvas-surface="preview"]').length,
      focusedWorkflowCanvasSurfaces:
        document.querySelectorAll('[data-workflow-canvas-surface="focused"]').length,
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
      selectedWorkflowCanvasEdges:
        document.querySelectorAll('[data-workflow-canvas-edge-selected="true"]').length,
      selectedWorkflowCanvasEdgeIds:
        Array.from(
          document.querySelectorAll('[data-workflow-canvas-edge-selected="true"]'),
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
      taskDrawerCollapsedSummary:
        document.querySelector('.cw-workbench__task-drawer-collapsed')?.textContent ?? null,
      chatBoxExpanded:
        document.querySelector('.cw-workbench__chat')?.getAttribute('data-chat-box-expanded') ?? null,
      chatComposeControls:
        document.querySelectorAll('.cw-workbench__chat-compose textarea, .cw-workbench__chat-compose button').length,
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
      frameworkOverlayText:
        document.body.textContent?.includes('Internal server error') ||
        document.body.textContent?.includes('[plugin:vite]') ||
        false,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))()
  `);
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
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.cw-workbench__dock-item[data-panel="${panel}"], .cw-workbench__tab[data-panel="${panel}"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing workbench panel button: ${panel}');
      }
      button.click();
    })()
  `);
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

async function runSmokeStep(label, action) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
}

function collectVisualSmokeFailures(
  metrics,
  messages,
  requestedWidth,
  collapsedMetrics,
  chatCollapsedMetrics,
  canvasMetrics,
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
  if (canvasRouteMetrics.workflowCanvasInspectorHistoryDepth !== "2") {
    failures.push(
      `expected review_task canvas history depth 2, got ${canvasRouteMetrics.workflowCanvasInspectorHistoryDepth}`,
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
  if (canvasBackMetrics.workflowCanvasInspectorHistoryDepth !== "1") {
    failures.push(
      `expected back navigation history depth 1, got ${canvasBackMetrics.workflowCanvasInspectorHistoryDepth}`,
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
  if (canvasKeyboardNextMetrics.workflowCanvasInspectorHistoryDepth !== "2") {
    failures.push(
      `expected keyboard ArrowRight history depth 2, got ${canvasKeyboardNextMetrics.workflowCanvasInspectorHistoryDepth}`,
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
  if (canvasKeyboardNoopMetrics.workflowCanvasInspectorHistoryDepth !== "2") {
    failures.push(
      `expected keyboard same-target ArrowRight history depth 2, got ${canvasKeyboardNoopMetrics.workflowCanvasInspectorHistoryDepth}`,
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
    canvasKeyboardPreviousMetrics.workflowCanvasInspectorHistoryDepth !== "3"
  ) {
    failures.push(
      `expected keyboard ArrowLeft history depth 3, got ${canvasKeyboardPreviousMetrics.workflowCanvasInspectorHistoryDepth}`,
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
  if (canvasKeyboardUpMetrics.workflowCanvasInspectorHistoryDepth !== "4") {
    failures.push(
      `expected keyboard ArrowUp history depth 4, got ${canvasKeyboardUpMetrics.workflowCanvasInspectorHistoryDepth}`,
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
  if (canvasKeyboardDownMetrics.workflowCanvasInspectorHistoryDepth !== "5") {
    failures.push(
      `expected keyboard ArrowDown history depth 5, got ${canvasKeyboardDownMetrics.workflowCanvasInspectorHistoryDepth}`,
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
  if (canvasKeyboardDownMetrics.workflowCanvasHistoryTrailItems !== 5) {
    failures.push(
      `expected keyboard ArrowDown history trail count 5, got ${canvasKeyboardDownMetrics.workflowCanvasHistoryTrailItems}`,
    );
  }
  const canvasKeyboardDownHistoryTrail = Array.isArray(
    canvasKeyboardDownMetrics.workflowCanvasHistoryTrailNodeIds,
  )
    ? canvasKeyboardDownMetrics.workflowCanvasHistoryTrailNodeIds.join(",")
    : "";
  if (
    canvasKeyboardDownHistoryTrail !==
    "0:context_task,1:repair_task,2:end,3:repair_task,4:review_task"
  ) {
    failures.push(
      `expected keyboard ArrowDown history trail context_task,repair_task,end,repair_task,review_task, got ${canvasKeyboardDownHistoryTrail}`,
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
  if (canvasHistorySelectMetrics.workflowCanvasInspectorHistoryDepth !== "2") {
    failures.push(
      `expected history trail checkpoint history depth 2, got ${canvasHistorySelectMetrics.workflowCanvasInspectorHistoryDepth}`,
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
  if (canvasHistorySelectMetrics.workflowCanvasHistoryTrailItems !== 2) {
    failures.push(
      `expected history trail checkpoint trail count 2, got ${canvasHistorySelectMetrics.workflowCanvasHistoryTrailItems}`,
    );
  }
  const canvasHistorySelectTrail = Array.isArray(
    canvasHistorySelectMetrics.workflowCanvasHistoryTrailNodeIds,
  )
    ? canvasHistorySelectMetrics.workflowCanvasHistoryTrailNodeIds.join(",")
    : "";
  if (canvasHistorySelectTrail !== "0:context_task,1:repair_task") {
    failures.push(
      `expected history trail checkpoint trail context_task,repair_task, got ${canvasHistorySelectTrail}`,
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
  if (metrics.chatComposeControls !== 2) {
    failures.push(
      `expected 2 chat compose controls, got ${metrics.chatComposeControls}`,
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
  await runSmokeStep("show canvas panel", () => clickPanel(window, "canvas"));
  await runSmokeStep("select repair canvas node", () =>
    clickWorkflowCanvasNode(window, "repair_task"),
  );
  const canvasMetrics = await runSmokeStep("read canvas metrics", () =>
    readMetrics(window),
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
    clickWorkflowCanvasHistoryTrail(window, "end", 2),
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
  const failures = collectVisualSmokeFailures(
    metrics,
    messages,
    width,
    collapsedMetrics,
    chatCollapsedMetrics,
    canvasMetrics,
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
        metrics,
        collapsedMetrics,
        chatCollapsedMetrics,
        canvasMetrics,
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
        outputPath,
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
