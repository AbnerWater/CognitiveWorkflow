# Spec: HTTP / SSE API 契约

| 字段          | 值                                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec ID       | `cw-spec-api-001`                                                                                                                                                                                                                                                      |
| Version       | `0.1.0`                                                                                                                                                                                                                                                                |
| Status        | Accepted                                                                                                                                                                                                                                                               |
| Owners        | CW Architecture                                                                                                                                                                                                                                                        |
| Last updated  | 2026-06-27                                                                                                                                                                                                                                                             |
| Baseline 引用 | 技术架构 v1.0 §10.2（关键接口建议）/ §10.3（流式输出事件 Schema）；UIUX v1.1 §8（流式输出面板）/ §11.3（核心交互流程）/ §18.11（数据对象与接口补充建议）                                                                                                               |
| 关联 spec     | 全部已锁定 schema spec（被引用为请求 / 响应体）；`specs/schemas/runtime_actions.md`、`specs/protocols/agent_adapter.md`、`specs/protocols/model_router.md`、`specs/protocols/observability.md`、`specs/state_machines/planning_session.md`、`specs/runtime_harness.md` |
| 关联 ADR      | ADR-0006（Electron）、ADR-0008（StreamEvent）、ADR-0009（HITL）、ADR-0011（Runtime Flow Desktop Actions Contract）                                                                                                                                                     |

> **范围**：定义 Electron renderer 与 Python Runtime sidecar 之间的唯一通讯协议——所有 HTTP 端点 + SSE 频道的入参 / 出参 / 错误模型 / 鉴权 / 速率限制。本文是单一权威，与 docx 描述冲突时以本 spec 为准。
>
> **非范围**：
>
> - Electron 主进程 ↔ renderer 的 IPC（属 Electron 内部，由 `apps/desktop/preload` 实现，不在本 spec）
> - 跨设备 / 跨主机部署（CW 运行模式是本机 sidecar，不开放公网；Phase 4 才考虑）
> - WebSocket：CW 不使用（`stream_event.md` D-SE-2 已定型 SSE）
>
> **核心立场**：
>
> - 接口**完整覆盖**已锁定 spec 的所有"对象 → 操作"组合；不允许"前端要的 UI 操作没有对应端点"
> - 接口**不重复造对象**：请求 / 响应体直接复用已定义的 Pydantic 模型，禁止在 API 层引入新的 schema
> - **本机绑定 + 强凭证**：sidecar 仅监听 `127.0.0.1`，端口由主进程随机分配；所有请求带主进程注入的 token，防止其它本机进程调用
> - **SSE 与 HTTP 协议一致**：相同端点的 GET 在 `Accept: text/event-stream` 时降级为 SSE；只在 `/.../stream` 子路径上专用 SSE

---

## 0. 设计原则

1. **资源化命名**：URL 反映对象层级（`/projects/{id}/workflows/{id}/runs/{id}/...`）；动作走子路径或 verb（`/run`、`/pause`、`/resume`、`/cancel`），不滥用 RPC 风格。
2. **JSON-only**：除 SSE 之外，所有请求 / 响应 `Content-Type: application/json; charset=utf-8`；二进制走 `/artifacts/{id}/content`。
3. **`schema_version` 必填**：所有请求 body 第一字段为 `schema_version`，便于未来兼容性升级。
4. **鉴权固定**：`Authorization: Bearer <token>`；token 由主进程 spawn sidecar 时注入并仅在主进程内存中持有，不入磁盘。
5. **失败统一**：错误响应统一 `ErrorEnvelope`，含 `error_code / message / details / cw_failure_type? / retry_after_ms?`。
6. **SSE 一等公民**：每个有"长生命周期"的对象（Run / PlanningSession）都有专属 `/stream` 子端点，使用 `stream_event.md` D-SE-2 定型的帧格式。
7. **Idempotent 优先**：所有 POST 必须支持 `Idempotency-Key` header；同一 key + 同一 body → 同一结果（24h TTL）。
8. **本机直连**：默认 sidecar 监听 `127.0.0.1:<port>`；端口由主进程探活后通过 IPC 告知 renderer；不允许 LAN 暴露。

---

## 1. 通讯总览

### 1.1 端点根

```
http://127.0.0.1:<port>/cw/v1
```

- `<port>` 由主进程 `child_process.spawn` 时通过 `--http-port=N` 注入；优先用 `0`（让 OS 选）后再回读
- 路径前缀 `cw/v1` 固定；未来不兼容变更通过 `cw/v2` 并行运行

### 1.2 鉴权

```
Authorization: Bearer <ephemeral_token>
```

- token 由主进程随机生成（128 位 base64）；spawn 时通过环境变量 `CW_RUNTIME_AUTH_TOKEN` 注入 sidecar
- token 在主进程内存中保存，**不写磁盘 / 不进 Git**
- 每个项目 / 每次 sidecar 启动产生新 token；旧 token 立即失效
- 缺 / 错 token → `401 Unauthorized` `ErrorEnvelope(error_code=AUTH_FORBIDDEN)`

### 1.3 通用 Header

| Header            | 必填            | 说明                                                  |
| ----------------- | --------------- | ----------------------------------------------------- |
| `Authorization`   | ✅              | Bearer token                                          |
| `Content-Type`    | 视方法          | JSON / multipart                                      |
| `Accept`          | ❌              | `application/json` 默认；`text/event-stream` 触发 SSE |
| `Idempotency-Key` | POST/PATCH 推荐 | UUID v4                                               |
| `traceparent`     | ❌              | W3C TraceID 透传（与 `observability.md` 一致）        |
| `X-Project-Id`    | ✅（多项目时）  | 多窗口共用 sidecar 时必填                             |
| `X-Cw-Client`     | ✅              | `electron-renderer / cli / external-mcp`              |

### 1.4 限流

- 单连接默认 200 请求/分钟（含 SSE 心跳 keepalive）
- 单 SSE 订阅默认 500 events/秒（与 `stream_event.md` SE_SSE_RATE_LIMIT 一致）
- 触发限流：`429 Too Many Requests` + `Retry-After`

### 1.5 通用错误模型

```json
{
  "schema_version": "0.1.0",
  "error_code": "WG_L2_DUP_NODE_ID",
  "message": "Duplicate node_id detected: n_extract",
  "details": { "node_id": "n_extract" },
  "cw_failure_type": null,
  "retry_after_ms": null,
  "trace_id": "abc123..."
}
```

HTTP 状态码与 `error_code` 关系：

| HTTP | 范围                       | 例                                   |
| ---- | -------------------------- | ------------------------------------ |
| 400  | 请求格式 / schema 校验失败 | `WG_L1_*`、`NC_L2_*`                 |
| 401  | 鉴权                       | `AUTH_FORBIDDEN`                     |
| 403  | 权限 / Provider 禁用       | `MR_SENSITIVE_DATA_REMOTE_FORBIDDEN` |
| 404  | 资源不存在                 | `RES_NOT_FOUND`                      |
| 409  | 冲突 / revision 漂移       | `RH_MANIFEST_REVISION_MISMATCH`      |
| 410  | 过期资源                   | `RES_GONE`                           |
| 412  | 条件失败                   | `SE_SSE_REPLAY_NOT_FOUND`            |
| 422  | 业务规则失败               | `RP_BUILD_KIND_NOT_ALLOWED`          |
| 423  | 锁冲突                     | `RH_LOCK_TIMEOUT`                    |
| 429  | 限流                       | `RATE_LIMIT_EXCEEDED`                |
| 5xx  | Runtime 内部               | `OB_EXPORT_SQLITE_BUSY` 等           |

---

## 2. 端点总图

```
/cw/v1
├── /system
│   ├── GET    /info                                      → RuntimeInfo
│   ├── GET    /health                                    → HealthStatus
│   ├── GET    /capabilities                              → AdapterCapabilities[]
│   └── POST   /shutdown                                  → 202
│
├── /projects
│   ├── POST   /                                          → 创建项目（FR-011）
│   ├── GET    /{project_id}                              → Project（基于 project.json）
│   ├── PATCH  /{project_id}/settings                     → 更新 settings.json
│   ├── GET    /{project_id}/memory                       → memory.json（只读）
│   ├── POST   /{project_id}/memory:write                 → memory_task 端点（D-RH-2）
│   ├── GET    /{project_id}/references                   → references.manifest.json
│   ├── POST   /{project_id}/references                   → 上传引用资料
│   ├── DELETE /{project_id}/references/{reference_id}
│   ├── PATCH  /{project_id}/references/{reference_id}    → enable / disable
│   ├── GET    /{project_id}/skills                       → skills.config.json
│   ├── PATCH  /{project_id}/skills                       → enable / disable / version
│   ├── GET    /{project_id}/mcps                         → mcp.config.json
│   ├── PATCH  /{project_id}/mcps                         → enable / connect / disable
│   ├── GET    /{project_id}/adapters                     → adapters.config.json
│   └── POST   /{project_id}/gc                           → 触发 GC（D-RH-8）
│
├── /workflow-planning
│   ├── POST   /sessions                                  → 创建 PlanningSession
│   ├── GET    /sessions/{session_id}                     → 全量状态
│   ├── POST   /sessions/{session_id}/messages            → 用户消息（含附件 / 修改意见）
│   ├── POST   /sessions/{session_id}/clarification       → 提交澄清答案
│   ├── GET    /sessions/{session_id}/draft               → 当前 active draft
│   ├── POST   /sessions/{session_id}/patches             → 应用 WorkflowPatch（用户提议）
│   ├── POST   /sessions/{session_id}/instantiate         → 实例化为正式 Workflow
│   ├── POST   /sessions/{session_id}/handoff             → 进入手动编辑器
│   ├── POST   /sessions/{session_id}/cancel              → 取消
│   └── GET    /sessions/{session_id}/stream              → SSE
│
├── /workflows
│   ├── GET    /                                          → 列表（按项目）
│   ├── GET    /{workflow_id}                             → 当前 WorkflowGraph
│   ├── PATCH  /{workflow_id}                             → 整体更新（手动编辑器）
│   ├── POST   /{workflow_id}/validate                    → 4 级校验（不写盘）
│   ├── POST   /{workflow_id}/nodes                       → 添加节点
│   ├── PATCH  /{workflow_id}/nodes/{node_id}             → 更新节点配置
│   ├── DELETE /{workflow_id}/nodes/{node_id}
│   ├── POST   /{workflow_id}/edges                       → 添加边
│   ├── DELETE /{workflow_id}/edges/{edge_id}
│   ├── POST   /{workflow_id}/snapshot                    → 显式 git snapshot
│   ├── GET    /{workflow_id}/history                     → workflow_history.json
│   ├── POST   /{workflow_id}/run                         → 启动新 WorkflowRun
│   ├── POST   /{workflow_id}/pause
│   ├── POST   /{workflow_id}/resume
│   └── POST   /{workflow_id}/cancel
│
├── /runs
│   ├── GET    /                                          → 项目内 Run 列表
│   ├── GET    /{run_id}                                  → run.json
│   ├── GET    /{run_id}/attempts                         → attempts.jsonl 投影
│   ├── GET    /{run_id}/evaluations                      → evaluations.jsonl
│   ├── GET    /{run_id}/repairs                          → repairs.jsonl
│   ├── GET    /{run_id}/decisions                        → decisions.jsonl
│   ├── GET    /{run_id}/usage                            → usage.jsonl 聚合
│   ├── GET    /{run_id}/metrics                          → metrics.jsonl 聚合
│   ├── GET    /{run_id}/routing                          → routing.jsonl
│   ├── GET    /{run_id}/context-packs/{pack_id}          → ContextPack
│   ├── GET    /{run_id}/evidence-packs/{pack_id}         → EvidencePack
│   ├── GET    /{run_id}/execution-packs/{pack_id}        → ExecutionPack
│   ├── POST   /{run_id}:submit-instruction               → Chat 指令（run scope，FR-008）
│   ├── POST   /{run_id}/nodes/{node_id}:submit-instruction → Chat 指令（node scope，FR-008）
│   ├── POST   /{run_id}/nodes/{node_id}:run-once         → 单节点执行（FR-007 单步）
│   ├── POST   /{run_id}/nodes/{node_id}:re-evaluate      → 重新触发评价
│   ├── POST   /{run_id}/nodes/{node_id}:repair           → 触发修复（手动）
│   ├── POST   /{run_id}/decisions                        → 提交 Human Checkpoint 决策
│   ├── POST   /{run_id}/cancel
│   ├── POST   /{run_id}/export                           → 导出 Run zip（D-RH 归档）
│   └── GET    /{run_id}/stream                           → SSE
│
├── /artifacts
│   ├── GET    /{artifact_id}                             → metadata
│   ├── GET    /{artifact_id}/content                     → 二进制 / 文本（按 mime_type）
│   └── DELETE /{artifact_id}                             → 删除（仅非 Git 跟踪）
│
├── /reflection
│   ├── GET    /                                          → reflection_memory.jsonl 投影
│   ├── GET    /{memory_id}
│   ├── PATCH  /{memory_id}                               → enable / disable
│   ├── DELETE /{memory_id}                               → 软删除（落 tombstone）
│   ├── POST   /lookup                                    → 内部 / 调试用
│   └── POST   /aggregate                                 → 强制触发周期聚合
│
└── /observability
    ├── GET    /traces/{trace_id}                         → 完整 span 树
    ├── GET    /traces                                    → 列表（按 run_id / 时间窗）
    ├── GET    /metrics                                   → 当前 metric 快照
    ├── GET    /metrics/{name}                            → 历史时间序列
    └── GET    /runs/{run_id}/stream                      → SSE 别名（与 /runs/{run_id}/stream 等价）
```

> 端点命名说明：动作类用 `:` 分隔（如 `/nodes/{node_id}:run-once`），符合 Google AIP-136；其它资源化操作走 REST verb。

---

## 3. 重点端点详述

### 3.1 `POST /cw/v1/projects`

创建新项目（自动 git init + 写 `.agent-workflow/` 骨架）。

请求：

```json
{
  "schema_version": "0.1.0",
  "display_name": "低空经济无人机交付研究",
  "host_path": "D:/Projects/drone_research",
  "settings_overrides": {
    "models": { "default_model_profile_id": "claude-sonnet-default" },
    "privacy": { "sensitive_data_mode": "strict" }
  }
}
```

响应 `201 Created`：

```json
{
  "schema_version": "0.1.0",
  "project_id": "prj_01J9...",
  "host_path": "D:/Projects/drone_research",
  "git_initialized": true,
  "first_commit_sha": "9a8c7..."
}
```

错误：`RH_INIT_GIT_FAILED / RH_PATH_INVALID_CHAR / RES_ALREADY_EXISTS`。

### 3.2 `POST /cw/v1/workflow-planning/sessions`

请求：

```json
{
  "schema_version": "0.1.0",
  "project_id": "prj_01J9...",
  "user_goal": "梳理低空经济中无人机交付的关键研究问题，并产出一份中文报告草案",
  "inputs": { "...PlanningInputs..." }
}
```

响应 `201 Created`：

```json
{ "schema_version": "0.1.0", "session_id": "ps_01J...", "status": "exploring" }
```

后续状态推进通过：

- `POST /sessions/{id}/messages` 提交对话消息
- `POST /sessions/{id}/clarification` 提交澄清答案
- `GET /sessions/{id}/stream` 监听 `planning.*` 事件

### 3.3 `POST /cw/v1/workflow-planning/sessions/{session_id}/clarification`

提交澄清确认（UIUX §18.5）。

请求：

```json
{
  "schema_version": "0.1.0",
  "question_id": "q_01J9...",
  "answer": {
    "selected_option_key": "weekly_batch",
    "custom_text": null,
    "by": "alice@local"
  }
}
```

响应 `200 OK`：返回更新后的 `PlanningSession`（status 可能变化为 `clarifying / planning`）。

### 3.4 `POST /cw/v1/workflow-planning/sessions/{session_id}/patches`

用户提出修改意见 → 系统生成并应用 `WorkflowPatch`（FR-18-006）。

请求：

```json
{
  "schema_version": "0.1.0",
  "user_revision_text": "在审查节点之后增加一个人工确认节点",
  "scope_hint": "previewing"
}
```

响应 `202 Accepted`：

```json
{
  "schema_version": "0.1.0",
  "patch_id": "wp_01J...",
  "applied_to_draft_version": 3,
  "produced_draft_version": 4,
  "validation_run_id": "vr_01J..."
}
```

> 直接的"二进制 patch ops"由内部使用，不开放给 renderer 直接发送（避免越权）。

### 3.5 `POST /cw/v1/workflows/{workflow_id}/run`

启动一次 WorkflowRun。

请求：

```json
{
  "schema_version": "0.1.0",
  "mode": "semi_auto",
  "initial_input": { "project_goal": "...", "reference_summary": ["..."] },
  "metadata": {}
}
```

响应 `201 Created`：

```json
{
  "schema_version": "0.1.0",
  "run_id": "run_01J...",
  "started_at": "2026-06-15T08:30:00Z",
  "stream_url": "/cw/v1/runs/run_01J.../stream"
}
```

错误：`RH_LOCK_TIMEOUT`（编辑锁未释放）/ `WG_L4_*`（4 级校验未通过）。

### 3.6 `POST /cw/v1/runs/{run_id}/decisions`

提交 Human Checkpoint 决策（与 `agent_adapter.md` `AttemptResumption.kind=human_decision` 对应）。

请求：

```json
{
  "schema_version": "0.1.0",
  "human_node_id": "n_export_approval",
  "decision": "continue",
  "custom_value": null,
  "by": "alice@local"
}
```

响应 `200 OK`：返回 `DecisionRecord`，并触发 SSE 中的 `human.gate_resolved` 事件。

### 3.7 `POST /cw/v1/runs/{run_id}/nodes/{node_id}:repair`

用户手动触发修复（不等评价节点失败）。

请求：

```json
{
  "schema_version": "0.1.0",
  "based_on_evaluation_id": "evr_01J...",
  "preferred_strategy": "prompt_patch",
  "scope": "until_pass"
}
```

响应：返回 RepairPatch + 应用结果（同 `repair.patch_proposed / patch_applied` 事件）。

### 3.8 `POST /cw/v1/runs/{run_id}:submit-instruction`

提交 Chat Box 指令到当前 run 的全局/工作流作用域（FR-008）。该端点不得复用 `run-once`；request/response 由 `specs/schemas/runtime_actions.md` 的 `RuntimeInstructionRequest` / `RuntimeInstructionAccepted` 拥有。

Headers：

- `Authorization: Bearer <ephemeral-token>`
- `X-Project-Id: <project_id>`
- `Idempotency-Key: <uuid-or-command-id>`

请求：

```json
{
  "schema_version": "0.1.0",
  "scope": "run",
  "instruction": "Summarize the current workflow state.",
  "intent": "ask",
  "correlation_id": "corr_chat_01",
  "client_command_id": "cmd_chat_01",
  "metadata": { "cw": { "source": "desktop_chat_box" } }
}
```

响应 `202 Accepted`：

```json
{
  "schema_version": "0.1.0",
  "command_id": "ric_01J...",
  "status": "accepted",
  "run_id": "run_01J...",
  "node_id": null,
  "scope": "run",
  "intent": "ask",
  "accepted_at": "2026-06-27T08:00:00Z",
  "stream_url": "/cw/v1/runs/run_01J.../stream",
  "correlation_id": "corr_chat_01"
}
```

安全边界：raw `instruction` 仅允许存在于 authenticated runtime request 与 runtime-controlled execution records；不得写入 renderer snapshot、visual-smoke evidence、runbook evidence、OTel attributes、command history 或 review artifact。

### 3.9 `POST /cw/v1/runs/{run_id}/nodes/{node_id}:submit-instruction`

提交 Chat Box 指令到当前 node scope。请求体仍为 `RuntimeInstructionRequest`，但 `scope` 必须为 `node`；响应为 `RuntimeInstructionAccepted`，其中 `node_id` 来自 path。

请求：

```json
{
  "schema_version": "0.1.0",
  "scope": "node",
  "instruction": "Repair the selected node using the latest review notes.",
  "intent": "repair",
  "correlation_id": "corr_chat_02",
  "client_command_id": "cmd_chat_02",
  "metadata": { "cw": { "source": "desktop_chat_box" } }
}
```

响应 `202 Accepted`：

```json
{
  "schema_version": "0.1.0",
  "command_id": "ric_01J...",
  "status": "accepted",
  "run_id": "run_01J...",
  "node_id": "n_review",
  "scope": "node",
  "intent": "repair",
  "accepted_at": "2026-06-27T08:00:00Z",
  "stream_url": "/cw/v1/runs/run_01J.../stream",
  "correlation_id": "corr_chat_02"
}
```

### 3.10 `GET /cw/v1/runs/{run_id}/stream`（SSE）

SSE 帧格式（与 `stream_event.md` D-SE-2 一致）：

```
id: evt_01J9N5_tool
event: tool.call_started
retry: 3000
data: {"event_id":"evt_01J9N5_tool","schema_version":"0.1.0","seq":87, ...}

```

支持的查询参数：

```
?level=default                   ← 服务端按 display_level 过滤；逗号分隔多值
?category=lifecycle,model,...    ← 类别过滤
?since_seq=N                     ← 回放区间起点
?until_seq=N                     ← 回放区间终点（用于离线导出）
```

请求 Header `Last-Event-ID: <event_id>` → 重连补播；找不到该 ID → `412` `SE_SSE_REPLAY_NOT_FOUND`。

### 3.11 `GET /cw/v1/observability/traces/{trace_id}`

响应：完整 span 树（按 `start_unix_nano` 排序，父子关系展开）。

```json
{
  "schema_version": "0.1.0",
  "trace_id": "abc123",
  "root_span_id": "span_root",
  "spans": [
    {"span_id":"...","parent_span_id":null,"name":"cw.workflow.run","attributes":{"cw.run.id":"...","cw.workflow.id":"..."}, "events":[...], "start_unix_nano":..., "end_unix_nano":...},
    ...
  ]
}
```

`sensitive` span 默认不返回；调用方携带 header `X-Cw-Sensitive: true` 且当前用户具备权限时返回（Phase 1 简化为本机用户始终允许；Phase 4 引入用户角色后控制）。

---

## 4. 文件与流（multipart / 二进制）

### 4.1 `POST /cw/v1/projects/{project_id}/references`（multipart）

```
Content-Type: multipart/form-data; boundary=----...

------...
Content-Disposition: form-data; name="metadata"
Content-Type: application/json

{"schema_version":"0.1.0", "kind":"pdf", "sensitive":false, "auto_chunk":true}
------...
Content-Disposition: form-data; name="file"; filename="drone_review_2025.pdf"
Content-Type: application/pdf

<binary>
------...--
```

响应：`ReferenceEntry`（写入 `references/` + 触发索引）。

### 4.2 `GET /cw/v1/artifacts/{artifact_id}/content`

- 小文本：`Content-Type` 与 mime 一致
- 大文件：`Content-Type: application/octet-stream`；支持 `Range: bytes=...` 部分请求
- sensitivity=sensitive 的 artifact：仅本机 + token；`X-Cw-Sensitive: true` 标记后允许

### 4.3 Desktop artifact native handoff（FR-017）

Artifact open/download 不是 runtime JSON endpoint。Renderer 只能提交 `specs/schemas/runtime_actions.md` 的 `ArtifactActionRequest` metadata；Electron preload/main 在 privileged Desktop boundary：

1. 使用 runtime token 调用 `GET /cw/v1/artifacts/{artifact_id}/content` 获取内容。
2. `open` 写入/解析 project-scoped temporary file 并调用 native shell。
3. `download` 写入 user-selected 或 project-scoped destination。
4. 返回 `ArtifactActionResult`，只包含 `status / artifact_id / action / content_type / byte_count / content_hash / destination_kind / sensitive / error_code / correlation_id`。

`ArtifactActionResult.destination_kind` 是安全分类，不是路径。Full absolute paths、response bodies、raw artifact bytes、prompt/model output、secure paths、cache paths、output directory values 不得进入 renderer snapshots、visual-smoke evidence、runbook evidence、OTel attributes 或 review artifacts。

---

## 5. SSE 频道分类

CW 提供两个独立 SSE 频道（不允许合并到一个全局频道）：

| 频道     | 端点                                              | 事件子集                                                                                                                                                          |
| -------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run      | `/runs/{run_id}/stream`                           | `run.* / node.* / attempt.* / model.* / tool.* / context.* / evidence.* / evaluation.* / repair.* / human.* / artifact.* / metric.* / error.* / system.heartbeat` |
| Planning | `/workflow-planning/sessions/{session_id}/stream` | `planning.* / system.heartbeat`                                                                                                                                   |

每个频道独立维护 `seq` 计数（`(run_id, attempt_id)` 或 `(session_id)` 作用域）。心跳 15s。

> 不存在"项目级"或"全局"SSE 频道；多窗口多频道由 renderer 自行多订阅（与 D-RH-4 多窗口复用一致）。

---

## 6. Idempotency

```
Idempotency-Key: 9a3c2f1e-...-uuid4
```

服务端缓存 24h；同 key + 同 path 的二次请求：

- body 一致 → 重放上次响应（带 `Idempotent-Replay: true` header）
- body 不一致 → `409 IDEMPOTENCY_KEY_BODY_MISMATCH`

适用于：`/projects/`、`/workflow-planning/sessions/...`、`/workflows/{id}/run`、`/runs/{id}/decisions` 等所有副作用 POST。

---

## 7. 与 Electron 主进程的协作

主进程在 spawn sidecar 时：

1. 生成 `CW_RUNTIME_AUTH_TOKEN`（128 位 base64）
2. 选定监听 `127.0.0.1:0`（OS 选端口）+ `--http-port=0` 让 sidecar 内决定
3. sidecar 启动后 stdout 输出 `READY <port>` → 主进程截获并发 `system.runtime_ready` 事件给 renderer
4. renderer 通过 `window.cw.runtime.connectionInfo()` 拿到 `{base_url, token}` → 直接 `EventSource` / `fetch`

所有 `Authorization` 与 `X-Project-Id` 由 renderer 在构造 fetch 时自带；preload 在每个跨进程调用前自动注入。

---

## 8. CORS / 安全

- sidecar 默认 **关闭** CORS（仅本机回环）
- `X-Frame-Options: DENY`、`Content-Security-Policy: default-src 'none'`、`X-Content-Type-Options: nosniff`
- 拒绝 `Origin: http://...` 中包含外部域；只接受 `http://127.0.0.1:<own_port>` 或 Electron 内的 `app://...`

---

## 9. 错误码总表（API 层新增；与各 spec 错误码合并）

| API 错误码                             | HTTP | 含义                                                   |
| -------------------------------------- | ---- | ------------------------------------------------------ |
| `AUTH_FORBIDDEN`                       | 401  | 缺 / 错 token                                          |
| `RES_NOT_FOUND`                        | 404  | 资源不存在（项目 / Workflow / Run / Artifact / Trace） |
| `RES_ALREADY_EXISTS`                   | 409  | 同名资源已存在                                         |
| `RES_GONE`                             | 410  | 资源已 GC                                              |
| `RATE_LIMIT_EXCEEDED`                  | 429  | 触发限流                                               |
| `IDEMPOTENCY_KEY_BODY_MISMATCH`        | 409  | 同 key 不同 body                                       |
| `IDEMPOTENCY_KEY_REUSE_OUTSIDE_WINDOW` | 409  | TTL 外重用                                             |
| `BAD_PROJECT_ID`                       | 400  | `X-Project-Id` 不存在或与端点不匹配                    |
| `SHUTDOWN_IN_PROGRESS`                 | 503  | sidecar 正在停机                                       |
| `MULTIPART_TOO_LARGE`                  | 413  | 上传超过 settings 大小限制                             |
| `BAD_RANGE`                            | 416  | 二进制 Range 越界                                      |

> 业务错误码（`WG_*` / `NC_*` / `CP_*` / `EP_*` / `ER_*` / `RP_*` / `SE_*` / `MR_*` / `RM_*` / `CB_*` / `EB_*` / `OB_*` / `RH_*` / `PS_*`）继承自各 spec，原样沿用。

---

## 10. 速率限制详细

| 维度               | 默认                                       |
| ------------------ | ------------------------------------------ |
| 单连接 HTTP 请求   | 200/分钟                                   |
| 单 SSE 订阅 events | 500/秒（与 `stream_event.md` 一致）        |
| 单 token 并发连接  | 64                                         |
| 单 token 上传体积  | settings.api.max_upload_mb（默认 200 MiB） |

超限时响应 `429 Too Many Requests` + `Retry-After: <seconds>`。

---

## 11. 版本与兼容性

- `/cw/v1` 前缀冻结；不兼容变更通过 `/cw/v2` 并存
- 请求 body 缺 `schema_version` → `400 SCHEMA_VERSION_MISSING`
- `schema_version` 高于服务端支持 → `400 SCHEMA_VERSION_NOT_SUPPORTED`（建议客户端降级）
- 响应 body `schema_version` 必填，与请求中的最大兼容版本对齐

---

## 12. JSON 示例：完整 SSE 帧序列（节选）

```
:cw heartbeat
id: evt_run_started
event: run.started
retry: 3000
data: {"event_id":"evt_run_started","schema_version":"0.1.0","seq":1,"run_id":"run_01J","node_id":null,"attempt_id":null,"type":"run.started","category":"lifecycle","phase":"run.started","title":"Run 已启动","summary":null,"content":null,"payload":{"workflow_id":"wf_01J","workflow_version":"0.1.0","mode":"semi_auto"},"display_level":"default","severity":"info","sensitivity":"project","expandable":false,"created_at":"2026-06-15T08:30:00.001Z","metadata":{}}

id: evt_attempt_started
event: attempt.started
retry: 3000
data: {"event_id":"evt_attempt_started","schema_version":"0.1.0","seq":2,"parent_event_id":null,"run_id":"run_01J","node_id":"n_extract","attempt_id":"att_01J","type":"attempt.started","category":"lifecycle","phase":"attempt.started","title":"开始 Attempt #0","summary":"模型 claude-sonnet-default","payload":{"attempt_index":0,"model_profile_id":"claude-sonnet-default"}, ...}

id: evt_tool_call
event: tool.call_started
retry: 3000
data: {"event_id":"evt_tool_call","schema_version":"0.1.0","seq":7,"parent_event_id":null,"run_id":"run_01J","node_id":"n_extract","attempt_id":"att_01J","type":"tool.call_started","category":"tool","phase":"attempt.tool_calling", ...}
```

---

## 13. 已锁定设计决策

| 序号     | 决策                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D-API-1  | sidecar 仅监听 `127.0.0.1`；端口由 OS 分配，主进程通过 IPC 告知 renderer；不允许 LAN 暴露                                         |
| D-API-2  | 鉴权使用主进程内存中的 ephemeral Bearer token；不入磁盘，不跨进程持久                                                             |
| D-API-3  | API 层不引入新 schema；所有 body 直接复用已锁定 spec 的 Pydantic 模型                                                             |
| D-API-4  | URL 命名采用资源化 + `:action` 子路径（AIP-136），不滥用 RPC                                                                      |
| D-API-5  | 所有副作用 POST 必须支持 `Idempotency-Key`，TTL 24h                                                                               |
| D-API-6  | SSE 帧格式与 `stream_event.md` D-SE-2 一致；CW 不使用 WebSocket                                                                   |
| D-API-7  | 仅有两个 SSE 频道：`/runs/{id}/stream` 与 `/workflow-planning/sessions/{id}/stream`；不存在全局频道                               |
| D-API-8  | 错误响应统一 `ErrorEnvelope`；业务错误码继承自各 spec，HTTP 状态码按 §1.5 表映射                                                  |
| D-API-9  | `X-Project-Id` header 在多窗口共享 sidecar 时必填；缺失 → 400                                                                     |
| D-API-10 | API 不直接接收 RepairPatch / WorkflowPatch ops 数组（仅内部）；用户走 `/patches` 端点提交修改意见，由 PatchAgent 生成 ops         |
| D-API-11 | 二进制 / 大文件走 `/artifacts/{id}/content` 与 multipart 上传；JSON 端点 body 不嵌入二进制                                        |
| D-API-12 | `/cw/v1` 前缀冻结，不兼容变更通过 `/cw/v2` 并存                                                                                   |
| D-API-13 | FR-008 Chat instruction 必须走 `RuntimeInstructionRequest`；不得复用 FR-007 `run-once` 或在 API 层 ad hoc 增加 body               |
| D-API-14 | FR-017 artifact open/download 必须经 Desktop preload/main native handoff；runtime content endpoint 只提供 artifact content source |

---

## 14. 与未来 spec 的桥接

- `specs/api/openapi.yaml`（待）：本 spec 的机器可读 OpenAPI 3.1 规范，自动从 Pydantic 模型生成
- `specs/api/asyncapi.yaml`（待）：SSE 频道的 AsyncAPI 2.6 规范
- `specs/security/auth.md`（待，Phase 4）：用户角色 / 团队协作 / 远端部署的完整鉴权方案
- `specs/security/csp.md`（待）：Electron renderer CSP 详细策略

---

## 更新历史

| 日期       | 版本  | 变更                                                                                       |
| ---------- | ----- | ------------------------------------------------------------------------------------------ |
| 2026-06-27 | 0.1.0 | ADR-0011 accepted 后新增 Chat instruction endpoints 与 Desktop artifact handoff contract   |
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-API-1 ~ D-API-12；对齐技术架构 v1.0 §10 + UIUX v1.1 §18.11 + 全部已锁定 spec |
