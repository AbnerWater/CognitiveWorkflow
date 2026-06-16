# Pull Request

## 概述

<!-- 一句话说明本次改动做了什么 -->

## 关联

- Issue: Closes #XXX
- ADR: ADR-XXXX（如涉及架构决策）
- Spec: specs/...（若有 schema / 协议改动，列出对应 spec 文件）

## 改动类型

- [ ] feat — 新功能
- [ ] fix — Bug 修复
- [ ] refactor — 重构（不改外部行为）
- [ ] docs — 文档
- [ ] test — 测试
- [ ] chore — 工程基础设施
- [ ] perf — 性能改进
- [ ] ci — CI / 构建
- [ ] revert — 回滚

## 验证清单

- [ ] `make format-check` 通过
- [ ] `make lint` 通过
- [ ] `make typecheck` 通过
- [ ] `make test` 通过
- [ ] `make codegen` 后 git 无 diff（schema 改动时必查）
- [ ] 涉及 spec 改动：spec 文件已更新，错误码总索引（failure_taxonomy.md §7）已同步
- [ ] 涉及状态机改动：state_machines/* 表格已更新
- [ ] 涉及 API 改动：api/http_sse.md 端点表已更新

## 影响面

<!-- 列出本 PR 影响的模块；说明对其它正在进行的工作的潜在冲突 -->

## 截图 / 录屏（UI 改动必填）

<!-- 拖拽即可 -->

## 给 reviewer 的提示

<!-- 哪一段最值得关注？哪段不需要细看？是否有 follow-up 项？ -->

---

- [ ] 我是这段代码的作者（**AI 生成代码必须由人工勾选此 box**，Agent 不勾）
