# Spec: ContextBuilder Protocol

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-protocol-004` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §4（Context Pack 与 Evidence Pack）；技术架构 v1.0 §5.2（MCCL 组件 Context Builder）/ §7.1（标准执行链路 step 3）；UIUX v1.1 §9（Task 详情面板：上下文呈现） |
| 关联 spec | `specs/schemas/context_pack.md`（产物 schema）、`specs/schemas/node_contract.md`（输入：context_requirements）、`specs/schemas/workflow_graph.md`（global_context_refs）、`specs/schemas/evidence_pack.md`（嵌入关系）、`specs/protocols/evidence_builder.md`（同期产出）、`specs/protocols/reflection_memory.md`（注入源）、`specs/protocols/agent_adapter.md`（消费方） |
| 关联 ADR | ADR-0002、ADR-0005、ADR-0007、ADR-0008 |

> **范围**：定义 `ContextBuilder` 协议——把 `NodeContract.context_requirements + WorkflowGraph.global_context_refs + ProjectMemory + Upstream Artifacts + ReflectionMemory + EvidencePack` 装填为符合 `context_pack.md` 的 `ContextPack` 实例。
>
> **非范围**：
> - `ContextPack` 自身字段（已在 `context_pack.md` 锁定）
> - 证据片段如何来（属于 `evidence_builder.md`）
> - 检索算法的具体实现（向量库 / BM25 等属实现）
>
> **核心立场**：**最小充分上下文**。Builder 必须在节点开始执行**之前**完成构建，并保证 ContextPack 的不变量（`context_pack.md` D-CP-1 ~ D-CP-6 全部）。token 预算硬约束优于片段完整性；必填片段不可丢弃。

---

## 0. 设计原则

1. **纯函数 + 缓存**：相同输入（`NodeContract.context_requirements_hash + Upstream Artifacts hash + Reference 索引快照 + Memory version + ReflectionMemory snapshot + tokenizer + budget`）必产生相同 ContextPack；命中片段缓存以加速。
2. **构建发生在 attempt 启动之前**：构建期间允许进行 token 估算 / 摘要 / chunk，但不允许调用底层 LLM 推理（除"摘要器"模型，且预算独立）。
3. **构建期硬失败优于运行期超额**：超过预算或必填片段无法满足 → 构建期抛 `CP_BUILD_OVER_BUDGET / CP_BUILD_REQ_UNRESOLVED`，由 Engine 触发 RepairPatch 或 human_checkpoint。
4. **Adapter 无感**：构建产物对所有 Adapter 一致；Adapter 只读 ContextPack，不再做模板渲染（`context_pack.md` D-CP-4）。
5. **可观测**：每次构建产生 `context.build_started / context.compression_applied / context.build_completed / context.over_budget_failed` StreamEvent，并写 `runs/<run_id>/context_packs/`。
6. **隐私感知**：含 sensitive Evidence / 敏感 ContextRequirement 的构建过程，强制走 §6 路径；不污染 cache。

---

## 1. 接口

```python
class ContextBuilder(Protocol):
    @property
    def builder_version(self) -> str: ...

    async def build(
        self,
        request: ContextBuildRequest,
    ) -> ContextPack: ...
    """同步阻塞直到完成；失败抛 ContextBuildError。"""

    async def rebuild_with_patch(
        self,
        previous_pack: ContextPack,
        patch_spec: ContextPatchSpec,
    ) -> ContextPack: ...
    """RepairPatch.context_patch 应用后由 Engine 调用；产生新版本 Pack（pack_id 派生）。"""

    def estimate_tokens(
        self,
        spec: ContextRequirement | EvidencePack | str,
        tokenizer: str,
    ) -> int: ...
    """供 ModelRouter 提前估算 context_required_tokens。"""

    async def aclose(self) -> None: ...
```

### 1.1 `ContextBuildRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `request_id` | `string` (ULID) | ✅ | — |
| `run_id / node_id / attempt_id` | `string` | ✅ | — |
| `node_contract_snapshot` | `NodeContract` | ✅ | 已应用 RepairPatch overlay 后的契约 |
| `workflow_graph_global_refs` | `string[]` | ❌ `[]` | 来自 WorkflowGraph.global_context_refs |
| `upstream_artifacts` | `UpstreamArtifactRef[]` | ❌ `[]` | 上游节点已写入的产物索引（来自 `runs/<run_id>/attempts.jsonl` + `artifacts/index.jsonl`） |
| `project_memory` | `ProjectMemorySnapshot` | ✅ | `memory.json` 当前版本 + version |
| `evidence_pack` | `EvidencePack \| null` | ❌ | 由 EvidenceBuilder 同步产出（若节点有 evidence_requirements） |
| `reflection_lookup` | `ReflectionLookupResult \| null` | ❌ | 已检索的反思记忆条目；若 null 则 Builder 不主动检索 |
| `tokenizer` | `string` | ✅ | 与 ModelProfile.capabilities 对齐 |
| `budget` | `ContextBudget` | ✅ | 预算（来自 ModelProfile + node_policy 合成） |
| `correlation_id` | `string` | ✅ | OTel TraceID |
| `cache_namespace` | `string \| null` | ❌ | 默认 `<project_id>::context_fragment::<tokenizer>` |
| `force_rebuild` | `bool` | ❌ `false` | 跳过缓存 |
| `metadata` | `object` | ❌ | — |

### 1.2 `ContextPatchSpec`

`RepairPatch.context_patch.operations` 的运行时呈现：

| 字段 | 类型 | 说明 |
|---|---|---|
| `add_requirements` | `ContextRequirement[]` | 新增上下文需求 |
| `remove_requirement_keys` | `string[]` | 删除指定 key |
| `update_requirements` | `Record<key, Partial<ContextRequirement>>` | 局部更新 |
| `bump_priorities` | `{ fragment_kind?, from, to }[]` | 优先级提升 |
| `summarize_above_tokens` | `int \| null` | 触发 above_tokens 重摘要 |
| `pin_artifact_keys` | `{ from_node_id, artifact_field, as_key }[]` | 强制 pin 上游产物 |

---

## 2. 构建流程

8 步流程，每步在 `compression_log` 与 StreamEvent 留下记录。

```
1. resolve_requirements
2. resolve_global_refs
3. resolve_reflection_injections
4. estimate_initial_tokens
5. fetch_or_cache_fragments
6. embed_evidence_pack
7. apply_compression
8. finalize_and_emit
```

### 2.1 `resolve_requirements`

按 `NodeContract.context_requirements` 解析，每条产生候选 `ContextRequirementResolution`：

| 字段 | 说明 |
|---|---|
| `requirement` | 原契约项 |
| `selector_resolved_to` | 具体来源对象（artifact_id / reference_chunk_ids / memory_key 等） |
| `tokens_estimate_initial` | 估算长度（未压缩） |
| `cache_key` | 片段缓存的 key |

校验：

- `kind=upstream_artifact` 且 `from_node_id` 不存在或对应 attempt 未完成 → 必填项失败 `CP_BUILD_REQ_UNRESOLVED`
- `kind=reference` 但 `reference_id="$auto"` → 调用 EvidenceBuilder 候选检索（不直接召回，仅做 ID 解析）
- `kind=user_input` 但 Run 启动未提供该字段 → 必填项失败

### 2.2 `resolve_global_refs`

按 D-WG-5 节点级覆盖全局：

```
final_ref_set = (节点级 context_requirements 的 reference_id 集合)
              ∪ (global_context_refs - 节点级冲突项)
```

冲突项判定：当 `global_context_refs[i] ∈ memory_keys / reference_ids / skill_ids` 与节点级显式 `key` 同源时，节点级覆盖；冲突的全局项 drop。

### 2.3 `resolve_reflection_injections`

调用 `ReflectionLookupRequest`（见 `reflection_memory.md` §5.1），按以下规则装载为 `instruction_addendum` 候选：

- `confidence ≥ 0.5 ∧ sample_count ≥ 2`
- `kind ∈ {patch_pattern, prompt_pattern}`（execution / repair 节点）
- `kind ∈ {evidence_pattern}`（节点有 evidence_requirements）

每条注入产生一份 `ContextFragment` 候选：

| 字段 | 取值 |
|---|---|
| `kind` | `instruction_addendum` |
| `priority` | `confidence ≥ 0.8` → `high`；否则 `normal` |
| `required` | `false` |
| `text` | `"提示：以往同类节点（成功 N 次，置信度 X%）建议……" + entry.summary + 关键操作摘要` |

约束：注入条目的总 token 不超过 `budget.hard_limit_tokens × 0.05`（避免反思记忆喧宾夺主）。

### 2.4 `estimate_initial_tokens`

对所有候选片段使用 `tokenizer` 估算 `tokens_estimate`；记入 `ContextFragment.tokens_estimate`。

### 2.5 `fetch_or_cache_fragments`

按 `cache_key` 查 `cache/context_fragment_cache.sqlite`：

- 命中 → 直接复用 `text + tokens_estimate + transformation`
- 未命中 → 执行实际 fetch + transform：
  - `upstream_artifact` → 读取 `runs/<run_id>/artifacts/...` 或 `attempts.jsonl` 内联 output
  - `reference_chunk` → 调用 EvidenceBuilder 接口 `fetch_chunks(reference_id, chunk_ids)`
  - `project_memory` → 读 `memory.json` 对应 key
  - `static_text` → 直接取自契约 inline 文本
  - `user_input` → 读 Run 启动时录入的 input_field
- 写入缓存（命名空间 `<project_id>::context_fragment::<tokenizer>`，TTL 24h）

`force_rebuild=true` 时跳过缓存读，但仍写缓存。

### 2.6 `embed_evidence_pack`

若 `request.evidence_pack` 非空：

- 把 EvidencePack 中每条 Evidence 投影为 `kind=evidence` 的 ContextFragment（payload = 完整 Evidence；text = 渲染后的引用列表行）
- `priority` 与 `Evidence.priority` 对齐（critical/high → high；其它 → normal）
- `required` = `Evidence.priority ∈ {critical, high}` 视为 true
- 注意：默认 `keep_evidence_intact=true`（D-EP-4 / D-CP-3），不允许 summarize Evidence 内容

### 2.7 `apply_compression`

按 `context_pack.md` §4.3 流程执行；记录 `CompressionLogEntry`。流程要点：

```
1. sum = Σ tokens_estimate
2. 若 sum ≤ budget.hard_limit → 完成
3. 否则按 priority 升序遍历 (low → critical)：
   a. 若 priority ≤ drop_priority_threshold ∧ required=false → drop
   b. 否则按 kind 选动作：
      - reference_chunk / project_memory / failure_history / instruction_addendum → summarize（或 truncate_middle 当 < summarize_min_tokens）
      - upstream_artifact → quote_extract（保留 schema 关键字段）
      - evidence → 仅 keep_evidence_intact=false 才 summarize；否则 drop 低优先级 evidence
   c. 重算 sum
4. 单趟过后仍超额 → CP_BUILD_OVER_BUDGET（构建期硬失败）
```

约束（与 D-CP-2 / D-CP-3 一致）：

- `required=true` 永不 drop
- `kind=evidence` 默认永不 summarize（除非 EvidenceBuilder / RepairPatch 显式放开）
- `kind=instruction_addendum` 在第一轮被压缩；但保留至少 1 条 confidence 最高的
- 单次 build 不允许同一片段被压缩两次（避免循环）

### 2.8 `finalize_and_emit`

- 构造 `ContextPack`（pack_id、provenance、cache_meta、compression_log、template_inputs）
- 写入 `runs/<run_id>/context_packs/<pack_id>.json`
- 触发 StreamEvent：`context.build_completed`（含 fragments_count / total_tokens / hard_limit）

---

## 3. 模板渲染（D-CP-4）

ContextBuilder 在 §2.5 fetch 完成后**立即**完成 fragment.text 的渲染：

- `static_text` 类直接使用契约内文本
- `upstream_artifact` 类按 `selector` JSONPath 提取后转 JSON 文本（缩进 2 / 排序 key）
- `project_memory` 类按 key 取 string 或 JSON
- `reference_chunk` 类直接使用原文（已 chunked）
- `evidence` 类按格式 `[<evidence_id>] "<quote>"  — <reference_title>:<page>:<paragraph>` 渲染

`template_inputs` 是 `Dict[key, str | object]`，保持渲染前的"原始可读"形态，便于 Adapter 在 prompt 模板中插值。

---

## 4. 缓存策略

| 维度 | 默认 |
|---|---|
| Backend | SQLite (`<project>/.agent-workflow/cache/context_fragment_cache.sqlite`) |
| Key | `blake3(source + transformation_kind + tokenizer + chunk_strategy_signature)` |
| TTL | 24 小时（可由 settings.streaming.cache_ttl_seconds 修改） |
| 失效事件 | `reference_reindex` / `memory_write(version+1)` / `tokenizer_change` |
| 跨 attempt 共享 | 是 |
| 跨 Run 共享 | 是（同项目） |
| 跨项目共享 | 否 |
| 含 sensitive 数据 | **不进缓存**（D-RH-3） |

缓存命中信息回填 `ContextPack.cache_meta`（命中片段 ID / namespace / TTL / invalidated_by）。

---

## 5. 与 EvidenceBuilder 协调

ContextBuilder 与 EvidenceBuilder 在同一 attempt 启动前**严格顺序**执行：

```
1. 若 NodeContract.evidence_requirements 非空：
   a. EvidenceBuilder.build(request) → EvidencePack
   b. ContextBuilder.build(request_with_evidence_pack) → ContextPack
2. 否则：
   a. ContextBuilder.build(request, evidence_pack=null) → ContextPack
```

Builder 之间的接口约束：

- ContextBuilder 通过依赖注入持有 `EvidenceBuilder` 引用，但**不允许**直接发起 EvidenceBuilder 内部检索；只能调用 `EvidenceBuilder.fetch_chunks(reference_id, chunk_ids)`（即 ReferenceLibrary 直读接口，不经过 evidence-level re-rank）
- 反方向：EvidenceBuilder 不依赖 ContextBuilder
- 共享 cache namespace：`reference_chunk` 片段的缓存由 ContextBuilder 写入，EvidenceBuilder 命中读用（避免双份缓存）

---

## 6. 隐私 / 敏感数据

- 任何片段标记 `sensitive=true`（来自 ReferenceEntry / EvidencePack / ProjectMemory）→ 整个 ContextPack 标 `metadata.cw.runtime.contains_sensitive=true`
- `contains_sensitive=true` 时：
  - 该 Pack 不写入 `cache/`
  - 该 Pack 写入 `runs/<run_id>/context_packs/` 时，`compression_log` / `template_inputs` 中含敏感片段的部分改写到 `secure/context_packs.encrypted.sqlite`，jsonl 仅保留索引指针
- ModelRouter 提前感知：见 `model_router.md` §3.2 推导 `requirement.risk_level`；构建后再检查 ProfileKind 不应越界

---

## 7. 可重放与 hash

`ContextPack.provenance.pack_hash` 计算：

```
canonical = serialize(
    fragments[*]: { fragment_id, key, kind, priority, required, source, transformation, text, payload },
    template_inputs,
    output_format_hint,
    budget,
    requirements_hash,
    inputs_hash
)（按字段定义顺序 + dict alphabetical）
排除时间戳 / cache_meta / metadata.cw.runtime.*

pack_hash = blake3(canonical)
```

可重放定义：相同 `requirements_hash + inputs_hash + tokenizer + budget` → 相同 pack_hash。

---

## 8. 错误码

> 与 `context_pack.md` §10 错误码同套。Builder 仅在以下额外场景抛出：

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `CB_INPUT_TOKENIZER_UNKNOWN` | request | tokenizer 不在已知集合 |
| `CB_INPUT_BUDGET_INVALID` | request | hard_limit_tokens ≤ 0 |
| `CB_INPUT_NODE_CONTRACT_MISSING` | request | node_contract_snapshot 为空 |
| `CB_FETCH_UPSTREAM_NOT_FOUND` | step5 | 必填上游 artifact 找不到 |
| `CB_FETCH_REFERENCE_INDEX_STALE` | step5 | reference_chunk 引用的索引快照已失效 |
| `CB_FETCH_MEMORY_VERSION_MISMATCH` | step5 | project_memory 版本与 snapshot 不一致 |
| `CB_REFLECTION_INJECT_OVERFLOW` | step3 | 反思记忆注入超 5% 预算（自动截断到 5% 时只 warning） |
| `CB_REBUILD_BASE_PACK_INVALID` | rebuild | rebuild_with_patch 收到的 previous_pack 非法 |

---

## 9. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-CB-1 | ContextBuilder 是纯函数 + 缓存；不允许在构建期调用底层 LLM 推理（摘要器除外，且预算独立） |
| D-CB-2 | 8 步流程顺序固定：resolve_requirements → resolve_global_refs → resolve_reflection_injections → estimate_initial_tokens → fetch_or_cache_fragments → embed_evidence_pack → apply_compression → finalize_and_emit |
| D-CB-3 | 反思记忆注入总 token 上限 = `budget.hard_limit × 0.05`；超出自动截断 + warning，不致命 |
| D-CB-4 | 必填片段（`required=true`）禁止 drop；超额触发 `CP_BUILD_OVER_BUDGET` 构建期硬失败 |
| D-CB-5 | EvidencePack 嵌入时默认 `keep_evidence_intact=true`（与 D-EP-4 一致）；不允许 summarize evidence 内容 |
| D-CB-6 | 模板渲染由 Builder 在 fetch 后完成；Adapter 不再二次渲染 |
| D-CB-7 | Sensitive 数据不进 `cache/`；含 sensitive 片段的 Pack 走 `secure/` 旁路 |
| D-CB-8 | `pack_hash` 排除时间戳 / cache_meta / runtime metadata；保证相同输入可重放 |
| D-CB-9 | ContextBuilder ↔ EvidenceBuilder 顺序严格：先 EvidenceBuilder 后 ContextBuilder；ContextBuilder 不调用 EvidenceBuilder 的 re-rank 接口 |

---

## 10. 与未来 spec 的桥接

- `protocols/observability.md`（待）：Builder 的 OTel span 命名（`cw.context_builder.build` 等）
- `protocols/reflection_memory.md` 已锁定的 §5.4.1 注入路径在本 Builder 内部实现
- `protocols/agent_adapter.md` `prepare()` 阶段调用结果作为 `ExecutionPack.context_pack` 注入

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-CB-1 ~ D-CB-9；对齐 `context_pack.md` / `evidence_pack.md` / `reflection_memory.md` |
