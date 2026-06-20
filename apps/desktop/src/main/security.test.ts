import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStrictContentSecurityPolicy,
  buildContentSecurityPolicy,
  getDesktopWindowSecurity,
} from "./security.js";

test("keeps BrowserWindow webPreferences locked down by default", () => {
  assert.deepEqual(getDesktopWindowSecurity(), {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });
});

test("builds a strict renderer CSP with loopback-only runtime access", () => {
  const csp = buildContentSecurityPolicy();

  assert.match(csp, /\bdefault-src 'none'/u);
  assert.match(csp, /\bscript-src 'self'/u);
  assert.match(csp, /\bconnect-src 'self' http:\/\/127\.0\.0\.1:\*/u);
  assert.doesNotMatch(csp, /unsafe-eval/u);
  assert.doesNotMatch(csp, /unsafe-inline/u);
  assert.doesNotMatch(csp, /localhost/u);
  assert.doesNotMatch(csp, /0\.0\.0\.0/u);
});

test("allows only explicit dev loopback websocket opt-in", () => {
  assert.doesNotMatch(buildContentSecurityPolicy(), /ws:\/\/127\.0\.0\.1:\*/u);
  assert.match(
    buildContentSecurityPolicy({ allowDevLoopbackWebSocket: true }),
    /ws:\/\/127\.0\.0\.1:\*/u,
  );
});

test("rejects loose CSP sources", () => {
  assert.throws(() =>
    assertStrictContentSecurityPolicy(
      "script-src 'unsafe-eval'; connect-src http://127.0.0.1:*",
    ),
  );
  assert.throws(() =>
    assertStrictContentSecurityPolicy(
      "script-src 'self'; connect-src http://localhost:*",
    ),
  );
  assert.throws(() =>
    assertStrictContentSecurityPolicy(
      "script-src 'self'; connect-src http://*",
    ),
  );
});
