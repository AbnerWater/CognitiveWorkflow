# Spec: EvidenceBuilder Protocol

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-protocol-005` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §4（Context Pack 与 Evidence Pack）；技术架构 v1.0 §5.2（MCCL 组件 Evidence Builder）/ §7.1（标准执行链路 step 4） |
| 关联 spec | `specs/schemas/evidence_pack.md`（产物 schema）、`specs/schemas/node_contract.md`（输入：evidence_requirements）、`specs/protocols/context_builder.md`（嵌入消费方）、`specs/protocols/reflection_memory.md`（evidence_pattern 写回 / 复用）、`specs/runtime_harness.md`（references.manifest.json + LanceDB 缓存） |
| 关联 ADR | ADR-0002、ADR-0005、ADR-0007 |

> **范围**：定义 `EvidenceBuilder` 协议——把 `NodeContract.evidence_requirements + ReferenceLibrary 索引 + 工具检索结果 + 上游 Artifact 引用 + 用户输入声明`，装填为符合 `evidence_pack.md` 的 `EvidencePack` 实例。
>
> **非范围**：
> - `EvidencePack` 自身字段（已锁定）
> - 通用上下文片段（属 `context_builder.md`）
> - CitationChecker 的具体实现（属 `specs/tools/citation_checker.md`，待）
>
> **核心立场**：**事实声明的来源边界**优先于"广撒网"。每个声明必须能找回到 Pack 内一条 Evidence；冲突必须显式声明（D-EP-6）；敏感数据与远程模型互斥（D-EP-3）。

---

## 0. 设计原则

1. **请求驱动**：Builder 基于 `NodeContract.evidence_requirements` 与节点 `purpose` 工作，**不**在节点未声明 evidence 需求时主动构建。
2. **三段流程**：检索 → re-rank + 阈值过滤 → 冲突检测 + 覆盖度计算。每段独立可观测、可缓存、可重放。
3. **检索策略可插拔**：BM25 / 向量 / 工具调用 / 上游 artifact 直引，按 `EvidenceRequirement.kind` 分发；不同来源在同一 Pack 内统一编号。
4. **CitationChecker 在评价阶段**：Builder 不做 dangling citation / unsupported claim 检测；这两项在 evaluation 阶段由 CitationChecker 跑（与 D-EP-5 / `evaluation_result.md` §7 一致）。
5. **可重放**：同 ReferenceLibrary 索引快照 + 同 EvidenceRequirement → 同 EvidencePack（pack_hash 相同）。
6. **隐私边界硬约束**：`sensitive=true` 的 Reference / Evidence 一旦进入 Pack，节点 ModelRouter 必须落 local/private 模型；构建期校验失败即拒绝（与 D-EP-3 / D-MR-8 一致）。
7. **构建期可失败**：当必填 EvidenceRequirement 无法满足时，构建期返回 `EP_BUILD_REQUIREMENT_UNRESOLVED`，由 Engine 触发 RepairPatch.evidence_patch 或 human_checkpoint。

---

## 1. 接口

```python
class EvidenceBuilder(Protocol):
    @property
    def builder_version(self) -> str: ...

    async def build(
        self,
        request: EvidenceBuildRequest,
    ) -> EvidencePack: ...
    """同步阻塞直到完成；失败抛 EvidenceBuildError。"""

    async def rebuild_with_patch(
        self,
        previous_pack: EvidencePack,
        patch_spec: EvidencePatchSpec,
    ) -> EvidencePack: ...
    """RepairPatch.evidence_patch 应用后由 Engine 调用；产生新版本 Pack（pack_id 派生）。"""

    async def fetch_chunks(
        self,
        reference_id: str,
        chunk_ids: list[str],
    ) -> list[ReferenceChunk]: ...
    """直读接口：仅按 ID 取 chunk，不做检索 / re-rank。供 ContextBuilder 复用。"""

    async def aclose(self) -> None: ...
```

### 1.1 `EvidenceBuildRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `request_id` | `string` (ULID) | ✅ | — |
| `run_id / node_id / attempt_id` | `string` | ✅ | — |
| `purpose` | `string` (≤500) | ✅ | 节点的事实性问题（短句） |
| `evidence_requirements` | `EvidenceRequirement[]` | ✅ | 来自 NodeContract |
| `reference_index_snapshot_id` | `string` | ✅ | 当前 ReferenceLibrary 索引版本 |
| `embedding_model` | `string \| null` | ❌ | bge-m3 / nomic-embed-text；为 null 时使用 settings 默认 |
| `re_ranker` | `ReRankerSpec \| null` | ❌ | LLM judge / cross-encoder 等 |
| `tool_lookups` | `ToolLookupSpec[]` | ❌ `[]` | 工具调用计划（如 web_fetch / database_query） |
| `upstream_artifact_refs` | `UpstreamArtifactRef[]` | ❌ `[]` | 已写入产物的来源声明 |
| `user_assertions` | `UserAssertion[]` | ❌ `[]` | Run 启动时用户提交的事实声明（如"项目 A 已完成 V1"） |
| `relevance_threshold` | `number` (0..1) | ❌ `0.6` | 默认相关性阈值 |
| `confidence_threshold` | `number` (0..1) | ❌ `0.5` | 默认可信度阈值 |
| `cache_namespace` | `string \| null` | ❌ | 默认 `<project_id>::evidence::<embedding_model>` |
| `correlation_id` | `string` | ✅ | OTel TraceID |
| `metadata` | `object` | ❌ | — |

### 1.2 `EvidencePatchSpec`

`RepairPatch.evidence_patch.operations` 的运行时呈现：

| 字段 | 类型 | 说明 |
|---|---|---|
| `add_topic_coverage` | `{ topic: string, min_evidences?: int }[]` | 强制覆盖某主题 |
| `replace_evidence_for_criterion` | `{ criterion_id: string, min_count: int }[]` | 替换某 criterion 的 evidence 集 |
| `tighten_relevance` | `number \| null` | 提高 min_relevance |
| `tighten_confidence` | `number \| null` | 提高 min_confidence |
| `mark_conflict_resolved` | `{ conflict_id, resolution_note }[]` | 标注冲突已解决 |
| `inject_evidence_lookup_tool` | `bool` | 强制启用 evidence_lookup |

---

## 2. 三段构建流程

```
1. retrieve     —— 多源召回（reference_chunk / tool / upstream / user_assertion）
2. rerank       —— relevance + confidence 过滤；按 topic 归类；LLM judge re-rank（可选）
3. consolidate  —— 冲突检测；coverage 计算；requirements_resolved；写 Pack
```

### 2.1 `retrieve`

按 `evidence_requirements[i].required_for + required_topics` 触发多源召回：

| 来源 | 触发条件 | 召回操作 |
|---|---|---|
| `reference_chunk` | requirements 中含 reference / global_context_refs 中含 reference | 1) 候选 reference_id（节点显式声明 + global_context_refs 默认全部启用）；2) 用 `embedding_model` 把 `purpose + topic_keys` 嵌入；3) LanceDB 检索 top-K（默认 20） |
| `tool_result` | `tool_lookups[i]` | 调用对应工具（web_fetch / database_query / code_search 等）；结果按 ToolReturnSchema 解析 |
| `upstream_artifact` | `upstream_artifact_refs[i]` 显式声明 | 直接读 artifact，不做 re-rank |
| `user_assertion` | 用户在 Run 启动时声明的事实 | 转 Evidence（confidence 由 settings.privacy 默认 0.5；用户可调） |
| `mcp_resource` | `tool_lookups[i].kind=mcp_resource` | 走 MCPServer.read_resource |
| `project_memory` | 显式声明 memory_key 作为 evidence | 取 memory.json 对应 key（仅 memory_task / 用户允许场景） |

每条候选构造 `EvidenceCandidate`：

| 字段 | 说明 |
|---|---|
| `evidence_id_provisional` | 临时 ID（按 source signature） |
| `claim` | 由 re-rank 阶段填充；retrieve 阶段为空或预填 |
| `quote` | 原文（必填） |
| `source` | `EvidenceSource` 判别式联合 |
| `relevance_raw` | 来源相似度（向量距离 / BM25 score） |
| `confidence_raw` | 来源可信度（资料类型 + 用户标记） |
| `topics_raw` | 由 source 标签 / 资料 metadata 推导 |
| `tokens_estimate` | 渲染后 token 估算 |

去重规则：相同 `(reference_id, chunk_id)` 或 `(tool_id, arguments_hash)` 只保留一份；多次召回提升 `relevance_raw` 取 max。

### 2.2 `rerank`

```
1. 阈值过滤：
   relevance_raw < relevance_threshold → 剔除
   confidence_raw < confidence_threshold → 剔除（user_assertion 例外，因 confidence 多由用户给）

2. （可选）LLM judge re-rank：
   - 输入：purpose + 候选的 quote + topic_set
   - 输出：每个候选的 relevance ∈ [0, 1] 与 support_polarity ∈ {supports / refutes / contextual / unclear}
   - 用于覆盖原 relevance_raw

3. claim 生成：
   - 由 LLM judge 同时给出 claim（≤500 字符）
   - 不允许引入新的事实，仅是 quote 的"语义命题化"

4. 主题归类：
   - 候选 topics = topics_raw ∪ judge.suggest_topics
   - 与 evidence_requirements[*].topics 对齐（不在 required_topics 内的"无关"候选标 priority=low 或丢弃）

5. 优先级：
   - critical：required_topics 中"min_evidences=1 且当前仅此 1 条"
   - high：被某 criterion / 某 required_for 直接需要
   - normal：覆盖 required_topics 但有冗余
   - low：与 purpose 相关但不在 required_topics
```

约束：

- LLM judge 只能在节点 `evidence_requirements` 显式启用（`re_ranker.kind=llm_judge`）时启用
- LLM judge 失败 / 超时 → 回退到 `relevance_raw`，只 warning（不致命）
- `user_assertion` 类候选不参与 LLM judge（confidence 已经由用户决定）

### 2.3 `consolidate`

#### 2.3.1 冲突检测

按 `EvidenceConflictKind` 5 类（`evidence_pack.md` §4.1）扫描候选集合：

- `contradiction` — 同一 topic 下 polarity=supports 与 polarity=refutes 同时存在
- `numeric_disagreement` — 数值类 claim 之间差异 > 阈值（默认 ±10%）
- `scope_mismatch` — 同 topic 但 scope tags 不一致（如"商用规模 vs 实验室"）
- `temporal_mismatch` — 时间标签差距 > 阈值（默认 12 个月）
- `source_credibility_gap` — confidence 差 > 0.3 且 polarity 一致（提示降权）

每条冲突落 `EvidenceConflict` 条目；`severity` 默认按 kind 推导：`contradiction=blocker`、`numeric_disagreement=major`、其它 `minor`。可由 `consolidate.severity_overrides`（来自 reflection_memory.evidence_pattern）调整。

#### 2.3.2 覆盖度计算

```
required_topics_covered = { t ∈ required_topics | ∃ evidence ∈ candidates: t ∈ evidence.topics ∧ relevance ≥ 0.5 }
coverage_ratio = |covered| / max(1, |required|)
avg_relevance = mean(relevance over selected)
avg_confidence = mean(confidence over selected)
```

#### 2.3.3 RequirementResolution 填充

对每条 `EvidenceRequirement[i]`：

```
evidence_ids = { e | e 满足 required_for 路径条件 }
actual_coverage = computed_per_requirement(evidence_ids, min_coverage)
satisfied = actual_coverage >= min_coverage
```

任一 `required=true ∧ satisfied=false` → 构建期抛 `EP_BUILD_REQUIREMENT_UNRESOLVED`。

#### 2.3.4 隐私二次校验

对于每条 evidence 的 source：

- `reference_chunk` source.reference_id 在 `references.manifest.json` 中查 `sensitive` 字段
- 任意 evidence `sensitive=true` → Pack 内 `metadata.cw.runtime.contains_sensitive=true`
- 校验当前 RoutingDecision（若已有）的 ProfileKind 不为 cloud；不满足直接抛 `EP_BUILD_SENSITIVE_REMOTE_FORBIDDEN`

#### 2.3.5 写 Pack

构造 `EvidencePack`（pack_id、provenance、coverage、conflicts、requirements_resolved）→ 落 `runs/<run_id>/evidence_packs/<pack_id>.json` → 触发 StreamEvent：

- `evidence.build_completed`
- 每条冲突一条 `evidence.conflict_detected`
- 写完后由 Engine 在 attempt 完成时**异步**触发 `evidence.feedback_written`（来自 EvaluationResult.evidence_feedback；不在 Builder 内）

---

## 3. ReferenceLibrary 索引

### 3.1 文件契约

- `references.manifest.json`（schema 见 `runtime_harness.md` §2.7）
- `cache/embeddings.lance/`（LanceDB；不进 Git）
- `cache/reference_chunks.sqlite`（chunk 文本与 metadata 缓存；不进 Git）

### 3.2 索引生命周期

| 事件 | 索引状态 |
|---|---|
| 用户上传新 reference | `chunk_status=none` → 触发 chunk → `chunk_status=chunked` → 触发 embed → `chunk_status=indexed` |
| reference 被禁用 | `chunk_status=stale`（不参与检索） |
| reference 内容修改（content_hash 变化） | 整体重建 |
| Embedding 模型变更 | 整体重建（产生新 `index_snapshot_id`） |

### 3.3 chunk 策略

默认：`chunk_size_tokens=512, overlap=64`；可由 `settings.json` 与 `EvidenceRequirement.chunk_overrides` 覆盖。

### 3.4 索引快照

每次"整体重建"产生新 `index_snapshot_id`；旧 snapshot 保留 30 天后 GC。`EvidencePack.provenance.reference_index_snapshot_id` 记录"本次构建用的快照"，用于可重放。

---

## 4. 缓存

| 维度 | 默认 |
|---|---|
| Backend | LanceDB（向量） + SQLite（chunk 文本 / re-rank 结果） |
| Key（向量召回） | `blake3(embedding_model + reference_id + chunk_id)` |
| Key（re-rank） | `blake3(embedding_model + re_ranker_id + purpose + chunk_signature)` |
| TTL | 30 天 |
| 失效事件 | `reference_reindex` / `embedding_model_change` / `re_ranker_change` |
| 含 sensitive reference | **不进缓存**（仅在 `secure/`） |

---

## 5. 与 ContextBuilder 协调（双向约束）

- ContextBuilder 在节点有 `evidence_requirements` 时**先**调用 EvidenceBuilder.build，再调用 ContextBuilder.build
- ContextBuilder 通过 `EvidenceBuilder.fetch_chunks(reference_id, chunk_ids)` 直读 chunk（不经 re-rank）；**禁止**调用 EvidenceBuilder 的 retrieve / rerank 流程
- EvidenceBuilder 不依赖 ContextBuilder
- 共享缓存：reference_chunk 文本缓存（`cache/reference_chunks.sqlite`）由 EvidenceBuilder 写入，ContextBuilder 命中读

---

## 6. 与 ReflectionMemory 协作

### 6.1 输入：evidence_pattern 命中

Builder 在 `retrieve / rerank` 阶段读取 ReflectionLookupResult 中的 `evidence_pattern` 条目：

- 推荐的 `topic_set` → 自动加入 `required_topics` 候选（不强制必填，但提升 priority）
- 推荐的 `relevance_threshold / confidence_threshold` → 当节点未显式给阈值时使用
- 推荐的 `chunk_strategy` → 仅在节点首次构建时使用（避免漂移）

### 6.2 输出：evidence_pattern 写回

Builder 在 attempt 一次通过且满足"稳定门槛"（≥3 次跨 Run 一致）时由 Engine 触发写回（与 `reflection_memory.md` §4.3 一致）：

- 写入条目 `kind=evidence_pattern`，`origin_kind=attempt_completed`
- Builder 不直接写 `reflection_memory.jsonl`；由 ReflectionMemory 模块统一管理

---

## 7. 可重放与 hash

`EvidencePack.provenance.pack_hash` 计算：

```
canonical = serialize(
    evidences[*]: { evidence_id, claim, quote, paraphrase, source, relevance, confidence,
                    support_polarity, topics, priority, sensitive, tokens_estimate },
    coverage:    { required_topics, required_topics_covered, coverage_ratio, avg_relevance, avg_confidence },
    conflicts,
    requirements_resolved,
    reference_index_snapshot_id,
    embedding_model, re_ranker_model, requirements_hash
)（按字段定义顺序 + dict alphabetical）
排除时间戳 / cache_meta / coverage.unsupported_claim_estimates / metadata.cw.runtime.*

pack_hash = blake3(canonical)
```

> `unsupported_claim_estimates` 只在 evaluation 阶段回填，与 D-EP-5 一致；构建期 hash 不包含。

---

## 8. 错误码

> 与 `evidence_pack.md` §8 错误码同套。Builder 仅在以下额外场景抛出：

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `EB_INPUT_NO_REQUIREMENTS` | request | evidence_requirements 为空（如本节点无需 evidence，应跳过 Builder） |
| `EB_INPUT_INDEX_SNAPSHOT_MISMATCH` | request | snapshot_id 已被 reindex 替换 |
| `EB_RETRIEVE_TOOL_TIMEOUT` | step1 | tool_lookup 超时 |
| `EB_RETRIEVE_TOOL_PROVIDER_FORBIDDEN` | step1 | tool 是远端但节点禁远端 |
| `EB_RERANK_LLM_JUDGE_FAILED` | step2 | LLM judge 调用失败（warning，回退原始 relevance） |
| `EB_RERANK_INVALID_SCORE` | step2 | re-rank 输出分数越界 |
| `EB_CONSOLIDATE_BLOCKER_CONFLICT_UNRESOLVED` | step3 | severity=blocker 冲突无 resolution_hint 且无 mark_conflict_resolved patch |
| `EB_CONSOLIDATE_DUPLICATE_EVIDENCE_ID` | step3 | 实现错误：去重失败 |
| `EB_REBUILD_BASE_PACK_INVALID` | rebuild | rebuild_with_patch 收到的 previous_pack 非法 |

---

## 9. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-EB-1 | EvidenceBuilder 仅在节点 `evidence_requirements` 非空时被调用；空时直接跳过（`EB_INPUT_NO_REQUIREMENTS` 视实现错误，不应在生产路径出现） |
| D-EB-2 | 三段流程顺序固定：retrieve → rerank → consolidate；每段独立可观测、可缓存 |
| D-EB-3 | LLM judge re-rank 仅在节点显式启用时启用；失败回退 relevance_raw，仅 warning |
| D-EB-4 | CitationChecker（dangling / unsupported）由 evaluation 阶段执行；Builder 不做（与 D-EP-5 一致） |
| D-EB-5 | sensitive evidence 触发后必须 ProfileKind 不为 cloud，构建期硬失败 |
| D-EB-6 | 冲突 severity=blocker 必须有 `resolution_hint` 或对应 mark_conflict_resolved patch；否则构建失败 |
| D-EB-7 | `pack_hash` 排除 unsupported_claim_estimates / 时间戳 / cache_meta；与 evaluation 阶段回填解耦 |
| D-EB-8 | reference_chunks 文本缓存由 EvidenceBuilder 写入；ContextBuilder 通过 `fetch_chunks(reference_id, chunk_ids)` 命中复用 |
| D-EB-9 | EvidenceBuilder 不直接写 ReflectionMemory；写回由 Engine + ReflectionMemory 模块统一处理 |
| D-EB-10 | 用户提交的 `user_assertion` 不参与 LLM judge re-rank；confidence 默认 0.5 由 settings.privacy 控制 |

---

## 10. 与未来 spec 的桥接

- `specs/tools/citation_checker.md`（待）：评价阶段 CitationChecker 的具体实现
- `specs/protocols/observability.md`（待）：Builder 的 OTel span 命名（`cw.evidence_builder.retrieve` / `.rerank` / `.consolidate`）
- `specs/protocols/reflection_memory.md` 已锁定的 `evidence_pattern` 写回路径（§4.3 / §6.2）

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-EB-1 ~ D-EB-10；对齐 `evidence_pack.md` / `context_builder.md` / `reflection_memory.md` |
