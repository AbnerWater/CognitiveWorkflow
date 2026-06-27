# Spec: Runtime Actions

| 项             | 值                                                                                     |
| -------------- | -------------------------------------------------------------------------------------- |
| Spec ID        | `cw-spec-runtime-actions-001`                                                          |
| Schema Version | `0.1.0`                                                                                |
| Status         | Accepted                                                                               |
| Date           | 2026-06-27                                                                             |
| Baseline 引用  | UIUX v1.1 FR-008（Chat Box）/ FR-017（节点产物）                                       |
| 关联 spec      | `specs/api/http_sse.md` / `specs/runtime_harness.md` / `specs/schemas/stream_event.md` |
| 关联 ADR       | ADR-0011                                                                               |

> **范围**：定义 Desktop Chat instruction command 与 artifact open/download handoff 的共享 schema。它只锁定请求/响应对象和安全边界；runtime endpoint handler、Electron preload/main handoff、renderer wiring 与 A4 evidence 在后续实现切片完成。

---

## 1. Chat instruction command

### 1.1 `RuntimeInstructionRequest`

用于：

- `POST /cw/v1/runs/{run_id}:submit-instruction`
- `POST /cw/v1/runs/{run_id}/nodes/{node_id}:submit-instruction`

| 字段                | 类型                          | 必填 | 默认      | 说明                                                                                                              |
| ------------------- | ----------------------------- | ---- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `schema_version`    | `"0.1.0"`                     | ✅   | `"0.1.0"` | schema 版本                                                                                                       |
| `scope`             | `enum: run / node`            | ✅   | —         | 指令作用域；endpoint path 仍是权威                                                                                |
| `instruction`       | `string`                      | ✅   | —         | 用户提交给 runtime 的原始指令，仅允许存在于 authenticated runtime request 与 runtime-controlled execution records |
| `intent`            | `enum: ask / revise / repair` | ✅   | —         | 对齐 Desktop Chat Box intent                                                                                      |
| `correlation_id`    | `string?`                     | ❌   | `null`    | 与 StreamEvent / trace 串联的非敏感相关 ID                                                                        |
| `client_command_id` | `string?`                     | ❌   | `null`    | renderer/main 生成的非敏感命令 ID                                                                                 |
| `metadata`          | `object`                      | ❌   | `{}`      | 命名空间化 metadata；不得包含 raw instruction copy                                                                |

### 1.2 `RuntimeInstructionAccepted`

`202 Accepted` 响应体。

| 字段             | 类型                          | 必填 | 默认         | 说明                         |
| ---------------- | ----------------------------- | ---- | ------------ | ---------------------------- |
| `schema_version` | `"0.1.0"`                     | ✅   | `"0.1.0"`    | schema 版本                  |
| `command_id`     | `string`                      | ✅   | —            | runtime 分配的命令 ID        |
| `status`         | `"accepted"`                  | ✅   | `"accepted"` | 只表示已接收，不表示执行完成 |
| `run_id`         | `string`                      | ✅   | —            | path 中的 run                |
| `node_id`        | `string?`                     | ❌   | `null`       | node scope 时来自 path       |
| `scope`          | `enum: run / node`            | ✅   | —            | 与 request scope 一致        |
| `intent`         | `enum: ask / revise / repair` | ✅   | —            | 与 request intent 一致       |
| `accepted_at`    | `ISO-8601 string`             | ✅   | —            | runtime 接收时间             |
| `stream_url`     | `string?`                     | ❌   | `null`       | 对应 run stream              |
| `correlation_id` | `string?`                     | ❌   | `null`       | 透传非敏感相关 ID            |

---

## 2. Artifact action handoff

### 2.1 `ArtifactActionRequest`

Renderer 只能发出 metadata-only action request；artifact body 必须由 Desktop privileged boundary 通过 runtime content endpoint 获取。

| 字段                         | 类型                                  | 必填 | 默认      | 说明                                                                                                    |
| ---------------------------- | ------------------------------------- | ---- | --------- | ------------------------------------------------------------------------------------------------------- |
| `schema_version`             | `"0.1.0"`                             | ✅   | `"0.1.0"` | schema 版本                                                                                             |
| `artifact_id`                | `string`                              | ✅   | —         | Artifact Store ID                                                                                       |
| `action`                     | `enum: open / download`               | ✅   | —         | 用户动作                                                                                                |
| `run_id`                     | `string?`                             | ❌   | `null`    | 关联 run                                                                                                |
| `node_id`                    | `string?`                             | ❌   | `null`    | 关联 node                                                                                               |
| `intent`                     | `enum: ask / revise / repair?`        | ❌   | `null`    | 触发动作的 UI intent                                                                                    |
| `requested_destination_kind` | `enum?`                               | ❌   | `null`    | 只允许 `project_temp / project_artifact / user_selected / native_shell / none` 这类安全分类，不允许路径 |
| `artifact_sensitivity`       | `enum: public / project / sensitive?` | ❌   | `null`    | 来自 artifact metadata                                                                                  |
| `allow_sensitive_export`     | `boolean`                             | ❌   | `false`   | sensitive artifact 写到 user-selected destination 时必须显式为 true                                     |
| `correlation_id`             | `string?`                             | ❌   | `null`    | 非敏感相关 ID                                                                                           |

### 2.2 `ArtifactActionResult`

| 字段               | 类型                                             | 必填 | 默认      | 说明                              |
| ------------------ | ------------------------------------------------ | ---- | --------- | --------------------------------- |
| `schema_version`   | `"0.1.0"`                                        | ✅   | `"0.1.0"` | schema 版本                       |
| `artifact_id`      | `string`                                         | ✅   | —         | Artifact Store ID                 |
| `action`           | `enum: open / download`                          | ✅   | —         | 用户动作                          |
| `status`           | `enum: succeeded / failed / blocked / cancelled` | ✅   | —         | 可观察结果                        |
| `content_type`     | `string?`                                        | ❌   | `null`    | MIME type metadata                |
| `byte_count`       | `int?`                                           | ❌   | `null`    | 字节数 metadata                   |
| `content_hash`     | `string?`                                        | ❌   | `null`    | 内容 hash；不得替代 artifact body |
| `destination_kind` | `enum`                                           | ✅   | —         | sanitized destination kind        |
| `sensitive`        | `boolean`                                        | ❌   | `false`   | 是否涉及 sensitive artifact       |
| `error_code`       | `string?`                                        | ❌   | `null`    | 失败/阻塞时的结构化错误码         |
| `correlation_id`   | `string?`                                        | ❌   | `null`    | 非敏感相关 ID                     |

---

## 3. 安全边界

- Raw `instruction` 不得写入 renderer snapshot、visual-smoke evidence、runbook evidence、OTel attributes、command history 或 review artifact。
- Artifact response body、raw artifact bytes、full absolute destination path、secure path、cache path、output directory、prompt/model output 不得进入 renderer snapshot 或 evidence。
- `GET /cw/v1/artifacts/{artifact_id}/content` 仍是唯一 runtime content source；Desktop open/download 必须通过 preload/main privileged boundary 完成。
- Sensitive artifact 导出到 user-selected destination 必须有显式用户动作，并在 `ArtifactActionRequest.allow_sensitive_export=true` 中体现。

---

## 4. 已锁定设计决策

| 序号   | 决策                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------- |
| D-RA-1 | FR-008 Chat Box 指令必须走 `RuntimeInstructionRequest`，不得复用 FR-007 `run-once`                    |
| D-RA-2 | FR-017 open/download 必须拆分 content retrieval 与 Desktop native handoff                             |
| D-RA-3 | Renderer/证据层只保留 metadata-only result，不保留 raw instruction、artifact body 或 destination path |
| D-RA-4 | 所有派生 TypeScript 类型必须来自 `packages/schemas` codegen                                           |

---

## 更新历史

| 日期       | 版本  | 变更                                                               |
| ---------- | ----- | ------------------------------------------------------------------ |
| 2026-06-27 | 0.1.0 | ADR-0011 accepted 后新增 RuntimeInstruction 与 ArtifactAction 合同 |
