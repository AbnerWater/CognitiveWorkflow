# Spec: ModelRouter Protocol

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-protocol-002` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 技术架构 v1.0 §5.2（MCCL 组件 Model Router）/ §8（不同能力模型的交付水准对齐策略，含 ModelProfile / NodeCapabilityRequirement / 协作模式表）/ §12.2（ModelPerformanceRecord）/ §13（安全与权限） |
| 关联 spec | `specs/schemas/node_contract.md`（输入：`NodeModelPolicy`）、`specs/schemas/workflow_graph.md`（输入：`WorkflowModelPolicy`）、`specs/protocols/agent_adapter.md`（输出消费方：决定 `adapter_id`/`effective_model_profile_id`）、`specs/schemas/repair_patch.md`（`model_escalation` 触发路由）、`specs/runtime_harness.md`（ModelProfile 注册位置 §15） |
| 关联 ADR | ADR-0002、ADR-0005、ADR-0006、ADR-0007 |

> **范围**：定义 `ModelRouter` 协议——把"节点的模型需求 + Workflow 全局策略 + 已注册的 ModelProfile + 已启用 AgentAdapter 的能力声明"合成为一次执行所需的"具体决策"：选哪个 Adapter、用哪个 ModelProfile、传哪些 model_settings、如何在失败时升级。
>
> **非范围**：
> - ModelProfile 各项能力分数的实测方法（属于 CW-Bench 评测，独立 spec 待）
> - LiteLLM 内部如何把"profile → 实际 Provider URL"翻译（属于实现细节）
> - 每家 Adapter 的内部调用细节（已在 `agent_adapter.md` §8 / §9 定型）
>
> **核心立场**：路由必须**确定性 + 可解释 + 可观测**。给定相同输入与相同 ModelProfile 注册表，必须产生相同的 `RoutingDecision`；任何决策都必须能反查"为什么是这家 Adapter / 这个 Profile"，而不是"上一次它表现好"那种黑盒判断（Phase 1）。Phase 3 起允许引入历史 pass_rate 调整 priority，但不破坏确定性——通过引入 `route_seed` 锁定。

---

## 0. 设计原则

1. **静态优先于运行时**：Phase 1 的 ModelRouter 只读静态注册表与节点契约；不调用任何远端推理探活。每次路由是一次纯函数。
2. **能力子集匹配**：节点的 `NodeCapabilityRequirement`（推导自 NodeContract）必须 ⊆ 候选 Adapter 的 `AdapterCapabilities`（`agent_adapter.md` §2）且 ⊆ 候选 ModelProfile 的 `capabilities`；任一不满足，候选剔除。
3. **隐私边界硬约束**：含 `forbid_remote_for_sensitive=true` 的节点 / 含 `sensitive=true` Evidence 的 ContextPack，路由必须只在 `provider_kind ∈ {local, private}` 候选中选。违反直接拒绝（不容错降级）。
4. **路由结果不可变**：`RoutingDecision` 一旦被 attempt 使用，attempt 内不允许改变；改变模型 = `model_escalation` Patch + 新一次 attempt。
5. **升级链确定**：当节点失败触发 model_escalation 时，路由结果按"链表"前进——`primary → escalation_chain[0] → ...`；不允许跳级或回退到更弱 profile。
6. **多 Adapter 同 Profile 时的 tie-break 必须可解释**：候选并列时按"显式 priority → adapter_default → 字典序"决定，不引入随机数。Phase 3 允许 `route_seed` 决定基于历史性能的微调，仍然是确定性。
7. **决策可审计**：每次路由必须落 `RoutingTrace` 到 `runs/<run_id>/`，包含候选集合、剔除原因、最终选择、关联 NodeContract / Patch 引用。
8. **跨进程**：ModelRouter 在 Python Runtime sidecar 内运行；输入输出 JSON-serializable，便于 Electron renderer 在配置面板上展示与解释。

---

## 1. 核心对象 `ModelProfile`

### 1.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model_profile_id` | `string` | ✅ | 全局唯一；建议格式 `<provider>-<family>-<role>`（如 `claude-sonnet-default` / `qwen2-32b-judge` / `local-llama3-research`） |
| `display_name` | `string` | ✅ | UI 展示名 |
| `provider_kind` | `enum: cloud / private / local` | ✅ | 与 `forbid_remote_for_sensitive` / `forbid_provider_kinds` 校验对接 |
| `provider_id` | `string` | ✅ | 与 LiteLLM / Pydantic AI Provider 命名对齐（如 `anthropic` / `openai` / `azure` / `bedrock` / `ollama` / `litellm:custom-1`） |
| `model_id` | `string` | ✅ | Provider 视角的模型字符串（如 `claude-sonnet-4` / `gpt-5.2` / `qwen2.5-32b-instruct` / `llama-3.1-70b`） |
| `capabilities` | `ModelCapabilities` | ✅ | 见 §1.2 |
| `default_model_settings` | `ModelSettings` | ✅ | 默认 temperature / top_p / max_tokens / reasoning_effort / 等（与 Pydantic AI `ModelSettings` 对齐） |
| `cost_profile` | `ModelCostProfile` | ✅ | 见 §1.3 |
| `performance_profile` | `ModelPerformanceProfile` | ✅ | 见 §1.4（Phase 1 可手填，Phase 3 由 CW-Bench 自动更新） |
| `auth_ref` | `string \| null` | ❌ | 指向 `secure/secrets.encrypted.sqlite` 的凭证条目（明文凭证不入此对象） |
| `tags` | `string[]` | ❌ | 自由标签（如 `chinese_friendly` / `code_strong` / `cheap_judge`） |
| `disabled` | `bool` | ❌ `false` | 临时禁用 |
| `metadata` | `object` | ❌ | 命名空间化扩展字段 |

### 1.2 `ModelCapabilities`

| 字段 | 类型 | 说明 |
|---|---|---|
| `max_context_tokens` | `int` | 模型上下文长度上限 |
| `max_output_tokens` | `int` | 单次输出上限 |
| `structured_output_native` | `bool` | 是否原生支持 JSON / Pydantic 输出（OpenAI structured outputs / Anthropic tool 等） |
| `tool_call` | `bool` | 是否支持 function calling |
| `streaming` | `bool` | 是否支持流式 |
| `multi_modal` | `set[str]` | `image / audio / video / document` |
| `reasoning_supported` | `bool` | 是否支持 reasoning_effort 参数 |
| `vision_supported` | `bool` | 是否能读图 |
| `failure_types_supported` | `set[FailureType]` | 该模型常见且能可靠分类的失败类型 |
| `reliability_score` | `number (0..1)` | 失败率反指标的简化版（手填） |
| `recommended_node_kinds` | `set[NodeContractKind]` | 推荐用于哪些 contract_kind（execution / evaluation / repair / human_gate / tool / memory） |

### 1.3 `ModelCostProfile`

| 字段 | 类型 | 说明 |
|---|---|---|
| `input_per_million_usd` | `number \| null` | 每百万输入 token 的 USD（云端）；本地为 0 或 null |
| `output_per_million_usd` | `number \| null` | 同上输出 |
| `latency_p50_ms` | `int` | 估算 p50 延迟 |
| `latency_p95_ms` | `int` | 估算 p95 延迟 |
| `tier` | `enum: cheap / standard / premium / local_free` | 用于路由策略的简化分组 |

### 1.4 `ModelPerformanceProfile`

> 与技术架构 §12.2 `ModelPerformanceRecord` 对齐。Phase 1 仅占位手填或留空；Phase 3 由 ReflectionMemory + CW-Bench 自动更新。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `node_kind_pass_rates` | `Record<NodeContractKind, number>` | `{}` | 历史节点通过率（0..1） |
| `node_kind_avg_attempts` | `Record<NodeContractKind, number>` | `{}` | 历史平均尝试次数 |
| `domain_scores` | `Record<string, number>` | `{}` | 领域评分（research / coding / simulation / compliance）|
| `common_failure_types` | `string[]` | `[]` | — |
| `best_prompt_patterns` | `string[]` | `[]` | — |
| `poor_fit_signals` | `string[]` | `[]` | — |
| `last_evaluated_at` | `string` (ISO-8601) \| `null` | `null` | — |

---

## 2. 注册位置（与 `runtime_harness.md` 对齐）

### 2.1 全局（跨项目）注册表

文件：`~/.cw/model_profiles.json`

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | `string` | — |
| `profiles` | `ModelProfile[]` | 全局 ModelProfile 注册 |
| `default_profile_id` | `string` | 用户级默认 |
| `last_modified_at` | `string` | — |

### 2.2 项目级覆盖

`<project>/.agent-workflow/settings.json` 的 `models` 段允许覆盖：

| 字段 | 类型 | 说明 |
|---|---|---|
| `default_model_profile_id` | `string \| null` | 覆盖全局默认 |
| `escalation_chain` | `string[]` | 项目级升级链；空时使用全局或节点声明 |
| `forbid_remote_for_sensitive` | `bool` | 与 `WorkflowModelPolicy` 同字段 |
| `forbid_provider_kinds` | `enum[]: cloud/private/local` | 项目级禁用 Provider 类别 |
| `profile_overrides` | `Record<model_profile_id, Partial<ModelProfile>>` | 仅允许覆盖 `default_model_settings` / `disabled` / `auth_ref` / `tags` 子集；不允许在项目级改 `model_id` / `provider_id`（避免 ID 漂移） |
| `add_profiles` | `ModelProfile[]` | 项目内追加的 Profile（如本地实验模型） |

### 2.3 合并规则

按以下优先级生成"项目内可见 ModelProfile 集合"：

1. 全局 `~/.cw/model_profiles.json.profiles`
2. 项目 `add_profiles`（追加；与全局同 ID 时项目内出错）
3. 应用 `profile_overrides`（限定字段子集）
4. 移除 `disabled=true` 的项

合并后形成 `ResolvedProfileRegistry`，作为 ModelRouter 的查询源。

---

## 3. 路由请求与决策

### 3.1 `RoutingRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `request_id` | `string` (ULID) | ✅ | — |
| `run_id` | `string` | ✅ | — |
| `node_id` | `string` | ✅ | — |
| `attempt_index` | `int` (≥0) | ✅ | 当前 attempt 序号；用于升级链推进 |
| `previous_decision` | `RoutingDecision \| null` | ❌ | 上次 attempt 使用的决策（用于 escalation 推进） |
| `node_contract_snapshot` | `NodeContract` | ✅ | — |
| `workflow_model_policy` | `WorkflowModelPolicy` | ✅ | — |
| `project_settings_models` | `ProjectModelSettings` | ✅ | `settings.json.models` 段 |
| `requirement` | `NodeCapabilityRequirement` | ✅ | 见 §3.2 |
| `escalation_trigger` | `RoutingEscalationTrigger \| null` | ❌ | 见 §3.4 |
| `route_seed` | `string \| null` | ❌ | Phase 3 起的确定性"算法版本"；Phase 1 留 null |
| `correlation_id` | `string` | ✅ | OTel TraceID |
| `metadata` | `object` | ❌ | — |

### 3.2 `NodeCapabilityRequirement`

由 ModelRouter 从 NodeContract 推导（**不**让上层手填，避免漂移）：

| 字段 | 类型 | 推导规则 |
|---|---|---|
| `contract_kind` | `enum` | 取自 `NodeContract.contract_kind` |
| `reasoning_required` | `enum: low / medium / high` | execution+factuality_required → medium；evaluation+arbitration=multi_judge → high；其他 → low |
| `context_required_tokens` | `int` | 取自当前 ContextPack `tokens_estimate` 上限（路由前由 ContextBuilder 提前估算） |
| `structure_strictness` | `enum: low / medium / high` | NodeContract.validator_policy.mode = strict → high；lenient → medium；programmatic_only → low |
| `factuality_required` | `bool` | NodeContract.evidence_requirements 非空 |
| `tool_complexity` | `enum: none / simple / complex` | allowed_tools+skills+mcp_tools 复合判断 |
| `risk_level` | `enum: low / medium / high` | requires_human_approval=true → high；forbid_remote_for_sensitive=true → high；其他参考 NodeContract.metadata.cw.risk_level |
| `candidate_count` | `int` (≥1) | NodeContract.model_policy.candidate_count |
| `review_required` | `bool` | contract_kind=evaluation |
| `human_required` | `bool` | contract_kind=human_gate 或 requires_human_approval |
| `forbid_provider_kinds` | `set[ProviderKind]` | 节点 ∪ 项目 ∪ Workflow 三层并集 |
| `multi_modal_required` | `set[str]` | 推导自 ContextPack 内附件的 multi_modal 类型 |

### 3.3 `RoutingDecision`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `decision_id` | `string` (ULID) | ✅ | — |
| `request_id` | `string` | ✅ | — |
| `run_id / node_id / attempt_index` | — | ✅ | — |
| `adapter_id` | `string` | ✅ | 选定的 AgentAdapter |
| `model_profile_id` | `string` | ✅ | 选定的 ModelProfile |
| `effective_model_settings` | `ModelSettings` | ✅ | 已合并 default + node_policy + workflow_policy + escalation 后的最终设置 |
| `reasoning_chain` | `RoutingReasoningStep[]` | ✅ | 见 §3.5 |
| `candidates_considered` | `RoutingCandidate[]` | ✅ | 候选集合及剔除原因 |
| `escalation_position` | `int` (≥0) | ✅ | 当前在升级链中的位置（0 = primary） |
| `escalation_chain` | `string[]` | ✅ | 解析后的完整链；包含 `model_profile_id` 顺序 |
| `forbidden_provider_kinds` | `set[ProviderKind]` | ✅ | 决策时生效的禁用集合 |
| `seed_used` | `string \| null` | ❌ | route_seed 副本（Phase 3） |
| `decided_at` | `string` (ISO-8601) | ✅ | — |
| `metadata` | `object` | ❌ | — |

### 3.4 `RoutingEscalationTrigger`

只在 model_escalation 路径上传入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | `enum: model_capability_limit / logic_gap / explicit_patch` | ✅ | 触发原因 |
| `from_model_profile_id` | `string` | ✅ | 上次使用的 |
| `repair_patch_id` | `string \| null` | ❌ | 若由 RepairPatch 触发 |
| `evaluation_id` | `string \| null` | ❌ | — |

### 3.5 `RoutingReasoningStep`

| 字段 | 类型 | 说明 |
|---|---|---|
| `step` | `enum: collect_candidates / apply_provider_kind_filter / apply_capability_filter / apply_node_policy / apply_workflow_policy / apply_escalation / tie_break / select` | 见 §4 流程 |
| `before_count` | `int` | 该步骤前候选数 |
| `after_count` | `int` | 该步骤后候选数 |
| `removed` | `RemovedCandidate[]` | 本步骤剔除项（含原因） |
| `notes` | `string \| null` | — |

### 3.6 `RoutingCandidate` / `RemovedCandidate`

```yaml
RoutingCandidate:
  model_profile_id: string
  adapter_id: string
  capability_score: number          # 与节点需求的拟合度（0..1）
  cost_score: number                # 越低越优
  performance_score: number | null  # Phase 3 起填充
  selected: bool
  rank: int

RemovedCandidate:
  model_profile_id: string
  adapter_id: string
  reason: string                    # 错误码或人类可读
```

---

## 4. 解析流程（确定性）

下面是 Phase 1 严格确定性流程。每一步在 `RoutingDecision.reasoning_chain` 留下一条 step。

```
1. collect_candidates
   - 输入：ResolvedProfileRegistry × 已启用 AgentAdapter
   - 候选 = { (profile, adapter) | adapter.capabilities.kinds 与 profile.recommended_node_kinds 兼容 且
              profile.disabled=false 且 adapter 已启用 }
   - 移除 NodeContract.model_policy.primary_model_profile_id 显式声明的 "auto" 之外的非匹配项

2. apply_provider_kind_filter
   - 移除 profile.provider_kind ∈ requirement.forbid_provider_kinds
   - 移除 requirement.risk_level=high 且 forbid_remote_for_sensitive=true 时 profile.provider_kind=cloud 的候选

3. apply_capability_filter
   - 检查每对 (profile, adapter)：
     a. profile.capabilities.max_context_tokens >= requirement.context_required_tokens
     b. requirement.structure_strictness=high → adapter.structured_output=true 且 profile.structured_output_native=true
     c. requirement.tool_complexity ∈ {simple, complex} → adapter.tool_call=true 且 profile.tool_call=true
     d. requirement.tool_complexity=complex → adapter.mcp 或 adapter.evidence_lookup_tool=true
     e. requirement.multi_modal_required ⊆ adapter.multi_modal ∩ profile.multi_modal
     f. requirement.reasoning_required=high → profile.reasoning_supported=true
     g. requirement.candidate_count > 1 → 任一即可（CandidateGenerator 可多次调用）
     h. requirement.human_required=true → adapter.human_in_the_loop=true
   - 任一不满足 → 剔除

4. apply_node_policy
   - 若 NodeContract.model_policy.primary_model_profile_id != "auto"：
     · 检查该 profile 是否仍在候选 → 是则只保留它（与其它对应的 Adapter）
     · 否则进入 ROUTE_PRIMARY_PROFILE_NOT_AVAILABLE 流程，保留与原 profile 同 family 的备选（按 tags 与 family heuristic）
   - 应用 NodeContract.model_policy.forbid_provider_kinds（再次过滤）

5. apply_workflow_policy
   - 应用 WorkflowModelPolicy.default_model_profile_id 作为 tie-break 的优先项
   - 应用 WorkflowModelPolicy.escalation_chain 作为升级链来源（节点级 escalation_chain 优先）

6. apply_escalation（仅当 escalation_trigger 非空）
   - 推进 escalation_position += 1
   - 取 chain[escalation_position]；若超过链长度 → ROUTE_ESCALATION_EXHAUSTED（由 Engine 转 human_checkpoint）
   - 强制选用该 profile（仍走步骤 2/3 校验）

7. tie_break
   - 计分：score = 0.6 * capability_score - 0.3 * cost_score (cheaper better) + 0.1 * performance_score(or 0.5 if null)
   - 排序：score DESC → adapter_priority ASC → adapter_id 字典序 → model_profile_id 字典序
   - Phase 3 起：若 route_seed 非空，对 score 加入 ±2% 抖动作为 A/B；仍按 seed 确定性

8. select
   - 取 rank=1 的候选 → 写 RoutingDecision
   - 计算 effective_model_settings = profile.default_model_settings ∪ workflow_policy.default_settings ∪
                                       node_policy.model_settings ∪ escalation_overrides
     合并以最右侧为最高优先
```

### 4.1 失败路径

| 失败情况 | 错误码 | 处理 |
|---|---|---|
| 步骤 1 候选为 0 | `MR_NO_CANDIDATES` | 立即返回错误；Engine 转 human_checkpoint |
| 步骤 2 后候选为 0 | `MR_PROVIDER_KIND_FORBIDDEN_ALL` | 同上 |
| 步骤 3 后候选为 0 | `MR_CAPABILITY_NOT_MET` | 同上 |
| 步骤 4 显式 profile 不可用 | `MR_PRIMARY_PROFILE_NOT_AVAILABLE` | 若有 family heuristic 备选则告警继续；否则失败 |
| 步骤 6 升级链耗尽 | `MR_ESCALATION_EXHAUSTED` | 转 human_checkpoint |
| 步骤 8 设置合并冲突 | `MR_SETTINGS_MERGE_CONFLICT` | 实现错误 |
| 任一步骤检测到 sensitive 数据违反 | `MR_SENSITIVE_DATA_REMOTE_FORBIDDEN` | 失败；不容错降级 |

---

## 5. 升级链（Escalation Chain）

### 5.1 来源优先级

按以下顺序合成节点的最终升级链：

1. `NodeContract.model_policy.escalation_chain`（节点级）
2. `WorkflowModelPolicy.escalation_chain`（Workflow 级）
3. `settings.json.models.escalation_chain`（项目级）
4. 全局默认（`~/.cw/model_profiles.json.default_escalation`，可选）

链合并规则：**节点级优先**——若节点级非空，直接使用节点级链；否则向下取 Workflow / 项目 / 全局（取首个非空）。

### 5.2 不变量

- 链中每个 `model_profile_id` 必须真实存在于 `ResolvedProfileRegistry`
- 链不允许出现重复 ID
- 链长度上限 5（防止无限升级）；超过 → `MR_ESCALATION_CHAIN_TOO_LONG`
- 链相邻两步的 `provider_kind` 不允许从 local 跳到 cloud（避免敏感数据泄露）；除非节点显式标 `escalation_allow_cross_provider_kind=true`

### 5.3 与 RepairPatch.model_escalation 的协作

`repair_patch.md` §2.4 的 `switch_to_model_profile` 操作：

- 必须 ∈ 节点解析后的 escalation_chain（D-RP-5）；越权直接拒绝
- ModelRouter 收到该 patch 时按 §4.6 推进 escalation_position；若 patch 指定的 profile 不是链中的下一个，路由失败 `MR_ESCALATION_NON_LINEAR`

---

## 6. effective_model_settings 合并

按以下优先级（数字越小优先级越低，最后被覆盖）：

```
1. ModelProfile.default_model_settings
2. WorkflowModelPolicy 全局设置（如有）
3. NodeContract.model_policy.model_settings
4. RepairPatch.model_escalation.model_settings_override（如有）
```

合并规则：

- 字段级合并；最高优先级覆盖
- `tools` / `tool_choice` 等专属字段不在本流程合并，由 Adapter 内部统一构造
- `seed` 字段：节点级若声明，作为最终；否则不写（保持模型默认）
- `temperature` / `top_p` / `max_tokens` 三项必须出现在 `effective_model_settings`，否则 `MR_REQUIRED_SETTING_MISSING`

合并完成后由 ModelRouter 写入 `RoutingDecision.effective_model_settings`，作为 ExecutionPack 的一部分传给 Adapter。

---

## 7. 与 AgentAdapter 的协作

### 7.1 路由发生时机

```
Engine 准备 attempt
    │
    ▼
ContextBuilder 估算 tokens_estimate
    │
    ▼
ModelRouter.route(RoutingRequest)
    │
    ▼
RoutingDecision → 写入 ExecutionPack.effective_model_profile_id / effective_model_settings
    │
    ▼
AdapterFactory.create(decision.adapter_id, ...)
    │
    ▼
adapter.prepare(execution_pack) → adapter.run(handle)
```

### 7.2 重路由

仅以下情况允许同一 attempt 内重新路由：

- ContextBuilder 重建后 `context_required_tokens` 超过原 profile 上限：`MR_REROUTE_CONTEXT_OVERFLOW` → 选择 long_context_tokens 更大的 profile（仍在节点 escalation_chain 内）
- Adapter `prepare()` 抛 `AA_PREPARE_INCOMPATIBLE_ADAPTER`：路由强制重选不同 adapter（同 profile）

其它情况（运行中模型崩溃 / 网络错误等）属于 attempt 失败 → 重启 attempt 再走完整路由，而不是 inline 重路由。

### 7.3 一致性检查

- AgentAdapter.capabilities() 必须 ⊇ NodeCapabilityRequirement；运行时再次检查；不满足则 `AA_PREPARE_INCOMPATIBLE_ADAPTER`
- ModelProfile.provider_kind 必须 ∈ Adapter.capabilities.provider_kinds；不满足 `MR_ADAPTER_PROFILE_PROVIDER_MISMATCH`

---

## 8. 观测

### 8.1 事件投影

每次路由产生以下 StreamEvent：

- `model.request_started` 之前发出 `metric.snapshot`（可选，含 routing latency）
- 路由失败时发出 `error.exception`（kind=`routing_failure`）

### 8.2 RoutingTrace 落盘

`RoutingDecision` 完整落 `runs/<run_id>/routing.jsonl`（与 `runtime_harness.md` 对齐——本 spec 锁定该文件存在；Harness spec 后续补充字段）。每行：

| 字段 | 必填 | 说明 |
|---|---|---|
| `decision_id` | ✅ | — |
| `request` | ✅ | RoutingRequest |
| `decision` | ✅ | RoutingDecision |
| `engine_version` | ✅ | — |
| `router_version` | ✅ | — |

进 Git ✅。

### 8.3 OTel span

```
span:cw.model_router.route
  attributes:
    cw.run_id, cw.node_id, cw.attempt_index
    cw.adapter_id, cw.model_profile_id
    cw.escalation_position
    cw.candidates_count, cw.removed_count
    cw.routing_decision_id
```

---

## 9. Phase 1 vs Phase 3 行为差异

| 行为 | Phase 1 | Phase 3 |
|---|---|---|
| `performance_score` 来源 | 全部填 `null` 或 0.5 | 由 ReflectionMemory 与 CW-Bench 周期更新 |
| `tie_break` 中 performance 权重 | 0.1（占位） | 0.1~0.3（动态） |
| `route_seed` | 始终为 null | 引入项目级 seed 用于 A/B；仍确定性 |
| `escalation_chain` 自适应 | 否；只读静态配置 | 允许 ReflectionMemory 提议链更新（写回 settings 需用户确认） |
| ModelProfile 自动学习 | 否 | 是（写 `~/.cw/model_profiles.json` 的 performance_profile 段） |
| `ContextBuilder` 与 Router 的 token 协商 | 一次性 | 允许多轮（escalation） |

---

## 10. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `MR_REGISTRY_EMPTY` | resolve | 全局 + 项目合并后 ModelProfile 集合为空 |
| `MR_NO_CANDIDATES` | route step1 | 候选 0 |
| `MR_PROVIDER_KIND_FORBIDDEN_ALL` | route step2 | 全部候选被 provider_kind 过滤掉 |
| `MR_CAPABILITY_NOT_MET` | route step3 | 候选不满足节点能力需求 |
| `MR_PRIMARY_PROFILE_NOT_AVAILABLE` | route step4 | 节点显式 profile 不可用且无 fallback |
| `MR_ESCALATION_EXHAUSTED` | route step6 | 升级链已用尽 |
| `MR_ESCALATION_CHAIN_TOO_LONG` | resolve | 链长度 > 5 |
| `MR_ESCALATION_NON_LINEAR` | escalation | RepairPatch 指定的 profile 不是链中的下一个 |
| `MR_ESCALATION_CROSS_PROVIDER_KIND_FORBIDDEN` | escalation | 链相邻两步 provider_kind 跨界（local→cloud）且未启用允许 |
| `MR_SETTINGS_MERGE_CONFLICT` | step8 | settings 合并出错 |
| `MR_REQUIRED_SETTING_MISSING` | step8 | 必需 setting（temperature / top_p / max_tokens）缺失 |
| `MR_ADAPTER_PROFILE_PROVIDER_MISMATCH` | adapter check | Profile.provider_kind 不在 Adapter.capabilities.provider_kinds |
| `MR_REROUTE_CONTEXT_OVERFLOW` | rerun | 上下文超出当前 profile 上限 |
| `MR_SENSITIVE_DATA_REMOTE_FORBIDDEN` | filter | 敏感节点 / 数据被路由到 cloud Provider |
| `MR_PROFILE_DISABLED` | step1 | 显式声明的 profile 已禁用 |
| `MR_ADAPTER_NOT_REGISTERED` | step1 | 候选 adapter 不在 entry_points |
| `MR_INTERNAL` | 任意 | 实现错误（不允许暴露） |

---

## 11. JSON 示例

### 11.1 ModelProfile（全局注册）

```json
{
  "model_profile_id": "claude-sonnet-default",
  "display_name": "Claude Sonnet 4 — Default",
  "provider_kind": "cloud",
  "provider_id": "anthropic",
  "model_id": "claude-sonnet-4",
  "capabilities": {
    "max_context_tokens": 200000,
    "max_output_tokens": 8192,
    "structured_output_native": true,
    "tool_call": true,
    "streaming": true,
    "multi_modal": ["image", "document"],
    "reasoning_supported": true,
    "vision_supported": true,
    "failure_types_supported": ["format_error", "missing_output", "missing_evidence", "logic_gap", "ambiguous_requirement"],
    "reliability_score": 0.92,
    "recommended_node_kinds": ["execution", "evaluation", "repair", "human_gate"]
  },
  "default_model_settings": {"temperature": 0.3, "top_p": 0.95, "max_tokens": 4096},
  "cost_profile": {"input_per_million_usd": 3.0, "output_per_million_usd": 15.0, "latency_p50_ms": 4500, "latency_p95_ms": 12000, "tier": "premium"},
  "performance_profile": {"node_kind_pass_rates": {}, "node_kind_avg_attempts": {}, "domain_scores": {}, "common_failure_types": [], "best_prompt_patterns": [], "poor_fit_signals": [], "last_evaluated_at": null},
  "auth_ref": "secret_anthropic_default",
  "tags": ["chinese_friendly", "long_context"],
  "disabled": false,
  "metadata": {}
}
```

### 11.2 RoutingDecision

```json
{
  "decision_id": "rd_01J9N5T0...",
  "request_id": "rr_01J9N5T0...",
  "run_id": "run_01J...", "node_id": "n_extract", "attempt_index": 0,
  "adapter_id": "pydantic_ai",
  "model_profile_id": "claude-sonnet-default",
  "effective_model_settings": {"temperature": 0.3, "top_p": 0.95, "max_tokens": 4096},
  "reasoning_chain": [
    {"step": "collect_candidates", "before_count": 0, "after_count": 7, "removed": [], "notes": null},
    {"step": "apply_provider_kind_filter", "before_count": 7, "after_count": 5,
     "removed": [{"model_profile_id": "ollama-llama3-7b", "adapter_id": "litellm", "reason": "MR_PROVIDER_KIND_FORBIDDEN_ALL: workflow forbids local for this node"}], "notes": null},
    {"step": "apply_capability_filter", "before_count": 5, "after_count": 3, "removed": [], "notes": null},
    {"step": "apply_node_policy", "before_count": 3, "after_count": 3, "removed": [], "notes": "primary='auto'"},
    {"step": "apply_workflow_policy", "before_count": 3, "after_count": 3, "removed": [], "notes": "default=claude-sonnet-default"},
    {"step": "apply_escalation", "before_count": 3, "after_count": 3, "removed": [], "notes": "no escalation_trigger"},
    {"step": "tie_break", "before_count": 3, "after_count": 3, "removed": [],
     "notes": "scores: claude-sonnet-default=0.86, gpt5.2-strong=0.82, qwen2.5-32b=0.74"},
    {"step": "select", "before_count": 3, "after_count": 1, "removed": [], "notes": "rank=1"}
  ],
  "candidates_considered": [
    {"model_profile_id": "claude-sonnet-default", "adapter_id": "pydantic_ai", "capability_score": 0.92, "cost_score": 0.4, "performance_score": null, "selected": true,  "rank": 1},
    {"model_profile_id": "gpt5.2-strong",          "adapter_id": "pydantic_ai", "capability_score": 0.95, "cost_score": 0.6, "performance_score": null, "selected": false, "rank": 2},
    {"model_profile_id": "qwen2.5-32b",            "adapter_id": "pydantic_ai", "capability_score": 0.78, "cost_score": 0.1, "performance_score": null, "selected": false, "rank": 3}
  ],
  "escalation_position": 0,
  "escalation_chain": ["claude-sonnet-default", "claude-opus-strong", "gpt5.2-strong"],
  "forbidden_provider_kinds": ["local"],
  "seed_used": null,
  "decided_at": "2026-06-15T08:30:01Z",
  "metadata": {}
}
```

---

## 12. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-MR-1 | Phase 1 ModelRouter **完全静态确定性**：相同输入与相同 ResolvedProfileRegistry 必产生相同 RoutingDecision；不调用任何远端探活 |
| D-MR-2 | 候选剔除采用"硬过滤"（隐私 + 能力）+ "软排序"（capability/cost/performance 加权）双层；硬过滤不可降级 |
| D-MR-3 | NodeCapabilityRequirement 由 ModelRouter 从 NodeContract 推导，**禁止上层手填**；避免漂移 |
| D-MR-4 | 升级链长度上限 5；相邻两步不允许 local→cloud 跳跃，除非节点显式开启 |
| D-MR-5 | RepairPatch.model_escalation.switch_to_model_profile 必须 ∈ 节点 escalation_chain 的下一步；越级或回退直接拒绝 |
| D-MR-6 | 项目级 `profile_overrides` 仅允许覆盖 `default_model_settings / disabled / auth_ref / tags`；禁止改 `model_id / provider_id`，避免 ID 漂移 |
| D-MR-7 | Phase 1 `performance_score` 不进入硬过滤；只参与 tie_break 的占位项；Phase 3 自适应 |
| D-MR-8 | 含 `sensitive=true` Evidence 或 `forbid_remote_for_sensitive=true` 节点：路由必须只选 `provider_kind ∈ {local, private}`；不容错降级 |
| D-MR-9 | RoutingDecision 一旦被 attempt 使用，attempt 内不可变；变更 = `model_escalation` Patch + 新 attempt |
| D-MR-10 | RoutingTrace 完整落 `runs/<run_id>/routing.jsonl`，进 Git；任何决策必须能反查 |
| D-MR-11 | tie_break 公式 = `0.6 * capability_score - 0.3 * cost_score + 0.1 * performance_score`；权重在 v0.2 之前不变；Phase 3 引入抖动仅在 route_seed 非空时生效 |
| D-MR-12 | ModelProfile ID 全局唯一；项目内不允许通过 `add_profiles` 重复全局 ID |

---

## 13. 与未来 spec 的桥接

- `protocols/reflection_memory.md`（待）：Phase 3 写回 `performance_profile`
- `protocols/observability.md`（待）：路由 OTel span 命名规范
- CW-Bench 评测（独立 spec 待）：自动校准 `ModelCapabilities.reliability_score` 与 `performance_profile`
- `protocols/context_builder.md`（待）：Builder 的 token 估算输出作为 RoutingRequest.requirement.context_required_tokens

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-MR-1 ~ D-MR-12；对齐技术架构 v1.0 §5.2 / §8 / §12.2；与 `agent_adapter.md` / `node_contract.md` / `repair_patch.md` / `runtime_harness.md` 一致 |
