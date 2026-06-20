export const RUNTIME_IPC_CONNECTION_INFO_CHANNEL =
  "cw:runtime:connection-info" as const;
export const RUNTIME_IPC_FETCH_CHANNEL = "cw:runtime:fetch" as const;
export const RUNTIME_IPC_STARTUP_STATUS_CHANNEL =
  "cw:runtime:startup-status" as const;
export const RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL =
  "cw:runtime:shutdown-status" as const;
export const RUNTIME_IPC_CHANNELS = [
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_STARTUP_STATUS_CHANNEL,
  RUNTIME_IPC_SHUTDOWN_STATUS_CHANNEL,
] as const;
export const RUNTIME_IPC_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;

export type RuntimeIpcChannel = (typeof RUNTIME_IPC_CHANNELS)[number];
export type RuntimeIpcMethod = (typeof RUNTIME_IPC_METHODS)[number];
export type RuntimeIpcRequestPath = `/${string}`;

export interface RuntimeIpcConnectionInfo {
  readonly base_url: string;
  readonly token: string;
}

export interface RuntimeIpcFetchInit {
  readonly method?: RuntimeIpcMethod;
  readonly projectId?: string;
  readonly idempotencyKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface RuntimeIpcFetchRequest {
  readonly path: RuntimeIpcRequestPath;
  readonly init?: RuntimeIpcFetchInit;
}

export interface RuntimeIpcRequestHeadersInput {
  readonly token: string;
  readonly projectId?: string;
  readonly idempotencyKey?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export interface RuntimeIpcResponse<TBody = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: TBody | null;
}

export type RuntimeIpcStartupStatusKind =
  | "starting_sidecar"
  | "cleaning_stale_lock"
  | "waiting_for_existing"
  | "runtime_ready"
  | "startup_blocked"
  | "startup_timed_out";

export type RuntimeIpcStartupStatusSeverity = "info" | "warning" | "error";

export type RuntimeIpcStartupStatusAction =
  | "start_sidecar"
  | "cleanup_then_start"
  | "reuse_existing"
  | "wait_for_existing"
  | "timeout_waiting_for_existing"
  | "block_startup";

export type RuntimeIpcStartupLockStatus =
  | "missing"
  | "active"
  | "stale"
  | "corrupt";

export interface RuntimeIpcStartupStatus {
  readonly kind: RuntimeIpcStartupStatusKind;
  readonly action: RuntimeIpcStartupStatusAction;
  readonly attempt: number;
  readonly lockStatus: RuntimeIpcStartupLockStatus;
  readonly severity: RuntimeIpcStartupStatusSeverity;
  readonly message: string;
  readonly lifecycleComplete: boolean;
  readonly userActionRequired: boolean;
  readonly retryable: boolean;
  readonly reason?: string;
}

export type RuntimeIpcStartupStatusResponse =
  readonly RuntimeIpcStartupStatus[];

export type RuntimeIpcShutdownStatusKind =
  | "registered"
  | "app_quit_requested"
  | "window_close_requested"
  | "shutting_down"
  | "shutdown_complete"
  | "shutdown_failed"
  | "unregistered";

export type RuntimeIpcShutdownState =
  | "registered"
  | "shutting_down"
  | "shutdown_complete"
  | "failed"
  | "unregistered";

export type RuntimeIpcShutdownStatusSeverity = "info" | "warning" | "error";

export interface RuntimeIpcShutdownStatus {
  readonly kind: RuntimeIpcShutdownStatusKind;
  readonly state: RuntimeIpcShutdownState;
  readonly severity: RuntimeIpcShutdownStatusSeverity;
  readonly lifecycleComplete: boolean;
  readonly retryable: boolean;
  readonly appQuitRequested: boolean;
  readonly windowCloseRequested: boolean;
  readonly reason?: string;
}

export type RuntimeIpcShutdownStatusResponse =
  readonly RuntimeIpcShutdownStatus[];

export interface RuntimeIpcMainHandlers {
  readonly connectionInfo: () => Promise<RuntimeIpcConnectionInfo>;
  readonly fetch: <TBody = unknown>(
    request: RuntimeIpcFetchRequest,
  ) => Promise<RuntimeIpcResponse<TBody>>;
}

const RESERVED_RUNTIME_IPC_HEADERS = new Set([
  "authorization",
  "x-cw-client",
  "x-project-id",
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const HEADER_VALUE_PATTERN = /^[\t\u0020-\u007e]*$/u;

export function isRuntimeIpcChannel(
  channel: string,
): channel is RuntimeIpcChannel {
  return RUNTIME_IPC_CHANNELS.includes(channel as RuntimeIpcChannel);
}

export function assertRuntimeIpcChannel(
  channel: string,
): asserts channel is RuntimeIpcChannel {
  if (!isRuntimeIpcChannel(channel)) {
    throw new Error(`Unsupported runtime IPC channel: ${channel}`);
  }
}

export function assertRuntimeIpcRequestPath(
  requestPath: string,
): asserts requestPath is RuntimeIpcRequestPath {
  if (
    !requestPath.startsWith("/") ||
    requestPath.startsWith("//") ||
    requestPath.includes("\\") ||
    requestPath.includes("..")
  ) {
    throw new Error(
      `Runtime request path must be an absolute API path, received ${requestPath}`,
    );
  }

  if (/^https?:\/\//iu.test(requestPath)) {
    throw new Error("Runtime request path must not be an absolute URL");
  }
}

export function buildRuntimeIpcFetchRequest(
  requestPath: string,
  init?: RuntimeIpcFetchInit,
): RuntimeIpcFetchRequest {
  assertRuntimeIpcRequestPath(requestPath);
  if (init === undefined) {
    return { path: requestPath };
  }

  return {
    path: requestPath,
    init: normalizeRuntimeIpcFetchInit(init),
  };
}

export function parseRuntimeIpcFetchRequestPayload(
  payload: unknown,
): RuntimeIpcFetchRequest {
  if (!isRecord(payload)) {
    throw new Error("Runtime IPC fetch payload must be an object");
  }

  const path = payload.path;
  if (typeof path !== "string") {
    throw new Error("Runtime IPC fetch payload path must be a string");
  }

  const init = payload.init;
  if (init === undefined) {
    return buildRuntimeIpcFetchRequest(path);
  }

  if (!isRecord(init)) {
    throw new Error("Runtime IPC fetch payload init must be an object");
  }

  return buildRuntimeIpcFetchRequest(path, parseRuntimeIpcFetchInit(init));
}

export function buildRuntimeIpcRequestHeaders(
  input: RuntimeIpcRequestHeadersInput,
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
      assertRuntimeIpcHeaderName(name);
      const normalizedName = name.toLowerCase();
      if (RESERVED_RUNTIME_IPC_HEADERS.has(normalizedName)) {
        throw new Error(
          `Runtime header ${name} is reserved for runtime injection`,
        );
      }

      headers[name] = requireSafeHeaderValue(name, value);
    }
  }

  return headers;
}

function parseRuntimeIpcFetchInit(
  init: Readonly<Record<string, unknown>>,
): RuntimeIpcFetchInit {
  const parsed: {
    method?: RuntimeIpcMethod;
    projectId?: string;
    idempotencyKey?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
  } = {};

  if (init.method !== undefined) {
    if (typeof init.method !== "string") {
      throw new Error("Runtime IPC fetch init method must be a string");
    }
    parsed.method = init.method as RuntimeIpcMethod;
  }

  if (init.projectId !== undefined) {
    if (typeof init.projectId !== "string") {
      throw new Error("Runtime IPC fetch init projectId must be a string");
    }
    parsed.projectId = init.projectId;
  }

  if (init.idempotencyKey !== undefined) {
    if (typeof init.idempotencyKey !== "string") {
      throw new Error("Runtime IPC fetch init idempotencyKey must be a string");
    }
    parsed.idempotencyKey = init.idempotencyKey;
  }

  if (init.headers !== undefined) {
    parsed.headers = parseRuntimeIpcHeaders(init.headers);
  }

  if (init.body !== undefined) {
    if (typeof init.body !== "string") {
      throw new Error("Runtime IPC fetch init body must be a string");
    }
    parsed.body = init.body;
  }

  return parsed;
}

function parseRuntimeIpcHeaders(
  headers: unknown,
): Readonly<Record<string, string>> {
  if (!isRecord(headers)) {
    throw new Error("Runtime IPC fetch init headers must be an object");
  }

  const parsed: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      throw new Error(`Runtime IPC header ${name} value must be a string`);
    }
    parsed[name] = value;
  }

  return parsed;
}

function normalizeRuntimeIpcFetchInit(
  init: RuntimeIpcFetchInit,
): RuntimeIpcFetchInit {
  const normalized: {
    method?: RuntimeIpcMethod;
    projectId?: string;
    idempotencyKey?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
  } = {};

  if (init.method !== undefined) {
    if (!RUNTIME_IPC_METHODS.includes(init.method)) {
      throw new Error(`Runtime IPC method is not supported: ${init.method}`);
    }
    normalized.method = init.method;
  }

  if (init.projectId !== undefined) {
    normalized.projectId = requireSafeHeaderValue(
      "X-Project-Id",
      init.projectId,
    );
  }

  if (init.idempotencyKey !== undefined) {
    normalized.idempotencyKey = requireSafeHeaderValue(
      "Idempotency-Key",
      init.idempotencyKey,
    );
  }

  if (init.headers !== undefined) {
    normalized.headers = normalizeRuntimeIpcHeaders(init.headers);
  }

  if (init.body !== undefined) {
    normalized.body = init.body;
  }

  return normalized;
}

function normalizeRuntimeIpcHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    assertRuntimeIpcHeaderName(name);
    if (RESERVED_RUNTIME_IPC_HEADERS.has(lowerName)) {
      throw new Error(`Runtime IPC header ${name} is reserved`);
    }

    normalized[name] = requireSafeHeaderValue(name, value);
  }

  return normalized;
}

function assertRuntimeIpcHeaderName(name: string): void {
  if (!HEADER_NAME_PATTERN.test(name)) {
    throw new Error(`Runtime IPC header name is invalid: ${name}`);
  }
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
