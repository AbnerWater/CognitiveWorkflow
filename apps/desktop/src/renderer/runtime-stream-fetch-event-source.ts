import {
  RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE,
  type RuntimeStreamConnectionRequest,
  type RuntimeStreamEventSource,
  type RuntimeStreamEventSourceFactory,
  type RuntimeStreamSourceListener,
} from "./runtime-stream-client.js";

const RUNTIME_STREAM_EVENT_SOURCE_ERROR_TYPE = "error";

export interface CreateRuntimeFetchEventSourceFactoryOptions {
  readonly fetchImpl?: typeof fetch;
}

interface RuntimeFetchEventSourceMessage {
  readonly type: string;
  readonly data: string;
  readonly lastEventId?: string;
}

export function createRuntimeFetchEventSourceFactory(
  options: CreateRuntimeFetchEventSourceFactoryOptions = {},
): RuntimeStreamEventSourceFactory {
  return (request) => createRuntimeFetchEventSource(request, options);
}

export function createRuntimeFetchEventSource(
  request: RuntimeStreamConnectionRequest,
  options: CreateRuntimeFetchEventSourceFactoryOptions = {},
): RuntimeStreamEventSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error("Runtime stream fetch implementation is unavailable");
  }

  const listeners = new Map<string, Set<RuntimeStreamSourceListener>>();
  const abortController = new AbortController();
  let closed = false;

  const emit = (event: RuntimeFetchEventSourceMessage): void => {
    if (closed) {
      return;
    }
    for (const listener of listeners.get(event.type) ?? []) {
      listener(event);
    }
    if (
      event.type === RUNTIME_STREAM_EVENT_SOURCE_ERROR_TYPE ||
      event.type === RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE
    ) {
      return;
    }
    for (const listener of listeners.get(
      RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE,
    ) ?? []) {
      listener(event);
    }
  };

  const emitError = (data: unknown): void => {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    emit({ type: "error", data: payload });
  };

  void runRuntimeFetchEventSource({
    request,
    fetchImpl,
    signal: abortController.signal,
    emit,
    emitError,
    isClosed: () => closed,
  }).catch((error: unknown) => {
    if (closed || isAbortError(error)) {
      return;
    }
    emitError(normalizeRuntimeFetchEventSourceError(error));
  });

  return {
    addEventListener: (type, listener) => {
      if (closed) {
        return;
      }
      const eventListeners = listeners.get(type) ?? new Set();
      eventListeners.add(listener);
      listeners.set(type, eventListeners);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      listeners.clear();
      abortController.abort();
    },
  };
}

async function runRuntimeFetchEventSource(options: {
  readonly request: RuntimeStreamConnectionRequest;
  readonly fetchImpl: typeof fetch;
  readonly signal: AbortSignal;
  readonly emit: (event: RuntimeFetchEventSourceMessage) => void;
  readonly emitError: (data: unknown) => void;
  readonly isClosed: () => boolean;
}): Promise<void> {
  const response = await options.fetchImpl(options.request.url, {
    headers: options.request.headers,
    method: "GET",
    signal: options.signal,
    credentials: options.request.withCredentials ? "include" : "omit",
  });

  if (!response.ok) {
    options.emitError(await readRuntimeFetchEventSourceFailure(response));
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    options.emitError({
      status: response.status,
      reason: "Runtime stream response was not text/event-stream",
    });
    return;
  }

  if (response.body === null) {
    options.emitError({
      status: response.status,
      reason: "Runtime stream response body is unavailable",
    });
    return;
  }

  await readRuntimeFetchEventSourceBody(response.body, {
    emit: options.emit,
    emitError: options.emitError,
    isClosed: options.isClosed,
  });
}

async function readRuntimeFetchEventSourceBody(
  body: ReadableStream<Uint8Array>,
  options: {
    readonly emit: (event: RuntimeFetchEventSourceMessage) => void;
    readonly emitError: (data: unknown) => void;
    readonly isClosed: () => boolean;
  },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let endedByEof = false;

  try {
    while (!options.isClosed()) {
      const result = await reader.read();
      if (result.done) {
        endedByEof = true;
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      buffer = drainRuntimeFetchEventSourceBuffer(buffer, options.emit);
    }

    buffer += decoder.decode();
    drainRuntimeFetchEventSourceBuffer(`${buffer}\n\n`, options.emit);
    if (endedByEof && !options.isClosed()) {
      options.emitError({ reason: "Runtime stream connection closed" });
    }
  } finally {
    reader.releaseLock();
  }
}

function drainRuntimeFetchEventSourceBuffer(
  input: string,
  emit: (event: RuntimeFetchEventSourceMessage) => void,
): string {
  let buffer = input.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  let separatorIndex = buffer.indexOf("\n\n");
  while (separatorIndex >= 0) {
    const block = buffer.slice(0, separatorIndex);
    buffer = buffer.slice(separatorIndex + 2);
    const message = parseRuntimeFetchEventSourceMessage(block);
    if (message !== null) {
      emit(message);
    }
    separatorIndex = buffer.indexOf("\n\n");
  }
  return buffer;
}

function parseRuntimeFetchEventSourceMessage(
  block: string,
): RuntimeFetchEventSourceMessage | null {
  if (block.length === 0) {
    return null;
  }

  let type = "message";
  let lastEventId: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex < 0 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex < 0 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    switch (field) {
      case "event":
        type = value.length === 0 ? "message" : value;
        break;
      case "data":
        dataLines.push(value);
        break;
      case "id":
        lastEventId = value;
        break;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    type,
    data: dataLines.join("\n"),
    ...(lastEventId !== undefined ? { lastEventId } : {}),
  };
}

async function readRuntimeFetchEventSourceFailure(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = parseRuntimeFetchEventSourceFailureBody(text);
  return {
    status: response.status,
    ...(body.errorCode !== undefined ? { errorCode: body.errorCode } : {}),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
  };
}

function parseRuntimeFetchEventSourceFailureBody(text: string): {
  readonly errorCode?: string;
  readonly reason?: string;
} {
  if (text.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return { reason: text };
    }
    const errorCode = parsed.errorCode ?? parsed.error_code ?? parsed.code;
    const reason = parsed.reason ?? parsed.message ?? parsed.detail;
    return {
      ...(typeof errorCode === "string" && errorCode.length > 0
        ? { errorCode }
        : {}),
      ...(typeof reason === "string" && reason.length > 0 ? { reason } : {}),
    };
  } catch {
    return { reason: text };
  }
}

function normalizeRuntimeFetchEventSourceError(
  error: unknown,
): Record<string, unknown> {
  return {
    reason: error instanceof Error ? error.message : "Runtime stream failed",
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
