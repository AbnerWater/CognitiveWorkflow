import {
  assertRuntimeIpcRequestPath,
  buildRuntimeIpcRequestHeaders,
  type RuntimeIpcArtifactActionRequest,
  type RuntimeIpcArtifactActionResult,
  type RuntimeIpcConnectionInfo,
  type RuntimeIpcFetchInit,
  type RuntimeIpcRequestHeadersInput,
  type RuntimeIpcRequestPath,
  type RuntimeIpcResponse,
  type RuntimeIpcShutdownStatus,
  type RuntimeIpcStartupStatus,
} from "../shared/runtime-ipc.js";

export type RuntimeRequestPath = RuntimeIpcRequestPath;
export type RuntimeConnectionInfo = RuntimeIpcConnectionInfo;
export type RuntimeArtifactActionRequest = RuntimeIpcArtifactActionRequest;
export type RuntimeArtifactActionResult = RuntimeIpcArtifactActionResult;

export interface RuntimeRequestHeadersInput extends RuntimeIpcRequestHeadersInput {}

export interface RuntimeRequestInit extends RuntimeIpcFetchInit {}

export interface RuntimeResponse<
  TBody = unknown,
> extends RuntimeIpcResponse<TBody> {}

export type RuntimeStartupStatus = RuntimeIpcStartupStatus;
export type RuntimeShutdownStatus = RuntimeIpcShutdownStatus;

export type RuntimeStartupStatusListener = (
  statuses: readonly RuntimeStartupStatus[],
) => void;

export type RuntimeShutdownStatusListener = (
  statuses: readonly RuntimeShutdownStatus[],
) => void;

export type RuntimeStatusUnsubscribe = () => boolean;
export type RuntimeStartupStatusUnsubscribe = RuntimeStatusUnsubscribe;
export type RuntimeShutdownStatusUnsubscribe = RuntimeStatusUnsubscribe;

export interface RuntimeBridge {
  readonly startupStatus: () => Promise<readonly RuntimeStartupStatus[]>;
  readonly onStartupStatus: (
    listener: RuntimeStartupStatusListener,
  ) => RuntimeStartupStatusUnsubscribe;
  readonly shutdownStatus: () => Promise<readonly RuntimeShutdownStatus[]>;
  readonly onShutdownStatus: (
    listener: RuntimeShutdownStatusListener,
  ) => RuntimeShutdownStatusUnsubscribe;
  readonly connectionInfo: () => Promise<RuntimeConnectionInfo>;
  readonly fetch: <TBody = unknown>(
    path: RuntimeRequestPath,
    init?: RuntimeRequestInit,
  ) => Promise<RuntimeResponse<TBody>>;
  readonly artifactAction: (
    request: RuntimeArtifactActionRequest,
  ) => Promise<RuntimeArtifactActionResult>;
}

export interface CwDesktopApi {
  readonly runtime: RuntimeBridge;
}

declare global {
  interface Window {
    readonly cw: CwDesktopApi;
  }
}

export function assertRuntimeRequestPath(
  path: string,
): asserts path is RuntimeRequestPath {
  assertRuntimeIpcRequestPath(path);
}

export function buildRuntimeRequestHeaders(
  input: RuntimeRequestHeadersInput,
): Readonly<Record<string, string>> {
  return buildRuntimeIpcRequestHeaders(input);
}

export {};
