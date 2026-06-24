import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimeFetchEventSource,
  createRuntimeFetchEventSourceFactory,
} from "./runtime-stream-fetch-event-source.js";
import {
  RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE,
  type RuntimeStreamConnectionRequest,
  type RuntimeStreamSourceEvent,
} from "./runtime-stream-client.js";

test("fetch-backed runtime stream source forwards headers and dispatches SSE events", async () => {
  let requestUrl: string | undefined;
  let requestHeaders: Headers | undefined;
  let requestSignal: AbortSignal | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestSignal = init?.signal ?? undefined;
    return new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          streamController = controller;
        },
      }),
      {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        status: 200,
      },
    );
  };
  const events: RuntimeStreamSourceEvent[] = [];
  const allEvents: RuntimeStreamSourceEvent[] = [];
  const source = createRuntimeFetchEventSourceFactory({ fetchImpl })(
    createRuntimeFetchEventSourceRequest(),
  );
  source.addEventListener("model.text_delta", (event) => {
    events.push(event);
  });
  source.addEventListener(RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE, (event) => {
    allEvents.push(event);
  });

  await waitFor(() => streamController !== undefined);
  streamController?.enqueue(
    encodeSse(
      [
        "id: evt_1",
        "event: model.text_delta",
        'data: {"type":"model.text_delta","seq":1}',
      ].join("\n"),
    ),
  );
  await waitFor(() => events.length === 1 && allEvents.length === 1);
  streamController?.enqueue(
    encodeSse(
      [
        "id: evt_unknown",
        "event: adapter.experimental_event",
        'data: {"type":"adapter.experimental_event","seq":2}',
      ].join("\n"),
    ),
  );
  await waitFor(() => allEvents.length === 2);

  assert.equal(requestUrl, "http://127.0.0.1:48123/cw/v1/runs/run_1/stream");
  assert.equal(requestHeaders?.get("authorization"), "Bearer test-token");
  assert.equal(requestHeaders?.get("accept"), "text/event-stream");
  assert.equal(requestSignal?.aborted, false);
  assert.deepEqual(events, [
    {
      type: "model.text_delta",
      data: '{"type":"model.text_delta","seq":1}',
      lastEventId: "evt_1",
    },
  ]);
  assert.deepEqual(allEvents, [
    {
      type: "model.text_delta",
      data: '{"type":"model.text_delta","seq":1}',
      lastEventId: "evt_1",
    },
    {
      type: "adapter.experimental_event",
      data: '{"type":"adapter.experimental_event","seq":2}',
      lastEventId: "evt_unknown",
    },
  ]);

  source.close();
  assert.equal(requestSignal?.aborted, true);
});

test("fetch-backed runtime stream source maps replay failures to error events", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error_code: "SE_SSE_REPLAY_NOT_FOUND",
        message: "Replay point not found",
      }),
      { status: 412, headers: { "content-type": "application/json" } },
    );
  const errors: RuntimeStreamSourceEvent[] = [];
  const allEvents: RuntimeStreamSourceEvent[] = [];
  const source = createRuntimeFetchEventSource(
    createRuntimeFetchEventSourceRequest(),
    { fetchImpl },
  );
  source.addEventListener("error", (event) => {
    errors.push(event);
  });
  source.addEventListener(RUNTIME_STREAM_ALL_EVENT_SOURCE_TYPE, (event) => {
    allEvents.push(event);
  });

  await waitFor(() => errors.length === 1);

  assert.deepEqual(JSON.parse(String(errors[0]?.data)), {
    status: 412,
    errorCode: "SE_SSE_REPLAY_NOT_FOUND",
    reason: "Replay point not found",
  });
  assert.deepEqual(allEvents, []);
});

test("fetch-backed runtime stream source emits an error when the SSE body ends", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          streamController = controller;
        },
      }),
      {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      },
    );
  const events: RuntimeStreamSourceEvent[] = [];
  const errors: RuntimeStreamSourceEvent[] = [];
  const source = createRuntimeFetchEventSource(
    createRuntimeFetchEventSourceRequest(),
    { fetchImpl },
  );
  source.addEventListener("system.heartbeat", (event) => {
    events.push(event);
  });
  source.addEventListener("error", (event) => {
    errors.push(event);
  });

  await waitFor(() => streamController !== undefined);
  streamController?.enqueue(
    encodeSse(
      ["event: system.heartbeat", 'data: {"type":"system.heartbeat"}'].join(
        "\n",
      ),
    ),
  );
  streamController?.close();
  await waitFor(() => errors.length === 1);

  assert.equal(events.length, 1);
  assert.deepEqual(JSON.parse(String(errors[0]?.data)), {
    reason: "Runtime stream connection closed",
  });
  source.close();
});

test("fetch-backed runtime stream source ignores events after close", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          streamController = controller;
        },
      }),
      {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      },
    );
  const events: RuntimeStreamSourceEvent[] = [];
  const source = createRuntimeFetchEventSource(
    createRuntimeFetchEventSourceRequest(),
    { fetchImpl },
  );
  source.addEventListener("system.heartbeat", (event) => {
    events.push(event);
  });

  await waitFor(() => streamController !== undefined);
  source.close();
  streamController?.enqueue(
    encodeSse(
      ["event: system.heartbeat", 'data: {"type":"system.heartbeat"}'].join(
        "\n",
      ),
    ),
  );
  await Promise.resolve();

  assert.deepEqual(events, []);
});

function createRuntimeFetchEventSourceRequest(): RuntimeStreamConnectionRequest {
  return {
    url: "http://127.0.0.1:48123/cw/v1/runs/run_1/stream",
    headers: {
      Accept: "text/event-stream",
      Authorization: "Bearer test-token",
    },
    withCredentials: false,
  };
}

function encodeSse(block: string): Uint8Array {
  return new TextEncoder().encode(`${block}\n\n`);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}
