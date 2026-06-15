# Spec: EvaluationResult

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-schema-005` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §3.2（评价 Task 的输出要求）；技术架构 v1.0 §3 / §6.4 / §7.3（失败类型）/ §9（多 Agent 辩论）；UIUX v1.1 §18.8.2 |
| 关联 spec | `specs/schemas/node_contract.md`（消费方：evaluation 契约）、`specs/schemas/repair_patch.md`（同期产出，由本 spec 触发）、`specs/schemas/context_pack.md` / `evidence_pack.md`（被读取作为审查依据）、`specs/schemas/workflow_graph.md`（pass/fail 路由消费方） |
| 关联 ADR | ADR-0002、ADR-0005 |

> **范围**：定义 `EvaluationResult` 数据对象——评价节点（`evaluation_task`）的输出协议。它既是**节点产物**（写入 NodeAttempt），也是**路由信号**（驱动 pass/fail/repair/human），同时还是**修复输入**（被 RepairAgent 读取生成 RepairPatch）。
>
> **非范围**：
> - 评价节点契约本身（见 `node_contract.md` §1.2.2）
> - 评价模型的选择策略（见 `specs/protocols/model_router.md`，待）
> - CitationChecker / SchemaStrict 等具体校验器实现（见 `specs/tools/`，待）
>
> **核心立场**：评价的输出**必须结构化**（00_Concept §3.2）。"通过 / 不通过"只是其中一个比特位，更重要的是 `failure_type / failed_criteria / severity / recommended_strategy / rationale` 这五项形成的**可被修复 / 可被审计的诊断**。本 spec 的每个字段都应能回答：评价为什么这么判？该怎么修？是不是该升级模型或叫人？

---

## 0. 设计原则

1. **路由由数据决定，不由模型话术决定**：`passed: bool` + `failure_type` 是 Engine 决定下游路径的唯一依据；模型的 `rationale` 仅供人类审计。
2. **一次评价 = 一次 attempt**：每次评价都产生独立的 `EvaluationResult`，不允许"渐进式"评价（即评价过程中不可写入两次）。多次评价（重审 / 仲裁）通过多次 attempt + 仲裁聚合体现。
3. **失败类型固定 8 类（+ unknown）**：与技术架构 §7.3 对齐，不允许节点自定义新的 failure_type；自定义诊断信息进入 `tags` / `metadata`。
4. **Criterion 级别可定位**：每条 criterion 独立给分、独立通过判定；blocker 一票否决（与 NodeContract D-NC-6 对应）。
5. **EvidencePack 反向反馈**：评价过程必须回填 `EvidencePack.coverage.unsupported_claim_estimates`（D-EP-5），让下次构建可见上次的薄弱点。
6. **Adapter 中立**：EvaluationResult 是 EvaluationAgent 的 output_type；Pydantic AI 的角色仅是把它**校验为 Pydantic 模型**。Engine 不读 prompt，只读这个对象。
7. **可审计**：每个 criterion 的判定必须能反查到所用 evaluator（rubric 模型 / 程序化 validator / 多 judge id），不允许"黑盒结果"。
8. **可重放**：相同 NodeContract.evaluation 契约 + 相同上游 Artifact + 相同 EvidencePack + 相同评价模型设置应产生**同质** EvaluationResult（passed 与 failure_type 一致；分数允许 ±1% 偏差）。

---

## 1. 顶层结构 `EvaluationResult`

### 1.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `eval_id` | `string` (ULID) | ✅ | — | 全局唯一 |
| `schema_version` | `string` | ✅ | `0.1.0` | 本 spec 版本 |
| `evaluator_node_id` | `string` | ✅ | — | 产生本结果的评价节点 ID |
| `target_node_id` | `string` | ✅ | — | 被审查节点 ID（与 evaluation 契约的 `target_node_id` 对齐） |
| `target_attempt_id` | `string` | ✅ | — | 被审查节点的具体 attempt |
| `evaluator_attempt_id` | `string` | ✅ | — | 评价节点本次 attempt（用于反查 ContextPack / model） |
| `run_id` | `string` | ✅ | — | 关联 WorkflowRun |
| `passed` | `bool` | ✅ | — | 综合通过标志；由 PassCondition / FailCondition 计算 |
| `score` | `number` (0..1) | ✅ | — | 综合得分；当 PassCondition.combinator≠`weighted_score` 时仍需给出（用 `passed_blockers ? 1 : 0` 与可选项均值的简单合成） |
| `criterion_results` | `CriterionResult[]` | ✅ | — | 每条 criterion 的判定；详见 §2 |
| `failure_diagnosis` | `FailureDiagnosis | null` | 当 `passed=false` 时必填 | — | 失败诊断；详见 §3 |
| `recommended_strategy` | `RepairStrategyKind | null` | ❌ | `null` | 建议的修复策略；从 `NodeContract.repair_strategies` 中选择 |
| `recommended_action` | `RecommendedAction` | ✅ | — | 路由建议；详见 §4 |
| `arbitration` | `ArbitrationOutcome | null` | ❌ | `null` | 多 judge 仲裁过程记录；单 judge 时为 null |
| `evidence_feedback` | `EvidenceFeedback | null` | ❌ | `null` | 写回 EvidencePack 的反馈（D-EP-5） |
| `usage` | `RunUsage | null` | ❌ | `null` | 评价节点的 token 用量（来自 Pydantic AI RunUsage） |
| `provenance` | `EvalProvenance` | ✅ | — | 评价过程的源信息；详见 §6 |
| `metadata` | `object` | ❌ | `{}` | 命名空间化扩展字段 |

### 1.2 不变量

- `passed=true` ⇔ 满足 `NodeContract.evaluation.pass_condition` 且不满足 `fail_condition`
- 任意 `criterion_results[i].severity=blocker && passed_for_this_criterion=false` ⇒ `passed=false`（D-NC-6 一票否决）
- `passed=false` 时 `failure_diagnosis` 必填，且 `failure_diagnosis.failure_type` 必须 ∈ §3.2 枚举（含 `unknown`）
- `score` ∈ [0,1]；保留 4 位小数
- `recommended_strategy` 必须 ∈ `NodeContract.evaluation` 关联的 `repair_target_node` 节点的 `repair_strategies[*].kind`，否则 Engine 视为越权建议并降级为 `human_checkpoint`

---

## 2. `CriterionResult`

### 2.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `criterion_id` | `string` | ✅ | 与 `NodeContract.evaluation.criteria[*].criterion_id` 对齐 |
| `description` | `string` | ✅ | 复制自契约（便于审计快速阅读） |
| `kind` | `enum: rubric / programmatic / regex / schema / citation / numeric_threshold` | ✅ | 评价方式（继承自契约） |
| `severity` | `enum: blocker / major / minor / info` | ✅ | 继承自契约 |
| `weight` | `number` (0..1) | ✅ | 继承自契约 |
| `passed_for_this_criterion` | `bool` | ✅ | 单项判定 |
| `score_for_this_criterion` | `number` (0..1) | ✅ | 单项分数；布尔判定时取 0/1 |
| `evaluator_kind` | `enum: llm_rubric / programmatic_validator / hybrid / human` | ✅ | 实际执行该 criterion 的评估方式 |
| `evaluator_ref` | `string | null` | ❌ | 具体 evaluator 的标识（如 LLM judge 的 model_profile_id 或 ToolRegistry 的 validator_id） |
| `findings` | `Finding[]` | ❌ `[]` | 检测到的问题列表（每个 Finding 独立可定位） |
| `evidence_used_ids` | `string[]` | ❌ `[]` | 评价过程引用的 EvidencePack 内 evidence_id 子集 |
| `tokens_estimate` | `int | null` | ❌ | 该 criterion 评价所耗 token（仅 LLM 类） |
| `latency_ms` | `int | null` | ❌ | 单项耗时 |

### 2.2 `Finding`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `finding_id` | `string` | ✅ | 局部唯一 |
| `kind` | `enum: format_violation / missing_field / wrong_type / unsupported_claim / dangling_citation / numeric_out_of_range / regex_mismatch / rubric_violation / schema_violation` | ✅ | 问题种类 |
| `path` | `string | null` | ❌ | JSONPath 指向被审产物中的具体位置 |
| `message` | `string` | ✅ | 简明描述 |
| `severity` | `enum: blocker / major / minor / info` | ✅ | 该 finding 自身严重度（可低于 criterion.severity） |
| `proposed_fix_hint` | `string | null` | ❌ | 仅作为 RepairAgent 的提示，不是修复指令 |
| `related_evidence_ids` | `string[]` | ❌ | 涉及的 evidence |

---

## 3. `FailureDiagnosis`

### 3.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `failure_type` | `FailureType` | ✅ | 8 类 + `unknown`；详见 §3.2 |
| `failed_criteria` | `string[]` | ✅ | 失败的 criterion_id（≥1） |
| `severity` | `enum: blocker / major / minor` | ✅ | 综合严重度（取 failed_criteria 中最高） |
| `summary` | `string` (≤2000) | ✅ | 模型生成的失败摘要（人类可读，不进 prompt） |
| `rationale` | `string` (≤4000) | ❌ | 失败推理（更长版本，仅供审计） |
| `suggested_repair_targets` | `string[]` | ❌ | 建议修复哪些产物字段（JSONPath） |
| `tags` | `string[]` | ❌ | 自由标签（如 `domain:robotics`、`pattern:over_generalization`） |

### 3.2 `FailureType` 枚举（与技术架构 §7.3 对齐）

| 值 | 触发场景 | 推荐策略 |
|---|---|---|
| `format_error` | JSON / 表格 / 文件格式不符合 Schema | `prompt_patch` |
| `missing_output` | 必填字段或产物缺失 | `prompt_patch` |
| `missing_evidence` | 关键结论缺少来源；或 EvidencePack 覆盖率不足 | `evidence_patch` |
| `logic_gap` | 论证链断裂、推理不完整、内部矛盾 | `model_escalation` 或 `workflow_patch`（拆节点） |
| `model_capability_limit` | 多次修复仍无法满足 | `model_escalation` 或 `human_checkpoint` |
| `tool_error` | 工具 / 文件 / 网络 / 执行环境错误 | （非 RepairAgent 范畴）由 Engine 修复工具配置 |
| `ambiguous_requirement` | 节点目标 / 标准不清楚 | `human_checkpoint` |
| `review_rule_too_strict` | 规则不可达或互相冲突 | `workflow_patch` 调整规则；记录 |
| `unknown` | 不在以上 8 类之内的诊断（D-NC-6 兜底） | `human_checkpoint` |

> 任何节点 `NodeContract.failure_taxonomy` 字段限定的子集，与本枚举的对应关系：契约子集之外的任意 `failure_type` 一律视为 `unknown`，强制路由人工检查点。

---

## 4. `RecommendedAction`

EvaluationResult 必须给 Engine 一个**明确的下一步动作**，不能仅给 `passed`。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | `enum: pass_to_next / repair_with_patch / retry_same / request_evidence / human_checkpoint / abort` | ✅ | Engine 路由动作 |
| `target_repair_node_id` | `string | null` | 当 `action=repair_with_patch` 时必填 | 指向哪个 repair_task 节点 |
| `target_human_node_id` | `string | null` | 当 `action=human_checkpoint` 时必填 | 指向哪个 human_checkpoint 节点 |
| `note_to_user` | `string | null` | ❌ | 在 UI 上给用户看的简短解释（出现 human_checkpoint 时尤其重要） |

### 4.1 默认推导规则（Engine 在 EvaluationAgent 未给出 `action` 时使用）

```
passed=true
  → action = pass_to_next

passed=false:
  failure_type ∈ {format_error, missing_output}
    → repair_with_patch(target = 默认 repair_task 节点)
  failure_type = missing_evidence
    → request_evidence  (触发 EvidencePack 重建后 retry_same)
  failure_type = logic_gap
    attempts_so_far ≥ ReviewPolicy.escalate_after_repairs ?
      → model_escalation 走 repair 路径
      : repair_with_patch
  failure_type = model_capability_limit
    → 优先 model_escalation；仍不行 → human_checkpoint
  failure_type = tool_error
    → human_checkpoint  (Engine 由工具配置面板介入)
  failure_type = ambiguous_requirement
    → human_checkpoint
  failure_type = review_rule_too_strict
    → human_checkpoint  (规则调整属于元决策)
  failure_type = unknown
    → human_checkpoint
```

EvaluationAgent 显式给出的 `recommended_action` 优先于上述默认规则；但**非法越权**（如指向不存在的节点）由 Engine 校验后降级为 `human_checkpoint`。

---

## 5. `ArbitrationOutcome`（多 judge 仲裁，可选）

当 `NodeContract.evaluation.arbitration ∈ {multi_judge, programmatic_first}` 时填充。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mode` | `enum: single_judge / multi_judge / programmatic_first` | ✅ | 仲裁模式 |
| `judge_count` | `int` (≥1) | ✅ | 实际参与的 judge 数 |
| `judge_results` | `JudgeResult[]` | ✅ | 每个 judge 的独立判定 |
| `aggregation` | `enum: majority / unanimous / programmatic_overrides_llm / weighted` | ✅ | 聚合方式 |
| `disagreement_score` | `number` (0..1) | ✅ | 0 = 完全一致；1 = 完全分歧；指标计算见 §5.2 |
| `final_decision_source` | `string` | ✅ | 决定 `passed` 的最终 judge / 规则标识 |

### 5.1 `JudgeResult`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `judge_id` | `string` | ✅ | 标识（如 `claude-sonnet-judge`、`programmatic_v1`） |
| `judge_kind` | `enum: llm / programmatic / human` | ✅ | — |
| `passed` | `bool` | ✅ | — |
| `score` | `number` (0..1) | ✅ | — |
| `criterion_results` | `CriterionResult[]` | ✅ | 该 judge 给出的逐项结果 |
| `notes` | `string | null` | ❌ | — |

### 5.2 `disagreement_score` 计算

`disagreement_score = 1 - mean_pairwise_agreement(judge_results)`，其中
`pairwise_agreement = sum( weight_c * indicator(passed_c_judgeA == passed_c_judgeB) ) / sum(weight_c)`。

`disagreement_score ≥ 0.5` 时强制升级为 `human_checkpoint`，无论各 judge 的结论。

---

## 6. `EvalProvenance`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `eval_started_at` | `string` (ISO-8601) | ✅ | — |
| `eval_finished_at` | `string` (ISO-8601) | ✅ | — |
| `evaluator_model_profile_id` | `string` | ✅ | 评价模型（review_model_policy 解析结果） |
| `programmatic_validators` | `string[]` | ❌ | 实际运行的程序化校验器 IDs |
| `context_pack_id` | `string` | ✅ | 评价节点本次执行使用的 ContextPack |
| `evidence_pack_id` | `string | null` | ❌ | 若读取了 EvidencePack |
| `target_artifact_hash` | `string` | ✅ | 被审产物的稳定 hash（确保审计可重放） |
| `criteria_hash` | `string` | ✅ | NodeContract.evaluation.criteria 的稳定 hash |
| `eval_hash` | `string` | ✅ | EvaluationResult 整体（去时间戳）的稳定 hash |

> `eval_hash` 排除 `provenance.eval_started_at / eval_finished_at`、`metadata.cw.runtime.*`。

---

## 7. `EvidenceFeedback`（写回 EvidencePack）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `evidence_pack_id` | `string` | ✅ | — |
| `unsupported_claim_estimates` | `int` (≥0) | ✅ | 写回 `EvidencePack.coverage.unsupported_claim_estimates` |
| `dangling_citation_ids` | `string[]` | ❌ | 产物引用的、但 Pack 内不存在的 evidence_id |
| `under_used_evidence_ids` | `string[]` | ❌ | Pack 中存在但产物未使用的 evidence_id |
| `suggested_topics` | `string[]` | ❌ | 建议下次 EvidenceBuilder 增加覆盖的 topic |

---

## 8. 与 NodeContract.evaluation 的字段映射

| NodeContract.evaluation | EvaluationResult |
|---|---|
| `criteria[*].criterion_id / description / kind / severity / weight` | `criterion_results[*]` 完全对应（一一回填） |
| `pass_condition` | 输入：用于计算 `passed` 与 `score` |
| `fail_condition` | 输入：用于计算 `passed` |
| `failure_diagnosis_schema` | `failure_diagnosis` 必须满足该 schema |
| `arbitration` | 决定是否填 `arbitration` 字段 |
| `review_targets` | 评价对象路径（驱动 `criterion_results[*].findings[*].path`） |
| `output_schema` | EvaluationResult 自身的 schema 投影（顶层 = passed/score/criterion_results/failure_diagnosis） |

---

## 9. 与 Pydantic AI 的 Adapter 边界

EvaluationAgent 通常落为 `Agent(output_type=EvaluationResult)`：

- `RunContext.deps` 装入 `EvaluationDeps`：`{ target_artifact, evidence_pack, criteria, pass_condition, fail_condition }`
- 模型直接产出符合 EvaluationResult Pydantic 模型的 JSON
- Adapter 不在 `output_validator` 中重新写规则；规则在 Pydantic 模型层强制（`model_validator`）。
- 程序化 validator（如 `citation_checker / numeric_threshold`）由 Engine 在 LLM 调用**前**或**后**执行：
  - `before_llm`：把程序化结果作为 ContextPack 片段塞入 EvaluationAgent，让 LLM 仅做 rubric 部分（推荐）
  - `after_llm`：覆盖对应 criterion 的 `passed_for_this_criterion`（用于 `arbitration=programmatic_first`）

---

## 10. JSON 示例

```json
{
  "eval_id": "evr_01J9N5T9KQ...",
  "schema_version": "0.1.0",
  "evaluator_node_id": "n_review",
  "target_node_id": "n_extract",
  "target_attempt_id": "att_01J9N5T1QC...",
  "evaluator_attempt_id": "att_01J9N5T7AC...",
  "run_id": "run_01J9N5SXAA...",
  "passed": false,
  "score": 0.62,
  "criterion_results": [
    {
      "criterion_id": "researchable",
      "description": "每个问题必须可研究",
      "kind": "rubric",
      "severity": "blocker",
      "weight": 0.4,
      "passed_for_this_criterion": false,
      "score_for_this_criterion": 0.5,
      "evaluator_kind": "llm_rubric",
      "evaluator_ref": "claude-sonnet-judge",
      "findings": [
        {
          "finding_id": "f_001",
          "kind": "rubric_violation",
          "path": "$.research_questions[2].question",
          "message": "问题过于宽泛：'低空经济能否商业化' 缺少可证伪边界",
          "severity": "blocker",
          "proposed_fix_hint": "限定地理范围 + 时间窗口 + 衡量指标"
        }
      ],
      "evidence_used_ids": ["ev_001", "ev_002"],
      "latency_ms": 4321
    },
    {
      "criterion_id": "evidence_present",
      "description": "每个问题必须有 source_evidence_ids 非空",
      "kind": "schema",
      "severity": "blocker",
      "weight": 0.3,
      "passed_for_this_criterion": true,
      "score_for_this_criterion": 1.0,
      "evaluator_kind": "programmatic_validator",
      "evaluator_ref": "schema_strict_v2",
      "findings": []
    },
    {
      "criterion_id": "goal_alignment",
      "description": "问题与项目目标对齐",
      "kind": "rubric",
      "severity": "major",
      "weight": 0.2,
      "passed_for_this_criterion": true,
      "score_for_this_criterion": 0.9,
      "evaluator_kind": "llm_rubric",
      "evaluator_ref": "claude-sonnet-judge",
      "findings": []
    },
    {
      "criterion_id": "uncertainty_marked",
      "description": "必须标注不确定性",
      "kind": "schema",
      "severity": "minor",
      "weight": 0.1,
      "passed_for_this_criterion": true,
      "score_for_this_criterion": 1.0,
      "evaluator_kind": "programmatic_validator",
      "evaluator_ref": "schema_strict_v2",
      "findings": []
    }
  ],
  "failure_diagnosis": {
    "failure_type": "logic_gap",
    "failed_criteria": ["researchable"],
    "severity": "blocker",
    "summary": "第 3 个研究问题缺少可证伪边界，过于宽泛",
    "rationale": "'能否商业化' 不具备可被实验或数据反驳的形式；缺少地理 / 时间 / 指标三要素。",
    "suggested_repair_targets": ["$.research_questions[2].question"],
    "tags": ["pattern:over_generalization"]
  },
  "recommended_strategy": "prompt_patch",
  "recommended_action": {
    "action": "repair_with_patch",
    "target_repair_node_id": "n_repair",
    "target_human_node_id": null,
    "note_to_user": null
  },
  "arbitration": null,
  "evidence_feedback": {
    "evidence_pack_id": "evp_01J9N5T1QC...",
    "unsupported_claim_estimates": 1,
    "dangling_citation_ids": [],
    "under_used_evidence_ids": ["ev_003"],
    "suggested_topics": []
  },
  "usage": {
    "input_tokens": 3812,
    "output_tokens": 612
  },
  "provenance": {
    "eval_started_at": "2026-06-15T08:35:11Z",
    "eval_finished_at": "2026-06-15T08:35:18Z",
    "evaluator_model_profile_id": "claude-sonnet-judge",
    "programmatic_validators": ["schema_strict_v2"],
    "context_pack_id": "ctxp_01J9N5T8AA...",
    "evidence_pack_id": "evp_01J9N5T1QC...",
    "target_artifact_hash": "ahash_4b1c...",
    "criteria_hash": "chash_91a2...",
    "eval_hash": "ehash_7d80..."
  },
  "metadata": {}
}
```

---

## 11. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `ER_BUILD_NO_TARGET_ARTIFACT` | 构建 | 找不到 `target_attempt_id` 对应的产物 |
| `ER_BUILD_CRITERIA_MISMATCH` | 构建 | criterion_results 与契约 criteria 数量 / id 不一致 |
| `ER_BUILD_FAILURE_DIAGNOSIS_MISSING` | 构建 | passed=false 但 failure_diagnosis 为空 |
| `ER_BUILD_BAD_FAILURE_TYPE` | 构建 | failure_type 不在枚举内 |
| `ER_BUILD_INVALID_RECOMMENDED_STRATEGY` | 构建 | recommended_strategy 不在节点 repair_strategies 内 |
| `ER_BUILD_DANGLING_REPAIR_TARGET` | 构建 | recommended_action.target_repair_node_id 不存在 |
| `ER_BUILD_DANGLING_HUMAN_TARGET` | 构建 | recommended_action.target_human_node_id 不存在 |
| `ER_BUILD_DISAGREEMENT_OVERFLOW` | 构建 | disagreement_score 超 [0,1] |
| `ER_RUNTIME_RESULT_MUTATED` | 运行 | EvaluationResult 在写入后被修改 |
| `ER_RUNTIME_ESCALATE_NO_HUMAN_NODE` | 运行 | 路由要求 human_checkpoint 但 Workflow 中无可达 human 节点 |

---

## 12. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-ER-1 | EvaluationResult **写一次即不可变**；多次评价由多次 attempt + ArbitrationOutcome 表达 |
| D-ER-2 | `failure_type` 取值固定为 8 类 + `unknown`；不允许节点自定义新枚举；自定义诊断进入 `tags` / `metadata` |
| D-ER-3 | blocker 级 criterion 失败一律导致 `passed=false`，与 weighted_score 的阈值无关（D-NC-6 一致） |
| D-ER-4 | `recommended_strategy` 必须 ∈ 节点已声明的 `repair_strategies[*].kind`；越权降级为 `human_checkpoint` |
| D-ER-5 | `disagreement_score ≥ 0.5` 强制升级 `human_checkpoint`，不论各 judge 的最终结论 |
| D-ER-6 | 程序化 validator 默认在 LLM 调用**前**先跑（结果作为 ContextPack 片段注入），节省 token；`arbitration=programmatic_first` 时改为 LLM 调用后覆盖 |
| D-ER-7 | EvidenceFeedback 是评价节点的副产物，必须由 Engine 写回 EvidencePack（不依赖 Adapter） |
| D-ER-8 | 模型给出的 `recommended_action` 与默认推导规则冲突时，以**非越权**的模型建议优先；越权降级为 `human_checkpoint` |

---

## 13. 与未来 spec 的桥接

- `repair_patch.md`：本结果作为 RepairAgent 的核心输入（`evaluation_result` 字段）
- `stream_event.md`：评价过程的 `evaluation` 类型 StreamEvent 是 `passed / score / failure_type / recommended_action` 的截断投影
- `reflection_memory.md`：成功 / 失败评价均沉淀为反思记忆条目
- `runtime_harness.md`：本结果落 `runs/<run_id>/evaluations.jsonl`

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-ER-1 ~ D-ER-8；对齐技术架构 v1.0 §3/§6.4/§7.3/§9 与 UIUX v1.1 §18.8.2 |
