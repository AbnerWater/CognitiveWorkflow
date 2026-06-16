# Spec: WorkflowGraph

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-schema-001` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 技术架构 v1.0 §6.1 / §6.2 / §6.6；UIUX v1.1 §18.8 / §18.10 / §18.11 |
| 关联 ADR | ADR-0003（Schema 单一真理）、ADR-0004（LangGraph 内核）、ADR-0008（StreamEvent） |
| 关联 spec | `specs/schemas/node_contract.md`（即将产出） |

> 本文是 CognitiveWorkflow 顶层有向图 `WorkflowGraph` 的唯一规范来源。任何 Engine、Compiler、Planner、Manual Editor、PydanticAIAdapter 的图相关行为都必须以本文为准；本文若与基线 docx 描述冲突，以本文为新事实，并在更新历史中说明。
>
> 本文不定义节点契约的内部字段（那是 `node_contract.md` 的职责）。本文只定义"图的形状"。

---

## 0. 设计原则

下面 6 条原则用于解释字段命名与必填性的取舍，不是字段本身。

1. **图是产品契约**：`WorkflowGraph` 作为 `.agent-workflow/workflow.flow.json` 落盘，是用户可看、Git 可 diff 的真理；它必须是 JSON-serializable，禁止携带运行时句柄。
2. **节点声明优先于边声明**：路由可以在节点上"声明性"指出（`on_pass_next_node_id` 等），也可以在 `edges[]` 里"显式"出现。Compiler 必须把两种来源合并为同一份内部图，并保证一致性。
3. **执行/评价/修复是一等公民**：图内部存在执行 → 评价 → 修复 → 再评价的闭环；其它节点类型（tool / human_checkpoint / memory）作为补充而非主线。
4. **MVP 与扩展分层**：`type` 取值集合分两层——MVP 必交付（execution_task / evaluation_task / start / end）与扩展类型（repair_task / human_checkpoint / tool_task / memory_task / subflow）。Compiler 必须在遇到未启用的扩展类型时给出 L4 校验失败。
5. **可追溯**：`created_by` 与 `draft_source` 字段必须能让任意时刻回答"这张图怎么来的"。
6. **可校验**：本文定义的所有规则必须可由 `WorkflowDraftValidator` 程序化执行，对应 UIUX v1.1 §18.10 的 L1~L4 四级校验。

---

## 1. 顶层结构 `WorkflowGraph`

### 1.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `workflow_id` | `string`（ULID 或 UUID v7） | ✅ | — | 全局唯一；同一项目内不可重复；进入正式 Workflow 后不可修改 |
| `version` | `string`（SemVer，如 `1.2.0`） | ✅ | `0.1.0` | 与 `workflow_id` 配对；草案版本由 `draft.version: int` 区分，正式 Workflow 用 SemVer |
| `schema_version` | `string` | ✅ | `0.1.0` | 本 spec 的版本号；用于未来兼容性升级判定 |
| `title` | `string`（≤120） | ✅ | — | 用户可见名称，Canvas 标题栏显示 |
| `description` | `string`（≤4000） | ❌ | `""` | Workflow 总体描述 |
| `nodes` | `WorkflowNode[]` | ✅ | — | 节点列表；详见 §2 |
| `edges` | `WorkflowEdge[]` | ✅ | — | 边列表；可为空数组（小型 Workflow 仅靠节点声明路由），详见 §3 |
| `entry_node_id` | `string` | ✅ | — | 起始节点 ID；类型必须是 `start` |
| `terminal_node_ids` | `string[]` | ✅ | — | 一个或多个 `end` 节点 ID（允许多终态） |
| `global_context_refs` | `string[]` | ❌ | `[]` | 全局生效的参考资料 / 项目记忆引用 ID；详见 §4.1 |
| `execution_policy` | `ExecutionPolicy` | ✅ | 见 §5.1 | 全局执行策略 |
| `review_policy` | `ReviewPolicy` | ✅ | 见 §5.2 | 全局审查策略 |
| `model_policy` | `WorkflowModelPolicy` | ✅ | 见 §5.3 | 全局模型策略 |
| `created_by` | `enum: ai_planning / manual_editor / hybrid / template / imported` | ✅ | — | 创建来源；`hybrid` 表示 AI 草案被手动编辑过 |
| `draft_source` | `DraftSource | null` | ❌ | `null` | 若由草案实例化，记录 PlanningSession ID + draft_version；详见 §4.2 |
| `created_at` | `string`（ISO-8601 UTC） | ✅ | — | 创建时间 |
| `last_modified_at` | `string`（ISO-8601 UTC） | ✅ | — | 最后修改时间 |
| `metadata` | `object` | ❌ | `{}` | 扩展字段；不参与 Compiler 行为；保留给未来插件 |

### 1.2 不变量

- `workflow_id` 一旦实例化即冻结，重命名 `title` 不影响 `workflow_id`
- `version` 单调递增，回滚时不可降低（回滚通过创建新版本指回快照实现）
- `nodes` 中至少存在一个 `type=start` 与一个 `type=end`，且 `entry_node_id ∈ {start nodes}`、`terminal_node_ids ⊆ {end nodes}`
- `nodes[*].node_id` 全局唯一（同图内）；`edges[*].edge_id` 同上
- `schema_version` 必须是 Engine 已知版本；否则在 L1 阶段拒绝

### 1.3 ID 与命名规则

- `workflow_id` / `node_id` / `edge_id`：使用 ULID（默认）或 UUID v7；表示形式为 26/36 字符字符串；序列化时不去除连字符
- 节点 ID 字段名：`node_id`（不是 `id`，避免与 React Flow 节点对象冲突）
- 节点显示名：`title`（不是 `name`，避免与 Pydantic AI `Agent.name` 命名混淆）
- 引用其它对象时的字段命名：`<对象>_id`（如 `target_node_id`），不允许内嵌对象再带 ID

---

## 2. 节点 `WorkflowNode`

### 2.1 公共字段（任何节点类型必须有的字段）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `node_id` | `string` | ✅ | 同 §1.3 |
| `type` | `NodeType` | ✅ | 见 §2.2 |
| `title` | `string`（≤120） | ✅ | Canvas 标签 |
| `description` | `string`（≤2000） | ❌ | 节点说明 |
| `position` | `{x: number, y: number}` | ❌ | Canvas 位置；Engine 不读取，仅前端使用 |
| `tags` | `string[]` | ❌ | 自由标签；用于过滤 |
| `metadata` | `object` | ❌ | 扩展字段 |
| `contract` | `NodeContract | null` | 视类型而定 | 节点契约；定义见 `node_contract.md`；`start` / `end` 通常为 `null` |

### 2.2 节点类型 `NodeType`

| `type` 值 | MVP | 是否产生路由 | 是否有产物 | 典型用途 |
|---|---|---|---|---|
| `start` | ✅ | 否 | 否 | 图入口；可携带初始输入声明 |
| `end` | ✅ | 否 | 否 | 图终点；可声明归档动作 |
| `execution_task` | ✅ | 通常否 | 是 | 资料解析、草稿生成、报告撰写、仿真规划等 |
| `evaluation_task` | ✅ | **是（pass / fail）** | 否（输出审查报告） | 质量审查、合规审查、引用审查 |
| `repair_task` | ⏳ Phase 1 末 | 通常回流 | 可选（输出 RepairPatch） | 失败诊断 → 修复补丁 |
| `human_checkpoint` | ⏳ Phase 1 末 | 是（continue / reject / edit） | 决策记录 | 高风险结论、最终发布、人工审批 |
| `tool_task` | 🔵 Phase 2 | 视工具结果 | 是 | 确定性工具调用（Python / 仿真器 / 数据库） |
| `memory_task` | 🔵 Phase 2 | 否 | 是 | 写入 / 读取项目记忆或反思记忆 |
| `subflow` | 🔵 Phase 4 | 同被嵌入图 | 视情况 | 子工作流嵌入 |

> 注：所有非 MVP 类型在 `WorkflowGraph` 中合法存在，但被 L4 校验阻止实例化为正式 Workflow，除非对应特性已 enabled。

### 2.3 类型差异化字段（仅图结构相关；契约字段见 `node_contract.md`）

#### 2.3.1 `start`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `trigger` | `enum: manual / scheduled / event` | ✅ | 当前 MVP 只允许 `manual` |
| `initial_input_schema` | `JSONSchema | null` | ❌ | 用户在启动 Run 时输入的结构化数据形态 |

#### 2.3.2 `end`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `archive_actions` | `ArchiveAction[]` | ❌ | 例如"导出 markdown 到 outputs/"、"打 git tag"、"写入 memory.json" |

#### 2.3.3 `evaluation_task` 路由字段（**同时支持节点声明与边显式声明**）
| 字段 | 类型 | 必填条件 | 说明 |
|---|---|---|---|
| `target_node_id` | `string` | ✅ | 被审查的节点 ID |
| `on_pass_next_node_id` | `string | null` | 二选一：本字段或对应 `pass` 边 | pass 路由目标 |
| `on_fail_next_node_id` | `string | null` | 二选一：本字段或对应 `fail` 边 | fail 路由目标 |
| `max_retry` | `int (≥0)` | ✅ | 不通过后允许的回流次数；超过转 `human_checkpoint` |

#### 2.3.4 `repair_task` 路由字段
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `repair_target_node_id` | `string` | ✅ | 被修复的执行节点 ID |
| `failure_input_ref` | `string`（指向 EvaluationResult ID） | ✅ | 修复依赖的失败诊断 |
| `on_repair_next_node_id` | `string` | ✅ | 修复后回到的节点（通常 = `repair_target_node_id`） |

#### 2.3.5 `human_checkpoint` 路由字段
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `decisions` | `HumanDecision[]`（至少含 `continue`） | ✅ | 用户可选择的决策枚举 |
| `routing_map` | `Record<HumanDecisionKey, string>` | ✅ | 每个决策 → 下游节点映射 |
| `timeout_action` | `enum: hold / fallback / abort` | ❌ | 用户长时间无响应时的兜底 |

> `HumanDecision` 标准枚举：`continue` / `reject` / `edit` / `escalate` / `<custom>`；自定义 key 必须以 `custom_` 前缀。

---

## 3. 边 `WorkflowEdge`

### 3.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `edge_id` | `string` | ✅ | 同 §1.3 |
| `source_node_id` | `string` | ✅ | 起始节点 |
| `target_node_id` | `string` | ✅ | 目标节点 |
| `type` | `EdgeType` | ✅ | 见 §3.2 |
| `condition` | `EdgeCondition | null` | ❌ | 仅 `optional` / 自定义条件型边使用；详见 §3.3 |
| `label` | `string` | ❌ | Canvas 显示标签；不写时按 `type` 默认值（"通过"/"不通过"等） |
| `style` | `EdgeStyle | null` | ❌ | 渲染样式提示；Engine 忽略 |
| `metadata` | `object` | ❌ | 扩展字段 |

### 3.2 `EdgeType` 枚举与触发条件

| `type` | 触发条件 | 默认 label | 默认视觉（前端） |
|---|---|---|---|
| `normal` | 上游节点成功完成 | （空） | 灰/蓝实线 |
| `pass` | `EvaluationResult.passed = true` | "通过" | 绿色实线 |
| `fail` | `EvaluationResult.passed = false` | "不通过" | 红/橙实线 |
| `retry` | 修复后回流，未超过 `max_retry` | "重试" | 蓝/紫虚线回路 |
| `repair` | 评价失败进入修复路径 | "修复" | 红/紫线 |
| `human` | 触发人工检查（高风险 / 超过重试上限 / 用户配置） | "人工确认" | 橙色实线 |
| `optional` | `condition` 求值为 true 或用户启用 | 自定义 | 灰/紫虚线 |
| `loop` | 子图回流（`subflow` 内部） | "循环" | 蓝色虚线 |

### 3.3 `EdgeCondition`（仅 `optional` 与扩展条件型边使用）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | `enum: expression / capability / artifact_present / always_false` | ✅ | 条件求值方式 |
| `expression` | `string`（受限 JSON Logic 子集） | 当 `kind=expression` 时必填 | 例：`{"==": [{"var": "deps.user.preference"}, "deep_research"]}` |
| `requires_capability` | `string` | 当 `kind=capability` 时必填 | 例：`mcp.search.web` |
| `requires_artifact_id` | `string` | 当 `kind=artifact_present` 时必填 | — |

> 条件求值由 Compiler 在编译期与运行时双重求值（编译期：常量折叠；运行时：在 ContextPack 完成后求值）。

### 3.4 节点声明 vs 边声明的合并规则

- 若 `evaluation_task.on_pass_next_node_id = X`，且不存在 `(source=该 evaluation, target=X, type=pass)` 的边，Compiler **自动合成**一条
- 若两者都声明且**目标不一致**，L2 校验失败：`EVAL_PASS_ROUTE_MISMATCH`
- `repair_task` / `human_checkpoint` 同理
- 内部图（编译产物）只承认显式 Edge；节点声明只是糖衣

---

## 4. 全局引用与来源

### 4.1 `global_context_refs`

每项是字符串引用 ID，可指向：
- 项目参考库条目（`reference:<ref_id>`）
- 项目级 Memory 条目（`memory:<key>`）
- 启用的 Skill（`skill:<skill_id>@<version>`）

Compiler 将其纳入每个节点的 `ContextPack` 构建候选池（具体压缩策略见 `context_pack.md`）。

### 4.2 `DraftSource`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `planning_session_id` | `string` | ❌ | 触发本草案的规划会话 |
| `draft_version` | `int (≥0)` | ❌ | 草案版本号（与 PlanningSession.drafts 中的 version 对齐） |
| `applied_patches` | `string[]`（WorkflowPatch ID 列表） | ❌ | 草案到正式 Workflow 之间应用过的补丁 |
| `template_id` | `string | null` | ❌ | 若来自模板，记录模板 ID |

---

## 5. 全局策略

### 5.1 `ExecutionPolicy`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `mode` | `enum: step / semi_auto / auto` | `semi_auto` | 与 UIUX FR-007 三种执行模式对齐 |
| `max_concurrent_nodes` | `int (≥1)` | `1` | 全局并发上限 |
| `default_timeout_seconds` | `int` | `600` | 节点级未声明时的默认超时 |
| `on_node_failure` | `enum: stop / continue_safe_branches / human` | `human` | 非审查类节点本身失败时的处理 |

### 5.2 `ReviewPolicy`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `default_max_retry` | `int (≥0)` | `2` | `evaluation_task` 未声明 `max_retry` 时使用 |
| `escalate_after_repairs` | `int (≥0)` | `3` | 累计 repair 次数超过此值进入 `human_checkpoint` |
| `evidence_required_for_factual_outputs` | `bool` | `true` | 事实性输出强制要求 EvidencePack 覆盖 |

### 5.3 `WorkflowModelPolicy`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `default_model_profile_id` | `string` | — | 节点未声明模型时使用 |
| `escalation_chain` | `string[]` | `[]` | 模型升级链；ModelRouter 在 `model_capability_limit` 触发时按序升级 |
| `forbid_remote_for_sensitive` | `bool` | `true` | `metadata.sensitive=true` 的节点禁止使用远程 Provider |

---

## 6. 校验级别（对齐 UIUX v1.1 §18.10）

| 级别 | 检查内容 | 失败处理 |
|---|---|---|
| **L1 格式** | JSON 合法；`nodes`/`edges` 是数组；UTF-8 | 由 Draft Repair Agent 修复 |
| **L2 Schema** | 字段类型 / 必填 / 枚举合法；`schema_version` 已知；ID 唯一 | 自动补齐缺失字段或返回错误 |
| **L3 图结构** | `entry_node_id` ∈ start 节点；`terminal_node_ids` 全是 end；无孤立节点；无不可达节点；无 fail 路径无出口；循环必经过 retry/loop 类型边；evaluation_task 至少有 pass 与 fail 两条出边 | 自动补充边或标记需要人工修正 |
| **L4 执行可行性** | 引用的 Skill / MCP / 模型可用；`type` 在已启用扩展集合内；`global_context_refs` 全部解析；EvidencePack 强制要求与节点契约一致 | 提示缺失依赖；允许用户导入 / 启用 / 替换 |

具体规则枚举与错误码见 §8。

---

## 7. 与 Pydantic AI / LangGraph 的映射边界

> **本节回答"Compiler 把 WorkflowGraph 翻译成什么"的问题。**

- `WorkflowGraph` → LangGraph `StateGraph`（一对一，不嵌套 LangGraph subgraph 来表达 evaluation/repair；后者由 CW Compiler 自己生成 `pass/fail/repair` 边）
- `execution_task` 节点 → LangGraph 节点函数 → 内部 `await PydanticAIAdapter.run(execution_pack)`
- `evaluation_task` 节点 → 独立 `Agent(output_type=EvaluationResult)`，仍走 PydanticAIAdapter
- `repair_task` 节点 → 独立 `Agent(output_type=RepairPatch)`，仍走 PydanticAIAdapter；patch 应用由 Engine 完成
- `human_checkpoint` 节点 → LangGraph `interrupt` + AG-UI `human_gate_required` 事件 + `ApprovalRequiredToolset.DeferredToolResults` 续跑
- `tool_task` 节点 → 直接调用工具，不经 LLM；走 ToolRegistry，不走 Adapter
- `memory_task` 节点 → 直接读写项目级 Memory，不调用 LLM

> 严格约束（ADR-0002）：Engine / Compiler **不得直接 import pydantic_ai**；所有 LLM 调用必须经 `AgentAdapter` 协议。

---

## 8. 错误码（L1~L4 校验输出）

| 错误码 | 级别 | 含义 |
|---|---|---|
| `WG_L1_INVALID_JSON` | L1 | JSON 解析失败 |
| `WG_L1_NODES_NOT_ARRAY` | L1 | `nodes` 缺失或非数组 |
| `WG_L1_EDGES_NOT_ARRAY` | L1 | `edges` 非数组 |
| `WG_L2_DUP_NODE_ID` | L2 | 节点 ID 重复 |
| `WG_L2_DUP_EDGE_ID` | L2 | 边 ID 重复 |
| `WG_L2_UNKNOWN_NODE_TYPE` | L2 | `type` 不在枚举内 |
| `WG_L2_UNKNOWN_EDGE_TYPE` | L2 | `type` 不在枚举内 |
| `WG_L2_BAD_SCHEMA_VERSION` | L2 | 未知 `schema_version` |
| `WG_L2_MISSING_ENTRY_NODE` | L2 | `entry_node_id` 不存在或不是 `start` |
| `WG_L2_MISSING_TERMINAL_NODES` | L2 | `terminal_node_ids` 任一不存在或不是 `end` |
| `WG_L2_EVAL_MISSING_TARGET` | L2 | evaluation_task 缺 `target_node_id` |
| `WG_L2_EVAL_NO_PASS_ROUTE` | L2 | evaluation_task 既无声明也无 `pass` 边 |
| `WG_L2_EVAL_NO_FAIL_ROUTE` | L2 | 同上 fail |
| `WG_L2_EVAL_PASS_ROUTE_MISMATCH` | L2 | 节点声明与边声明的 pass 目标冲突 |
| `WG_L2_EVAL_FAIL_ROUTE_MISMATCH` | L2 | 同上 fail |
| `WG_L2_REPAIR_MISSING_TARGET` | L2 | repair_task 缺 `repair_target_node_id` |
| `WG_L3_ORPHAN_NODE` | L3 | 节点既无入边也无出边（且不是 start/end） |
| `WG_L3_UNREACHABLE_NODE` | L3 | 从 entry 出发不可达 |
| `WG_L3_DEAD_END_FAIL_PATH` | L3 | 存在 fail 路径无任何后继 |
| `WG_L3_UNCONTROLLED_LOOP` | L3 | 出现循环但路径中无 retry/loop 边或缺 max_retry |
| `WG_L3_MULTIPLE_ENTRIES` | L3 | 出现多个 start 但只允许一个 entry_node_id |
| `WG_L4_UNKNOWN_SKILL` | L4 | 引用 Skill 不在启用列表 |
| `WG_L4_UNKNOWN_MCP` | L4 | 引用 MCP 未连接 |
| `WG_L4_UNKNOWN_MODEL` | L4 | 引用 Model 不在 ModelProfile 注册表 |
| `WG_L4_NODE_TYPE_NOT_ENABLED` | L4 | 使用未启用的扩展节点类型 |
| `WG_L4_REFERENCE_UNRESOLVED` | L4 | `global_context_refs` 解析失败 |

---

## 9. 完整 JSON 示例（最小可执行 Workflow）

```json
{
  "workflow_id": "01J9N5B5XDMV4P1ZMRE3T7K8H4",
  "version": "0.1.0",
  "schema_version": "0.1.0",
  "title": "PDF → 研究问题 → 审查 → 报告",
  "description": "MVP 端到端 demo Workflow",
  "nodes": [
    {"node_id": "n_start", "type": "start", "title": "开始", "trigger": "manual"},

    {"node_id": "n_extract", "type": "execution_task", "title": "提取研究问题",
     "contract": { "<see node_contract.md>": true }},

    {"node_id": "n_review", "type": "evaluation_task", "title": "问题质量审查",
     "target_node_id": "n_extract",
     "on_pass_next_node_id": "n_report",
     "on_fail_next_node_id": "n_repair",
     "max_retry": 2,
     "contract": { "<see node_contract.md>": true }},

    {"node_id": "n_repair", "type": "repair_task", "title": "修复研究问题",
     "repair_target_node_id": "n_extract",
     "failure_input_ref": "$last_evaluation",
     "on_repair_next_node_id": "n_extract",
     "contract": { "<see node_contract.md>": true }},

    {"node_id": "n_report", "type": "execution_task", "title": "撰写报告",
     "contract": { "<see node_contract.md>": true }},

    {"node_id": "n_end", "type": "end", "title": "完成",
     "archive_actions": [{"kind": "export_markdown", "to": "outputs/report.md"}]}
  ],
  "edges": [
    {"edge_id": "e_01", "source_node_id": "n_start",  "target_node_id": "n_extract", "type": "normal"},
    {"edge_id": "e_02", "source_node_id": "n_extract","target_node_id": "n_review",  "type": "normal"},
    {"edge_id": "e_03", "source_node_id": "n_review", "target_node_id": "n_report",  "type": "pass"},
    {"edge_id": "e_04", "source_node_id": "n_review", "target_node_id": "n_repair",  "type": "fail"},
    {"edge_id": "e_05", "source_node_id": "n_repair", "target_node_id": "n_extract", "type": "retry"},
    {"edge_id": "e_06", "source_node_id": "n_report", "target_node_id": "n_end",     "type": "normal"}
  ],
  "entry_node_id": "n_start",
  "terminal_node_ids": ["n_end"],
  "global_context_refs": [],
  "execution_policy": {"mode": "semi_auto", "max_concurrent_nodes": 1, "default_timeout_seconds": 600, "on_node_failure": "human"},
  "review_policy":    {"default_max_retry": 2, "escalate_after_repairs": 3, "evidence_required_for_factual_outputs": true},
  "model_policy":     {"default_model_profile_id": "claude-sonnet-default", "escalation_chain": ["claude-opus-strong"], "forbid_remote_for_sensitive": true},
  "created_by": "ai_planning",
  "draft_source": {"planning_session_id": "ps_01J9N5...", "draft_version": 3, "applied_patches": ["wp_01J9N5..."]},
  "created_at": "2026-06-15T08:00:00Z",
  "last_modified_at": "2026-06-15T08:30:00Z",
  "metadata": {}
}
```

---

## 10. 已锁定的设计决策（v0.1.0 Accepted）

| 序号 | 决策 |
|---|---|
| D-WG-1 | `version` 使用 SemVer；草案阶段使用 `WorkflowDraft.version: int` 单调递增；正式 Workflow 实例化后改用 SemVer，不允许降级 |
| D-WG-2 | **不允许**多 `start` 节点；多入口由 `subflow` 表达 |
| D-WG-3 | `EdgeCondition.expression` 在 Phase 1 使用 **JSON Logic 子集**（仅运算符 `==/!=/</<=/>/>=/and/or/not/in/var/missing`，禁止 `if/switch/method calls`）；CEL 留给 Phase 4 |
| D-WG-4 | `metadata` 必须命名空间化为 `metadata.<plugin_id>.<key>`；非命名空间的字段进入 `metadata.cw.<key>` 内部保留段，第三方扩展 L2 校验时报 `WG_L2_METADATA_NOT_NAMESPACED` |
| D-WG-5 | 节点级 `context_requirements` 与 `WorkflowGraph.global_context_refs` 重叠时，**节点级覆盖全局**；具体合并策略详见 `context_pack.md` §3 |
| D-WG-6 | **不**在 `WorkflowGraph` 内嵌入 Skill / MCP 版本快照；运行时锁定保存到 `runs/<run_id>/skill_lock.json` 与 `mcp_lock.json` |

> 上述决策于 2026-06-15 由产品负责人确认锁定，进入 Accepted 状态。后续若需要变更，必须通过 ADR 流程。

---

## 11. 错误码（L1~L4 校验输出）

> 错误码集合见上文 §8。本节作为预留位，避免再次插入决策表时编号回填困难。

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 待决项锁定（D-WG-1 ~ D-WG-6），状态升至 Accepted；对齐技术架构 v1.0 §6 与 UIUX v1.1 §18.8/§18.10/§18.11 |
