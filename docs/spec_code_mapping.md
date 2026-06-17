# Spec To Code Mapping

This document maps accepted schema specs to the current M1.2 implementation,
tests, and generated TypeScript artifacts. It is a closure artifact for
`docs/roadmap.md` M1.2 and should be updated when schema ownership changes.

## M1.2 Schema Specs

| Spec                                 | Python implementation                                                                                                                                            | Contract tests                                        | Generated artifacts                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `specs/schemas/workflow_graph.md`    | `packages/schemas/src/cw_schemas/workflow/graph.py`, `packages/schemas/src/cw_schemas/workflow/nodes.py`, `packages/schemas/src/cw_schemas/workflow/policies.py` | `packages/schemas/tests/test_w1_2_workflow_graph.py`  | `packages/schemas-ts/src/generated/WorkflowGraph.ts`, `WorkflowEdge.ts`, node/policy JSON schemas                          |
| `specs/schemas/node_contract.md`     | `packages/schemas/src/cw_schemas/contract/*.py`                                                                                                                  | `packages/schemas/tests/test_w1_2_3_node_contract.py` | `packages/schemas-ts/src/generated/*Contract.ts`, `EvaluationCriterion.ts`, policy/ref/requirement JSON schemas            |
| `specs/schemas/context_pack.md`      | `packages/schemas/src/cw_schemas/packs/context_pack.py`, `budget.py`, `fragments.py`                                                                             | `packages/schemas/tests/test_w1_2_4_packs.py`         | `packages/schemas-ts/src/generated/ContextPack.ts`, `ContextFragment.ts`, `ContextBudget.ts`, related JSON schemas         |
| `specs/schemas/evidence_pack.md`     | `packages/schemas/src/cw_schemas/packs/evidence_pack.py`, `evidence.py`, `evidence_source.py`                                                                    | `packages/schemas/tests/test_w1_2_4_packs.py`         | `packages/schemas-ts/src/generated/EvidencePack.ts`, `Evidence.ts`, `EvidenceCoverage.ts`, related JSON schemas            |
| `specs/schemas/evaluation_result.md` | `packages/schemas/src/cw_schemas/runtime/evaluation.py`, `usage.py`                                                                                              | `packages/schemas/tests/test_w1_2_5_runtime.py`       | `packages/schemas-ts/src/generated/EvaluationResult.ts`, `CriterionResult.ts`, `FailureDiagnosis.ts`, related JSON schemas |
| `specs/schemas/repair_patch.md`      | `packages/schemas/src/cw_schemas/runtime/repair.py`                                                                                                              | `packages/schemas/tests/test_w1_2_5_runtime.py`       | `packages/schemas-ts/src/generated/RepairPatch.ts`, `RepairProvenance.ts`, `ReversalHint.ts`, related JSON schemas         |
| `specs/schemas/stream_event.md`      | `packages/schemas/src/cw_schemas/events/*.py`                                                                                                                    | `packages/schemas/tests/test_w1_2_6_events.py`        | `packages/schemas-ts/src/generated/*Event.ts`, `ArtifactRef.ts`, related JSON schemas                                      |

## Protocol-Derived Models In M1.2

| Source spec                                                        | Python implementation                                     | Contract tests                                  | Generated artifacts                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `specs/protocols/agent_adapter.md` ExecutionPack section           | `packages/schemas/src/cw_schemas/packs/execution_pack.py` | `packages/schemas/tests/test_w1_2_4_packs.py`   | `packages/schemas-ts/src/generated/ExecutionPack.ts`, `PromptOverlay.ts`, `ToolsetSpec.ts`, `UsageLimits.ts` |
| `specs/protocols/agent_adapter.md` Attempt/Adapter output sections | `packages/schemas/src/cw_schemas/runtime/attempt.py`      | `packages/schemas/tests/test_w1_2_5_runtime.py` | `packages/schemas-ts/src/generated/NodeAttempt.ts`, `AttemptOutcome.ts`, `AdapterError.ts`                   |

## Export And Codegen Evidence

- `cw_schemas.__exported_models__` currently registers 90 Pydantic models.
- Codegen currently writes 90 JSON Schema files under `packages/schemas-ts/src/generated/json-schema`.
- Codegen currently writes 90 model TypeScript files plus `packages/schemas-ts/src/generated/index.ts`.
- The root codegen gate is `.\dev.ps1 codegen`, which runs Python JSON Schema generation and the `json-schema-to-typescript` TypeScript generator.

## Coverage Notes

- Schema-layer custom error code coverage is guarded by `packages/schemas/tests/test_w1_2_8_error_code_coverage.py`.
- That guard only covers errors that are both spec-mentioned and currently decidable by the Pydantic schema layer.
- Runtime state, compiler reachability, external registry, persistence, SSE replay, and apply-time errors are intentionally deferred to their owning M1.3+ packages.
