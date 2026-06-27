import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ArtifactActionResult } from "@cw/schemas";

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
  parseRuntimeIpcArtifactActionRequestPayload,
  type RuntimeIpcArtifactActionRequest,
  type RuntimeIpcFetchRequest,
  type RuntimeIpcMainHandlers,
  type RuntimeIpcResponse,
} from "../shared/runtime-ipc.js";

export const RUNTIME_SHUTDOWN_REQUEST_PATH = "/system/shutdown" as const;

export type RuntimeConnectionInfoProvider = () =>
  | RuntimeConnectionInfo
  | Promise<RuntimeConnectionInfo>;

export interface RuntimeIpcMainHandlerOptions {
  readonly connectionInfo: RuntimeConnectionInfoProvider;
  readonly fetchImpl?: typeof fetch;
  readonly artifactOpenPath?: RuntimeArtifactOpenPath;
  readonly artifactTempDir?: string;
}

export type RuntimeArtifactOpenPath = (targetPath: string) => Promise<string>;

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
          ...(normalizedRequest.init?.bodyBase64 !== undefined
            ? {
                body: Buffer.from(normalizedRequest.init.bodyBase64, "base64"),
              }
            : {}),
        },
      );

      return readRuntimeIpcResponse<TBody>(response);
    },
    artifactAction: async (
      request: RuntimeIpcArtifactActionRequest,
    ): Promise<ArtifactActionResult> =>
      runRuntimeArtifactAction(request, options),
  };
}

export function requestRuntimeShutdown(
  handlers: Pick<RuntimeIpcMainHandlers, "fetch">,
): Promise<RuntimeIpcResponse> {
  return handlers.fetch(
    buildRuntimeIpcFetchRequest(RUNTIME_SHUTDOWN_REQUEST_PATH, {
      method: "POST",
    }),
  );
}

async function runRuntimeArtifactAction(
  rawRequest: RuntimeIpcArtifactActionRequest,
  options: RuntimeIpcMainHandlerOptions,
): Promise<ArtifactActionResult> {
  const request = parseRuntimeIpcArtifactActionRequestPayload(rawRequest);
  const sensitive = request.artifact_sensitivity === "sensitive";
  const baseResult = {
    schema_version: "0.1.0" as const,
    artifact_id: request.artifact_id,
    action: request.action,
    sensitive,
    ...(request.correlation_id !== undefined
      ? { correlation_id: request.correlation_id }
      : {}),
  };

  if (
    sensitive &&
    request.action === "download" &&
    request.requested_destination_kind === "user_selected" &&
    request.allow_sensitive_export !== true
  ) {
    return {
      ...baseResult,
      status: "blocked",
      destination_kind: "none",
    };
  }

  if (request.action === "open" && options.artifactOpenPath === undefined) {
    return {
      ...baseResult,
      status: "blocked",
      destination_kind: "none",
    };
  }

  let response: Response;
  try {
    const connectionInfo = normalizeRuntimeConnectionInfo(
      await options.connectionInfo(),
    );
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (fetchImpl === undefined) {
      throw new Error("Runtime IPC fetch implementation is unavailable");
    }
    response = await fetchImpl(
      buildRuntimeFetchUrl(
        connectionInfo,
        buildRuntimeArtifactContentPath(request.artifact_id),
      ),
      {
        method: "GET",
        headers: buildRuntimeIpcRequestHeaders({
          token: connectionInfo.token,
          ...(sensitive ? { extraHeaders: { "X-Cw-Sensitive": "true" } } : {}),
        }),
      },
    );
  } catch {
    return {
      ...baseResult,
      status: "failed",
      destination_kind: "none",
    };
  }

  const contentType = response.headers.get("content-type");
  if (!response.ok) {
    return {
      ...baseResult,
      status: "failed",
      content_type: contentType,
      destination_kind: "none",
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return {
      ...baseResult,
      status: "failed",
      content_type: contentType,
      destination_kind: "none",
    };
  }

  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  let destinationPath: string;
  try {
    destinationPath = await writeRuntimeArtifactTempFile(
      bytes,
      request.artifact_id,
      contentType,
      options.artifactTempDir,
    );
  } catch {
    return {
      ...baseResult,
      status: "failed",
      byte_count: bytes.byteLength,
      content_hash: contentHash,
      content_type: contentType,
      destination_kind: "none",
    };
  }

  if (request.action === "download") {
    return {
      ...baseResult,
      status: "succeeded",
      byte_count: bytes.byteLength,
      content_hash: contentHash,
      content_type: contentType,
      destination_kind: "project_temp",
    };
  }

  const openResult = await options.artifactOpenPath?.(destinationPath);
  if (openResult !== undefined && openResult.length > 0) {
    return {
      ...baseResult,
      status: "failed",
      byte_count: bytes.byteLength,
      content_hash: contentHash,
      content_type: contentType,
      destination_kind: "project_temp",
    };
  }

  return {
    ...baseResult,
    status: "succeeded",
    byte_count: bytes.byteLength,
    content_hash: contentHash,
    content_type: contentType,
    destination_kind: "native_shell",
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

function buildRuntimeArtifactContentPath(artifactId: string): string {
  return `/artifacts/${encodeURIComponent(artifactId)}/content`;
}

async function writeRuntimeArtifactTempFile(
  bytes: Buffer,
  artifactId: string,
  contentType: string | null,
  artifactTempDir: string | undefined,
): Promise<string> {
  const directory =
    artifactTempDir ?? path.join(tmpdir(), "cw-runtime-artifacts");
  await mkdir(directory, { recursive: true });
  const filename = [
    "artifact",
    safeRuntimeArtifactFilenameSegment(artifactId),
    `${Date.now()}`,
  ].join("-");
  const targetPath = path.join(
    directory,
    `${filename}${runtimeArtifactExtension(contentType)}`,
  );
  await writeFile(targetPath, bytes);
  return targetPath;
}

function safeRuntimeArtifactFilenameSegment(artifactId: string): string {
  const cleaned = artifactId.replace(/[^0-9A-Za-z._-]+/gu, "_");
  return cleaned.length === 0 ? "artifact" : cleaned.slice(0, 80);
}

function runtimeArtifactExtension(contentType: string | null): string {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  switch (normalized) {
    case "application/json":
      return ".json";
    case "text/html":
      return ".html";
    case "text/markdown":
    case "text/x-markdown":
      return ".md";
    case "text/plain":
      return ".txt";
    default:
      return ".bin";
  }
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
