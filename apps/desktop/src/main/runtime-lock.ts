import { readFile } from "node:fs/promises";
import path from "node:path";

export const AGENT_WORKFLOW_DIRNAME = ".agent-workflow" as const;
export const RUNTIME_LOCKS_DIRNAME = "locks" as const;
export const RUNTIME_LOCK_FILENAME = "runtime.lock" as const;
export const DEFAULT_RUNTIME_LOCK_STALE_MS = 60_000;

export type RuntimeLockStatus = "missing" | "active" | "stale" | "corrupt";
export type RuntimeLockAction =
  | "start_sidecar"
  | "cleanup_then_start"
  | "reuse_existing_or_wait"
  | "block_startup";

export interface RuntimeLockRecord {
  readonly pid: number;
  readonly acquired_at: string;
  readonly acquiredAtMs: number;
  readonly adapter_id?: string;
  readonly raw: Readonly<Record<string, string>>;
}

export interface RuntimeLockInspection {
  readonly status: RuntimeLockStatus;
  readonly lockPath: string;
  readonly record?: RuntimeLockRecord;
  readonly ageMs?: number;
  readonly error?: string;
}

export type RuntimeLockReadText = (lockPath: string) => Promise<string>;

export interface InspectRuntimeLockOptions {
  readonly projectRoot: string;
  readonly nowMs?: number;
  readonly staleMs?: number;
  readonly readText?: RuntimeLockReadText;
}

export function resolveRuntimeLockPath(projectRoot: string): string {
  return path.join(
    normalizePathValue(projectRoot, "Project root"),
    AGENT_WORKFLOW_DIRNAME,
    RUNTIME_LOCKS_DIRNAME,
    RUNTIME_LOCK_FILENAME,
  );
}

export function parseRuntimeLockContent(content: string): RuntimeLockRecord {
  const raw: Record<string, string> = {};

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error("Runtime lock line must use key=value format");
    }

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    if (!/^[a-z][a-z0-9_]*$/u.test(key)) {
      throw new Error(`Runtime lock key is invalid: ${key}`);
    }
    if (Object.hasOwn(raw, key)) {
      throw new Error(`Runtime lock key is duplicated: ${key}`);
    }
    if (value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`Runtime lock value is invalid for key: ${key}`);
    }

    raw[key] = value;
  }

  const pid = parseRuntimeLockPid(raw.pid);
  const acquiredAt = parseRuntimeLockAcquiredAt(raw.acquired_at);
  const record: {
    pid: number;
    acquired_at: string;
    acquiredAtMs: number;
    adapter_id?: string;
    raw: Readonly<Record<string, string>>;
  } = {
    pid,
    acquired_at: acquiredAt.acquired_at,
    acquiredAtMs: acquiredAt.acquiredAtMs,
    raw,
  };

  if (raw.adapter_id !== undefined) {
    record.adapter_id = raw.adapter_id;
  }

  return record;
}

export async function inspectRuntimeLock(
  options: InspectRuntimeLockOptions,
): Promise<RuntimeLockInspection> {
  const lockPath = resolveRuntimeLockPath(options.projectRoot);
  const readText = options.readText ?? readRuntimeLockText;
  let content: string;

  try {
    content = await readText(lockPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { status: "missing", lockPath };
    }

    return {
      status: "corrupt",
      lockPath,
      error: `Runtime lock could not be read: ${errorName(error)}`,
    };
  }

  let record: RuntimeLockRecord;
  try {
    record = parseRuntimeLockContent(content);
  } catch (error) {
    return {
      status: "corrupt",
      lockPath,
      error: error instanceof Error ? error.message : "Runtime lock is invalid",
    };
  }

  const staleMs = options.staleMs ?? DEFAULT_RUNTIME_LOCK_STALE_MS;
  if (!Number.isInteger(staleMs) || staleMs <= 0) {
    throw new RangeError(
      "Runtime lock stale threshold must be a positive integer",
    );
  }

  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("Runtime lock inspection time must be finite");
  }

  const ageMs = Math.max(0, nowMs - record.acquiredAtMs);
  const status: RuntimeLockStatus = ageMs > staleMs ? "stale" : "active";
  return { status, lockPath, record, ageMs };
}

export function decideRuntimeLockAction(
  inspection: RuntimeLockInspection,
): RuntimeLockAction {
  switch (inspection.status) {
    case "missing":
      return "start_sidecar";
    case "stale":
      return "cleanup_then_start";
    case "active":
      return "reuse_existing_or_wait";
    case "corrupt":
      return "block_startup";
  }
}

function parseRuntimeLockPid(value: string | undefined): number {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
    throw new Error("Runtime lock pid must be a positive integer");
  }

  const pid = Number(value);
  if (!Number.isSafeInteger(pid)) {
    throw new Error("Runtime lock pid must be a safe integer");
  }

  return pid;
}

function parseRuntimeLockAcquiredAt(
  value: string | undefined,
): Pick<RuntimeLockRecord, "acquired_at" | "acquiredAtMs"> {
  if (
    value === undefined ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
  ) {
    throw new Error("Runtime lock acquired_at must be UTC second precision");
  }

  const acquiredAtMs = Date.parse(value);
  if (!Number.isFinite(acquiredAtMs)) {
    throw new Error("Runtime lock acquired_at must be a valid UTC timestamp");
  }

  return { acquired_at: value, acquiredAtMs };
}

function normalizePathValue(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} must not contain control characters`);
  }

  return normalized;
}

async function readRuntimeLockText(lockPath: string): Promise<string> {
  return readFile(lockPath, "utf8");
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
