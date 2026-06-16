# AGENTS.md — CognitiveWorkflow 仓库工作协议

> 本仓库为 CognitiveWorkflow（CW）产品代码与设计 spec 的单一真理来源。任何在本仓库工作的 Agent（Claude Code / Codex / 人类工程师）都必须遵守本文。
>
> 与 `pydantic-ai/AGENTS.md` 相比，本文更短、更工程化——CW 是产品，不是开放库；spec 已经定型，实现遵循 spec。

---

## 1. 你为谁而工作

CW 的核心立场：

> **More structure, more reliability**

把复杂任务从一次性 Agent 对话，转化为**可编排、可验证、可复现、可修复**的认知型工作流。任何架构选择、API 设计、字段命名都应回答一个问题——"它如何让一次失败可以被结构化诊断 + 闭环修复"。

---

## 2. 进入仓库前必读

按以下顺序读完，不能跳：

1. `00_Concept.md` — 产品理念
2. `docs/roadmap.md` — Phase 路线图与质量门
3. `specs/failure_taxonomy.md` — 失败分类总图（理解 8+1 类失败 + 错误码命名空间）
4. 你要改的领域对应的 spec：
   - 改 schema → `specs/schemas/<name>.md`
   - 改协议 → `specs/protocols/<name>.md`
   - 改状态机 → `specs/state_machines/<name>.md`
   - 改 API → `specs/api/http_sse.md`
   - 改落盘行为 → `specs/runtime_harness.md`
5. 与你的改动相关的 ADR：`docs/03_decisions/`

---

## 3. 贡献规则

### 3.1 类型完备

- Python 全量 `mypy --strict`；不允许任何 `# type: ignore` 不带原因注释
- TypeScript 全量 `tsc --strict`
- Pydantic v2 模型禁止 `extra='allow'`；显式 `model_config = ConfigDict(extra='forbid')`

### 3.2 Schema 改动必须先提 ADR

- 新增 / 删除 / 改名 spec 字段 → 先写 ADR，再改 spec，最后改代码
- 新增 / 删除 / 改名错误码 → 先在对应 spec 的错误码表中锁定，再改代码
- 新增 / 删除 / 改名状态枚举 → 先在 `state_machines/` 内锁定

### 3.3 spec 是真理

- 代码不允许引入 spec 之外的字段、错误码、状态、事件类型
- spec 与代码冲突时，**先**写 ADR 决定调整哪一侧；不允许"代码先改、文档后补"

### 3.4 不修改基线 docx

- `AI_Agent_Workflow_技术架构设计说明书_v1.0.docx`
- `AI_Agent_Workflow工作台_UIUX详细设计规范与需求规格说明书_v1.1_新增Workflow编排.docx`

这两份是 baseline，只读。需要修订时在 `docs/01_architecture/` 与 `docs/02_uiux/` 下做拆解版变更，原 docx 保持不动。

### 3.5 Commit 规则

- 遵循 [Conventional Commits 1.0](https://www.conventionalcommits.org/) + CW 命名空间
- 命名空间：`feat / fix / chore(memory) / chore(refs) / chore(workflow) / chore(planning) / chore(run) / chore(human) / chore(repair) / snapshot / docs / test / refactor / build / ci`
- 标题 ≤ 70 字符，描述详细放正文
- 严禁加 `Co-Authored-By: Claude` trailer

### 3.6 PR 规则

- 标题 ≤ 70 字符；标识符（类名 / 字段名 / 错误码）用 backtick 包裹
- 关联对应 issue：`Fixes #N` / `Closes #N`
- "AI generated code" checkbox 由人工勾，不由 Agent 勾
- PR 必须通过 CI + 至少一名 reviewer 批准

---

## 4. 禁止行为

| 行为 | 为什么禁止 |
|---|---|
| Engine / Compiler / MCCL 直接 `import pydantic_ai` | ADR-0002：所有 LLM 调用必须经 `AgentAdapter` |
| 在 spec 之外引入字段 / 错误码 | spec 是真理；漂移会破坏跨 spec 引用闭环 |
| 在 commit 内含 `Co-Authored-By: Claude` | git_safety 规则；提交人是用户 |
| 直接修改 baseline docx | 见 §3.4 |
| 写 secrets / API key 到任何 commit | pre-commit hook 会拦截；这是 CW 的安全立场 |
| 直接写 `memory.json` 而不经 `memory_task` 节点 | D-RH-2：memory 写入必须由 memory_task 或显式 UI 触发 |
| 把 `secure/**` / `cache/**` 加入 git tracking | D-RH-3 / D-RH-6 |
| 使用 `localStorage / sessionStorage`（renderer 内） | renderer sandbox=true，禁用 storage API；用 IPC 持久化 |
| 在 attribute 内写 prompt 原文 / 模型输出原文 / quote 原文 | D-OB-4：OTel 仅承载结构化元信息 |

---

## 5. 仓库结构指针

```
CognitiveWorkflow/
├── docs/                       # 设计文档（人类阅读）
│   ├── 01_architecture/        # 技术架构 docx 的 md 拆解
│   ├── 02_uiux/                # UIUX docx 的 md 拆解
│   ├── 03_decisions/           # ADR
│   ├── 04_runbook/             # 开发与运行手册
│   ├── reviews/                # 独立审查 Agent 报告归档
│   └── roadmap.md              # Phase 路线图与质量门（必读）
│
├── specs/                      # 协议规约（机器+人类可读）
│   ├── failure_taxonomy.md     # 失败分类总图（必读）
│   ├── runtime_harness.md
│   ├── schemas/                # 7 份 Pydantic schema
│   ├── protocols/              # 6 份协议
│   ├── state_machines/         # 2 份状态机
│   └── api/                    # HTTP/SSE API 契约
│
├── packages/                   # 可复用包（Python uv workspace + npm workspace）
│   ├── schemas/                # cw_schemas — 共享 Pydantic 模型
│   ├── schemas-ts/             # @cw/schemas — 自动生成的 TS 类型
│   └── ui/                     # @cw/ui — 复用 React 组件
│
├── apps/                       # 终端应用
│   ├── runtime/                # cw_runtime — Python sidecar（FastAPI + LangGraph + Pydantic AI）
│   └── desktop/                # @cw/desktop — Electron + React 桌面 Shell
│
├── evals/                      # CW-Bench 评测
├── examples/                   # 端到端 Workflow 样例
├── scripts/                    # 工程脚本
├── tools/                      # 一次性工具（如 docx 拆解器）
├── pydantic-ai/                # 仅供阅读的参考代码（已 .gitignore）
│
├── pyproject.toml              # uv workspace 根
├── pnpm-workspace.yaml         # npm workspace 根
├── package.json                # npm workspace 根
├── Makefile                    # 一键命令
└── AGENTS.md / CLAUDE.md       # 你正在读的这份
```

### 5.1 包名规约

| 维度 | 规约 |
|---|---|
| Python distribution name | `cw_schemas` / `cw_runtime` / `cw_ui` |
| Python import name | 与 distribution 同名（snake_case） |
| npm package name | `@cw/schemas` / `@cw/desktop` / `@cw/ui` |

---

## 6. 边界规则

### 6.1 Engine 不直接依赖 Pydantic AI（ADR-0002）

```python
# ❌ 严禁
from pydantic_ai import Agent

# ✅ 必须
from cw_runtime.adapters.base import AgentAdapter
```

任何 LLM 调用都经过 AgentAdapter 协议；具体见 `specs/protocols/agent_adapter.md`。

### 6.2 packages/schemas 是 leaf package

- 仅依赖 `pydantic v2`
- 禁止依赖 `cw_runtime` / pydantic-ai / fastapi 等运行时库
- 这是 ADR-0003 的实质：schemas 是仓库的"语言"

### 6.3 renderer 不持 Node API

- 严格 `contextIsolation=true` + `sandbox=true`
- 所有特权能力（sidecar 启停 / Git / 文件对话框）经 preload 暴露的 `window.cw.*` 调用
- renderer 直连 sidecar 仅通过 `EventSource` + `fetch`（带主进程注入的 token）

---

## 7. 测试要求

- 单元测试：每条 spec 的错误码 / 状态迁移 / 决策点至少 1 条 test
- 集成测试：每个 milestone 必须含一个端到端集成测试（含真实模型调用，可用 Pydantic AI `TestModel` 替代）
- 契约快照：使用 `pytest-snapshot` 锁定 schema 序列化形态；snapshot 变更必须显式 review

---

## 8. 何时可以"先 stub 再实现"

允许：

- M1.1 阶段铺骨架时各子包内的 `__init__.py` / 类签名 stub（只要 mypy 与 tsc 能通过）
- 跨 milestone 的依赖：上游 milestone 留 abstract 接口，下游 milestone 落实现

不允许：

- 长期保留 `raise NotImplementedError`：跨 milestone 必须清零
- 上游修改 spec 而下游不同步：CI 必须能通过 codegen-consistency 检查发现

---

## 9. 验证义务（commit / PR 前）

```bash
make format-check
make lint
make typecheck
make test
make codegen          # 确保 packages/schemas-ts 是 packages/schemas 的最新派生
```

5 步全绿才允许 commit。pre-commit hook 会阻塞未通过的提交。

---

## 10. 与人类工程师协作的边界

Agent 在以下场景**必须**停下来等用户确认：

- 涉及 spec 字段 / 错误码 / 状态枚举的"破坏性变更"——必须先 ADR
- 跨 milestone 的依赖：上游 milestone 的接口尚未稳定时，下游不允许"猜测实现"
- 第三方依赖新增（pyproject / package.json 的 production deps 增加）—— 必须给出版本与理由
- 涉及 secrets / API key / 凭证流的设计

---

## 11. 关于本文档

- 本文一旦改变 §3 / §4 / §6 任一条，必须有 ADR
- §5 仓库结构变更：ADR + 同步 `docs/roadmap.md`
- 其它（§1 / §2 / §7~§10）允许工程团队 PR 调整，无需 ADR
