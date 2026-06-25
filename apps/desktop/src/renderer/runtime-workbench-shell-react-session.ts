import type { RuntimeBridge } from "../preload/contract.js";
import {
  createRuntimeLifecyclePanelControllerFactory,
  type RuntimeLifecyclePanelControllerErrorHandler,
} from "./runtime-lifecycle-panel-controller.js";
import {
  createRuntimeLifecyclePanelSessionController,
  createRuntimeLifecyclePanelSessionFactory,
} from "./runtime-lifecycle-panel-session.js";
import {
  type RuntimeStreamEventSource,
  type RuntimeStreamEventSourceFactory,
} from "./runtime-stream-client.js";
import {
  createRuntimeStreamInteractionSessionController,
  createRuntimeStreamInteractionSessionFactory,
} from "./runtime-stream-session.js";
import { createRuntimeWorkbenchHostSession } from "./runtime-workbench-host-session.js";
import { createRuntimeWorkbenchShellAdapter } from "./runtime-workbench-shell-adapter.js";
import { createRuntimeWorkbenchShellDomSession } from "./runtime-workbench-shell-dom-session.js";
import type { RuntimeWorkbenchShellDomSession } from "./runtime-workbench-shell-dom-session.js";
import { createRuntimeWorkbenchShellPresenter } from "./runtime-workbench-shell-presenter.js";

export type RuntimeWorkbenchShellReactSessionErrorHandler =
  RuntimeLifecyclePanelControllerErrorHandler;

export interface CreateRuntimeWorkbenchShellReactSessionOptions {
  readonly runtime: RuntimeBridge;
  readonly projectId?: string;
  readonly eventSourceFactory?: RuntimeStreamEventSourceFactory;
  readonly onError?: RuntimeWorkbenchShellReactSessionErrorHandler;
}

export function createRuntimeWorkbenchShellReactSession(
  options: CreateRuntimeWorkbenchShellReactSessionOptions,
): RuntimeWorkbenchShellDomSession {
  const lifecyclePanelController = createRuntimeLifecyclePanelSessionController(
    {
      factory: createRuntimeLifecyclePanelSessionFactory({
        controllerFactory: createRuntimeLifecyclePanelControllerFactory({
          runtime: options.runtime,
          ...(options.onError !== undefined
            ? { onError: options.onError }
            : {}),
        }),
        ...(options.onError !== undefined ? { onError: options.onError } : {}),
      }),
      ...(options.onError !== undefined ? { onError: options.onError } : {}),
    },
  );
  const runtimeStreamController =
    createRuntimeStreamInteractionSessionController({
      factory: createRuntimeStreamInteractionSessionFactory({
        runtime: options.runtime,
        eventSourceFactory:
          options.eventSourceFactory ?? unavailableRuntimeStreamEventSource,
        ...(options.projectId !== undefined
          ? { projectId: options.projectId }
          : {}),
        ...(options.onError !== undefined ? { onError: options.onError } : {}),
      }),
      ...(options.onError !== undefined ? { onError: options.onError } : {}),
    });
  const host = createRuntimeWorkbenchHostSession({
    lifecyclePanelController,
    runtimeStreamController,
    runtime: options.runtime,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const presenter = createRuntimeWorkbenchShellPresenter({
    host,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const adapter = createRuntimeWorkbenchShellAdapter({
    presenter,
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  const session = createRuntimeWorkbenchShellDomSession({ adapter });

  return {
    ...session,
    dispose: () => {
      const sessionDisposed = session.dispose();
      const hostDisposed = host.dispose();
      return sessionDisposed || hostDisposed;
    },
    isDisposed: () => session.isDisposed() || host.isDisposed(),
  };
}

function unavailableRuntimeStreamEventSource(): RuntimeStreamEventSource {
  throw new Error("Runtime stream EventSource factory is not configured");
}
