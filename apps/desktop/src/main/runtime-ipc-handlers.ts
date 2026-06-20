import {
  RUNTIME_API_PREFIX,
  createRuntimeBaseUrl,
  isValidRuntimePort,
  normalizeRuntimeAuthToken,
  type RuntimeConnectionInfo,
} from "./runtime.js";
import {
  buildRuntimeIpcFetchRequest,
  buildRuntimeIpcRequestHeaders,
  type RuntimeIpcFetchRequest,
  type RuntimeIpcMainHandlers,
  type RuntimeIpcResponse,
} from "../shared/runtime-ipc.js";

export type RuntimeConnectionInfoProvider = () =>
  | RuntimeConnectionInfo
  | Promise<RuntimeConnectionInfo>;

export interface RuntimeIpcMainHandlerOptions {
  readonly connectionInfo: RuntimeConnectionInfoProvider;
  readonly fetchImpl?: typeof fetch;
}

export function createRuntimeIpcMainHandlers(
  options: RuntimeIpcMainHandlerOptions,
): RuntimeIpcMainHandlers {
  return {
    connectionInfo: async () =>
      normalizeRuntimeConnectionInfo(await options.connectionInfo()),
    fetch: async <TBody = unknown>(
      request: RuntimeIpcFetchRequest,
    ): Promise<RuntimeIpcResponse<TBody>> => {
      const connectionInfo = normalizeRuntimeConnectionInfo(
        await options.connectionInfo(),
      );
      const normalizedRequest = buildRuntimeIpcFetchRequest(
        request.path,
        request.init,
      );
      const fetchImpl = options.fetchImpl ?? globalThis.fetch;
      if (fetchImpl === undefined) {
        throw new Error("Runtime IPC fetch implementation is unavailable");
      }

      const response = await fetchImpl(
        buildRuntimeFetchUrl(connectionInfo, normalizedRequest.path),
        {
          method: normalizedRequest.init?.method ?? "GET",
          headers: buildRuntimeIpcRequestHeaders({
            token: connectionInfo.token,
            ...(normalizedRequest.init?.projectId !== undefined
              ? { projectId: normalizedRequest.init.projectId }
              : {}),
            ...(normalizedRequest.init?.idempotencyKey !== undefined
              ? { idempotencyKey: normalizedRequest.init.idempotencyKey }
              : {}),
            ...(normalizedRequest.init?.headers !== undefined
              ? { extraHeaders: normalizedRequest.init.headers }
              : {}),
          }),
          ...(normalizedRequest.init?.body !== undefined
            ? { body: normalizedRequest.init.body }
            : {}),
        },
      );

      return readRuntimeIpcResponse<TBody>(response);
    },
  };
}

export function normalizeRuntimeConnectionInfo(
  connectionInfo: RuntimeConnectionInfo,
): RuntimeConnectionInfo {
  const port = parseRuntimeBaseUrlPort(connectionInfo.base_url);
  return {
    base_url: createRuntimeBaseUrl(port),
    token: normalizeRuntimeAuthToken(connectionInfo.token),
  };
}

function buildRuntimeFetchUrl(
  connectionInfo: RuntimeConnectionInfo,
  requestPath: string,
): string {
  return `${connectionInfo.base_url}${requestPath}`;
}

function parseRuntimeBaseUrlPort(baseUrl: string): number {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== RUNTIME_API_PREFIX ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Runtime base_url must be a loopback /cw/v1 HTTP URL");
  }

  const port = Number(url.port);
  if (!isValidRuntimePort(port)) {
    throw new Error("Runtime base_url port must be in 1..65535");
  }

  return port;
}

async function readRuntimeIpcResponse<TBody>(
  response: Response,
): Promise<RuntimeIpcResponse<TBody>> {
  const headers = responseHeadersToRecord(response.headers);
  const body = await readRuntimeIpcResponseBody<TBody>(response);
  return {
    ok: response.ok,
    status: response.status,
    headers,
    body,
  };
}

async function readRuntimeIpcResponseBody<TBody>(
  response: Response,
): Promise<TBody | null> {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    return JSON.parse(text) as TBody;
  }

  return text as TBody;
}

function responseHeadersToRecord(
  headers: Headers,
): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });

  return record;
}
