# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本仓库已有完整工作协议在 `AGENTS.md`——**进入仓库前先读 `AGENTS.md` 全文**，本文不重复其规则，仅补充 Claude Code 在本仓库的工作姿势。

## 必读顺序

按以下顺序读完再动手，跳读会破坏 spec-first 流程：

1. `AGENTS.md` — 仓库工作协议（§3 贡献规则 / §4 禁止行为 / §6 边界规则）
2. `00_Concept.md` — 产品理念
3. `docs/roadmap.md` — Phase 路线图与质量门，确认当前 milestone
4. `specs/failure_taxonomy.md` — 失败分类总图（8+1 类失败 + 17 套错误码命名空间）
5. 你要改的领域对应的 spec（`specs/schemas/` / `specs/protocols/` / `specs/state_machines/` / `specs/api/`）
6. `docs/03_decisions/` 下与改动相关的 ADR

## 双轨命令系统（Windows ↔ macOS/Linux）

本仓库的开发命令在 `Makefile` 与 `dev.ps1` 中**等价维护**。Claude Code 多在 Windows 工作，但 CI 跑在 Linux——改一边就要同步另一边。

| 任务                    | macOS / Linux        | Windows                   |
| ----------------------- | -------------------- | ------------------------- |
| 安装依赖                | `make install`       | `.\dev.ps1 install`       |
| 安装 git hooks          | `make hooks-install` | `.\dev.ps1 hooks-install` |
| Lint                    | `make lint`          | `.\dev.ps1 lint`          |
| 类型检查                | `make typecheck`     | `.\dev.ps1 typecheck`     |
| 测试（全量）            | `make test`          | `.\dev.ps1 test`          |
| 仅 Python 测试          | `make test-py`       | `.\dev.ps1 test-py`       |
| 仅 JS 测试              | `make test-js`       | `.\dev.ps1 test-js`       |
| Codegen                 | `make codegen`       | `.\dev.ps1 codegen`       |
| Phase 状态              | `make phase-status`  | `.\dev.ps1 phase-status`  |
| 一键 dev（M1.5 后启用） | `make dev`           | `.\dev.ps1 dev`           |

跑单条 pytest：`uv run pytest <path>::<test_id>`（pytest 配置在根 `pyproject.toml` 的 `[tool.pytest.ini_options]`，`testpaths = packages/schemas/tests, apps/runtime/tests`，`asyncio_mode = auto`，`filterwarnings = error`——遇到 warning 直接挂）。

跑单条 vitest：`pnpm --filter @cw/<package> test -- <pattern>`。

提交前的"5 步全绿"门是硬性的：`format-check` → `lint` → `typecheck` → `test` → `codegen`，pre-commit hook 会阻塞未通过的提交。

## 架构 big picture（必须跨文件理解的部分）

CW 是 **Electron 桌面 Shell + Python sidecar** 的双进程产品，全仓 spec-first：

```
specs/ (18 份 Accepted spec)
   │
   ▼  ADR-0003：spec 是真理；Pydantic 模型是 spec 的"代码侧落地"
packages/schemas/        (cw_schemas, Python，leaf 包，仅依赖 pydantic v2)
   │
   ▼  scripts/codegen/generate-json-schemas.py + generate-ts-schemas.mjs
packages/schemas-ts/     (@cw/schemas, 自动生成；CI 校验 codegen 一致性)
   │                                                          │
   ▼                                                          ▼
apps/runtime/            (cw_runtime, FastAPI + LangGraph)   apps/desktop/  (@cw/desktop, Electron)
   │                                                          │
   └──────────────── HTTP + SSE（specs/api/http_sse.md）──────┘
```

四条强约束串起整个架构（违反会被 pre-commit hook 或 mypy 当场拦截）：

- **schemas 是 leaf**（ADR-0003）：`packages/schemas` 只依赖 `pydantic v2`，禁止依赖 `cw_runtime` / `pydantic-ai` / `fastapi`。它是仓库的"语言"，TS 侧是它的派生。
- **Engine 不直接 `import pydantic_ai`**（ADR-0002）：所有 LLM 调用经 `AgentAdapter` 协议（见 `specs/protocols/agent_adapter.md`）。pre-commit hook `cw-no-pydantic-ai-import-in-engine` 会扫描 `apps/runtime/src/cw_runtime/{engine,nodes,mccl,memory,planning,persistence,stream,tools,observability,api}/` 下的 Python 文件。
- **renderer sandbox 严格**：`contextIsolation=true` + `sandbox=true`，禁用 `localStorage`/`sessionStorage`，特权能力一律走 preload 暴露的 `window.cw.*`，sidecar 直连仅用 `EventSource` + `fetch`（带主进程注入的 token）。
- **memory / 观测落盘有边界**：D-RH-2 → 写 `memory.json` 必须经 `memory_task` 节点；D-RH-3 / D-RH-6 → `secure/**` 与 `cache/**` 永远不入 git；D-OB-4 → OTel attribute 内禁止承载 prompt 原文/模型输出原文/quote 原文。

## spec / 错误码 / 状态枚举的修改流程

不允许"代码先改、文档后补"。改 schema/协议/状态机时：

1. 先在 `docs/03_decisions/` 写 ADR（模板：`_template.md`）
2. 改 `specs/<area>/<name>.md`（锁定 D-XX-N 决策点）
3. 改 `packages/schemas/src/cw_schemas/` 下的 Pydantic 模型
4. 跑 `make codegen` 同步 `packages/schemas-ts/src/generated/`（产物**入 git**，由 CI 校验一致性，不要手改）
5. 同步实现 + 测试

错误码 / 状态枚举同理——先在 spec 锁定，再改代码。代码不允许出现 spec 之外的字段、错误码、状态、事件类型。

## Windows 平台注意

- 路径用正斜杠或 `pathlib`，shell 用 bash 语法（不是 PowerShell；harness 已设 `Shell: bash`），`/dev/null` 不要写成 `NUL`。
- 项目设了 `core.autocrlf` 风格；`git add` 文本文件常见 `LF will be replaced by CRLF` warning，是正常的，不要为此改文件。
- `dev.ps1` 是 PowerShell 脚本，用户在本机跑；Claude Code 在 bash 里直接调 `uv run` / `pnpm` 即可，不需要包一层 `pwsh -Command`。

## 不要碰

- `AI_Agent_Workflow_技术架构设计说明书_v1.0.docx` 与 `AI_Agent_Workflow工作台_UIUX详细设计规范与需求规格说明书_v1.1_新增Workflow编排.docx`：基线只读，需要修订时在 `docs/01_architecture/` / `docs/02_uiux/` 下做拆解版变更。
- `pydantic-ai/`：仅供阅读的参考代码，已 `.gitignore`，不要改、不要提交其内任何文件。
- 任何含已知凭证前缀（`sk_` / `ANTHROPIC` / `OPENAI` / `AWS` / Google / GitHub / GitLab）的字符串：pre-commit hook `cw-block-known-secrets` 会拦截。

## Commit 与 PR

- Conventional Commits + CW 命名空间：`feat / fix / chore(memory|refs|workflow|planning|run|human|repair) / snapshot / docs / test / refactor / build / ci`
- 标题 ≤ 70 字符，标识符（类名/字段名/错误码）用 backtick 包裹
- **严禁 `Co-Authored-By: Claude` trailer**——pre-commit hook `cw-no-co-authored-by-claude` 会在 `commit-msg` 阶段拦截（这条覆盖 Claude Code 默认行为）
- 用户没明确要求时不要主动 `git commit` / `git push`；要 push 必须新建分支，不直接推 `main`

## 当前 Phase 速查

跑 `make phase-status` / `.\dev.ps1 phase-status` 可看完整状态。当前在 **Phase 1 · MVP 闭环**，M1.2 shared schema package 已收口，正在推进 **M1.3 Runtime 核心**；截至 W1.3.14 已完成 runtime API / harness init / compiler boundary / run lifecycle / deterministic runner / static builders / HITL decision resolve / ModelRouter / LangGraph executor foundation / ReflectionMemory v0 / AgentAdapter foundation / repair resumption / sidecar restart recovery。

M1.3 剩余 runtime 核心优先级：真实 Adapter SDK 接入、LangGraph/HITL interrupt bridge、desktop sidecar-open flow 对 W1.3.14 recovery 的集成。跨 milestone 的实现仍要等上游接口稳定，production dependency 新增必须先向用户说明版本与理由并获得确认。
