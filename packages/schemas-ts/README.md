# @cw/schemas

CognitiveWorkflow TypeScript 类型——**自动从 `packages/schemas`（Python `cw_schemas`）生成**（ADR-0003）。

## 强约束

- `src/generated/` 完全由 `make codegen` 输出；**禁止手改**
- 仅 `src/index.ts` 与 `src/runtime.ts` 是手写：负责 re-export 与少量 runtime helper（如 discriminated union helpers）
- CI 中 `codegen-consistency` 步骤验证：跑完 codegen 后 git 无 diff；不一致 fail

## 生成流程

```
packages/schemas (Python Pydantic v2)
    │
    ▼ scripts/codegen/generate-json-schemas.py
packages/schemas-ts/src/generated/json-schema/*.json
    │
    ▼ scripts/codegen/generate-ts-schemas.mjs (json-schema-to-typescript)
packages/schemas-ts/src/generated/*.ts
```
