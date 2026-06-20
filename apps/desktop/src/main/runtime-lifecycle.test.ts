import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createRuntimeBaseUrl, type RuntimeConnectionInfo } from "./runtime.js";
import {
  resolveRuntimeStartupLifecycle,
  type RuntimeConnectionHandoffProvider,
  type RuntimeStartupLifecycleTransition,
} from "./runtime-lifecycle.js";
import {
  mapRuntimeStartupDecisionToStatus,
  type RuntimeStartupStatus,
} from "./runtime-startup-status.js";
import type { RuntimeConnectionHandoffDecision } from "./runtime-handoff.js";
import type { RuntimeLockInspection } from "./runtime-lock.js";

const PROJECT_ROOT = path.join("C:", "CW", "project");
const ACTIVE_INSPECTION: RuntimeLockInspection = {
  status: "active",
  lockPath: path.join(PROJECT_ROOT, ".agent-workflow", "locks", "runtime.lock"),
};
const CONNECTION: RuntimeConnectionInfo = {
  base_url: createRuntimeBaseUrl(51234),
  token: "token_abc123",
};

test("starts a new sidecar immediately when runtime.lock is missing", async () => {
  let slept = false;
  const transitions: RuntimeStartupLifecycleTransition[] = [];
  const statuses: RuntimeStartupStatus[] = [];

  const decision = await resolveRuntimeStartupLifecycle({
    projectRoot: PROJECT_ROOT,
    readText: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    sleep: async () => {
      slept = true;
    },
    onTransition: (transition) => {
      transitions.push(transition);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
  });

  assert.equal(decision.action, "start_sidecar");
  assert.equal(decision.attempts, 1);
  assert.equal(slept, false);
  assert.deepEqual(
    transitions.map((transition) => transition.action),
    ["start_sidecar"],
  );
  assert.deepEqual(
    statuses.map((status) => status.kind),
    ["starting_sidecar"],
  );
  assert.equal(statuses[0]?.lifecycleComplete, true);
});

test("reuses an existing sidecar after a wait transition", async () => {
  let nowMs = 0;
  let calls = 0;
  const sleeps: number[] = [];
  const transitions: RuntimeStartupLifecycleTransition[] = [];
  const statuses: RuntimeStartupStatus[] = [];
  const handoff: RuntimeConnectionHandoffProvider = async () => {
    calls += 1;
    if (calls === 1) {
      return waitDecision("registry not ready");
    }
    return {
      action: "reuse_existing",
      inspection: ACTIVE_INSPECTION,
      connection: CONNECTION,
    };
  };

  const decision = await resolveRuntimeStartupLifecycle({
    projectRoot: PROJECT_ROOT,
    timeoutMs: 10,
    retryMs: 2,
    nowMs: () => nowMs,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      nowMs += delayMs;
    },
    handoff,
    onTransition: (transition) => {
      transitions.push(transition);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
  });

  assert.equal(decision.action, "reuse_existing");
  assert.equal(decision.attempts, 2);
  assert.deepEqual(sleeps, [2]);
  assert.deepEqual(
    transitions.map((transition) => transition.action),
    ["wait_for_existing", "reuse_existing"],
  );
  assert.deepEqual(
    statuses.map((status) => status.kind),
    ["waiting_for_existing", "runtime_ready"],
  );
  assert.equal(statuses[0]?.lifecycleComplete, false);
  assert.equal(statuses[1]?.lifecycleComplete, true);
});

test("times out while waiting for an existing sidecar", async () => {
  let nowMs = 0;
  const sleeps: number[] = [];
  const transitions: RuntimeStartupLifecycleTransition[] = [];
  const statuses: RuntimeStartupStatus[] = [];

  const decision = await resolveRuntimeStartupLifecycle({
    projectRoot: PROJECT_ROOT,
    timeoutMs: 5,
    retryMs: 2,
    nowMs: () => nowMs,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      nowMs += delayMs;
    },
    handoff: async () => waitDecision("runtime.lock is active"),
    onTransition: (transition) => {
      transitions.push(transition);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
  });

  assert.equal(decision.action, "timeout_waiting_for_existing");
  assert.equal(decision.attempts, 3);
  assert.equal(decision.reason, "runtime.lock is active");
  assert.deepEqual(sleeps, [2, 2, 1]);
  assert.deepEqual(
    transitions.map((transition) => transition.action),
    ["wait_for_existing", "wait_for_existing", "wait_for_existing"],
  );
  assert.deepEqual(
    statuses.map((status) => status.kind),
    [
      "waiting_for_existing",
      "waiting_for_existing",
      "waiting_for_existing",
      "startup_timed_out",
    ],
  );
  assert.equal(statuses.at(-1)?.userActionRequired, true);
  assert.equal(statuses.at(-1)?.retryable, true);
});

test("times out when injected lifecycle clock does not advance", async () => {
  let sleeps = 0;

  const decision = await resolveRuntimeStartupLifecycle({
    projectRoot: PROJECT_ROOT,
    timeoutMs: 5,
    retryMs: 2,
    nowMs: () => 0,
    sleep: async () => {
      sleeps += 1;
    },
    handoff: async () => waitDecision("test clock is frozen"),
  });

  assert.equal(decision.action, "timeout_waiting_for_existing");
  assert.equal(decision.attempts, 4);
  assert.equal(decision.reason, "test clock is frozen");
  assert.equal(sleeps, 3);
});

test("blocks startup immediately when handoff fails closed", async () => {
  let slept = false;
  const statuses: RuntimeStartupStatus[] = [];
  const handoff: RuntimeConnectionHandoffProvider = async () => ({
    action: "block_startup",
    inspection: {
      status: "corrupt",
      lockPath: ACTIVE_INSPECTION.lockPath,
      error: "runtime.lock is corrupt",
    },
    reason: "runtime.lock is corrupt",
  });

  const decision = await resolveRuntimeStartupLifecycle({
    projectRoot: PROJECT_ROOT,
    sleep: async () => {
      slept = true;
    },
    handoff,
    onStatus: (status) => {
      statuses.push(status);
    },
  });

  assert.equal(decision.action, "block_startup");
  assert.equal(decision.attempts, 1);
  assert.equal(decision.reason, "runtime.lock is corrupt");
  assert.equal(slept, false);
  assert.deepEqual(
    statuses.map((status) => status.kind),
    ["startup_blocked"],
  );
  assert.equal(statuses[0]?.severity, "error");
});

test("rejects invalid lifecycle timeout and retry settings", async () => {
  await assert.rejects(
    resolveRuntimeStartupLifecycle({
      projectRoot: PROJECT_ROOT,
      timeoutMs: 0,
    }),
    /timeout/u,
  );
  await assert.rejects(
    resolveRuntimeStartupLifecycle({
      projectRoot: PROJECT_ROOT,
      retryMs: 0,
    }),
    /retry interval/u,
  );
});

test("maps lifecycle decisions to startup status snapshots", () => {
  const status = mapRuntimeStartupDecisionToStatus({
    action: "cleanup_then_start",
    attempts: 1,
    handoff: {
      action: "cleanup_then_start",
      inspection: {
        status: "stale",
        lockPath: ACTIVE_INSPECTION.lockPath,
        ageMs: 90_000,
      },
    },
  });

  assert.deepEqual(status, {
    kind: "cleaning_stale_lock",
    action: "cleanup_then_start",
    attempt: 1,
    lockStatus: "stale",
    severity: "warning",
    message: "Cleaning stale runtime lock before starting runtime sidecar.",
    lifecycleComplete: true,
    userActionRequired: false,
    retryable: false,
  });
});

function waitDecision(reason: string): RuntimeConnectionHandoffDecision {
  return {
    action: "wait_for_existing",
    inspection: ACTIVE_INSPECTION,
    reason,
  };
}
