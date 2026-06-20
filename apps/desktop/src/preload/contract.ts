import type { RuntimeConnectionInfo } from "../main/runtime.js";

export type RuntimeRequestPath = `/${string}`;

export interface RuntimeRequestHeadersInput {
  readonly token: string;
  readonly projectId?: string;
  readonly idempotencyKey?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export interface RuntimeRequestInit {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly projectId?: string;
  readonly idempotencyKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface RuntimeResponse<TBody = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: TBody | null;
}

export interface RuntimeBridge {
  readonly connectionInfo: () => Promise<RuntimeConnectionInfo>;
  readonly fetch: <TBody = unknown>(
    path: RuntimeRequestPath,
    init?: RuntimeRequestInit,
  ) => Promise<RuntimeResponse<TBody>>;
}

export interface CwDesktopApi {
  readonly runtime: RuntimeBridge;
}

declare global {
  interface Window {
    readonly cw: CwDesktopApi;
  }
}

const RESERVED_RUNTIME_HEADERS = new Set([
  "authorization",
  "x-cw-client",
  "x-project-id",
]);
const HEADER_VALUE_PATTERN = /^[\t\u0020-\u007e]*$/u;

export function assertRuntimeRequestPath(
  path: string,
): asserts path is RuntimeRequestPath {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("..")
  ) {
    throw new Error(
      `Runtime request path must be an absolute API path, received ${path}`,
    );
  }

  if (/^https?:\/\//iu.test(path)) {
    throw new Error("Runtime request path must not be an absolute URL");
  }
}

export function buildRuntimeRequestHeaders(
  input: RuntimeRequestHeadersInput,
): Readonly<Record<string, string>> {
  const token = requireSafeToken(input.token);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Cw-Client": "electron-renderer",
  };

  if (input.projectId !== undefined) {
    headers["X-Project-Id"] = requireSafeHeaderValue(
      "X-Project-Id",
      input.projectId,
    );
  }

  if (input.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = requireSafeHeaderValue(
      "Idempotency-Key",
      input.idempotencyKey,
    );
  }

  if (input.extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(input.extraHeaders)) {
      const normalizedName = name.toLowerCase();
      if (RESERVED_RUNTIME_HEADERS.has(normalizedName)) {
        throw new Error(
          `Runtime header ${name} is reserved for preload injection`,
        );
      }

      headers[name] = requireSafeHeaderValue(name, value);
    }
  }

  return headers;
}

function requireSafeHeaderValue(label: string, value: string): string {
  if (
    value.length === 0 ||
    !HEADER_VALUE_PATTERN.test(value) ||
    /[\r\n]/u.test(value)
  ) {
    throw new Error(`${label} must be non-empty printable ASCII without CR/LF`);
  }

  return value;
}

function requireSafeToken(value: string): string {
  const token = value.trim();
  if (token.length === 0 || /[\u0000-\u001f\u007f\s]/u.test(token)) {
    throw new Error(
      "Authorization token must be non-empty and contain no whitespace or control characters",
    );
  }

  return token;
}

export {};
