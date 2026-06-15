# Spec: ContextPack

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-schema-003` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §3 / §4；技术架构 v1.0 §3（ContextPack 定义）/ §5.2（Context Builder）/ §7.1（标准执行链路）；UIUX v1.1 §9（Task 详情面板） |
| 关联 spec | `specs/schemas/workflow_graph.md`、`specs/schemas/node_contract.md`（消费方）、`specs/schemas/evidence_pack.md`（同期产出，作为 ContextPack 内的事实片段）、`specs/protocols/context_builder.md`（待） |
| 关联 ADR | ADR-0002（Engine 不直接 import pydantic_ai）、ADR-0005（Pydantic AI 作为基座）、ADR-0007（持久化分层） |

> **范围**：本文定义 `ContextPack` 数据对象与构建协议——节点执行前 ContextBuilder 装填给 Adapter 的"最小充分上下文"。
>
> **非范围**：
> - 证据片段的字段细节（见 `evidence_pack.md`，被本文 §2.3 引用为 `pack_kind=evidence` 片段）
> - Context Builder 的内部检索算法（见 `specs/protocols/context_builder.md`，待）
> - Reflection Memory 的写回逻辑（见 `specs/protocols/reflection_memory.md`，待）
>
> **核心立场**：不同模型对长上下文的处理能力差异巨大。系统**禁止把所有资料直接塞给模型**（00_Concept §4），ContextPack 必须是**"当前节点所需的最小充分信息"**而不是"所有可能相关的信息"。本文的每个字段都应能回答：是谁、为什么、什么时候、装入了哪些片段、它们一共占多少 token、超额时按什么规则压缩。

---

## 0. 设计原则

1. **节点级独占**：每个 NodeAttempt 拥有自己的 ContextPack 副本，不跨节点共享内存对象。Builder 复用片段缓存但不复用 Pack。
2. **来源可追溯**：每个片段必须能反查"它从哪个 reference / 哪个 upstream artifact / 哪条 memory 来"，便于 ReflectionMemory 与人工审计。
3. **预算优先于完整性**：ContextPack 必须满足 token 预算硬上限；超额时按既定策略 (`truncate / summarize / drop_optional`) 处理，不能让模型自己截断。
4. **跨进程友好**：ContextPack 必须能被 JSON 序列化跨 Electron preload IPC 与 SSE 双通道传输，禁止携带运行时句柄、文件描述符、回调函数。
5. **与 EvidencePack 解耦**：ContextPack 是"喂给 LLM 看到的所有材料"；EvidencePack 是"事实声明的来源边界"。EvidencePack 嵌入 ContextPack 时作为一种**特殊片段类型**，但它有自己的 schema 与生命周期。
6. **Adapter 中立**：本文只定义"装满后的形态"，不绑定 Pydantic AI 的 `deps` 字段名；Adapter 翻译时必须保持字段语义不变。
7. **可重放**：相同 NodeContract + 相同上游 Artifact + 相同 Reference 索引快照应产生**等价的** ContextPack（哈希可比对），用于 NodeAttempt 复盘与 CW-Bench 评测对齐。

---

## 1. 顶层结构 `ContextPack`

### 1.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `pack_id` | `string` (ULID) | ✅ | — | 全局唯一；与对应 NodeAttempt 一对一绑定 |
| `schema_version` | `string` | ✅ | `0.1.0` | 本 spec 的版本号 |
| `node_id` | `string` | ✅ | — | 关联的 WorkflowNode ID |
| `attempt_id` | `string` | ✅ | — | 关联的 NodeAttempt ID |
| `run_id` | `string` | ✅ | — | 关联的 WorkflowRun ID |
| `node_goal` | `string` (≤2000) | ✅ | — | 复制自 `NodeContract.goal`，便于 Adapter / Logfire / 审计直接读取 |
| `global_summary` | `string` (≤4000) | ❌ | `""` | Workflow 级简要任务摘要（由 PlanningSession 写入或 ContextBuilder 生成） |
| `user_constraints` | `string[]` | ❌ | `[]` | 项目级显式约束（来自项目 Memory `constraints` 字段） |
| `fragments` | `ContextFragment[]` | ✅ | — | 上下文片段集合；按 `priority` 降序排列；详见 §2 |
| `output_format_hint` | `OutputFormatHint` | ❌ | `null` | 让模型对齐 `output_schema` 的提示信息（不替代 Pydantic 校验） |
| `template_inputs` | `object` | ❌ | `{}` | 渲染 `prompt.user_prompt_template` 时使用的字段（`deps.*` 解析路径的根） |
| `budget` | `ContextBudget` | ✅ | 见 §4 | token 预算 + 压缩策略 |
| `compression_log` | `CompressionLogEntry[]` | ❌ | `[]` | 构建期间的所有压缩 / 摘要 / 丢弃动作 |
| `provenance` | `ContextProvenance` | ✅ | — | Pack 的产生来源、时间、Builder 版本、模型上下文窗口尺寸；详见 §5 |
| `cache_meta` | `CacheMeta | null` | ❌ | `null` | 缓存命中信息（命中片段的 hash / TTL） |
| `metadata` | `object` | ❌ | `{}` | 扩展字段；命名空间化 `metadata.<plugin_id>.<key>` |

### 1.2 不变量

- 同一 `attempt_id` 仅一份 ContextPack（如重试更换则 `attempt_id` 也会换）
- `fragments` 不允许重复 `fragment_id`
- `fragments[*].source_kind` 与 `selector` 必须能反查回原始数据
- 所有片段的 `tokens_estimate` 之和 ≤ `budget.hard_limit_tokens`，否则在构建期失败
- 任意 `fragment.required=true` 的片段不可被 `compression_log` 中的 `drop` 动作消除——这是构建期硬约束

---

## 2. 上下文片段 `ContextFragment`

### 2.1 公共字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fragment_id` | `string` | ✅ | Pack 内唯一；可读 ID（如 `frag_upstream_research_questions`） |
| `key` | `string` | ✅ | 该片段在 `template_inputs` 与 `deps` 中的访问键，与 `ContextRequirement.key` 对齐 |
| `kind` | `FragmentKind` | ✅ | 见 §2.2 |
| `priority` | `enum: critical / high / normal / low` | ✅ | 压缩时的丢弃顺序：low 先 drop，critical 永不丢弃 |
| `required` | `bool` | ✅ | true 时严禁被 drop，但仍可被 truncate / summarize |
| `tokens_estimate` | `int` (≥0) | ✅ | 估算 token 数；由 Builder 用模型 tokenizer 估算 |
| `tokens_actual` | `int | null` | ❌ | 实际写入 prompt 后的 token 数（Adapter 回填） |
| `text` | `string | null` | 视 kind | 已渲染的文本（多数 kind 用这个） |
| `payload` | `object | null` | 视 kind | 结构化数据（`upstream_artifact` / `evidence` 用这个） |
| `source` | `FragmentSource` | ✅ | 来源描述；详见 §2.3 |
| `transformation` | `FragmentTransformation | null` | ❌ | Builder 对该片段做过的处理（chunk / summarize / quote_extract） |
| `created_at` | `string` (ISO-8601) | ✅ | — |
| `metadata` | `object` | ❌ | 命名空间化扩展字段 |

### 2.2 `FragmentKind` 枚举

| `kind` | 用途 | `text` / `payload` | 必备字段 |
|---|---|---|---|
| `node_goal` | 节点目标的明确陈述 | `text` | — |
| `global_summary` | Workflow 级摘要 | `text` | — |
| `user_constraint` | 用户约束 | `text` | — |
| `upstream_artifact` | 上游节点的产物（结构化） | `payload` | `source.from_node_id`、`source.artifact_field` |
| `project_memory` | 项目级 Memory 条目 | `text` 或 `payload` | `source.memory_key` |
| `reference_chunk` | 参考资料的某个 chunk（裸文本） | `text` | `source.reference_id`、`source.chunk_id` |
| `evidence` | 来自 EvidencePack 的事实片段（带引用） | `payload` | 嵌入 `EvidencePack` 的 `Evidence` 对象（见 evidence_pack.md） |
| `static_text` | 静态文本（NodeContract.context_requirements.kind=static_text） | `text` | — |
| `user_input` | Run 启动时的初始输入 | `text` 或 `payload` | `source.input_field` |
| `instruction_addendum` | Capability / ReflectionMemory 注入的额外指令 | `text` | `source.injected_by` |
| `failure_history` | 过往 attempts 失败摘要（仅 repair / re-run 节点） | `payload` | `source.attempt_ids[]` |

### 2.3 `FragmentSource`

`source` 字段是判别式联合（discriminated union），其形式由 `FragmentKind` 决定：

```yaml
upstream_artifact:
  source_kind: "upstream_artifact"
  from_node_id: string
  artifact_field: string         # 支持 JSONPath；如 "research_questions[*]"
  artifact_run_id: string | null # 哪一次 Run 产生（默认当前 run）

reference:
  source_kind: "reference"
  reference_id: string
  chunk_id: string
  chunk_index: int
  position: { start: int, end: int } | null
  similarity_score: number | null

project_memory:
  source_kind: "project_memory"
  memory_key: string
  memory_version: string | null

evidence:
  source_kind: "evidence"
  evidence_pack_id: string
  evidence_id: string

user_input:
  source_kind: "user_input"
  input_field: string

static_text:
  source_kind: "static_text"
  contract_field_path: string    # 如 "context_requirements[2]"

injected:
  source_kind: "injected"
  injected_by: string            # capability_id / reflection_memory / planner
  reason: string

failure_history:
  source_kind: "failure_history"
  attempt_ids: string[]
```

### 2.4 `FragmentTransformation`

记录 Builder 对该片段做过的处理，用于审计与重放：

| 字段 | 类型 | 说明 |
|---|---|---|
| `kind` | `enum: as_is / chunk / summarize / quote_extract / truncate / merge / inline_resize` | 处理类型 |
| `details` | `object` | 处理细节（如 chunk 的 size、summarize 的目标长度、truncate 的策略） |
| `original_tokens` | `int` | 处理前的 token 数 |
| `final_tokens` | `int` | 处理后的 token 数 |
| `summarizer_model` | `string | null` | 当 kind=summarize 时使用的模型 |
| `at` | `string` (ISO-8601) | 处理时间 |

---

## 3. 与 `NodeContract.context_requirements` 的解析关系

### 3.1 解析流程

```
NodeContract
   └── context_requirements: ContextRequirement[]      ← 节点级显式声明
WorkflowGraph.global_context_refs                      ← 全局引用列表
ProjectMemory + UserInputs + UpstreamArtifacts         ← 数据源
            │
            ▼
ContextBuilder (MCCL)
            │
            ▼
ContextPack {
  fragments: ContextFragment[],
  budget,
  provenance,
  ...
}
```

### 3.2 优先级与覆盖规则（对齐 D-WG-5）

按优先级**从高到低**处理：

1. NodeContract.context_requirements 中 `required=true` 的项 — **必须满足**
2. NodeContract.context_requirements 中 `required=false` 的项 — 按预算尽力
3. WorkflowGraph.global_context_refs 列出的全局引用 — 节点级未显式禁用时纳入
4. ReflectionMemory 注入（同节点类型 + 同失败类型的成功 Patch） — 作为 `instruction_addendum` 片段
5. Capability 中间件注入（如 ToolSearch / Reinject System Prompt） — 在 §3.3 时机注入

冲突规则：

- 同一 `key` 出现节点级与全局两份时，**节点级覆盖全局**（直接舍弃全局对应项）
- 节点级显式列出 `required=false` 但全局列出该 reference 时，仍按节点级处理（即低优先级）
- ReflectionMemory 注入的片段不允许覆盖节点级显式 `required=true` 的片段

### 3.3 注入时机（与 Pydantic AI Agent 生命周期对齐）

ContextPack 在 `Agent.iter()` 启动**之前**完整构建好，作为不可变对象传入 Adapter；运行中不再修改。例外是：

- Capability 的 `wrap_run / wrap_node_run` hook 可在 attempt 之间**新建一份 ContextPack 副本**（修改不改原对象）
- 重试时 RepairPatch 可指示 Builder 重新构建（仅 `kind=context_patch` 的 patch 会触发）

---

## 4. 预算与压缩 `ContextBudget`

### 4.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `model_context_window_tokens` | `int` (≥1024) | ✅ | — | 来自 ModelProfile.max_context_tokens |
| `reserved_for_output_tokens` | `int` (≥256) | ✅ | `4096` | 为模型输出预留的上限 |
| `reserved_for_history_tokens` | `int` (≥0) | ❌ | `0` | 为 message_history 预留 |
| `reserved_for_tools_tokens` | `int` (≥0) | ❌ | `2048` | 为工具定义占位 |
| `hard_limit_tokens` | `int` (≥1024) | ✅ | 由 builder 计算 | = window - output - history - tools - safety_margin |
| `safety_margin_tokens` | `int` (≥0) | ❌ | `512` | 误差保护 |
| `compression_strategy` | `CompressionStrategy` | ✅ | 见 §4.2 | 压缩策略 |

### 4.2 `CompressionStrategy`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `default_long_text_action` | `enum: truncate_head / truncate_tail / truncate_middle / summarize / quote_extract` | `summarize` | 文本片段长度超出预算时的默认动作 |
| `summarizer_model_profile_id` | `string \| null` | `null` | 用于摘要的模型；为 null 时用与节点同模型 |
| `summarize_min_tokens` | `int` | `1024` | 仅当片段长度超过此值时才考虑 summarize；否则改用 truncate_middle |
| `drop_priority_threshold` | `enum: low / normal / high / critical` | `low` | 预算紧张时允许丢弃的优先级阈值（即 ≤ 该级别可丢） |
| `keep_evidence_intact` | `bool` | `true` | EvidencePack 内的 `Evidence` 片段不得 summarize（只能 quote_extract 或丢弃低优先级 evidence） |
| `chunk_size_tokens` | `int` | `512` | reference_chunk 的目标尺寸 |
| `chunk_overlap_tokens` | `int` | `64` | reference_chunk 的重叠尺寸 |

### 4.3 压缩流程（伪流程，写入 `compression_log`）

```
1. 计算 sum(tokens_estimate) over fragments
2. 若 sum ≤ hard_limit → 完成
3. 否则按 priority 升序遍历 (low → critical)：
   a. 若 priority ≤ drop_priority_threshold 且 required=false → drop
   b. 否则若 kind ∈ {reference_chunk, project_memory, failure_history, instruction_addendum} → summarize
   c. 否则若 kind=upstream_artifact → quote_extract（保留 schema 关键字段）
   d. 否则若 kind=evidence → 仅当 keep_evidence_intact=false 才 summarize；否则 drop 低优先级 evidence
   e. 重新计算 sum
4. 单趟过后仍超额 → 抛 ContextPackOverBudget 错误（构建期失败，触发 RepairPatch）
```

### 4.4 `CompressionLogEntry`

| 字段 | 类型 | 说明 |
|---|---|---|
| `fragment_id` | `string` | 被处理的片段 |
| `action` | `enum: dropped / summarized / truncated / quote_extracted / merged` | 动作 |
| `before_tokens` | `int` | 处理前 token 数 |
| `after_tokens` | `int` | 处理后 token 数（dropped 时为 0） |
| `reason` | `string` | 触发原因（"budget_exceeded" / "policy_drop_low" / 等） |
| `at` | `string` (ISO-8601) | 时间 |

---

## 5. `ContextProvenance`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `builder_version` | `string` | ✅ | ContextBuilder 实现版本（SemVer） |
| `built_at` | `string` (ISO-8601) | ✅ | 构建时间 |
| `model_profile_id` | `string` | ✅ | 当前节点目标模型（用于决定 tokenizer 与 window） |
| `tokenizer` | `string` | ✅ | 使用的 tokenizer 标识（如 `cl100k_base` / `claude-tokenizer-v3`） |
| `requirements_hash` | `string` | ✅ | NodeContract.context_requirements 的稳定 hash |
| `inputs_hash` | `string` | ✅ | 上游 Artifact + Reference 索引快照 + Memory 当前版本的复合 hash |
| `pack_hash` | `string` | ✅ | ContextPack 整体（去除运行时字段后）的稳定 hash；用于重放与缓存 |

> `pack_hash` 计算时排除：`compression_log[*].at`、`fragments[*].created_at`、`provenance.built_at`、`cache_meta.*`、`metadata.cw.runtime.*`。

---

## 6. 缓存 `CacheMeta`

ContextPack 整体不缓存（每次 attempt 都新建），但**片段级**缓存可命中：

| 字段 | 类型 | 说明 |
|---|---|---|
| `fragment_cache_hits` | `string[]` | 命中缓存的 fragment_id 列表 |
| `cache_namespace` | `string` | 缓存命名空间，建议 `<project_id>::context_fragment::<tokenizer>` |
| `ttl_seconds` | `int` | 默认 24 小时 |
| `invalidated_by` | `string[]` | 触发失效的事件（如 `reference_reindex`、`memory_write`） |

片段缓存的 key：`hash(source) + hash(transformation_kind) + hash(tokenizer)`。

---

## 7. `OutputFormatHint`

为了帮助中等模型对齐 `output_schema`，Builder 可生成"非强制提示"：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | `enum: schema_only / schema_with_example / few_shot / none` | ✅ | 提示形式 |
| `example_count` | `int` (≥0) | ❌ | few_shot 模式下的示例数 |
| `examples` | `object[]` | ❌ | 嵌入 prompt 的示例（每条须满足 output_schema） |
| `style_notes` | `string` | ❌ | "请用 JSON / 不要 Markdown / 字段顺序固定"等 |

**OutputFormatHint 不替代 ValidatorPolicy**，仅作为辅助；Pydantic 校验仍是真理。

---

## 8. 与 Pydantic AI 的 Adapter 边界

### 8.1 字段映射

| ContextPack | Pydantic AI 投递位置 |
|---|---|
| `node_goal` | 不进 prompt；放入 `RunContext.metadata.cw.node_goal` 供 instrumentation 读 |
| `global_summary` | 写入 `Agent.system_prompt` 第一段（拼接） |
| `user_constraints` | 写入 `Agent.system_prompt` 约束段 |
| `template_inputs`（即 `deps.*`） | 装进 `Agent(deps_type=)` 对应的 Pydantic 模型实例，作为 `agent.run(deps=...)` |
| `fragments[kind=node_goal]` | 在 `user_prompt` 头部 |
| `fragments[kind=upstream_artifact / project_memory / reference_chunk]` | 渲染入 `user_prompt_template` 的 `{{ deps.<key> }}` 插槽 |
| `fragments[kind=evidence]` | 转译为 `EvidencePack`，由 `evidence_pack.md` 描述 Adapter 行为 |
| `fragments[kind=instruction_addendum]` | 拼接到 `Agent(instructions=...)` 末尾 |
| `output_format_hint` | 转 `Agent(system_prompt)` 的 schema 提示段 + 可选的 `examples` |
| `budget.*` | 在 Adapter 构造时校验 `model_settings.max_tokens` 与 `reserved_for_output_tokens` 的一致性 |

### 8.2 反向约束

- Adapter **不得**修改 ContextPack 内容；Adapter 只读
- 任何"再注入"必须由 Capability 在 `wrap_run` 或 `wrap_node_run` 中产生**新版本** ContextPack（产生 `wp_id` 派生关系）
- ContextPack 中的 `fragments[*].text` 必须是已渲染的最终字符串；Adapter 不再做模板渲染（避免双重渲染）

---

## 9. JSON 示例（最小 ContextPack）

```json
{
  "pack_id": "ctxp_01J9N5T0ZY...",
  "schema_version": "0.1.0",
  "node_id": "n_extract",
  "attempt_id": "att_01J9N5T1QC...",
  "run_id": "run_01J9N5SXAA...",
  "node_goal": "从用户提供的 PDF 摘要中提取 3-5 个明确、可研究的研究问题",
  "global_summary": "用户希望针对'低空经济中无人机交付'方向梳理研究问题并产出报告",
  "user_constraints": [
    "本项目敏感资料不可发送至云端模型",
    "最终报告须为中文"
  ],
  "fragments": [
    {
      "fragment_id": "frag_goal",
      "key": "node_goal",
      "kind": "node_goal",
      "priority": "critical",
      "required": true,
      "tokens_estimate": 32,
      "text": "从用户提供的 PDF 摘要中提取 3-5 个明确、可研究的研究问题。",
      "source": {"source_kind": "static_text", "contract_field_path": "goal"},
      "created_at": "2026-06-15T08:30:01Z"
    },
    {
      "fragment_id": "frag_user_input_goal",
      "key": "project_goal",
      "kind": "user_input",
      "priority": "high",
      "required": true,
      "tokens_estimate": 18,
      "text": "梳理低空经济中无人机交付的关键研究问题",
      "source": {"source_kind": "user_input", "input_field": "project_goal"},
      "created_at": "2026-06-15T08:30:01Z"
    },
    {
      "fragment_id": "frag_ref_chunk_001",
      "key": "reference_summary",
      "kind": "reference_chunk",
      "priority": "high",
      "required": true,
      "tokens_estimate": 480,
      "text": "...低空经济无人机交付的政策环境与技术成熟度...",
      "source": {
        "source_kind": "reference",
        "reference_id": "ref_drone_2025_review",
        "chunk_id": "chk_007",
        "chunk_index": 7,
        "position": {"start": 1024, "end": 2560},
        "similarity_score": 0.83
      },
      "transformation": {
        "kind": "chunk",
        "details": {"chunk_size_tokens": 512, "overlap": 64},
        "original_tokens": 14823,
        "final_tokens": 480,
        "at": "2026-06-15T08:30:00Z"
      },
      "created_at": "2026-06-15T08:30:00Z"
    },
    {
      "fragment_id": "frag_ref_chunk_002",
      "key": "reference_summary",
      "kind": "reference_chunk",
      "priority": "normal",
      "required": false,
      "tokens_estimate": 470,
      "text": "...典型企业（顺丰、美团、京东、亿航）现有部署案例对比...",
      "source": {
        "source_kind": "reference",
        "reference_id": "ref_drone_2025_review",
        "chunk_id": "chk_011",
        "chunk_index": 11,
        "similarity_score": 0.72
      },
      "transformation": {"kind": "chunk", "details": {"chunk_size_tokens": 512}, "original_tokens": 14823, "final_tokens": 470, "at": "2026-06-15T08:30:00Z"},
      "created_at": "2026-06-15T08:30:00Z"
    },
    {
      "fragment_id": "frag_memory_constraint",
      "key": "constraints_memo",
      "kind": "project_memory",
      "priority": "high",
      "required": true,
      "tokens_estimate": 24,
      "text": "约束：本项目敏感资料不可发送至云端模型；最终报告须为中文。",
      "source": {"source_kind": "project_memory", "memory_key": "constraints"},
      "created_at": "2026-06-15T08:30:01Z"
    },
    {
      "fragment_id": "frag_addendum_reflection",
      "key": "instruction_addendum",
      "kind": "instruction_addendum",
      "priority": "normal",
      "required": false,
      "tokens_estimate": 60,
      "text": "提示：以往同类节点出现 missing_evidence 时，建议先逐一引用，再陈述结论。",
      "source": {"source_kind": "injected", "injected_by": "reflection_memory", "reason": "node_type=execution & failure_type=missing_evidence (n=4 successes)"},
      "created_at": "2026-06-15T08:30:01Z"
    }
  ],
  "output_format_hint": {
    "kind": "schema_with_example",
    "example_count": 1,
    "examples": [
      {
        "research_questions": [
          {
            "question": "在中国 1500 米以下空域，多机协同交付的延误瓶颈是什么？",
            "source_evidence_ids": ["ev_001"],
            "uncertainty": "样本规模有限",
            "priority": "high"
          }
        ]
      }
    ],
    "style_notes": "字段顺序固定；不输出 Markdown。"
  },
  "template_inputs": {
    "node_goal": "从用户提供的 PDF 摘要中提取 3-5 个明确、可研究的研究问题。",
    "project_goal": "梳理低空经济中无人机交付的关键研究问题",
    "reference_summary": "（由片段 frag_ref_chunk_001 / 002 拼接）",
    "constraints_memo": "约束：本项目敏感资料不可发送至云端模型；最终报告须为中文。"
  },
  "budget": {
    "model_context_window_tokens": 200000,
    "reserved_for_output_tokens": 4096,
    "reserved_for_history_tokens": 0,
    "reserved_for_tools_tokens": 2048,
    "safety_margin_tokens": 512,
    "hard_limit_tokens": 193344,
    "compression_strategy": {
      "default_long_text_action": "summarize",
      "summarizer_model_profile_id": null,
      "summarize_min_tokens": 1024,
      "drop_priority_threshold": "low",
      "keep_evidence_intact": true,
      "chunk_size_tokens": 512,
      "chunk_overlap_tokens": 64
    }
  },
  "compression_log": [],
  "provenance": {
    "builder_version": "0.1.0",
    "built_at": "2026-06-15T08:30:01Z",
    "model_profile_id": "claude-sonnet-default",
    "tokenizer": "claude-tokenizer-v3",
    "requirements_hash": "rhash_8f1c...",
    "inputs_hash": "ihash_31bd...",
    "pack_hash": "phash_9ad2..."
  },
  "cache_meta": null,
  "metadata": {}
}
```

---

## 10. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `CP_BUILD_REQ_UNRESOLVED` | 构建 | NodeContract.context_requirements 中 `required=true` 项无法解析 |
| `CP_BUILD_OVER_BUDGET` | 构建 | 单趟压缩后仍超出 hard_limit |
| `CP_BUILD_DROP_REQUIRED_FORBIDDEN` | 构建 | 压缩流程试图丢弃 `required=true` 片段 |
| `CP_BUILD_TOKENIZER_MISMATCH` | 构建 | provenance.tokenizer 与 ModelProfile 期望不一致 |
| `CP_BUILD_CACHE_INVALIDATED_LOOP` | 构建 | 缓存连续多次失效，怀疑死循环 |
| `CP_RUNTIME_PACK_MUTATED` | 运行 | Adapter / 中间件试图修改 ContextPack 字段（防止违反"只读"约束） |
| `CP_RUNTIME_TEMPLATE_VAR_MISSING` | 运行 | `template_inputs` 中找不到模板要求的变量 |

---

## 11. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-CP-1 | ContextPack **只读**：构建完成后到 attempt 结束之间不得被任何 Adapter / Capability 修改；变更须产生新版本 |
| D-CP-2 | 必填片段（`required=true`）禁止被 drop；只能 summarize / quote_extract / truncate；若仍超额则构建期失败并触发 RepairPatch |
| D-CP-3 | EvidencePack 内的 Evidence 片段默认 `keep_evidence_intact=true`；如需缩减只能丢弃低优先级 evidence，不允许 summarize evidence 内容 |
| D-CP-4 | 模板渲染由 ContextBuilder 完成（在写入 fragment.text 时），Adapter 不再二次渲染 |
| D-CP-5 | ContextPack `pack_hash` 不包含时间戳与缓存元数据，确保相同输入可重放 |
| D-CP-6 | ContextPack 必须 JSON-serializable，跨 Electron preload IPC 与 SSE 双通道传输；禁止携带文件句柄 / 回调函数 / 二进制 buffer（二进制资源走 EvidencePack 的 ResourceLink） |

---

## 12. 与未来 spec 的桥接

- 与 `evidence_pack.md`：本文 §2.3 中 `kind=evidence` 的 fragment 就是 EvidencePack 内的 Evidence 投影
- 与 `evaluation_result.md`：EvaluationResult 在审查阶段会读到 ContextPack（用于 evidence_coverage_rate 计算）
- 与 `repair_patch.md`：`patch_kind=context_patch` 的补丁直接作用于 ContextRequirement，触发 ContextBuilder 重建 Pack
- 与 `reflection_memory.md`：成功运行的 ContextPack 摘要会被写入 ReflectionMemory，作为下次同类节点的 `instruction_addendum` 注入候选

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-CP-1 ~ D-CP-6；对齐技术架构 v1.0 §3/§5.2/§7.1 |
