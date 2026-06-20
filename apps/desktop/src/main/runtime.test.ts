import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeConnectionInfo,
  createRuntimeBaseUrl,
  isValidRuntimePort,
  parseRuntimeReadyLine,
} from "./runtime.js";

test("parses sidecar READY stdout into the loopback API root", () => {
  const ready = parseRuntimeReadyLine("READY 51321");

  assert.deepEqual(ready, {
    port: 51321,
    base_url: "http://127.0.0.1:51321/cw/v1",
    raw_line: "READY 51321",
  });
});

test("rejects malformed READY lines and invalid ports", () => {
  assert.equal(parseRuntimeReadyLine("READY 0"), null);
  assert.equal(parseRuntimeReadyLine("READY 65536"), null);
  assert.equal(parseRuntimeReadyLine("READY http://127.0.0.1:51321"), null);
  assert.equal(parseRuntimeReadyLine("READY 51321 extra"), null);
  assert.equal(parseRuntimeReadyLine("NOT_READY 51321"), null);
});

test("builds only 127.0.0.1 runtime base URLs", () => {
  assert.equal(createRuntimeBaseUrl(1), "http://127.0.0.1:1/cw/v1");
  assert.equal(createRuntimeBaseUrl(65535), "http://127.0.0.1:65535/cw/v1");
  assert.throws(() => createRuntimeBaseUrl(0), RangeError);
  assert.throws(() => createRuntimeBaseUrl(65_536), RangeError);
  assert.throws(() => createRuntimeBaseUrl(3.14), RangeError);
});

test("validates runtime connection tokens before exposing connection info", () => {
  const ready = parseRuntimeReadyLine("READY 49152");
  assert.notEqual(ready, null);

  if (ready === null) {
    return;
  }

  assert.deepEqual(buildRuntimeConnectionInfo(ready, "token_abc123"), {
    base_url: "http://127.0.0.1:49152/cw/v1",
    token: "token_abc123",
  });
  assert.throws(
    () => buildRuntimeConnectionInfo(ready, ""),
    /Runtime auth token/u,
  );
  assert.throws(
    () => buildRuntimeConnectionInfo(ready, "token\nabc"),
    /Runtime auth token/u,
  );
});

test("validates runtime port boundaries", () => {
  assert.equal(isValidRuntimePort(1), true);
  assert.equal(isValidRuntimePort(65_535), true);
  assert.equal(isValidRuntimePort(0), false);
  assert.equal(isValidRuntimePort(65_536), false);
});
