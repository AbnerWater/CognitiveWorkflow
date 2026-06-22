import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  RuntimeBridge,
  RuntimeStatusUnsubscribe,
} from "../preload/contract.js";
import type { RuntimeIpcResponse } from "../shared/runtime-ipc.js";
import { createRuntimeFetchEventSourceFactory } from "../renderer/runtime-stream-fetch-event-source.js";
import { createRuntimeWorkbenchShellReactSession } from "../renderer/runtime-workbench-shell-react-session.js";
import type { RuntimeWorkbenchShellSnapshot } from "../renderer/runtime-workbench-shell-presenter.js";
import { createRuntimeConnectionRegistry } from "./runtime-connection-registry.js";
import { startRuntimeWithLifecycle } from "./runtime-startup-controller.js";

interface ProjectCreateResponseBody {
  readonly project_id: string;
  readonly host_path: string;
}

interface ProjectReadResponseBody {
  readonly active_workflow_id: string | null;
}

interface RunStartResponseBody {
  readonly run_id: string;
  readonly stream_url: string;
}

type StartedRuntimeStartup = Extract<
  Awaited<ReturnType<typeof startRuntimeWithLifecycle>>,
  { readonly action: "started_sidecar" }
>;

test("starts real Python sidecar and opens renderer shell run stream", async () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const pythonCommand = resolveRuntimeSmokePythonCommand(workspaceRoot);
  await access(pythonCommand);

  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "cw-runtime-sidecar-stream-smoke-"),
  );
  const ownerRoot = path.join(tempRoot, "owner");
  const projectHostPath = path.join(tempRoot, "project");
  const connectionRegistry = createRuntimeConnectionRegistry();
  const errors: unknown[] = [];
  let startup: StartedRuntimeStartup | undefined;

  try {
    const startupResult = await startRuntimeWithLifecycle({
      projectRoot: ownerRoot,
      command: {
        devCommand: pythonCommand,
        devArgs: ["-m", "cw_runtime.cli"],
      },
      cwd: workspaceRoot,
      readyTimeoutMs: 15_000,
      connectionRegistry,
      shutdown: { timeoutMs: 250 },
    });
    if (startupResult.action !== "started_sidecar") {
      throw new Error(`Expected started sidecar, got ${startupResult.action}`);
    }
    startup = startupResult;

    const runtime = createBridgeFromStartupHandlers(startup.handlers);
    const project = requireBody<ProjectCreateResponseBody>(
      await runtime.fetch("/projects", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "0.1.0",
          display_name: "Desktop sidecar stream smoke",
          host_path: projectHostPath,
        }),
      }),
      201,
    );
    const loadedProject = requireBody<ProjectReadResponseBody>(
      await runtime.fetch(`/projects/${project.project_id}`),
      200,
    );
    const workflowId = loadedProject.active_workflow_id;
    assert.notEqual(workflowId, null);

    const run = requireBody<RunStartResponseBody>(
      await runtime.fetch(`/workflows/${workflowId}/run`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "0.1.0",
          mode: "semi_auto",
          initial_input: { goal: "real sidecar stream smoke" },
          metadata: {},
        }),
      }),
      201,
    );
    assert.equal(run.stream_url, `/cw/v1/runs/${run.run_id}/stream`);

    const shell = createRuntimeWorkbenchShellReactSession({
      runtime,
      eventSourceFactory: createRuntimeFetchEventSourceFactory(),
      onError: (error) => errors.push(error),
    });
    try {
      await shell.dispatch({
        type: "open_runtime_stream_session",
        options: {
          channel: { kind: "run", runId: run.run_id },
          projectId: project.project_id,
          filters: { level: "default", category: "lifecycle" },
        },
      });
      await waitFor(() => {
        const panel = requireRuntimeStreamPanel(shell.getSnapshot());
        return panel.timelineItems.some((item) => item.type === "run.started");
      });

      const panel = requireRuntimeStreamPanel(shell.getSnapshot());
      const started = panel.timelineItems.find(
        (item) => item.type === "run.started",
      );
      assert.equal(panel.status, "running");
      assert.equal(panel.totalEvents, 1);
      assert.equal(started?.title, "Run started");
      assert.equal(started?.category, "lifecycle");
      assert.equal(errors.length, 0);
    } finally {
      shell.dispose();
    }
  } finally {
    if (startup !== undefined) {
      await stopStartedRuntime(startup);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function resolveWorkspaceRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function resolveRuntimeSmokePythonCommand(workspaceRoot: string): string {
  const configured = process.env.CW_RUNTIME_SMOKE_PYTHON?.trim();
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  return process.platform === "win32"
    ? path.join(workspaceRoot, ".venv", "Scripts", "python.exe")
    : path.join(workspaceRoot, ".venv", "bin", "python");
}

function createBridgeFromStartupHandlers(
  handlers: StartedRuntimeStartup["handlers"],
): RuntimeBridge {
  const noopSubscribe = (): RuntimeStatusUnsubscribe => () => false;
  return {
    startupStatus: async () => [],
    onStartupStatus: noopSubscribe,
    shutdownStatus: async () => [],
    onShutdownStatus: noopSubscribe,
    connectionInfo: () => handlers.connectionInfo(),
    fetch: (requestPath, init) =>
      handlers.fetch({
        path: requestPath,
        ...(init !== undefined ? { init } : {}),
      }),
  };
}

async function stopStartedRuntime(
  startup: StartedRuntimeStartup,
): Promise<void> {
  const sidecarClosed = startup.session.sidecar.closed;
  await startup.stop("SIGTERM");
  await startup.closed;
  await waitForRuntimeSidecarClosed(sidecarClosed, 5_000);
}

async function waitForRuntimeSidecarClosed(
  closed: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      closed.then(() => undefined),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `Runtime sidecar did not exit within ${timeoutMs}ms after stop`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function requireBody<TBody extends object>(
  response: RuntimeIpcResponse<unknown>,
  status: number,
): TBody {
  assert.equal(response.status, status);
  assert.equal(response.ok, true);
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  return response.body as TBody;
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
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
