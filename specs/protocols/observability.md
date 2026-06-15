# Spec: Observability Protocol

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-protocol-006` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 技术架构 v1.0 §12（观测、评估与模型表现反馈）；UIUX v1.1 §FR-016（流式事件类型）；OpenTelemetry Semantic Conventions for GenAI（参考） |
| 关联 spec | 全部已锁定 spec（被引用为 span 来源）；`specs/runtime_harness.md` §2.1（traces/trace.sqlite 落盘位置） |
| 关联 ADR | ADR-0002、ADR-0007、ADR-0008、ADR-0006 |

> **范围**：定义 CognitiveWorkflow 的可观测性协议——把分散在 Engine / AgentAdapter / ModelRouter / ContextBuilder / EvidenceBuilder / ReflectionMemory / PlanningSession / Compiler 各模块里"应该被记录"的事实统一为：一套**OpenTelemetry span 命名规范**、一组**`cw.*` 属性 schema**、一组**指标（metrics）维度**、一份**SQLite Exporter 表结构**，以及它与 `stream_event.md` 的协作边界。
>
> **非范围**：
> - StreamEvent 本身（已锁定 `stream_event.md`）；本 spec 仅定义 OTel ↔ StreamEvent 的双向投影
> - 第三方观测后端的部署（如 Langfuse、Jaeger）；本 spec 仅约定本地 SQLite Exporter 与 OTel SDK 标准
> - 用户级别的 metric 看板设计（属于前端 UI 实现）
>
> **核心立场**：**所有路径都可被反查**。任何一次失败 / 一次成功 / 一次路由 / 一次注入都应能在 OTel trace 中找到完整链路；指标必须可量化技术架构 §12 的 8 项观测指标（node_pass_rate、avg_attempts_per_node、repair_success_rate、model_node_pass_rate、schema_error_rate、evidence_coverage_rate、human_interrupt_rate、workflow_completion_rate）。但这一切**不能阻塞主流程**——Exporter 失败不致命，trace 与流程严格解耦。

---

## 0. 设计原则

1. **OTel 是真理之源，StreamEvent 是用户视角**：OTel trace 记录"发生了什么"（机器视角，全量、结构化、可查询）；StreamEvent 记录"用户应该看到什么"（已抽样、已折叠、按隐私级过滤）。两者由 Engine 同时产出，不允许"只发 StreamEvent 不发 span"或反之。
2. **span 命名稳定**：所有 span name 使用 `cw.<domain>.<action>` 三段式，**不允许**带变量值；变量值进 attribute。
3. **属性 schema 严格枚举**：所有 `cw.*` attribute 在本 spec 内显式列出 + 类型 + 是否敏感。未在 spec 内的 `cw.*` attribute 禁止使用（避免随手命名漂移）。
4. **隐私分级 = StreamEvent**：sensitivity 标记沿用 `stream_event.md` D-SE-5；Exporter 写盘前按级别脱敏 / 加密。
5. **trace 与 stream-event 共享 correlation_id**：两套数据通过 `correlation_id`（即 OTel TraceID）一一关联；前端在面板上点"查看 trace"可以反查到对应 span。
6. **Exporter 失败不致命**：所有写盘动作走 best-effort，超时 / 锁失败 → degrade to warning；不允许阻塞 attempt。
7. **本地优先**：默认所有 trace / metric 落本地 SQLite；Logfire / Langfuse / OTLP 是可选 add-on，由 settings 开关。
8. **跨进程一致**：Electron 主进程、Python Runtime sidecar、Adapter 子进程必须共用同一 TraceID；通过 W3C `traceparent` header 在 HTTP/SSE 间传递。

---

## 1. 总体架构

```
┌──────────────────┐     traceparent header      ┌─────────────────────┐
│ Electron (main+  │  ──────────────────────────► │ Python Runtime      │
│   renderer)      │                              │   FastAPI + Engine  │
│                  │ ◄───── SSE + headers ─────── │                     │
└────┬─────────────┘                              └────┬────────────────┘
     │ OTel Node SDK                                   │ OTel Python SDK
     │ (自定义 Exporter via IPC)                        │ (multi-Exporter)
     │                                                  │
     ▼                                                  ▼
   trace.sqlite (主进程负责写)             trace.sqlite (sidecar 也写, 同一文件)
       │                                                │
       └──────────────  OTLP (可选) ────────────────────┘
                                │
                                ▼
                   Logfire / Langfuse / Jaeger
```

实现要点：

- 唯一权威 SQLite 文件：`<project>/.agent-workflow/traces/trace.sqlite`，由 sidecar 持有写锁；Electron 主进程通过 IPC 把自己 span 转给 sidecar 写入（避免双进程并发写 SQLite 文件）
- OTLP Exporter 可选；启用时以"复制"方式（同一份 span 同时写本地 + OTLP），不替代本地

---

## 2. Resource attributes（每条 span 共有）

| Attribute | 类型 | 必填 | 说明 |
|---|---|---|---|
| `service.name` | string | ✅ | 固定 `cognitiveworkflow` |
| `service.version` | string | ✅ | CW 版本 SemVer |
| `service.instance.id` | string | ✅ | sidecar pid / 主进程 pid |
| `cw.component` | enum | ✅ | `engine / compiler / adapter / model_router / context_builder / evidence_builder / reflection_memory / planning_session / runtime / desktop_main / desktop_renderer` |
| `cw.project.id` | string | ✅ | 项目 ULID |
| `cw.cw_version` | string | ✅ | 等同 service.version |
| `cw.runtime.os` | enum | ✅ | `windows / macos / linux` |
| `cw.adapter.id` | string | ❌ | 当 component=adapter 时必填 |
| `cw.adapter.version` | string | ❌ | — |
| `cw.deployment.mode` | enum | ✅ | `dev / packaged` |
| `cw.privacy.profile` | enum | ✅ | `strict / loose`（来自 settings.privacy） |

---

## 3. Span 命名总表

按 `domain` 分组。每条 span 给出：name、kind、必填 attributes、典型事件（events）、对应 StreamEvent 关系。

> SpanKind 取值：`INTERNAL / SERVER / CLIENT / PRODUCER / CONSUMER`，遵循 OTel 标准。

### 3.1 Workflow / Run / Attempt 生命周期（domain: `workflow`）

| span name | kind | 必填 attributes | events | 对应 StreamEvent |
|---|---|---|---|---|
| `cw.workflow.run` | INTERNAL | `cw.run.id / cw.workflow.id / cw.workflow.version / cw.run.mode` | `run.paused / run.resumed / run.completed / run.failed / run.cancelled` | `run.*` 系列 |
| `cw.workflow.compile` | INTERNAL | `cw.workflow.id / cw.workflow.version` | `compile.l1_passed / compile.l2_passed / ...` | — |
| `cw.workflow.node_execution` | INTERNAL | `cw.run.id / cw.node.id / cw.node.type / cw.node.title` | `node.state_changed{from→to}` | `node.state_changed` |
| `cw.workflow.attempt` | INTERNAL | `cw.run.id / cw.node.id / cw.attempt.id / cw.attempt.index / cw.adapter.id / cw.model.profile_id` | `attempt.completed / attempt.failed / attempt.cancelled` | `attempt.*` |

### 3.2 Adapter 内部（domain: `adapter`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.adapter.prepare` | INTERNAL | `cw.adapter.id / cw.attempt.id / cw.execution_pack.id` | `adapter.prepare_started / adapter.prepare_completed` |
| `cw.adapter.run` | INTERNAL | `cw.attempt.id / cw.adapter.id` | `adapter.run_started / adapter.run_completed` |
| `cw.adapter.resume` | INTERNAL | `cw.attempt.id / cw.resumption.kind` | `adapter.resume_started / adapter.resume_completed` |
| `cw.adapter.cancel` | INTERNAL | `cw.attempt.id / cw.cancel.reason` | — |
| `cw.adapter.finalize` | INTERNAL | `cw.attempt.id` | — |

### 3.3 Model（domain: `model`，对齐 OTel GenAI Semantic Conventions）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.model.request` | CLIENT | `cw.model.profile_id / cw.model.provider_id / cw.model.model_id / gen_ai.system / gen_ai.request.model / gen_ai.request.temperature / gen_ai.request.max_tokens / cw.attempt.id` | `model.thinking_started / model.thinking_completed / model.text_started / model.text_completed / model.request_completed / model.request_failed` |
| `cw.model.candidate` | INTERNAL | `cw.candidate.index / cw.candidate.count` | — |
| `cw.model.output_validation` | INTERNAL | `cw.attempt.id / cw.validation.mode` | `output_validation_passed / output_validation_failed` |

> `gen_ai.*` 命名空间复用 OTel 官方语义；`cw.*` 命名空间承载 CW 专有维度。Adapter 必须同时填两组（前者对接外部观测平台，后者驱动本地 SQLite Exporter）。

### 3.4 Tool / MCP（domain: `tool`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.tool.call` | INTERNAL | `cw.tool.id / cw.tool.kind (builtin/skill/mcp) / cw.attempt.id / cw.tool.requires_approval` | `tool.call_started / tool.call_completed / tool.call_failed` |
| `cw.tool.approval` | INTERNAL | `cw.tool.id / cw.attempt.id` | `tool.approval_required / tool.approved / tool.rejected` |
| `cw.mcp.client.session` | CLIENT | `cw.mcp.server_id / cw.mcp.transport` | `mcp.connected / mcp.disconnected` |

### 3.5 ContextBuilder / EvidenceBuilder（domain: `context` / `evidence`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.context_builder.build` | INTERNAL | `cw.context_pack.id / cw.attempt.id / cw.context.tokens_initial / cw.context.tokens_final / cw.context.fragments_count / cw.context.compressions_count` | `context.compression_applied / context.over_budget_failed` |
| `cw.context_builder.fetch_fragment` | INTERNAL | `cw.fragment.id / cw.fragment.kind / cw.cache.hit` | — |
| `cw.context_builder.compress` | INTERNAL | `cw.fragment.id / cw.compression.action` | — |
| `cw.evidence_builder.retrieve` | INTERNAL | `cw.evidence_pack.id / cw.evidence.candidates_count / cw.evidence.embedding_model` | `retrieve.lance_query / retrieve.tool_lookup` |
| `cw.evidence_builder.rerank` | INTERNAL | `cw.evidence_pack.id / cw.rerank.model / cw.rerank.removed_count` | `rerank.judge_completed / rerank.judge_failed` |
| `cw.evidence_builder.consolidate` | INTERNAL | `cw.evidence_pack.id / cw.evidence.coverage_ratio / cw.evidence.conflicts_count` | `evidence.conflict_detected{kind, severity}` |

### 3.6 Evaluation / Repair（domain: `evaluation` / `repair`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.evaluation.run` | INTERNAL | `cw.eval.id / cw.target_node.id / cw.target_attempt.id / cw.evaluation.arbitration` | `criterion.passed / criterion.failed / judge.disagreement` |
| `cw.evaluation.criterion` | INTERNAL | `cw.criterion.id / cw.criterion.kind / cw.criterion.severity / cw.criterion.passed` | — |
| `cw.repair.propose` | INTERNAL | `cw.repair_node.id / cw.target_node.id / cw.eval.id` | — |
| `cw.repair.patch_apply` | INTERNAL | `cw.patch.id / cw.patch.kind / cw.patch.scope / cw.patch.risk_level` | `patch.applied / patch.rejected / patch.reverted` |
| `cw.repair.escalation` | INTERNAL | `cw.escalation.position / cw.from_model / cw.to_model` | — |

### 3.7 ModelRouter（domain: `model_router`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.model_router.route` | INTERNAL | `cw.run.id / cw.node.id / cw.attempt.index / cw.routing.candidates_count / cw.routing.removed_count / cw.routing.escalation_position / cw.adapter.id / cw.model.profile_id / cw.routing.decision_id` | 每步留 event：`router.collect_candidates / router.apply_*_filter / router.tie_break / router.select` |
| `cw.model_router.rerouting` | INTERNAL | `cw.routing.decision_id / cw.rerouting.reason` | — |

### 3.8 ReflectionMemory（domain: `reflection`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.reflection.lookup` | INTERNAL | `cw.attempt.id / cw.lookup.kinds / cw.lookup.hit_count / cw.lookup.confidence_min` | — |
| `cw.reflection.write` | INTERNAL | `cw.memory.id / cw.memory.kind / cw.origin.kind / cw.memory.sample_count` | `memory.dedup_match / memory.new_entry` |
| `cw.reflection.aggregate` | INTERNAL | `cw.aggregate.profiles_updated / cw.aggregate.duration_ms` | — |

### 3.9 PlanningSession（domain: `planning`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.planning.session` | INTERNAL | `cw.planning.session_id / cw.planning.status / cw.planning.clarification_round_count / cw.planning.repair_round_count` | `planning.phase_changed{from→to}` |
| `cw.planning.explorer` | INTERNAL | `cw.planning.session_id` | — |
| `cw.planning.understanding` | INTERNAL | `cw.planning.session_id / cw.understanding.task_kind / cw.understanding.feasibility` | — |
| `cw.planning.clarification` | INTERNAL | `cw.planning.session_id / cw.clarification.question_id / cw.clarification.is_required` | — |
| `cw.planning.planner` | INTERNAL | `cw.planning.session_id / cw.draft.id / cw.draft.version` | — |
| `cw.planning.validate` | INTERNAL | `cw.planning.session_id / cw.draft.id / cw.draft.version / cw.validation.overall_passed / cw.validation.escalation` | `validation.l1_passed / validation.l2_passed / ...` |
| `cw.planning.patch` | INTERNAL | `cw.planning.session_id / cw.patch.id / cw.patch.source` | — |
| `cw.planning.instantiate` | INTERNAL | `cw.planning.session_id / cw.workflow.id / cw.workflow.version / cw.git.commit_sha` | — |

### 3.10 Stream（domain: `stream`，仅承载 SSE 服务端 span）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.stream.subscribe` | SERVER | `cw.run.id / cw.stream.subscriber_id / cw.stream.last_event_id?` | `stream.connected / stream.disconnected / stream.replay_started / stream.replay_completed` |
| `cw.stream.dispatch` | INTERNAL | `cw.event.type / cw.event.category / cw.event.display_level` | — |

### 3.11 Persistence / Git / Lock（domain: `runtime`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.runtime.manifest_write` | INTERNAL | `cw.manifest.name / cw.manifest.revision_before / cw.manifest.revision_after / cw.lock.held_ms` | — |
| `cw.runtime.lock_acquire` | INTERNAL | `cw.lock.name / cw.lock.acquirer_pid / cw.lock.wait_ms` | `lock.stale_cleaned` |
| `cw.runtime.git_commit` | INTERNAL | `cw.git.kind / cw.git.commit_sha / cw.git.message_prefix` | — |
| `cw.runtime.git_tag` | INTERNAL | `cw.git.tag / cw.git.refers_to` | — |
| `cw.runtime.gc` | INTERNAL | `cw.gc.scope / cw.gc.removed_count` | — |
| `cw.runtime.precommit_hook` | INTERNAL | `cw.git.commit_attempt_id / cw.hook.blocked_reason?` | — |

### 3.12 Adapter cancel / timeout / fault（domain: `fault`）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.fault.timeout` | INTERNAL | `cw.timeout.kind (attempt/tool/build) / cw.timeout.limit_ms` | — |
| `cw.fault.cancel` | INTERNAL | `cw.cancel.kind (user/system/idle) / cw.cancel.target_kind (run/attempt/planning)` | — |
| `cw.fault.exception` | INTERNAL | `cw.error.kind / cw.error.failure_type / cw.error.retryable` | — |

### 3.13 Desktop（domain: `desktop`，仅 Electron 主进程发出）

| span name | kind | 必填 attributes | events |
|---|---|---|---|
| `cw.desktop.sidecar_start` | INTERNAL | `cw.runtime.binary_path / cw.runtime.http_port` | — |
| `cw.desktop.sidecar_stop` | INTERNAL | `cw.runtime.exit_code / cw.runtime.uptime_seconds` | — |
| `cw.desktop.window_open` | INTERNAL | `cw.window.role / cw.project.id` | — |
| `cw.desktop.ipc_call` | INTERNAL | `cw.ipc.channel / cw.ipc.success` | — |

---

## 4. `cw.*` Attribute schema

下表是 `cw.*` 命名空间的**完整白名单**。新增 attribute 必须先更新本 spec。

| Attribute | Type | Sensitivity | 说明 |
|---|---|---|---|
| `cw.project.id` | string | public | 项目 ULID |
| `cw.cw_version` | string | public | — |
| `cw.privacy.profile` | enum | public | strict / loose |
| `cw.workflow.id` | string | public | — |
| `cw.workflow.version` | string | public | — |
| `cw.run.id` | string | public | — |
| `cw.run.mode` | enum | public | step / semi_auto / auto |
| `cw.node.id` | string | public | — |
| `cw.node.type` | enum | public | start / end / execution_task / evaluation_task / repair_task / human_checkpoint / tool_task / memory_task / subflow |
| `cw.node.title` | string | project | UI 显示名（不进入跨设备同步） |
| `cw.attempt.id` | string | public | — |
| `cw.attempt.index` | int | public | — |
| `cw.adapter.id` | string | public | — |
| `cw.adapter.version` | string | public | — |
| `cw.model.profile_id` | string | public | — |
| `cw.model.provider_id` | string | public | — |
| `cw.model.model_id` | string | public | — |
| `cw.execution_pack.id` | string | public | — |
| `cw.context_pack.id` | string | public | — |
| `cw.evidence_pack.id` | string | public | — |
| `cw.context.tokens_initial / tokens_final / fragments_count / compressions_count` | int | public | — |
| `cw.evidence.candidates_count / coverage_ratio / conflicts_count` | int/float | public | — |
| `cw.fragment.id / kind` | string/enum | project | — |
| `cw.cache.hit` | bool | public | — |
| `cw.compression.action` | enum | public | dropped / summarized / truncated / quote_extracted / merged |
| `cw.eval.id` | string | public | — |
| `cw.target_node.id / target_attempt.id` | string | public | — |
| `cw.evaluation.arbitration` | enum | public | single_judge / multi_judge / programmatic_first |
| `cw.criterion.id / kind / severity / passed` | string/enum/bool | public | — |
| `cw.patch.id / kind / scope / risk_level / source` | string/enum | public | — |
| `cw.escalation.position / from_model / to_model` | int/string | public | — |
| `cw.routing.candidates_count / removed_count / escalation_position / decision_id` | int/string | public | — |
| `cw.rerouting.reason` | enum | public | context_overflow / adapter_incompatible |
| `cw.lookup.kinds` | string[] | public | reflection_memory.kind 集合 |
| `cw.lookup.hit_count / confidence_min` | int/float | public | — |
| `cw.memory.id / kind / sample_count` | string/enum/int | public | — |
| `cw.origin.kind` | enum | public | reflection_memory.OriginRefs.kind |
| `cw.aggregate.profiles_updated / duration_ms` | int | public | — |
| `cw.planning.session_id / status / clarification_round_count / repair_round_count` | string/enum/int | public | — |
| `cw.understanding.task_kind / feasibility` | enum | public | — |
| `cw.clarification.question_id / is_required` | string/bool | public | — |
| `cw.draft.id / version` | string/int | public | — |
| `cw.validation.overall_passed / escalation` | bool/enum | public | — |
| `cw.event.type / category / display_level` | enum | public | — |
| `cw.stream.subscriber_id / last_event_id` | string | public | — |
| `cw.manifest.name / revision_before / revision_after` | string/int | public | — |
| `cw.lock.name / acquirer_pid / wait_ms / held_ms` | string/int | public | — |
| `cw.git.kind / commit_sha / tag / refers_to / message_prefix` | string/enum | public | — |
| `cw.gc.scope / removed_count` | enum/int | public | — |
| `cw.timeout.kind / limit_ms` | enum/int | public | — |
| `cw.cancel.kind / reason / target_kind` | enum/string | public | — |
| `cw.error.kind / failure_type / retryable` | enum/bool | public | — |
| `cw.tool.id / kind / requires_approval` | string/enum/bool | public | — |
| `cw.mcp.server_id / transport` | string/enum | public | — |
| `cw.desktop.window.role` | enum | public | main / drawer / external |
| `cw.ipc.channel / success` | string/bool | public | — |

> 严禁出现的 attribute（不允许写入 OTel）：
> - 任何含 prompt 原文 / 模型输出原文 / quote 原文（这些走 ContextPack / EvidencePack 落盘，不进 trace）
> - 任何含用户 PII / API key / 凭证字符串
> - 单值长度 > 1024 字符

---

## 5. Span ↔ StreamEvent 双向投影

每条 StreamEvent 都对应至少一个 OTel span 或 event。Engine 生成事件时**同时**做两件事：

```
on_business_event(payload):
    1. 创建 / 更新 span（使用对应 cw.<domain>.<action> name + attributes）
    2. 构造 StreamEvent（按 stream_event.md schema）
    3. 写入持久化（trace.sqlite + stream-events jsonl）
    4. 推送 SSE
```

### 5.1 投影对应表（关键）

| StreamEvent.type | 对应 Span / Span Event |
|---|---|
| `run.started / paused / resumed / completed / failed / cancelled` | `cw.workflow.run` 的 lifecycle event |
| `node.state_changed` | `cw.workflow.node_execution` 的 event |
| `attempt.started / completed / failed` | `cw.workflow.attempt` 的 start / end |
| `model.request_started / completed / failed` | `cw.model.request` 的 start / end / error |
| `model.thinking_delta / text_delta` | 不创建独立 span（性能考虑）；累计聚合到 `cw.model.request` 的 `messageEvents` 字段 |
| `model.escalated` | `cw.repair.escalation` |
| `tool.call_started / completed / failed` | `cw.tool.call` |
| `tool.approval_required / approved / rejected` | `cw.tool.approval` |
| `context.build_completed / over_budget_failed / compression_applied` | `cw.context_builder.build` 与子 span |
| `evidence.build_completed / conflict_detected / feedback_written` | `cw.evidence_builder.*` |
| `evaluation.started / criterion_* / completed / judge_disagreement` | `cw.evaluation.*` |
| `repair.started / patch_proposed / patch_rejected / patch_applied / patch_reverted / escalation_to_human` | `cw.repair.*` |
| `human.gate_required / gate_resolved / gate_timeout` | `cw.tool.approval` 或独立 `cw.fault.timeout` |
| `planning.*`（11 类） | `cw.planning.*` |
| `artifact.written / git.snapshot_created / git.tag_created / export.completed` | `cw.runtime.git_commit / .git_tag` |
| `metric.snapshot / usage.delta` | metric instrument（详见 §7） |
| `error.exception / network / budget_exhausted` | `cw.fault.exception` |
| `system.runtime_ready / heartbeat / runtime_shutting_down` | `cw.desktop.sidecar_*` |

### 5.2 反向追踪

OTel TraceID 即 `correlation_id`；用户在 UI 上点"查看 trace"：

```
GET /observability/traces/{trace_id}
  → 从 trace.sqlite 取该 trace 的所有 span（树形）
  → 渲染 trace tree + 每个 span 的属性 / events
```

不依赖 OTLP / 远端 backend；trace.sqlite 自身已足够支撑回放。

---

## 6. SQLite Exporter 表结构

文件：`<project>/.agent-workflow/traces/trace.sqlite`。所有写入由 sidecar 持有锁；其它进程通过 IPC 转发。

```sql
-- spans 主表
CREATE TABLE spans (
    span_id          BLOB PRIMARY KEY,         -- 16 bytes
    trace_id         BLOB NOT NULL,            -- 16 bytes
    parent_span_id   BLOB,                     -- nullable (root span)
    name             TEXT NOT NULL,            -- e.g. cw.adapter.run
    kind             INTEGER NOT NULL,         -- OTel SpanKind
    start_unix_nano  INTEGER NOT NULL,
    end_unix_nano    INTEGER,                  -- nullable (open span)
    status_code      INTEGER NOT NULL DEFAULT 0,    -- 0 unset / 1 ok / 2 error
    status_message   TEXT,
    component        TEXT NOT NULL,            -- cw.component
    run_id           TEXT,
    node_id          TEXT,
    attempt_id       TEXT,
    sensitivity      TEXT NOT NULL DEFAULT 'public', -- public/project/sensitive
    attributes_json  TEXT NOT NULL,            -- 全量 cw.* + gen_ai.* JSON
    events_json      TEXT NOT NULL DEFAULT '[]',-- span events
    links_json       TEXT NOT NULL DEFAULT '[]',
    resource_id      INTEGER NOT NULL,         -- → resources.resource_id
    inserted_at      INTEGER NOT NULL          -- unix ms
);
CREATE INDEX idx_spans_trace ON spans(trace_id);
CREATE INDEX idx_spans_run   ON spans(run_id);
CREATE INDEX idx_spans_attempt ON spans(attempt_id);
CREATE INDEX idx_spans_name  ON spans(name);
CREATE INDEX idx_spans_time  ON spans(start_unix_nano);

-- resource attributes（共享存储以节省空间）
CREATE TABLE resources (
    resource_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_hash BLOB UNIQUE NOT NULL,        -- blake3 of canonical
    attributes_json TEXT NOT NULL
);

-- metrics 主表
CREATE TABLE metrics (
    metric_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,            -- e.g. cw.workflow.completion_rate
    kind             TEXT NOT NULL,            -- counter / histogram / gauge
    timestamp        INTEGER NOT NULL,
    value_double     REAL,
    value_int        INTEGER,
    histogram_buckets_json TEXT,
    attributes_json  TEXT NOT NULL,            -- 维度
    resource_id      INTEGER NOT NULL
);
CREATE INDEX idx_metrics_name_ts ON metrics(name, timestamp DESC);

-- secure_spans / secure_metrics（加密存储 sensitive 数据，详见 runtime_harness §6）
-- 文件：secure/trace.encrypted.sqlite，由独立 connection 持有
```

约束：

- `attributes_json` 长度上限 64 KiB；超过自动 dropped attribute 并打 warning event
- 写入采用 `WAL` 模式 + 批量提交（每 200ms 或 1000 条）
- `inserted_at` 单调；用于 GC

---

## 7. Metrics（指标）

### 7.1 13 个核心 metric（与技术架构 §12.1 对齐）

| Metric name | Kind | Unit | 维度 | 说明 |
|---|---|---|---|---|
| `cw.node.pass_rate` | gauge | ratio | `cw.node.id, cw.workflow.id` | 节点最终通过率（滑窗 100） |
| `cw.node.pass_rate.first_attempt` | gauge | ratio | 同上 | 一次通过率 |
| `cw.node.avg_attempts` | gauge | count | 同上 | — |
| `cw.repair.success_rate` | gauge | ratio | `cw.patch.kind, cw.node.type` | 修复后通过率 |
| `cw.model.node_pass_rate` | gauge | ratio | `cw.model.profile_id, cw.node.type` | 反馈给 ModelRouter |
| `cw.schema.error_rate` | gauge | ratio | `cw.node.type` | 输出 schema 校验失败率 |
| `cw.evidence.coverage_rate` | histogram | ratio | `cw.node.id` | EvidencePack.coverage_ratio 分布 |
| `cw.human.interrupt_rate` | gauge | ratio | `cw.workflow.id` | human_checkpoint 触发率 |
| `cw.workflow.completion_rate` | gauge | ratio | `cw.workflow.id` | Run 完成率 |
| `cw.attempt.duration` | histogram | ms | `cw.adapter.id, cw.node.type` | attempt 耗时 |
| `cw.context_pack.tokens` | histogram | tokens | `cw.node.type, cw.model.profile_id` | ContextPack 实际 token |
| `cw.usage.tokens` | counter | tokens | `cw.model.profile_id, gen_ai.token.type (input/output)` | token 累计 |
| `cw.usage.cost_usd` | counter | usd | `cw.model.profile_id` | 估算成本 |

### 7.2 metric.snapshot StreamEvent 投影

每 5 分钟 Engine 触发一次 metric snapshot：

- 从 `metrics` 表聚合（取最近 5 分钟数据）
- 投影到 `metric.snapshot` StreamEvent（schema 见 `stream_event.md` §2.10），写入 `runs/<run_id>/metrics.jsonl`
- 同步发 SSE 给前端 UI 渲染指标看板

### 7.3 reflection_injections 计数

`stream_event.md` §5.5 提到的注入计数也走 metric 通道：

- `cw.reflection.injection.count{kind, node_type}` counter

---

## 8. 隐私分级

| Sensitivity | OTel 写入位置 | 字段处理 |
|---|---|---|
| `public` | `traces/trace.sqlite` | 全字段保留 |
| `project` | 同上 | 不进 OTLP（除非 settings 启用项目级远端导出） |
| `sensitive` | `secure/trace.encrypted.sqlite` | AES-GCM-256 加密；不进 OTLP；不进任何跨设备同步 |

判定规则：

- 任意 `cw.attempt.id` 关联的 ContextPack 含 `contains_sensitive=true` → 整 span 标 sensitive
- 任意 `cw.tool.id` 含敏感工具（list 来自 settings）→ 整 span 标 sensitive
- StreamEvent.sensitivity 与 span sensitivity **必须一致**；不一致由 Engine 拦截并降级为更高敏感级（向 sensitive 靠拢）

---

## 9. OTLP（可选远端导出）

settings 启用时：

```json
"settings.observability": {
  "otlp_enabled": false,
  "otlp_endpoint": "https://logfire-api.pydantic.dev/v1/traces",
  "otlp_headers": {"Authorization": "Bearer <secret_ref>"},
  "otlp_export_sensitivity_max": "project"
}
```

约束：

- OTLP 同步导出失败不致命；落 retry queue（最多 100 条），失败超 3 次丢弃 + 写 `error.exception`
- `otlp_export_sensitivity_max` 默认 `public`；`sensitive` 永远不导出
- 远端 endpoint 不在白名单时拒绝（参考 ADR 中"出站允许列表"）

Logfire 推荐配置：与 Pydantic AI Logfire instrumentation 直接复用同一 OTLP 端点（pydantic-ai-slim[logfire]）。

---

## 10. GC

| 数据 | 保留天数（settings.gc） | 默认 |
|---|---|---|
| `traces.spans` | `traces_retention_days` | 30 |
| `traces.metrics` | `metrics_retention_days` | 90 |
| `secure/trace.encrypted.sqlite` | 与 traces 同步；删除时 secure-erase | 30 |

GC 仅由用户主动触发或周期任务；与 D-RH-8 一致。

---

## 11. 错误码

| 错误码 | 含义 |
|---|---|
| `OB_EXPORT_SQLITE_BUSY` | sidecar 写入 SQLite 锁等待超时（自动重试 3 次） |
| `OB_EXPORT_OTLP_FAILED` | OTLP 同步失败 |
| `OB_ATTR_NOT_WHITELISTED` | 试图写入未在 §4 白名单的 `cw.*` attribute（开发期硬失败 / 生产期 dropped + warning） |
| `OB_ATTR_VALUE_TOO_LONG` | attribute 值 > 1024 |
| `OB_ATTR_FORBIDDEN_CONTENT` | attribute 值含 prompt 原文 / 凭证（hard 拒绝） |
| `OB_TRACE_REPLAY_NOT_FOUND` | 用户请求的 trace_id 不在本地 |
| `OB_SECURE_LEAK_BLOCKED` | sensitive span 被错误写入 plain SQLite（实现错误） |
| `OB_METRIC_DIMENSION_CARDINALITY` | 单 metric 维度组合超过 5000，自动聚合粗化 |

---

## 12. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-OB-1 | OTel span / metric 与 StreamEvent 必须**同时**产出；缺其一视为实现错误 |
| D-OB-2 | span name 命名空间 `cw.<domain>.<action>` 三段式；变量值进 attribute，不进 name |
| D-OB-3 | `cw.*` attribute 白名单封闭；新增必须先更新本 spec |
| D-OB-4 | 禁止把 prompt 原文 / 模型输出原文 / quote 原文 / PII / 凭证写入 attribute；OTel 仅承载结构化元信息 |
| D-OB-5 | sensitivity 分级与 StreamEvent 一致；冲突时取更高敏感级 |
| D-OB-6 | sensitive span 写入 `secure/trace.encrypted.sqlite`；永不进 OTLP；永不跨设备 |
| D-OB-7 | trace.sqlite 写入由 sidecar 持锁；Electron 主进程通过 IPC 转发自身 span，避免双进程并发写 |
| D-OB-8 | OTLP 失败不致命；本地 SQLite 是真理；OTLP 是复制 |
| D-OB-9 | metric.snapshot StreamEvent 与 metrics 表是同一份数据的两个视图（聚合 + 推送） |
| D-OB-10 | 单 metric 维度组合超 5000 → 自动聚合粗化（drop 低基数维度） |
| D-OB-11 | OTel TraceID = StreamEvent.correlation_id，全链路一致 |
| D-OB-12 | Adapter 内部模型调用必须同时填 `gen_ai.*`（OTel GenAI 语义）+ `cw.*` 两组 attribute |

---

## 13. 与未来 spec 的桥接

- `specs/api/observability.md`（待）：HTTP `/observability/traces/{trace_id}` / `/observability/metrics` 端点
- `specs/tools/citation_checker.md`（待）：CitationChecker 在 `cw.evaluation.criterion` 内的 events 命名
- CW-Bench（独立 spec 待）：评测产生独立 trace 树，prefix `cw.bench.*`（待 v0.2 时定义）

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-OB-1 ~ D-OB-12；对齐技术架构 v1.0 §12 与所有已锁定 spec 的 OTel 引用 |
