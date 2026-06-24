import {
  assertRuntimeRequestPath,
  buildRuntimeRequestHeaders,
  type RuntimeBridge,
  type RuntimeConnectionInfo,
  type RuntimeRequestPath,
} from "../preload/contract.js";

export const RUNTIME_STREAM_DEFAULT_RETRY_MS = 3000;
export const RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE =
  "SE_SSE_REPLAY_NOT_FOUND" as const;
export const RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE =
  "__cw_all_events__" as const;

export type RuntimeStreamDisplayLevel = "minimal" | "default" | "detailed";

export type RuntimeStreamCategory =
  | "lifecycle"
  | "model"
  | "tool"
  | "context"
  | "evidence"
  | "evaluation"
  | "repair"
  | "human"
  | "planning"
  | "artifact"
  | "metric"
  | "error"
  | "system";

export type RuntimeStreamChannel =
  | {
      readonly kind: "run";
      readonly runId: string;
    }
  | {
      readonly kind: "planning";
      readonly sessionId: string;
    };

export interface RuntimeStreamFilters {
  readonly level?:
    | RuntimeStreamDisplayLevel
    | readonly RuntimeStreamDisplayLevel[];
  readonly category?: RuntimeStreamCategory | readonly RuntimeStreamCategory[];
  readonly sinceSeq?: number;
  readonly untilSeq?: number;
}

export interface RuntimeStreamConnectionRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly withCredentials: false;
}

export interface RuntimeStreamSourceEvent {
  readonly type: string;
  readonly data?: unknown;
  readonly lastEventId?: string;
}

export type RuntimeStreamSourceListener = (
  event: RuntimeStreamSourceEvent,
) => void;

export interface RuntimeStreamEventSource {
  readonly addEventListener: (
    type: string,
    listener: RuntimeStreamSourceListener,
  ) => void;
  readonly removeEventListener: (
    type: string,
    listener: RuntimeStreamSourceListener,
  ) => void;
  readonly close: () => void;
}

export type RuntimeStreamEventSourceFactory = (
  request: RuntimeStreamConnectionRequest,
) => RuntimeStreamEventSource;

export interface RuntimeStreamEvent<TData = unknown> {
  readonly id: string | null;
  readonly type: string;
  readonly data: TData;
  readonly rawData: string;
}

export type RuntimeStreamEventListener<TData = unknown> = (
  event: RuntimeStreamEvent<TData>,
) => void;

export type RuntimeStreamErrorHandler = (error: unknown) => void;
export type RuntimeStreamUnsubscribe = () => boolean;

export interface RuntimeStreamClient {
  readonly request: RuntimeStreamConnectionRequest;
  readonly subscribe: <TData = unknown>(
    eventType: string,
    listener: RuntimeStreamEventListener<TData>,
  ) => RuntimeStreamUnsubscribe;
  readonly subscribeAll?: <TData = unknown>(
    listener: RuntimeStreamEventListener<TData>,
  ) => RuntimeStreamUnsubscribe;
  readonly close: () => boolean;
  readonly isClosed: () => boolean;
}

export interface OpenRuntimeStreamClientOptions {
  readonly runtime: Pick<RuntimeBridge, "connectionInfo">;
  readonly channel: RuntimeStreamChannel;
  readonly eventSourceFactory: RuntimeStreamEventSourceFactory;
  readonly filters?: RuntimeStreamFilters;
  readonly projectId?: string;
  readonly lastEventId?: string;
  readonly onEventError?: RuntimeStreamErrorHandler;
  readonly onConnectionError?: RuntimeStreamErrorHandler;
}

export type RuntimeStreamReplayMode =
  | "ready"
  | "reconnect_pending"
  | "full_reload_required";

export interface RuntimeStreamReplayStateSnapshot {
  readonly mode: RuntimeStreamReplayMode;
  readonly lastEventId: string | null;
  readonly reconnectAttempt: number;
  readonly retryAfterMs?: number;
  readonly reason?: string;
}

export interface RuntimeStreamConnectionFailure {
  readonly status?: number;
  readonly errorCode?: string;
  readonly retryAfterMs?: number;
  readonly reason?: string;
}

export interface RuntimeStreamReconnectDecision {
  readonly action: "reconnect";
  readonly lastEventId: string | null;
  readonly attempt: number;
  readonly retryAfterMs: number;
}

export interface RuntimeStreamFullReloadDecision {
  readonly action: "full_reload";
  readonly lastEventId: string | null;
  readonly reason: string;
  readonly status?: number;
  readonly errorCode?: string;
}

export type RuntimeStreamReplayDecision =
  | RuntimeStreamReconnectDecision
  | RuntimeStreamFullReloadDecision;

export interface RuntimeStreamReplayState {
  readonly snapshot: () => RuntimeStreamReplayStateSnapshot;
  readonly recordEvent: (
    event: Pick<RuntimeStreamEvent, "id">,
  ) => RuntimeStreamReplayStateSnapshot;
  readonly handleConnectionFailure: (
    failure: RuntimeStreamConnectionFailure,
  ) => RuntimeStreamReplayDecision;
  readonly reset: (
    lastEventId?: string | null,
  ) => RuntimeStreamReplayStateSnapshot;
}

export interface CreateRuntimeStreamReplayStateOptions {
  readonly initialLastEventId?: string | null;
  readonly defaultRetryMs?: number;
}

export interface RuntimeStreamReconnectTimer {
  readonly cancel: () => boolean;
}

export type RuntimeStreamReconnectScheduler = (
  delayMs: number,
  reconnect: () => void,
) => RuntimeStreamReconnectTimer;

export interface RuntimeStreamReconnectingClient {
  readonly subscribe: <TData = unknown>(
    eventType: string,
    listener: RuntimeStreamEventListener<TData>,
  ) => RuntimeStreamUnsubscribe;
  readonly subscribeAll?: <TData = unknown>(
    listener: RuntimeStreamEventListener<TData>,
  ) => RuntimeStreamUnsubscribe;
  readonly close: () => boolean;
  readonly isClosed: () => boolean;
  readonly activeRequest: () => RuntimeStreamConnectionRequest | null;
  readonly replaySnapshot: () => RuntimeStreamReplayStateSnapshot;
}

export interface OpenRuntimeStreamReconnectingClientOptions {
  readonly runtime: Pick<RuntimeBridge, "connectionInfo">;
  readonly channel: RuntimeStreamChannel;
  readonly eventSourceFactory: RuntimeStreamEventSourceFactory;
  readonly filters?: RuntimeStreamFilters;
  readonly projectId?: string;
  readonly replayState?: RuntimeStreamReplayState;
  readonly scheduler?: RuntimeStreamReconnectScheduler;
  readonly onEventError?: RuntimeStreamErrorHandler;
  readonly onConnectionError?: RuntimeStreamErrorHandler;
  readonly onReplayDecision?: (decision: RuntimeStreamReplayDecision) => void;
  readonly onFullReloadRequired?: (
    decision: RuntimeStreamFullReloadDecision,
  ) => void;
}

interface RuntimeStreamManagedSubscription {
  readonly eventType: string | null;
  readonly listener: RuntimeStreamEventListener<unknown>;
  activeUnsubscribe: RuntimeStreamUnsubscribe | null;
  subscribed: boolean;
}

export async function openRuntimeStreamClient(
  options: OpenRuntimeStreamClientOptions,
): Promise<RuntimeStreamClient> {
  const connectionInfo = await options.runtime.connectionInfo();
  const requestOptions: {
    channel: RuntimeStreamChannel;
    filters?: RuntimeStreamFilters;
    projectId?: string;
    lastEventId?: string;
  } = {
    channel: options.channel,
  };
  if (options.filters !== undefined) {
    requestOptions.filters = options.filters;
  }
  if (options.projectId !== undefined) {
    requestOptions.projectId = options.projectId;
  }
  if (options.lastEventId !== undefined) {
    requestOptions.lastEventId = options.lastEventId;
  }
  const request = buildRuntimeStreamConnectionRequest(
    connectionInfo,
    requestOptions,
  );
  const eventSource = options.eventSourceFactory(request);
  const subscriptions: Array<{
    readonly eventType: string;
    readonly listener: RuntimeStreamSourceListener;
  }> = [];
  let closed = false;

  const reportEventError = (error: unknown): void => {
    try {
      options.onEventError?.(error);
    } catch {
      // Renderer diagnostics must not break stream event dispatch.
    }
  };

  const reportConnectionError = (error: unknown): void => {
    try {
      options.onConnectionError?.(error);
    } catch {
      // Renderer diagnostics must not break EventSource lifecycle handling.
    }
  };

  const connectionErrorListener: RuntimeStreamSourceListener | undefined =
    options.onConnectionError === undefined
      ? undefined
      : (event) => {
          reportConnectionError(event);
        };

  if (connectionErrorListener !== undefined) {
    eventSource.addEventListener("error", connectionErrorListener);
    subscriptions.push({
      eventType: "error",
      listener: connectionErrorListener,
    });
  }

  return {
    request,
    subscribe: <TData>(
      eventType: string,
      listener: RuntimeStreamEventListener<TData>,
    ) => {
      assertRuntimeStreamEventType(eventType);
      if (closed) {
        return () => false;
      }
      const sourceListener: RuntimeStreamSourceListener = (event) => {
        try {
          listener(parseRuntimeStreamEvent<TData>(eventType, event));
        } catch (error) {
          reportEventError(error);
        }
      };
      eventSource.addEventListener(eventType, sourceListener);
      subscriptions.push({ eventType, listener: sourceListener });
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        eventSource.removeEventListener(eventType, sourceListener);
        return true;
      };
    },
    subscribeAll: <TData>(listener: RuntimeStreamEventListener<TData>) => {
      if (closed) {
        return () => false;
      }
      const sourceListener: RuntimeStreamSourceListener = (event) => {
        try {
          listener(parseRuntimeStreamEvent<TData>(event.type, event));
        } catch (error) {
          reportEventError(error);
        }
      };
      eventSource.addEventListener(
        RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE,
        sourceListener,
      );
      subscriptions.push({
        eventType: RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE,
        listener: sourceListener,
      });
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return false;
        }
        subscribed = false;
        eventSource.removeEventListener(
          RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE,
          sourceListener,
        );
        return true;
      };
    },
    close: () => {
      if (closed) {
        return false;
      }
      closed = true;
      for (const subscription of subscriptions.splice(0)) {
        eventSource.removeEventListener(
          subscription.eventType,
          subscription.listener,
        );
      }
      eventSource.close();
      return true;
    },
    isClosed: () => closed,
  };
}

export async function openRuntimeStreamReconnectingClient(
  options: OpenRuntimeStreamReconnectingClientOptions,
): Promise<RuntimeStreamReconnectingClient> {
  const replayState = options.replayState ?? createRuntimeStreamReplayState();
  const scheduler = options.scheduler ?? createRuntimeStreamTimeoutScheduler();
  const subscriptions: RuntimeStreamManagedSubscription[] = [];
  let activeClient: RuntimeStreamClient | null = null;
  let pendingReconnect: RuntimeStreamReconnectTimer | null = null;
  let closed = false;

  const reportEventError = (error: unknown): void => {
    try {
      options.onEventError?.(error);
    } catch {
      // Renderer diagnostics must not break managed stream dispatch.
    }
  };

  const reportConnectionError = (error: unknown): void => {
    try {
      options.onConnectionError?.(error);
    } catch {
      // Renderer diagnostics must not break managed stream reconnect handling.
    }
  };

  const reportReplayDecision = (
    decision: RuntimeStreamReplayDecision,
  ): void => {
    try {
      options.onReplayDecision?.(decision);
    } catch {
      // Renderer diagnostics must not break replay-state handling.
    }
  };

  const reportFullReloadRequired = (
    decision: RuntimeStreamFullReloadDecision,
  ): void => {
    try {
      options.onFullReloadRequired?.(decision);
    } catch (error) {
      reportEventError(error);
    }
  };

  const closeActiveClient = (): void => {
    for (const subscription of subscriptions) {
      subscription.activeUnsubscribe = null;
    }
    activeClient?.close();
    activeClient = null;
  };

  const clearManagedSubscriptions = (): void => {
    for (const subscription of subscriptions.splice(0)) {
      subscription.subscribed = false;
      subscription.activeUnsubscribe = null;
    }
  };

  const attachSubscription = (
    client: RuntimeStreamClient,
    subscription: RuntimeStreamManagedSubscription,
  ): void => {
    if (!subscription.subscribed) {
      return;
    }
    const handleEvent: RuntimeStreamEventListener<unknown> = (event) => {
      replayState.recordEvent(event);
      subscription.listener(event);
    };
    subscription.activeUnsubscribe =
      subscription.eventType === null
        ? (client.subscribeAll?.(handleEvent) ?? (() => false))
        : client.subscribe(subscription.eventType, handleEvent);
  };

  const subscribeManaged = <TData>(
    eventType: string | null,
    listener: RuntimeStreamEventListener<TData>,
  ): RuntimeStreamUnsubscribe => {
    if (closed) {
      return () => false;
    }

    const subscription: RuntimeStreamManagedSubscription = {
      eventType,
      listener: listener as RuntimeStreamEventListener<unknown>,
      activeUnsubscribe: null,
      subscribed: true,
    };
    subscriptions.push(subscription);

    if (activeClient !== null) {
      attachSubscription(activeClient, subscription);
    }

    return () => {
      if (!subscription.subscribed) {
        return false;
      }
      subscription.subscribed = false;
      subscription.activeUnsubscribe?.();
      subscription.activeUnsubscribe = null;
      const index = subscriptions.indexOf(subscription);
      if (index >= 0) {
        subscriptions.splice(index, 1);
      }
      return true;
    };
  };

  const connect = async (lastEventId: string | null): Promise<void> => {
    if (closed) {
      return;
    }

    closeActiveClient();
    const clientOptions = buildRuntimeStreamClientOptions(options, {
      lastEventId,
      onEventError: reportEventError,
      onConnectionError: (error) => {
        reportConnectionError(error);
        handleConnectionFailure(error);
      },
    });
    const client = await openRuntimeStreamClient(clientOptions);

    if (closed) {
      client.close();
      return;
    }

    activeClient = client;
    for (const subscription of subscriptions) {
      attachSubscription(client, subscription);
    }
  };

  const scheduleReconnect = (
    decision: RuntimeStreamReconnectDecision,
  ): void => {
    if (closed || pendingReconnect !== null) {
      return;
    }
    pendingReconnect = scheduler(decision.retryAfterMs, () => {
      pendingReconnect = null;
      void connect(decision.lastEventId).catch((error: unknown) => {
        if (closed) {
          return;
        }
        reportConnectionError(error);
        handleConnectionFailure(error);
      });
    });
  };

  const handleConnectionFailure = (error: unknown): void => {
    if (closed) {
      return;
    }

    closeActiveClient();
    const decision = replayState.handleConnectionFailure(
      normalizeRuntimeStreamConnectionFailure(error),
    );
    reportReplayDecision(decision);

    if (decision.action === "full_reload") {
      closed = true;
      pendingReconnect?.cancel();
      pendingReconnect = null;
      clearManagedSubscriptions();
      reportFullReloadRequired(decision);
      return;
    }

    scheduleReconnect(decision);
  };

  await connect(replayState.snapshot().lastEventId);

  return {
    subscribe: <TData>(
      eventType: string,
      listener: RuntimeStreamEventListener<TData>,
    ) => {
      assertRuntimeStreamEventType(eventType);
      if (closed) {
        return () => false;
      }

      return subscribeManaged(eventType, listener);
    },
    subscribeAll: <TData>(listener: RuntimeStreamEventListener<TData>) =>
      subscribeManaged(null, listener),
    close: () => {
      if (closed) {
        return false;
      }
      closed = true;
      pendingReconnect?.cancel();
      pendingReconnect = null;
      closeActiveClient();
      clearManagedSubscriptions();
      return true;
    },
    isClosed: () => closed,
    activeRequest: () => activeClient?.request ?? null,
    replaySnapshot: () => replayState.snapshot(),
  };
}

export function createRuntimeStreamReplayState(
  options: CreateRuntimeStreamReplayStateOptions = {},
): RuntimeStreamReplayState {
  const defaultRetryMs = normalizeRuntimeStreamRetryMs(
    "defaultRetryMs",
    options.defaultRetryMs ?? RUNTIME_STREAM_DEFAULT_RETRY_MS,
  );
  let mode: RuntimeStreamReplayMode = "ready";
  let lastEventId = normalizeRuntimeStreamLastEventId(
    options.initialLastEventId,
  );
  let reconnectAttempt = 0;
  let retryAfterMs: number | undefined;
  let reason: string | undefined;

  const snapshot = (): RuntimeStreamReplayStateSnapshot => {
    const input: {
      mode: RuntimeStreamReplayMode;
      lastEventId: string | null;
      reconnectAttempt: number;
      retryAfterMs?: number;
      reason?: string;
    } = {
      mode,
      lastEventId,
      reconnectAttempt,
    };
    if (retryAfterMs !== undefined) {
      input.retryAfterMs = retryAfterMs;
    }
    if (reason !== undefined) {
      input.reason = reason;
    }
    return buildRuntimeStreamReplayStateSnapshot(input);
  };

  return {
    snapshot,
    recordEvent: (event) => {
      if (event.id !== null) {
        lastEventId = requireSafeRuntimeStreamLastEventId(event.id);
      }
      mode = "ready";
      reconnectAttempt = 0;
      retryAfterMs = undefined;
      reason = undefined;
      return snapshot();
    },
    handleConnectionFailure: (failure) => {
      if (isRuntimeStreamReplayNotFoundFailure(failure)) {
        mode = "full_reload_required";
        retryAfterMs = undefined;
        reason = failure.reason ?? "Runtime stream replay point was not found";
        return buildRuntimeStreamFullReloadDecision(failure, {
          lastEventId,
          reason,
        });
      }

      reconnectAttempt += 1;
      mode = "reconnect_pending";
      retryAfterMs =
        failure.retryAfterMs === undefined
          ? defaultRetryMs
          : normalizeRuntimeStreamRetryMs("retryAfterMs", failure.retryAfterMs);
      reason = failure.reason;
      return {
        action: "reconnect",
        lastEventId,
        attempt: reconnectAttempt,
        retryAfterMs,
      };
    },
    reset: (nextLastEventId = null) => {
      lastEventId = normalizeRuntimeStreamLastEventId(nextLastEventId);
      mode = "ready";
      reconnectAttempt = 0;
      retryAfterMs = undefined;
      reason = undefined;
      return snapshot();
    },
  };
}

export function isRuntimeStreamReplayNotFoundFailure(
  failure: RuntimeStreamConnectionFailure,
): boolean {
  return (
    failure.status === 412 ||
    failure.errorCode === RUNTIME_STREAM_REPLAY_NOT_FOUND_CODE
  );
}

export function createRuntimeStreamTimeoutScheduler(): RuntimeStreamReconnectScheduler {
  return (delayMs, reconnect) => {
    normalizeRuntimeStreamRetryMs("retry delay", delayMs);
    let active = true;
    const timer = globalThis.setTimeout(() => {
      if (!active) {
        return;
      }
      active = false;
      reconnect();
    }, delayMs);
    return {
      cancel: () => {
        if (!active) {
          return false;
        }
        active = false;
        globalThis.clearTimeout(timer);
        return true;
      },
    };
  };
}

export function buildRuntimeStreamConnectionRequest(
  connectionInfo: RuntimeConnectionInfo,
  options: {
    readonly channel: RuntimeStreamChannel;
    readonly filters?: RuntimeStreamFilters;
    readonly projectId?: string;
    readonly lastEventId?: string;
  },
): RuntimeStreamConnectionRequest {
  const path = buildRuntimeStreamPath(options.channel, options.filters);
  return {
    url: buildRuntimeStreamUrl(connectionInfo.base_url, path),
    headers: buildRuntimeRequestHeaders({
      token: connectionInfo.token,
      ...(options.projectId !== undefined
        ? { projectId: options.projectId }
        : {}),
      extraHeaders: {
        Accept: "text/event-stream",
        ...(options.lastEventId !== undefined
          ? { "Last-Event-ID": options.lastEventId }
          : {}),
      },
    }),
    withCredentials: false,
  };
}

export function buildRuntimeStreamPath(
  channel: RuntimeStreamChannel,
  filters: RuntimeStreamFilters = {},
): RuntimeRequestPath {
  const path =
    channel.kind === "run"
      ? `/runs/${encodeRuntimeStreamPathSegment(channel.runId)}/stream`
      : `/workflow-planning/sessions/${encodeRuntimeStreamPathSegment(
          channel.sessionId,
        )}/stream`;
  const query = buildRuntimeStreamQuery(channel.kind, filters);
  const requestPath = query.length === 0 ? path : `${path}?${query}`;
  assertRuntimeRequestPath(requestPath);
  return requestPath as RuntimeRequestPath;
}

function buildRuntimeStreamUrl(
  baseUrl: string,
  path: RuntimeRequestPath,
): string {
  const base = parseRuntimeStreamBaseUrl(baseUrl);
  const basePath = base.pathname.endsWith("/")
    ? base.pathname.slice(0, -1)
    : base.pathname;
  return new URL(`${basePath}${path}`, base.origin).toString();
}

function buildRuntimeStreamQuery(
  channelKind: RuntimeStreamChannel["kind"],
  filters: RuntimeStreamFilters,
): string {
  assertRuntimeStreamSeqRange(filters);
  const query = new URLSearchParams();
  const levels = normalizeFilterValues(filters.level);
  const categories = normalizeFilterValues(filters.category);

  if (levels.length > 0) {
    query.set("level", levels.join(","));
  }

  if (categories.length > 0) {
    for (const category of categories) {
      assertRuntimeStreamCategory(channelKind, category);
    }
    query.set("category", categories.join(","));
  }

  if (filters.sinceSeq !== undefined) {
    query.set("since_seq", String(filters.sinceSeq));
  }

  if (filters.untilSeq !== undefined) {
    query.set("until_seq", String(filters.untilSeq));
  }

  return query.toString();
}

function parseRuntimeStreamEvent<TData>(
  expectedEventType: string,
  event: RuntimeStreamSourceEvent,
): RuntimeStreamEvent<TData> {
  if (typeof event.data !== "string") {
    throw new Error("Runtime stream event data must be a string");
  }

  const data = JSON.parse(event.data) as unknown;
  if (isRecord(data)) {
    const dataType = data.type;
    if (typeof dataType === "string" && dataType !== expectedEventType) {
      throw new Error(
        `Runtime stream event type mismatch: expected ${expectedEventType}, received ${dataType}`,
      );
    }
  }

  return {
    id: parseRuntimeStreamEventId(data, event),
    type: expectedEventType,
    data: data as TData,
    rawData: event.data,
  };
}

function parseRuntimeStreamEventId(
  data: unknown,
  event: RuntimeStreamSourceEvent,
): string | null {
  if (isRecord(data) && typeof data.event_id === "string") {
    return data.event_id;
  }
  if (typeof event.lastEventId === "string" && event.lastEventId.length > 0) {
    return event.lastEventId;
  }
  return null;
}

function buildRuntimeStreamReplayStateSnapshot(input: {
  readonly mode: RuntimeStreamReplayMode;
  readonly lastEventId: string | null;
  readonly reconnectAttempt: number;
  readonly retryAfterMs?: number;
  readonly reason?: string;
}): RuntimeStreamReplayStateSnapshot {
  return {
    mode: input.mode,
    lastEventId: input.lastEventId,
    reconnectAttempt: input.reconnectAttempt,
    ...(input.retryAfterMs !== undefined
      ? { retryAfterMs: input.retryAfterMs }
      : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
}

function buildRuntimeStreamFullReloadDecision(
  failure: RuntimeStreamConnectionFailure,
  input: {
    readonly lastEventId: string | null;
    readonly reason: string;
  },
): RuntimeStreamFullReloadDecision {
  return {
    action: "full_reload",
    lastEventId: input.lastEventId,
    reason: input.reason,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    ...(failure.errorCode !== undefined
      ? { errorCode: failure.errorCode }
      : {}),
  };
}

function buildRuntimeStreamClientOptions(
  baseOptions: OpenRuntimeStreamReconnectingClientOptions,
  input: {
    readonly lastEventId: string | null;
    readonly onEventError: RuntimeStreamErrorHandler;
    readonly onConnectionError: RuntimeStreamErrorHandler;
  },
): OpenRuntimeStreamClientOptions {
  return {
    runtime: baseOptions.runtime,
    channel: baseOptions.channel,
    eventSourceFactory: baseOptions.eventSourceFactory,
    ...(baseOptions.filters !== undefined
      ? { filters: baseOptions.filters }
      : {}),
    ...(baseOptions.projectId !== undefined
      ? { projectId: baseOptions.projectId }
      : {}),
    ...(input.lastEventId !== null ? { lastEventId: input.lastEventId } : {}),
    onEventError: input.onEventError,
    onConnectionError: input.onConnectionError,
  };
}

function normalizeRuntimeStreamConnectionFailure(
  error: unknown,
): RuntimeStreamConnectionFailure {
  const candidates: unknown[] = [];
  if (isRecord(error)) {
    candidates.push(error.data);
  }
  candidates.push(error);

  for (const candidate of candidates) {
    const parsed = parseRuntimeStreamConnectionFailureCandidate(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return {};
}

function parseRuntimeStreamConnectionFailureCandidate(
  candidate: unknown,
): RuntimeStreamConnectionFailure | null {
  if (typeof candidate === "string") {
    try {
      return parseRuntimeStreamConnectionFailureCandidate(
        JSON.parse(candidate) as unknown,
      );
    } catch {
      return { reason: candidate };
    }
  }

  if (!isRecord(candidate)) {
    return null;
  }

  const failure: {
    status?: number;
    errorCode?: string;
    retryAfterMs?: number;
    reason?: string;
  } = {};

  const status = candidate.status;
  if (typeof status === "number" && Number.isSafeInteger(status)) {
    failure.status = status;
  }

  const errorCode = candidate.errorCode ?? candidate.error_code;
  if (typeof errorCode === "string" && errorCode.length > 0) {
    failure.errorCode = errorCode;
  }

  const retryAfterMs = candidate.retryAfterMs ?? candidate.retry_after_ms;
  if (typeof retryAfterMs === "number") {
    failure.retryAfterMs = retryAfterMs;
  }

  const reason = candidate.reason ?? candidate.message;
  if (typeof reason === "string" && reason.length > 0) {
    failure.reason = reason;
  }

  return failure;
}

function parseRuntimeStreamBaseUrl(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Runtime stream base_url must be a valid URL");
  }

  const path = parsed.pathname.endsWith("/")
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname;
  const port = Number.parseInt(parsed.port, 10);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    path !== "/cw/v1" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "Runtime stream base_url must be http://127.0.0.1:<port>/cw/v1",
    );
  }

  return parsed;
}

function encodeRuntimeStreamPathSegment(value: string): string {
  if (
    value.length === 0 ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("..") ||
    /[\u0000-\u001f\u007f\s]/u.test(value)
  ) {
    throw new Error(`Runtime stream path segment is invalid: ${value}`);
  }
  return encodeURIComponent(value);
}

function assertRuntimeStreamEventType(eventType: string): void {
  if (!/^[a-z]+(?:\.[a-z0-9_]+)+$/u.test(eventType)) {
    throw new Error(`Runtime stream event type is invalid: ${eventType}`);
  }
}

function normalizeRuntimeStreamLastEventId(
  eventId: string | null | undefined,
): string | null {
  if (eventId === undefined || eventId === null) {
    return null;
  }
  return requireSafeRuntimeStreamLastEventId(eventId);
}

function requireSafeRuntimeStreamLastEventId(eventId: string): string {
  if (eventId.length === 0 || /[\u0000-\u001f\u007f\s]/u.test(eventId)) {
    throw new Error(
      "Runtime stream Last-Event-ID must be non-empty and contain no whitespace or control characters",
    );
  }
  return eventId;
}

function normalizeRuntimeStreamRetryMs(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Runtime stream ${label} must be a non-negative integer`);
  }
  return value;
}

function assertRuntimeStreamSeqRange(filters: RuntimeStreamFilters): void {
  if (filters.sinceSeq !== undefined) {
    assertRuntimeStreamSeq("since_seq", filters.sinceSeq);
  }
  if (filters.untilSeq !== undefined) {
    assertRuntimeStreamSeq("until_seq", filters.untilSeq);
  }
  if (
    filters.sinceSeq !== undefined &&
    filters.untilSeq !== undefined &&
    filters.untilSeq < filters.sinceSeq
  ) {
    throw new Error("Runtime stream until_seq must be >= since_seq");
  }
}

function assertRuntimeStreamSeq(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Runtime stream ${label} must be a non-negative integer`);
  }
}

function assertRuntimeStreamCategory(
  channelKind: RuntimeStreamChannel["kind"],
  category: RuntimeStreamCategory,
): void {
  if (channelKind === "run" && category === "planning") {
    throw new Error("Runtime run stream cannot request planning category");
  }
  if (
    channelKind === "planning" &&
    category !== "planning" &&
    category !== "system"
  ) {
    throw new Error(
      `Runtime planning stream cannot request ${category} category`,
    );
  }
}

function normalizeFilterValues<TValue>(
  value: TValue | readonly TValue[] | undefined,
): TValue[] {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return Array.from(value as readonly TValue[]);
  }
  return [value as TValue];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
