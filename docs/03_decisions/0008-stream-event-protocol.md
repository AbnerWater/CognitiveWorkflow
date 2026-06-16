# ADR-0008: StreamEvent 协议与 AgentStreamEvent 转译

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | 唯一前端事件协议；可重连；隐私分级 |
| Related ADR | ADR-0002、ADR-0006 |
| Related Spec | specs/schemas/stream_event.md |

## 1. 背景与问题

CW 需要一个 renderer 与 Runtime 之间的事件协议。直接透传 Pydantic AI / AG-UI / OpenAI 原始事件会让前端陷入"多 Adapter 多协议"困境。

## 2. 候选方案

1. **直接透传底层事件** — ❌ 多 Adapter 时事件类型不一致
2. **每个 Adapter 自定义事件协议** — ❌ 前端要写 N 套消费器
3. **CW 自有 StreamEvent 协议 + 各 Adapter 转译** — ✅ 前端只认一套；Adapter 转译职责清晰

## 3. 决策

定义 **StreamEvent**（specs/schemas/stream_event.md）作为 CW 与前端之间的唯一事件协议。

- SSE 帧格式固定 `id: / event: / retry: / data:` 四行
- 不使用 WebSocket
- 12 大类 50+ 事件类型（lifecycle / model / tool / context / evaluation / repair / human / planning / artifact / metric / error / system）
- 各 Adapter（Pydantic AI / Claude Code / 等）必须提供 to_stream_events 转译；不允许透传底层
- sensitivity=sensitive 事件走 secure/ 加密 SQLite，不进 jsonl，不跨设备

## 4. 影响

- 正面：前端协议稳定；多 Adapter 不影响 UI
- 负面：每新增 Adapter 必须实现转译表；StreamEvent 类型固定后扩展受限（需通过 spec 修订）
- 后续验证：A6 adapter-conformance-reviewer 检查转译表完整

## 5. 关联

- specs/schemas/stream_event.md
- specs/protocols/agent_adapter.md §5.1
