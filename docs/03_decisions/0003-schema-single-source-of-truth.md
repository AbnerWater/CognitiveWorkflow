# ADR-0003: Schema 单一真理在 packages/schemas，前端类型由 codegen 派生

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | 跨语言一致性；防止前后端 schema 漂移 |
| Related ADR | ADR-0001、ADR-0008 |
| Related Spec | specs/schemas/* |

## 1. 背景与问题

CW 同时是 Python（runtime）+ TypeScript（renderer）项目。schema 在两处独立定义会迅速漂移；某一侧修字段而另一侧忘改是常见 bug 源。

## 2. 候选方案

1. **双方各自定义 + 评审同步**——人肉对齐 — ❌ 必然漂移
2. **TS 为主 + Python 派生**——TS 类型有限，不能直接做 Pydantic 校验 — ❌
3. **Python Pydantic v2 为主 + TS 派生**——Pydantic 自带 JSON Schema 输出，TS 可由 datamodel-code-generator + json-schema-to-typescript 生成 — ✅

## 3. 决策

- `packages/schemas`（Python distribution `cw_schemas`）为单一真理来源
- `packages/schemas-ts`（npm `@cw/schemas`）由 `make codegen` 自动生成；不允许手改
- CI 中加 `codegen-consistency` 步骤：跑 codegen 后对比 git 是否一致；不一致 fail
- packages/schemas 是 leaf package，禁止依赖 cw_runtime / pydantic-ai / fastapi

## 4. 影响

- 正面：schema 漂移不可能；新增字段自动同步前端类型
- 负面：TS 端无法做"TS-first"的高级类型操作（如 const assertion）；某些 Pydantic 特性（如 discriminated union）需要在 TS 侧适配
- 后续验证：CI codegen-consistency；A1 spec-conformance-reviewer 检查实现字段是否全部来自 cw_schemas

## 5. 关联

- specs/schemas/*
- scripts/codegen/
- Makefile `codegen` target
