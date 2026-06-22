import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { CwDesktopApi } from "../preload/contract.js";
import { RuntimeWorkbenchShellReactView } from "./runtime-workbench-shell-react.js";
import { createRuntimeWorkbenchShellReactSession } from "./runtime-workbench-shell-react-session.js";
import "./runtime-workbench-shell.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Runtime workbench root element was not found");
}

const root = createRoot(rootElement);
const desktopApi = resolveCwDesktopApi(window);

if (desktopApi === null) {
  root.render(<RuntimeWorkbenchShellUnavailable />);
} else {
  const session = createRuntimeWorkbenchShellReactSession({
    runtime: desktopApi.runtime,
    onError: reportRuntimeWorkbenchShellError,
  });
  window.addEventListener(
    "beforeunload",
    () => {
      session.dispose();
    },
    { once: true },
  );
  root.render(
    <StrictMode>
      <RuntimeWorkbenchShellReactView
        keyboardTarget={window}
        onActionError={reportRuntimeWorkbenchShellError}
        session={session}
      />
    </StrictMode>,
  );
}

function RuntimeWorkbenchShellUnavailable(): ReactElement {
  return (
    <main className="cw-workbench cw-workbench--unavailable">
      <header className="cw-workbench__header">
        <div>
          <p className="cw-workbench__eyebrow">Runtime Shell</p>
          <h1>CognitiveWorkflow Runtime Workbench</h1>
        </div>
      </header>
      <section className="cw-workbench__content">
        <div className="cw-workbench__empty">
          <h2>Desktop preload unavailable</h2>
          <p>Runtime workbench shell requires the CW desktop preload bridge.</p>
        </div>
      </section>
    </main>
  );
}

function resolveCwDesktopApi(target: Window): CwDesktopApi | null {
  const candidate = (target as Window & { readonly cw?: CwDesktopApi }).cw;
  return candidate ?? null;
}

function reportRuntimeWorkbenchShellError(error: unknown): void {
  console.error(error);
}
