import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const AGENT_WORKFLOW_DIRNAME = ".agent-workflow" as const;
export const RUNTIME_LOCKS_DIRNAME = "locks" as const;
export const RUNTIME_LOCK_FILENAME = "runtime.lock" as const;
export const DEFAULT_RUNTIME_LOCK_STALE_MS = 60_000;
export const DEFAULT_RUNTIME_LOCK_ACQUIRE_TIMEOUT_MS = 60_000;
export const DEFAULT_RUNTIME_LOCK_RETRY_MS = 50;
export const DEFAULT_RUNTIME_LOCK_ADAPTER_ID = "desktop-main" as const;
export const RUNTIME_LOCK_MUTATION_GUARD_SUFFIX = ".mutation" as const;

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
export type RuntimeLockWriteTextExclusive = (
  lockPath: string,
  content: string,
) => Promise<void>;
export type RuntimeLockRemoveFile = (lockPath: string) => Promise<void>;
export type RuntimeLockEnsureDirectory = (
  directoryPath: string,
) => Promise<void>;
export type RuntimeLockSleep = (delayMs: number) => Promise<void>;

export interface InspectRuntimeLockOptions {
  readonly projectRoot: string;
  readonly nowMs?: number;
  readonly staleMs?: number;
  readonly readText?: RuntimeLockReadText;
}

export interface BuildRuntimeLockContentOptions {
  readonly pid?: number;
  readonly nowMs?: number;
  readonly adapterId?: string;
}

export interface AcquireRuntimeLockOptions {
  readonly projectRoot: string;
  readonly pid?: number;
  readonly adapterId?: string;
  readonly nowMs?: number;
  readonly staleMs?: number;
  readonly timeoutMs?: number;
  readonly retryMs?: number;
  readonly readText?: RuntimeLockReadText;
  readonly writeTextExclusive?: RuntimeLockWriteTextExclusive;
  readonly removeFile?: RuntimeLockRemoveFile;
  readonly ensureDirectory?: RuntimeLockEnsureDirectory;
  readonly sleep?: RuntimeLockSleep;
}

export interface RuntimeLockLease {
  readonly lockPath: string;
  readonly record: RuntimeLockRecord;
  readonly content: string;
  release: () => Promise<void>;
}

export function resolveRuntimeLockPath(projectRoot: string): string {
  return path.join(
    normalizePathValue(projectRoot, "Project root"),
    AGENT_WORKFLOW_DIRNAME,
    RUNTIME_LOCKS_DIRNAME,
    RUNTIME_LOCK_FILENAME,
  );
}

export function buildRuntimeLockContent(
  options: BuildRuntimeLockContentOptions = {},
): string {
  const pid = normalizeRuntimeLockPid(options.pid ?? process.pid);
  const acquiredAt = formatUtcSecond(options.nowMs ?? Date.now());
  const adapterId = normalizeRuntimeLockAdapterId(
    options.adapterId ?? DEFAULT_RUNTIME_LOCK_ADAPTER_ID,
  );

  return `pid=${pid}\nacquired_at=${acquiredAt}\nadapter_id=${adapterId}\n`;
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

export async function acquireRuntimeLock(
  options: AcquireRuntimeLockOptions,
): Promise<RuntimeLockLease> {
  const lockPath = resolveRuntimeLockPath(options.projectRoot);
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_RUNTIME_LOCK_ACQUIRE_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RUNTIME_LOCK_RETRY_MS;
  const staleMs = options.staleMs ?? DEFAULT_RUNTIME_LOCK_STALE_MS;
  assertPositiveInteger(timeoutMs, "Runtime lock acquire timeout");
  assertPositiveInteger(retryMs, "Runtime lock retry interval");
  assertPositiveInteger(staleMs, "Runtime lock stale threshold");

  const ensureDirectory = options.ensureDirectory ?? ensureRuntimeLockDirectory;
  const readText = options.readText ?? readRuntimeLockText;
  const writeTextExclusive =
    options.writeTextExclusive ?? writeRuntimeLockTextExclusive;
  const removeFile = options.removeFile ?? removeRuntimeLockFile;
  const sleep = options.sleep ?? sleepMs;
  const startedAtMs = Date.now();

  await ensureDirectory(path.dirname(lockPath));

  while (true) {
    const content = buildRuntimeLockContent({
      ...(options.pid !== undefined ? { pid: options.pid } : {}),
      ...(options.adapterId !== undefined
        ? { adapterId: options.adapterId }
        : {}),
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    });

    try {
      await writeTextExclusive(lockPath, content);
      const record = parseRuntimeLockContent(content);
      return createRuntimeLockLease(lockPath, content, record, {
        readText,
        writeTextExclusive,
        removeFile,
        sleep,
        timeoutMs,
        retryMs,
        staleMs,
        ...(options.pid !== undefined ? { pid: options.pid } : {}),
        ...(options.adapterId !== undefined
          ? { adapterId: options.adapterId }
          : {}),
        ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
      });
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }
    }

    const inspection = await inspectRuntimeLock({
      projectRoot: options.projectRoot,
      readText,
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
      ...(options.staleMs !== undefined ? { staleMs: options.staleMs } : {}),
    });
    const action = decideRuntimeLockAction(inspection);

    if (action === "cleanup_then_start") {
      await cleanupStaleRuntimeLock(lockPath, options, {
        readText,
        writeTextExclusive,
        removeFile,
        sleep,
        timeoutMs,
        retryMs,
        staleMs,
      });
      continue;
    }

    if (action === "start_sidecar") {
      continue;
    }

    if (action === "block_startup") {
      throw new Error(
        `Runtime lock acquisition blocked: ${inspection.error ?? "lock is corrupt"}`,
      );
    }

    if (Date.now() - startedAtMs >= timeoutMs) {
      throw new Error("Timed out acquiring runtime.lock");
    }

    await sleep(retryMs);
  }
}

async function cleanupStaleRuntimeLock(
  lockPath: string,
  options: AcquireRuntimeLockOptions,
  io: {
    readonly readText: RuntimeLockReadText;
    readonly writeTextExclusive: RuntimeLockWriteTextExclusive;
    readonly removeFile: RuntimeLockRemoveFile;
    readonly sleep: RuntimeLockSleep;
    readonly timeoutMs: number;
    readonly retryMs: number;
    readonly staleMs: number;
  },
): Promise<void> {
  await withRuntimeLockMutationGuard(
    lockPath,
    {
      readText: io.readText,
      writeTextExclusive: io.writeTextExclusive,
      removeFile: io.removeFile,
      sleep: io.sleep,
      timeoutMs: io.timeoutMs,
      retryMs: io.retryMs,
      staleMs: io.staleMs,
      ...(options.pid !== undefined ? { pid: options.pid } : {}),
      ...(options.adapterId !== undefined
        ? { adapterId: options.adapterId }
        : {}),
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    },
    async () => {
      const inspection = await inspectRuntimeLock({
        projectRoot: options.projectRoot,
        readText: io.readText,
        ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
        ...(options.staleMs !== undefined ? { staleMs: options.staleMs } : {}),
      });
      const action = decideRuntimeLockAction(inspection);

      if (action === "cleanup_then_start") {
        await io.removeFile(lockPath);
        return;
      }

      if (action === "block_startup") {
        throw new Error(
          `Runtime lock acquisition blocked: ${inspection.error ?? "lock is corrupt"}`,
        );
      }
    },
  );
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

function createRuntimeLockLease(
  lockPath: string,
  content: string,
  record: RuntimeLockRecord,
  io: {
    readonly readText: RuntimeLockReadText;
    readonly writeTextExclusive: RuntimeLockWriteTextExclusive;
    readonly removeFile: RuntimeLockRemoveFile;
    readonly sleep: RuntimeLockSleep;
    readonly timeoutMs: number;
    readonly retryMs: number;
    readonly staleMs: number;
    readonly pid?: number;
    readonly adapterId?: string;
    readonly nowMs?: number;
  },
): RuntimeLockLease {
  return {
    lockPath,
    content,
    record,
    release: async () => {
      await withRuntimeLockMutationGuard(
        lockPath,
        {
          readText: io.readText,
          writeTextExclusive: io.writeTextExclusive,
          removeFile: io.removeFile,
          sleep: io.sleep,
          timeoutMs: io.timeoutMs,
          retryMs: io.retryMs,
          staleMs: io.staleMs,
          ...(io.pid !== undefined ? { pid: io.pid } : {}),
          ...(io.adapterId !== undefined ? { adapterId: io.adapterId } : {}),
          ...(io.nowMs !== undefined ? { nowMs: io.nowMs } : {}),
        },
        async () => {
          let currentContent: string;
          try {
            currentContent = await io.readText(lockPath);
          } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
              return;
            }
            throw error;
          }

          if (currentContent !== content) {
            throw new Error(
              "Runtime lock release refused because the lock content changed",
            );
          }

          await io.removeFile(lockPath);
        },
      );
    },
  };
}

async function withRuntimeLockMutationGuard<T>(
  lockPath: string,
  io: {
    readonly readText: RuntimeLockReadText;
    readonly writeTextExclusive: RuntimeLockWriteTextExclusive;
    readonly removeFile: RuntimeLockRemoveFile;
    readonly sleep: RuntimeLockSleep;
    readonly timeoutMs: number;
    readonly retryMs: number;
    readonly staleMs: number;
    readonly pid?: number;
    readonly adapterId?: string;
    readonly nowMs?: number;
  },
  callback: () => Promise<T>,
): Promise<T> {
  const guardPath = `${lockPath}${RUNTIME_LOCK_MUTATION_GUARD_SUFFIX}`;
  const startedAtMs = Date.now();

  while (true) {
    try {
      await io.writeTextExclusive(
        guardPath,
        buildRuntimeLockContent({
          ...(io.pid !== undefined ? { pid: io.pid } : {}),
          adapterId: `${io.adapterId ?? DEFAULT_RUNTIME_LOCK_ADAPTER_ID}.mutation`,
          ...(io.nowMs !== undefined ? { nowMs: io.nowMs } : {}),
        }),
      );
      break;
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }
      if (await cleanupStaleRuntimeLockMutationGuard(guardPath, io)) {
        continue;
      }
      if (Date.now() - startedAtMs >= io.timeoutMs) {
        throw new Error("Timed out acquiring runtime.lock mutation guard");
      }
      await io.sleep(io.retryMs);
    }
  }

  try {
    return await callback();
  } finally {
    await io.removeFile(guardPath);
  }
}

async function cleanupStaleRuntimeLockMutationGuard(
  guardPath: string,
  io: {
    readonly readText: RuntimeLockReadText;
    readonly removeFile: RuntimeLockRemoveFile;
    readonly staleMs: number;
    readonly nowMs?: number;
  },
): Promise<boolean> {
  let content: string;
  try {
    content = await io.readText(guardPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return true;
    }
    throw new Error(
      `Runtime lock mutation guard could not be read: ${errorName(error)}`,
    );
  }

  let record: RuntimeLockRecord;
  try {
    record = parseRuntimeLockContent(content);
  } catch (error) {
    throw new Error(
      `Runtime lock mutation guard is corrupt: ${error instanceof Error ? error.message : "invalid content"}`,
    );
  }

  const nowMs = io.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("Runtime lock mutation guard time must be finite");
  }

  const ageMs = Math.max(0, nowMs - record.acquiredAtMs);
  if (ageMs <= io.staleMs) {
    return false;
  }

  let latestContent: string;
  try {
    latestContent = await io.readText(guardPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return true;
    }
    throw error;
  }

  if (latestContent !== content) {
    return false;
  }

  await io.removeFile(guardPath);
  return true;
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

function normalizeRuntimeLockPid(pid: number): number {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Runtime lock pid must be a positive safe integer");
  }

  return pid;
}

function normalizeRuntimeLockAdapterId(adapterId: string): string {
  const normalized = adapterId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized)) {
    throw new Error(
      "Runtime lock adapter_id must be non-empty and contain only identifier characters",
    );
  }

  return normalized;
}

function formatUtcSecond(nowMs: number): string {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("Runtime lock timestamp must be finite");
  }

  return new Date(nowMs).toISOString().replace(/\.\d{3}Z$/u, "Z");
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

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

async function ensureRuntimeLockDirectory(
  directoryPath: string,
): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

async function readRuntimeLockText(lockPath: string): Promise<string> {
  return readFile(lockPath, "utf8");
}

async function writeRuntimeLockTextExclusive(
  lockPath: string,
  content: string,
): Promise<void> {
  await writeFile(lockPath, content, { encoding: "utf8", flag: "wx" });
}

async function removeRuntimeLockFile(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

async function sleepMs(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
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
