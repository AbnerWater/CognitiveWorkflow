# CognitiveWorkflow 工程实施路线图与质量门

| 字段 | 值 |
|---|---|
| 文档 ID | `cw-doc-roadmap-001` |
| Version | `0.1.0` |
| Status | Accepted |
| Owners | CW Architecture |
| Last updated | 2026-06-15 |
| 关联 | `specs/`（全部 18 份 Accepted spec） |

> **目的**：作为 Phase 0 完成至 Phase 4 上线的"工程治理单一权威"。本文回答四个问题：现在做到了什么、下一步做什么、每个阶段的出口标准是什么、谁来独立审查并放行。
>
> **读者**：CW 全体工程团队、独立审查 Agent、Phase 晋级评审会议。
>
> **版本控制**：Phase 之间出口标准的任何调整必须通过 ADR 流程，不得在本文档内"软改"。

---

## 1. 当前项目状态盘点（截至 2026-06-15）

### 1.1 已完成产出

CW 项目第一阶段已完成的工作可分为四类：

**1）三份基线设计文档**（项目根目录，docx + md 形式）：

- `00_Concept.md` — 产品理念
- `AI_Agent_Workflow_技术架构设计说明书_v1.0.docx`
- `AI_Agent_Workflow工作台_UIUX详细设计规范与需求规格说明书_v1.1_新增Workflow编排.docx`

**2）18 份 Accepted Spec**（`specs/` 目录）：

```
specs/
├── failure_taxonomy.md                                    (Accepted v0.1.0)  顶层汇总
├── schemas/
│   ├── workflow_graph.md / node_contract.md
│   ├── context_pack.md / evidence_pack.md
│   ├── evaluation_result.md / repair_patch.md
│   └── stream_event.md
├── protocols/
│   ├── agent_adapter.md / model_router.md
│   ├── reflection_memory.md
│   ├── context_builder.md / evidence_builder.md
│   └── observability.md
├── state_machines/
│   ├── planning_session.md
│   └── workflow_run.md
├── api/
│   └── http_sse.md
└── runtime_harness.md
```

每份 spec 都已锁定关键决策（D-WG-* / D-NC-* / ... / D-FT-* / D-WR-*）合计 130+ 条。

**3）项目仓库基础设施**（项目根）：

- `.gitignore` 已写
- `README.md` 已写
- `git init` 待用户在本机执行（cowork VM 挂载层限制；命令已就绪）
- `pydantic-ai/` 仓库参考代码已 clone

**4）跨会话项目记忆**（Claude 持久存储）：

- `MEMORY.md` 索引 + 9 份记忆文件
- 涵盖用户角色、产品定位、设计基线、技术选型共识、路线图、Pydantic AI 映射、回复风格反馈、本地资源索引

### 1.2 关键技术选型（已锁定，不再讨论）

详见跨会话记忆 `project_tech_stack_consensus.md`，要点：

- 桌面 Shell：**Electron 35.x**（Forge + Vite + electron-builder）+ React + TypeScript + React Flow
- Runtime：**Python 3.10+**（FastAPI + Pydantic v2 + asyncio）+ **PyInstaller one-file** sidecar
- 图调度内核：**LangGraph** + 自研 Cognitive Workflow 编译器
- 基础 chat agent：**Pydantic AI**（pydantic-ai-slim）
- 模型 Provider：**LiteLLM**（pydantic-ai 已内置 `LiteLLMProvider`）
- 多 Agent 适配：**自研 AgentAdapter 协议**（PydanticAI / ClaudeCode / Codex / Hermes / LiteLLM 五类）
- 持久化：**SQLite（+sqlcipher）+ JSON Manifest + Git via simple-git**
- 向量库：**LanceDB**；Embedding：**bge-m3 / nomic-embed-text**
- 观测：**OpenTelemetry + 本地 SQLite Exporter**
- 评测：**pydantic_evals + 自研 CW-Bench**

### 1.3 第一阶段（Phase 0 协议化）出口确认

第一阶段的核心目标——"在不写产品代码的前提下，把全部对象 / 协议 / 状态机 / 落盘 / API 协议化"——**已达成**。验收依据：

- 全部 18 份 spec 状态 Accepted
- 跨 spec 引用闭环（无 dangling reference）
- 8+1 类失败 / 17 套错误码命名空间 已统一索引（`failure_taxonomy.md` §7）
- 130+ 条已锁定设计决策可被反查

> **已具备进入 Phase 1 的前提**。

---

## 2. 阶段总览

```
Phase 0  (已完成)  ─►  Phase 1  ─►  Phase 2  ─►  Phase 3  ─►  Phase 4
协议化              MVP 闭环      自动规划      MCCL 强化     生态化
                    + 多 Agent    + 草案编辑    + 多 Adapter   + 团队 / 模板
```

| Phase | 主题 | 估时 | 门槛 |
|---|---|---|---|
| **0** | 协议化（已完成） | 完成于 2026-06-15 | 18 份 spec Accepted |
| **1** | MVP 闭环：单流程 Plan-Act-Review-Repair | 8–10 周 | 端到端 demo + 32 条 MUST 全达标 |
| **2** | 自动规划 + 草案编辑 | 6–8 周 | UIUX §18 全章 + FR-18-001~012 全达标 |
| **3** | MCCL 强化 + 多 Adapter | 8 周 | 跨模型对齐 ≥95% + Repair 3 次内通过率 ≥80% |
| **4** | 团队化 / 模板化 / 生态 | 6 周+ | 模板市场 + 协作 + CLI + 公开 release |

每个 Phase 在**独立审查 Agent 全部 PASS**之前不得进入下一阶段。

---

## 3. 独立审查 Agent 矩阵

每个 Phase 在出口前必须经过 **5 类独立审查 Agent**（部分 Phase 增加专项 Agent）。"独立"指：

- 与实施 Agent / 工程师**不共享 ContextPack / 不共享对话历史**
- 仅以 Spec + 代码 + 测试报告 + 运行 artifacts 为输入
- 必须能回查所引用的 ADR / Spec 章节

### 3.1 5 类标准审查 Agent

| Agent ID | 审查域 | 输入 | 输出 |
|---|---|---|---|
| **A1 · spec-conformance-reviewer** | 代码与 spec 的字段级 / 错误码 / 状态枚举一致性；禁止 spec 之外的 schema 漂移 | 仓库源码 + `specs/` 全集 + Phase 实施任务清单 | `ConformanceReport`：每条 spec → 实现文件映射 + 不一致点列表 |
| **A2 · contract-test-runner** | 契约测试覆盖率：每条 spec 错误码 / 状态迁移 / 决策点至少一条测试 | 仓库源码 + `tests/` + spec 错误码总索引 | `ContractTestReport`：错误码覆盖率 / 状态迁移覆盖率 / gap 列表 |
| **A3 · security-auditor** | 隐私 / 凭证 / sensitive 数据边界；pre-commit hook；CSP / Auth；PII 脱敏 | 仓库源码 + `runtime_harness.md` + `observability.md` + `api/http_sse.md` + 一次完整运行的 traces / stream-events | `SecurityAuditReport`：高危项（必须修复）/ 中危项（必须计划修复）/ 低危项 |
| **A4 · ux-acceptance-reviewer** | UI 行为与 UIUX v1.1 + FR 编号对齐；P1~P7 设计原则；可访问性基础 | UIUX docx + Electron 构建产物 + 录制的端到端用户路径 | `UxAcceptanceReport`：FR 验收清单 + 偏差项 |
| **A5 · evals-runner**（自 Phase 1 末启用） | CW-Bench 任务集回归；目标指标 vs 阈值 | CW-Bench 任务集 + 目标 ModelProfile 集合 + 一次完整执行 | `EvalsReport`：每任务 pass / 关键指标 / 趋势对比 |

### 3.2 专项审查 Agent（按需启用）

| Agent ID | 启用阶段 | 审查域 |
|---|---|---|
| **A6 · adapter-conformance-reviewer** | Phase 1 / Phase 3 | 每个 AgentAdapter 实现是否满足 `agent_adapter.md` 协议；capabilities() 声明与实测能力一致；StreamEvent 转译表无遗漏 |
| **A7 · failure-taxonomy-auditor** | Phase 1 末 / Phase 3 末 | 实运行中触发的失败是否能 1:1 归到 `failure_taxonomy.md` 8+1 类；`unknown` 比例 ≤5% |
| **A8 · git-history-auditor** | Phase 1 / Phase 4 | Git commit 行为符合 `runtime_harness.md` §8.2 表；pre-commit hook 拦截敏感数据 |
| **A9 · cross-platform-validator** | Phase 1 末 / Phase 4 | macOS / Windows / Linux 三平台 Electron + sidecar 启动 / 退出 / 自更新行为 |
| **A10 · template-marketplace-reviewer** | Phase 4 | 模板上架 / 共享 / 版本约束 |

### 3.3 独立审查的约束（共同）

- 每个 Agent 必须给出 **PASS / CONDITIONAL_PASS / FAIL** 之一的明确结论
- `CONDITIONAL_PASS` 必须列出"可在 N 个工作日内完成的 follow-up 项"清单；超期未补则降级 FAIL
- `FAIL` 的报告必须给出"修复建议方向"（不必给出具体代码）
- 报告写入 `docs/reviews/phase{N}/<agent_id>-<yyyymmdd>.md`，进 Git
- 任意 Agent FAIL → Phase 不得晋级

### 3.4 阶段晋级会议

每个 Phase 出口前必须召开晋级会议，以 5+ 类审查 Agent 的报告为输入，**全员 PASS** 才允许：

- 打 Phase release tag（如 `v0.1.0-phase1`）
- 更新 `docs/roadmap.md` 中 Phase 状态
- 启动下一 Phase 的工程任务

---

## 4. Phase 0 · 协议化（已完成 ✅）

### 4.1 实际产出

- 18 份 Accepted Spec（见 §1.1）
- 130+ 锁定决策
- 跨会话项目记忆 9 条

### 4.2 出口标准（已达成）

| 编号 | 标准 | 状态 |
|---|---|---|
| EXIT-P0-1 | 全部 18 份 spec 状态 = Accepted | ✅ |
| EXIT-P0-2 | spec 之间无 dangling reference（每个 "待" 引用都已落地或明确推迟到具体 Phase） | ✅（部分前向引用如 `tools/citation_checker.md` 推迟到 Phase 1 末） |
| EXIT-P0-3 | 全部 8+1 类 FailureType + 17 套错误码命名空间 已统一索引 | ✅ |
| EXIT-P0-4 | 跨会话项目记忆 ≥ 9 条且包含技术选型 / 路线图 / Pydantic AI 映射 | ✅ |
| EXIT-P0-5 | 用户已锁定关键技术选型（Electron / Pydantic AI / LangGraph / SQLite + Git 等） | ✅ |

### 4.3 独立审查（已豁免）

第一阶段是协议化，没有可执行代码；审查由用户本人在每份 spec 完成时实时确认（已通过对话锁定 D-* 决策）。形式上等价于：

- A1 spec-conformance-reviewer：用户每轮 spec 写完后立即审阅 / 锁定决策
- A3 security-auditor：用户在 sensitive 数据 / 隐私分级章节明确确认
- 其它 Agent：尚无可审实体，跳过

> Phase 0 视为 PASS，记录入档。下一份审查报告从 Phase 1 开始。

---

## 5. Phase 1 · MVP 闭环（8–10 周）

### 5.1 目标

端到端跑通一个最简 Workflow，且 **Plan-Act-Review-Repair 闭环可工作**。覆盖 32 条 MUST 级需求中的 FR-001~020 共 20 条。

### 5.2 任务分解

按 spec 引用顺序拆为 6 个 milestone：

#### M1.1 工程地基（约 1.5 周）

- monorepo 结构落地（apps/desktop + apps/runtime + packages/schemas + packages/ui + docs + specs + evals + scripts + tools）
- pyproject.toml / pnpm-workspace.yaml / uv workspace
- CI 三平台矩阵（GitHub Actions：macOS / Windows / Linux）
- ruff + mypy + pytest + vitest + eslint + tsc 全量
- 类型流：Pydantic v2 → JSON Schema → TS via datamodel-code-generator + json-schema-to-typescript
- Makefile：`make dev` / `make build` / `make test` / `make codegen`
- pre-commit hook 安装（`runtime_harness.md` §8.3）
- ADR 0001~0010 写入 `docs/03_decisions/`

#### M1.2 共享 Schema 包（约 1 周）

- `packages/schemas` 内的 Pydantic 模型 1:1 实现 7 份 schema spec：WorkflowGraph / NodeContract / ContextPack / EvidencePack / EvaluationResult / RepairPatch / StreamEvent
- TS 类型自动生成（`packages/ts-schemas`）
- 契约单元测试（`packages/schemas/tests/`）：每份 schema spec 至少 3 条 test（happy path / error code / round-trip）

#### M1.3 Runtime 核心（约 2.5 周）

- FastAPI 端点 50% 覆盖（`api/http_sse.md` §2 中 system / projects / workflows / runs / artifacts / observability 必交付；reflection / planning 留 Phase 2）
- Engine 编译器：WorkflowGraph → LangGraph StateGraph
- 节点 Runner：execution / evaluation / repair / human_checkpoint / start / end（5 类必交付）
- ContextBuilder + EvidenceBuilder（按已锁 spec 的 8 步 / 三段流程）
- ModelRouter（Phase 1 静态版）+ ReflectionMemory v0
- 持久化层：SQLite 索引 + JSON Manifest + simple-git 自动 commit
- StreamEvent 总线（SSE 服务端 + jsonl 写入）
- OTel + SQLite Exporter（`observability.md` §6 表结构）

#### M1.4 AgentAdapter 首发两家（约 1.5 周）

- **PydanticAIAdapter**（默认 90% 节点）：完整实现 prepare/run/resume/cancel/finalize 五件套；StreamEvent 转译表完整
- **ClaudeCodeAdapter**（演示价值）：claude-agent-sdk-python 子会话；HITL 走 permission prompt → human.gate_required；cancel 粗粒度子进程

#### M1.5 桌面 Shell（约 2 周）

- Electron Forge + Vite + React 18 + TypeScript + Tailwind 项目骨架
- main / preload / renderer 三段式 + contextIsolation + sandbox=true + 严格 CSP
- sidecar spawn / token 注入 / 端口探活 / `READY <port>` stdout 截获
- React Flow Canvas + 底部 Chat Box + 流式输出折叠面板 + 右侧 Task Drawer + 左侧 Dock + 文件树 + 版本快照（FR-001~020 必交付项）
- electron-updater 接入 GitHub Releases（Phase 1 即启用）

#### M1.6 端到端 demo + 工程基线（约 1 周）

- 演示 Workflow：**"PDF → 提取研究问题 → 审查 → 失败修复 → 撰写报告 → 导出 markdown"**
- 在中等模型（如 Claude Haiku / Qwen2.5-32B）上 pass rate ≥ 80%
- CW-Bench v0.1 启动：3 个 demo 任务 + 2 个模型 profile

### 5.3 出口标准

| 编号 | 标准 | 测量方式 |
|---|---|---|
| EXIT-P1-1 | 32 条 MUST 中 FR-001~020 共 20 条全部达标 | UX Agent 验收清单 |
| EXIT-P1-2 | 端到端 demo Workflow 在 ≥1 强模型 + ≥1 中等模型上跑通；最终产物可导出 | demo 录像 + artifacts |
| EXIT-P1-3 | 中等模型一次通过率（first-attempt pass rate）≥ 60%；含 Repair 后总通过率 ≥ 80% | CW-Bench v0.1 报告 |
| EXIT-P1-4 | spec ↔ code 一致性 ≥95%（A1 报告） | A1 spec-conformance-reviewer |
| EXIT-P1-5 | 错误码覆盖率：每条已锁定错误码至少 1 个 unit/integration test 触发 | A2 contract-test-runner |
| EXIT-P1-6 | 安全审计：A3 报告无高危项；中危项数量 ≤5 且全部有 follow-up 计划 | A3 security-auditor |
| EXIT-P1-7 | macOS / Windows / Linux 三平台 Electron 安装包均可启动 + 跑通端到端 demo | A9 cross-platform-validator |
| EXIT-P1-8 | Adapter 协议合规：PydanticAIAdapter / ClaudeCodeAdapter 全部 capabilities() 声明经实测无差异 | A6 adapter-conformance-reviewer |
| EXIT-P1-9 | 失败分类：`unknown` 类比例 ≤ 5% | A7 failure-taxonomy-auditor |
| EXIT-P1-10 | Git 行为：自动 commit / tag 100% 符合 `runtime_harness.md` §8.2 表；pre-commit hook 0 个绕过 | A8 git-history-auditor |
| EXIT-P1-11 | 流式可观测性：stream-events.jsonl + trace.sqlite 可重放任意完成的 Run | A2 + A3 联合 |
| EXIT-P1-12 | 性能基线：Canvas 100 节点拖拽响应 <100ms；StreamEvent 推送延迟 <200ms（与 UIUX 非功能需求一致） | UX 录屏 + benchmark |

### 5.4 独立审查矩阵（必须全 PASS）

| Agent | 必查 |
|---|---|
| A1 spec-conformance-reviewer | 18 份 spec ↔ code 字段级映射；不允许实现层引入未在 spec 内的字段 |
| A2 contract-test-runner | 错误码总索引 17 套全覆盖；状态迁移 Run 17 + Node 22 全覆盖 |
| A3 security-auditor | sensitive 路径硬约束（D-EP-3 / D-MR-8 / D-RH-3）；token 不入磁盘；pre-commit hook |
| A4 ux-acceptance-reviewer | FR-001~020 + P1~P7 设计原则；信息密度 / Drawer 折叠 / Chat Box 位置 |
| A5 evals-runner | CW-Bench v0.1 跑通 + 报告入档 |
| A6 adapter-conformance-reviewer | PydanticAIAdapter / ClaudeCodeAdapter |
| A7 failure-taxonomy-auditor | unknown ≤5% |
| A8 git-history-auditor | commit message / tag / hook |
| A9 cross-platform-validator | 三平台 |

> 9 个 Agent 全部 PASS 才允许进入 Phase 2。

### 5.5 风险与缓解

- **风险 A**：Pydantic AI extras 依赖冲突（如 outlines / huggingface）
  - 缓解：仅装 `[anthropic, openai, google, mcp, fastmcp, retries, evals, ag-ui, web]`；其它 extras 推迟到 Phase 3
- **风险 B**：Electron + PyInstaller sidecar 在 Windows 上 Defender 拦截
  - 缓解：Phase 1 第一周做 Windows codesigning 准备；申请 EV 证书
- **风险 C**：LangGraph 内部图与 CW Engine 的状态机协调出错
  - 缓解：Engine 显式驱动状态迁移，不依赖 LangGraph 生命周期事件（`workflow_run.md` D-WR-8）

---

## 6. Phase 2 · 自动规划 + 草案编辑（6–8 周）

### 6.1 目标

落地 UIUX §18 全章。覆盖 FR-18-001~012 共 12 条 MUST。让用户用一句话目标 + 几份附件，能在 5 分钟内得到一个可创建的 Workflow。

### 6.2 任务分解

#### M2.1 PlanningSession 状态机（约 1 周）

- 11 状态机完整实现（`planning_session.md` §1.1）
- 5 个子 Agent 落到 PydanticAIAdapter：ExplorerAgent / UnderstandingAgent / ClarifierAgent / PlannerAgent / PatchAgent
- jsonl 落盘 + SSE 频道 `/workflow-planning/sessions/{id}/stream`

#### M2.2 自动规划 Pipeline（约 2 周）

- 探索 → 理解 → 澄清（3 选项 + 自定义）→ 草案编排
- 4 级校验闭环（L1 格式 / L2 Schema / L3 图结构 / L4 执行可行性）
- 自动修复 ≤3 次

#### M2.3 草案预览 + WorkflowPatch（约 1.5 周）

- 草案缩略 Canvas + 摘要 + 校验状态 + 本次修改卡
- WorkflowPatch 支持 Phase 1 落定的 11 类 op
- 用户自然语言修改 → PatchAgent 生成 ops 增量应用

#### M2.4 手动节点编辑器（约 2 周）

- 节点拖拽 / 连线 / 配置面板（execution / evaluation 两类必交付）
- AI 草案 → 手动编辑器 桥接（保留 draft_source / 校验记录 / 对话引用）
- 返回对话由 PatchAgent 基于当前 Canvas 生成 Patch

#### M2.5 端到端 demo + 测试矩阵（约 1.5 周）

- §18.14 8 个测试场景全部 pass
- CW-Bench v0.2：再增加 4 个规划路径任务

### 6.3 出口标准

| 编号 | 标准 | 测量 |
|---|---|---|
| EXIT-P2-1 | FR-18-001~012 共 12 条全部达标 | A4 |
| EXIT-P2-2 | §18.14 8 个测试场景全部 pass | A2 + A4 |
| EXIT-P2-3 | 用户从输入目标到拿到可创建 Workflow ≤ 5min（80 分位） | A4 录屏 + 计时 |
| EXIT-P2-4 | 澄清轮次平均 ≤2，最大 3（D-PS-2） | A2 metric 抽样 |
| EXIT-P2-5 | 草案 4 级校验通过率（含自动修复后）≥ 95% | A2 |
| EXIT-P2-6 | 用户对草案的"自然语言修改"由 PatchAgent 转 ops 成功率 ≥ 90% | A4 用户路径 |
| EXIT-P2-7 | spec ↔ code 一致性 ≥95%（含 PlanningSession 全状态机） | A1 |
| EXIT-P2-8 | 安全：澄清答案 / 草案中含敏感数据时正确路由到 secure/ | A3 |

### 6.4 独立审查（全 PASS）

A1 / A2 / A3 / A4 / A5 / A7 全部启用；A6 / A8 / A9 复用 Phase 1 报告（仅 delta 检查）。

---

## 7. Phase 3 · MCCL 强化 + 多 Adapter（8 周）

### 7.1 目标

让产品真正具备"补偿模型差异"的能力。覆盖技术架构 §8 跨模型对齐策略。

### 7.2 任务分解

#### M3.1 ModelProfile 自适应（约 2 周）

- ModelProfile.performance_profile 接入真实运行数据
- 30min 周期聚合写回 `~/.cw/model_profiles.json`
- ModelRouter Phase 3 行为开启（`model_router.md` §9）

#### M3.2 多候选 + LLM-as-judge 仲裁（约 1.5 周）

- candidate_count > 1 的多候选生成
- ArbitrationOutcome multi_judge / programmatic_first 两种模式
- disagreement_score ≥ 0.5 强制 human_checkpoint（D-ER-5）

#### M3.3 RepairPatch 全 6 类（约 1.5 周）

- prompt_patch / context_patch / evidence_patch / model_escalation 已在 Phase 1
- workflow_patch / human_checkpoint 由 Engine 完整支持（包括 `relax_review_rule / split_node`）

#### M3.4 新 Adapter 落地（约 2.5 周）

- CodexAdapter（云端 task queue）
- HermesAdapter（屏蔽 Hermes 自身 Memory/Skills/Cron，仅复用 loop+tool_call 内核）
- LiteLLMAdapter（裸调用模型）

#### M3.5 ReflectionMemory 自适应（约 0.5 周）

- evidence_pattern + node_template_seed 写回与复用
- PlannerAgent 读取 node_template_seed 提供"经验种子"

### 7.3 出口标准

| 编号 | 标准 | 测量 |
|---|---|---|
| EXIT-P3-1 | 跨模型对齐：同一 Workflow 在 Claude Sonnet 与 Qwen2.5-32B 上跑，最终产物结构一致率 ≥ 95% | A5 |
| EXIT-P3-2 | 关键证据覆盖率差异 ≤ 10%（同上对比） | A5 |
| EXIT-P3-3 | Repair 闭环 3 次内通过率 ≥ 80% | A5 |
| EXIT-P3-4 | 5 类 AgentAdapter 全部 PASS A6 协议合规 | A6 |
| EXIT-P3-5 | model_capability_limit 类失败的升级链使用率 ≥ 70%；human_checkpoint 兜底率 ≤ 30% | A7 |
| EXIT-P3-6 | spec ↔ code 一致性 ≥98% | A1 |

---

## 8. Phase 4 · 团队化 / 模板化 / 生态（6 周+）

### 8.1 目标

CW 从"个人工具"升级为"工程团队的 Agent 工作台"。

### 8.2 任务分解（精简）

- M4.1 子流程折叠 + Workflow 嵌套
- M4.2 节点成本统计 + 预算 Guard
- M4.3 Workflow Template Marketplace（先内部库）
- M4.4 ReflectionMemory.scope=global 启用 + 跨项目脱敏二审
- M4.5 命令面板 + 快捷键体系
- M4.6 协作（评论 / 多人查看）
- M4.7 CLI 模式（`cw run workflow.flow.json`）面向 CI/CD
- M4.8 公开 release（GitHub Releases + 文档站点）

### 8.3 出口标准

| 编号 | 标准 |
|---|---|
| EXIT-P4-1 | CLI 模式跑通 CI/CD 集成 demo |
| EXIT-P4-2 | 模板上架 / 共享 / 版本约束流程通过 A10 |
| EXIT-P4-3 | 团队场景下多人查看 Run 不冲突 |
| EXIT-P4-4 | 公开 release（含完整文档 + 多平台安装包 + 自动更新通道） |

---

## 9. 阶段晋级流程

每个 Phase 收尾时执行以下流程：

```
1. 工程团队提交 PR：tag <phase>-rc.<n>
2. 触发 5+ 类独立审查 Agent 并行运行
3. 每个 Agent 产出 Report 写入 docs/reviews/phase{N}/
4. 召开晋级会议，逐条 review Agent 报告
5. 全部 PASS：
   a. 打 release tag v<phase>.0.0
   b. 更新 docs/roadmap.md 与跨会话项目记忆
   c. 启动下一 Phase 工程任务
6. 任意 Agent FAIL：
   a. 列出 follow-up 项与负责人
   b. 修复后重新走 1~5
7. CONDITIONAL_PASS：
   a. follow-up 在约定工期内完成
   b. 工期内未完成 → 自动降级 FAIL
```

### 9.1 报告模板（`docs/reviews/phase{N}/<agent_id>-<yyyymmdd>.md`）

```markdown
# {agent_id} Review Report — Phase {N}

| 项 | 值 |
|---|---|
| Phase | {N} |
| Agent | {agent_id} |
| Reviewed at | YYYY-MM-DD |
| Repository ref | <commit_sha> |
| Verdict | PASS / CONDITIONAL_PASS / FAIL |

## 1. 输入
- spec 集合 commit / Phase 任务清单 / artifacts 引用

## 2. 审查范围
- ...

## 3. 发现项
| ID | 严重度 | 描述 | 位置 | 建议方向 |
|---|---|---|---|---|
| F1 | high | ... | apps/runtime/src/... | ... |

## 4. 验收清单
- [ ] EXIT-P{N}-1 ...
- [x] EXIT-P{N}-2 ...

## 5. Follow-up（若 CONDITIONAL_PASS）
- ...（含 owner + 工期）

## 6. 结论
{PASS / CONDITIONAL_PASS / FAIL} + 一句话总结
```

---

## 10. 治理与变更

- 本文档变更必须通过 ADR 流程（`docs/03_decisions/`）
- 出口标准的任何调整需在变更前的 Phase 之内定型；不允许"晋级时临时加塞"
- 独立审查 Agent 的审查域必须在 Phase 启动时锁定；中途调整需走 ADR

---

## 更新历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-15 | 0.1.0 | 初稿；Phase 0 状态盘点 + Phase 1~4 任务 + 出口标准 + 5 类独立审查 Agent + 5 个专项审查 Agent + 晋级流程 |
