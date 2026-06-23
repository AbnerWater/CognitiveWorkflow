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
  initialFileTreeMetrics,
  fileTreeSelectMetrics,
  collapsedMetrics,
  chatCollapsedMetrics,
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
  const failures = collectVisualSmokeFailures(
    metrics,
    messages,
    width,
    initialFileTreeMetrics,
    fileTreeSelectMetrics,
    collapsedMetrics,
    chatCollapsedMetrics,
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
        metrics,
        initialFileTreeMetrics,
        fileTreeSelectMetrics,
        collapsedMetrics,
        chatCollapsedMetrics,
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
