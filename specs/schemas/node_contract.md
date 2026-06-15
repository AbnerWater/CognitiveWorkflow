# Spec: NodeContract

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-schema-002` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 技术架构 v1.0 §6.3 / §6.4 / §6.5 / §3（NodeContract 定义）；UIUX v1.1 §18.8.1 / §18.8.2 |
| 关联 spec | `specs/schemas/workflow_graph.md`（节点公共字段）；`specs/schemas/context_pack.md`（待）；`specs/schemas/evidence_pack.md`（待）；`specs/schemas/evaluation_result.md`（待）；`specs/schemas/repair_patch.md`（待） |
| 关联 ADR | ADR-0002（Engine 不直接 import pydantic_ai）、ADR-0005（Pydantic AI 作为基座） |

> **范围**：本文定义 `WorkflowNode.contract` 字段——节点的"契约"，即"模型/工具被允许做什么、必须输出什么、失败如何处理"。
>
> **非范围**：节点之间的图结构（见 `workflow_graph.md`）；ContextPack / EvidencePack 内部结构（见后续 spec）；Adapter 协议（见 `specs/protocols/agent_adapter.md`）。
>
> **核心立场**：节点契约的目的是把模型执行从"开放式回答"变成"受控任务执行"（00_Concept §3）。本文每个字段都应能回答"如果模型做错，如何在闭环里检测出来并修复"。

---

## 0. 设计原则

1. **契约即真理**：`NodeContract` 是节点的"工程图纸"，必须能在脱离图上下文的情况下被静态审查。
2. **Schema 优先于 Prompt**：`output_schema` 决定结构，`prompt_template` 只决定语气与领域知识激活。Pydantic v2 校验先行，模型再生成。
3. **三层模板插槽**：契约支持 system_prompt / instructions / user_prompt 三层模板（与 Pydantic AI Agent 的层级一致），变量解析顺序：`deps → message_history → static`。
4. **能力声明即"能做什么"边界**：`allowed_tools` / `skills` / `mcp_tools` / `model_policy` / `forbid_*` 五项共同决定节点的"权限上限"，超出即拒绝。
5. **失败可分类**：契约必须显式声明 `failure_taxonomy`（8 类）的关注子集；EvaluationResult 的 failure_type 不在子集内则视为 `unknown`，触发 escalate。
6. **可重放**：相同 `NodeContract` + 相同 ContextPack + 相同 EvidencePack + 相同 model_settings + 相同 seed 应产出"足够近似"的结果（不要求 bit-level 一致，但要求 schema-level 一致）。

---

## 1. 顶层结构 `NodeContract`

`NodeContract` 是 `WorkflowNode.contract` 字段的取值类型。`start` / `end` / `memory_task` 等不需要 LLM 的节点 contract 可为 `null`；其它节点必填。

### 1.1 公共字段（execution / evaluation / repair / human_checkpoint / tool_task 共有）

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `contract_id` | `string` | ✅ | — | ULID / UUIDv7；与节点解耦的唯一 ID，便于跨 Workflow 复用模板 |
| `contract_kind` | `enum: execution / evaluation / repair / human_gate / tool / memory` | ✅ | — | 必须与 `WorkflowNode.type` 对应：execution_task↔execution，evaluation_task↔evaluation，repair_task↔repair，human_checkpoint↔human_gate，tool_task↔tool，memory_task↔memory |
| `goal` | `string`（≤2000） | ✅ | — | 节点必须完成的业务目标（业务语言、非 prompt） |
| `description` | `string`（≤4000） | ❌ | `""` | 节点说明（Canvas / API 文档使用） |
| `input_schema` | `JSONSchema` | ✅ | — | 节点入参；Compiler 校验 `ContextPack.payload` 是否符合 |
| `output_schema` | `JSONSchema` | ✅ | — | 节点产物；Adapter 必须保证产出符合 |
| `context_requirements` | `ContextRequirement[]` | ✅ | — | 节点对上下文的需求；详见 §4 |
| `evidence_requirements` | `EvidenceRequirement[]` | ❌ | `[]` | 仅事实性 / 研究类节点 |
| `prompt` | `PromptSection` | 视类型 | — | 提示词三层结构；详见 §3 |
| `allowed_tools` | `string[]` | ❌ | `[]` | 内置工具白名单（Python sandbox / file_io / web_fetch 等） |
| `skills` | `SkillRef[]` | ❌ | `[]` | 启用的 Skill；详见 §5 |
| `mcp_tools` | `MCPToolRef[]` | ❌ | `[]` | 可调用的 MCP 工具；详见 §5 |
| `model_policy` | `NodeModelPolicy` | ✅ | 见 §6 | 节点级模型策略（覆盖 WorkflowModelPolicy） |
| `retry_policy` | `RetryPolicy` | ❌ | 见 §7 | 节点级重试 |
| `validator_policy` | `ValidatorPolicy` | ❌ | 见 §8 | 输出校验策略 |
| `failure_taxonomy` | `FailureType[]` | ❌ | 全部 8 类 | 关注的失败类型子集 |
| `forbid_remote_models` | `bool` | ❌ | `false` | 标记敏感节点；与 `WorkflowModelPolicy.forbid_remote_for_sensitive` 配合 |
| `requires_human_approval` | `bool` | ❌ | `false` | 高风险节点：成功也走 `human_checkpoint`（不仅失败时） |
| `metadata` | `object` | ❌ | `{}` | 扩展字段；命名空间化（详见 workflow_graph.md Q-WG-4） |

### 1.2 类型差异化字段

不同 `contract_kind` 在公共字段之上，再增加自己的字段。

#### 1.2.1 `execution`
（公共字段已足够；`output_schema` 是节点要交付的业务产物 schema）

#### 1.2.2 `evaluation`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `criteria` | `EvaluationCriterion[]` | ✅ | 审查规则集；详见 §9.1 |
| `pass_condition` | `PassCondition` | ✅ | 详见 §9.2 |
| `fail_condition` | `FailCondition` | ✅ | 详见 §9.2 |
| `failure_diagnosis_schema` | `JSONSchema` | ✅ | EvaluationResult 中 `failure_diagnosis` 字段的 schema |
| `arbitration` | `enum: single_judge / multi_judge / programmatic_first` | ❌ `single_judge` | LLM-as-judge / 多角色辩论 / 程序化校验优先（架构 §9） |
| `review_targets` | `string[]` | ❌ `["primary_artifact"]` | 审查对象的产物字段名 |

#### 1.2.3 `repair`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `repair_strategies` | `RepairStrategy[]` | ✅ | 允许的修复路径（与失败类型对应）；详见 §10 |
| `output_patch_schema` | `JSONSchema` | ✅ | RepairPatch 的 schema（基础已在 `repair_patch.md`，节点可缩窄） |
| `attempts_window` | `int (≥1)` | ❌ `5` | 看回最近 N 次 attempts 作为修复输入 |
| `model_escalation_allowed` | `bool` | ❌ `true` | 允许 RepairAgent 选择 `model_escalation` 策略 |

#### 1.2.4 `human_gate`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `decisions` | `HumanDecision[]` | ✅ | 用户可选决策；至少含 `continue` |
| `prompt_to_user` | `string` | ✅ | UI 上展示给用户的指引 |
| `present_artifacts` | `string[]` | ❌ `["primary_artifact"]` | 展示给用户审阅的产物字段 |
| `present_evidence` | `bool` | ❌ `true` | 是否同时展示 EvidencePack |
| `timeout_seconds` | `int | null` | ❌ `null` | 等待超时；为 null 表示无限等待 |
| `timeout_action` | `enum: hold / fallback / abort` | ❌ `hold` | 超时兜底 |

#### 1.2.5 `tool`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tool_id` | `string` | ✅ | ToolRegistry 中的工具 ID |
| `args_schema` | `JSONSchema` | ✅ | 入参 schema |
| `requires_sandbox` | `bool` | ❌ `true` | 是否在沙箱中执行 |

> 说明：`tool_task` 不调用 LLM；`prompt` / `model_policy` 字段对它无意义，Compiler 在 L2 校验时若发现这两个字段非空将报 `WG_L2_TOOL_HAS_PROMPT`。

#### 1.2.6 `memory`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `operation` | `enum: read / write / upsert / delete` | ✅ | 操作类型 |
| `target` | `enum: project_memory / reflection_memory` | ✅ | 操作对象 |
| `key_schema` | `JSONSchema` | ✅ | 操作 key 的 schema |
| `value_schema` | `JSONSchema | null` | 当 `operation ∈ {write, upsert}` 时必填 | 操作 value 的 schema |

---

## 2. `WorkflowNode.contract` 与 §1 字段的关系

| `WorkflowNode.type` | `contract.contract_kind` | `contract` 是否必填 |
|---|---|---|
| `start` / `end` | — | `null` |
| `execution_task` | `execution` | ✅ |
| `evaluation_task` | `evaluation` | ✅ |
| `repair_task` | `repair` | ✅ |
| `human_checkpoint` | `human_gate` | ✅ |
| `tool_task` | `tool` | ✅ |
| `memory_task` | `memory` | ✅ |
| `subflow` | — | `null`（由被嵌入的子图决定） |

类型不匹配时，L2 校验失败：`WG_L2_CONTRACT_KIND_MISMATCH`。

---

## 3. 提示词三层结构 `PromptSection`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `system_prompt` | `string | string[]` | ❌ | 静态系统提示；多段时按顺序拼接 |
| `instructions` | `string | string[]` | ❌ | 动态指令（与 Pydantic AI `instructions` 对齐——支持 `RunContext` 闭包，Compiler 编译时只允许引用 `deps` 字段） |
| `user_prompt_template` | `string` | ✅ | 节点开始时合成的用户提示词；模板支持变量插值（语法见 §3.1） |
| `template_engine` | `enum: handlebars / jinja2_minimal / none` | ❌ `handlebars` | 模板渲染引擎；`pydantic-handlebars` 已在 pydantic-ai-slim[spec] |

### 3.1 模板变量解析顺序

`user_prompt_template` 与 `instructions` 中的 `{{ var }}` 变量按以下优先级解析：

1. `deps.*`（即 ContextPack 与 EvidencePack 的字段）
2. `message_history.*`（最近 N 条消息的摘要变量）
3. `static.*`（节点 `metadata.template_static` 内的常量）
4. `env.*`（运行时环境变量；仅允许白名单子集）

未解析变量在 L2 阶段报 `WG_L2_TEMPLATE_UNRESOLVED_VAR`。

---

## 4. 上下文需求 `ContextRequirement`

每个 ContextRequirement 描述节点对一类上下文的需要，由 ContextBuilder（MCCL）在节点执行前装填进 ContextPack。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | `string` | ✅ | 上下文片段在 `deps` 中的访问键 |
| `kind` | `enum: upstream_artifact / project_memory / reference / static_text / user_input` | ✅ | 来源类型 |
| `selector` | `ContextSelector` | ✅ | 来源选择器；详见下表 |
| `required` | `bool` | ❌ `true` | 缺失时是否阻塞节点 |
| `max_tokens` | `int | null` | ❌ | 单片段 token 上限；超过由 ContextBuilder 摘要 |
| `summarize_if_over` | `bool` | ❌ `true` | 超长时是否自动摘要 |

### 4.1 `ContextSelector` 表达

| `kind` | 选择器字段 |
|---|---|
| `upstream_artifact` | `{ "from_node_id": string, "artifact_field": string }` |
| `project_memory` | `{ "memory_key": string }` |
| `reference` | `{ "reference_id": string, "chunk_filter"?: object }` |
| `static_text` | `{ "text": string }` |
| `user_input` | `{ "input_field": string }`（来自 Run 启动时 `Start.initial_input_schema`） |

> ContextRequirement 与 `WorkflowGraph.global_context_refs` 的关系：节点级字段优先；与全局重叠时，节点级覆盖（Q-WG-5）。

---

## 5. 能力声明 `SkillRef` / `MCPToolRef`

### 5.1 `SkillRef`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `skill_id` | `string` | ✅ | SkillRegistry 中的 ID |
| `version` | `string`（SemVer） | ❌ `"latest"` | 锁定版本；运行时若不存在则 L4 报 `WG_L4_UNKNOWN_SKILL` |
| `params` | `object` | ❌ `{}` | Skill 参数 |

### 5.2 `MCPToolRef`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server_id` | `string` | ✅ | 已配置的 MCP Server ID |
| `tool_name` | `string | "*"` | ❌ `"*"` | 限定可调用的 tool 名（`*` = 全部） |
| `requires_approval` | `bool` | ❌ `false` | 调用前需用户批准（与 ApprovalRequiredToolset 对齐） |

---

## 6. 节点级模型策略 `NodeModelPolicy`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `primary_model_profile_id` | `string | "auto"` | ✅ | `"auto"` 表示走 ModelRouter |
| `escalation_chain` | `string[]` | ❌ `[]` | 节点级升级链；为空时使用 Workflow 全局链 |
| `model_settings` | `object` | ❌ `{}` | temperature / top_p / max_tokens / reasoning_effort 等；与 Pydantic AI `ModelSettings` 兼容 |
| `seed` | `int | null` | ❌ `null` | 用于可重放 |
| `candidate_count` | `int (≥1)` | ❌ `1` | 多候选生成数；>1 时进入 CandidateGenerator + 仲裁 |
| `forbid_provider_kinds` | `enum[]: cloud / private / local` | ❌ `[]` | 禁用的 Provider 类别 |

---

## 7. 重试 `RetryPolicy`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `max_attempts` | `int (≥1)` | ❌ `3` | 节点的总尝试上限（含首次） |
| `model_retries` | `int (≥0)` | ❌ `2` | 模型层重试（对应 Pydantic AI `AgentRetries.model`） |
| `output_validation_retries` | `int (≥0)` | ❌ `2` | 输出校验失败的重试次数（`AgentRetries.output`） |
| `tool_retries` | `int | Record<string, int>` | ❌ `2` | 工具调用重试（`AgentRetries.tool`） |
| `backoff` | `enum: none / linear / exponential` | ❌ `exponential` | 重试间隔策略 |
| `timeout_seconds` | `int | null` | ❌ `null` | 单次 attempt 超时 |
| `escalation_after` | `int (≥1)` | ❌ `2` | 在第 N 次失败后允许 ModelRouter 升级模型 |

---

## 8. 输出校验 `ValidatorPolicy`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mode` | `enum: strict / lenient / programmatic_only` | ❌ `strict` | strict：Pydantic 严格校验；lenient：允许部分缺失但触发修复；programmatic_only：跳过 LLM 校验 |
| `extra_validators` | `ExtraValidatorRef[]` | ❌ `[]` | 引用 ToolRegistry 中的额外校验器（如 `citation_checker` / `schema_strict_v2`） |
| `partial_output_allowed` | `bool` | ❌ `false` | 流式中是否允许 partial output（与 Pydantic AI `RunContext.partial_output` 对齐） |

---

## 9. EvaluationCriterion 详述

### 9.1 `EvaluationCriterion`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `criterion_id` | `string` | ✅ | 在节点内唯一 |
| `description` | `string` | ✅ | 业务语言描述 |
| `kind` | `enum: rubric / programmatic / regex / schema / citation / numeric_threshold` | ✅ | 校验形式 |
| `severity` | `enum: blocker / major / minor / info` | ❌ `major` | 失败严重程度 |
| `weight` | `number (0..1)` | ❌ `1.0` | 用于综合评分 |
| `expression` | `string | object | null` | 视 kind | 具体表达（rubric 文本 / JSON Logic / 正则 / JSON Schema 路径 / 阈值表达式） |

### 9.2 `PassCondition` / `FailCondition`

每个条件由"逻辑组合 + 触发标准"两部分组成：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `combinator` | `enum: all_pass / any_pass / weighted_score / custom` | ✅ | 组合方式 |
| `threshold` | `number (0..1) | null` | 当 `combinator=weighted_score` 时必填 | 综合分通过阈值 |
| `must_pass_blockers` | `bool` | ❌ `true` | 任意 `severity=blocker` 失败一律视为失败 |

> `FailCondition` 与 `PassCondition` 互斥但不必互补：可以同时存在"未通过 + 未失败"的中间态，由 Engine 驱动重试或人工介入。

---

## 10. RepairStrategy

```yaml
RepairStrategy:
  - kind: prompt_patch | context_patch | evidence_patch | workflow_patch | model_escalation | human_checkpoint
  - applies_to_failure_types: FailureType[]    # 适用的失败类型子集
  - max_uses: int                              # 在单次执行链路中本策略最多被使用几次
  - guarded_by: ConditionExpr | null           # 触发条件（如 attempts >= 2）
```

### 10.1 RepairStrategy ↔ FailureType 推荐对应表（与技术架构 §7.3 对齐）

| FailureType | 推荐策略（按优先级） |
|---|---|
| `format_error` | `prompt_patch`（增加 schema/example）→ `programmatic_repair` |
| `missing_output` | `prompt_patch` → `model_escalation` |
| `missing_evidence` | `evidence_patch`（重跑 EvidenceBuilder）→ `prompt_patch` |
| `logic_gap` | `workflow_patch`（拆节点 / 多角色审查）→ `model_escalation` |
| `model_capability_limit` | `model_escalation` → `human_checkpoint` |
| `tool_error` | 修复工具配置（不在本节点 RepairAgent 范围）→ `human_checkpoint` |
| `ambiguous_requirement` | `human_checkpoint`（澄清确认） |
| `review_rule_too_strict` | `workflow_patch`（调整规则） + 人工记录 |

---

## 11. 与 Pydantic AI Agent 的字段映射

> 本表用于 PydanticAIAdapter 实现。源码位置见项目记忆 [[reference_local_resources]]。

| `NodeContract` 字段 | Pydantic AI 对应物 | 备注 |
|---|---|---|
| `goal` | （仅人类可读） | 不进入模型上下文，作为契约元信息 |
| `prompt.system_prompt` | `Agent(system_prompt=)` | 静态拼接 |
| `prompt.instructions` | `Agent(instructions=)` 或 `agent.run(instructions=)` | 动态部分仅允许引用 `deps` |
| `prompt.user_prompt_template`（渲染后） | `agent.run(user_prompt=)` | 渲染由 CW Compiler 完成 |
| `input_schema` | `deps_type=PydanticModel` | 由 ContextPack 装填 |
| `output_schema` | `Agent(output_type=PydanticModel)` 或 run-level `output_type` | OutputMode 默认 `auto` |
| `context_requirements` | 由 ContextBuilder 装入 `deps` | 不直接映射 |
| `evidence_requirements` | 同上（EvidenceBuilder） | 不直接映射 |
| `allowed_tools` + `skills` + `mcp_tools` | `toolsets=[FunctionToolset, MCPServer, FastMCPToolset, ApprovalRequiredToolset]` | 由 Adapter 组装 CombinedToolset |
| `model_policy.primary_model_profile_id` | `Agent(model=)` 或 run-level `model=` | 由 ModelRouter 解析为具体 Provider |
| `model_policy.model_settings` | `Agent(model_settings=)` | 直接传入 |
| `model_policy.candidate_count` | （Pydantic AI 无内置）由 CandidateGenerator 多次调用 `agent.iter()` | — |
| `retry_policy.model_retries / output_validation_retries / tool_retries` | `Agent(retries=AgentRetries(model=, output=, tool=))` | 三种 retry 维度直接对齐 |
| `retry_policy.timeout_seconds`（节点 attempt 总超时） | 由 Adapter 在 `agent.iter` 之外用 `asyncio.wait_for` 控制 | Pydantic AI 自带的是 tool-level timeout |
| `validator_policy.extra_validators` | `Agent.output_validator(...)` 装饰器 | 在 Adapter 构造期注册 |
| `validator_policy.partial_output_allowed` | `RunContext.partial_output` | 默认 false |
| `requires_human_approval` | 强制让该节点的"成功路径"经过 `human_checkpoint` 节点 | 不直接映射 ApprovalRequiredToolset（后者是 tool 级） |
| `human_gate.decisions` / `prompt_to_user` | AG-UI `human_gate_required` 事件 + DeferredToolResults | 由 UI Adapter 处理 |
| `failure_taxonomy` | （仅 EvaluationAgent 需要） | 通过 ContextPack 注入 EvaluationAgent 的 prompt |

> **强约束**：上述映射仅在 `apps/runtime/src/cw_runtime/adapters/pydantic_ai_adapter.py` 内部成立；Engine / Compiler / MCCL 任何模块**不得绕过 Adapter 直接构造 `pydantic_ai.Agent`**（ADR-0002）。

---

## 12. JSON 示例：execution + evaluation + repair 三套契约

### 12.1 `execution`（提取研究问题）

```json
{
  "contract_id": "ctr_01J9N5R7M2EXTRACT",
  "contract_kind": "execution",
  "goal": "从用户提供的 PDF 摘要中提取 3-5 个明确、可研究的研究问题",
  "input_schema": {
    "type": "object",
    "required": ["project_goal", "reference_summary"],
    "properties": {
      "project_goal": {"type": "string"},
      "reference_summary": {"type": "array", "items": {"type": "string"}}
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["research_questions"],
    "properties": {
      "research_questions": {
        "type": "array", "minItems": 3, "maxItems": 5,
        "items": {
          "type": "object",
          "required": ["question", "source_evidence_ids", "uncertainty", "priority"],
          "properties": {
            "question": {"type": "string"},
            "source_evidence_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
            "uncertainty": {"type": "string"},
            "priority": {"enum": ["high", "medium", "low"]}
          }
        }
      }
    }
  },
  "context_requirements": [
    {"key": "project_goal", "kind": "user_input", "selector": {"input_field": "project_goal"}, "required": true},
    {"key": "reference_summary", "kind": "reference", "selector": {"reference_id": "$auto"}, "required": true, "max_tokens": 4000}
  ],
  "evidence_requirements": [
    {"required_for": "research_questions[*].source_evidence_ids", "min_coverage": 1.0}
  ],
  "prompt": {
    "system_prompt": "你是一位严谨的研究助理，输出必须基于提供的证据。",
    "user_prompt_template": "项目目标：{{ deps.project_goal }}\n\n参考资料摘要：\n{{ deps.reference_summary }}\n\n请基于证据提取 3-5 个研究问题。"
  },
  "allowed_tools": ["evidence_lookup"],
  "skills": [],
  "mcp_tools": [],
  "model_policy": {"primary_model_profile_id": "claude-sonnet-default", "model_settings": {"temperature": 0.3}, "candidate_count": 1},
  "retry_policy": {"max_attempts": 3, "output_validation_retries": 2, "model_retries": 1, "tool_retries": 2, "backoff": "exponential"},
  "validator_policy": {"mode": "strict", "extra_validators": [{"validator_id": "citation_checker"}]},
  "failure_taxonomy": ["format_error", "missing_output", "missing_evidence", "logic_gap"]
}
```

### 12.2 `evaluation`（问题质量审查）

```json
{
  "contract_id": "ctr_01J9N5R7M2REVIEW",
  "contract_kind": "evaluation",
  "goal": "审查 n_extract 输出的研究问题是否可研究、是否有证据、是否与项目目标一致",
  "input_schema": {
    "type": "object",
    "required": ["target_output", "evidence_pack"],
    "properties": {
      "target_output": {"$ref": "#/contracts/extract.output_schema"},
      "evidence_pack": {"type": "object"}
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["passed", "score", "criterion_results"],
    "properties": {
      "passed": {"type": "boolean"},
      "score": {"type": "number", "minimum": 0, "maximum": 1},
      "criterion_results": {"type": "array", "items": {"type": "object"}},
      "failure_diagnosis": {"type": "object"}
    }
  },
  "criteria": [
    {"criterion_id": "researchable",     "description": "每个问题必须可研究（具体、可证伪、范围合理）", "kind": "rubric", "severity": "blocker", "weight": 0.4},
    {"criterion_id": "evidence_present", "description": "每个问题必须有 source_evidence_ids 非空",     "kind": "schema",  "severity": "blocker", "weight": 0.3, "expression": "$.research_questions[*].source_evidence_ids[0]"},
    {"criterion_id": "goal_alignment",   "description": "问题与项目目标对齐",                          "kind": "rubric",  "severity": "major",   "weight": 0.2},
    {"criterion_id": "uncertainty_marked","description":"必须标注不确定性",                            "kind": "schema",  "severity": "minor",   "weight": 0.1, "expression": "$.research_questions[*].uncertainty"}
  ],
  "pass_condition": {"combinator": "weighted_score", "threshold": 0.8, "must_pass_blockers": true},
  "fail_condition": {"combinator": "any_pass", "must_pass_blockers": true},
  "failure_diagnosis_schema": {
    "type": "object",
    "properties": {
      "failure_type": {"enum": ["format_error","missing_output","missing_evidence","logic_gap","model_capability_limit","tool_error","ambiguous_requirement","review_rule_too_strict"]},
      "failed_criteria": {"type": "array", "items": {"type": "string"}},
      "severity": {"enum": ["blocker","major","minor","info"]},
      "recommended_strategy": {"enum": ["prompt_patch","context_patch","evidence_patch","workflow_patch","model_escalation","human_checkpoint"]},
      "rationale": {"type": "string"}
    }
  },
  "arbitration": "single_judge",
  "review_targets": ["research_questions"],
  "context_requirements": [
    {"key": "target_output", "kind": "upstream_artifact", "selector": {"from_node_id": "n_extract", "artifact_field": "research_questions"}, "required": true},
    {"key": "evidence_pack", "kind": "upstream_artifact", "selector": {"from_node_id": "n_extract", "artifact_field": "$evidence_pack"}, "required": true}
  ],
  "prompt": {
    "system_prompt": "你是一位资深科研审稿人，按规则给出客观结论。",
    "user_prompt_template": "审查规则：\n{{ deps.criteria }}\n\n被审查内容：\n{{ deps.target_output }}\n\n证据：\n{{ deps.evidence_pack }}\n\n请按 schema 输出审查结果。"
  },
  "model_policy": {"primary_model_profile_id": "claude-sonnet-judge", "model_settings": {"temperature": 0.0}},
  "retry_policy": {"max_attempts": 2}
}
```

### 12.3 `repair`（修复研究问题）

```json
{
  "contract_id": "ctr_01J9N5R7M2REPAIR",
  "contract_kind": "repair",
  "goal": "根据评价失败诊断生成修复补丁，让 n_extract 重跑后能通过审查",
  "input_schema": {
    "type": "object",
    "required": ["evaluation_result", "node_attempt_history"],
    "properties": {
      "evaluation_result": {"type": "object"},
      "node_attempt_history": {"type": "array"}
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["patch_kind", "operations", "expected_effect"],
    "properties": {
      "patch_kind": {"enum": ["prompt_patch","context_patch","evidence_patch","workflow_patch","model_escalation","human_checkpoint"]},
      "operations": {"type": "array"},
      "expected_effect": {"type": "string"}
    }
  },
  "repair_strategies": [
    {"kind": "prompt_patch",     "applies_to_failure_types": ["format_error","missing_output"], "max_uses": 2},
    {"kind": "evidence_patch",   "applies_to_failure_types": ["missing_evidence"],              "max_uses": 1},
    {"kind": "model_escalation", "applies_to_failure_types": ["logic_gap","model_capability_limit"], "max_uses": 1, "guarded_by": "$.attempts >= 2"},
    {"kind": "human_checkpoint", "applies_to_failure_types": ["ambiguous_requirement"],         "max_uses": 1}
  ],
  "output_patch_schema": {"$ref": "specs/schemas/repair_patch.md#schema"},
  "attempts_window": 3,
  "model_escalation_allowed": true,
  "context_requirements": [
    {"key": "evaluation_result", "kind": "upstream_artifact", "selector": {"from_node_id": "n_review", "artifact_field": "$last"}, "required": true},
    {"key": "node_attempt_history", "kind": "upstream_artifact", "selector": {"from_node_id": "n_extract", "artifact_field": "$attempts[-3:]"}, "required": true}
  ],
  "prompt": {
    "system_prompt": "你是修复工程师，基于失败诊断生成最小修复补丁。不要改写整个节点。",
    "user_prompt_template": "评价结果：{{ deps.evaluation_result }}\n\n最近 3 次尝试：{{ deps.node_attempt_history }}\n\n请生成 RepairPatch。"
  },
  "model_policy": {"primary_model_profile_id": "claude-sonnet-repair"},
  "retry_policy": {"max_attempts": 2}
}
```

---

## 13. 错误码（NodeContract 相关）

| 错误码 | 级别 | 含义 |
|---|---|---|
| `NC_L2_KIND_MISMATCH` | L2 | `contract_kind` 与 `WorkflowNode.type` 不匹配 |
| `NC_L2_MISSING_PROMPT` | L2 | execution / evaluation / repair 缺 `prompt.user_prompt_template` |
| `NC_L2_BAD_OUTPUT_SCHEMA` | L2 | `output_schema` 不是合法 JSON Schema |
| `NC_L2_TEMPLATE_UNRESOLVED_VAR` | L2 | 模板变量未在解析顺序中找到 |
| `NC_L2_TOOL_HAS_PROMPT` | L2 | `tool` 节点不应有 prompt / model_policy |
| `NC_L2_EVAL_NO_CRITERIA` | L2 | evaluation 缺 criteria 或 criteria 为空 |
| `NC_L2_EVAL_BAD_PASS_THRESHOLD` | L2 | weighted_score 但未提供 threshold |
| `NC_L2_REPAIR_NO_STRATEGIES` | L2 | repair 缺 repair_strategies 或为空 |
| `NC_L4_SKILL_VERSION_NOT_FOUND` | L4 | SkillRef.version 不在 registry |
| `NC_L4_MCP_TOOL_NOT_FOUND` | L4 | MCPToolRef 引用的 server/tool 不存在 |
| `NC_L4_MODEL_FORBIDDEN` | L4 | `forbid_remote_models=true` 但 ModelRouter 选了远程 Provider |

---

## 14. 已锁定的设计决策（v0.1.0 Accepted）

| 序号 | 决策 |
|---|---|
| D-NC-1 | **模板引擎默认使用 handlebars**（pydantic-handlebars，与 pydantic-ai-slim[spec] 对齐）；禁止启用 jinja2_minimal 的 `eval` 类扩展；`template_engine: none` 表示纯字符串拼接，不解析 `{{ }}` |
| D-NC-2 | `output_schema` **允许使用 `$ref`** 引用其它契约或 spec 文档片段；解析在 Compiler 编译期完成（早于 L2 校验），未解析的 `$ref` 直接 L2 报错 |
| D-NC-3 | `EvaluationCriterion.kind=programmatic` **禁止执行用户代码**；只允许引用 ToolRegistry 中已注册的 validator（如 `citation_checker` / `schema_strict_v2` / `numeric_threshold`） |
| D-NC-4 | RepairAgent 在 Phase 1 **仅允许产出 `prompt_patch / context_patch / evidence_patch / model_escalation` 四类策略**；`workflow_patch / human_checkpoint` 由 Engine 应用而非 RepairAgent 直接生成；`contract_patch`（直接修改 NodeContract）从 Phase 3 起允许 |
| D-NC-5 | 节点 `requires_human_approval=true` 时，Compiler **自动注入隐式 `human_checkpoint` 节点**（命名 `<node_id>_approval`），插入在该节点的所有成功出边之前；隐式节点不可被用户在 Canvas 删除，但可被显式覆盖 |
| D-NC-6 | `failure_taxonomy` 子集与全局 8 类枚举不一致时，**不在子集内的失败统一标为 `unknown`**，触发 ReviewPolicy.escalate_after_repairs 路径或人工检查点；EvaluationResult 必须保留原始 failure_type 字段以便审计 |
| D-NC-7 | **多候选仲裁规则字段位置**：v0.1.0 暂入 `validator_policy.arbitration`（与 `EvaluationCriterion` 同义但作用域是节点产出而非评价）；v0.2.0 起若复用 evaluation 节点的 arbitration，则迁移到独立的 `CandidateArbitrationPolicy`；当前 spec 仅占位声明 |

> 上述决策于 2026-06-15 由产品负责人确认锁定，进入 Accepted 状态。后续若需要变更，必须通过 ADR 流程。

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 待决项锁定（D-NC-1 ~ D-NC-7），状态升至 Accepted；对齐技术架构 v1.0 §6.3/§6.4/§6.5/§3 与 UIUX v1.1 §18.8.1/§18.8.2；与 Pydantic AI Agent API 字段级映射 |
