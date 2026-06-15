# Spec: EvidencePack

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-schema-004` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §4（Context Pack 与 Evidence Pack）；技术架构 v1.0 §3 / §5.2（Evidence Builder 组件）/ §7.1（标准执行链路）；UIUX v1.1 §6（参考资料管理）/ §9（Task 详情面板） |
| 关联 spec | `specs/schemas/context_pack.md`（嵌入关系）、`specs/schemas/node_contract.md`（消费方 `evidence_requirements`）、`specs/schemas/evaluation_result.md`（待，引用覆盖率指标）、`specs/protocols/evidence_builder.md`（待） |
| 关联 ADR | ADR-0002、ADR-0005、ADR-0007 |

> **范围**：定义 `EvidencePack` 数据对象——节点执行时"事实声明的来源边界"。
>
> **非范围**：
> - 通用上下文片段（见 `context_pack.md`）
> - Evidence 检索算法、相似度模型、re-ranker 选择（见 `specs/protocols/evidence_builder.md`，待）
> - 引用对齐（Citation Checker）的具体实现（见 `specs/tools/citation_checker.md`，待）
>
> **核心立场**：模型生成内容时**必须基于 EvidencePack 而不是凭空生成**（00_Concept §4）。EvidencePack 的存在让"研究类 / 报告类 / 合规类"节点的产出可被审查、可被回放、可被对齐。本 spec 的每个字段都应能回答"这条结论凭什么这么说？支撑它的句子在哪一份资料的哪一段？"

---

## 0. 设计原则

1. **来源边界优先于完整性**：EvidencePack 不要求覆盖所有可能相关资料，它要求**所有结论都能找回到这个 Pack 内某一条 Evidence**。
2. **每条 Evidence 自洽**：每条都能脱离 Pack 单独引用——含原文、来源、位置、置信度、相关性、可信度、冲突标记。
3. **空间与上下文分离**：EvidencePack 嵌入 ContextPack 时遵守 `context_pack.md` §4 的预算约束；EvidencePack 自身的字段不参与 token 预算（因为它是结构化对象，不是 prompt 文本）。
4. **可校验**：CitationChecker 必须能用 EvidencePack 自动检查"产物中的每个引用 ID 是否解析得到 / 引用是否真的支撑了所声明结论 / 是否存在未引用即陈述事实的句子"。
5. **可冲突**：Evidence 之间允许冲突；Pack 必须显式记录冲突关系，而不是让模型在 prompt 里自己发现。
6. **Adapter 中立**：本文不绑定 Pydantic AI 字段；具体注入方式见 §6。
7. **可回放**：相同 ReferenceLibrary 索引快照 + 相同 EvidenceRequirement 应产生**等价 Pack**（哈希可比对）。
8. **隐私边界尊重**：标记 `sensitive=true` 的 Evidence 必须遵守 `WorkflowModelPolicy.forbid_remote_for_sensitive`，即使 Pack 里其它条目允许云端模型。

---

## 1. 顶层结构 `EvidencePack`

### 1.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `pack_id` | `string` (ULID) | ✅ | — | 全局唯一 |
| `schema_version` | `string` | ✅ | `0.1.0` | — |
| `node_id` | `string` | ✅ | — | 关联节点 |
| `attempt_id` | `string` | ✅ | — | 关联 NodeAttempt |
| `run_id` | `string` | ✅ | — | 关联 WorkflowRun |
| `purpose` | `string` (≤500) | ✅ | — | 本 Pack 服务的事实性问题（短句，便于审计） |
| `evidences` | `Evidence[]` | ✅ | — | 证据条目；详见 §2 |
| `coverage` | `EvidenceCoverage` | ✅ | — | 覆盖度指标；详见 §3 |
| `conflicts` | `EvidenceConflict[]` | ❌ | `[]` | 冲突标记；详见 §4 |
| `requirements_resolved` | `RequirementResolution[]` | ✅ | — | NodeContract.evidence_requirements 解析结果 |
| `provenance` | `EvidenceProvenance` | ✅ | — | Pack 产生信息；详见 §5 |
| `cache_meta` | `CacheMeta | null` | ❌ | `null` | 与 `context_pack.md` §6 同结构 |
| `metadata` | `object` | ❌ | `{}` | 命名空间化扩展字段 |

### 1.2 不变量

- `evidences[*].evidence_id` 在 Pack 内唯一
- `evidences[*].source.reference_id` 必须解析到 ReferenceLibrary 当前快照
- `coverage.required_topics_covered` 不允许夸大——任何被声明覆盖的 topic 必须能在 `evidences` 中找到至少一条 `relevance ≥ 0.5` 的支撑
- 若 `requirements_resolved[*].satisfied=false` 任一项的 `required=true`，则 Pack 视为**不完整**，触发 RepairPatch 或人工检查

---

## 2. `Evidence`

### 2.1 字段表

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `evidence_id` | `string` | ✅ | — | Pack 内唯一；建议格式 `ev_<8 字符 base32>` |
| `claim` | `string` (≤500) | ✅ | — | 该证据所支持的核心论点（短句） |
| `quote` | `string` (≤4000) | ✅ | — | 原文片段（精确引用，不允许改写） |
| `paraphrase` | `string | null` | ❌ | `null` | 模型可读摘要（可改写）；CitationChecker 优先使用 `quote` |
| `source` | `EvidenceSource` | ✅ | — | 来源；详见 §2.2 |
| `relevance` | `number` (0..1) | ✅ | — | 与节点 `purpose` 的相关性（由 EvidenceBuilder re-rank 给出） |
| `confidence` | `number` (0..1) | ✅ | — | 来源可信度（由资料类型 / 期刊等级 / 用户标记综合） |
| `support_polarity` | `enum: supports / refutes / contextual / unclear` | ❌ | `supports` | 该证据对 claim 的极性 |
| `topics` | `string[]` | ❌ | `[]` | 主题标签，用于覆盖度统计 |
| `priority` | `enum: critical / high / normal / low` | ❌ | `normal` | 在 Pack 压缩 / 丢弃时的保留优先级 |
| `sensitive` | `bool` | ❌ | `false` | 敏感数据标记 |
| `tokens_estimate` | `int` (≥0) | ✅ | — | 该 Evidence 在 prompt 中渲染后的 token 估算（含引用元信息） |
| `created_at` | `string` (ISO-8601) | ✅ | — | — |
| `metadata` | `object` | ❌ | `{}` | 命名空间化扩展字段 |

### 2.2 `EvidenceSource`

支持以下来源类型（判别式联合）：

```yaml
reference_chunk:
  source_kind: "reference_chunk"
  reference_id: string                    # ReferenceLibrary 中的资料 ID
  reference_title: string                 # 冗余便于阅读
  reference_url: string | null            # 网络资料的 URL
  chunk_id: string
  chunk_index: int
  position: { start: int, end: int }      # 在原文中的字符或 token 偏移
  page: int | null                        # 文档型资料的页码
  paragraph: int | null

upstream_artifact:
  source_kind: "upstream_artifact"
  from_node_id: string
  artifact_field: string
  artifact_run_id: string | null

tool_result:
  source_kind: "tool_result"
  tool_id: string
  invocation_id: string
  arguments_hash: string                  # 调用参数的 hash，用于回放
  invoked_at: string

mcp_resource:
  source_kind: "mcp_resource"
  server_id: string
  resource_uri: string                    # MCP Resource URI
  resource_revision: string | null

user_input:
  source_kind: "user_input"
  input_field: string
  user_id: string | null
  asserted_at: string

project_memory:
  source_kind: "project_memory"
  memory_key: string
  memory_version: string | null
```

### 2.3 引用语法（在产物中引用 Evidence）

节点产物（`output_schema`）若引用 Evidence，必须使用统一引用形式：

- 字段名建议：`source_evidence_ids: string[]`（每元素是 `evidence_id`）或 `citations: Citation[]`（带局部 span）
- 不允许在产物文本中嵌入 Markdown 链接做引用——CitationChecker 不可解析

`Citation`（用于带 span 的精细引用）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `evidence_id` | `string` | ✅ | — |
| `claim_text_span` | `{ start: int, end: int } | null` | ❌ | 在产物文本字段内的字符范围 |
| `note` | `string | null` | ❌ | 解释如何被该 evidence 支撑 |

---

## 3. 覆盖度 `EvidenceCoverage`

### 3.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `required_topics` | `string[]` | ✅ | NodeContract 期望覆盖的主题；为空时表示节点无显式主题约束 |
| `required_topics_covered` | `string[]` | ✅ | 已覆盖的主题（子集） |
| `coverage_ratio` | `number` (0..1) | ✅ | = `len(covered) / max(1, len(required))` |
| `evidence_density` | `number` | ✅ | 每千字结论文本的平均 evidence 数（运行后回填） |
| `avg_relevance` | `number` (0..1) | ✅ | `evidences[*].relevance` 的均值 |
| `avg_confidence` | `number` (0..1) | ✅ | 同上 confidence |
| `unsupported_claim_estimates` | `int` (≥0) | ❌ | 估算的"无引用即陈述事实"句数；由 CitationChecker 在 evaluation 阶段回填，不在构建期写入 |

### 3.2 与 `EvaluationResult` 的对应

`EvaluationResult.criterion_results` 中 `criterion_id=evidence_present` 的判定**优先**读取 `coverage_ratio` 与 `unsupported_claim_estimates`；若 `coverage_ratio < ReviewPolicy.evidence_required_for_factual_outputs` 阈值（默认 1.0），即使 LLM judge 给出通过，仍判定为 `missing_evidence` 失败。

---

## 4. 冲突 `EvidenceConflict`

### 4.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `conflict_id` | `string` | ✅ | — |
| `evidence_ids` | `string[]` (≥2) | ✅ | 互相冲突的 Evidence ID 集合 |
| `kind` | `enum: contradiction / numeric_disagreement / scope_mismatch / temporal_mismatch / source_credibility_gap` | ✅ | 冲突类型 |
| `severity` | `enum: blocker / major / minor` | ✅ | 严重程度 |
| `resolution_hint` | `string` | ❌ | 推荐处理方式（如 "采用最新数据"、"标注双重数据"） |
| `auto_detected_by` | `string | null` | ❌ | 检测器（如 `evidence_builder/conflict_detector_v1` 或 `human`） |

### 4.2 默认行为

- `severity=blocker` 的冲突未被处理时，**禁止**模型生成针对相关 topic 的结论；EvaluationAgent 必须将其判为 `logic_gap` 失败
- `severity=major` 进入 prompt 时附带 `resolution_hint`，由模型显式选择立场
- `severity=minor` 仅作记录，不阻塞运行

---

## 5. `RequirementResolution` & `EvidenceProvenance`

### 5.1 `RequirementResolution`

每条对应 `NodeContract.evidence_requirements[i]`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `requirement_id` | `string` | ✅ | NodeContract 中该 requirement 的稳定 ID |
| `required_for` | `string` | ✅ | 引用产物字段路径（JSONPath） |
| `min_coverage` | `number` (0..1) | ✅ | 阈值（来自 NodeContract） |
| `actual_coverage` | `number` (0..1) | ✅ | 实际值 |
| `satisfied` | `bool` | ✅ | actual_coverage >= min_coverage |
| `evidence_ids` | `string[]` | ✅ | 用于满足该 requirement 的 Evidence 子集 |

### 5.2 `EvidenceProvenance`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `builder_version` | `string` | ✅ | EvidenceBuilder 版本 |
| `built_at` | `string` (ISO-8601) | ✅ | — |
| `embedding_model` | `string | null` | ❌ | 用于检索的 embedding 模型（如 `bge-m3`） |
| `re_ranker_model` | `string | null` | ❌ | 用于 re-rank 的模型（如 LLM judge） |
| `reference_index_snapshot_id` | `string` | ✅ | ReferenceLibrary 索引快照 ID |
| `requirements_hash` | `string` | ✅ | NodeContract.evidence_requirements 的稳定 hash |
| `pack_hash` | `string` | ✅ | EvidencePack 整体（去时间戳）的稳定 hash |

> `pack_hash` 排除 `evidences[*].created_at`、`provenance.built_at`、`cache_meta.*`、`coverage.unsupported_claim_estimates`、`metadata.cw.runtime.*`。

---

## 6. 与 ContextPack / Pydantic AI 的注入路径

### 6.1 在 ContextPack 中以 `kind=evidence` 嵌入

| ContextFragment 字段 | EvidencePack 来源 |
|---|---|
| `fragment_id` | `frag_evidence_<evidence_id>` |
| `key` | 节点 evidence 字段在 prompt 模板中的访问键（如 `evidence`） |
| `kind` | `evidence` |
| `priority` | 与 `Evidence.priority` 对齐 |
| `required` | `Evidence.priority ∈ {critical, high}` 视为 true，否则 false |
| `tokens_estimate` | `Evidence.tokens_estimate` |
| `payload` | 完整 `Evidence` 对象 |
| `text` | （可选）渲染后的 prompt 文本（如 `[ev_001] "<quote>"  — <reference_title>:<page>:<paragraph>`） |
| `source` | `{ source_kind: "evidence", evidence_pack_id, evidence_id }` |

### 6.2 与 Pydantic AI Agent 的字段映射

- `EvidencePack` 整体作为 `RunContext.deps.evidence` 注入（不进 prompt 文本）；Adapter 暴露 `Tool: evidence_lookup(evidence_id) -> Evidence` 供模型按需获取
- 节点 `prompt.user_prompt_template` 中如出现 `{{ deps.evidence }}`，由 ContextBuilder 渲染为引用列表（非完整 quote），完整 quote 留给 evidence_lookup 工具按需调用
- 未声明 `evidence_requirements` 的节点不会强制注入 evidence_lookup 工具

### 6.3 不变量

- Adapter 不得直接修改 EvidencePack；如需补充 Evidence（如运行中调用 web_fetch 工具），由 Capability 在 `wrap_node_run` 中产生**新版本** EvidencePack（pack_id 派生）
- EvidencePack 中标记 `sensitive=true` 的 Evidence 一旦存在，本节点的 ModelRouter 必须选择**非云端**模型；否则构建期失败

---

## 7. JSON 示例

```json
{
  "pack_id": "evp_01J9N5T1QC...",
  "schema_version": "0.1.0",
  "node_id": "n_extract",
  "attempt_id": "att_01J9N5T1QC...",
  "run_id": "run_01J9N5SXAA...",
  "purpose": "为'低空经济中无人机交付的研究问题'提供来源证据",
  "evidences": [
    {
      "evidence_id": "ev_001",
      "claim": "中国 1500 米以下空域的政策正在快速放开",
      "quote": "2024 年 12 月，民航局发布《无人驾驶航空器运行规则》……开放了 120 米以下消费级运行边界。",
      "paraphrase": "2024 年起 120 米以下空域消费级运营开放",
      "source": {
        "source_kind": "reference_chunk",
        "reference_id": "ref_drone_2025_review",
        "reference_title": "低空经济 2025 综述",
        "reference_url": null,
        "chunk_id": "chk_007",
        "chunk_index": 7,
        "position": {"start": 1024, "end": 2560},
        "page": 14,
        "paragraph": 3
      },
      "relevance": 0.86,
      "confidence": 0.78,
      "support_polarity": "supports",
      "topics": ["policy_environment"],
      "priority": "critical",
      "sensitive": false,
      "tokens_estimate": 110,
      "created_at": "2026-06-15T08:30:00Z"
    },
    {
      "evidence_id": "ev_002",
      "claim": "美团已在深圳完成多机协同交付商用试运营",
      "quote": "截至 2025 年 6 月，美团无人机在深圳累计完成 30 万订单，平均时长 12 分钟。",
      "source": {
        "source_kind": "reference_chunk",
        "reference_id": "ref_drone_2025_review",
        "reference_title": "低空经济 2025 综述",
        "reference_url": null,
        "chunk_id": "chk_011",
        "chunk_index": 11,
        "position": {"start": 4096, "end": 5120},
        "page": 22,
        "paragraph": 1
      },
      "relevance": 0.74,
      "confidence": 0.81,
      "support_polarity": "supports",
      "topics": ["enterprise_deployment"],
      "priority": "high",
      "sensitive": false,
      "tokens_estimate": 95,
      "created_at": "2026-06-15T08:30:00Z"
    },
    {
      "evidence_id": "ev_003",
      "claim": "公开报告称多机协同延误瓶颈在调度算法",
      "quote": "在 ICRA 2024 论文中，该团队报告高密度任务下的等待时间随密度呈非线性增长。",
      "source": {
        "source_kind": "reference_chunk",
        "reference_id": "ref_icra2024_paper",
        "reference_title": "Multi-UAV Delivery Scheduling, ICRA 2024",
        "reference_url": "https://example.org/icra2024-multi-uav.pdf",
        "chunk_id": "chk_002",
        "chunk_index": 2,
        "position": {"start": 320, "end": 1280},
        "page": 4,
        "paragraph": 2
      },
      "relevance": 0.69,
      "confidence": 0.88,
      "support_polarity": "contextual",
      "topics": ["delivery_bottleneck"],
      "priority": "high",
      "sensitive": false,
      "tokens_estimate": 102,
      "created_at": "2026-06-15T08:30:00Z"
    }
  ],
  "coverage": {
    "required_topics": ["policy_environment", "enterprise_deployment", "delivery_bottleneck"],
    "required_topics_covered": ["policy_environment", "enterprise_deployment", "delivery_bottleneck"],
    "coverage_ratio": 1.0,
    "evidence_density": 0.0,
    "avg_relevance": 0.763,
    "avg_confidence": 0.823
  },
  "conflicts": [
    {
      "conflict_id": "cf_001",
      "evidence_ids": ["ev_002", "ev_003"],
      "kind": "scope_mismatch",
      "severity": "minor",
      "resolution_hint": "ev_002 是商用规模数据，ev_003 是实验室仿真——结论中应分别说明",
      "auto_detected_by": "evidence_builder/conflict_detector_v1"
    }
  ],
  "requirements_resolved": [
    {
      "requirement_id": "req_001",
      "required_for": "research_questions[*].source_evidence_ids",
      "min_coverage": 1.0,
      "actual_coverage": 1.0,
      "satisfied": true,
      "evidence_ids": ["ev_001", "ev_002", "ev_003"]
    }
  ],
  "provenance": {
    "builder_version": "0.1.0",
    "built_at": "2026-06-15T08:30:00Z",
    "embedding_model": "bge-m3",
    "re_ranker_model": "claude-haiku-rerank",
    "reference_index_snapshot_id": "snap_2026Q2_w24",
    "requirements_hash": "rhash_eb91...",
    "pack_hash": "phash_evd2..."
  },
  "cache_meta": null,
  "metadata": {}
}
```

---

## 8. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `EP_BUILD_REQUIREMENT_UNRESOLVED` | 构建 | NodeContract.evidence_requirements 中的项无法满足（且 required=true） |
| `EP_BUILD_NO_REFERENCE_INDEX` | 构建 | ReferenceLibrary 未建立索引或索引为空 |
| `EP_BUILD_BLOCKER_CONFLICT_UNRESOLVED` | 构建 | 存在 `severity=blocker` 冲突且无 `resolution_hint` |
| `EP_BUILD_SENSITIVE_REMOTE_FORBIDDEN` | 构建 | 含 `sensitive=true` Evidence 但 ModelRouter 选了云端模型 |
| `EP_BUILD_DUPLICATE_EVIDENCE_ID` | 构建 | 同一 Pack 内出现重复 evidence_id |
| `EP_BUILD_BAD_RELEVANCE_SCORE` | 构建 | relevance / confidence 不在 [0,1] |
| `EP_RUNTIME_PACK_MUTATED` | 运行 | Adapter / 中间件试图修改 Pack 内容 |
| `EP_RUNTIME_EVIDENCE_LOOKUP_MISS` | 运行 | evidence_lookup 工具调用了不存在的 evidence_id |
| `EP_EVAL_UNSUPPORTED_CLAIM` | 评价 | CitationChecker 发现未引用即陈述事实 |
| `EP_EVAL_DANGLING_CITATION` | 评价 | 产物引用的 evidence_id 不在 Pack 内 |

---

## 9. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-EP-1 | EvidencePack **只读**：构建完成后到 attempt 结束之间不得被 Adapter / Capability 修改；变更须产生新版本 |
| D-EP-2 | 节点产物的 evidence 引用**必须**使用 `evidence_id` 列表或 `Citation[]` 形式；禁止 Markdown 链接式内嵌引用 |
| D-EP-3 | EvidencePack 标记 `sensitive=true` 的 Evidence 与远程模型互斥；构建期失败而非运行期截断 |
| D-EP-4 | EvidencePack 嵌入 ContextPack 时遵守 `context_pack.md` D-CP-3：默认 `keep_evidence_intact=true`，不允许 summarize Evidence 内容 |
| D-EP-5 | `coverage.unsupported_claim_estimates` 仅在 evaluation 阶段回填；Pack 构建期不写入此字段 |
| D-EP-6 | Evidence 之间的冲突必须在 Pack 中显式声明；不允许把冲突检测推迟到 EvaluationAgent prompt 中"由模型自己发现" |
| D-EP-7 | Adapter 默认提供 `evidence_lookup(evidence_id) -> Evidence` 工具；当节点 `evidence_requirements` 非空且 ContextPack 内嵌入了 EvidencePack 时强制启用 |

---

## 10. 与未来 spec 的桥接

- `evaluation_result.md`：审查节点读取本 Pack 计算 `evidence_coverage_rate` 与 `unsupported_claim_estimates`
- `repair_patch.md`：`patch_kind=evidence_patch` 触发 EvidenceBuilder 重建，并允许指定补充哪些 topic
- `reflection_memory.md`：成功 attempts 的 EvidencePack 摘要会被沉淀，作为下次同类节点的 `topics` 候选

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-EP-1 ~ D-EP-7；对齐技术架构 v1.0 §3/§5.2/§7.1 与 00_Concept §4 |
