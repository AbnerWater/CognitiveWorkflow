# Spec: StreamEvent

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-schema-007` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 技术架构 v1.0 §3 / §7.1 / §10.3（StreamEvent Schema）/ §12（观测）；UIUX v1.1 §1.4（设计原则 P3）/ §8（流式输出面板）/ §FR-009/010/016 / §11（节点状态机） |
| 关联 spec | `specs/schemas/workflow_graph.md` / `node_contract.md` / `context_pack.md` / `evidence_pack.md` / `evaluation_result.md` / `repair_patch.md`（被引用）；`specs/protocols/agent_adapter.md`（待，Adapter 转译职责）；`specs/runtime_harness.md`（待，事件持久化）|
| 关联 ADR | ADR-0002、ADR-0008（StreamEvent 协议）、ADR-0009（HITL 走 AG-UI 通道）、ADR-0006（Electron 桌面 Shell） |

> **范围**：定义 `StreamEvent` 数据对象 + SSE 传输契约——Python Runtime 与 Electron renderer 之间事件流的唯一规范。
>
> **非范围**：
> - 事件具体生成位置（在 Adapter / Engine / MCCL 各处由不同模块产出）
> - 事件持久化的物理存储格式（仅约定 jsonl + 字段边界，物理细节见 `runtime_harness.md`）
> - AG-UI 协议本身的字段（StreamEvent 是 CW 自有事件流，与 pydantic-ai 的 AG-UI 输出形成两层；映射详见 §6）
>
> **核心立场**：StreamEvent 是用户感知 CW 运行状态的唯一渠道。它必须做到：**实时（SSE 推送 < 200ms，对齐 §UIUX 非功能需求）**、**有序（同 attempt 内单调）**、**完整（断线可重连补播）**、**结构化（前端不解析自由文本）**、**可折叠（默认折叠，避免信息过载）**、**可持久（落 jsonl 便于复盘）**。

---

## 0. 设计原则

1. **结构化优先于自由文本**：每个事件都有显式 `type` + `payload` schema；前端只通过类型驱动 UI，不正则解析 `content`。
2. **顺序保证**：同一 `(run_id, attempt_id)` 流内事件 `seq` 单调递增；跨 attempt 不强制全序，由 `created_at` 提供弱顺序。
3. **可重连**：SSE 客户端可携带 `Last-Event-ID` 重连，Runtime 必须能从该 ID 之后续传；持久化 jsonl 是断线重连的物理来源。
4. **三层折叠**：每条事件声明 `display_level: minimal / default / detailed`，前端默认按 `default` 展开，对应 UIUX §8.4 的"折叠 / 展开"行为。
5. **自描述**：事件携带足够定位信息（run_id / node_id / attempt_id / parent_event_id），不需要前端反查后端任何对象就能渲染基本信息。
6. **细粒度 Delta + 粗粒度 Snapshot 并存**：流式增量用 `*_delta` 事件；阶段结束用 `*_completed` 携带稳定状态；前端可只订阅其一。
7. **隐私分级**：事件 `sensitivity ∈ {public, project, sensitive}`；Runtime 在持久化和回放时按级别过滤。
8. **跨 Adapter 中立**：StreamEvent 是 CW 协议，不绑定 Pydantic AI；其它 Adapter（ClaudeCode / Codex / Hermes / LiteLLM）必须把自己的事件转译为 StreamEvent。
9. **永远向前兼容**：未识别的 `type` 前端必须以"未知事件 / 折叠展示原始 payload"形式不报错通过；Runtime 升级新事件类型不破坏旧客户端。

---

## 1. 顶层结构 `StreamEvent`

### 1.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `event_id` | `string` (ULID/UUIDv7) | ✅ | — | 全局唯一；同时作为 SSE 的 `id:` |
| `schema_version` | `string` | ✅ | `0.1.0` | — |
| `seq` | `int` (≥0) | ✅ | — | 同 `(run_id, attempt_id)` 流内单调递增；跨流可重 |
| `parent_event_id` | `string \| null` | ❌ | `null` | 用于父子关系（如 `tool_call` ↔ `tool_result`）；详见 §3 |
| `correlation_id` | `string \| null` | ❌ | `null` | 用于跨进程追踪（OTel TraceID） |
| `run_id` | `string` | ✅ | — | WorkflowRun |
| `node_id` | `string \| null` | ❌ | `null` | 关联 WorkflowNode；非节点级事件（如 `run_started`）为 null |
| `attempt_id` | `string \| null` | ❌ | `null` | 关联 NodeAttempt；非 attempt 级事件为 null |
| `type` | `EventType` | ✅ | — | 事件类型；详见 §2 |
| `category` | `EventCategory` | ✅ | — | 大类分组；详见 §1.2 |
| `phase` | `EventPhase \| null` | ❌ | `null` | 节点 / Run / Attempt 生命周期相位；详见 §1.3 |
| `title` | `string` (≤200) | ✅ | — | 前端折叠态显示的简明标题（如 `"调用工具：evidence_lookup"`）|
| `summary` | `string \| null` (≤2000) | ❌ | `null` | 折叠态副标题；不包含敏感正文 |
| `content` | `string \| null` | ❌ | `null` | 展开态的可渲染文本（Markdown 受限子集；详见 §1.4） |
| `payload` | `object \| null` | ❌ | `null` | 结构化载荷；按 `type` 决定 schema（详见 §2 各类型） |
| `artifact_refs` | `ArtifactRef[]` | ❌ | `[]` | 关联产物的引用（不直接含二进制） |
| `display_level` | `enum: minimal / default / detailed` | ✅ | `default` | UI 折叠分级 |
| `severity` | `enum: info / success / warning / error / fatal` | ✅ | `info` | 配色 / 图标 |
| `sensitivity` | `enum: public / project / sensitive` | ✅ | `project` | 隐私级别 |
| `expandable` | `bool` | ✅ | — | 是否允许展开查看 detail；UIUX §8.4 |
| `created_at` | `string` (ISO-8601 with ms) | ✅ | — | Runtime 产生时间 |
| `metadata` | `object` | ❌ | `{}` | 命名空间化扩展字段 |

### 1.2 `EventCategory`（大类分组，用于前端筛选 / 染色）

| 值 | 用途 |
|---|---|
| `lifecycle` | run / node / attempt 的开始 / 结束 / 取消 / 暂停 / 恢复 |
| `model` | 模型请求与响应（thought / text / tool_call / tool_result / 失败重试）|
| `tool` | 工具调用与返回（含 MCP）|
| `evaluation` | 评价节点产出 |
| `repair` | 修复节点产出与 Patch 应用 |
| `human` | 人工检查点交互 |
| `context` | ContextPack / EvidencePack 构建与重建 |
| `planning` | PlanningSession 阶段（§18） |
| `artifact` | 产物写入 / Git 快照 / 导出 |
| `metric` | 观测指标快照 |
| `error` | 异常 / 失败诊断 |
| `system` | sidecar 启停 / 心跳 / 版本 / 资源 |

### 1.3 `EventPhase`

可选字段，仅当事件落在某个生命周期相位时填写：

```
run.created / run.started / run.paused / run.resumed / run.completed / run.failed / run.cancelled
node.idle / node.ready / node.running / node.validating / node.reviewing / node.passed /
node.review_failed / node.repairing / node.retrying / node.waiting_user / node.skipped / node.failed
attempt.started / attempt.streaming / attempt.tool_calling / attempt.validating / attempt.completed / attempt.failed
planning.exploring / planning.understanding / planning.clarifying / planning.planning /
planning.validating / planning.previewing / planning.revising / planning.created
```

> 与 UIUX §11 的状态机 + §18.4.1 的规划阶段一一对齐。

### 1.4 `content` 渲染规则

- 受限 Markdown 子集：标题（h1-h3）、段落、列表、`code` / 代码块、表格、链接（仅相对/受信任协议）、行内 `<mark>` 高亮
- 禁用：`<script>` / `<iframe>` / 任意 HTML / 远程图片 URL（图片必须通过 ArtifactRef）
- 渲染失败时前端必须降级为纯文本

### 1.5 `ArtifactRef`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `artifact_id` | `string` | ✅ | Artifact Store 内的 ID |
| `kind` | `enum: artifact / pack / evaluation / patch / file / image / chart` | ✅ | — |
| `display_name` | `string` | ✅ | UI 标签 |
| `mime_type` | `string \| null` | ❌ | — |
| `size_bytes` | `int \| null` | ❌ | — |
| `preview_text` | `string \| null` | ❌ | 折叠态预览（≤500） |
| `path` | `string \| null` | ❌ | 项目相对路径（仅用户工程内可用） |

> 二进制内容**禁止**进入 `payload`；所有大文件 / 图片 / 表格通过 `artifact_refs` + 单独 HTTP `/artifacts/<id>` 拉取。

---

## 2. 事件类型 `EventType`（按 `category` 分组）

每个类型给出：`title` 模板、`payload` schema 摘要、`display_level` 默认值。完整 JSON Schema 在 §10。

### 2.1 `lifecycle` 类

| `type` | 描述 | `payload` 关键字段 | 默认 `display_level` |
|---|---|---|---|
| `run.started` | Run 开始 | `{ workflow_id, workflow_version, mode }` | `default` |
| `run.paused` | 暂停（用户 / 系统） | `{ reason }` | `default` |
| `run.resumed` | 恢复 | `{ from_checkpoint_id? }` | `minimal` |
| `run.completed` | Run 成功完成 | `{ artifact_summary }` | `default` |
| `run.failed` | Run 失败终止 | `{ error_kind, message }` | `default` |
| `run.cancelled` | 用户取消 | `{ by, reason? }` | `minimal` |
| `node.state_changed` | 节点状态机迁移 | `{ from, to, reason? }` | `minimal` |
| `attempt.started` | 节点 attempt 开始 | `{ attempt_index, model_profile_id }` | `default` |
| `attempt.completed` | 节点 attempt 成功 | `{ output_hash, duration_ms, usage }` | `default` |
| `attempt.failed` | 节点 attempt 失败 | `{ error_kind, will_retry, next_action? }` | `default` |

### 2.2 `model` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `model.request_started` | 单次模型请求开始 | `{ model_profile_id, model_settings, candidate_count }` | `minimal` |
| `model.thinking_delta` | 思考流增量（与 Pydantic AI `ThinkingPartDelta`） | `{ delta_text }` | `minimal` |
| `model.thought_completed` | 一段思考结束（聚合摘要） | `{ summary }` | `default` |
| `model.text_delta` | 文本响应增量 | `{ delta_text }` | `minimal` |
| `model.text_completed` | 一段文本响应结束 | `{ text, role }` | `default` |
| `model.request_completed` | 单次模型请求结束 | `{ usage, finish_reason, latency_ms }` | `minimal` |
| `model.request_failed` | 模型请求失败 | `{ error_kind, http_status?, retryable }` | `default` |
| `model.escalated` | RepairPatch 触发模型升级 | `{ from_model, to_model, patch_id }` | `default` |

> `*_delta` 事件**不**强制有序到字符级——前端按 `seq` 拼接即可。

### 2.3 `tool` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `tool.call_started` | 工具调用开始（含内置 / Skill / MCP） | `{ tool_id, args, args_hash, requires_approval }` | `default` |
| `tool.call_completed` | 工具调用成功 | `{ result_summary, duration_ms, output_artifact_refs? }` | `default` |
| `tool.call_failed` | 工具调用失败 | `{ error_kind, message, retryable }` | `default` |
| `tool.approval_required` | 工具需用户批准 | `{ tool_id, args_hash }` | `detailed` |
| `tool.approved` | 用户已批准 | `{ tool_id, decision_by }` | `minimal` |
| `tool.rejected` | 用户拒绝 | `{ tool_id, reason }` | `default` |

`payload.args` 必须遵守该工具的 `args_schema`，敏感参数由 sensitivity=`sensitive` 控制是否进入持久化。

### 2.4 `context` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `context.build_started` | ContextPack 构建开始 | `{ requirements_hash }` | `minimal` |
| `context.build_completed` | 构建结束 | `{ pack_id, pack_hash, fragments_count, total_tokens, hard_limit }` | `default` |
| `context.compression_applied` | 压缩动作（每条片段一条；Engine 可批合并） | `{ fragment_id, action, before_tokens, after_tokens }` | `detailed` |
| `context.over_budget_failed` | 构建超预算失败 | `{ overrun_tokens }` | `default` |
| `evidence.build_completed` | EvidencePack 构建结束 | `{ pack_id, evidences_count, coverage_ratio, conflicts_count }` | `default` |
| `evidence.conflict_detected` | 检测到冲突 | `{ conflict_id, severity, evidence_ids }` | `default` |
| `evidence.feedback_written` | EvidenceFeedback 写回 | `{ pack_id, unsupported_claim_estimates }` | `minimal` |

### 2.5 `evaluation` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `evaluation.started` | 评价节点开始 | `{ evaluator_node_id, target_node_id, target_attempt_id, arbitration }` | `default` |
| `evaluation.criterion_passed` | 单条 criterion 通过 | `{ criterion_id, score, evaluator_kind, evaluator_ref }` | `detailed` |
| `evaluation.criterion_failed` | 单条 criterion 失败 | `{ criterion_id, score, severity, finding_count }` | `default` |
| `evaluation.completed` | 评价完成（含 EvaluationResult 引用） | `{ eval_id, passed, score, failure_type?, recommended_action }` | `default` |
| `evaluation.judge_disagreement` | 多 judge 分歧 | `{ disagreement_score, will_escalate }` | `default` |

### 2.6 `repair` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `repair.started` | 修复节点开始 | `{ repair_node_id, target_node_id, evaluation_id }` | `default` |
| `repair.patch_proposed` | RepairAgent 输出 Patch | `{ patch_id, patch_kind, addresses_failure_types, risk_level, scope }` | `default` |
| `repair.patch_rejected` | Patch 校验未通过（3 道防线） | `{ patch_id, error_code, downgrade_to_human }` | `default` |
| `repair.patch_applied` | Engine 已应用 Patch | `{ patch_id, patch_kind, side_effects }` | `default` |
| `repair.patch_reverted` | 因后续失败回滚 Patch | `{ patch_id, reason }` | `detailed` |
| `repair.escalation_to_human` | 修复链路转人工 | `{ reason }` | `default` |

### 2.7 `human` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `human.gate_required` | 触发人工检查点 | `{ human_node_id, prompt_to_user, decisions[], timeout_seconds? }` | `default` |
| `human.gate_resolved` | 用户已决策 | `{ human_node_id, decision, by, custom_value? }` | `default` |
| `human.gate_timeout` | 人工等待超时 | `{ human_node_id, fallback }` | `default` |

> 与 pydantic-ai `ApprovalRequiredToolset` + `DeferredToolResults` 桥接见 §6.3。

### 2.8 `planning` 类（§UIUX §18 自动规划）

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `planning.session_started` | 规划会话开始 | `{ session_id, user_goal_summary }` | `default` |
| `planning.phase_changed` | 阶段切换 | `{ from, to }` | `default` |
| `planning.context_built` | 探索阶段完成 | `{ packs_summary }` | `minimal` |
| `planning.understanding_completed` | 理解结果 | `{ readiness, missing_decisions_count }` | `default` |
| `planning.clarification_question` | 推送澄清问题 | `{ question, options[] }` | `default` |
| `planning.clarification_answered` | 用户回答 | `{ question_id, answer }` | `minimal` |
| `planning.draft_generated` | 草案生成 | `{ draft_id, draft_version, validation_status }` | `default` |
| `planning.draft_validation` | 校验状态 | `{ draft_id, level, errors[] }` | `default` |
| `planning.draft_repaired` | 自动修复后 | `{ draft_id, draft_version }` | `minimal` |
| `planning.workflow_patch_proposed` | 草案 Patch 提案 | `{ patch_id, summary }` | `default` |
| `planning.workflow_instantiated` | 草案实例化为正式 Workflow | `{ workflow_id, version }` | `default` |

### 2.9 `artifact` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `artifact.written` | 产物写入 | `{ artifact_id, kind, path }` | `minimal` |
| `artifact.deleted` | 产物移除 | `{ artifact_id, reason }` | `minimal` |
| `git.snapshot_created` | Git 自动快照 | `{ commit_sha, message, snapshot_kind }` | `default` |
| `git.tag_created` | tag 创建 | `{ tag, refers_to }` | `minimal` |
| `export.completed` | 用户触发导出 | `{ format, path }` | `default` |

### 2.10 `metric` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `metric.snapshot` | 周期性指标快照 | `{ metrics: { node_pass_rate, avg_attempts, schema_error_rate, repair_success_rate, evidence_coverage_rate, ... } }` | `minimal` |
| `usage.delta` | token / cost 增量 | `{ run_id, input_tokens, output_tokens, est_cost_usd? }` | `minimal` |

### 2.11 `error` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `error.exception` | Runtime 抛出未捕获异常 | `{ error_kind, message, traceback_id }` | `detailed` |
| `error.network` | 远程模型 / 工具 网络错误 | `{ http_status, retryable }` | `default` |
| `error.budget_exhausted` | 预算耗尽（usage 限流） | `{ kind, limit }` | `default` |

### 2.12 `system` 类

| `type` | 描述 | `payload` | 默认 |
|---|---|---|---|
| `system.runtime_ready` | Runtime 启动完成（端口、版本） | `{ runtime_version, http_port, schema_versions }` | `minimal` |
| `system.heartbeat` | SSE 心跳（防代理切流） | `{ uptime_seconds }` | `minimal` |
| `system.runtime_shutting_down` | 即将停机 | `{ reason }` | `default` |

---

## 3. 父子关系 `parent_event_id`

用于把成对事件链起来，便于前端折叠。约定：

| 父事件 | 子事件 |
|---|---|
| `tool.call_started` | `tool.call_completed` / `tool.call_failed` / `tool.approval_required` |
| `tool.approval_required` | `tool.approved` / `tool.rejected` |
| `model.request_started` | `model.text_delta*` / `model.thinking_delta*` / `model.text_completed` / `model.request_completed` / `model.request_failed` |
| `evaluation.started` | `evaluation.criterion_*` / `evaluation.completed` / `evaluation.judge_disagreement` |
| `repair.started` | `repair.patch_proposed` / `repair.patch_rejected` / `repair.escalation_to_human` |
| `repair.patch_proposed` | `repair.patch_applied` / `repair.patch_reverted` |
| `human.gate_required` | `human.gate_resolved` / `human.gate_timeout` |
| `planning.clarification_question` | `planning.clarification_answered` |
| `context.build_started` | `context.compression_applied` / `context.build_completed` / `context.over_budget_failed` |

子事件的 `correlation_id` 必须复用父事件的；前端可据此把整条链折叠为单个卡片。

---

## 4. SSE 传输契约

### 4.1 端点

```
GET /observability/runs/{run_id}/stream
Accept: text/event-stream
Header  Last-Event-ID: <event_id>      ← 重连时带
Query   ?level=default&category=lifecycle,model,evaluation,repair,human   ← 客户端筛选
Query   ?since_seq=<int>&until_seq=<int>   ← 回放区间
```

### 4.2 帧格式

每条 StreamEvent 序列化为一帧：

```
id: <event_id>
event: <type>
retry: 3000
data: {...JSON of StreamEvent...}

```

- `event:` 字段使用 `type` 字段值；客户端可按 `EventSource.addEventListener(type, ...)` 路由
- `retry:` 默认 3000ms，给前端断线后建议重连间隔
- 单帧 `data:` 不超过 64 KiB；超过的事件必须把大块体改为 `artifact_refs`

### 4.3 心跳

无业务事件时，每 15s 发一条 `system.heartbeat`；防代理 / 反向代理 60s idle close。

### 4.4 重连与回放

- 客户端使用浏览器原生 `EventSource` 或 polyfill；自动携带 `Last-Event-ID`
- Runtime 必须能从 `runs/<run_id>/stream-events/*.jsonl` 中检索 `event_id` 之后的所有事件并补播
- 若 `event_id` 不存在（如已 GC）：Runtime 返回 `412 Precondition Failed`，客户端必须以"全量重载"方式重建状态；同时发出 `system.runtime_ready` 之类的恢复点事件

### 4.5 客户端筛选

`?category` 与 `?level` 在服务端过滤；客户端可二次过滤但**不允许**用客户端筛选替代服务端鉴权。

---

## 5. 顺序与一致性

| 范围 | 顺序保证 |
|---|---|
| 同 `(run_id, attempt_id)` | `seq` **严格单调递增**；不允许跳号；允许不连续（因服务端可能丢弃低于 `display_level` 阈值的 verbose 事件，但发送给特定客户端的 seq 必须连续） |
| 同 `(run_id, node_id)` 跨 attempt | 由 `created_at` 提供弱顺序；遇到不同 attempt 必须以 `attempt.started` 帧分割 |
| 同 `run_id` 跨节点 | 仅 `created_at` 顺序 + `node.state_changed` 事件作为分隔 |
| 跨 `run_id` | 不保证 |

> 服务端"丢弃 verbose 事件"的过滤发生在**写入持久化之后**，不影响审计；不同筛选订阅看到的 `seq` 在客户端层各自连续。

---

## 6. 与 Pydantic AI / AG-UI 的转译

### 6.1 Pydantic AI `AgentStreamEvent` → CW `StreamEvent`

按 `messages.py` 实际事件类做的对照（已在 [[project_pydantic_ai_mapping]] 列出，本表是 spec 的权威版）：

| Pydantic AI 事件 | CW `StreamEvent.type` | 备注 |
|---|---|---|
| `PartStartEvent[ThinkingPart]` | `model.thinking_delta`（首段含 `start=true`） | 拆分思考流 |
| `ThinkingPartDelta` | `model.thinking_delta` | — |
| `PartEndEvent[ThinkingPart]` | `model.thought_completed` | 聚合摘要由 Adapter 生成 |
| `PartStartEvent[TextPart]` | `model.text_delta`（首段含 `start=true`） | — |
| `TextPartDelta` | `model.text_delta` | — |
| `PartEndEvent[TextPart]` | `model.text_completed` | — |
| `FunctionToolCallEvent` | `tool.call_started` | tool_id = 函数名 |
| `BuiltinToolCallEvent` | `tool.call_started` | tool_id 带 `builtin:` 前缀 |
| `OutputToolCallEvent` | `model.request_completed`（聚合） | 输出工具调用按"模型完结"投影 |
| `FunctionToolResultEvent` | `tool.call_completed`（成功） / `tool.call_failed`（异常） | 由 Adapter 判定 |
| `BuiltinToolResultEvent` | 同上 | — |
| `OutputToolResultEvent` | （内部）→ `model.request_completed` | 不直接投影 |
| `FinalResultEvent` | `attempt.completed`（节点级，由 Engine 包装） | — |
| `AgentRunResultEvent` | `attempt.completed` | — |
| `ApprovalRequired` 异常 | `tool.approval_required` + `human.gate_required` | 同时发两条；前者父，后者子 |
| `ModelRetry` 异常 | `attempt.failed`（will_retry=true） + 视情况 `model.request_failed` | — |
| `ToolRetryError` 异常 | `tool.call_failed`（retryable=true） | — |
| `UsageLimitExceeded / UnexpectedModelBehavior / ContentFilterError / ModelHTTPError` | `error.*` | 见 §2.11 |

> Adapter 必须保证：**Pydantic AI 的事件流不直接对外发布**；所有发往 Electron renderer 的事件都经 CW StreamEvent 转译（ADR-0002）。

### 6.2 AG-UI 协议层

pydantic-ai 的 AG-UI（`ui/ag_ui/`）与 CW StreamEvent 是**两层**：

- AG-UI：单次 Agent 调用的 UI 事件流（厂商中立的 RAG/Agent UI 协议）
- StreamEvent：CW Workflow 全局事件流（跨节点 / 跨 attempt / 跨规划阶段）

桥接策略：CW 的 `PydanticAIAdapter` 内部使用 AG-UI，把它转为 StreamEvent 发出；前端 Electron renderer 不直接接 AG-UI 端点（避免双协议）。

### 6.3 HITL 桥接

```
1. 节点 toolset 含 ApprovalRequiredToolset
2. 模型选用受批准工具 → pydantic-ai 抛 ApprovalRequired
3. Adapter 转译：
   - 发 tool.approval_required        (parent A)
   - 发 human.gate_required           (child of A)
4. 前端展示用户决策卡片
5. 用户决策 → POST /workflow/{id}/node/{node_id}/decisions
6. Adapter:
   - 发 human.gate_resolved + tool.approved/rejected
   - 把 DeferredToolResults 提交给 pydantic-ai 续跑
```

---

## 7. 隐私与持久化

### 7.1 `sensitivity` 级别

| 级别 | 持久化 | 跨进程传输 | 跨设备同步 |
|---|---|---|---|
| `public` | ✅ | ✅ | ✅ |
| `project` | ✅ | ✅ | ⏳ Phase 4 模板分享时再考虑 |
| `sensitive` | 仅写入加密 SQLite，不写 jsonl | 仅 localhost SSE | ❌ |

`sensitivity=sensitive` 的事件**默认包括**：tool.call_started 携带敏感工具参数、human.gate_required 中的用户输入、含 EvidencePack 中标记 `sensitive=true` 的 evidence_id。

### 7.2 持久化路径（与 `runtime_harness.md` 对齐占位）

- `runs/<run_id>/stream-events/<yyyymmdd>.jsonl`：按日切片
- 每条事件按 §1.1 schema 完整 jsonl
- `sensitivity=sensitive` 的事件改写到 `runs/<run_id>/stream-events.encrypted.sqlite`
- 客户端通过 SSE 重连时 Runtime 从 jsonl + 加密 SQLite 双源恢复（按用户权限决定是否含 sensitive）

### 7.3 GC

默认保留 90 天；Workflow 完成后允许用户主动归档 / 清理。

---

## 8. 节点状态机的事件投影

下表给出 `WorkflowNode` 状态迁移与至少应产生的 StreamEvent：

| 状态变化 | 必发事件 |
|---|---|
| `idle → ready` | `node.state_changed{from:idle,to:ready}` |
| `ready → running` | `node.state_changed{from:ready,to:running}` + `attempt.started` |
| `running → validating` | `node.state_changed{...}` + `model.request_completed` |
| `validating → reviewing` | `evaluation.started` + `node.state_changed{...}` |
| `reviewing → passed` | `evaluation.completed{passed:true}` + `node.state_changed{to:passed}` + `attempt.completed` |
| `reviewing → review_failed` | `evaluation.completed{passed:false}` + `node.state_changed{to:review_failed}` |
| `review_failed → repairing` | `repair.started` + `node.state_changed{to:repairing}` |
| `repairing → retrying` | `repair.patch_proposed` + `repair.patch_applied` + `node.state_changed{to:retrying}` |
| `retrying → running` | `attempt.started`（新 attempt） |
| `* → waiting_user` | `human.gate_required` + `node.state_changed{to:waiting_user}` + `run.paused` |
| `waiting_user → running/skipped` | `human.gate_resolved` + `run.resumed` + 后续状态事件 |
| `* → failed` | `attempt.failed` + `node.state_changed{to:failed}` + 视情况 `error.*` |

WorkflowRun 状态机同理（`run_started / paused / resumed / completed / failed / cancelled`）。

---

## 9. UI 折叠规则（与 UIUX §8.4 对齐）

| `display_level` | 默认表现 |
|---|---|
| `minimal` | 仅在"折叠摘要条"显示一行；展开 detail 时不单独成块 |
| `default` | 流式输出面板默认呈现一个折叠卡片（标题 + summary） |
| `detailed` | 默认折叠为一行，但用户可逐条展开查看 payload / artifact |

事件 `parent_event_id` 非空时，前端默认**仅展示父卡片**，子事件折叠在父卡片内部（`tool.call_started` ↔ `tool.call_completed` 折叠为一条）。

`severity` 影响配色：
- `info` 灰 / 蓝
- `success` 绿
- `warning` 橙
- `error` 红
- `fatal` 红 + 顶部置顶提示

---

## 10. 完整 JSON Schema 摘要（关键事件）

> 完整 JSON Schema 由 `packages/schemas` 自动生成；此处仅列代表性结构。

### 10.1 `model.text_delta`

```json
{
  "event_id": "evt_01J9N5...",
  "schema_version": "0.1.0",
  "seq": 142,
  "parent_event_id": "evt_01J9N5_parent",
  "correlation_id": "trace_3xyz",
  "run_id": "run_01J...",
  "node_id": "n_extract",
  "attempt_id": "att_01J...",
  "type": "model.text_delta",
  "category": "model",
  "phase": "attempt.streaming",
  "title": "AI 回复",
  "summary": null,
  "content": null,
  "payload": {"delta_text": "在 2024-2026 年中国 1500 米以下空域……"},
  "artifact_refs": [],
  "display_level": "minimal",
  "severity": "info",
  "sensitivity": "project",
  "expandable": false,
  "created_at": "2026-06-15T08:35:13.481Z",
  "metadata": {}
}
```

### 10.2 `tool.call_started`

```json
{
  "event_id": "evt_01J9N5_tool",
  "schema_version": "0.1.0",
  "seq": 87,
  "parent_event_id": null,
  "correlation_id": "trace_3xyz",
  "run_id": "run_01J...",
  "node_id": "n_extract",
  "attempt_id": "att_01J...",
  "type": "tool.call_started",
  "category": "tool",
  "phase": "attempt.tool_calling",
  "title": "调用工具：evidence_lookup",
  "summary": "查询 evidence ev_001 的完整 quote",
  "content": null,
  "payload": {
    "tool_id": "evidence_lookup",
    "args": {"evidence_id": "ev_001"},
    "args_hash": "h_5df2",
    "requires_approval": false
  },
  "artifact_refs": [],
  "display_level": "default",
  "severity": "info",
  "sensitivity": "project",
  "expandable": true,
  "created_at": "2026-06-15T08:35:09.102Z",
  "metadata": {}
}
```

### 10.3 `evaluation.completed`

```json
{
  "event_id": "evt_01J9N5_eval",
  "schema_version": "0.1.0",
  "seq": 230,
  "parent_event_id": "evt_01J9N5_eval_started",
  "correlation_id": "trace_4abc",
  "run_id": "run_01J...",
  "node_id": "n_review",
  "attempt_id": "att_01J5_eval",
  "type": "evaluation.completed",
  "category": "evaluation",
  "phase": "node.review_failed",
  "title": "审查未通过：n_extract",
  "summary": "researchable criterion 失败（blocker）",
  "content": null,
  "payload": {
    "eval_id": "evr_01J9N5T9KQ...",
    "passed": false,
    "score": 0.62,
    "failure_type": "logic_gap",
    "recommended_action": {"action": "repair_with_patch", "target_repair_node_id": "n_repair"}
  },
  "artifact_refs": [
    {"artifact_id": "evr_01J9N5T9KQ...", "kind": "evaluation", "display_name": "EvaluationResult", "preview_text": null}
  ],
  "display_level": "default",
  "severity": "warning",
  "sensitivity": "project",
  "expandable": true,
  "created_at": "2026-06-15T08:35:18.012Z",
  "metadata": {}
}
```

### 10.4 `repair.patch_applied`

```json
{
  "event_id": "evt_01J9N5_patch",
  "schema_version": "0.1.0",
  "seq": 236,
  "parent_event_id": "evt_01J9N5_repair_started",
  "correlation_id": "trace_4abc",
  "run_id": "run_01J...",
  "node_id": "n_repair",
  "attempt_id": "att_01J6_repair",
  "type": "repair.patch_applied",
  "category": "repair",
  "phase": "node.retrying",
  "title": "已应用修复补丁",
  "summary": "prompt_patch（追加约束 + 1 个 few-shot）",
  "content": null,
  "payload": {
    "patch_id": "rp_01J9N5TC4M...",
    "patch_kind": "prompt_patch",
    "side_effects": ["effective_prompt_overlay_for_n_extract"]
  },
  "artifact_refs": [
    {"artifact_id": "rp_01J9N5TC4M...", "kind": "patch", "display_name": "RepairPatch"}
  ],
  "display_level": "default",
  "severity": "info",
  "sensitivity": "project",
  "expandable": true,
  "created_at": "2026-06-15T08:36:05.544Z",
  "metadata": {}
}
```

### 10.5 `human.gate_required`

```json
{
  "event_id": "evt_01J9N5_human",
  "schema_version": "0.1.0",
  "seq": 410,
  "parent_event_id": "evt_01J9N5_tool_appr",
  "correlation_id": "trace_4abc",
  "run_id": "run_01J...",
  "node_id": "n_export",
  "attempt_id": "att_01J7_export",
  "type": "human.gate_required",
  "category": "human",
  "phase": "node.waiting_user",
  "title": "需要确认：是否导出最终报告？",
  "summary": null,
  "content": null,
  "payload": {
    "human_node_id": "n_export_approval",
    "prompt_to_user": "即将把最终报告写入 outputs/report.md，是否继续？",
    "decisions": [
      {"key": "continue", "label": "确认导出"},
      {"key": "reject",   "label": "取消"},
      {"key": "edit",     "label": "我先修改一下"}
    ],
    "timeout_seconds": null
  },
  "artifact_refs": [
    {"artifact_id": "art_report_md_v3", "kind": "file", "display_name": "report.md（预览）", "preview_text": "..."}
  ],
  "display_level": "default",
  "severity": "warning",
  "sensitivity": "project",
  "expandable": true,
  "created_at": "2026-06-15T08:40:12.008Z",
  "metadata": {}
}
```

---

## 11. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `SE_BUILD_BAD_TYPE` | 构建 | type 不在枚举内 |
| `SE_BUILD_PARENT_NOT_FOUND` | 构建 | parent_event_id 找不到（开发期失败；生产期降级为 null + warning） |
| `SE_BUILD_PAYLOAD_TOO_LARGE` | 构建 | payload 序列化超过 64 KiB |
| `SE_BUILD_BINARY_IN_PAYLOAD` | 构建 | payload 含二进制 / Buffer |
| `SE_BUILD_SEQ_REGRESSION` | 构建 | 同 (run, attempt) 内 seq 回退 |
| `SE_BUILD_BAD_DISPLAY_LEVEL` | 构建 | display_level 不在枚举 |
| `SE_SSE_REPLAY_NOT_FOUND` | 传输 | Last-Event-ID 在持久化中找不到 → 返回 412 |
| `SE_SSE_RATE_LIMIT_EXCEEDED` | 传输 | 单连接事件速率过高（默认 200 events/s） |
| `SE_PERSIST_WRITE_FAILED` | 持久化 | jsonl 写入失败 |
| `SE_PERSIST_SENSITIVE_LEAK` | 持久化 | sensitive 事件被写入非加密通道（实现错误） |

---

## 12. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-SE-1 | StreamEvent 是 CW 与前端之间的**唯一**事件协议；所有 Adapter 必须转译，不允许直接发出底层（Pydantic AI / AG-UI / OpenAI / Claude）原始事件 |
| D-SE-2 | SSE 帧格式固定为 `id: / event: / retry: / data:` 四行 JSON；`event:` 字段必须等于 `type` |
| D-SE-3 | 同 `(run_id, attempt_id)` 内 `seq` 严格单调递增；不同筛选订阅各自连续 |
| D-SE-4 | 单帧 `data:` 不超过 64 KiB；超过时业务体改走 `artifact_refs` |
| D-SE-5 | `sensitivity=sensitive` 事件**禁止**写入 jsonl，仅写加密 SQLite；不允许跨设备同步 |
| D-SE-6 | 父子关系 `parent_event_id` 是 UI 折叠的依据；前端默认折叠子事件到父卡片 |
| D-SE-7 | 未识别的 `type` 必须以"未知事件折叠展示"形式被前端容忍，不得抛错——支持向前兼容 |
| D-SE-8 | 心跳 15s 一次（`system.heartbeat`），代理 60s idle close 上限；客户端 retry 默认 3000ms |
| D-SE-9 | `Last-Event-ID` 不存在时返回 `412 Precondition Failed`；客户端必须执行全量重载流程 |
| D-SE-10 | `display_level=minimal` 事件可被服务端按订阅过滤丢弃；丢弃**仅影响**该订阅，不影响持久化 |

---

## 13. 与未来 spec 的桥接

- `agent_adapter.md`（待）：Adapter 必须实现 `to_stream_events()`，把底层事件转译为 CW StreamEvent；本 spec §6.1 表是该协议的事实来源
- `runtime_harness.md`（待）：本 spec §7.2 路径与字段约束在 Harness spec 中具体落字段
- `state_machines/planning_session.md`（待）：本 spec §2.8 是该状态机的事件投影
- `protocols/observability.md`（待）：`metric.snapshot` 与 OTel 的桥接

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-SE-1 ~ D-SE-10；对齐技术架构 v1.0 §3/§7.1/§10.3/§12 与 UIUX v1.1 §1.4/§8/FR-009/010/016/§11；与 Pydantic AI AgentStreamEvent / AG-UI 字段级转译 |
