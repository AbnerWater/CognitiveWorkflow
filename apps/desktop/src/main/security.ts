export interface DesktopWindowSecurity {
  readonly contextIsolation: true;
  readonly sandbox: true;
  readonly nodeIntegration: false;
  readonly webSecurity: true;
  readonly allowRunningInsecureContent: false;
}

export interface ContentSecurityPolicyOptions {
  readonly allowDevLoopbackWebSocket?: boolean;
}

export const DESKTOP_WINDOW_SECURITY = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const satisfies DesktopWindowSecurity;

export function getDesktopWindowSecurity(): DesktopWindowSecurity {
  return { ...DESKTOP_WINDOW_SECURITY };
}

export function buildContentSecurityPolicy(
  options: ContentSecurityPolicyOptions = {},
): string {
  const connectSrc = ["'self'", "http://127.0.0.1:*"];
  if (options.allowDevLoopbackWebSocket === true) {
    connectSrc.push("ws://127.0.0.1:*");
  }

  const directives: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["default-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["script-src", ["'self'"]],
    ["style-src", ["'self'"]],
    ["font-src", ["'self'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["connect-src", connectSrc],
  ];

  const csp = directives
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
  assertStrictContentSecurityPolicy(csp);
  return csp;
}

export function assertStrictContentSecurityPolicy(csp: string): void {
  const forbiddenPatterns = [
    /'unsafe-eval'/u,
    /'unsafe-inline'/u,
    /\bhttps?:\/\/\*/u,
    /\bhttps?:\/\/0\.0\.0\.0(?::\*)?/u,
    /\bhttps?:\/\/localhost(?::\*)?/u,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(csp)) {
      throw new Error(
        `Desktop CSP contains forbidden source: ${pattern.source}`,
      );
    }
  }

  if (!/\bconnect-src\b[^;]*http:\/\/127\.0\.0\.1:\*/u.test(csp)) {
    throw new Error(
      "Desktop CSP must allow sidecar connections only through 127.0.0.1",
    );
  }
}
