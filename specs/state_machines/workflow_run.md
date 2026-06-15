# Spec: WorkflowRun & Node Lifecycle State Machines

| 字段 | 值 |
|---|---|
| Spec ID | `cw-spec-state-002` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| Baseline 引用 | 技术架构 v1.0 §11.1（WorkflowRun 状态机）/ §11.2（Node 状态机）/ §11.3（异常处理原则）；UIUX v1.1 §11.1（节点生命周期）/ §11.2（执行模式）/ §11.3（核心交互流程） |
| 关联 spec | `specs/schemas/workflow_graph.md`、`specs/schemas/node_contract.md`、`specs/schemas/evaluation_result.md`、`specs/schemas/repair_patch.md`、`specs/schemas/stream_event.md`、`specs/protocols/agent_adapter.md`、`specs/protocols/model_router.md`、`specs/protocols/observability.md`、`specs/runtime_harness.md`、`specs/state_machines/planning_session.md`、`specs/failure_taxonomy.md` |
| 关联 ADR | ADR-0002、ADR-0004（LangGraph 内核）、ADR-0008、ADR-0009 |

> **范围**：定义两个紧耦合的状态机：
> 1. **WorkflowRun**：一次 Workflow 执行的全生命周期（与技术架构 §11.1 对齐 + 工程必要扩展）
> 2. **Node**（节点 Attempt 视角）：单节点在一次 Run 内的状态轨迹（与 UIUX §11.1 + 技术架构 §11.2 对齐）
>
> **非范围**：
> - PlanningSession 状态机（已锁定 `state_machines/planning_session.md`）
> - PlanningSession 中 PlannerAgent 等子 Agent 的内部 attempt 生命周期（复用本 spec Node 状态机，但 run 维度由 PlanningSession 接管）
> - 单节点内 attempt 内部的细粒度模型回合（属 Pydantic AI `_agent_graph` 内部，由 AgentAdapter 转译为 StreamEvent）
>
> **核心立场**：
> - 状态机**显式可枚举 + 迁移触发可枚举**；不允许实现层引入"中间态"
> - 任何迁移**必须**产生 OTel span event + StreamEvent（与 D-OB-1 一致）
> - 取消 / 暂停 / 失败 / 完成都有**确定的清理路径**；不允许"悄悄进入终态"
> - 与 LangGraph checkpointer 协调，但**LangGraph 不是真理**——CW 自身的 jsonl 才是；LangGraph checkpointer 是恢复加速器

---

## 0. 设计原则

1. **双状态机分层**：WorkflowRun 是宏观（每次 Run 一份）；Node 是微观（每个节点 / 每次 attempt）；二者通过"节点状态变化驱动 Run 状态变化"耦合。
2. **状态枚举封闭**：本 spec 之外不允许新增状态；新增需 ADR。
3. **触发器枚举**：每个迁移由"触发器名 + 必要条件"驱动，禁止隐式状态切换。
4. **终态吸收**：`completed / cancelled / failed` 是吸收态；进入后不可重启；用户重跑 = 创建新 Run。
5. **暂停可恢复**：`paused / waiting_user` 必须保证持久化与 sidecar 重启后可恢复（与 D-RH-1 / D-RH-4 一致）。
6. **与 Compiler / Engine 解耦**：状态机定义不依赖 LangGraph 实现细节；Engine 在 LangGraph 节点函数前后**显式**驱动状态迁移，不依赖 LangGraph 内部生命周期事件。
7. **可观测**：每个状态在 OTel 中对应 `cw.workflow.run` / `cw.workflow.node_execution` span 的 lifecycle event；StreamEvent 走 `node.state_changed / run.*`。

---

## 1. WorkflowRun 状态机

### 1.1 状态枚举

```
created
  │
  ▼
ready ──────┐
  │         │
  ▼         │
running ◄───┤ (节点新一轮 attempt 开始)
  │         │
  ├─► paused ─────► running          (用户暂停 / 恢复)
  ├─► waiting_user ─► running        (Human Checkpoint 决策)
  ├─► repairing ──► running          (RepairPatch 应用并准备重试)
  │
  ▼
completed
  ▼
cancelled
  ▼
failed
```

### 1.2 状态卡片

| status | 含义 | 是否阻塞用户输入 | 用户可见操作 | 持久化义务 | 可达后继 |
|---|---|---|---|---|---|
| `created` | 已创建但未启动；通常瞬态（创建即下一刻进入 ready） | 否 | — | run.json 写入；不进 Git | `ready / cancelled` |
| `ready` | 已编译完成、可执行；等待"开始运行"信号或自动进入 running | 视 ExecutionPolicy.mode | step / semi_auto 模式下等待用户点"开始"；auto 模式自动进入 running | run.json 更新 | `running / cancelled / failed` |
| `running` | 至少一个节点处于 ready/running/validating/reviewing；Engine 正在驱动 | 否（流式输出可见） | 暂停 / 取消 / 节点级单步 | 高频更新 run.json + attempts.jsonl + stream-events | `paused / waiting_user / repairing / completed / cancelled / failed` |
| `paused` | 用户主动暂停；当前 attempt 完整结束后停止；不再启动新 attempt | 是 | 恢复 / 取消 | run.json 持久 + checkpoint 标记 | `running / cancelled` |
| `waiting_user` | 命中 Human Checkpoint；等待用户决策 | 是 | 提交决策 / 取消 / 编辑产物 | run.json + decisions.jsonl 写入 pending 决策 | `running / cancelled` |
| `repairing` | RepairPatch 应用中（同步阶段；通常 < 数秒）；不等同于 Node 的 repairing | 否 | 取消 | run.json 维持 + repairs.jsonl 写入 | `running / cancelled / failed` |
| `completed` | 所有 terminal 节点到达；产物已归档 | — | — | 终态写入 + git tag `run-<run_id>-completed` | 终态 |
| `cancelled` | 用户主动取消 / 闲置超时 / 系统强制 | — | — | 终态写入 + git tag `run-<run_id>-cancelled` | 终态 |
| `failed` | 不可恢复错误（节点失败 + ExecutionPolicy.on_node_failure=stop / Adapter 不可用 / 资源耗尽） | — | 查看失败诊断 / 创建新 Run | 终态写入 + git tag `run-<run_id>-failed` | 终态 |

> 与技术架构 §11.1 比对：本 spec 增补 `repairing` 顶层 Run 状态（架构 docx 用 `failed_recoverable -> repairing -> running` 表述；本 spec 直接命名为 `repairing` 顶层状态）。

### 1.3 不变量

- Run 同时只能处于一个状态（无并发态）
- 进入 `paused / waiting_user / repairing` 时 `current_node_ids` 不为空
- 进入 `completed` 时所有 terminal 节点 = `WorkflowGraph.terminal_node_ids` 全部 `passed`
- 终态进入后不可逆；任何 mutation API 返回 `409`
- `ExecutionPolicy.on_node_failure=human` 时，节点 failed 不直接导致 Run failed；先尝试 human_checkpoint
- `ExecutionPolicy.on_node_failure=stop` 时，节点 failed 立即触发 Run failed（保留状态可恢复）

### 1.4 迁移触发器

| 来源 | 触发器 | 目标 | 必要条件 / 副作用 |
|---|---|---|---|
| `created` | `run.start` | `ready` | Compiler 编译完成 + 4 级校验通过 |
| `ready` | `run.auto_start` | `running` | `ExecutionPolicy.mode=auto` 且当前无外部阻塞 |
| `ready` | `user.start` | `running` | step / semi_auto 下用户点"开始" |
| `running` | `node.entered_waiting_user` | `waiting_user` | 至少一个节点进入 `waiting_user` |
| `running` | `node.entered_repairing` | `repairing` | RepairAgent 产 patch 进入应用阶段 |
| `running` | `user.pause` | `paused` | 用户点"暂停"；正在跑的 attempt 完整结束后停止 |
| `running` | `system.idle_timeout` | `paused` | 默认 30min 无任何节点活动 |
| `running` | `all_terminals_passed` | `completed` | 所有 terminal 节点 passed |
| `running` | `node.failed.on_failure_stop` | `failed` | 节点 failed 且 `on_node_failure=stop` |
| `running` | `model_router.escalation_exhausted` | `failed`（自动转向 `waiting_user` 后用户再决定） | 升级链耗尽且无 human_checkpoint 节点 |
| `running` | `user.cancel` | `cancelled` | 用户点"取消" |
| `paused` | `user.resume` | `running` | 用户点"恢复" |
| `paused` | `user.cancel` | `cancelled` | — |
| `waiting_user` | `decision.resolved` | `running` | 用户提交 Human Decision；Decision 写入 decisions.jsonl |
| `waiting_user` | `decision.timeout` | 视 `human_gate.timeout_action` | `hold` 不变；`fallback` → `running`（按 fallback decision）；`abort` → `cancelled` |
| `waiting_user` | `user.cancel` | `cancelled` | — |
| `repairing` | `patch.applied` | `running` | RepairPatch 应用完成；目标节点准备下次 attempt |
| `repairing` | `patch.rejected_to_human` | `waiting_user` | Patch 校验失败降级 human_checkpoint |
| `repairing` | `user.cancel` | `cancelled` | — |
| `repairing` | `internal.error` | `failed` | 应用过程不可恢复异常 |

### 1.5 与 ExecutionPolicy.mode 的关系

| mode | created→ready | ready→running | 节点完成 → 下个节点 |
|---|---|---|---|
| `step` | 自动 | 用户每次点"下一节点"才推进 | 每节点完成后 Run 暂停回 `paused`，等用户继续 |
| `semi_auto` | 自动 | 用户点"开始"后进入 running | 自动推进；评价节点 / 高风险节点暂停为 `waiting_user` |
| `auto` | 自动 | 自动 | 全自动；只有 escalate / human_checkpoint 才暂停 |

> 切换 mode 仅在 `ready / paused` 状态下允许；其它状态下变更 mode 返回 `409 STATE_FORBIDDEN_TRANSITION`。

---

## 2. Node 状态机

### 2.1 状态枚举（与 UIUX §11.1 + 技术架构 §11.2 对齐）

```
idle ──► ready ──► running ──► validating ──► reviewing ──┬─► passed
                                                           ├─► review_failed ──► repairing ──► retrying ──► running
                                                           └─► waiting_user
                                       ▲                                       │
                                       └───────────────────────────────────────┘
                                              (waiting_user → running)

任意态 ──► skipped (条件分支跳过)
任意态 ──► failed   (执行异常)
任意态 ──► cancelled (Run 被取消)
```

### 2.2 状态卡片

| state | 含义 | 允许操作 | 进入条件 | 持久化义务 |
|---|---|---|---|---|
| `idle` | 未开始；上游未就绪 | — | 默认初始 | run.json |
| `ready` | 入边全部满足；等待 Engine 调度 | 编辑节点配置（仅 paused Run）/ 单步执行 | 上游 `passed`（按入边类型） | run.json 更新 current_node_ids |
| `running` | Adapter 正在执行 attempt | 暂停 / 取消 / 查看流式输出 | Engine 调度 + RoutingDecision 完成 | attempts.jsonl 写入新 attempt PREPARED→RUNNING |
| `validating` | 输出 schema 程序化校验中（< 数秒） | 查看校验结果 | Adapter 返回 candidate output | — |
| `reviewing` | 评价 Task 运行中（仅当节点有关联 evaluation_task） | 查看审查进度 | 上游 execution 完成 | evaluations.jsonl 中开始 |
| `passed` | 评价通过 / 无评价节点直接通过 | 查看产物 | EvaluationResult.passed=true 或不需要评价 | attempts.jsonl 标 COMPLETED + evaluations.jsonl 写完 |
| `review_failed` | 评价未通过 | 修复 / 重试 / 人工 | EvaluationResult.passed=false | evaluations.jsonl 写完 |
| `repairing` | RepairAgent 正在生成 / 应用 Patch | 查看 Patch / 取消修复 | RecommendedAction=repair_with_patch | repairs.jsonl 写入 PATCH 记录 |
| `retrying` | 已应用 Patch；准备重启 attempt | — | RepairPatch.applied=true | overlays/<attempt_id>.json 写入 |
| `waiting_user` | 节点触发 Human Checkpoint | 用户决策 | RecommendedAction=human_checkpoint 或 ApprovalRequired | decisions.jsonl 写 pending |
| `skipped` | 条件分支跳过 / `optional` 边未启用 | 查看跳过原因 | edge.optional=true 且 condition=false | run.json 标记 |
| `failed` | 工具 / Adapter 异常导致 attempt fail，且不在评价/修复路径中 | 查看错误 / 重试 / 人工 | AdapterError 不可恢复 | attempts.jsonl 标 FAILED + errors |
| `cancelled` | Run 被取消，节点跟随 | — | Run 进入 cancelled | attempts.jsonl 标 CANCELLED |

### 2.3 不变量

- 节点同时只能处于一个 state
- `passed / failed / skipped / cancelled` 是节点终态；进入后该 attempt 不再修改；下次重试 = 新 attempt（attempt_index +1）
- `running / validating / reviewing / repairing` 期间持有 Adapter handle 或 Engine 内部锁
- `waiting_user` 期间不消耗 Adapter handle（已被 cancel 或 deferred）
- `retrying` 是瞬态（< 数百毫秒）；下一刻进入 `running`

### 2.4 迁移触发器（关键）

| 来源 | 触发器 | 目标 | 必要条件 / 副作用 |
|---|---|---|---|
| `idle` | `upstream.satisfied` | `ready` | 所有入边来源节点为 `passed`（按 edge.type 计算） |
| `ready` | `engine.schedule` | `running` | RoutingDecision 完成 + ExecutionPack 装填 |
| `running` | `adapter.first_output` | `running`（无变） | 仅产生 StreamEvent，不变 state |
| `running` | `adapter.completed` | `validating` | Adapter.run() 迭代结束 + finalize() 返回 |
| `validating` | `output_validator.passed` | `reviewing` 或 `passed` | 节点关联 evaluation_task → `reviewing`；否则直接 `passed` |
| `validating` | `output_validator.failed` | `review_failed` | 程序化校验失败（属 format_error / missing_output） |
| `reviewing` | `evaluation.passed` | `passed` | EvaluationResult.passed=true |
| `reviewing` | `evaluation.failed` | `review_failed` | EvaluationResult.passed=false |
| `review_failed` | `recommended_action.repair_with_patch` | `repairing` | EvaluationResult.recommended_action 推荐修复 |
| `review_failed` | `recommended_action.human_checkpoint` | `waiting_user` | — |
| `review_failed` | `recommended_action.retry_same` | `retrying` | 仅 `request_evidence` 场景在 EvidencePack 重建后 |
| `review_failed` | `escalate_after_repairs.exceeded` | `waiting_user` | 累计 repair 次数超 ReviewPolicy.escalate_after_repairs |
| `repairing` | `patch.applied` | `retrying` | Patch 应用成功 |
| `repairing` | `patch.rejected_to_human` | `waiting_user` | 3 道防线校验失败 |
| `retrying` | `engine.schedule` | `running` | 启动新 attempt（attempt_index+1） |
| `running` | `adapter.failed` | `failed` 或 `review_failed` | AdapterError(retryable=false) → `failed`；retryable=true 走 retry_policy |
| `running` | `adapter.cancelled` | `cancelled` | Run 取消导致 |
| `waiting_user` | `decision.resolved` | 视 decision routing | `continue` → `running` (新 attempt) / `reject` → `failed` / `edit` → `retrying`（携带 user_edit Resumption） |
| `waiting_user` | `decision.timeout.fallback` | `running` | 按 fallback decision |
| `waiting_user` | `decision.timeout.abort` | `cancelled` | — |
| 任意态 | `edge.optional.skipped` | `skipped` | 当节点是某 optional 边目标且 condition=false |
| 任意态 | `run.cancelled` | `cancelled` | Run 进入 cancelled，所有非终态节点跟随 |

### 2.5 重试 / Attempt 计数

- 每次 `running → ...` 循环走完一个 attempt（attempts.jsonl 一行）
- `attempt_index` 从 0 开始，每次进入 `running`（不论是首次还是 retrying 后）+1
- 同节点最大 attempt 数 = `NodeContract.retry_policy.max_attempts`（默认 3）
- 超过 → 按 D-FT-4 / D-NC-6 进入 `waiting_user`（不直接 `failed`）

### 2.6 与 AgentAdapter handle 状态映射

| Node state | AgentAdapter `AttemptState` |
|---|---|
| `running` | `RUNNING`（含 `PREPARED → RUNNING` 内部过渡） |
| `waiting_user` | `AWAITING_HUMAN`（仅当 HITL 由 ApprovalRequiredToolset 触发；非 evaluation 路径） |
| `passed` | `COMPLETED` |
| `failed` | `FAILED` |
| `cancelled` | `CANCELLED` |

> `validating / reviewing / repairing / retrying` 在 Adapter 视角已是 attempt 之外的 Engine 状态；Adapter handle 在节点进入这些 state 之前已 finalize。

---

## 3. WorkflowRun ↔ Node 状态联动

### 3.1 联动矩阵

| 节点状态变化 | Run 状态影响 |
|---|---|
| 任一节点 `running` | Run `ready → running`（若仍在 ready） |
| 任一节点 `waiting_user` | Run `running → waiting_user` |
| 任一节点 `repairing` | Run `running → repairing` |
| 全部节点退出 `waiting_user / repairing` 且至少一个继续推进 | Run 回到 `running` |
| 所有 terminal 节点 `passed` | Run `running → completed` |
| 任一节点 `failed` 且 `on_node_failure=stop` | Run `running → failed` |
| 任一节点 `failed` 且 `on_node_failure=human` | 节点 → `waiting_user`（Engine 自动注入），Run → `waiting_user` |
| 任一节点 `failed` 且 `on_node_failure=continue_safe_branches` | 跳过下游、Run 继续 `running`；最终未达 terminals → `failed` |

### 3.2 并发与多节点

- `WorkflowGraph.execution_policy.max_concurrent_nodes` 决定同时处于 `running` 的节点上限（Phase 1 默认 1）
- 多节点并发时，Run 状态取"最弱状态"：任一节点 `waiting_user` → Run `waiting_user`；否则任一 `repairing` → Run `repairing`；否则任一 `running` → Run `running`
- 优先级（高 → 低）：`waiting_user > repairing > running > paused > ready`

---

## 4. Checkpoint 与恢复

### 4.1 Checkpoint 时机

| 时机 | 写入内容 |
|---|---|
| Run 进入 `paused / waiting_user` | run.json 完整快照 + 当前 LangGraph state checkpoint（cache/lg_checkpointer.sqlite） |
| 节点 attempt `COMPLETED / FAILED / CANCELLED` | attempts.jsonl 行 + run.json `current_node_ids` 更新 |
| `RepairPatch.applied` | repairs.jsonl 行 + overlays/<attempt_id>.json |
| `Decision.resolved` | decisions.jsonl 行 |
| 每 30s 周期心跳 | run.json `last_heartbeat_at` 更新（即使 running 中无显式状态变化） |

### 4.2 恢复流程

sidecar 重启 / 用户重新打开项目时：

```
1. 加载 .agent-workflow/runs/<run_id>/run.json
2. 检查 state ∈ {running, paused, waiting_user, repairing}：
   running → 转为 paused（不允许"自动继续"——必须用户显式恢复，避免幽灵推进）
   paused / waiting_user / repairing → 保持
3. 重建 LangGraph state（从 cache/lg_checkpointer.sqlite）
4. 发出 system.runtime_ready + run.resumed StreamEvent（携带 last_event_id）
5. 等待用户操作或自动推进
```

> 强约束：`running` 状态在 sidecar 重启后**必须**降级为 `paused`，由用户决定是否继续。这是为了避免"幽灵推进"——即用户没看见的情况下 attempt 仍在 spawn。

### 4.3 LangGraph checkpointer 边界

- LangGraph 内部 checkpoint 是恢复加速器；CW 自身的 jsonl 是真理（D-RH-1）
- 若 LangGraph checkpoint 损坏 / 不一致 → 丢弃 checkpoint，仅按 jsonl 重建（Engine 在节点级别重启即可）
- LangGraph checkpoint 不进 Git（仅在 cache/）

---

## 5. 取消 / 暂停 / 失败 的清理路径

### 5.1 取消（cancel）

```
user.cancel
  │
  ▼
Engine.run_orchestrator.cancel():
  1. 标 Run.state=cancelling（瞬态，不暴露给前端，仅用于内部）
  2. 对所有当前 active AttemptHandle 调用 AgentAdapter.cancel()（必须 ≤5s 退出，D-AA-6）
  3. 等待所有 handle 进入 CANCELLED（超时 5s 强制 release）
  4. 写 attempts.jsonl 中相关行 state=CANCELLED
  5. 写 run.json state=cancelled + cancelled_at
  6. 触发 git tag run-<run_id>-cancelled
  7. 发出 StreamEvent: run.cancelled / attempt.cancelled
  8. 释放 runtime.lock 中持有的 attempt 引用
```

### 5.2 暂停（pause）

```
user.pause
  │
  ▼
Engine.run_orchestrator.pause():
  1. 标 Run.state=pausing（瞬态）
  2. 不取消正在跑的 attempt；等其完整结束
  3. 不再启动新 attempt
  4. 当前 attempt 完成后写 run.json state=paused + paused_at
  5. 写 LangGraph checkpoint
  6. 发出 StreamEvent: run.paused
```

> "暂停 = 不取消当前 + 不启动下一个"。这与"取消 = 立即终止全部"是不同语义。

### 5.3 失败（failed）

```
node.failed → Engine 检查 ExecutionPolicy.on_node_failure：
  stop:
    1. 标 Run.state=failed
    2. 对其它 active handle 调用 cancel
    3. 写 run.json state=failed + failed_at + failure_summary
    4. 触发 git tag run-<run_id>-failed
  human:
    1. Engine 自动注入隐式 human_checkpoint
    2. Run → waiting_user
  continue_safe_branches:
    1. 标该节点 failed
    2. 对该节点下游所有节点标 skipped
    3. Run 继续 running；若最终 terminal 未全 passed → failed
```

---

## 6. StreamEvent 投影（与 `stream_event.md` §2.1 / §8 对齐）

### 6.1 Run 状态迁移 → StreamEvent

| 迁移 | StreamEvent.type |
|---|---|
| `created → ready` | （隐式，不发；ready 期短） |
| `ready → running` | `run.started` |
| `running → paused` | `run.paused` |
| `paused → running` | `run.resumed` |
| `running → waiting_user` | `run.paused`（语义统一为暂停）+ `human.gate_required` |
| `waiting_user → running` | `run.resumed` + `human.gate_resolved` |
| `running → repairing` | `run.paused`（语义统一）+ `repair.started` |
| `repairing → running` | `run.resumed` |
| `running → completed` | `run.completed` |
| `任意 → cancelled` | `run.cancelled` |
| `任意 → failed` | `run.failed` |

### 6.2 Node 状态迁移 → StreamEvent

每条 Node 状态迁移**必发** `node.state_changed{from, to, reason?}`。

额外触发：

| 迁移 | 额外 StreamEvent |
|---|---|
| `idle → ready` | — |
| `ready → running` | `attempt.started` |
| `running → validating` | `model.request_completed` 或 `attempt.completed` 内部事件 |
| `validating → reviewing` | `evaluation.started` |
| `reviewing → passed` | `evaluation.completed{passed:true}` + `attempt.completed` |
| `reviewing → review_failed` | `evaluation.completed{passed:false}` |
| `review_failed → repairing` | `repair.started` |
| `repairing → retrying` | `repair.patch_applied` |
| `retrying → running` | `attempt.started`（新 attempt） |
| `* → waiting_user` | `human.gate_required` |
| `waiting_user → running` | `human.gate_resolved` |
| `* → failed` | `attempt.failed` + 视情况 `error.*` |
| `* → skipped` | `node.state_changed`（reason=optional_edge_skipped） |
| `* → cancelled` | `attempt.cancelled` |

---

## 7. 与 PlanningSession 的边界

PlanningSession 与 WorkflowRun 是**两套独立**的状态机：

| 维度 | PlanningSession | WorkflowRun |
|---|---|---|
| 主对象 | `WorkflowDraft` | 已实例化的 `WorkflowGraph` |
| 状态枚举 | 11 个（exploring / understanding / clarifying / planning / validating / previewing / revising / handoff_to_manual_editor / created / cancelled / failed） | 9 个（created / ready / running / paused / waiting_user / repairing / completed / cancelled / failed） |
| 子 Agent | Explorer / Understanding / Clarifier / Planner / Patcher | 节点 contract 定义的 Agent |
| 落盘位置 | `planning_sessions/<session_id>/` | `runs/<run_id>/` |
| StreamEvent 频道 | `/workflow-planning/sessions/{id}/stream` | `/runs/{id}/stream` |
| 终态进入 `created` 后 | 触发实例化为 Workflow（产生新 git commit + tag） | — |

边界：

- PlanningSession `created` ≠ WorkflowRun `created`；前者表示"草案被实例化"，后者表示"Run 对象已建"
- PlanningSession 内部子 Agent 的 attempt 复用 Node 状态机（但不写入 `runs/`，写入 `planning_sessions/<session_id>/stream-events.jsonl`）
- 用户可同时持有多个 PlanningSession，但**同一 Workflow 同一时刻只能有一个 WorkflowRun 处于非终态**（D-WR-9）

---

## 8. WorkflowRun 顶层结构（与 `runtime_harness.md` §3.1 对齐补全）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `run_id` | `string` (ULID) | ✅ | — |
| `workflow_id / workflow_version` | `string / SemVer` | ✅ | — |
| `state` | `RunState` | ✅ | 9 状态枚举 |
| `previous_state` | `RunState \| null` | ❌ | 用于审计与调试 |
| `mode` | `enum: step / semi_auto / auto` | ✅ | — |
| `started_at / paused_at / resumed_at / completed_at / failed_at / cancelled_at` | ISO-8601 | 视状态 | — |
| `last_heartbeat_at` | ISO-8601 | ✅ | 30s 周期；用于幽灵进程检测 |
| `current_node_ids` | `string[]` | ❌ | running / paused / waiting_user / repairing 时填 |
| `last_event_id` | `string` | ❌ | SSE 重连点 |
| `summary_metrics` | `object` | ❌ | 聚合指标（来自 metrics.jsonl） |
| `git_snapshots` | `string[]` | ❌ | snapshot_ids |
| `failure_summary` | `RunFailureSummary \| null` | ❌ | failed 时写入：failure_type / failed_node_id / message / error_code / traceback_id? |
| `cancellation_summary` | `RunCancellationSummary \| null` | ❌ | cancelled 时写入：by / reason / cancelled_at |
| `metadata` | `object` | ❌ | — |

---

## 9. 错误码

| 错误码 | 含义 |
|---|---|
| `WR_STATE_FORBIDDEN_TRANSITION` | 当前 state 不允许该迁移（如 completed → running） |
| `WR_MODE_CHANGE_NOT_ALLOWED_IN_STATE` | 在非 ready / paused 状态下试图改 mode |
| `WR_PAUSE_FAILED_NO_ACTIVE_ATTEMPT` | 调用 pause 时无 active attempt |
| `WR_RESUME_AFTER_TERMINAL` | 调用 resume 时 Run 已是终态 |
| `WR_CANCEL_TIMEOUT_ADAPTER_HANG` | 5s 内 Adapter 未退出（强制 release + warning） |
| `WR_CHECKPOINT_INCONSISTENT` | LangGraph checkpoint 与 jsonl 不一致；已丢弃 checkpoint 走 jsonl 重建 |
| `WR_GHOST_HEARTBEAT_DETECTED` | 启动时发现 last_heartbeat_at 在最近 5 分钟内但 sidecar 不存在 → 强制降级为 paused |
| `WR_CONCURRENT_RUN_FORBIDDEN` | 同一 Workflow 已有非终态 Run |
| `NL_STATE_FORBIDDEN_TRANSITION` | Node 状态机非法迁移 |
| `NL_ATTEMPT_LIMIT_EXCEEDED` | 节点 attempt_index 超过 retry_policy.max_attempts |
| `NL_HANDLE_LEAK` | 节点进入终态但 AdapterHandle 未被 finalize（实现错误） |

---

## 10. 已锁定设计决策

| 序号 | 决策 |
|---|---|
| D-WR-1 | WorkflowRun 9 状态固定（created / ready / running / paused / waiting_user / repairing / completed / cancelled / failed），不允许实现层引入中间态 |
| D-WR-2 | Node 12 状态固定（idle / ready / running / validating / reviewing / passed / review_failed / repairing / retrying / waiting_user / skipped / failed / cancelled），不允许扩充 |
| D-WR-3 | 终态吸收：`completed / cancelled / failed` 一旦进入不可逆；重跑 = 创建新 Run |
| D-WR-4 | `running` 状态在 sidecar 重启后**必须**降级 `paused`（D-WR-7 幽灵进程检测） |
| D-WR-5 | 暂停语义 = 不取消当前 attempt + 不启动下一个；与取消严格区分 |
| D-WR-6 | 取消必须 ≤5s 完成（与 D-AA-6 一致）；Adapter 不退出时强制 release + 写 `WR_CANCEL_TIMEOUT_ADAPTER_HANG` warning |
| D-WR-7 | last_heartbeat_at 最近 5 分钟内但 sidecar 不存在 → 启动时强制降级为 paused（防幽灵推进） |
| D-WR-8 | LangGraph checkpoint 是恢复加速器；CW jsonl 是真理；checkpoint 损坏直接丢弃 |
| D-WR-9 | 同一 Workflow 同一时刻仅允许一个非终态 Run；并发请求返回 `WR_CONCURRENT_RUN_FORBIDDEN`（除非 settings 显式允许 multi-run） |
| D-WR-10 | Node 状态优先级（waiting_user > repairing > running > paused > ready）决定 Run 聚合状态 |
| D-WR-11 | Node 进入终态时必须 finalize Adapter handle；未 finalize 视为 `NL_HANDLE_LEAK` 实现错误 |
| D-WR-12 | mode 切换仅在 ready / paused 状态下允许 |

---

## 11. 与未来 spec 的桥接

- `protocols/observability.md` §3.1 已锁定 `cw.workflow.run / cw.workflow.node_execution / cw.workflow.attempt` 三类 span 与本 spec 状态变化一一对应
- `state_machines/planning_session.md` §1.1 已锁定 PlanningSession 11 状态；与本 spec 通过实例化路径连接
- `protocols/agent_adapter.md` AttemptState（PREPARED / RUNNING / AWAITING_HUMAN / COMPLETED / FAILED / CANCELLED）与本 spec Node state 对应见 §2.6

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿 + 锁定 D-WR-1 ~ D-WR-12；对齐技术架构 v1.0 §11 + UIUX v1.1 §11 + 全部已锁定 spec 中的状态引用 |
