# ADR-0007: 持久化采用 SQLite + JSON Manifest + Git via simple-git

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | 文件即真理；Git diff 可读；本地优先 |
| Related ADR | ADR-0006 |
| Related Spec | specs/runtime_harness.md |

## 1. 背景与问题

CW 项目目录需要承载：高频运行时状态（NodeAttempt / EvaluationResult / RepairPatch / StreamEvent）+ 用户可见 manifest + 版本快照。

## 2. 候选方案

1. **纯 SQLite** — ❌ Git diff 不可读；用户黑盒
2. **纯 JSON 文件** — ❌ 高频写入 IO 瓶颈
3. **三层职责分离**：JSON Manifest（与用户共享，Git 跟踪）+ SQLite（运行时索引 / 加密区）+ Git（时间机器） — ✅

## 3. 决策

采用三层职责分离：

| 层 | 职责 |
|---|---|
| JSON Manifest | 与用户共享、Git 跟踪、人类可读、稳定字段顺序 |
| SQLite (+ sqlcipher) | 运行时索引 / 加密 sensitive 数据 / OTel exporter |
| Git via simple-git | 版本时间线 + 自动 commit/tag |

约束（与 specs/runtime_harness.md 一致）：

- 任何对象只有一处真理（D-RH-1）
- sensitive 数据走 secure/ 加密 SQLite，不进 Git（D-RH-3）
- pre-commit hook 拦截 secure/** / cache/** / 已知凭证（D-RH-6）
- 所有 manifest 写入采用"取锁 → 比对 revision → 写入 → revision +1 → 释放锁"原子流程（D-RH-7）

## 4. 影响

- 正面：用户可读、可 diff、可恢复；多窗口安全
- 负面：实现复杂度高（需要锁 + revision 一致性 + 加密区）
- 后续验证：A8 git-history-auditor 检查 commit 行为；A3 安全审计

## 5. 关联

- specs/runtime_harness.md（全部细则）
