# Spec: RepairPatch

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-schema-006` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §2.3 / §3.2 / §5（修复 Task）；技术架构 v1.0 §3 / §6.5 / §7（标准执行链路 + 失败类型）；UIUX v1.1 §11（节点状态机 `repairing` / `retrying`） |
| 关联 spec | `specs/schemas/evaluation_result.md`（输入）、`specs/schemas/node_contract.md`（消费方：repair 契约 / 被修复节点的 prompt/context/model）、`specs/schemas/context_pack.md` & `evidence_pack.md`（被 patch 触发重建）、`specs/schemas/workflow_graph.md`（workflow_patch 类型作用域） |
| 关联 ADR | ADR-0002、ADR-0005 |

> **范围**：定义 `RepairPatch` 数据对象——修复节点（`repair_task`）的输出协议。它是**6 类策略的统一容器**：从最轻量的 prompt 微调，到最重量的工作流结构性修改、模型升级、转人工。
>
> **非范围**：
> - 修复节点契约（见 `node_contract.md` §1.2.3）
> - 应用 Patch 后被修改对象的 schema（见各自 spec）
> - 修复策略选择算法（属于 RepairAgent 实现，受本 spec 与 NodeContract 约束）
>
> **核心立场**：失败不是终点，而是反馈信号；Patch 是把"诊断"翻译成"具体修改动作"的桥梁（00_Concept §2.3 / §5）。**Patch 必须是最小修改 + 可回放 + 可回滚**——不能是"重写整个节点"（D-NC-4 已限制 Phase 1 不允许 contract_patch）。

---

## 0. 设计原则

1. **最小修改原则**：Patch 只针对失败诊断指出的字段；禁止"顺手优化"，避免引入新失败。
2. **6 类策略不可越界**：`patch_kind` 固定 6 类；任何"组合 / 嵌套 / 自定义"必须由 Engine 拆成多次 Patch 顺序应用。
3. **`workflow_patch` / `human_checkpoint` 不由 RepairAgent 直接产出**（D-NC-4）：Phase 1 这两类由 Engine 在 EvaluationResult 路由阶段决定；RepairAgent 只能在自己契约允许的策略子集（默认 `prompt_patch / context_patch / evidence_patch / model_escalation`）内输出。
4. **可回放**：Patch 是**纯数据**（JSON-serializable）；应用 Patch 与 NodeContract 解耦；同一份 EvaluationResult + 同一份 attempts_window 输入应产生**等价** Patch。
5. **可回滚**：每个 Patch 应用前后必须能产生反向操作（用于 attempt 失败回退、用户手动撤销）；反向由 Engine 根据 patch_kind 推导，不存在用户级的"undo Patch 内容"操作。
6. **Engine 持有应用语义**：RepairAgent 给出的是"目标变更"的声明（operations），Engine 翻译为底层动作（重建 ContextPack / 切换 Model / 注入修订后 prompt）；RepairAgent 不直接调用任何对象。
7. **闭环可观测**：Patch 应用前后必须分别产生 NodeAttempt（被修复节点的下一次 attempt 必须能回查到本 Patch ID）；每个 Patch 产生一条 `patch.applied` 事件流。

---

## 1. 顶层结构 `RepairPatch`

### 1.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `patch_id` | `string` (ULID) | ✅ | — | 全局唯一 |
| `schema_version` | `string` | ✅ | `0.1.0` | 本 spec 版本 |
| `repair_node_id` | `string` | ✅ | — | 产生本 Patch 的 repair_task 节点 ID |
| `repair_attempt_id` | `string` | ✅ | — | repair_task 的本次 attempt ID |
| `target_node_id` | `string` | ✅ | — | 被修复的目标节点 ID |
| `evaluation_id` | `string` | ✅ | — | 触发本 Patch 的 EvaluationResult ID |
| `run_id` | `string` | ✅ | — | 关联 WorkflowRun |
| `patch_kind` | `RepairKind` | ✅ | — | 6 类之一；详见 §2 |
| `addresses_failure_types` | `FailureType[]` | ✅ | — | 本 Patch 试图修复的失败类型；与 EvaluationResult.failure_diagnosis.failure_type 兼容 |
| `operations` | `Operation[]` | ✅ | — | 修改动作列表；每种 patch_kind 有自己的 Operation schema；详见 §2 |
| `expected_effect` | `string` (≤2000) | ✅ | — | 简要预期效果（人类可读，不进 prompt） |
| `rationale` | `string` (≤4000) | ❌ | `""` | 详细推理（仅供审计） |
| `applies_to_attempts` | `string[]` | ❌ `[]` | — | 设计上影响哪些 attempt（多用于 prompt_patch 临时 vs 永久） |
| `scope` | `enum: this_attempt_only / until_pass / persistent_for_run / persistent_for_workflow` | ✅ | `until_pass` | 影响范围；详见 §3 |
| `expires_at` | `string` (ISO-8601) \| `null` | ❌ | `null` | scope=this_attempt_only 时填写到期点；超过则失效 |
| `risk_level` | `enum: low / medium / high` | ✅ | — | Engine 据此决定是否需要人工二次确认 |
| `reversal_hint` | `ReversalHint | null` | ❌ | `null` | 反向操作提示；为 null 时由 Engine 推导 |
| `provenance` | `RepairProvenance` | ✅ | — | 来源；详见 §6 |
| `metadata` | `object` | ❌ | `{}` | 命名空间化扩展字段 |

### 1.2 不变量

- `patch_kind` ∈ 节点 `NodeContract.repair.repair_strategies[*].kind` 子集（D-NC-4）；否则 Engine 拒绝应用并降级 `human_checkpoint`
- `operations` 数量 ≥ 1；空 operations 视为非法
- `addresses_failure_types` 必须 ⊆ EvaluationResult.failure_diagnosis 推导出的可修类型集合
- `risk_level=high` 时 `scope` 不允许 `persistent_for_workflow`（避免单次修复永久污染图）
- 应用 Patch 时被修改对象（NodeContract 内的某些字段、ContextPack、EvidencePack 等）必须能产生**新版本**对象；禁止就地改写
- `model_escalation` Patch 不允许 `scope=this_attempt_only`（升级模型后必须至少 `until_pass`）

---

## 2. 6 类策略与各自 `Operation` 形态

### 2.1 `prompt_patch`

修改被修复节点的提示词（`NodeContract.prompt.system_prompt / instructions / user_prompt_template` 的局部）。**最常用、最轻量**的修复。

| Operation | 说明 |
|---|---|
| `append_to_system_prompt` | `{ "op": "append_to_system_prompt", "text": string }` |
| `append_to_instructions` | `{ "op": "append_to_instructions", "text": string }` |
| `append_to_user_prompt_template` | `{ "op": "append_to_user_prompt_template", "text": string }` |
| `add_few_shot_example` | `{ "op": "add_few_shot_example", "example_input": object, "example_output": object, "rationale": string }` |
| `add_output_format_hint` | `{ "op": "add_output_format_hint", "kind": "schema_only / schema_with_example / few_shot", "examples"?: object[], "style_notes"?: string }` |
| `tighten_constraint` | `{ "op": "tighten_constraint", "constraint_text": string }`（注：仅追加约束，不修改既有 prompt） |

应用语义（Engine）：
- 产生新版 `NodeContract.prompt.*` 字段（不修改原契约对象，作为下一次 attempt 的有效契约）
- 写入 attempt 的 `effective_prompt_overlay` 字段，便于 NodeAttempt 回放

### 2.2 `context_patch`

不改 prompt，改"模型看到什么"。触发 ContextBuilder 重建 ContextPack。

| Operation | 说明 |
|---|---|
| `add_context_requirement` | `{ "op": "add_context_requirement", "requirement": ContextRequirement }` |
| `remove_context_requirement` | `{ "op": "remove_context_requirement", "requirement_key": string }` |
| `update_context_requirement` | `{ "op": "update_context_requirement", "requirement_key": string, "patch": Partial<ContextRequirement> }` |
| `bump_priority` | `{ "op": "bump_priority", "fragment_kind"?: FragmentKind, "from": "low/normal/high", "to": "normal/high/critical" }` |
| `summarize_long_fragments` | `{ "op": "summarize_long_fragments", "above_tokens": int, "target_tokens": int }` |
| `pin_upstream_artifact` | `{ "op": "pin_upstream_artifact", "from_node_id": string, "artifact_field": string, "as_key": string }` |

应用语义：
- 产生**新版** ContextPack（`pack_id` 派生）
- 必须重新计算 `provenance.requirements_hash` 与 `pack_hash`
- 不改写 EvidencePack（除非 patch_kind=`evidence_patch`）

### 2.3 `evidence_patch`

修复"事实来源边界"。不改 prompt，不改 ContextPack 主结构（仅其中的 evidence 片段），改 EvidencePack。

| Operation | 说明 |
|---|---|
| `add_topic_coverage` | `{ "op": "add_topic_coverage", "topic": string, "min_evidences"?: int }` |
| `replace_evidence_set` | `{ "op": "replace_evidence_set", "criterion_id": string, "min_count": int }` |
| `tighten_relevance_threshold` | `{ "op": "tighten_relevance_threshold", "min_relevance": number }`（重 re-rank） |
| `tighten_confidence_threshold` | `{ "op": "tighten_confidence_threshold", "min_confidence": number }` |
| `mark_conflict_resolved` | `{ "op": "mark_conflict_resolved", "conflict_id": string, "resolution_note": string }` |
| `inject_evidence_lookup_tool` | `{ "op": "inject_evidence_lookup_tool" }`（强制添加 evidence_lookup 工具） |

应用语义：
- 触发 EvidenceBuilder 重建 EvidencePack（`pack_id` 派生）
- 同步重建 ContextPack（继承新 EvidencePack）
- 写入 NodeContract 的 `evidence_requirements_overlay`（仅 attempt 范围）

### 2.4 `model_escalation`

把被修复节点的本次 attempt 切换到能力更强 / 上下文更长 / 工具更全的模型。

| Operation | 说明 |
|---|---|
| `switch_to_model_profile` | `{ "op": "switch_to_model_profile", "model_profile_id": string, "reason": string }` |
| `bump_temperature` | `{ "op": "bump_temperature", "delta": number, "min"?: number, "max"?: number }`（仅允许小幅调整） |
| `enable_thinking` | `{ "op": "enable_thinking", "level": "low/medium/high" }` |
| `extend_max_output_tokens` | `{ "op": "extend_max_output_tokens", "value": int }` |

应用语义：
- 仅影响后续 attempt（不可回到上次失败的同一 attempt）
- `switch_to_model_profile` 必须 ∈ `WorkflowModelPolicy.escalation_chain` ∪ 节点 `model_policy.escalation_chain`；越权拒绝
- 升级后若仍触发 `model_capability_limit`，Engine 进入 `human_checkpoint`

### 2.5 `workflow_patch`（Phase 1 限制）

> **D-NC-4 决定**：Phase 1 RepairAgent **不直接产出**此类 Patch；Engine 在 `failure_type ∈ {logic_gap (拆节点) / review_rule_too_strict}` 等场景下**自行**生成 workflow_patch（工程内部使用），并要求人工确认。本 spec 仍定义其形态，便于 Engine 内部使用与 Phase 3 开放给 RepairAgent。

| Operation | 说明 |
|---|---|
| `insert_node` | `{ "op": "insert_node", "node": WorkflowNode, "after_node_id": string }` |
| `remove_node` | `{ "op": "remove_node", "node_id": string }` |
| `update_node` | `{ "op": "update_node", "node_id": string, "changes": Partial<WorkflowNode> }` |
| `insert_edge` | `{ "op": "insert_edge", "edge": WorkflowEdge }` |
| `remove_edge` | `{ "op": "remove_edge", "edge_id": string }` |
| `relax_review_rule` | `{ "op": "relax_review_rule", "evaluation_node_id": string, "criterion_id": string, "new_severity": "blocker/major/minor/info" }` |
| `split_node` | `{ "op": "split_node", "node_id": string, "split_into": [{ "title": string, "goal": string, ... }, ...] }` |

应用语义：
- 必须由人工确认（生成隐式 `human_checkpoint`）
- 改写后的 WorkflowGraph 写入新 SemVer（`+0.0.1`）；前一版本保留为快照

### 2.6 `human_checkpoint`（Phase 1 限制）

> **D-NC-4 决定**：Phase 1 不由 RepairAgent 直接产出；由 Engine 在路由阶段直接插入。本 spec 仍定义其形态，避免 Phase 3 之后再做破坏性变更。

| Operation | 说明 |
|---|---|
| `request_user_decision` | `{ "op": "request_user_decision", "prompt_to_user": string, "decisions": HumanDecision[], "default_decision"?: HumanDecisionKey }` |
| `request_user_edit` | `{ "op": "request_user_edit", "target_artifact_path": string, "edit_hint": string }` |
| `request_user_input` | `{ "op": "request_user_input", "input_schema": JSONSchema, "prompt_to_user": string }` |
| `request_user_clarification` | `{ "op": "request_user_clarification", "question": string, "candidate_answers"?: object[] }` |

---

## 3. `scope` 与 `applies_to_attempts`

| `scope` | 持续范围 | 应用对象 |
|---|---|---|
| `this_attempt_only` | 仅下一次 attempt（一次性） | NodeAttempt 级 overlay |
| `until_pass` | 到该节点 passed 为止 | NodeAttempt 级 overlay，命中 pass 后撤销 |
| `persistent_for_run` | 整个 WorkflowRun | 写入 `runs/<run_id>/run_overlay.json` |
| `persistent_for_workflow` | 永久（产生 Workflow 新版本） | 触发 Workflow SemVer 提升 |

`applies_to_attempts` 用于精确指定（例如同时给本次 attempt 与下一次 attempt 应用相同 prompt_patch）。当 `scope=this_attempt_only` 时本字段为唯一权威来源。

---

## 4. `ReversalHint`

每个 Patch 应用都需要可回滚。Engine 优先使用 `reversal_hint`，否则按 patch_kind 自动推导：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mode` | `enum: auto / explicit / non_reversible` | ✅ | non_reversible 仅允许 `model_escalation` 因为模型已被调用 |
| `inverse_operations` | `Operation[]` | ❌ | mode=explicit 时手动写出反向 Operation |
| `notes` | `string | null` | ❌ | 反向操作时的注意事项 |

默认推导规则：
- `prompt_patch` / `context_patch` / `evidence_patch`：丢弃 overlay 即回滚（auto）
- `workflow_patch`：必须 explicit；Engine 拒绝 mode=auto
- `model_escalation` / `human_checkpoint`：non_reversible（向前操作）

---

## 5. 与 EvaluationResult 的输入映射

RepairAgent 默认接收以下输入（由 Engine 装入 ContextPack）：

| EvaluationResult 字段 | 在 RepairAgent.deps 中的访问键 |
|---|---|
| `failure_diagnosis.failure_type` | `deps.failure_type` |
| `failure_diagnosis.failed_criteria` | `deps.failed_criteria` |
| `failure_diagnosis.summary` | `deps.failure_summary` |
| `failure_diagnosis.suggested_repair_targets` | `deps.targets` |
| `criterion_results[*].findings` | `deps.findings` |
| `evidence_feedback` | `deps.evidence_feedback` |
| `recommended_strategy` | `deps.suggested_strategy_kind` |

RepairAgent **仅参考**这些建议；最终选择由其自身根据 `NodeContract.repair.repair_strategies` 决定。

---

## 6. `RepairProvenance`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `repair_started_at` | `string` (ISO-8601) | ✅ | — |
| `repair_finished_at` | `string` (ISO-8601) | ✅ | — |
| `repair_model_profile_id` | `string` | ✅ | — |
| `attempts_window_used` | `int` | ✅ | RepairAgent 实际看了几次 attempts |
| `evaluation_id` | `string` | ✅ | 与顶层 `evaluation_id` 一致（冗余便于 jsonl 检索） |
| `usage` | `RunUsage | null` | ❌ | — |
| `patch_hash` | `string` | ✅ | RepairPatch 整体（去时间戳）的稳定 hash |

---

## 7. 与 NodeContract.repair 的字段映射

| NodeContract.repair | RepairPatch |
|---|---|
| `repair_strategies[*].kind` | 限定 `patch_kind` 取值 |
| `repair_strategies[*].applies_to_failure_types` | 限定 `addresses_failure_types` 子集 |
| `repair_strategies[*].max_uses` | Engine 在 run 范围内累计计数；超过则 RepairAgent 不能再选该策略 |
| `repair_strategies[*].guarded_by` | Engine 在 attempt 装填 deps 之前求值；不通过则该策略对 RepairAgent 不可见 |
| `output_patch_schema` | RepairPatch.operations 的形态限制（在节点内进一步缩窄默认 schema） |
| `attempts_window` | RepairAgent 接收的最近 N 次 attempt |
| `model_escalation_allowed` | 限定是否可产 `model_escalation` patch_kind |

---

## 8. 与 Pydantic AI 的 Adapter 边界

RepairAgent 通常落为 `Agent(output_type=RepairPatch)`：

- `RunContext.deps` 装入 `RepairDeps`（见 §5）
- 模型直接产出符合 RepairPatch Pydantic 模型的 JSON
- `addresses_failure_types` / `patch_kind` / `operations[*].op` 必须通过 Pydantic 模型层的 `Discriminator` + `model_validator` 强制
- Engine 在收到 RepairPatch 后做"3 道防线"校验：
  1. patch_kind ∈ NodeContract.repair_strategies[*].kind
  2. addresses_failure_types ⊆ 当前 EvaluationResult 推导出的可修集合
  3. operations 内每个 op 在 §2 已声明并满足 schema
- 校验未通过：Engine 自动降级为 `human_checkpoint`，并把违规 patch 落 `runs/<run_id>/repairs.jsonl` 标记 rejected

---

## 9. JSON 示例

### 9.1 `prompt_patch`（最常见路径）

```json
{
  "patch_id": "rp_01J9N5TC4M...",
  "schema_version": "0.1.0",
  "repair_node_id": "n_repair",
  "repair_attempt_id": "att_01J9N5TC4M...",
  "target_node_id": "n_extract",
  "evaluation_id": "evr_01J9N5T9KQ...",
  "run_id": "run_01J9N5SXAA...",
  "patch_kind": "prompt_patch",
  "addresses_failure_types": ["logic_gap"],
  "operations": [
    {
      "op": "tighten_constraint",
      "constraint_text": "每个研究问题必须包含：(1) 限定地理范围（国家/地区）；(2) 限定时间窗口（年/季）；(3) 至少一个可量化指标。"
    },
    {
      "op": "add_few_shot_example",
      "example_input": {"project_goal": "评估低空经济中无人机交付", "reference_summary": ["..."]},
      "example_output": {
        "research_questions": [
          {"question": "在 2024–2026 年中国 1500 米以下空域，多机协同无人机交付的平均订单延误时间相对单机交付的下降幅度是多少？",
           "source_evidence_ids": ["ev_001"], "uncertainty": "样本规模有限", "priority": "high"}
        ]
      },
      "rationale": "示范地理 + 时间 + 指标三要素的研究问题写法"
    }
  ],
  "expected_effect": "下次 attempt 中 'researchable' criterion 通过率应显著提升",
  "rationale": "诊断为 logic_gap，问题过于宽泛；通过约束 + 一个示例引导模型提供可证伪边界。",
  "scope": "until_pass",
  "applies_to_attempts": [],
  "expires_at": null,
  "risk_level": "low",
  "reversal_hint": {"mode": "auto", "inverse_operations": null, "notes": null},
  "provenance": {
    "repair_started_at": "2026-06-15T08:36:01Z",
    "repair_finished_at": "2026-06-15T08:36:05Z",
    "repair_model_profile_id": "claude-sonnet-repair",
    "attempts_window_used": 1,
    "evaluation_id": "evr_01J9N5T9KQ...",
    "usage": {"input_tokens": 1422, "output_tokens": 312},
    "patch_hash": "phash_rp_8a91..."
  },
  "metadata": {}
}
```

### 9.2 `evidence_patch`

```json
{
  "patch_id": "rp_01J9N5TD8F...",
  "schema_version": "0.1.0",
  "repair_node_id": "n_repair",
  "repair_attempt_id": "att_01J9N5TD8F...",
  "target_node_id": "n_extract",
  "evaluation_id": "evr_01J9N5T9KQ...",
  "run_id": "run_01J9N5SXAA...",
  "patch_kind": "evidence_patch",
  "addresses_failure_types": ["missing_evidence"],
  "operations": [
    {"op": "add_topic_coverage", "topic": "policy_environment", "min_evidences": 2},
    {"op": "tighten_relevance_threshold", "min_relevance": 0.7},
    {"op": "inject_evidence_lookup_tool"}
  ],
  "expected_effect": "policy_environment 主题至少 2 条 relevance≥0.7 的证据，模型可按需检索",
  "scope": "until_pass",
  "risk_level": "low",
  "reversal_hint": {"mode": "auto"},
  "provenance": {
    "repair_started_at": "2026-06-15T08:36:01Z",
    "repair_finished_at": "2026-06-15T08:36:04Z",
    "repair_model_profile_id": "claude-sonnet-repair",
    "attempts_window_used": 1,
    "evaluation_id": "evr_01J9N5T9KQ...",
    "patch_hash": "phash_rp_91be..."
  },
  "metadata": {}
}
```

### 9.3 `model_escalation`

```json
{
  "patch_id": "rp_01J9N5TFA6...",
  "schema_version": "0.1.0",
  "repair_node_id": "n_repair",
  "repair_attempt_id": "att_01J9N5TFA6...",
  "target_node_id": "n_extract",
  "evaluation_id": "evr_01J9N5T9KQ...",
  "run_id": "run_01J9N5SXAA...",
  "patch_kind": "model_escalation",
  "addresses_failure_types": ["logic_gap", "model_capability_limit"],
  "operations": [
    {"op": "switch_to_model_profile", "model_profile_id": "claude-opus-strong",
     "reason": "本节点连续 2 次因 logic_gap 失败，升级为 opus 重试"},
    {"op": "enable_thinking", "level": "medium"}
  ],
  "expected_effect": "opus + thinking medium 应能在论证完整度上突破中等模型上限",
  "scope": "until_pass",
  "risk_level": "medium",
  "reversal_hint": {"mode": "non_reversible"},
  "provenance": {
    "repair_started_at": "2026-06-15T08:36:11Z",
    "repair_finished_at": "2026-06-15T08:36:14Z",
    "repair_model_profile_id": "claude-sonnet-repair",
    "attempts_window_used": 2,
    "evaluation_id": "evr_01J9N5T9KQ...",
    "patch_hash": "phash_rp_aa01..."
  },
  "metadata": {}
}
```

---

## 10. 应用流程（Engine）

```
1. Engine 收到 RepairPatch p
2. 校验 p.patch_kind ∈ 节点 repair_strategies[*].kind          → 否则 reject + human_checkpoint
3. 校验 p.addresses_failure_types ⊆ 评价推导可修集合           → 否则 reject + human_checkpoint
4. 校验 p.operations 全部满足 §2 schema 与允许的子动作         → 否则 reject + human_checkpoint
5. 校验 risk_level=high & scope=persistent_for_workflow 互斥    → 违反则降级 scope=persistent_for_run
6. 计算反向：若 reversal_hint.mode=auto → Engine 推导反向；mode=explicit → 验证 inverse_operations 合法
7. 应用：
   - prompt_patch / context_patch / evidence_patch → 产生 attempt overlay 或新版 ContextPack/EvidencePack
   - workflow_patch → 生成 WorkflowGraph 新版本（SemVer +0.0.1） + 强制 human_checkpoint
   - model_escalation → 切换 attempt 模型 + 写入 attempt overlay
   - human_checkpoint → 暂停 + 发出 stream event human_gate_required
8. 写 runs/<run_id>/repairs.jsonl + 标记 attempt 关联 patch_id
9. 启动 target_node 的下一次 attempt（model_escalation 与 prompt/context/evidence 类除外，由 Engine 决定何时拉起）
10. 计数 NodeContract.repair_strategies[*].max_uses
```

---

## 11. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `RP_BUILD_KIND_NOT_ALLOWED` | 构建 | patch_kind 不在节点策略子集 |
| `RP_BUILD_ADDR_FAILURE_TYPES_NOT_ALLOWED` | 构建 | addresses_failure_types 含未授权类型 |
| `RP_BUILD_EMPTY_OPERATIONS` | 构建 | operations 为空 |
| `RP_BUILD_BAD_OPERATION_SCHEMA` | 构建 | 某 op 不符合 §2 形态 |
| `RP_BUILD_RISK_HIGH_PERSISTENT_FORBIDDEN` | 构建 | risk_level=high 且 scope=persistent_for_workflow |
| `RP_BUILD_MODEL_NOT_IN_ESCALATION_CHAIN` | 构建 | switch_to_model_profile 不在升级链 |
| `RP_BUILD_REVERSAL_NEEDED` | 构建 | workflow_patch 但 reversal_hint.mode=auto |
| `RP_BUILD_OVER_MAX_USES` | 构建 | 节点级 max_uses 已耗尽 |
| `RP_APPLY_TARGET_NOT_FOUND` | 应用 | target_node_id 找不到 |
| `RP_APPLY_OVERLAY_CONFLICT` | 应用 | 同 attempt 多个 patch 互斥 |
| `RP_APPLY_NO_NEW_VERSION_FOR_WORKFLOW_PATCH` | 应用 | workflow_patch 未产生新 Workflow 版本（实现错误） |

---

## 12. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-RP-1 | RepairPatch 的 patch_kind 固定 6 类，禁止自定义；Phase 1 RepairAgent 仅可输出 `prompt_patch / context_patch / evidence_patch / model_escalation` 4 类（D-NC-4） |
| D-RP-2 | Patch 内容与执行解耦；RepairAgent 只声明"想改成什么"，Engine 翻译为底层动作 |
| D-RP-3 | 每个 Patch 必须可回滚或显式标注 `non_reversible`（仅允许 `model_escalation` / `human_checkpoint`） |
| D-RP-4 | `risk_level=high` 时 `scope` 不允许 `persistent_for_workflow`，避免单次修复永久污染图 |
| D-RP-5 | `model_escalation` 必须 ∈ Workflow / 节点的 escalation_chain；越权直接拒绝 |
| D-RP-6 | Patch 应用前由 Engine 跑"3 道防线"校验（kind / addresses / operations）；任意一道未通过降级 `human_checkpoint` |
| D-RP-7 | `applies_to_attempts` 为空时按 `scope` 推导；二者冲突时以 `applies_to_attempts` 优先（局部精确语义优先于全局） |
| D-RP-8 | 节点 `repair_strategies[*].max_uses` 在 run 范围内累计，跨节点不共享；Phase 1 不允许 workflow 级共享 |

---

## 13. 与未来 spec 的桥接

- `evaluation_result.md`：本 Patch 的输入；EvaluationResult.recommended_action 决定是否走 Repair 路径
- `stream_event.md`：每个 Patch 应用产生 `repair` / `repair_applied` 类型 StreamEvent（含 patch_id、kind、scope）
- `reflection_memory.md`：成功 Patch（其后下一次 attempt passed=true）写入反思记忆，作为同类失败模式的优先建议
- `runtime_harness.md`：本 Patch 落 `runs/<run_id>/repairs.jsonl`；attempt overlay 落 `runs/<run_id>/attempts.jsonl` 关联
- `agent_adapter.md`：PydanticAIAdapter 在 RepairAgent 路径上不允许直接 import 外部修改函数；只能通过 RepairPatch 表达意图

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-RP-1 ~ D-RP-8；对齐技术架构 v1.0 §3/§6.5/§7 与 00_Concept §2.3/§3.2/§5；与 NodeContract D-NC-4 一致 |
