import type { RuntimeConnectionInfo } from "../main/runtime.js";
import {
  assertRuntimeIpcRequestPath,
  buildRuntimeIpcRequestHeaders,
  type RuntimeIpcFetchInit,
  type RuntimeIpcRequestHeadersInput,
  type RuntimeIpcRequestPath,
  type RuntimeIpcResponse,
  type RuntimeIpcStartupStatus,
} from "../shared/runtime-ipc.js";

export type RuntimeRequestPath = RuntimeIpcRequestPath;

export interface RuntimeRequestHeadersInput extends RuntimeIpcRequestHeadersInput {}

export interface RuntimeRequestInit extends RuntimeIpcFetchInit {}

export interface RuntimeResponse<
  TBody = unknown,
> extends RuntimeIpcResponse<TBody> {}

export type RuntimeStartupStatus = RuntimeIpcStartupStatus;

export interface RuntimeBridge {
  readonly startupStatus: () => Promise<readonly RuntimeStartupStatus[]>;
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
