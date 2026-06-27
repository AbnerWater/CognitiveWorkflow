# Spec: Runtime Harness（项目运行时目录契约）

| 字段          | 值                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec ID       | `cw-spec-runtime-001`                                                                                                                                                                                                            |
| Version       | `0.1.0`                                                                                                                                                                                                                          |
| Status        | Accepted                                                                                                                                                                                                                         |
| Owners        | CW Architecture                                                                                                                                                                                                                  |
| Last updated  | 2026-06-27                                                                                                                                                                                                                       |
| Baseline 引用 | 00_Concept §6（Workflow 项目记忆与执行状态记录）；技术架构 v1.0 §4（架构层）/ §13（安全、权限、隐私）；UIUX v1.1 §15.2（推荐项目目录结构）/ FR-011（新建项目）/ FR-012（Git 自动初始化）/ FR-015（版本快照）/ FR-017（节点产物） |
| 关联 spec     | 全部已锁定 schema spec（被引用为落盘对象）+ `schemas/runtime_actions.md` + `state_machines/planning_session.md` + `protocols/agent_adapter.md`                                                                                   |
| 关联 ADR      | ADR-0007（持久化分层）、ADR-0008（StreamEvent）、ADR-0006（Electron）、ADR-0011（Runtime Flow Desktop Actions Contract）                                                                                                         |

> **范围**：定义 CW 在用户工程根目录下自动生成的运行时目录 `.agent-workflow/`，以及它与 `references/` / `outputs/` 等用户可见目录的关系——把前面 9 份 spec 中的所有对象**落到具体文件路径**、约束**字段是 JSON 还是 JSONL**、规定**哪些进 Git、哪些只进缓存**、定义**Git 自动行为**与**多窗口锁**。
>
> **非范围**：
>
> - Electron 安装目录与 sidecar 二进制的位置（属于 `apps/desktop/` 打包契约）
> - SQLite 内部 schema 的具体表结构（属于实现细节，本 spec 仅约定边界）
> - Workflow 模板 / Skill / MCP Server 全局注册表的位置（属于"用户级配置"，跨项目，由 `~/.cw/` 管理；与本 spec 无关）
>
> **核心立场**：
>
> - **文件即真理**（D-CP-1 / D-WG-6 一致）：以 `*.json / *.jsonl` 为权威；SQLite 仅作为索引/查询缓存；缓存损坏时可由 manifest 完整重建。
> - **Git diff 必须可读**：所有进 Git 的文件保持稳定字段顺序、稳定 hash 选择、不嵌入时间戳到 hash、不持久化 sensitive 数据到 jsonl（D-SE-5）。
> - **跨平台 + 跨窗口可恢复**：每个目录的写入路径都必须明确"原子性"与"锁"行为，避免多窗口 / 多进程同时写造成 manifest 漂移。

---

## 0. 设计原则

1. **三层职责分离**：
   - 文件 manifest（与用户共享、Git 跟踪）= 与用户的契约
   - SQLite（运行时索引、加密 sensitive）= 与 Engine 的契约
   - Git（版本时间机器）= 与历史的契约
2. **JSONL 用于追加流，JSON 用于结构化对象**：attempts / evaluations / repairs / decisions / stream-events / reflection_memory 都是 append-only，用 JSONL；project / workflow.flow / settings / memory 是结构化对象，用 JSON。
3. **稳定字段顺序**：进 Git 的文件序列化时按 schema 字段定义顺序；同 key 的 dict 排序为 alphabetical。
4. **路径以 POSIX 风格记录**：序列化时统一 `/`，运行时由 Engine 翻译为 OS 原生路径；Windows 大小写不敏感、Linux 敏感，避免引入大小写歧义（路径全部小写 + 下划线）。
5. **每个对象只有一处真理**：禁止把同一对象同时写两份"权威副本"（如 NodeAttempt 不能同时存 jsonl 与 SQLite 各自版本不同步）；SQLite 表是 jsonl 的派生视图。
6. **隐私分级落盘**：`sensitivity=sensitive` 数据落加密 SQLite，**不进 jsonl** 也**不进 Git**（D-SE-5）。
7. **GC 显式可控**：默认保留 90 天；用户主动归档 / 清理通过 UI 触发，禁止 Engine 静默删除。
8. **多窗口安全**：项目目录可被多个 Electron 窗口或 CLI 同时打开；写操作必须经"锁文件"互斥；只读操作允许并发。

---

## 1. 顶层目录结构

```
project-root/                                ← 用户工程目录（用户选择 / 新建）
├── .git/                                    ← FR-012 强制初始化；ADR-0007 + 自动 commit/tag
├── .gitignore                               ← CW 在 init 时自动追加 §3.5 一组模式
├── .gitattributes                           ← CW 自动写入 jsonl / lock 行尾规则
├── .agent-workflow/                         ← CW 项目级 Harness（本 spec 的核心范围）
│   ├── project.json                         ← 项目元数据（schema_version / project_id / 创建时间 / settings_ref）
│   ├── settings.json                        ← 用户可见设置（模型偏好 / 并发 / HITL 阈值 / 隐私级别）
│   ├── workflow.flow.json                   ← 当前激活的 WorkflowGraph（FR-015 自动快照对应）
│   ├── workflow_history.json                ← Workflow 版本时间线索引（指向历次 git tag）
│   ├── memory.json                          ← 项目级 Memory（goal / constraints / decisions / preferences / active_workflow_id）
│   ├── reflection_memory.jsonl              ← ReflectionMemory append-only 流
│   ├── references.manifest.json             ← 参考资料注册表（路径 / 启用状态 / hash / chunk 状态）
│   ├── skills.config.json                   ← Skill 启用 + 版本固化
│   ├── mcp.config.json                      ← MCP Server 启用 + 凭证引用（凭证本体不在此处）
│   ├── adapters.config.json                 ← AgentAdapter 启用 / 默认选择 / 配置
│   ├── runs/                                ← 每次 WorkflowRun 一个子目录
│   │   └── <run_id>/
│   │       ├── run.json                     ← Run 元数据（workflow_id / version / mode / state_summary）
│   │       ├── attempts.jsonl               ← NodeAttempt 序列
│   │       ├── evaluations.jsonl            ← EvaluationResult 序列
│   │       ├── repairs.jsonl                ← RepairPatch 序列
│   │       ├── decisions.jsonl              ← Human Checkpoint 决策记录
│   │       ├── context_packs/               ← 各 attempt 的 ContextPack 快照（每条 1 个 .json）
│   │       ├── evidence_packs/              ← 各 attempt 的 EvidencePack 快照
│   │       ├── execution_packs/             ← 各 attempt 的 ExecutionPack 快照
│   │       ├── stream-events/               ← 流式事件持久化
│   │       │   ├── 20260615.jsonl
│   │       │   └── ...
│   │       ├── usage.jsonl                  ← token / cost 增量
│   │       ├── metrics.jsonl                ← metric.snapshot 序列
│   │       ├── skill_lock.json              ← 启用 Skill 的版本锁（D-WG-6）
│   │       └── mcp_lock.json                ← 启用 MCP 的版本锁（D-WG-6）
│   ├── planning_sessions/                   ← 每次 PlanningSession 一个子目录
│   │   └── <session_id>/
│   │       ├── session.json                 ← PlanningSession 顶层（state machine 状态）
│   │       ├── drafts/                      ← 每个版本一个 draft_v<int>.json
│   │       ├── patches.jsonl                ← WorkflowPatchApplication 序列
│   │       ├── validation.jsonl             ← ValidationReport 序列
│   │       └── stream-events.jsonl          ← Planning 阶段的事件流（与 runs/ 分开）
│   ├── artifacts/                           ← 节点产物（中间产物 + 最终产物前置版本）
│   │   ├── index.jsonl                      ← Artifact 索引；每条对应一个文件
│   │   └── <artifact_id>/                   ← 实际文件存放（视 size 决定 inline 还是文件）
│   ├── snapshots/                           ← Git 行为索引（指向 commit/tag）
│   │   └── snapshots.jsonl                  ← snapshot_id ↔ commit_sha ↔ kind ↔ refs
│   ├── traces/                              ← OTel span 落盘（与 stream-events 互补）
│   │   └── trace.sqlite                     ← OTel SQLite Exporter
│   ├── secure/                              ← 加密区（不入 Git，不跨设备）
│   │   ├── stream-events.encrypted.sqlite   ← sensitivity=sensitive 事件
│   │   ├── secrets.encrypted.sqlite         ← 用户凭证 / API key 引用
│   │   └── reflection_sensitive.encrypted.sqlite  ← 含敏感片段的反思记忆
│   ├── cache/                               ← 模型 / Embedding / Context fragment 缓存（不入 Git）
│   │   ├── embeddings.lance/                ← LanceDB
│   │   ├── llm_response_cache.sqlite        ← 可选；按 prompt hash 命中
│   │   └── context_fragment_cache.sqlite    ← ContextPack 片段缓存
│   ├── locks/                               ← 多窗口 / 多进程互斥
│   │   ├── runtime.lock                     ← Engine 进程锁（基于 file lock）
│   │   ├── workflow_editor.lock             ← 编辑器写锁
│   │   └── git.lock                         ← 自动 commit 锁
│   └── manifest_revision.json               ← 各 manifest 的当前 revision，用于一致性校验
├── references/                              ← 用户上传 / 引用的参考资料原文（用户可见）
├── workflow/                                ← （可选）用户保存的 Workflow 模板（用户可见）
├── outputs/                                 ← 最终交付物（FR-015；用户可见）
└── ...                                      ← 用户其它项目内容
```

---

## 2. 顶层 manifest 文件契约

> 仅列字段约束；schema 来源指向已锁定 spec。

### 2.1 `project.json`

| 字段                     | 类型              | 必填 | 说明                                                            |
| ------------------------ | ----------------- | ---- | --------------------------------------------------------------- |
| `schema_version`         | `string`          | ✅   | `0.1.0`                                                         |
| `project_id`             | `string` (ULID)   | ✅   | 项目级唯一                                                      |
| `display_name`           | `string`          | ✅   | 用户可见名                                                      |
| `created_at`             | `string` ISO-8601 | ✅   | —                                                               |
| `cw_version`             | `string` SemVer   | ✅   | 创建该项目时的 CW 版本（用于未来兼容性升级）                    |
| `active_workflow_id`     | `string \| null`  | ❌   | 当前激活 Workflow（指向 `workflow.flow.json` 中的 workflow_id） |
| `settings_ref`           | `string`          | ✅   | 固定 `"settings.json"`                                          |
| `manifest_revisions_ref` | `string`          | ✅   | 固定 `"manifest_revision.json"`                                 |
| `last_opened_at`         | `string` ISO-8601 | ✅   | —                                                               |
| `tags`                   | `string[]`        | ❌   | —                                                               |
| `metadata`               | `object`          | ❌   | 命名空间化扩展字段                                              |

进 Git ✅。

### 2.2 `settings.json`

承载 UI 可调节的项目级设置：

| 类别          | 字段                                                                                                | 说明                              |
| ------------- | --------------------------------------------------------------------------------------------------- | --------------------------------- |
| `models`      | `default_model_profile_id / escalation_chain / forbid_remote_for_sensitive / forbid_provider_kinds` | 与 `WorkflowModelPolicy` 一致字段 |
| `execution`   | `default_mode (step/semi_auto/auto) / max_concurrent_nodes / default_timeout_seconds`               | 与 `ExecutionPolicy`              |
| `review`      | `default_max_retry / escalate_after_repairs / evidence_required_for_factual_outputs`                | 与 `ReviewPolicy`                 |
| `privacy`     | `sensitive_data_mode (strict/loose) / disable_remote_models / encrypt_reflection_memory`            | 控制 §1 加密区行为                |
| `git`         | `auto_commit_enabled / auto_tag_workflow / commit_author_name / commit_email`                       | FR-012 兜底                       |
| `streaming`   | `default_display_level / heartbeat_seconds / cache_ttl_seconds`                                     | 影响 SSE 行为                     |
| `gc`          | `runs_retention_days / artifacts_retention_days / cache_retention_days`                             | 默认 90 / 90 / 30                 |
| `experiments` | `feature_flags: object`                                                                             | 开关，命名空间化                  |

进 Git ✅；变更时同步写入 `manifest_revision.json`。

### 2.3 `workflow.flow.json`

承载当前激活 `WorkflowGraph`（schema 见 `workflow_graph.md`）。

进 Git ✅，每次 Patch 应用都更新；同时在 `workflow_history.json` 留索引。

### 2.4 `workflow_history.json`

| 字段      | 类型                     | 必填 | 说明   |
| --------- | ------------------------ | ---- | ------ |
| `entries` | `WorkflowHistoryEntry[]` | ✅   | 时间序 |

`WorkflowHistoryEntry`：

| 字段                    | 必填 | 说明                      |
| ----------------------- | ---- | ------------------------- |
| `workflow_id`           | ✅   | —                         |
| `version`               | ✅   | SemVer                    |
| `instantiated_at`       | ✅   | —                         |
| `git_commit_sha`        | ✅   | —                         |
| `git_tag`               | ❌   | 例 `workflow-<id>-v0.1.0` |
| `derived_from_draft_id` | ❌   | PlanningSession.draft_id  |
| `change_summary`        | ❌   | 与上一版本的改动摘要      |

进 Git ✅。

### 2.5 `memory.json`（项目级 Memory）

| 字段                 | 类型               | 必填 | 说明                                           |
| -------------------- | ------------------ | ---- | ---------------------------------------------- |
| `schema_version`     | `string`           | ✅   | —                                              |
| `goal`               | `string`           | ✅   | 项目当前总目标                                 |
| `constraints`        | `string[]`         | ❌   | 用户约束（敏感资料 / 输出语言等）              |
| `decisions`          | `MemoryDecision[]` | ❌   | 关键决策（{topic, value, decided_at, reason}） |
| `user_preferences`   | `object`           | ❌   | 模型偏好 / 风格偏好                            |
| `active_workflow_id` | `string \| null`   | ❌   | 与 project.json 一致                           |
| `last_modified_at`   | `string`           | ✅   | —                                              |
| `version`            | `int (≥0)`         | ✅   | 单调递增；每次 memory_task 写入 +1             |
| `metadata`           | `object`           | ❌   | —                                              |

约束：

- **任何写入必须由 `memory_task` 节点或显式 UI 操作触发**（00_Concept §6 / project_overview 立场）；Adapter / Engine 内部模块**禁止**直接写
- 进 Git ✅；每次写入产生 commit `chore(memory): update v<n> — <topic>`

### 2.6 `reflection_memory.jsonl`

每行一条 ReflectionMemory 条目（schema 见后续 `protocols/reflection_memory.md`，本 spec 锁定字段轮廓）：

| 必备字段           | 说明                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| `memory_id`        | ULID                                                                 |
| `node_type`        | execution_task / evaluation_task / repair_task / ...                 |
| `failure_type`     | 8+1 类                                                               |
| `successful_patch` | RepairPatch 摘要                                                     |
| `sample_count`     | 累计成功使用次数                                                     |
| `last_seen_at`     | ISO-8601                                                             |
| `tags`             | string[]                                                             |
| `sensitive`        | bool（true 时改写到 `secure/reflection_sensitive.encrypted.sqlite`） |

进 Git ✅（仅 `sensitive=false` 条目）。

### 2.7 `references.manifest.json`

| 字段                | 类型               | 必填 | 说明                                                                                 |
| ------------------- | ------------------ | ---- | ------------------------------------------------------------------------------------ |
| `entries`           | `ReferenceEntry[]` | ✅   | —                                                                                    |
| `index_snapshot_id` | `string`           | ✅   | LanceDB 索引快照 ID（与 `EvidencePack.provenance.reference_index_snapshot_id` 对齐） |

`ReferenceEntry`：

| 字段                | 必填 | 说明                                                  |
| ------------------- | ---- | ----------------------------------------------------- |
| `reference_id`      | ✅   | —                                                     |
| `path`              | ✅   | 项目相对路径（如 `references/drone_review_2025.pdf`） |
| `kind`              | ✅   | pdf / md / txt / csv / xlsx / image / web_url         |
| `enabled`           | ✅   | 是否参与 EvidenceBuilder 检索                         |
| `source_url`        | ❌   | 网络资料 URL                                          |
| `content_hash`      | ✅   | 文件内容 sha256（小文件） / blake3（大文件）          |
| `chunk_status`      | ✅   | none / chunked / indexed / stale                      |
| `chunk_size_tokens` | ❌   | —                                                     |
| `sensitive`         | ✅   | 影响 EvidencePack `sensitive` 标记                    |
| `imported_at`       | ✅   | —                                                     |

进 Git ✅。

### 2.8 `skills.config.json` / `mcp.config.json` / `adapters.config.json`

均为简单 list-of-objects：

- `skills.config.json`：`[ { skill_id, version, enabled, params } ]`
- `mcp.config.json`：`[ { server_id, transport, command_or_url, enabled, requires_approval, secret_ref } ]`（`secret_ref` 指向 `secure/secrets.encrypted.sqlite` 的条目，本身不含明文）
- `adapters.config.json`：`[ { adapter_id, enabled, default_model_profile_id, capabilities_override?, config } ]`

进 Git ✅；任何字段含明文凭证一律拒绝写入（拦截在 schema 层）。

### 2.9 `manifest_revision.json`

承载所有 manifest 当前版本号，便于跨窗口检测一致性：

```json
{
  "project.json": { "revision": 7, "modified_at": "..." },
  "settings.json": { "revision": 12, "modified_at": "..." },
  "workflow.flow.json": { "revision": 24, "modified_at": "..." },
  "memory.json": { "revision": 5, "modified_at": "..." },
  "references.manifest.json": { "revision": 9, "modified_at": "..." },
  "skills.config.json": { "revision": 2, "modified_at": "..." },
  "mcp.config.json": { "revision": 1, "modified_at": "..." },
  "adapters.config.json": { "revision": 3, "modified_at": "..." }
}
```

进 Git ✅；所有 manifest 写入必须先获取 `runtime.lock`，再原子更新对应 revision，再原子写文件，最后释放锁。

---

## 3. `runs/<run_id>/` 目录契约

### 3.1 `run.json`

| 字段                                                                                      | 类型       | 必填   | 说明                                                                                           |
| ----------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------- |
| `run_id`                                                                                  | ULID       | ✅     | —                                                                                              |
| `workflow_id`                                                                             | ✅         | —      | —                                                                                              |
| `workflow_version`                                                                        | SemVer     | ✅     | —                                                                                              |
| `started_at` / `paused_at` / `resumed_at` / `completed_at` / `failed_at` / `cancelled_at` | ISO-8601   | 视状态 | —                                                                                              |
| `state`                                                                                   | enum       | ✅     | created / ready / running / paused / waiting_user / repairing / completed / cancelled / failed |
| `current_node_ids`                                                                        | `string[]` | ❌     | running / paused 时填                                                                          |
| `last_event_id`                                                                           | string     | ❌     | 用于 SSE 重连                                                                                  |
| `summary_metrics`                                                                         | object     | ❌     | node_pass_rate / avg_attempts / 等聚合                                                         |
| `git_snapshots`                                                                           | `string[]` | ❌     | snapshot_ids                                                                                   |
| `metadata`                                                                                | object     | ❌     | —                                                                                              |

进 Git ✅；高频更新（每节点状态变化）。

### 3.2 `attempts.jsonl`

每行一条 NodeAttempt（schema 来自 AgentAdapter §6 + Engine 包装）：

| 必备字段                                                 | 说明                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `attempt_id / run_id / node_id`                          | —                                                                                    |
| `attempt_index`                                          | int                                                                                  |
| `state`                                                  | AttemptState（PREPARED / RUNNING / AWAITING_HUMAN / COMPLETED / FAILED / CANCELLED） |
| `started_at / finished_at`                               | —                                                                                    |
| `adapter_id / adapter_version`                           | —                                                                                    |
| `model_profile_id`                                       | —                                                                                    |
| `effective_prompt_overlay_ref`                           | 指向 `runs/<run_id>/overlays/<attempt_id>.json`                                      |
| `context_pack_id / evidence_pack_id / execution_pack_id` | —                                                                                    |
| `output_hash / output_artifact_refs`                     | —                                                                                    |
| `usage`                                                  | RunUsage 投影                                                                        |
| `errors`                                                 | AdapterError[] 投影                                                                  |
| `outcome_hash`                                           | —                                                                                    |

进 Git ✅。

### 3.3 `evaluations.jsonl` / `repairs.jsonl` / `decisions.jsonl`

各自存对应 spec 的对象：

- `evaluations.jsonl`：完整 `EvaluationResult`
- `repairs.jsonl`：完整 `RepairPatch` + `applied=true/false`
- `decisions.jsonl`：Human Checkpoint 决策（{ human_node_id, decision, by, decided_at, custom_value? }）

进 Git ✅。

### 3.4 `context_packs/` / `evidence_packs/` / `execution_packs/`

每条 attempt 一份 JSON：

- `context_packs/<context_pack_id>.json`
- `evidence_packs/<evidence_pack_id>.json`
- `execution_packs/<execution_pack_id>.json`

写入约束：

- 单文件 ≤ 4 MiB；超过部分必须 chunked + 在 manifest 中拆分（实现细节）
- Pack 不可变（D-CP-1 / D-EP-1）；写入后只读
- 进 Git ✅（除非 ContextFragment 含 `sensitivity=sensitive`，此时改写 `secure/`）

### 3.5 `stream-events/<yyyymmdd>.jsonl`

每行一条 `StreamEvent`（schema 见 `stream_event.md`）。

约束：

- 同一 run / attempt 内 `seq` 严格单调（D-SE-3）
- `sensitivity=sensitive` 事件**不写本 jsonl**，改写 `secure/stream-events.encrypted.sqlite`
- 文件按日切片；GC 保留 90 天（默认 settings.gc.runs_retention_days）

进 Git ❌（事件流量大，仅本地保留；如要分享 Run，由 UI 触发"导出 Run"产物）。

### 3.6 `instruction-commands.jsonl`（metadata projection）

Runtime 接收 `RuntimeInstructionRequest` 后，可在 run 目录内记录 command metadata projection：

| 字段                                | 说明                                  |
| ----------------------------------- | ------------------------------------- |
| `command_id`                        | RuntimeInstructionAccepted.command_id |
| `run_id / node_id / scope / intent` | 指令路由元数据                        |
| `accepted_at / correlation_id`      | 审计与事件串联                        |
| `instruction_persisted`             | Phase 1 固定为 `false`                |

约束：

- Raw `instruction` 不写入本 jsonl，不进 Git，不进入 renderer snapshot / visual-smoke evidence / runbook evidence / OTel attributes。
- 若后续版本需要持久化 raw instruction，必须先通过新 ADR/spec 定义 encrypted runtime-controlled record，并默认走 `secure/`。

进 Git ✅（metadata-only）。

### 3.7 `usage.jsonl` / `metrics.jsonl`

- `usage.jsonl`：每 5 分钟或每 attempt 完成一条 `{run_id, input_tokens, output_tokens, est_cost_usd?, at}`
- `metrics.jsonl`：每 5 分钟一条 `metric.snapshot`（`stream_event.md` §2.10 投影）

进 Git ✅（小体量、便于复盘）。

### 3.7 `skill_lock.json` / `mcp_lock.json`

记录该 Run 启动时锁定的 Skill / MCP 版本，作为可重放的依据（D-WG-6）：

```json
{
  "skills": [{"skill_id": "research_outline", "version": "1.2.0", "checksum": "..."}],
  "mcps":   [{"server_id": "mcp_local_python", "version": "0.5.1", "tools_snapshot": [...]}]
}
```

进 Git ✅。

### 3.8 `overlays/<attempt_id>.json`

存 RepairPatch 应用产生的 prompt_overlay / context_overlay / evidence_overlay 内容（与 `attempts.jsonl[attempt_id].effective_prompt_overlay_ref` 一对一）。

进 Git ✅。

---

## 4. `planning_sessions/<session_id>/` 目录契约

| 文件                       | 内容                                                                     | Git          |
| -------------------------- | ------------------------------------------------------------------------ | ------------ |
| `session.json`             | `PlanningSession` 顶层（schema 见 `state_machines/planning_session.md`） | ✅           |
| `drafts/draft_v<int>.json` | 每版 `WorkflowDraft`                                                     | ✅           |
| `patches.jsonl`            | `WorkflowPatch` + `WorkflowPatchApplication`                             | ✅           |
| `validation.jsonl`         | `ValidationReport` 序列                                                  | ✅           |
| `stream-events.jsonl`      | Planning 阶段事件流（与 `runs/` 分开）                                   | ❌（仅本地） |

终态（created / cancelled / failed）后，session 子目录保持只读；不允许 mutation。

---

## 5. `artifacts/` 目录契约

`artifacts/index.jsonl` 每行：

| 字段                                    | 必填 | 说明                                                        |
| --------------------------------------- | ---- | ----------------------------------------------------------- |
| `artifact_id`                           | ✅   | ULID                                                        |
| `kind`                                  | ✅   | artifact / pack / evaluation / patch / file / image / chart |
| `produced_by_node_id`                   | ❌   | —                                                           |
| `produced_in_run_id`                    | ❌   | —                                                           |
| `path`                                  | ✅   | 项目相对路径（`artifacts/<artifact_id>/...`）               |
| `mime_type / size_bytes / content_hash` | ✅   | —                                                           |
| `display_name / preview_text`           | ❌   | —                                                           |
| `sensitivity`                           | ✅   | 决定是否进 Git                                              |
| `created_at`                            | ✅   | —                                                           |

约束：

- 二进制文件（图 / 表 / 编译输出）放在 `artifacts/<artifact_id>/`（一个目录便于多文件 artifact）
- 文本类 < 64 KiB 可 inline 在 `index.jsonl` 的 `inline_text` 字段；否则写文件
- Git LFS：默认不启用；如用户启用，CW 把 `artifacts/**` 自动加入 LFS 跟踪规则
- 标记 `sensitivity=sensitive` 的 artifact 永不进 Git；只能落 `secure/`
- Desktop artifact open/download action 只允许记录 `ArtifactActionResult` metadata；不得记录 response body、raw artifact bytes、full absolute destination path、secure path、cache path 或 output directory。

---

## 6. `secure/` 加密区契约

加密策略：

- 加密算法：AES-GCM-256；密钥派生：PBKDF2-HMAC-SHA256（盐为项目 `project_id`）
- 主密钥：来自用户 OS keychain（macOS Keychain / Windows Credential Manager / Linux libsecret）
- `secrets.encrypted.sqlite` 表 `secrets(secret_id PK, alias, value_encrypted, scope, created_at)`
- `stream-events.encrypted.sqlite` 表 `events(...完整 StreamEvent + sensitive_payload_encrypted...)`
- `reflection_sensitive.encrypted.sqlite` 表 `reflections(... 完整 ReflectionMemory ...)`

不入 Git，不跨设备同步。误把加密文件 push 至远端时，CW pre-commit hook 必须拦截（详见 §8.3）。

---

## 7. `cache/` 缓存区契约

| 文件 / 目录                     | 用途                                                     | 约束                                                   |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `embeddings.lance/`             | LanceDB 向量库                                           | 索引可由 references.manifest.json 重建                 |
| `llm_response_cache.sqlite`     | 按 `(model_profile_id, prompt_hash, settings_hash)` 命中 | 默认 30 天 TTL；可在 settings 关闭                     |
| `context_fragment_cache.sqlite` | ContextPack 片段缓存（D-CP §6）                          | TTL 24h；按 `tokenizer + source + transformation` 命中 |

不入 Git；CW 在 `.gitignore` 内自动添加 `.agent-workflow/cache/` 与 `.agent-workflow/secure/`。

---

## 8. Git 自动行为

### 8.1 初始化

新建项目时（FR-011 / FR-012）：

1. 在 `project-root/` 执行 `git init -b main`（如已是 git 仓库则跳过）
2. 写入 `.gitignore`（§3.5）+ `.gitattributes`（§3.6）
3. 写入空 `.agent-workflow/` 骨架（§1）
4. 首次提交：
   ```
   chore(cw): initialize CognitiveWorkflow project <project_id>
   ```
5. 在 `snapshots/snapshots.jsonl` 记录初始 commit

由 Electron 主进程 simple-git 调用（与 [[project_tech_stack_consensus]] 一致）。

### 8.2 自动 commit / tag 触发点

| 触发                                         | commit message 格式                                     | 是否 tag                         |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------- |
| `WorkflowDraft` 实例化为正式 Workflow        | `chore(workflow): instantiate <workflow_id> v<ver>`     | tag `workflow-<id>-v<ver>`       |
| `WorkflowPatch` 应用（草案阶段）             | `chore(planning): apply patch <patch_id> to draft v<n>` | —                                |
| `Workflow` 内手动编辑保存                    | `chore(workflow): manual edit v<ver+0.0.1>`             | tag `workflow-<id>-v<ver+0.0.1>` |
| `RunStarted`                                 | `chore(run): start <run_id> on workflow <id> v<ver>`    | —                                |
| `attempt.completed`（重要节点）              | `snapshot(run/<run_id>): node <node_id> attempt <idx>`  | —                                |
| `human.gate_resolved`                        | `chore(human): decision on <human_node_id> by <user>`   | —                                |
| `repair.patch_applied`                       | `chore(repair): apply <patch_id> on <node_id>`          | —                                |
| `run.completed / run.failed / run.cancelled` | `chore(run): end <run_id> state=<state>`                | tag `run-<run_id>-<state>`       |
| `memory.json` 写入                           | `chore(memory): update v<n> — <topic>`                  | —                                |
| `references.manifest.json` 变更              | `chore(refs): import/enable/disable <reference_id>`     | —                                |

### 8.3 安全约束

CW 安装一个 pre-commit hook（写入 `.git/hooks/pre-commit`，由 Electron 主进程在初始化时安装）：

- 禁止 `secure/**` 进入 commit
- 禁止 `cache/**` 进入 commit
- 禁止任何含 `sk_*` / `ANTHROPIC_API_KEY` 等已知敏感前缀的文本被 commit（简单正则）
- 禁止 `.agent-workflow/**` 之外的 `*.encrypted.sqlite` 文件进入 commit

hook 检测失败时直接 abort commit；Electron 主进程捕获到 abort 后通过 IPC 向用户提示，并在流式输出发出 `error.budget_exhausted`/`error.exception` 事件。

### 8.4 不变量

- CW 自动 commit 时**不修改用户已有的工作区 staged 文件**（先 stash → 自己 commit → unstash）
- 自动 commit 失败（merge conflict / pre-commit hook 失败）时不静默吞掉：必须发出 `error.exception` StreamEvent + UI 提示
- `git config user.name / user.email` 优先读取用户全局；project 级 settings.git.commit_author_name/commit_email 仅作为 fallback

---

## 9. 多窗口 / 多进程并发

### 9.1 锁文件

| 锁文件                       | 类型     | 说明                                                                                  |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `locks/runtime.lock`         | 排他写锁 | 同一时刻仅一个 sidecar 可启动；Electron 主进程在 `child_process.spawn` 之前先 acquire |
| `locks/workflow_editor.lock` | 排他写锁 | 同一时刻仅一个窗口可写 `workflow.flow.json`；其它窗口降级为只读                       |
| `locks/git.lock`             | 排他写锁 | 自动 commit 与用户 git 操作互斥                                                       |

实现：使用 `flock`（POSIX）/ `LockFileEx`（Windows）；每个锁含 `pid + acquired_at + adapter_id`，超过 60s 未续约视为僵尸锁，下次 acquirer 强制清理。

### 9.2 manifest revision 一致性

任意 manifest 写入流程：

```
acquire(runtime.lock)
read manifest_revision.json
read target manifest
mutate
write target manifest
write manifest_revision.json (revision + 1)
release(runtime.lock)
```

读流程不取锁，但必须在使用前比对 `manifest_revision.json` 是否与内存中一致；不一致则 reload。

### 9.3 跨窗口事件

第二个窗口打开同一项目时：

- 自动检测 `runtime.lock` 存活 → 不再启 sidecar，复用已有 sidecar 的端口
- 订阅其它窗口已开启的 SSE
- `workflow_editor.lock` 已被占用 → UI 标记"只读模式"，禁用编辑按钮

---

## 10. GC 与归档

### 10.1 默认保留策略

| 数据                           | 保留时长（天）                        | 控制项                                 |
| ------------------------------ | ------------------------------------- | -------------------------------------- |
| `runs/<run_id>/`               | 90                                    | `settings.gc.runs_retention_days`      |
| `runs/<run_id>/stream-events/` | 90（不超过 runs 自身）                | 同上                                   |
| `artifacts/`                   | 90（最终产物除外）                    | `settings.gc.artifacts_retention_days` |
| `cache/`                       | 30                                    | `settings.gc.cache_retention_days`     |
| `secure/`                      | 与 runs 同步；删除时强制 secure-erase | —                                      |

### 10.2 触发

GC 仅由用户主动触发（`/projects/{id}/gc` API + UI 按钮）；Engine 不静默删除。

### 10.3 归档导出

UI"导出 Run"动作产生 zip：含 `run.json` / `attempts.jsonl` / `evaluations.jsonl` / `repairs.jsonl` / `decisions.jsonl` / `context_packs/` / `evidence_packs/` / `execution_packs/` / `usage.jsonl` / `metrics.jsonl` / `skill_lock.json` / `mcp_lock.json`。**不含** `secure/`。

---

## 11. `.gitignore` / `.gitattributes`

### 11.1 `.gitignore`（CW 自动追加）

```
# CognitiveWorkflow runtime cache & secure
.agent-workflow/cache/
.agent-workflow/secure/
.agent-workflow/locks/
.agent-workflow/traces/

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
```

不覆盖用户已有 `.gitignore`：仅追加缺失行。

### 11.2 `.gitattributes`

```
.agent-workflow/**/*.jsonl    text eol=lf
.agent-workflow/**/*.json     text eol=lf
.agent-workflow/locks/*.lock  binary
```

---

## 12. 跨平台路径与权限

- 所有 manifest 内字段以 POSIX 路径存储
- Engine 写盘时按 OS 翻译；读盘时统一回 POSIX
- 单元路径长度上限：Windows 限制 260 字符 → CW 内部上限 **240 字符**（保留 OS prefix 余量）
- 文件名禁用字符：`/ \ : * ? " < > |`（统一禁用 Windows 集合）
- 行尾：jsonl / json 强制 `\n`（由 `.gitattributes` 保障）
- 编码：UTF-8（无 BOM）

权限：

- `secure/` 设置为用户专属（Windows ACL deny others / POSIX `0700`）
- `locks/` 设置为用户专属（同上）
- 其它 manifest / runs / artifacts 保持默认权限

---

## 13. 错误码

| 错误码                              | 含义                                          |
| ----------------------------------- | --------------------------------------------- |
| `RH_INIT_GIT_FAILED`                | 初始化 git 失败                               |
| `RH_INIT_PRECOMMIT_HOOK_FAILED`     | pre-commit hook 安装失败                      |
| `RH_LOCK_TIMEOUT`                   | 60s 内未取到锁                                |
| `RH_LOCK_STALE_CLEANED`             | 检测到僵尸锁并已清理（warning，非 error）     |
| `RH_MANIFEST_REVISION_MISMATCH`     | 写入时发现 manifest revision 已被其它进程更新 |
| `RH_MEMORY_DIRECT_WRITE_FORBIDDEN`  | 非 memory_task 路径试图写 memory.json         |
| `RH_SECURE_LEAK_BLOCKED`            | pre-commit hook 拦截 secure 文件入 git        |
| `RH_PATH_TOO_LONG`                  | 路径长度超 240                                |
| `RH_PATH_INVALID_CHAR`              | 含 OS 禁用字符                                |
| `RH_GC_RETENTION_INVALID`           | settings.gc.\* 不是合法整数                   |
| `RH_ARCHIVE_EXPORT_INCLUDED_SECURE` | 导出动作误把 secure 文件打包（实现错误）      |
| `RH_GIT_AUTOCOMMIT_BLOCKED`         | 自动 commit 因 hook / merge conflict 失败     |
| `RH_RUN_DIR_CORRUPTED`              | runs/<run_id>/ 关键文件缺失（如 run.json）    |

---

## 14. 已锁定设计决策

| 序号    | 决策                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| D-RH-1  | 三层职责分离：manifest（Git） / SQLite（运行时索引 + secure） / Git（时间机器）；任何对象只有一处真理                  |
| D-RH-2  | 仅 `memory_task` 节点或显式 UI 操作可写 `memory.json`；其它路径禁止写                                                  |
| D-RH-3  | `sensitivity=sensitive` 数据走 `secure/`，永不进 Git，永不跨设备同步                                                   |
| D-RH-4  | 多窗口复用同一 sidecar（`runtime.lock` 互斥）；编辑器写权由 `workflow_editor.lock` 决定，其它窗口降级只读              |
| D-RH-5  | 自动 commit 必须 stash → commit → unstash；不修改用户工作区 staged 状态                                                |
| D-RH-6  | pre-commit hook 强制拦截 `secure/**` / `cache/**` / 已知敏感前缀；hook 失败不静默                                      |
| D-RH-7  | 所有 manifest 写入采用"获取锁 → 比对 revision → 写入 → revision +1 → 释放锁"原子流程                                   |
| D-RH-8  | GC 仅由用户主动触发；Engine 不静默删除任何数据                                                                         |
| D-RH-9  | 路径以 POSIX 风格存储；运行时翻译；上限 240 字符                                                                       |
| D-RH-10 | `runs/<run_id>/stream-events/` 不进 Git；导出 Run 由 UI 按需打包 zip                                                   |
| D-RH-11 | `references / outputs / workflow` 是用户可见目录；`.agent-workflow / .git / locks / cache / secure` 是 CW 内部目录     |
| D-RH-12 | jsonl 单文件大小不强约束（按日切片）；超大单条 record 必须改走 artifact_refs（与 D-SE-4 一致）                         |
| D-RH-13 | Runtime instruction command 只持久化 metadata projection；raw instruction 若需持久化必须先定义 encrypted secure record |
| D-RH-14 | Desktop artifact action result 只持久化 sanitized metadata；artifact body 和 destination path 不进入 harness records   |

---

## 15. 与未来 spec 的桥接

- `protocols/model_router.md`（待）：ModelProfile 注册位置（默认 `~/.cw/model_profiles.json`，跨项目；项目级覆盖在 `settings.json.models`）
- `protocols/reflection_memory.md`（待）：补全 `reflection_memory.jsonl` 的精确 schema
- `protocols/observability.md`（待）：`traces/trace.sqlite` 的 OTel exporter 表 schema
- `protocols/context_builder.md` / `evidence_builder.md`（待）：构建过程产生的 cache 命中 / 失效逻辑

---

## 更新历史

| 日期       | 版本  | 变更                                                                                             |
| ---------- | ----- | ------------------------------------------------------------------------------------------------ |
| 2026-06-27 | 0.1.0 | ADR-0011 accepted 后补充 RuntimeInstruction 与 ArtifactAction 的 runtime harness 元数据边界      |
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-RH-1 ~ D-RH-12；对齐 UIUX v1.1 §15.2 / FR-011/012/015/017 与全部已锁定 schema spec |
