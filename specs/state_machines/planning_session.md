# Spec: PlanningSession State Machine

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-state-001` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §1（两种 Workflow 创建方式）；技术架构 v1.0 §4（规划编排层）；UIUX v1.1 §18.1 / §18.2 / §18.3 / §18.4 / §18.4.1 / §18.5 / §18.6 / §18.9 / §18.10 / §18.11 / §18.12 / §18.13 / §18.14 / §18.15 |
| 关联 spec | `specs/schemas/workflow_graph.md`（实例化目标）、`specs/schemas/node_contract.md`、`specs/schemas/stream_event.md`（事件投影 §2.8）、`specs/protocols/agent_adapter.md`（Planner 子 Agent 编排）、`specs/schemas/context_pack.md`（PlanningContextPack 与 ContextPack 的差异） |
| 关联 ADR | ADR-0002、ADR-0005、ADR-0008、ADR-0006 |

> **范围**：定义 `PlanningSession` 状态机协议——从用户在"新建 Workflow 入口页"点击"AI 自动规划"开始，到 Workflow 草案被实例化为正式 Workflow 之间的全过程。包含状态机、子对象 schema、自动规划 Pipeline 协作、4 级校验自动修复闭环、StreamEvent 投影、错误码。
>
> **非范围**：
> - 手动节点编排器自身的 UI 状态（属于 `apps/desktop/` 内部状态）；本文仅约定"AI 草案 → 手动编辑器桥接"的入口与出口契约（§9）
> - WorkflowDraft 实例化为正式 Workflow 后的执行时状态机（属于 WorkflowRun 状态机，另一份 spec）
> - Planner / Explorer / Understanding / Clarifier 等子 Agent 的 prompt 模板（属于实现，受本 spec 约束）
>
> **核心立场**：自动规划必须是**有阶段、可观察、可中断、可修改、可回退、可校验**的过程，而不是"一次黑盒生成"。本 spec 的每个状态都应能回答：用户当前在第几步？需要等待用户做什么？已经产出哪些产物？校验状态如何？取消会发生什么？

---

## 0. 设计原则

1. **阶段显式**：状态机不允许出现"模糊态"；每个时刻必有一个 `status`，且对应**唯一**的可执行操作集合。
2. **澄清不滥用**：澄清确认仅在关键决策缺失时触发（UIUX §18.4 / §18.5）；最多连续 3 轮（§18.5），超过则建议"使用推荐方案继续"或"进入手动编辑器"。
3. **草案版本化**：`WorkflowDraft.version` 单调递增；`WorkflowPatch` 是修改的唯一形式（§18.6 / §18.13 FR-18-006），禁止整体重写。
4. **校验即真理**：4 级校验（L1~L4，UIUX §18.10）是 `previewing` 状态的入口门；未通过即不可实例化。
5. **AI 与手动一体两面**：草案产生于 `planning` 子 Agent 即 Pydantic AI Agent（output_type=WorkflowDraft），手动编辑器从草案接力（§18.9）；Session 在两种模式下共用同一份 Draft 与版本号。
6. **取消必清场**：用户取消必须把 `pending` 子 Agent 全部 cancel（AgentAdapter `cancel()`），并保证持久化文件可恢复。
7. **可回退**：每次 `revising` 都通过 `WorkflowPatch` 应用，并保留前一版本的快照；`previewing` 阶段允许"回退到上一版本"（§18.6）。
8. **事件投影完整**：每次状态迁移、每次 Patch 应用、每次校验、每次澄清都必须发出 StreamEvent（与 `stream_event.md` §2.8 对齐）。

---

## 1. 状态机概述

### 1.1 状态枚举

```
collecting_input
   │
   ▼
exploring ──┐
   │        │  (并发探索完成)
   ▼        │
understanding
   │        │
   ▼        │
clarifying ◄┘ (循环：缺关键决策时反复触发)
   │
   ▼
planning
   │
   ▼
validating ◄────┐
   │            │
   ▼            │
   │  L 校验通过 │
   ├────────────┘    (校验失败 → repair_draft → 重回 validating)
   ▼
previewing ◄────┐
   │            │
   ▼            │
revising ───────┘ (循环：用户提出修改意见或回退版本)
   │
   ▼
created      (实例化为正式 Workflow，进入 WorkflowRun 状态机)

并行可达终态：cancelled / failed
```

### 1.2 状态卡片

| status | 含义 | 是否阻塞用户 | 用户可见操作 | 可达后继 |
|---|---|---|---|---|
| `collecting_input` | 用户初始输入（任务目标、附件、引用项目记忆） | 是（输入未完成则不可推进） | 编辑目标、上传附件、选择参考项目；点"开始 AI 规划" | `exploring`、`cancelled` |
| `exploring` | 系统并发整理上下文（已有对话 / 附件 / 项目记忆 / 参考库 / Skill 与 MCP 可用性） | 否（只读进度） | 中止 | `understanding`、`cancelled`、`failed` |
| `understanding` | 系统判断任务边界、闭环条件、是否可直接规划 | 否 | 中止 | `planning`、`clarifying`、`cancelled`、`failed` |
| `clarifying` | 推送澄清问题（每次 1 条；3 选项 + 自定义） | 是（等待用户答） | 选答案 / 自定义 / 跳过（仅非强制问题）/ "用推荐方案继续" / 中止 | `planning`、`clarifying`（再问一轮）、`previewing`（用户选"使用推荐方案"）、`cancelled` |
| `planning` | Planner 子 Agent 生成草案（结构化 Workflow） | 否 | 中止 | `validating`、`cancelled`、`failed` |
| `validating` | 4 级校验（L1 格式 / L2 Schema / L3 图结构 / L4 执行可行性） | 否 | 中止 | `previewing`（通过）、`planning`（自动修复触发重生成，最多 3 次）、`cancelled`、`failed` |
| `previewing` | 草案预览给用户：结构摘要、缩略 Canvas、本次修改、校验状态 | 是（等待"创建/修改/进入手动编辑器/回退"决策） | 创建正式 Workflow / 提出修改意见 / 进入手动编辑器 / 回退版本 / 中止 | `created`、`revising`、`handoff_to_manual_editor`、`cancelled` |
| `revising` | 系统把用户意见解析为 `WorkflowPatch` 并应用 | 否 | 中止 | `validating`、`clarifying`（修改意见需要澄清）、`cancelled`、`failed` |
| `handoff_to_manual_editor` | 桥接到手动编辑器；草案保留 draft_source / 校验记录 / 对话引用（UIUX §18.9） | — | 由手动编辑器接管 | `created`（手动编辑器创建后回调 Session）、`cancelled` |
| `created` | 已实例化为正式 Workflow（写入项目目录 + 自动 Git 快照） | — | — | 终态 |
| `cancelled` | 用户取消 / Session 闲置过长 | — | — | 终态 |
| `failed` | 不可恢复错误（如反复修复仍失败、Adapter 不可用） | — | 查看失败诊断 / 重新创建 Session | 终态 |

> 与 UIUX v1.1 §18.4.1 阶段定义对齐；本 spec 增补 `revising / handoff_to_manual_editor / failed` 三个工程必要状态。

### 1.3 不变量

- 任意时刻只可能处于一个 `status`（不允许并发）
- `clarifying` 进入次数 ≤ 3；超过则强制路由到 `previewing`（用推荐方案）或 `failed`
- `validating → planning` 的自动修复回路上限 = 3（与 UIUX §18.10 一致）
- `revising` 不允许直接产生 `created`，必须经过 `validating → previewing`
- 任意终态后 Session 不可重启；用户需创建新 Session
- `handoff_to_manual_editor` 后 Session 进入"挂起"模式：手动编辑器持有 Draft 主权，不再触发 `clarifying`

---

## 2. `PlanningSession` 顶层结构

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | `string` (ULID) | ✅ | — |
| `schema_version` | `string` | ✅ | `0.1.0` |
| `status` | `PlanningStatus` | ✅ | §1.1 枚举 |
| `previous_status` | `PlanningStatus \| null` | ❌ | 便于状态机调试 |
| `project_id` | `string` | ✅ | 关联项目 |
| `user_goal` | `string` (≤4000) | ✅ | 用户输入的任务目标（原文） |
| `user_goal_summary` | `string` (≤500) | ❌ | Explorer 生成的短摘要（用于 UI 与日志） |
| `inputs` | `PlanningInputs` | ✅ | 见 §3.1 |
| `context_pack` | `PlanningContextPack \| null` | ❌ | `exploring` 完成后写入 |
| `understanding_report` | `UnderstandingReport \| null` | ❌ | `understanding` 完成后写入 |
| `clarification_questions` | `ClarificationQuestion[]` | ❌ `[]` | 全部历史问题（含已回答与跳过） |
| `confirmed_decisions` | `ConfirmedDecision[]` | ❌ `[]` | 已确认的关键决策（在 UI"已确认决策面板"持续展示） |
| `drafts` | `WorkflowDraft[]` | ❌ `[]` | 历次草案版本；末位 = active |
| `active_draft_id` | `string \| null` | ❌ | 当前激活草案；`previewing` 状态必填 |
| `applied_patches` | `WorkflowPatchApplication[]` | ❌ `[]` | Patch 应用日志（Order = 时间序） |
| `validation_runs` | `ValidationReport[]` | ❌ `[]` | 历次校验记录 |
| `instantiated_workflow` | `WorkflowInstantiationResult \| null` | ❌ | `created` 状态的产物 |
| `failure` | `PlanningFailure \| null` | ❌ | `failed` 状态的诊断 |
| `cancellation` | `PlanningCancellation \| null` | ❌ | `cancelled` 状态的原因与时间 |
| `handoff` | `ManualEditorHandoff \| null` | ❌ | `handoff_to_manual_editor` 后写入 |
| `clarification_round_count` | `int` (0..3) | ✅ `0` | 已使用的澄清轮次 |
| `repair_round_count` | `int` (0..3) | ✅ `0` | 已使用的草案自动修复轮次 |
| `started_at` | `string` (ISO-8601) | ✅ | — |
| `last_activity_at` | `string` (ISO-8601) | ✅ | 用于闲置超时 |
| `closed_at` | `string` (ISO-8601) \| `null` | ❌ | 终态写入 |
| `metadata` | `object` | ❌ | 命名空间化扩展字段 |

### 2.1 不变量

- `status=clarifying` ⇒ `clarification_questions[-1].status='asking'`
- `status=previewing` ⇒ `active_draft_id` 必填，且其 `validation_status='passed'`
- `status=created` ⇒ `instantiated_workflow` 必填
- `clarification_round_count > 3` ⇒ `status ∈ {previewing, failed, cancelled}`
- `repair_round_count > 3` ⇒ `status ∈ {failed, cancelled}` 或 `previewing`（带未通过的诊断）

---

## 3. 子对象 schema

### 3.1 `PlanningInputs`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `description_text` | `string` | ✅ | 用户输入的任务描述（同 `user_goal`） |
| `attached_files` | `AttachedFileRef[]` | ❌ `[]` | 用户上传的附件（PDF / 图 / 数据表 / 代码 / .md…） |
| `referenced_projects` | `string[]` | ❌ `[]` | 引用的历史项目 ID（继承其 memory） |
| `enabled_skills` | `SkillRef[]` | ❌ `[]` | 用户预先启用的 Skill |
| `enabled_mcp_servers` | `string[]` | ❌ `[]` | 启用的 MCP server ID |
| `model_constraints` | `ModelConstraintsHint \| null` | ❌ | 用户可选的"必须本地 / 优先快速 / 优先质量"等偏好 |
| `language_hint` | `string \| null` | ❌ | 输出语言偏好（如 `zh-CN`） |

### 3.2 `PlanningContextPack`

> 注意：本对象与 `context_pack.md` 的 `ContextPack` **不是**同一个对象。后者面向 NodeAttempt；本对象面向 PlanningSession 自身的探索阶段。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `built_at` | `string` (ISO-8601) | ✅ | — |
| `summary_of_user_goal` | `string` (≤2000) | ✅ | Explorer 提炼的目标摘要 |
| `attached_file_summaries` | `FileSummary[]` | ❌ | 每份附件的摘要 + 类型 + 是否包含敏感信息 |
| `referenced_project_memories` | `ProjectMemoryRef[]` | ❌ | 历史项目记忆引用 |
| `available_skills` | `SkillDescriptor[]` | ❌ | 当前可用 Skill 列表（含 capabilities） |
| `available_mcp_tools` | `MCPDescriptor[]` | ❌ | 当前可用 MCP 工具列表 |
| `available_adapters` | `AdapterDescriptor[]` | ✅ | 启用的 AgentAdapter（来自 `agent_adapter.md` §12） |
| `domain_signals` | `string[]` | ❌ | 任务领域识别（如 "research_paper"、"engineering_simulation"、"compliance_review"） |
| `tokens_estimate` | `int` | ✅ | 全部材料 token 估算 |
| `sensitive_files` | `string[]` | ❌ | 含敏感数据的附件 ID（影响后续模型路由） |

### 3.3 `UnderstandingReport`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `built_at` | `string` (ISO-8601) | ✅ | — |
| `understood_goal` | `string` (≤2000) | ✅ | 系统理解后的目标陈述（中性语言） |
| `task_kind` | `enum: research / report_writing / data_analysis / code_engineering / simulation / compliance / planning_only / mixed / unknown` | ✅ | — |
| `difficulty` | `enum: low / medium / high` | ✅ | — |
| `feasibility` | `enum: feasible / partial / not_feasible` | ✅ | — |
| `closure_conditions` | `string[]` | ✅ | 完成条件（>= 1） |
| `risks` | `string[]` | ❌ | 关键风险（如 "依赖外部数据"、"敏感信息"） |
| `missing_decisions` | `MissingDecision[]` | ❌ | 缺失的关键决策清单；非空时驱动 `clarifying` |
| `recommended_pipeline` | `string \| null` | ❌ | 推荐的 Workflow 模板 ID（若命中模板库） |
| `must_clarify_before_planning` | `bool` | ✅ | 决定是否进 `clarifying` |
| `auto_continue_safe` | `bool` | ✅ | 是否允许跳过 clarifying 直接 planning（对应 §18.14 "无澄清路径"） |

### 3.4 `MissingDecision` & `ClarificationQuestion`

`MissingDecision`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `decision_id` | `string` | ✅ | 局部唯一 |
| `topic` | `string` | ✅ | 业务语言主题（如"流程触发频率"） |
| `why_it_matters` | `string` | ✅ | 解释为何缺失会影响规划（UIUX §18.5） |
| `severity` | `enum: blocker / major / minor` | ✅ | blocker 必问 |
| `recommended_options` | `RecommendedOption[]` (≥3) | ✅ | 3 个推荐选项 + 适用条件 |

`ClarificationQuestion`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `question_id` | `string` (ULID) | ✅ | — |
| `decision_id` | `string` | ✅ | 关联的 MissingDecision |
| `prompt` | `string` (≤500) | ✅ | 问题文本（业务语言，UIUX §18.5） |
| `why_it_matters` | `string` | ✅ | 必要性说明 |
| `options` | `ClarificationOption[]` (=3) | ✅ | 3 个选项；每个含短说明、适用条件 |
| `allow_custom_input` | `bool` | ✅ `true` | 是否允许自定义输入 |
| `is_required` | `bool` | ✅ | strong：blocker；non-required 可跳过 |
| `status` | `enum: asking / answered / skipped / cancelled` | ✅ | — |
| `answer` | `ClarificationAnswer \| null` | 当 `status=answered` 时必填 | — |
| `asked_at` | `string` (ISO-8601) | ✅ | — |
| `answered_at` | `string \| null` | ❌ | — |
| `round_index` | `int (0..2)` | ✅ | 第几轮（0/1/2） |

`ClarificationAnswer`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `selected_option_key` | `string \| null` | 二选一 | — |
| `custom_text` | `string \| null` | 二选一 | — |
| `selected_at` | `string` (ISO-8601) | ✅ | — |
| `by` | `string` | ✅ | 用户标识（即使本机也填用户名） |

回答提交后系统派生一条 `ConfirmedDecision`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `decision_id` | `string` | ✅ | — |
| `topic` | `string` | ✅ | — |
| `chosen_value` | `string \| object` | ✅ | 用户最终选择的值 |
| `derivation_path` | `enum: clarification / default_recommendation / template / inherited_memory` | ✅ | 决策的来源 |
| `confirmed_at` | `string` (ISO-8601) | ✅ | — |

### 3.5 `WorkflowDraft`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `draft_id` | `string` (ULID) | ✅ | — |
| `version` | `int (≥0)` | ✅ | 单调递增（草案阶段用 int；与 `workflow_graph.md` D-WG-1 一致） |
| `parent_draft_id` | `string \| null` | ❌ | 上一版本 |
| `created_by` | `enum: planner_agent / patch_agent / repair_agent / manual_editor / template_clone` | ✅ | — |
| `nodes` | `WorkflowNodeDraft[]` | ✅ | — |
| `edges` | `WorkflowEdgeDraft[]` | ✅ | — |
| `summary` | `DraftSummary` | ✅ | UI 折叠呈现用 |
| `validation_status` | `enum: pending / passed / failed / repaired` | ✅ | — |
| `validation_errors` | `ValidationError[]` | ❌ | 当 status=failed | repaired 时必有历史 |
| `created_at` | `string` (ISO-8601) | ✅ | — |
| `metadata` | `object` | ❌ | — |

`WorkflowNodeDraft / WorkflowEdgeDraft` 的字段是 `WorkflowNode / WorkflowEdge` 的草案投影；与正式版本最大差异：

- `node_id` / `edge_id` 在草案阶段允许 stable hash + suffix（实例化时换为 ULID）
- `contract` 在草案阶段允许部分缺失（标记 `incomplete=true`）；实例化时必须补全
- `position` 由 Planner 自动布局生成（实例化后用户可改，Session 不再修改）

`DraftSummary`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `node_count` | `int` | ✅ | — |
| `execution_task_count` | `int` | ✅ | — |
| `evaluation_task_count` | `int` | ✅ | — |
| `repair_task_count` | `int` | ✅ | — |
| `human_checkpoint_count` | `int` | ✅ | — |
| `retry_loop_count` | `int` | ✅ | — |
| `expected_execution_mode` | `enum: step / semi_auto / auto` | ✅ | — |
| `risks` | `string[]` | ❌ | — |
| `changes_from_previous` | `ChangeDescriptor[]` | ❌ | 相对上一版本的变化（UIUX §18.6 "本次修改" 卡） |

### 3.6 `WorkflowPatch` & `WorkflowPatchApplication`

> `WorkflowPatch` 与 `repair_patch.md` 的 `RepairPatch` 不是同一对象。后者作用于运行时节点；前者作用于"草案图结构"。

`WorkflowPatch`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `patch_id` | `string` (ULID) | ✅ | — |
| `base_draft_version` | `int` | ✅ | 应用前的草案版本 |
| `summary` | `string` (≤500) | ✅ | UI 显示 |
| `operations` | `WorkflowPatchOp[]` | ✅ | 见 §3.6.1 |
| `source` | `enum: user_revision / auto_repair / template_apply / manual_editor` | ✅ | — |
| `rationale` | `string` | ❌ | — |
| `created_at` | `string` (ISO-8601) | ✅ | — |

#### 3.6.1 `WorkflowPatchOp`（与 UIUX §18.11 / FR-18-006 对齐）

Phase 1 至少支持以下 op：

| op | 说明 |
|---|---|
| `add_node` | `{ "op": "add_node", "node": WorkflowNodeDraft }` |
| `update_node` | `{ "op": "update_node", "node_id": string, "changes": Partial<WorkflowNodeDraft> }` |
| `remove_node` | `{ "op": "remove_node", "node_id": string }` |
| `add_edge` | `{ "op": "add_edge", "edge": WorkflowEdgeDraft }` |
| `remove_edge` | `{ "op": "remove_edge", "edge_id": string }` |
| `update_edge` | `{ "op": "update_edge", "edge_id": string, "changes": Partial<WorkflowEdgeDraft> }` |
| `update_review_policy` | `{ "op": "update_review_policy", "changes": Partial<ReviewPolicy> }`（影响草案级 review_policy） |
| `update_execution_policy` | `{ "op": "update_execution_policy", "changes": Partial<ExecutionPolicy> }` |
| `update_model_policy` | `{ "op": "update_model_policy", "changes": Partial<WorkflowModelPolicy> }` |
| `set_entry_node` | `{ "op": "set_entry_node", "node_id": string }` |
| `set_terminal_nodes` | `{ "op": "set_terminal_nodes", "node_ids": string[] }` |

> Phase 2 起按需增加；不允许通过 op 直接改 `node_id` / `edge_id`（保稳定性）。

`WorkflowPatchApplication`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `application_id` | `string` (ULID) | ✅ | — |
| `patch_id` | `string` | ✅ | — |
| `applied_at` | `string` (ISO-8601) | ✅ | — |
| `from_draft_version` | `int` | ✅ | — |
| `to_draft_version` | `int` | ✅ | — |
| `produced_validation_run_id` | `string \| null` | ❌ | 应用后立即触发的校验 |

### 3.7 `ValidationReport`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `validation_run_id` | `string` (ULID) | ✅ | — |
| `draft_id` | `string` | ✅ | — |
| `draft_version` | `int` | ✅ | — |
| `started_at` | `string` (ISO-8601) | ✅ | — |
| `finished_at` | `string` (ISO-8601) | ✅ | — |
| `levels` | `ValidationLevelResult[]` | ✅ | L1~L4 各自结果 |
| `overall_passed` | `bool` | ✅ | — |
| `auto_repair_attempts` | `AutoRepairAttempt[]` | ❌ | 历次自动修复（≤3） |
| `escalation` | `enum: none / suggest_regeneration / suggest_manual_editor / fail` | ✅ | 未通过且修复耗尽时给前端的建议 |

`ValidationLevelResult`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `level` | `enum: L1 / L2 / L3 / L4` | ✅ | — |
| `passed` | `bool` | ✅ | — |
| `errors` | `ValidationError[]` | ❌ | — |

`ValidationError` 的 `error_code` 直接复用 `workflow_graph.md` §11 / `node_contract.md` §13 已定义的错误码（如 `WG_L2_DUP_NODE_ID` / `NC_L2_MISSING_PROMPT`）。

### 3.8 `WorkflowInstantiationResult`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workflow_id` | `string` (ULID) | ✅ | — |
| `version` | `string` (SemVer) | ✅ | 首次实例化默认 `0.1.0` |
| `instantiated_at` | `string` (ISO-8601) | ✅ | — |
| `git_commit_sha` | `string` | ✅ | 自动 Git 快照（FR-012 / §18.13 FR-18-012） |
| `git_tag` | `string \| null` | ❌ | 例 `workflow-<id>-v0.1.0` |
| `flow_json_path` | `string` | ✅ | `.agent-workflow/workflow.flow.json` |
| `derived_from_draft_id` | `string` | ✅ | — |

### 3.9 其它

`PlanningFailure / PlanningCancellation / ManualEditorHandoff` 字段从略，按以下要点定型：

- `PlanningFailure` = `{ failure_type: enum: planner_unavailable / repair_exhausted / clarify_exhausted / adapter_error / internal_error, message, error_code, traceback_id?, occurred_at }`
- `PlanningCancellation` = `{ by: enum: user / idle_timeout / system, reason?, cancelled_at }`
- `ManualEditorHandoff` = `{ handoff_at, draft_version_at_handoff, manual_editor_session_id, return_callback_url }`

---

## 4. 状态迁移规则（详细）

### 4.1 触发器与事件投影

> 所有迁移必须发出 `planning.phase_changed` StreamEvent（与 `stream_event.md` §2.8 一致）。下表只列额外必发事件。

| 来源 | 触发器 | 目标 | 必发事件（除 phase_changed 外） |
|---|---|---|---|
| `collecting_input` | 用户提交 | `exploring` | `planning.session_started` |
| `exploring` | Explorer 完成 | `understanding` | `planning.context_built` |
| `understanding` | `must_clarify_before_planning=false` | `planning` | `planning.understanding_completed` |
| `understanding` | `must_clarify_before_planning=true` | `clarifying` | `planning.understanding_completed` |
| `clarifying` | 用户答完一题且仍有 blocker | `clarifying` | `planning.clarification_question` + `planning.clarification_answered` |
| `clarifying` | 全部 blocker 已答 | `planning` | — |
| `clarifying` | round_count 达 3 且仍有 blocker | `failed`（type=`clarify_exhausted`） | — |
| `clarifying` | 用户选"使用推荐方案继续" | `planning` | — |
| `planning` | Planner 输出 Draft v0 | `validating` | `planning.draft_generated` |
| `validating` | L1~L4 全部通过 | `previewing` | `planning.draft_validation` |
| `validating` | 任一级失败且 repair_round_count<3 | `planning`（auto repair） | `planning.draft_validation` + `planning.draft_repaired` |
| `validating` | 失败且 repair 耗尽 | `previewing`（带未通过诊断；用户决定）  | `planning.draft_validation` |
| `previewing` | 用户点"创建 Workflow" | `created` | `planning.workflow_instantiated` |
| `previewing` | 用户提自然语言修改 | `revising` | — |
| `previewing` | 用户点"进入手动编辑器" | `handoff_to_manual_editor` | — |
| `previewing` | 用户回退到上一版本 | `previewing`（active_draft_id 改为前版） | — |
| `revising` | Patch Agent 生成 patch + 应用 | `validating` | `planning.workflow_patch_proposed` |
| `revising` | 修改意图需要先澄清 | `clarifying` | — |
| 任意状态 | 用户取消 / 闲置超时 | `cancelled` | — |
| 任意状态 | 不可恢复错误 | `failed` | — |
| `handoff_to_manual_editor` | 手动编辑器创建正式 Workflow | `created` | `planning.workflow_instantiated` |

### 4.2 失败 / 取消传播

- 进入 `cancelled / failed` 时，Engine 必须：
  1. 对所有正在执行的 Planner / Explorer / Understanding / Clarifier / Patch Agent attempt 调用 `AgentAdapter.cancel()`
  2. 持久化 Session 当前状态（jsonl 写入 + 关闭 SSE 订阅）
  3. 发出 `attempt.cancelled` 子事件 + `planning.phase_changed`

---

## 5. 与 AgentAdapter 协议的协作

### 5.1 5 个子 Agent 角色

按 §UIUX §18.4.1 / 技术架构 §4，自动规划由以下 5 个子 Agent（均为 Pydantic AI Agent，落到 PydanticAIAdapter）组成：

| 子 Agent | output_type | 输入 deps | 出口产物 |
|---|---|---|---|
| `ExplorerAgent` | `PlanningContextPack` | `PlanningInputs` + 项目 Memory + 参考库 + AdapterDescriptor | 写入 Session.context_pack |
| `UnderstandingAgent` | `UnderstandingReport` | `PlanningContextPack` | 写入 Session.understanding_report |
| `ClarifierAgent` | `ClarificationQuestion[]`（一次最多 1 条） | `MissingDecision[]` + 已确认决策 | 推送给前端 |
| `PlannerAgent` | `WorkflowDraft` | `PlanningContextPack` + `UnderstandingReport` + `ConfirmedDecision[]` + 上一版本（若存在） | 写入 Session.drafts |
| `PatchAgent` | `WorkflowPatch` | 上一版本 Draft + 用户修改意见 | 写入 Session.applied_patches |

### 5.2 Adapter 选择

- 默认 5 个子 Agent 都使用 PydanticAIAdapter（Phase 1）
- ModelRouter 选择基于 §UnderstandingReport.task_kind + difficulty + AdapterDescriptor 能力快照
- `WorkflowDraft / WorkflowPatch` 必须经 Pydantic 校验；任何 Adapter 必须保证返回的对象通过 `ValidationLevelResult.L2`

### 5.3 Cancel 链

Session.cancel → Engine 取所有 active handle → AgentAdapter.cancel(handle) → 5s 内返回 → Session 写终态。

---

## 6. 4 级校验闭环（与 `workflow_graph.md` 错误码对齐）

```
进入 validating
  │
  ▼
L1: 格式合法（JSON / 必备字段）
  │  失败 → 调用 PlannerAgent 修复（auto repair attempt + 1）
  │            ↓ 失败 ≥3 次或 patch 不可应用
  │            → previewing（带未通过诊断；用户决定）/ failed
  ▼
L2: Schema（字段类型 / 必填 / 枚举 / ID 唯一 / contract_kind 匹配）
  │  失败 → 同上自动修复
  ▼
L3: 图结构（entry/end / 孤立 / 不可达 / fail dead-end / 不受控循环 / 多 entry）
  │  失败 → 自动补充边或重生成
  ▼
L4: 执行可行性（Skill / MCP / Adapter / Model / global_context_refs / EvidencePack 强制）
  │  失败 → 提示用户解决依赖；不可自动修复
  ▼
previewing
```

校验失败但 `repair_round_count < 3` 的处理路径分两种：
- 自动可修复（L1/L2/L3 大多数）：调用 `PatchAgent` 生成补丁并直接应用 → 重新 validating
- 不可自动修复（L4 多数 + L3 部分）：跳过修复，直接进入 previewing 并标注未通过项

---

## 7. 与 `WorkflowGraph` 实例化的桥接

`previewing → created` 路径执行：

1. 取 `active_draft_id` 对应 Draft；要求 `validation_status='passed'`
2. 把 `WorkflowNodeDraft / WorkflowEdgeDraft` 转换为正式 `WorkflowNode / WorkflowEdge`：
   - `node_id / edge_id` 由 stable hash + suffix 换为 ULID
   - `contract.incomplete=true` 项必须先报错（不允许带未完成契约实例化）
   - `position` 保留
3. 写入 `.agent-workflow/workflow.flow.json`
4. `simple-git` 创建 commit `chore: instantiate workflow <id> v0.1.0` + tag
5. 写入 `Session.instantiated_workflow`，状态 → `created`
6. 发出 `planning.workflow_instantiated` + `git.snapshot_created` + `git.tag_created` StreamEvent

---

## 8. 取消 / 闲置 / 失败 兜底

| 场景 | 触发 | 处理 |
|---|---|---|
| 用户主动取消 | UI 点取消 / 关闭面板 | 立即 `cancelled` |
| 闲置超时（默认 30min） | last_activity_at + 30min < now | 自动 `cancelled`（reason=idle_timeout） |
| 子 Agent 异常（AdapterError） | run() 抛 `AdapterError` 且 retryable=False | `failed`（type=adapter_error） |
| Planner 多次返回 incomplete | 修复耗尽且 L1/L2 仍失败 | 进 `previewing`（让用户决定）或 `failed` |
| 澄清耗尽 | round_count > 3 且仍有 blocker | `failed`（type=clarify_exhausted） |
| 修复耗尽 | repair_round_count > 3 且 L1~L4 仍失败 | 进 `previewing`（让用户决定）或 `failed` |

---

## 9. 与手动编辑器的桥接（UIUX §18.9）

`handoff_to_manual_editor` 状态：

- Session 写入 `handoff` 字段；状态保持冻结（不再触发 phase_changed）
- 手动编辑器接管 Draft；保留 `draft_version` 和 `validation_status` 与 `applied_patches` 历史
- 用户在编辑器内可：直接创建（→ Session.instantiated_workflow + Session→created）/ 保存草稿（→ Session→cancelled，仅保留 Draft）/ 返回对话（→ Session→revising，由 PatchAgent 基于编辑器当前 Canvas 继续生成 Patch）

---

## 10. JSON 示例（最小 PlanningSession 状态片段）

```json
{
  "session_id": "ps_01J9N5SX...",
  "schema_version": "0.1.0",
  "status": "previewing",
  "previous_status": "validating",
  "project_id": "prj_drone_research",
  "user_goal": "梳理低空经济中无人机交付的关键研究问题，并产出一份中文报告草案",
  "user_goal_summary": "低空经济无人机交付：研究问题 + 报告草案",
  "inputs": {
    "description_text": "梳理低空经济中无人机交付的关键研究问题，并产出一份中文报告草案",
    "attached_files": [{"file_id": "f_drone_review_2025", "path": "references/drone_review_2025.pdf", "kind": "pdf"}],
    "referenced_projects": [],
    "enabled_skills": [],
    "enabled_mcp_servers": ["mcp_local_python"],
    "model_constraints": null,
    "language_hint": "zh-CN"
  },
  "context_pack": {
    "built_at": "2026-06-15T08:25:00Z",
    "summary_of_user_goal": "梳理低空经济中无人机交付的研究问题与报告草案",
    "attached_file_summaries": [{"file_id": "f_drone_review_2025", "summary": "...", "kind": "pdf", "sensitive": false}],
    "available_adapters": [{"adapter_id": "pydantic_ai", "display_name": "Pydantic AI"}],
    "domain_signals": ["research_paper", "drone_logistics"],
    "tokens_estimate": 24000,
    "sensitive_files": []
  },
  "understanding_report": {
    "built_at": "2026-06-15T08:25:18Z",
    "understood_goal": "用户希望基于已有综述与若干学术文献，提取 3-5 个研究问题，并撰写中文报告草案。",
    "task_kind": "research",
    "difficulty": "medium",
    "feasibility": "feasible",
    "closure_conditions": ["产出 3-5 个有证据支撑的研究问题", "形成不少于 3 章的中文报告草案"],
    "must_clarify_before_planning": false,
    "auto_continue_safe": true
  },
  "clarification_questions": [],
  "confirmed_decisions": [
    {"decision_id": "d_lang", "topic": "输出语言", "chosen_value": "zh-CN", "derivation_path": "inherited_memory", "confirmed_at": "2026-06-15T08:25:01Z"}
  ],
  "drafts": [
    {
      "draft_id": "d_01J9N5SXAA",
      "version": 0,
      "parent_draft_id": null,
      "created_by": "planner_agent",
      "summary": {"node_count": 6, "execution_task_count": 3, "evaluation_task_count": 1, "repair_task_count": 1, "human_checkpoint_count": 0, "retry_loop_count": 1, "expected_execution_mode": "semi_auto", "risks": [], "changes_from_previous": []},
      "validation_status": "passed",
      "created_at": "2026-06-15T08:30:00Z"
    }
  ],
  "active_draft_id": "d_01J9N5SXAA",
  "applied_patches": [],
  "validation_runs": [
    {"validation_run_id": "vr_01J9N5SXAB", "draft_id": "d_01J9N5SXAA", "draft_version": 0, "started_at": "2026-06-15T08:30:01Z", "finished_at": "2026-06-15T08:30:02Z",
     "levels": [
       {"level": "L1", "passed": true},
       {"level": "L2", "passed": true},
       {"level": "L3", "passed": true},
       {"level": "L4", "passed": true}
     ],
     "overall_passed": true,
     "escalation": "none"}
  ],
  "instantiated_workflow": null,
  "failure": null,
  "cancellation": null,
  "handoff": null,
  "clarification_round_count": 0,
  "repair_round_count": 0,
  "started_at": "2026-06-15T08:24:30Z",
  "last_activity_at": "2026-06-15T08:30:02Z",
  "metadata": {}
}
```

---

## 11. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `PS_INPUT_REQUIRED_MISSING` | collecting_input | 必填输入缺失（user_goal） |
| `PS_EXPLORE_NO_ADAPTERS` | exploring | AdapterFactory.list_available 为空 |
| `PS_EXPLORE_TIMEOUT` | exploring | 探索阶段超过 90s 未完成 |
| `PS_UNDERSTAND_INFEASIBLE` | understanding | feasibility=not_feasible |
| `PS_CLARIFY_EXHAUSTED` | clarifying | round_count 达 3 仍有 blocker |
| `PS_PLANNER_INVALID_DRAFT` | planning | Planner 输出未通过 Pydantic 模型校验 |
| `PS_VALIDATE_AUTO_REPAIR_EXHAUSTED` | validating | 自动修复 3 次仍失败 |
| `PS_PREVIEW_NO_ACTIVE_DRAFT` | previewing | active_draft_id 缺失 |
| `PS_REVISE_PATCH_INAPPLICABLE` | revising | Patch 不能应用到当前版本（base_draft_version 不匹配） |
| `PS_REVISE_AMBIGUOUS_INTENT` | revising | 用户修改意见无法解析 → 转 clarifying |
| `PS_INSTANTIATE_INCOMPLETE_CONTRACT` | created | 草案中存在 contract.incomplete=true |
| `PS_INSTANTIATE_GIT_FAILED` | created | simple-git 写 commit 失败 |
| `PS_HANDOFF_NO_RETURN_CALLBACK` | handoff_to_manual_editor | 缺 return_callback_url |
| `PS_INTERNAL_BAD_TRANSITION` | 任意 | 状态机非法迁移（实现错误） |

---

## 12. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-PS-1 | PlanningSession 状态机 11 个状态（含 `revising / handoff_to_manual_editor / failed`）固定；不允许实现引入"中间态"或并发态 |
| D-PS-2 | `clarification_round_count` 上限 3；超过强制路由到 `previewing`（推荐方案）或 `failed` |
| D-PS-3 | `repair_round_count` 上限 3（草案自动修复）；超过强制路由到 `previewing`（带未通过诊断）或 `failed` |
| D-PS-4 | 用户修改 = `WorkflowPatch.operations`；禁止整体重写 Draft |
| D-PS-5 | `WorkflowDraft.version` 单调递增 int；实例化后改为 SemVer（与 D-WG-1 一致） |
| D-PS-6 | Planner 等 5 个子 Agent 默认使用 PydanticAIAdapter（Phase 1）；可按 ModelRouter 切换 |
| D-PS-7 | 校验失败的草案如经历 3 次自动修复仍未通过，**进入 `previewing` 而非 `failed`**——给用户最终决定权 |
| D-PS-8 | `handoff_to_manual_editor` 后 Session 冻结；手动编辑器持有 Draft 主权 |
| D-PS-9 | 实例化时遇到 `contract.incomplete=true` 直接拒绝；草案不能"半成品"成为正式 Workflow |
| D-PS-10 | 取消必须 ≤5s 完成（与 AgentAdapter D-AA-6 一致），并写入终态 |

---

## 13. 与未来 spec 的桥接

- `runtime_harness.md`（待）：PlanningSession 落 `.agent-workflow/planning_sessions/<session_id>/` 子目录的字段约束
- `protocols/model_router.md`（待）：Planner / Patch Agent 的模型选择策略
- `protocols/observability.md`（待）：Planning 阶段的 OTel span 命名
- 与 `repair_patch.md`：本文 `WorkflowPatch` 与运行时 `RepairPatch` 是不同对象——前者作用于草案图，后者作用于运行节点；两者在概念上各成体系，不可互相替代

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-PS-1 ~ D-PS-10；对齐 UIUX v1.1 §18 全章；与 `agent_adapter.md` / `workflow_graph.md` / `stream_event.md` 一致 |
