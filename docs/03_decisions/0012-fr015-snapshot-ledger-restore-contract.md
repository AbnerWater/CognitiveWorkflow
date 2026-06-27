# ADR-0012: FR-015 Snapshot Ledger Restore Contract

| 项               | 值                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status           | Proposed                                                                                                                                                    |
| Date             | 2026-06-28                                                                                                                                                  |
| Decision Drivers | FR-015 requires automatic snapshots, timeline inspection, restore-to-snapshot, and continue execution; W1.5.204 proved workflow history but no restore spec |
| Related ADR      | ADR-0007、ADR-0011                                                                                                                                          |
| Related Spec     | specs/api/http_sse.md、specs/runtime_harness.md、specs/failure_taxonomy.md、specs/state_machines/workflow_run.md                                            |

## 1. 背景与问题

W1.5.203 added the accepted explicit workflow snapshot endpoint:

- `POST /cw/v1/workflows/{workflow_id}/snapshot`
- The runtime writes metadata-only explicit snapshot records to `.agent-workflow/snapshots/snapshots.jsonl`.

W1.5.204 added the accepted workflow history endpoint:

- `GET /cw/v1/workflows/{workflow_id}/history`
- Desktop can refresh a metadata-only Version Snapshot timeline from `.agent-workflow/workflow_history.json`.

FR-015 is still partial. The accepted specs define where workflow history and git snapshot ledger records live, but they do not yet define a runtime projection for `snapshots/snapshots.jsonl`, nor restore-to-snapshot or continue-after-restore semantics. Implementing restore directly in runtime or Desktop would invent an API and state transition outside accepted spec ownership.

This ADR proposes the contract direction only. It does not modify accepted specs, does not add endpoints, and does not authorize implementation while `Status=Proposed`.

## 2. 候选方案

1. **Surface `workflow_history.json` only** - Already implemented in W1.5.204. It proves version timeline visibility but does not expose automatic run snapshots, explicit snapshot ledger entries, restore, or continue execution.
2. **Read `snapshots/snapshots.jsonl` directly from Desktop** - Looks small, but bypasses runtime authorization, project locks, and the runtime-harness ownership boundary.
3. **Add an accepted snapshot ledger projection before Desktop uses it** - Keeps runtime as the owner of `.agent-workflow/snapshots/snapshots.jsonl`, returns sanitized metadata only, and gives Desktop a stable list/read surface.
4. **Restore by checking out git directly from Desktop** - Violates the `git.lock` ownership boundary and risks clobbering runtime/user work.
5. **Define runtime-owned restore and explicit continue semantics before implementation** - Lets runtime coordinate `runtime.lock`, `workflow_editor.lock`, `git.lock`, run state, and recovery records before Desktop dispatches the action.

## 3. 拟议决策

Accept option 3 for snapshot ledger projection and option 5 for restore/continue behavior, after explicit human acceptance and follow-up accepted spec deltas.

The follow-up accepted API/spec change should introduce a runtime-owned snapshot ledger projection:

- `GET /cw/v1/workflows/{workflow_id}/snapshots`
- Query filters: `kind`, `run_id`, `limit`, and optional cursor after the accepted schema defines pagination.
- Response schema owned by an accepted schema/spec, not ad hoc API code. Minimum projected fields: `schema_version`, `snapshot_id`, `workflow_id`, `run_id`, `kind`, `created_at`, `commit_sha`, `git_tag`, `refs`, and `restorable`.
- `refs` must remain identifier-only metadata. It must not carry prompt text, model output, uploaded file bytes, response bodies, secure paths, cache paths, output directory values, or raw local filesystem paths.

The follow-up restore contract should be runtime-owned:

- A restore action must acquire the accepted project/runtime lock boundary before mutating project state.
- Restore must target a snapshot id from the runtime snapshot ledger, not an arbitrary commit string supplied by the renderer.
- Restore must return an observable result that is metadata-only: status, snapshot id, workflow id, optional run id, source commit, target revision, affected state category, and sanitized error code.
- Restore must not automatically continue execution. Continue after restore is an explicit user/runtime action after the restored state is visible and validated.
- If continue semantics require a new endpoint or state-machine transition, that endpoint/transition must be accepted in `http_sse.md` / `workflow_run.md` before implementation.

The proposed restore error surface should reuse existing accepted namespaces where possible:

- `RES_NOT_FOUND` for unknown workflow/snapshot resources.
- `RES_GONE` for garbage-collected snapshots.
- `RH_LOCK_TIMEOUT` for lock contention.
- `RH_GIT_AUTOCOMMIT_BLOCKED` or a future runtime-harness-owned `RH_*` code for git restore failures if the existing code is too narrow.

No new error code is accepted by this ADR while it remains Proposed.

## 4. 影响

- 正面影响：FR-015 can gain a spec-owned ledger/read/restore/continue path without Desktop reading internal harness files or mutating Git directly.
- 负面影响：Requires an explicit acceptance and accepted spec/API/schema delta before implementation. W1.5.205 cannot close FR-015.
- 后续验证标记：A1 must verify endpoint/schema/spec alignment; A3 must verify sanitized metadata boundaries; A4 must verify Version Snapshot ledger, restore, and continue user paths; A8 must verify Git lock/history behavior.

## 5. 关联

- specs/api/http_sse.md `POST /workflows/{workflow_id}/snapshot` and `GET /workflows/{workflow_id}/history`
- specs/runtime_harness.md `workflow_history.json`, `snapshots/snapshots.jsonl`, `locks/git.lock`, and §8.2 automatic commit/tag triggers
- `specs/failure_taxonomy.md` runtime-harness `RH_*` and API `RES_*` namespaces
- docs/04_runbook/m1.5-progress.md W1.5.203 / W1.5.204 / W1.5.205
- docs/04_runbook/m1.5-runtime-flow-repair-plan.json `RUNTIME-FR-015-SNAPSHOT-RESTORE-CONTINUE`

## 更新历史

| 日期       | 状态变更            | 备注                                                                                               |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-06-28 | Drafted as Proposed | Records FR-015 snapshot ledger projection and restore/continue contract direction; no spec changed |
