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
      hasLifecyclePanel: document.querySelector('.cw-workbench__lifecycle-panel') !== null,
      hasTaskDrawer: document.querySelector('.cw-workbench__task-drawer') !== null,
      hasChatBox: document.querySelector('.cw-workbench__chat') !== null,
      dockItems: document.querySelectorAll('.cw-workbench__dock-item').length,
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
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-lifecycle-navigation-command="${command}"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing lifecycle navigation button: ${command}');
      }
      button.click();
    })()
  `);
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

function collectVisualSmokeFailures(
  metrics,
  messages,
  requestedWidth,
  collapsedMetrics,
  chatCollapsedMetrics,
) {
  const failures = [];

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
  await window.loadURL(targetUrl);
  await clickLifecycleCommand(window, "focus_next_timeline_item");
  await clickLifecycleCommand(window, "select_focused_timeline_item");
  await clickLifecycleCommand(window, "focus_next_timeline_item");
  await clickLifecycleCommand(window, "select_focused_timeline_item");
  await clickTaskDrawerToggle(window);
  const collapsedMetrics = await readMetrics(window);
  await clickTaskDrawerToggle(window);
  await clickChatBoxToggle(window);
  const chatCollapsedMetrics = await readMetrics(window);
  await clickChatBoxToggle(window);
  if (scrollY > 0) {
    await window.webContents.executeJavaScript(
      `window.scrollTo(0, ${scrollY})`,
    );
  }
  const metrics = await readMetrics(window);
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
  );
  await fs.writeFile(outputPath, image.toPNG());
  await fs.writeFile(
    `${outputPath}.json`,
    JSON.stringify(
      {
        metrics,
        collapsedMetrics,
        chatCollapsedMetrics,
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
