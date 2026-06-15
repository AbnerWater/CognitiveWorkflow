# Spec: AgentAdapter Protocol

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-protocol-001` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §（多 Agent 兼容声明）；技术架构 v1.0 §4（架构分层 / 模型层适配）/ §5（MCCL）/ §7（运行时执行链路）/ §13（安全与权限） |
| 关联 spec | 全部 schema spec（被引用为输入）；`specs/protocols/model_router.md`（待）；`specs/runtime_harness.md`（待） |
| 关联 ADR | ADR-0002（Engine 不直接依赖 pydantic-ai）、ADR-0005（Pydantic AI 作为基座）、ADR-0008（StreamEvent）、ADR-0009（HITL）、ADR-0006（Electron） |

> **范围**：定义 `AgentAdapter` 协议——CW Engine 调用任意"基础 Chat Agent"或"完整 Agent 产品"时的统一接口。是 `PydanticAIAdapter / ClaudeCodeAdapter / CodexAdapter / HermesAdapter / LiteLLMAdapter` 五类首发实现的共同契约源。
>
> **非范围**：
> - 各 Adapter 内部如何与底层 SDK 交互（属于实现细节）
> - 模型路由策略（见 `model_router.md`，待）
> - StreamEvent 转译表（已在 `stream_event.md` §6.1 定型，本文只做引用）
>
> **核心立场**：CW Engine **不直接依赖任何 LLM SDK**（ADR-0002）。所有"模型 / 工具 / Skill / MCP / HITL"动作必须经 AgentAdapter；Adapter 是"翻译层"，把 CW 的 Pack 协议翻译为底层 Agent 的调用，并把底层事件流翻译回 StreamEvent。

---

## 0. 设计原则

1. **Engine 单向依赖 Adapter，不反向依赖**：Engine 仅调用 `AdapterFactory + AgentAdapter` 暴露的方法；Adapter 内部 import 任何 LLM/Agent SDK 仅在 Adapter 模块作用域，不外泄。
2. **能力声明优先于运行时探测**：每个 Adapter 必须提供 `capabilities()` 静态声明；Engine 在选择 Adapter 时按"能力子集 ⊇ 节点所需能力"进行匹配，而不是运行时尝试。
3. **Pack 是输入，StreamEvent 是输出**：`ExecutionPack`（含 ContextPack / EvidencePack / NodeContract / RetryPolicy / ModelPolicy 投影）是 Adapter 唯一输入；`AsyncIterable[StreamEvent]` 与 `AttemptOutcome` 是唯一输出。Adapter 不持有 NodeAttempt / WorkflowRun 全局状态。
4. **可暂停 / 可取消 / 可续跑**：每个 attempt 必须支持 `cancel()`；HITL 路径必须支持 `resume()`（携带 DeferredToolResults / 用户决策）。
5. **可观测**：每个 Adapter 必须把内部事件转译为 CW StreamEvent；自有 metric 通过 OTel 导出，不绕过观测体系。
6. **Stateless within run**：Adapter 实例在 Run 范围内可缓存，但单次 attempt 之内**不允许**保留可变全局状态；并发安全由 Engine 调用方负责。
7. **失败可分类**：所有错误必须以 `AdapterError` 子类抛出，对齐 `failure_taxonomy` 8+1 类；Adapter 不允许把底层异常直接暴露给 Engine。
8. **跨进程 / 跨平台**：Adapter 接口设计必须能在 Python Runtime sidecar 内执行；输入/输出对象必须 JSON-serializable，便于 Electron preload IPC 与持久化。

---

## 1. 协议接口（Python Protocol 草案）

### 1.1 顶层协议

```python
class AgentAdapter(Protocol):
    """CW 与外部 Agent 之间的唯一调用契约。"""

    @property
    def adapter_id(self) -> str: ...
    """全局唯一 ID，如 'pydantic_ai' / 'claude_code' / 'codex' / 'hermes' / 'litellm'。"""

    @property
    def adapter_version(self) -> str: ...
    """SemVer，例 '0.1.0'。"""

    def capabilities(self) -> AdapterCapabilities: ...
    """声明该 Adapter 支持的能力集合（详见 §2）。"""

    async def prepare(
        self,
        execution_pack: ExecutionPack,
    ) -> AttemptHandle: ...
    """把 ExecutionPack 翻译为 Adapter 内部表示，准备好可执行 handle，但不开始流式执行。"""

    async def run(
        self,
        handle: AttemptHandle,
    ) -> AsyncIterator[StreamEvent]: ...
    """开始执行；Adapter 必须以 StreamEvent 形式产出所有事件，包括 attempt.completed / attempt.failed。"""

    async def resume(
        self,
        handle: AttemptHandle,
        resumption: AttemptResumption,
    ) -> AsyncIterator[StreamEvent]: ...
    """在 HITL / DeferredToolResults / 用户决策后续跑同一 handle。"""

    async def cancel(
        self,
        handle: AttemptHandle,
        reason: CancelReason = CancelReason.USER,
    ) -> None: ...
    """取消执行；Adapter 必须保证 cancel 后 run() 的迭代器在有限时间内终止。"""

    async def finalize(
        self,
        handle: AttemptHandle,
    ) -> AttemptOutcome: ...
    """收尾：返回此次 attempt 的结构化结果（含 output / usage / errors / produced artifacts 引用）。"""

    async def aclose(self) -> None: ...
    """释放 Adapter 在 Run 范围内持有的资源（连接池 / 子进程 / MCP 客户端等）。"""
```

### 1.2 工厂

```python
class AdapterFactory(Protocol):
    def create(
        self,
        adapter_id: str,
        config: AdapterConfig,
    ) -> AgentAdapter: ...
    """根据 ID + 配置实例化 Adapter；Engine 在 Run 启动时调用。"""

    def list_available(self) -> list[AdapterDescriptor]: ...
    """列出当前已注册的 Adapter 描述（用于 ModelRouter 选择 + UI 配置面板）。"""
```

> 实现要求：`AdapterFactory` 必须支持插件式注册（`entry_points` / 显式 `register()`），让第三方 Adapter 通过 setuptools 注册即可被 CW 发现。

---

## 2. `AdapterCapabilities`

声明该 Adapter 在静态能力上的支持矩阵。Engine 在选择时按"节点需求子集 ⊆ Adapter 能力子集"判定，匹配失败即拒绝路由到此 Adapter。

| 字段 | 类型 | 说明 |
|---|---|---|
| `kinds` | `set[AdapterKind]` | `chat / coding_agent / autonomous_agent / hosted_workflow / model_only` |
| `structured_output` | `bool` | 是否原生支持 Pydantic / JSONSchema 输出约束 |
| `streaming` | `bool` | 是否原生支持流式（思考流 / 文本流 / 工具调用流） |
| `tool_call` | `bool` | 是否支持函数调用 |
| `mcp` | `bool` | 是否支持 MCP 工具集 |
| `human_in_the_loop` | `bool` | 是否支持运行中暂停等待人工 |
| `deferred_tool_results` | `bool` | 是否支持把工具结果延迟回填（Pydantic AI `DeferredToolResults` 风格） |
| `multi_modal` | `set[str]` | `image / audio / video / document` |
| `long_context_tokens` | `int` | 该 Adapter 在该模型下可用的最大上下文 |
| `max_tool_iterations` | `int` | 单次 attempt 最大工具循环次数 |
| `cancel` | `bool` | 是否支持优雅取消（实现要求 `cancel()` 必须真的能停止上游推理） |
| `evidence_lookup_tool` | `bool` | 是否能在节点中暴露 `evidence_lookup` 工具 |
| `model_settings_passthrough` | `set[str]` | 可透传的 model_settings 字段集合（temperature / top_p / reasoning_effort / 等） |
| `provider_kinds` | `set[ProviderKind]` | `cloud / private / local`；与节点 `forbid_provider_kinds` 校验 |
| `failure_types_supported` | `set[FailureType]` | 该 Adapter 能可靠分类的失败类型；不支持的归 `unknown` |
| `metadata` | `object` | 扩展字段；命名空间化 |

### 2.1 五家首发 Adapter 的能力快照

| 能力 | PydanticAI | LiteLLM | ClaudeCode | Codex | Hermes |
|---|---|---|---|---|---|
| `kinds` | chat | model_only | coding_agent | coding_agent | autonomous_agent |
| `structured_output` | ✅ | ⚠️（需上层 Pydantic 校验） | ⚠️ 文本约束 | ⚠️ 文本约束 | ⚠️ 文本约束 |
| `streaming` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tool_call` | ✅ | ✅ | ✅（含 Bash / Edit / Read 等） | ✅（云端工具） | ✅ |
| `mcp` | ✅ | ❌ | ✅ | ⏳ | ✅ |
| `human_in_the_loop` | ✅（ApprovalRequiredToolset） | ❌ | 部分（permission prompt） | ❌（云端 task） | ✅ |
| `deferred_tool_results` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `multi_modal` | image / document | image / audio | image | image | image / document |
| `long_context_tokens` | 200K（claude）/ 128K（gpt） | 视模型 | 200K | 256K | 视模型 |
| `cancel` | ✅ | ✅ | ⚠️（粗粒度：杀子进程） | ⚠️（cancel task） | ⚠️ |
| `evidence_lookup_tool` | ✅ | ❌ | ✅ | ❌ | ✅ |
| `provider_kinds` | cloud / private / local | cloud / private / local | cloud（Anthropic） | cloud（OpenAI） | cloud / local |
| `failure_types_supported` | 8 类 | 4 类（format / missing_output / model_capability_limit / tool_error） | 5 类 | 5 类 | 5 类 |

> 上表是 Phase 1 / 3 落地用的"能力快照"，会随 Adapter 迭代更新。

---

## 3. 输入：`ExecutionPack`

`ExecutionPack` 是 Engine → Adapter 的**单一输入对象**。它把 NodeContract / ContextPack / EvidencePack / 模型与重试策略 / Workflow 上下文压成一个 JSON-serializable 容器。

### 3.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `pack_id` | `string` | ✅ | ULID |
| `schema_version` | `string` | ✅ | 本 spec 的 ExecutionPack 版本 |
| `run_id` | `string` | ✅ | — |
| `node_id` | `string` | ✅ | — |
| `attempt_id` | `string` | ✅ | 由 Engine 分配 |
| `node_contract_snapshot` | `NodeContract` | ✅ | 本次 attempt 生效的契约（已应用 overlay） |
| `context_pack` | `ContextPack` | ✅ | — |
| `evidence_pack` | `EvidencePack \| null` | ❌ | — |
| `effective_prompt_overlay` | `PromptOverlay \| null` | ❌ | RepairPatch 产生的 prompt 修订（叠加在 NodeContract.prompt 之上） |
| `effective_model_settings` | `ModelSettings` | ✅ | 已合并 ModelPolicy / RepairPatch / 全局策略 的最终设置 |
| `effective_model_profile_id` | `string` | ✅ | ModelRouter 已解析的具体 ProfileID |
| `effective_toolsets` | `ToolsetSpec[]` | ❌ `[]` | 解析后的 Skill / MCP / 内置工具列表 |
| `retry_policy` | `RetryPolicy` | ✅ | 已合并节点 / 全局 |
| `validator_policy` | `ValidatorPolicy` | ✅ | — |
| `output_format_hint` | `OutputFormatHint \| null` | ❌ | 来自 ContextPack 的提示 |
| `usage_limits` | `UsageLimits \| null` | ❌ | token / cost 限流 |
| `cancel_token` | `string` | ✅ | Engine 用于触发 cancel 的 token；Adapter 持有该 token 在内部超时与外部取消之间通用 |
| `correlation_id` | `string` | ✅ | OTel TraceID |
| `metadata` | `object` | ❌ | 命名空间化 |

### 3.2 不变量

- `node_contract_snapshot.contract_kind` 决定 Adapter 在 Pydantic AI 中应该构造哪种 Agent（execution / evaluation / repair / human_gate / tool / memory）
- `effective_prompt_overlay` 已在 Engine 应用到 contract（即 `node_contract_snapshot.prompt` 已包含 overlay 的最终结果）；Adapter 不需要再做 overlay 合并
- `effective_model_profile_id` 必须 ∈ Adapter `capabilities().provider_kinds` 允许的范围
- `cancel_token` 在 Adapter 范围内全局唯一，绑定到该 attempt

---

## 4. 句柄：`AttemptHandle`

`prepare()` 返回的 handle 是 Adapter 内部状态的"引用"。它对 Engine 是不透明的（opaque token），但有公共可读字段供观测。

```python
class AttemptHandle(Protocol):
    @property
    def attempt_id(self) -> str: ...
    @property
    def adapter_id(self) -> str: ...
    @property
    def state(self) -> AttemptState: ...
    @property
    def stream_started(self) -> bool: ...
    @property
    def cancellation_requested(self) -> bool: ...

class AttemptState(StrEnum):
    PREPARED  = "prepared"
    RUNNING   = "running"
    AWAITING_HUMAN = "awaiting_human"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"
```

不变量：

- `prepare()` → `state=PREPARED`
- `run()` 第一帧产出后 → `state=RUNNING`
- 触发 HITL 或 DeferredToolRequests → `state=AWAITING_HUMAN`，迭代器暂停产出但**不结束**
- `resume()` → 回到 `RUNNING`
- 终态 `COMPLETED / FAILED / CANCELLED` 之后 handle 不可复用；需通过 `Engine` 创建新 attempt

---

## 5. 续跑：`AttemptResumption`

```python
class AttemptResumption(Protocol):
    """HITL / DeferredToolResults / 用户编辑后用于续跑的载荷。"""
    kind: ResumptionKind
    deferred_tool_results: list[DeferredToolResult] | None
    human_decision: HumanDecisionResolution | None
    edited_artifacts: list[ArtifactRef] | None
    metadata: dict[str, Any]

class ResumptionKind(StrEnum):
    DEFERRED_TOOL    = "deferred_tool"
    HUMAN_DECISION   = "human_decision"
    USER_EDIT        = "user_edit"
    TIMEOUT_FALLBACK = "timeout_fallback"
```

| 字段 | 必填条件 | 说明 |
|---|---|---|
| `deferred_tool_results` | `kind=deferred_tool` | 与 Pydantic AI `DeferredToolResults` 兼容的载荷 |
| `human_decision` | `kind=human_decision` | `{ key, custom_value?, by, decided_at }` |
| `edited_artifacts` | `kind=user_edit` | 用户在 Drawer 中编辑后的产物引用 |

Adapter 不支持的 `ResumptionKind` 必须在 `capabilities()` 中标注；Engine 调用前会先校验。

---

## 6. 输出：`AttemptOutcome`

`finalize()` 返回的最终结果，与 NodeAttempt 一对一对应。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `attempt_id` | `string` | ✅ | — |
| `run_id` | `string` | ✅ | — |
| `node_id` | `string` | ✅ | — |
| `state` | `AttemptState` | ✅ | 终态 `COMPLETED / FAILED / CANCELLED` |
| `output` | `object \| null` | 当 `state=COMPLETED` 时 | 已通过 Pydantic 校验的产物对象（符合 NodeContract.output_schema） |
| `output_hash` | `string` | ✅ | 稳定 hash，用于 attempt 复盘 |
| `output_artifact_refs` | `ArtifactRef[]` | ❌ `[]` | 副产物（生成的文件 / 图等） |
| `usage` | `RunUsage \| null` | ❌ | token + cost 累计 |
| `messages` | `ModelMessage[] \| null` | ❌ | 完整对话记录（Pydantic AI 风格）；可选项 |
| `errors` | `AdapterError[]` | ❌ `[]` | 失败时的结构化错误 |
| `started_at` | `string` (ISO-8601) | ✅ | — |
| `finished_at` | `string` (ISO-8601) | ✅ | — |
| `duration_ms` | `int` | ✅ | — |
| `provenance` | `AttemptProvenance` | ✅ | — |

### 6.1 `AttemptProvenance`

| 字段 | 类型 | 说明 |
|---|---|---|
| `adapter_id` | `string` | — |
| `adapter_version` | `string` | — |
| `model_profile_id` | `string` | — |
| `model_settings_hash` | `string` | 实际使用的设置 hash |
| `tools_used` | `string[]` | 调用过的 tool / skill / mcp ID |
| `evidence_pack_id` | `string \| null` | — |
| `context_pack_id` | `string` | — |
| `pydantic_ai_traceparent` | `string \| null` | 当 Adapter=PydanticAI 时回填 |
| `outcome_hash` | `string` | AttemptOutcome 整体（去时间戳）的稳定 hash |

---

## 7. 错误模型 `AdapterError`

```python
class AdapterError(Exception):
    error_kind: AdapterErrorKind
    failure_type: FailureType   # 8+1 类，与 evaluation 对齐
    message: str
    retryable: bool
    http_status: int | None
    underlying: object | None   # 原始异常（仅供日志，不上送）
    payload: dict[str, Any] | None

class AdapterErrorKind(StrEnum):
    PREPARE_FAILED         = "prepare_failed"
    INVALID_PACK           = "invalid_pack"
    MODEL_REQUEST_FAILED   = "model_request_failed"
    TOOL_FAILED            = "tool_failed"
    MCP_TRANSPORT          = "mcp_transport"
    APPROVAL_REQUIRED      = "approval_required"      # 控制流而非错误，但用同一通道传递
    DEFERRED_TOOL          = "deferred_tool"          # 同上
    OUTPUT_VALIDATION      = "output_validation"
    RETRY_LIMIT_REACHED    = "retry_limit_reached"
    USAGE_LIMIT_EXCEEDED   = "usage_limit_exceeded"
    PROVIDER_FORBIDDEN     = "provider_forbidden"
    CANCELLED              = "cancelled"
    TIMEOUT                = "timeout"
    ADAPTER_INTERNAL       = "adapter_internal"
```

**约束**：

- Adapter 不允许把底层 SDK 的异常（`anthropic.APIError` / `openai.APIError` / `httpx.HTTPError` 等）直接抛给 Engine；必须转译为 `AdapterError`
- `failure_type` 必须 ∈ §FailureType 枚举（含 `unknown`）
- `APPROVAL_REQUIRED / DEFERRED_TOOL` 不是错误，是控制流；Adapter 通过 raise 的方式传递给 Engine（与 pydantic-ai `ApprovalRequired` 异常风格一致）

---

## 8. 与 Pydantic AI 的具体落地

### 8.1 `prepare()` 实现要点

PydanticAIAdapter 的 `prepare()` 执行：

1. 解析 `ExecutionPack.node_contract_snapshot.prompt` → `Agent(system_prompt=..., instructions=...)`
2. 解析 `node_contract_snapshot.output_schema` → 构造 Pydantic 模型类（缓存 by `contract_id` + schema_hash）→ `Agent(output_type=Model)`
3. 解析 `effective_toolsets` → 组合 `[FunctionToolset, MCPServer, FastMCPToolset, ApprovalRequiredToolset(...)]` → `Agent(toolsets=...)`
4. 把 `evidence_pack` 注入 `RunContext.deps.evidence` + 自动添加 `evidence_lookup` 工具（当节点 `evidence_requirements` 非空且 `capabilities.evidence_lookup_tool=true`）
5. 解析 `retry_policy` → `Agent(retries=AgentRetries(model=..., output=..., tool=...))`
6. 解析 `effective_model_profile_id` → 通过 ModelRouter 提供的 `Model | KnownModelName` → `Agent(model=...)`
7. 把 `cancel_token` 绑定到 internal `asyncio.CancelScope`
8. 返回 handle

### 8.2 `run()` 实现要点

```python
async def run(self, handle):
    async with self._agent_for(handle).iter(
        user_prompt=self._render_user_prompt(handle),
        deps=self._build_deps(handle),
    ) as agent_run:
        async for ev in self._stream_events(agent_run, handle):
            yield self._transcode_to_stream_event(ev)
        # finalize 在 finalize() 中再处理；run() 仅产出事件
```

`_transcode_to_stream_event` 严格遵守 `stream_event.md` §6.1 的转译表（无新增类型，无丢弃事件）。

### 8.3 `resume()` 实现要点

```python
async def resume(self, handle, resumption):
    if resumption.kind == ResumptionKind.DEFERRED_TOOL:
        agent_run = await self._agent_for(handle).run(
            deferred_tool_results=resumption.deferred_tool_results,
        )
        async for ev in agent_run.stream_events(...):
            yield self._transcode_to_stream_event(ev)
    elif resumption.kind == ResumptionKind.HUMAN_DECISION:
        # 把决策注入 ApprovalRequiredToolset 的 approval cache，再 resume
        ...
```

### 8.4 `cancel()` 实现要点

- Pydantic AI `Agent.iter()` 内部支持 `CancelScope`；调用 `cancel_token` 后必须保证：
  - 正在产生的 delta 不再继续
  - 当前 tool call 若已发出 → 等待结果但不消费
  - `run()` 的 async iterator 在 `<= 5s` 内退出
- 触发 `attempt.cancelled` StreamEvent + `AttemptOutcome.state=CANCELLED`

### 8.5 `finalize()` 实现要点

- 从 `agent_run.result.output` 取已通过 Pydantic 校验的输出
- 通过 `agent_run.result.usage` / `agent_run.result.all_messages()` 回填 `AttemptOutcome.usage / messages`
- 用 `AttemptOutcome.output_hash = blake3(canonical_json(output))` 计算

---

## 9. 与 ClaudeCode / Codex / Hermes / LiteLLM 的差异

各 Adapter 必须在满足 §1 协议的前提下，处理各自底层差异。下表标注 Phase 1 末（ClaudeCodeAdapter） / Phase 3（其它）的差异点：

### 9.1 ClaudeCodeAdapter

- `kinds={coding_agent}`；`structured_output=⚠️`（Adapter 必须在 `finalize()` 中用 Pydantic 校验，不能直接信任 ClaudeCode 的输出）
- `prepare()` 翻译策略：
  - 把 NodeContract.prompt 拼成 Claude Code session 启动消息
  - 把 EvidencePack 写入临时目录作为参考资料文件，Claude Code 通过 `Read` 工具自取
  - `effective_toolsets` 不直接映射 Pydantic AI Toolset；而是限制 ClaudeCode `permissions` 表（`allowed_tools`）
- HITL：Claude Code permission prompt → `human.gate_required` 转译
- `cancel()`：通过 SDK 的 abort 接口；不保证立刻停止子进程

### 9.2 CodexAdapter

- `kinds={coding_agent}`；`hosted_workflow` 风格（云端 task queue）
- `prepare()` 创建 task；`run()` 长轮询 + SSE bridge
- `cancel()` → 调用 OpenAI Codex `cancel_task`
- `human_in_the_loop=False`（Phase 3 起若 Codex 提供则补）

### 9.3 HermesAdapter

- `kinds={autonomous_agent}`
- 必须**屏蔽** Hermes 自身的 Memory / Skills / Cron / Gateway 体系（与 [[project_overview]] 立场一致）；Adapter 只用 Hermes 的"loop + tool_call"内核
- 在 `prepare()` 中显式 `quiet_mode=True` 抑制 CLI 输出（Hermes Python lib 推荐做法）
- 适用场景：长期常驻 / 跨 Gateway 任务节点；不作为默认基座

### 9.4 LiteLLMAdapter

- `kinds={model_only}`；不持工具不持 toolset
- 仅适合"单次裸调用"节点（如简单文本生成 / 摘要）
- 与 PydanticAI 的差别：不强制 Pydantic 输出校验（CW 上层补一遍）

---

## 10. 与 ModelRouter 的协作（前向引用）

完整 ModelRouter spec 见 `specs/protocols/model_router.md`（待）。本节仅声明 AgentAdapter 与 ModelRouter 的契约：

- ModelRouter 在节点 attempt 启动前，根据 `NodeContract.model_policy` + `WorkflowModelPolicy` + `Adapter.capabilities()` 解析出：
  - `effective_model_profile_id`
  - 适合的 `adapter_id`（多个 Adapter 都满足时按 `model_router.priority` 决定）
- ModelRouter 必须保证 Adapter 选择**确定性**：相同输入产生相同 `(adapter_id, model_profile_id)`

---

## 11. 安全与权限

- 标记 `forbid_remote_for_sensitive=true` 的节点：Adapter 在 `prepare()` 校验 `capabilities().provider_kinds ⊇ {local}`；不满足直接抛 `AdapterError(PROVIDER_FORBIDDEN)`
- EvidencePack 内 `sensitive=true` 的 evidence：Adapter 必须在 ContextPack 注入前再次校验（双层防御，与 `evidence_pack.md` D-EP-3 配合）
- MCP Server：所有调用必须经 ApprovalRequiredToolset 包装（除非节点显式声明 `requires_approval=false`）；这一行为属于 Adapter 内部职责，不依赖 Engine
- Adapter 不允许把 ContextPack / EvidencePack 写入用户工程根目录之外的位置（含临时目录例外仅限 `runs/<run_id>/cache/`）

---

## 12. Adapter 注册与发现

```python
# 注册（pyproject.toml）
[project.entry-points."cw.adapters"]
pydantic_ai = "cw_runtime.adapters.pydantic_ai_adapter:PydanticAIAdapter"
claude_code = "cw_runtime.adapters.claude_code_adapter:ClaudeCodeAdapter"
litellm     = "cw_runtime.adapters.litellm_adapter:LiteLLMAdapter"
codex       = "cw_runtime.adapters.codex_adapter:CodexAdapter"   # Phase 3
hermes      = "cw_runtime.adapters.hermes_adapter:HermesAdapter" # Phase 3
```

Adapter 描述符（用于 UI 配置面板）：

| 字段 | 说明 |
|---|---|
| `adapter_id` | — |
| `display_name` | UI 展示名称 |
| `description` | 简短介绍 |
| `documentation_url` | — |
| `capabilities` | 完整 AdapterCapabilities |
| `default_config` | UI 默认配置 |
| `auth_required` | bool；触发 UI 凭证流程 |
| `homepage` | — |

---

## 13. 错误码

| 错误码 | 含义 |
|---|---|
| `AA_PREPARE_INVALID_PACK` | ExecutionPack schema 校验失败 |
| `AA_PREPARE_INCOMPATIBLE_ADAPTER` | 节点需求不在 Adapter capabilities 子集 |
| `AA_PREPARE_PROVIDER_FORBIDDEN` | sensitive 节点选用了云端 Provider |
| `AA_RUN_STREAM_INTERRUPTED` | 上游网络 / SDK 流中断 |
| `AA_RUN_TOOL_NOT_FOUND` | 工具/Skill/MCP 在 Adapter 注册中缺失 |
| `AA_RUN_OUTPUT_VALIDATION_FAILED` | 输出不符合 NodeContract.output_schema |
| `AA_RUN_RETRY_LIMIT` | 超过 retry_policy.max_attempts |
| `AA_RUN_USAGE_LIMIT` | 触发 usage_limits |
| `AA_RUN_CANCELLED` | cancel 调用导致退出 |
| `AA_RUN_INTERNAL` | Adapter 内部异常未分类（不允许向 Engine 暴露） |
| `AA_RESUME_INVALID_KIND` | ResumptionKind 不被 Adapter 支持 |
| `AA_FINALIZE_NO_RESULT` | run() 已结束但 result 不可用 |

---

## 14. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-AA-1 | Engine 不直接 import 任何 LLM / Agent SDK；所有调用经 AgentAdapter（与 ADR-0002 一致） |
| D-AA-2 | Adapter 接口五件套固定为 `prepare / run / resume / cancel / finalize`；不允许新增"中间态触发"接口 |
| D-AA-3 | `ExecutionPack` 是 Engine → Adapter 的唯一输入；不允许通过其它 side channel 注入参数 |
| D-AA-4 | Adapter 必须以 `AdapterError(failure_type=...)` 抛错，禁止暴露底层 SDK 异常 |
| D-AA-5 | `APPROVAL_REQUIRED` / `DEFERRED_TOOL` 走 raise 通道传达控制流，与 Pydantic AI `ApprovalRequired` 风格一致 |
| D-AA-6 | `cancel()` 必须在 ≤5s 内让 `run()` async iterator 退出；不满足的 Adapter 在 `capabilities.cancel=False` 中明确声明 |
| D-AA-7 | Adapter 注册采用 setuptools entry_points `cw.adapters`；运行时插件式发现 |
| D-AA-8 | `capabilities()` 是静态声明；Engine 在 prepare 之前就完成兼容性匹配，不允许运行时探测 |
| D-AA-9 | StreamEvent 转译表以 `stream_event.md` §6.1 为准；Adapter 不得新增类型外的事件 |
| D-AA-10 | Hermes 等"完整 Agent 产品"作为 Adapter 接入时，必须**屏蔽**其自身 Memory / Skills / Cron / Gateway 体系，仅复用其 loop + tool_call 内核 |

---

## 15. 与未来 spec 的桥接

- `model_router.md`（待）：定义 `(NodeContract, ModelPolicy) → (AdapterID, ModelProfileID)` 的解析规则
- `runtime_harness.md`（待）：Adapter 的 `cache/` 目录职责约束
- `state_machines/planning_session.md`（待）：Planning 阶段的多个子 Agent（Explorer / Understanding / Planner / Patcher）也通过 AgentAdapter 协议执行
- `protocols/observability.md`（待）：Adapter OTel 命名规范

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-AA-1 ~ D-AA-10；接口五件套定型；五家首发 Adapter 能力快照入档 |
