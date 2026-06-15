# Spec: ReflectionMemory Protocol

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-protocol-003` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 00_Concept §6（项目记忆与执行状态记录）/ §5.8（沉淀 / 模板）；技术架构 v1.0 §3（术语 Reflection Memory）/ §5.2（MCCL 组件 Reflection Memory）/ §12.2（ModelPerformanceRecord） |
| 关联 spec | `specs/schemas/node_contract.md`（消费方：`instruction_addendum` 注入）、`specs/schemas/context_pack.md`（注入路径 §3.3 / `kind=instruction_addendum`）、`specs/schemas/evaluation_result.md`（写入触发源）、`specs/schemas/repair_patch.md`（写入触发源）、`specs/protocols/agent_adapter.md`（Capability `wrap_run` 写回）、`specs/protocols/model_router.md`（performance_profile 反馈）、`specs/runtime_harness.md`（落盘位置 §2.6） |
| 关联 ADR | ADR-0002、ADR-0005、ADR-0007、ADR-0008、ADR-0011（Claude 个人记忆 vs 项目记忆边界） |

> **范围**：定义 `ReflectionMemory` 协议——CW 项目内"经验沉淀"的统一对象与读写规则。本 spec 决定：
> - 项目内 `reflection_memory.jsonl` 的精确 schema（共 6 类条目）
> - 每类条目的写入触发规则（基于 EvaluationResult / RepairPatch / Adapter 事件）
> - 检索 API（路由到 ContextPack `instruction_addendum` 的注入路径）
> - 与 `ModelProfile.performance_profile` 的反馈通道
> - 隐私分级与 GC
>
> **非范围**：
> - **Claude（本助手）的跨会话个人记忆**——属于 ADR-0011 的另一侧；那是 Claude 的个人体系，不写入项目仓库；本 spec 所说的"反思记忆"是**项目级 / CW 产品自身**的概念，二者不可混淆
> - 实际向量索引算法（属于 `protocols/context_builder.md` 与 `protocols/evidence_builder.md`）
> - 跨项目 / 团队级共享（Phase 4 才考虑）
>
> **核心立场**：反思记忆**只沉淀"具体可复用"的经验**（成功的 Patch、稳定的 Prompt 模式、典型失败诊断），不沉淀"用户工作内容"。它是 CW 与节点契约的"经验夹层"，让普通模型能在第二次遇到同类失败时立刻命中曾经成功的修复路径。

---

## 0. 设计原则

1. **来源透明**：每条 ReflectionMemory 必须能反查到产生它的 NodeAttempt / EvaluationResult / RepairPatch（`origin_refs`）。无法溯源的条目禁止写入。
2. **结构化优先**：每条记忆都是结构化对象（按 `kind` 分类），不是自由文本。检索按字段索引，不靠语义相似度兜底。
3. **写入仅由"通过验证的成功 / 经诊断的失败"触发**：Engine 不允许在 attempt 进行中即时写入；只能在确定的阶段产生（详见 §4）。
4. **去重 + 加权**：同一模式重复触发只增 `sample_count`，不重复写入；高 sample_count 在检索时排序优先。
5. **隐私分级**：`sensitive=true` 条目改写入 `secure/reflection_sensitive.encrypted.sqlite`，永不进 Git，永不跨设备同步（D-RH-3）。
6. **作用域分层**：项目级（`<project>/.agent-workflow/reflection_memory.jsonl`） vs 全局级（`~/.cw/reflection_memory_global.jsonl`，跨项目；Phase 1 留位，Phase 3 启用）。
7. **被 Adapter / Engine / Planner 共享**：消费方不止运行时节点；PlanningSession 的 PlannerAgent / PatchAgent 同样可读取（如 §5.4）。
8. **Phase 1 v0**：仅启用"读 + 写 + 简单检索"，不做语义聚类与跨项目分享；Phase 3 起接入 ModelProfile 自学习。

---

## 1. 顶层结构 `ReflectionMemoryEntry`

### 1.1 公共字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `memory_id` | `string` (ULID) | ✅ | 全局唯一 |
| `schema_version` | `string` | ✅ | `0.1.0` |
| `kind` | `ReflectionKind` | ✅ | 6 类之一；详见 §2 |
| `scope` | `enum: project / global` | ✅ | 作用域；Phase 1 仅 `project`，`global` 留位 |
| `topic_keys` | `string[]` | ✅ | 检索键集合（如 `node_type:execution_task`、`failure_type:logic_gap`、`domain:research_paper`、`pattern:over_generalization`） |
| `summary` | `string` (≤500) | ✅ | 一句话概述（UI 展示） |
| `content` | `ReflectionContent` | ✅ | 各 kind 的具体载荷（discriminated union；详见 §2） |
| `origin_refs` | `OriginRefs` | ✅ | 溯源信息；详见 §3 |
| `sample_count` | `int` (≥1) | ✅ | 沉淀次数（去重计数） |
| `success_count` | `int` (≥0) | ✅ | 后续验证为有效的次数（仅适用于 patch_pattern / prompt_pattern） |
| `failure_count` | `int` (≥0) | ❌ `0` | 后续验证为无效的次数 |
| `last_seen_at` | `string` (ISO-8601) | ✅ | 最近一次触发 |
| `first_seen_at` | `string` (ISO-8601) | ✅ | 首次写入 |
| `confidence` | `number` (0..1) | ✅ | `success_count / max(1, sample_count)` 的指数加权（详见 §4.4） |
| `sensitive` | `bool` | ✅ | 是否含敏感数据；true 时改写 `secure/reflection_sensitive.encrypted.sqlite` |
| `disabled` | `bool` | ❌ `false` | 用户主动禁用 |
| `tags` | `string[]` | ❌ `[]` | 自由标签 |
| `metadata` | `object` | ❌ `{}` | 命名空间化扩展字段 |

### 1.2 不变量

- `topic_keys` 必须按字典序排序后存储（保证 Git diff 稳定 + 检索归一）
- `sample_count >= success_count + failure_count`（允许等于：未表态的样本不计 success/failure）
- `confidence ∈ [0, 1]` 严格，越界视为脏数据
- `sensitive=true` 的条目**禁止**出现在 `reflection_memory.jsonl`；任何写入路径必须前置校验
- 同一 `(kind, normalized_origin_signature)` 在项目内唯一；二次触发只更新 `sample_count / success_count / last_seen_at`，不新建条目

---

## 2. 6 类 `ReflectionKind` 与各自 `ReflectionContent`

### 2.1 `failure_pattern`

记录"什么样的节点 / 上下文 / 输入容易触发哪类失败"。

| 字段 | 必填 | 说明 |
|---|---|---|
| `node_type` | ✅ | execution / evaluation / repair / human_gate / tool / memory |
| `failure_type` | ✅ | 8+1 类（与 EvaluationResult.failure_type 对齐） |
| `severity` | ✅ | blocker / major / minor |
| `signature` | ✅ | 失败模式的稳定签名（hash 自 finding kind + path + criterion_id） |
| `typical_findings` | ✅ | `Finding[]` 摘要（去 message 长尾） |
| `domain_hints` | ❌ | 领域提示（research / coding / simulation / compliance） |

### 2.2 `patch_pattern`

记录"对某种失败什么样的 RepairPatch 是有效的"——这是 Phase 1 最核心的反馈对象。

| 字段 | 必填 | 说明 |
|---|---|---|
| `addresses_failure_type` | ✅ | 修复的目标 failure_type |
| `node_type` | ✅ | 被修复节点的 contract_kind |
| `patch_kind` | ✅ | RepairPatch.patch_kind（6 类之一） |
| `operations_signature` | ✅ | RepairPatch.operations 的稳定签名（按 op 类型 + 关键字段做归一化 hash） |
| `operations_summary` | ✅ | 操作的人类可读摘要（≤2000） |
| `before_after_metrics` | ❌ | `{ pass_rate_before, pass_rate_after, attempts_saved }`（Phase 3 才有意义） |
| `recommended_scope` | ✅ | this_attempt_only / until_pass / persistent_for_run |

### 2.3 `prompt_pattern`

记录"什么样的 prompt / instructions / few-shot 改动让节点稳定"。

| 字段 | 必填 | 说明 |
|---|---|---|
| `node_type` | ✅ | — |
| `addresses_failure_types` | ✅ | 一个或多个 failure_type |
| `pattern_text` | ✅ | 提示词模式（追加约束 / few-shot 示例 / output format hint）|
| `pattern_kind` | ✅ | append_to_system / append_to_instructions / append_to_user_prompt / add_few_shot / add_format_hint |
| `replaces_node_id` | ❌ | 来源节点（用于审计） |

### 2.4 `evidence_pattern`

记录"什么样的证据策略对某类节点有效"。

| 字段 | 必填 | 说明 |
|---|---|---|
| `node_type` | ✅ | — |
| `topic_set` | ✅ | 推荐覆盖的 topic 集合 |
| `relevance_threshold` | ❌ | 推荐 min_relevance |
| `confidence_threshold` | ❌ | 推荐 min_confidence |
| `chunk_strategy` | ❌ | `{ chunk_size_tokens, overlap_tokens }` |

### 2.5 `node_template_seed`

记录"经过几次迭代验证的节点契约小模板"，用于 PlannerAgent / PatchAgent 推荐。

| 字段 | 必填 | 说明 |
|---|---|---|
| `node_type` | ✅ | — |
| `goal_pattern` | ✅ | 业务目标的语义模式（如"从 PDF 提取研究问题"） |
| `output_schema_signature` | ✅ | 输出 schema 的稳定签名 |
| `recommended_contract_partial` | ✅ | NodeContract 的部分字段（goal / criteria / repair_strategies / model_policy 等推荐值） |
| `seed_origin_workflow_id` | ❌ | 来源 Workflow（用于反查） |

> 注意：本 kind **不**直接产出可执行节点；它是 PlannerAgent 在草案阶段的参考素材（与 `template / library` 不同；Phase 4 才提升到正式模板库）。

### 2.6 `model_performance_signal`

记录"某 ModelProfile 在某类节点上的表现信号"，作为 Phase 3 ModelRouter 自学习的输入。Phase 1 仅采集，不参与决策。

| 字段 | 必填 | 说明 |
|---|---|---|
| `model_profile_id` | ✅ | — |
| `node_type` | ✅ | — |
| `domain` | ❌ | research / coding / simulation / 等 |
| `pass_rate_window` | ✅ | 滑动窗口（近 N 次 attempt）的通过率 |
| `avg_attempts_window` | ✅ | 平均尝试次数 |
| `common_failure_types` | ✅ | 该窗口内主要失败类型分布 |
| `evidence_window_size` | ✅ | 窗口大小 N（Phase 1 默认 20） |

---

## 3. `OriginRefs` 溯源

每条 ReflectionMemory 必须能反查到产生它的对象。`origin_refs` 是判别式 union：

```yaml
from_evaluation:
  origin_kind: "evaluation"
  evaluation_id: string                # EvaluationResult.eval_id
  run_id: string
  node_id: string
  attempt_id: string

from_repair:
  origin_kind: "repair"
  patch_id: string                     # RepairPatch.patch_id
  evaluation_id: string                # 触发它的 EvaluationResult
  retried_attempt_id: string           # 应用 Patch 后下一次 attempt（用于验证 success/failure）
  run_id: string
  node_id: string

from_attempt_completion:
  origin_kind: "attempt_completed"
  attempt_id: string
  run_id: string
  node_id: string

from_planning_session:
  origin_kind: "planning_session"
  session_id: string
  draft_id: string

from_human_correction:
  origin_kind: "human"
  decision_record_id: string
  run_id: string
  node_id: string

from_aggregate:
  origin_kind: "aggregate"
  source_memory_ids: string[]          # 由多条 memory 合并产生（Phase 3）
```

约束：

- `from_repair` 的 `retried_attempt_id` 必须存在于 `attempts.jsonl`，且其 `state ∈ {COMPLETED, FAILED}`——不允许把"修复刚生成、还没验证成功"就视为 patch_pattern 入库；详见 §4.2
- `from_human_correction` 的来源进入 `secure/` 路径前需要 §6 隐私检查

---

## 4. 写入触发规则

### 4.1 触发点总表

| 触发点 | 产生条目 kind | 备注 |
|---|---|---|
| `EvaluationResult` 写入（不论 passed 与否） | `failure_pattern`（仅 passed=false） + `model_performance_signal` 滑动窗口更新 | 即时写入 |
| `RepairPatch.applied` + 后续 attempt `state=COMPLETED` | `patch_pattern.success_count++` 或新建 | "验证成功"才计 success |
| `RepairPatch.applied` + 后续 attempt `state=FAILED` | `patch_pattern.failure_count++` | — |
| `attempt_completed` (不经修复) | `prompt_pattern` + `evidence_pattern`（仅当 attempt 一次通过且符合稳定门槛） | 见 §4.3 |
| `WorkflowRun.completed` | `node_template_seed` 候选评估（仅当节点贡献了高 success_count 的 patch / prompt 模式） | Phase 1 仅做候选打标，不直接落库 |
| `human_decision_resolved` | `failure_pattern` 的 `human_resolution` 标注 | 用户决策记录用于审计 |

### 4.2 patch_pattern 验证窗口

新 RepairPatch 应用后，等待"下一次 attempt 完成"之前**不创建新的 patch_pattern 条目**；窗口大小 = 1（即只看下一次 attempt）。验证后：

- 若下一次 attempt `state=COMPLETED` 且 `evaluation_result.passed=true`：
  - 命中已有条目 → `sample_count++ / success_count++`
  - 未命中 → 创建新条目，`sample_count=1, success_count=1`
- 若下一次 attempt `state=COMPLETED` 但 `passed=false` 或 `state=FAILED`：
  - 命中已有条目 → `sample_count++ / failure_count++`
  - 未命中 → **不创建新条目**（避免污染）；仅记录到 metric 通道

### 4.3 一次通过的稳定门槛

`prompt_pattern / evidence_pattern` 在 attempt 一次通过时**不立即写入**，需满足"稳定门槛"：

- 同一 NodeContract（按 `contract_id`）在 ≥3 次不同 Run 中一次通过
- 上述 ≥3 次的 prompt / evidence 派生模式签名一致（按 `pattern_signature` 归一化）

满足 → 创建条目 `sample_count=3, success_count=3`；否则只在 cache 中累计计数，不落 jsonl。

### 4.4 confidence 计算

```
confidence = success_count / (success_count + failure_count + smoothing)
其中 smoothing = 1.0
```

衰减规则：若 `last_seen_at < now - 90d`，confidence 乘以 0.8（每 30 天一次复合衰减）。

### 4.5 去重与 signature

签名计算：

| kind | 签名输入 |
|---|---|
| `failure_pattern` | `(node_type, failure_type, sorted(finding.kind + finding.path))` |
| `patch_pattern` | `(addresses_failure_type, node_type, patch_kind, sorted(op.kind + key fields))` |
| `prompt_pattern` | `(node_type, sorted(addresses_failure_types), pattern_kind, normalize(pattern_text))` |
| `evidence_pattern` | `(node_type, sorted(topic_set), bucketize(relevance_threshold), bucketize(confidence_threshold))` |
| `node_template_seed` | `(node_type, hash(goal_pattern), hash(output_schema_signature))` |
| `model_performance_signal` | `(model_profile_id, node_type, domain)` |

`normalize(pattern_text)`：去除尾部空白、统一标点为半角、忽略大小写差异；不做语义归一（避免误聚合）。

`bucketize(0..1)` = `floor(value * 10) / 10`（0.05 误差内同 bucket）。

---

## 5. 检索 API 与注入路径

### 5.1 检索请求

```python
class ReflectionLookupRequest(Protocol):
    node_id: str
    contract_kind: str
    node_type: str
    failure_type_hint: str | None         # 来自上一 attempt 的 EvaluationResult，可空
    domain_signals: list[str]
    top_k_per_kind: int                    # 默认 3
    include_kinds: set[ReflectionKind] | None
    confidence_min: float                  # 默认 0.5
    sample_count_min: int                  # 默认 2
    scope: Literal["project", "project+global"]  # Phase 1 仅 project
```

### 5.2 检索结果

| 字段 | 说明 |
|---|---|
| `entries_by_kind` | `Dict[ReflectionKind, ReflectionMemoryEntry[]]`（按 confidence DESC） |
| `total_count` | — |
| `query_hash` | 稳定 hash（用于可重放） |

### 5.3 检索算法（Phase 1 简单版）

```
1. 加载 reflection_memory.jsonl + secure（按用户权限）→ 内存索引（按 topic_keys 倒排索引）
2. 构造候选 keys：
   - failure_type_hint 非空时加入 failure_type:<x>
   - 始终加入 node_type:<x>
   - 加入 domain_signals 中每个非空标签
3. 倒排索引匹配：候选条目 = 至少匹配 1 个 candidate key 的并集
4. 过滤：disabled=false ∧ confidence ≥ confidence_min ∧ sample_count ≥ sample_count_min
5. 按 (confidence DESC, sample_count DESC, last_seen_at DESC) 排序
6. 按 kind 取前 top_k_per_kind
```

> Phase 3 起允许在步骤 1-3 之间引入 BM25 / 向量索引；签名仍保持本签名。

### 5.4 注入路径

ReflectionMemory 的检索结果可以注入到以下三个位置：

#### 5.4.1 ContextPack `instruction_addendum` 片段

最常用路径：`patch_pattern` / `prompt_pattern` 命中时，由 ContextBuilder 在节点 attempt 启动前装入：

| ContextFragment 字段 | ReflectionMemoryEntry 取值 |
|---|---|
| `kind` | `instruction_addendum` |
| `priority` | `normal`（confidence ≥ 0.8 时升 `high`） |
| `required` | `false`（不阻塞节点） |
| `text` | "提示：以往同类节点（成功 N 次）建议……" + entry.summary + 关键操作摘要 |
| `source` | `{ source_kind: "injected", injected_by: "reflection_memory", reason: "<topic_keys>" }` |

#### 5.4.2 RepairAgent.deps

`patch_pattern` 命中时，由 Engine 在 RepairAgent 的 ContextPack 中装入"过往成功修复模式"参考。RepairAgent 仍按 `NodeContract.repair.repair_strategies` 自行决策，不强制采用记忆建议。

#### 5.4.3 PlannerAgent / PatchAgent.deps

`node_template_seed` 命中时，由 Engine 在草案阶段装入"经验节点种子"，作为 PlannerAgent 的可参考素材。**禁止**直接生成节点（避免黑盒模板污染）。

### 5.5 注入审计

每次注入产生 `metric.snapshot` 类 StreamEvent 子条目（在 `metric.snapshot.payload.metrics` 内追加 `reflection_injections.<kind>=N`）；条目本身不展示在 UI 折叠面板中（避免噪声），但落 `runs/<run_id>/metrics.jsonl`。

---

## 6. 隐私与作用域

### 6.1 sensitive 判定

写入条目前，Engine 对 `summary / content / origin_refs` 做"敏感数据探测"：

- 出现 `EvidencePack` 中 `sensitive=true` 的 evidence_id → 整条 sensitive=true
- 出现含 `forbid_remote_for_sensitive=true` 节点的 `origin_refs` 且 content 内含具体业务文本 → sensitive=true
- 触发 `error.budget_exhausted` 风险词（API key 前缀等）→ sensitive=true 并触发 `RH_SECURE_LEAK_BLOCKED`（拒绝写入）

`sensitive=true` → 改写 `secure/reflection_sensitive.encrypted.sqlite`，永不进 Git。

### 6.2 内容脱敏（默认）

非 sensitive 条目落盘前，Engine 必须执行以下脱敏：

- 去除完整邮箱 / 手机号 / 身份证号等显式 PII
- 不嵌入用户具体业务文本超过 200 字符；超出转为"模式签名 + 摘要"形式
- 不存储 EvidencePack 内的 `quote` 原文；只存 `claim` 与 `topic`

### 6.3 项目级 vs 全局级

Phase 1：**仅 `scope=project`**。`scope=global` 字段在 schema 中保留但不启用读写。

Phase 3 计划：用户可"提升"某条项目级条目到全局（需经显式 UI 确认），并强制再过一次脱敏 + 用户审阅。本 spec 暂留位。

---

## 7. 与 ModelProfile.performance_profile 的反馈

### 7.1 周期聚合

每 30 分钟（或 ≥10 条新 `model_performance_signal` 写入时）触发一次聚合：

```
对每个 (model_profile_id, node_type, domain)：
  汇总最近 100 条 signal
  计算 weighted_pass_rate = Σ(window_pass_rate_i * window_size_i) / Σ(window_size_i)
  计算 weighted_avg_attempts 同上
  写回到 ~/.cw/model_profiles.json 对应 profile.performance_profile：
    node_kind_pass_rates[node_type] = weighted_pass_rate
    node_kind_avg_attempts[node_type] = weighted_avg_attempts
    domain_scores[domain] = weighted_pass_rate (覆盖)
    common_failure_types = top-3 from window
    last_evaluated_at = now
```

### 7.2 写回边界

- 写回必须经 `runtime.lock`（与 `runtime_harness.md` D-RH-7 一致）
- 写回失败 → 写 `error.exception` StreamEvent；不退路由决策
- Phase 1 ModelRouter **不消费** `performance_profile`（D-MR-7）；Phase 3 起在 tie_break 中加权使用

### 7.3 用户可见性

UI 在 ModelProfile 配置面板展示当前 `performance_profile` 的聚合视图（只读 + 最近 30 天趋势）；允许用户在该面板"重置该 profile 的 performance_profile"（清零，写回 `{}`）。

---

## 8. 落盘契约（与 `runtime_harness.md` 对齐）

| 文件 | 内容 | Git |
|---|---|---|
| `<project>/.agent-workflow/reflection_memory.jsonl` | 项目级非敏感条目（append + dedup-update） | ✅ |
| `<project>/.agent-workflow/secure/reflection_sensitive.encrypted.sqlite` | 项目级敏感条目（加密） | ❌ |
| `~/.cw/reflection_memory_global.jsonl` | 全局级（Phase 3 启用） | 用户级，不进项目 Git |
| `<project>/.agent-workflow/cache/reflection_index.sqlite` | 倒排索引缓存（按 topic_keys） | ❌ |

### 8.1 写入流程

```
1. acquire(runtime.lock)
2. 计算条目 signature
3. 检查 sensitive 是否成立
4. 如果 sensitive=true → 加密 SQLite upsert
   否则 → reflection_memory.jsonl append-or-update：
     - 命中已有 signature → 读出原行 → 更新计数与时间 → 写回（覆盖原行 / 标 tombstone + append）
     - 未命中 → append
5. 同步更新 reflection_index.sqlite
6. release(runtime.lock)
```

`append-or-update` 实现细节（Phase 1 推荐）：使用"tombstone + append"（在原行末尾打 `_tombstone=true`，再追加新行）。GC 时合并；避免随机写。

---

## 9. GC 与归档

| 触发 | 行为 |
|---|---|
| 默认 90 天保留 | `last_seen_at < now - 90d` 且 `confidence < 0.4` 的条目归档（移到 `cache/reflection_archive.jsonl`，不进 Git） |
| 项目导出（用户操作） | 默认包含项目级非敏感条目；询问用户是否包含敏感条目（默认否） |
| 用户重置 | UI 提供"清空 ReflectionMemory"按钮（per project / per kind / per profile） |

GC 仅由用户主动触发或周期任务（与 D-RH-8 一致）；任何 Engine 内部模块禁止静默删除。

---

## 10. JSON 示例

### 10.1 一条 `patch_pattern`（验证成功 4 次）

```json
{
  "memory_id": "rm_01J9N5XCQA",
  "schema_version": "0.1.0",
  "kind": "patch_pattern",
  "scope": "project",
  "topic_keys": ["addresses_failure_type:logic_gap", "node_type:execution_task", "patch_kind:prompt_patch"],
  "summary": "针对 logic_gap：追加'地理 + 时间 + 指标'三要素约束 + 1 个 few-shot",
  "content": {
    "kind": "patch_pattern",
    "addresses_failure_type": "logic_gap",
    "node_type": "execution_task",
    "patch_kind": "prompt_patch",
    "operations_signature": "ops_8a91b3",
    "operations_summary": "tighten_constraint('问题须含地理/时间/指标三要素') + add_few_shot_example(geographic-temporal-metric)",
    "before_after_metrics": null,
    "recommended_scope": "until_pass"
  },
  "origin_refs": {
    "origin_kind": "repair",
    "patch_id": "rp_01J9N5TC4M",
    "evaluation_id": "evr_01J9N5T9KQ",
    "retried_attempt_id": "att_01J9N5TF11",
    "run_id": "run_01J9N5SXAA",
    "node_id": "n_extract"
  },
  "sample_count": 4,
  "success_count": 4,
  "failure_count": 0,
  "last_seen_at": "2026-06-15T10:21:00Z",
  "first_seen_at": "2026-06-12T09:32:11Z",
  "confidence": 0.8,
  "sensitive": false,
  "disabled": false,
  "tags": ["pattern:over_generalization"],
  "metadata": {}
}
```

### 10.2 一条 `failure_pattern`

```json
{
  "memory_id": "rm_01J9N5XCQB",
  "schema_version": "0.1.0",
  "kind": "failure_pattern",
  "scope": "project",
  "topic_keys": ["failure_type:logic_gap", "node_type:execution_task", "pattern:over_generalization"],
  "summary": "execution_task 输出过于宽泛、缺可证伪边界（n=6）",
  "content": {
    "kind": "failure_pattern",
    "node_type": "execution_task",
    "failure_type": "logic_gap",
    "severity": "blocker",
    "signature": "fp_8a91...",
    "typical_findings": [
      {"kind": "rubric_violation", "path": "$.research_questions[*].question", "severity": "blocker"}
    ],
    "domain_hints": ["research_paper"]
  },
  "origin_refs": {
    "origin_kind": "evaluation",
    "evaluation_id": "evr_01J9N5T9KQ",
    "run_id": "run_01J9N5SXAA",
    "node_id": "n_extract",
    "attempt_id": "att_01J9N5T1QC"
  },
  "sample_count": 6,
  "success_count": 0,
  "failure_count": 0,
  "last_seen_at": "2026-06-15T10:21:00Z",
  "first_seen_at": "2026-06-10T14:11:20Z",
  "confidence": 0.0,
  "sensitive": false,
  "disabled": false,
  "tags": [],
  "metadata": {}
}
```

### 10.3 一条 `model_performance_signal`

```json
{
  "memory_id": "rm_01J9N5XCQC",
  "schema_version": "0.1.0",
  "kind": "model_performance_signal",
  "scope": "project",
  "topic_keys": ["model_profile:claude-sonnet-default", "node_type:execution_task"],
  "summary": "claude-sonnet-default 在 execution_task 上的最近 20 次窗口 pass=0.85",
  "content": {
    "kind": "model_performance_signal",
    "model_profile_id": "claude-sonnet-default",
    "node_type": "execution_task",
    "domain": "research_paper",
    "pass_rate_window": 0.85,
    "avg_attempts_window": 1.4,
    "common_failure_types": ["logic_gap", "missing_evidence"],
    "evidence_window_size": 20
  },
  "origin_refs": {"origin_kind": "attempt_completed", "attempt_id": "att_01J9N5TFFF", "run_id": "run_01J9N5SXAA", "node_id": "n_extract"},
  "sample_count": 20,
  "success_count": 17,
  "failure_count": 3,
  "last_seen_at": "2026-06-15T10:30:00Z",
  "first_seen_at": "2026-06-10T08:00:00Z",
  "confidence": 0.85,
  "sensitive": false,
  "disabled": false,
  "tags": [],
  "metadata": {}
}
```

---

## 11. 错误码

| 错误码 | 阶段 | 含义 |
|---|---|---|
| `RM_WRITE_NO_ORIGIN` | write | `origin_refs` 缺失或不可解析 |
| `RM_WRITE_PATCH_NOT_VERIFIED` | write | patch_pattern 写入但 retried_attempt_id 不存在或未完成 |
| `RM_WRITE_SENSITIVE_TO_PLAIN` | write | sensitive=true 条目尝试写 jsonl（实现错误） |
| `RM_WRITE_LEAKED_PII` | write | 内容含未脱敏 PII，被前置校验拦截 |
| `RM_WRITE_DEDUP_RACE` | write | 同 signature 并发写入冲突 |
| `RM_INDEX_CORRUPT` | read | 倒排索引损坏（cache），需重建 |
| `RM_LOOKUP_INVALID_REQUEST` | lookup | 检索参数非法 |
| `RM_GLOBAL_SCOPE_NOT_ENABLED` | write/lookup | Phase 1 global 域被调用 |
| `RM_AGGREGATE_LOCK_TIMEOUT` | aggregate | 周期聚合未取到 runtime.lock |
| `RM_PROFILE_WRITE_BLOCKED` | aggregate | 写回 ~/.cw/model_profiles.json 失败 |

---

## 12. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-RM-1 | 6 类 ReflectionKind 固定（`failure_pattern / patch_pattern / prompt_pattern / evidence_pattern / node_template_seed / model_performance_signal`），不允许新增 kind 至 v0.2 |
| D-RM-2 | 任何条目必须含 `origin_refs`；无法溯源的条目禁止写入 |
| D-RM-3 | `patch_pattern` 必须等到"下一次 attempt 完成"才写入或更新；不允许"修复刚生成"就视为成功 |
| D-RM-4 | `prompt_pattern / evidence_pattern` 必须满足 ≥3 次跨 Run 一次通过的稳定门槛才落 jsonl |
| D-RM-5 | `sensitive=true` 条目改写 `secure/reflection_sensitive.encrypted.sqlite`；非 sensitive 条目落盘前强制脱敏（去 PII / 不嵌入业务文本超 200 字符 / 不存原文 quote） |
| D-RM-6 | Phase 1 仅启用 `scope=project`；`scope=global` 留位但写读均拒绝 |
| D-RM-7 | ReflectionMemory 注入到 ContextPack 时仅作为 `instruction_addendum`，priority 默认 normal，required=false；不允许覆盖节点级 required=true 片段 |
| D-RM-8 | confidence 衰减：`last_seen_at < now - 90d` 时每 30 天乘 0.8 |
| D-RM-9 | Phase 1 ModelRouter **不消费** performance_profile；仅采集（与 D-MR-7 一致） |
| D-RM-10 | 用户可显式禁用任意条目（`disabled=true`）；禁用后从检索结果剔除，但保留以便恢复 |
| D-RM-11 | 写入流程必须经 `runtime.lock`；append-or-update 推荐"tombstone + append"，避免随机写 |
| D-RM-12 | GC 仅由用户或周期任务触发；Engine 不得静默删除 |

---

## 13. 与未来 spec 的桥接

- `protocols/context_builder.md`（待）：详细 instruction_addendum 的注入位置与与 token 预算的协调
- `protocols/evidence_builder.md`（待）：evidence_pattern 在新 EvidencePack 构建时的复用规则
- `protocols/observability.md`（待）：聚合管线 OTel span 命名（`cw.reflection.aggregate`）
- CW-Bench（独立 spec 待）：把 ReflectionMemory 命中率纳入评测维度
- Phase 4 团队共享：定义 `scope=global` 的写读条件、跨项目脱敏二审、用户审阅流程

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-RM-1 ~ D-RM-12；对齐 00_Concept §5.8 / §6 与技术架构 v1.0 §3 / §5.2 / §12.2；与 `evaluation_result.md` / `repair_patch.md` / `context_pack.md` / `model_router.md` / `runtime_harness.md` 一致 |
