# Spec: Failure Taxonomy（失败分类总图）

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-taxonomy-001` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 技术架构 v1.0 §7.3（失败类型与处理策略）/ §11.3（异常处理原则） |
| 关联 spec | 全部已锁定 spec（被引用为 FailureType 的来源 / 消费方） |
| 关联 ADR | ADR-0002、ADR-0005、ADR-0008、ADR-0009 |

> **范围**：定义 `FailureType` 8+1 类的**单一权威分类总图**。把已分散在多份 spec 里的失败枚举、修复策略、升级路径、Reflection 写回、错误码统一收口为一份"治病百科"。
>
> **非范围**：
> - 各 spec 的 schema（已锁定，本文不重复定义）
> - 具体修复算法（属 `repair_patch.md` / RepairAgent 实现）
> - 评测维度（属 CW-Bench，独立 spec）
>
> **核心立场**：
> - **唯一来源**：所有引用 `FailureType` 的 spec 必须以本文枚举为准；不允许扩充类型至 v0.2
> - **可分类才可修复**：每一类失败都必须有"默认 RecommendedAction"+ "推荐 RepairStrategy 优先级"+ "升级路径上限"
> - **`unknown` 是兜底**：任何不在 8 类内的失败强制归 `unknown` → 转 `human_checkpoint`（与 D-NC-6 一致）

---

## 0. 设计原则

1. **8+1 类固定**：与技术架构 §7.3 完全对齐——`format_error / missing_output / missing_evidence / logic_gap / model_capability_limit / tool_error / ambiguous_requirement / review_rule_too_strict`，加 `unknown` 兜底。
2. **每类正交**：分类的"判定条件"互斥；同时命中多类时按 §3 优先级矩阵裁决，不允许"复合失败类型"。
3. **修复策略可枚举**：每类列出推荐 RepairStrategy 优先级，与 `repair_patch.md` D-RP-1 / D-NC-4 的策略子集一致。
4. **升级有上限**：每类给出"`model_capability_limit` 升级前置条件"与"`human_checkpoint` 触发条件"，避免无限重试。
5. **可被 ReflectionMemory 学习**：每类显式声明哪些 `ReflectionKind` 应在该类失败上写回（与 `reflection_memory.md` §4.1 一致）。
6. **错误码指向**：每类失败列出与之相关的"业务错误码"集合（来自各 spec 已锁定的错误码命名空间）。
7. **可观测**：每类都给出 OTel `cw.error.failure_type` attribute 取值，作为 metric / trace 的统一维度。

---

## 1. `FailureType` 枚举

```
type FailureType =
  | "format_error"
  | "missing_output"
  | "missing_evidence"
  | "logic_gap"
  | "model_capability_limit"
  | "tool_error"
  | "ambiguous_requirement"
  | "review_rule_too_strict"
  | "unknown"
```

> 不允许任何 spec 扩充本枚举至 v0.2；自定义诊断信息进 `EvaluationResult.failure_diagnosis.tags / metadata`（与 D-ER-2 一致）。

---

## 2. 8+1 类详细定义

### 2.1 `format_error`

| 维度 | 值 |
|---|---|
| **定义** | 节点输出违反 schema：JSON 不合法、字段类型错误、表格行列不齐、文件格式异常 |
| **典型触发** | Pydantic v2 校验失败 / 输出工具 args 不可解析 / 表格列数不匹配声明 |
| **判定来源** | `Output Validator (programmatic)` → `EvaluationCriterion.kind=schema` 或 Pydantic `ValidationError` |
| **Severity 默认** | `major`（除非节点声明 blocker） |
| **默认 RecommendedAction** | `repair_with_patch` |
| **推荐 RepairStrategy 优先级** | 1) `prompt_patch`（追加 schema/example）  2) `model_escalation`（仅当多次仍失败） |
| **升级前置** | 同节点累计 ≥2 次 `format_error` 才允许 `model_escalation` |
| **HITL 触发** | RepairPolicy.escalate_after_repairs（默认 3）触达 |
| **ReflectionMemory 写回** | `failure_pattern` 立即写；`patch_pattern` 在下一次 attempt 通过后写 |
| **OTel attribute** | `cw.error.failure_type=format_error` |
| **关联错误码** | `NC_L2_BAD_OUTPUT_SCHEMA / AA_RUN_OUTPUT_VALIDATION_FAILED / SE_BUILD_PAYLOAD_TOO_LARGE` |

### 2.2 `missing_output`

| 维度 | 值 |
|---|---|
| **定义** | 必填字段缺失或产物对象缺失（即使其它字段都符合 schema） |
| **典型触发** | `output_schema.required[*]` 中某项 = null / 空数组 / 空字符串 |
| **判定来源** | Pydantic 校验 + EvaluationAgent 比对 `NodeContract.output_schema.required` |
| **Severity 默认** | `blocker`（必填即一票否决） |
| **默认 RecommendedAction** | `repair_with_patch` |
| **推荐 RepairStrategy 优先级** | 1) `prompt_patch`（强调字段必填 + few-shot）  2) `model_escalation` |
| **升级前置** | 同 `format_error` |
| **HITL 触发** | escalate_after_repairs 触达 |
| **ReflectionMemory 写回** | `failure_pattern` + `prompt_pattern`（成功后） |
| **OTel attribute** | `cw.error.failure_type=missing_output` |
| **关联错误码** | `NC_L2_MISSING_PROMPT / AA_RUN_OUTPUT_VALIDATION_FAILED / AA_FINALIZE_NO_RESULT` |

### 2.3 `missing_evidence`

| 维度 | 值 |
|---|---|
| **定义** | 关键结论缺少来源；EvidencePack `coverage_ratio < ReviewPolicy.evidence_required_for_factual_outputs` 阈值；CitationChecker 报 dangling / unsupported claim |
| **典型触发** | `EvaluationResult.evidence_feedback.unsupported_claim_estimates > 0` / `coverage_ratio < 1.0` |
| **判定来源** | CitationChecker（程序化）+ `EvidenceCoverage` 计算 |
| **Severity 默认** | `blocker`（事实性节点）/ `major`（叙述性节点） |
| **默认 RecommendedAction** | `request_evidence`（先重建 EvidencePack 再 retry_same） |
| **推荐 RepairStrategy 优先级** | 1) `evidence_patch`（add_topic_coverage / inject_evidence_lookup_tool / tighten_relevance）  2) `prompt_patch`（强调"必须先引证再陈述"）  3) `model_escalation` |
| **升级前置** | 至少先做一次 `evidence_patch`；若第二次仍 missing_evidence → 允许 `model_escalation`；第三次 → `human_checkpoint` |
| **HITL 触发** | 第三次 `missing_evidence` 或 `EP_BUILD_REQUIREMENT_UNRESOLVED` 触发 |
| **ReflectionMemory 写回** | `failure_pattern` + `evidence_pattern`（稳定门槛后） |
| **OTel attribute** | `cw.error.failure_type=missing_evidence` |
| **关联错误码** | `EP_BUILD_REQUIREMENT_UNRESOLVED / EP_EVAL_UNSUPPORTED_CLAIM / EP_EVAL_DANGLING_CITATION / EP_RUNTIME_EVIDENCE_LOOKUP_MISS` |

### 2.4 `logic_gap`

| 维度 | 值 |
|---|---|
| **定义** | 论证链断裂、推理不完整、内部矛盾、过于宽泛缺可证伪边界 |
| **典型触发** | `EvaluationCriterion.kind=rubric` 中 `researchable / coherent / coverage` 类项失败；多 judge `support_polarity` 显式冲突 |
| **判定来源** | LLM judge（rubric） + Critic Agent（可选） |
| **Severity 默认** | `major`（偶尔 `blocker`） |
| **默认 RecommendedAction** | `repair_with_patch` |
| **推荐 RepairStrategy 优先级** | 1) `prompt_patch`（追加约束 / 拆分子问题 / few-shot）  2) `workflow_patch`（节点拆分 / 多角色审查；Phase 1 由 Engine 自行生成）  3) `model_escalation` |
| **升级前置** | `attempts_so_far >= ReviewPolicy.escalate_after_repairs / 2`（默认 ≥2）允许 `model_escalation` |
| **HITL 触发** | `escalate_after_repairs` 触达，或多 judge `disagreement_score ≥ 0.5`（D-ER-5） |
| **ReflectionMemory 写回** | `failure_pattern` + `patch_pattern`（成功后） + `prompt_pattern`（稳定门槛后） |
| **OTel attribute** | `cw.error.failure_type=logic_gap` |
| **关联错误码** | `NC_L2_EVAL_BAD_PASS_THRESHOLD / AA_RUN_INTERNAL`（不应直接出现，Adapter 应分类） |

### 2.5 `model_capability_limit`

| 维度 | 值 |
|---|---|
| **定义** | 多次修复仍无法满足；当前模型在该节点类型 / 该领域上"能力天花板"已现 |
| **典型触发** | 同节点同类型失败连续 ≥`escalate_after_repairs`（默认 3）次 / context 超长无法装入 / reasoning 不足 |
| **判定来源** | RepairAgent 自我诊断 + ReflectionMemory `model_performance_signal` 历史 |
| **Severity 默认** | `blocker` |
| **默认 RecommendedAction** | `repair_with_patch`（kind=`model_escalation`） |
| **推荐 RepairStrategy 优先级** | 1) `model_escalation`（按 escalation_chain 推进）  2) `human_checkpoint`（若链已耗尽） |
| **升级前置** | escalation_chain 中存在下一档 profile（D-MR-4 链 ≤5）；相邻 local→cloud 跨界禁止 |
| **HITL 触发** | `MR_ESCALATION_EXHAUSTED` 立即触发 |
| **ReflectionMemory 写回** | `failure_pattern` + `model_performance_signal`（即时记录 pass_rate 下降） |
| **OTel attribute** | `cw.error.failure_type=model_capability_limit` |
| **关联错误码** | `MR_ESCALATION_EXHAUSTED / AA_RUN_RETRY_LIMIT / CB_INPUT_BUDGET_INVALID（间接）` |

### 2.6 `tool_error`

| 维度 | 值 |
|---|---|
| **定义** | 工具 / 文件 / 网络 / 执行环境错误（与模型本身无关） |
| **典型触发** | MCP 连接失败 / 子进程退出码非零 / HTTP 5xx / 文件权限拒绝 / 沙箱违规 |
| **判定来源** | AgentAdapter 转译底层异常为 `AdapterError(error_kind=TOOL_FAILED \| MCP_TRANSPORT)` |
| **Severity 默认** | `major`（偶尔 `blocker` 当工具不可恢复） |
| **默认 RecommendedAction** | `human_checkpoint`（**非** `repair_with_patch`——RepairAgent 不修工具配置；与 §技术架构 §7.3 一致） |
| **推荐 RepairStrategy 优先级** | （工具配置由 Engine 处理，不由 RepairAgent 生成 patch）；可选 `prompt_patch`（让模型避开工具） |
| **升级前置** | — |
| **HITL 触发** | 立即触发；UI 弹"工具配置面板" |
| **ReflectionMemory 写回** | `failure_pattern`（仅记录工具 ID + 错误类型）；不写 `patch_pattern`（工具问题不复用为 patch 经验） |
| **OTel attribute** | `cw.error.failure_type=tool_error` |
| **关联错误码** | `AA_RUN_TOOL_NOT_FOUND / AA_RUN_INTERNAL（待分类）/ EB_RETRIEVE_TOOL_TIMEOUT / EB_RETRIEVE_TOOL_PROVIDER_FORBIDDEN / mcp.* SDK 异常` |

### 2.7 `ambiguous_requirement`

| 维度 | 值 |
|---|---|
| **定义** | 节点目标 / 标准不清楚；存在用户决策才能继续 |
| **典型触发** | EvaluationAgent 多次给出"无法判定 pass/fail"；评审标准互相冲突；用户原始 user_goal 在节点上下文中存在歧义 |
| **判定来源** | EvaluationAgent 显式诊断 + Critic Agent 提示 |
| **Severity 默认** | `blocker` |
| **默认 RecommendedAction** | `human_checkpoint`（澄清确认） |
| **推荐 RepairStrategy 优先级** | 1) `human_checkpoint` (`request_user_clarification`)  2) （仅 PlanningSession 阶段）回到 `clarifying` 状态再生成 PlannerAgent draft |
| **升级前置** | — |
| **HITL 触发** | 立即触发 |
| **ReflectionMemory 写回** | `failure_pattern`（记录 ambiguity 模式）；下次 PlanningSession 命中时建议提前澄清 |
| **OTel attribute** | `cw.error.failure_type=ambiguous_requirement` |
| **关联错误码** | `PS_CLARIFY_EXHAUSTED / PS_REVISE_AMBIGUOUS_INTENT` |

### 2.8 `review_rule_too_strict`

| 维度 | 值 |
|---|---|
| **定义** | 评价规则不可达 / 互相冲突；任意有效输出都过不了 |
| **典型触发** | `pass_condition.threshold` 与 `fail_condition` 形成空交集；多个 blocker criterion 互斥；某 criterion 用了不可满足的程序化校验器 |
| **判定来源** | RepairAgent 诊断 + Engine 元规则检查 |
| **Severity 默认** | `blocker` |
| **默认 RecommendedAction** | `human_checkpoint`（规则属元决策，不能由 RepairAgent 自动改） |
| **推荐 RepairStrategy 优先级** | 1) `human_checkpoint`（请求用户调规则）  2) （Phase 3+）`workflow_patch.relax_review_rule` 在用户授权下允许 |
| **升级前置** | — |
| **HITL 触发** | 立即触发 |
| **ReflectionMemory 写回** | `failure_pattern`（标记"该 criterion 组合不可达"）；提醒 PlannerAgent 下次创建相似 evaluation_task 时避坑 |
| **OTel attribute** | `cw.error.failure_type=review_rule_too_strict` |
| **关联错误码** | `NC_L2_EVAL_BAD_PASS_THRESHOLD / NC_L2_EVAL_NO_CRITERIA / ER_BUILD_INVALID_RECOMMENDED_STRATEGY` |

### 2.9 `unknown`

| 维度 | 值 |
|---|---|
| **定义** | 不属于以上 8 类的任何失败；EvaluationAgent 给出的 failure_type 不在节点 `failure_taxonomy` 子集 |
| **典型触发** | 自定义诊断 / 实现错误 / 未在 spec 内的失败模式 |
| **Severity 默认** | `blocker` |
| **默认 RecommendedAction** | `human_checkpoint` |
| **推荐 RepairStrategy 优先级** | 仅 `human_checkpoint` |
| **升级前置** | — |
| **HITL 触发** | 立即触发 |
| **ReflectionMemory 写回** | `failure_pattern`（标 `tags=["uncategorized"]`，便于回溯） |
| **OTel attribute** | `cw.error.failure_type=unknown` |
| **关联错误码** | `OB_ATTR_NOT_WHITELISTED / 任意未分类 AdapterError / 实现错误` |

---

## 3. 多类同时命中的优先级矩阵

当一个 attempt 同时命中多个失败信号（如既缺字段又缺证据），按以下优先级取一个 `failure_type` 作为最终诊断（高优先级覆盖低）：

```
1. tool_error                ← 工具层错误，最优先（避开模型层修复无意义）
2. ambiguous_requirement     ← 目标不清楚，先解决意图
3. review_rule_too_strict    ← 规则不可达，先调规则
4. format_error              ← 结构错误，先修结构
5. missing_output            ← 缺必填，先补字段
6. missing_evidence          ← 缺来源，先补证据
7. logic_gap                 ← 推理问题，最难修
8. model_capability_limit    ← 模型能力，最后兜底
9. unknown                   ← 兜底兜底
```

**约束**：

- 同一 EvaluationResult 仅产生一个 `failure_type`；多类信号写入 `criterion_results[*].findings[*].kind`，但顶层 `failure_type` 由本矩阵裁决
- 矩阵在 v0.2 之前不变；任何调整需通过 ADR

---

## 4. 修复路径决策树（与 §RecommendedAction 默认推导一致）

```
EvaluationResult.passed = false
  │
  ├─ failure_type ∈ {tool_error}              → human_checkpoint
  │   └ tool 配置面板 → 用户解决依赖 → retry_same
  │
  ├─ failure_type ∈ {ambiguous_requirement,
  │                   review_rule_too_strict,
  │                   unknown}                → human_checkpoint
  │
  ├─ failure_type ∈ {format_error,
  │                   missing_output}         → repair_with_patch (prompt_patch)
  │   └ ≥2 次仍失败                          → model_escalation
  │   └ ≥escalate_after_repairs              → human_checkpoint
  │
  ├─ failure_type = missing_evidence           → request_evidence (evidence_patch)
  │   └ 第二次失败                           → model_escalation
  │   └ 第三次失败                           → human_checkpoint
  │
  ├─ failure_type = logic_gap                  →
  │     attempts < escalate/2 → repair_with_patch (prompt_patch)
  │     attempts ≥ escalate/2 → model_escalation
  │     attempts ≥ escalate   → human_checkpoint
  │     judge.disagreement_score ≥ 0.5 → human_checkpoint  (D-ER-5)
  │
  └─ failure_type = model_capability_limit     → model_escalation
      └ escalation_chain 耗尽                   → human_checkpoint
```

---

## 5. 节点契约的失败子集声明

`NodeContract.failure_taxonomy` 字段（参见 `node_contract.md` §1.1）允许节点声明"关注哪些子集"。规则：

| 节点 contract_kind | 强制包含的子集 | 推荐子集 |
|---|---|---|
| `execution` | `format_error / missing_output` | + `missing_evidence`（事实性）/ `logic_gap` / `tool_error` |
| `evaluation` | `format_error / review_rule_too_strict` | + `ambiguous_requirement` |
| `repair` | `format_error / missing_output` | — |
| `human_gate` | — | — |
| `tool` | `tool_error` | `format_error` |
| `memory` | `format_error` | — |

声明不在子集内的 `failure_type` 一律归 `unknown`，触发 human_checkpoint（D-NC-6 兼容）。

---

## 6. ReflectionMemory 写回总表（与 `reflection_memory.md` §4 对齐）

| FailureType | 即时写 `failure_pattern` | 修复成功后写 `patch_pattern` | 稳定门槛后写 `prompt_pattern` | 写 `evidence_pattern` | 写 `model_performance_signal` |
|---|---|---|---|---|---|
| `format_error` | ✅ | ✅ | ✅ | — | ✅ |
| `missing_output` | ✅ | ✅ | ✅ | — | ✅ |
| `missing_evidence` | ✅ | ✅ | — | ✅ | ✅ |
| `logic_gap` | ✅ | ✅ | ✅ | — | ✅ |
| `model_capability_limit` | ✅ | — | — | — | ✅（即时下调 pass_rate） |
| `tool_error` | ✅（仅记录工具 ID） | — | — | — | — |
| `ambiguous_requirement` | ✅（含 ambiguity 模式） | — | — | — | — |
| `review_rule_too_strict` | ✅（标记不可达组合） | — | — | — | — |
| `unknown` | ✅（标 uncategorized） | — | — | — | — |

> "即时" = 评价完成立即；"修复成功后" = 应用 RepairPatch 后下一次 attempt `passed=true`；"稳定门槛后" = ≥3 次跨 Run 一次通过（D-RM-4）。

---

## 7. 错误码总索引（按 spec 命名空间汇总）

> 本节是 CW 全部 spec 已锁定错误码的**单一索引**。新增错误码必须先更新对应 spec 再回填本表。

| 命名空间 | 来源 spec | 主要错误码示例 | 关联 FailureType |
|---|---|---|---|
| `WG_*` | workflow_graph.md §11 | `WG_L1_INVALID_JSON / WG_L2_DUP_NODE_ID / WG_L3_ORPHAN_NODE / WG_L4_UNKNOWN_SKILL` | format_error / unknown |
| `NC_*` | node_contract.md §13 | `NC_L2_KIND_MISMATCH / NC_L2_BAD_OUTPUT_SCHEMA / NC_L2_TEMPLATE_UNRESOLVED_VAR / NC_L4_MODEL_FORBIDDEN` | format_error / review_rule_too_strict / unknown |
| `CP_*` | context_pack.md §10 | `CP_BUILD_REQ_UNRESOLVED / CP_BUILD_OVER_BUDGET / CP_BUILD_DROP_REQUIRED_FORBIDDEN / CP_RUNTIME_TEMPLATE_VAR_MISSING` | model_capability_limit / format_error |
| `EP_*` | evidence_pack.md §8 | `EP_BUILD_REQUIREMENT_UNRESOLVED / EP_EVAL_UNSUPPORTED_CLAIM / EP_EVAL_DANGLING_CITATION / EP_BUILD_SENSITIVE_REMOTE_FORBIDDEN` | missing_evidence / unknown |
| `ER_*` | evaluation_result.md §11 | `ER_BUILD_NO_TARGET_ARTIFACT / ER_BUILD_FAILURE_DIAGNOSIS_MISSING / ER_BUILD_INVALID_RECOMMENDED_STRATEGY / ER_RUNTIME_RESULT_MUTATED` | review_rule_too_strict / unknown |
| `RP_*` | repair_patch.md §11 | `RP_BUILD_KIND_NOT_ALLOWED / RP_BUILD_ADDR_FAILURE_TYPES_NOT_ALLOWED / RP_APPLY_TARGET_NOT_FOUND / RP_BUILD_MODEL_NOT_IN_ESCALATION_CHAIN` | review_rule_too_strict / model_capability_limit |
| `SE_*` | stream_event.md §11 | `SE_BUILD_BAD_TYPE / SE_SSE_REPLAY_NOT_FOUND / SE_PERSIST_SENSITIVE_LEAK / SE_SSE_RATE_LIMIT_EXCEEDED` | tool_error / unknown |
| `AA_*` | agent_adapter.md §13 | `AA_PREPARE_INVALID_PACK / AA_PREPARE_INCOMPATIBLE_ADAPTER / AA_RUN_OUTPUT_VALIDATION_FAILED / AA_RUN_RETRY_LIMIT / AA_RUN_CANCELLED` | format_error / model_capability_limit / tool_error |
| `MR_*` | model_router.md §10 | `MR_NO_CANDIDATES / MR_CAPABILITY_NOT_MET / MR_ESCALATION_EXHAUSTED / MR_SENSITIVE_DATA_REMOTE_FORBIDDEN` | model_capability_limit / unknown |
| `RM_*` | reflection_memory.md §11 | `RM_WRITE_NO_ORIGIN / RM_WRITE_PATCH_NOT_VERIFIED / RM_WRITE_LEAKED_PII / RM_GLOBAL_SCOPE_NOT_ENABLED` | unknown |
| `CB_*` | context_builder.md §8 | `CB_INPUT_TOKENIZER_UNKNOWN / CB_FETCH_UPSTREAM_NOT_FOUND / CB_REFLECTION_INJECT_OVERFLOW` | tool_error / model_capability_limit |
| `EB_*` | evidence_builder.md §8 | `EB_INPUT_INDEX_SNAPSHOT_MISMATCH / EB_RETRIEVE_TOOL_TIMEOUT / EB_CONSOLIDATE_BLOCKER_CONFLICT_UNRESOLVED` | tool_error / missing_evidence |
| `OB_*` | observability.md §11 | `OB_EXPORT_SQLITE_BUSY / OB_EXPORT_OTLP_FAILED / OB_ATTR_NOT_WHITELISTED / OB_SECURE_LEAK_BLOCKED` | tool_error / unknown |
| `RH_*` | runtime_harness.md §13 | `RH_INIT_GIT_FAILED / RH_LOCK_TIMEOUT / RH_MEMORY_DIRECT_WRITE_FORBIDDEN / RH_SECURE_LEAK_BLOCKED / RH_GIT_AUTOCOMMIT_BLOCKED` | tool_error / unknown |
| `PS_*` | state_machines/planning_session.md §11 | `PS_CLARIFY_EXHAUSTED / PS_VALIDATE_AUTO_REPAIR_EXHAUSTED / PS_INSTANTIATE_INCOMPLETE_CONTRACT / PS_REVISE_AMBIGUOUS_INTENT` | ambiguous_requirement / unknown |
| `API` 通用 | api/http_sse.md §9 | `AUTH_FORBIDDEN / RES_NOT_FOUND / IDEMPOTENCY_KEY_BODY_MISMATCH / RATE_LIMIT_EXCEEDED` | tool_error / unknown |

> 当某错误码不能直接映射到 8+1 类（如 `RES_NOT_FOUND`）时，由 Engine 在产生 EvaluationResult 阶段决定归 `tool_error` 或 `unknown`；不允许在 spec 之外引入新 FailureType。

---

## 8. 严重度（Severity）总表

每条 `EvaluationCriterion` 与 `Finding` 都有 severity；跨节点对照：

| Severity | 一票否决 passed=false？ | 进入修复路径？ | 计入 fail_count？ | UI 配色 |
|---|---|---|---|---|
| `blocker` | ✅（D-NC-6） | ✅ | ✅ | 红 |
| `major` | 当 `pass_condition.combinator=all_pass` 时是；`weighted_score` 时按权重 | ✅ | ✅ | 橙 |
| `minor` | ❌ | 仅当总分跌破阈值 | ❌ | 黄 |
| `info` | ❌ | ❌ | ❌ | 灰 |

---

## 9. 与 `RepairAgent` 默认 strategy 子集的耦合

`NodeContract.repair.repair_strategies` 通过 `applies_to_failure_types` 与本表关联。Phase 1 推荐的"全保护"基线（PlannerAgent 在创建 repair_task 时默认填入）：

```yaml
repair_strategies:
  - kind: prompt_patch
    applies_to_failure_types: [format_error, missing_output, logic_gap]
    max_uses: 2
  - kind: evidence_patch
    applies_to_failure_types: [missing_evidence]
    max_uses: 1
  - kind: model_escalation
    applies_to_failure_types: [logic_gap, model_capability_limit]
    max_uses: 1
    guarded_by: "$.attempts >= 2"
  - kind: human_checkpoint
    applies_to_failure_types: [ambiguous_requirement, review_rule_too_strict, tool_error, unknown]
    max_uses: 1
```

> 与 `repair_patch.md` D-RP-1 / D-NC-4 一致：Phase 1 RepairAgent 仅产 `prompt_patch / context_patch / evidence_patch / model_escalation` 四类；`workflow_patch / human_checkpoint` 由 Engine 直接生成。

---

## 10. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-FT-1 | `FailureType` 枚举固定 8+1 类；不允许 spec 之外扩充至 v0.2 |
| D-FT-2 | 多类同时命中按 §3 优先级矩阵裁决，仅取一个最终 `failure_type`；自定义诊断进 `tags / metadata` |
| D-FT-3 | `tool_error` 不由 RepairAgent 产 patch；强制走 human_checkpoint（与技术架构 §7.3 一致） |
| D-FT-4 | `ambiguous_requirement / review_rule_too_strict / unknown` 立即转 human_checkpoint，不进入 model_escalation |
| D-FT-5 | `model_capability_limit` 升级链耗尽即 human_checkpoint；不允许"原地无限重试" |
| D-FT-6 | `NodeContract.failure_taxonomy` 子集声明优先；不在子集内的失败统一归 `unknown`（与 D-NC-6 一致） |
| D-FT-7 | `multi-judge disagreement_score ≥ 0.5` 不论 logic_gap 是否升级，强制 human_checkpoint（与 D-ER-5 一致） |
| D-FT-8 | ReflectionMemory 写回规则按 §6 表执行；`tool_error` 不写 `patch_pattern`（避免污染） |
| D-FT-9 | 错误码命名空间 17 套（WG/NC/CP/EP/ER/RP/SE/AA/MR/RM/CB/EB/OB/RH/PS/API + 通用），新增必须在对应 spec 锁定再回填本表 |

---

## 11. 与未来 spec 的桥接

- `specs/tools/citation_checker.md`（待）：`missing_evidence` 检测器的实现规范
- `specs/state_machines/workflow_run.md`（待）：WorkflowRun 自身状态机；本 spec 的 `human_checkpoint` 路径会触发 `state=waiting_user`
- `specs/runtime_harness.md` D-RH-2 / D-RH-3 等约束在本 spec 里被强制（如 sensitive 路径的 hard fail）

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-FT-1 ~ D-FT-9；汇总 16 份已锁定 spec 的失败枚举与错误码 |
