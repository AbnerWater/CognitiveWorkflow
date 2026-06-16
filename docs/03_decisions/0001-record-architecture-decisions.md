# ADR-0001: 用 ADR 记录架构决策

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | 工程治理；可追溯；防止"代码先改、文档后补" |
| Related ADR | — |
| Related Spec | 全部 |

## 1. 背景与问题

CognitiveWorkflow 是产品 + 协议规范双驱动的项目（18 份 spec 锁定 130+ 决策）。需要轻量、可演化、可审计的方法记录"为什么这么做"。

## 2. 候选方案

1. **不写专门记录**——决策埋在 commit message / spec 内 — ❌ 难追溯，跨 spec 对照困难
2. **维护一份大决策文档**——单文件大全 — ❌ 易写不动；不同状态混乱
3. **ADR（Architecture Decision Records）**——每条决策一份 markdown，单调编号，状态字段 — ✅ Michael Nygard 经典做法，业界成熟

## 3. 决策

采用 **ADR**，落 `docs/03_decisions/NNNN-kebab-title.md`。

- 编号单调递增；接受 / 弃用通过 `Status` 字段表达
- 不修改已 Accepted 的 ADR 正文；变更通过新 ADR 标 Superseded
- ADR 模板见 `_template.md`
- 每次"会影响多模块的设计选择"必须先开 ADR 再改实现

## 4. 影响

- 正面：决策可追溯；新工程师能 1 小时读完关键决策；spec 与代码冲突时可仲裁
- 负面：写 ADR 有少量 overhead；需要纪律
- 后续验证：CI 中加 lint，PR 描述提到 ADR-NNNN 时该文件必须存在

## 5. 关联

- `AGENTS.md` §3.2 — Schema 改动必须先提 ADR
- `docs/roadmap.md` §10 — 治理与变更
