# ADR-0011: Runtime Flow Desktop Actions Contract

| 项               | 值                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status           | Proposed                                                                                                                                                                                |
| Date             | 2026-06-26                                                                                                                                                                              |
| Decision Drivers | FR-008 requires runtime-visible user instructions; FR-017 requires observable open/download actions; W1.5.190 review found run-once reuse and metadata-only artifact fetch insufficient |
| Related ADR      | ADR-0006、ADR-0008                                                                                                                                                                      |
| Related Spec     | specs/api/http_sse.md、specs/runtime_harness.md、specs/schemas/stream_event.md                                                                                                          |

## 1. 背景与问题

W1.5.190 attempted to close FR-008 and FR-017 from the Desktop workbench:

- Chat Box submissions were routed through `POST /cw/v1/runs/{run_id}/nodes/{node_id}:run-once`.
- Artifact actions fetched `GET /cw/v1/artifacts/{artifact_id}/content` and recorded only status/header metadata.

Independent review failed the slice. The run-once endpoint is accepted for FR-007 single-step execution, but it does not carry the submitted user instruction to runtime. The artifact content endpoint is accepted for content retrieval, but a metadata-only fetch does not open or download anything.

This ADR records the contract direction that must be accepted before another implementation slice can claim FR-008 or FR-017 closure. It does not change accepted specs by itself.

## 2. 候选方案

1. **Reuse run-once and keep body empty** — Preserves current metadata-only evidence behavior, but runtime never receives the user instruction. This cannot satisfy FR-008.
2. **Add ad hoc request bodies to existing endpoints** — Appears small, but violates `http_sse.md` D-API-3 because the API layer would invent request schemas outside accepted schema/spec ownership.
3. **Define an accepted runtime instruction command contract, then implement Desktop against it** — Adds a spec-owned command model and endpoint before code consumes it. This gives runtime the real instruction while preserving sanitized Desktop evidence.
4. **Renderer-only artifact open/download** — Easy to fake in React tests, but renderer would retain or synthesize artifact content handling and still lack native save/open semantics.
5. **Main-process artifact action handoff backed by runtime artifact content** — Keeps renderer snapshots metadata-only, performs file save/open in the privileged Desktop boundary, and gives tests an observable result.

## 3. 决策

Propose option 3 for FR-008 and option 5 for FR-017.

The follow-up accepted spec change should introduce a runtime instruction command contract before implementation. The proposed shape is:

- `POST /cw/v1/runs/{run_id}:submit-instruction` for workflow/global scope.
- `POST /cw/v1/runs/{run_id}/nodes/{node_id}:submit-instruction` for current-node scope.
- Request body owned by an accepted schema, not by the API layer ad hoc. Minimum fields: `schema_version`, `scope`, `instruction`, `intent`, and optional correlation metadata. Side-effect POSTs continue to require `Idempotency-Key`.
- Raw instruction text may exist only in the authenticated runtime request and runtime-controlled execution records defined by the accepted spec. It must not be written to renderer snapshots, visual-smoke evidence, runbook evidence, OTel attributes, command history, or review artifacts.
- The existing FR-007 run-once endpoint remains a separate single-step execution command and must not be overloaded as Chat instruction routing.

The follow-up accepted Desktop artifact action contract should split retrieval from action:

- `GET /cw/v1/artifacts/{artifact_id}/content` remains the runtime content source.
- Renderer dispatches only sanitized action metadata: action, artifact id, run/node context when available, and user intent.
- Preload/main performs the privileged handoff. `open` writes or resolves a project-scoped temporary file and calls the native shell. `download` saves to an explicit user-selected or project-scoped destination.
- The action result must be observable without retaining artifact body: status, artifact id, action, content type, byte count, hash when available, and sanitized destination kind. Full absolute paths, response bodies, raw artifact bytes, prompt/model output, and sensitive secure paths stay out of snapshots/evidence.
- Sensitive artifacts remain behind the local token and secure storage boundary. Copying a sensitive artifact to a non-secure destination requires an explicit user action in the accepted contract.

## 4. 影响

- 正面影响：FR-008 will have runtime-visible instruction semantics; FR-017 will have real open/download outcomes; Desktop evidence can remain metadata-only.
- 负面影响：Requires a spec/implementation follow-up before FR-008 or FR-017 can close; W1.5.190 code cannot be submitted as closure without repair or downgrade.
- 后续验证标记：A1 must verify the new command schema/endpoints against accepted specs; A3 must verify no raw instruction/artifact body leaks into evidence; A4 must verify Chat Box target routing and artifact open/download user paths.

## 5. 关联

- specs/api/http_sse.md D-API-3, D-API-4, D-API-5, D-API-11
- specs/runtime_harness.md §5 and §6
- specs/schemas/stream_event.md `artifact_refs` and sensitivity fields
- docs/04_runbook/m1.5-progress.md W1.5.190 / W1.5.191
- docs/reviews/m1.5.190-runtime-flow-actions-review.md

## 更新历史

| 日期       | 状态变更            | 备注                                                                         |
| ---------- | ------------------- | ---------------------------------------------------------------------------- |
| 2026-06-26 | Drafted as Proposed | Records W1.5.190 review failure contract direction; no accepted spec changed |
