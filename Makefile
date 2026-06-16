# =====================================================================
# CognitiveWorkflow — Top-level Makefile
# =====================================================================
# 跨平台备注：
# - macOS / Linux 直接 `make <target>`
# - Windows 推荐 Git Bash + GNU Make (winget install GnuWin32.Make)
#   或用 PowerShell 直接调用各 target 的命令
# =====================================================================

.PHONY: help install dev build test test-py test-js typecheck typecheck-py typecheck-js \
        lint lint-py lint-js format format-check codegen clean phase-status

# ---- 默认目标：打印帮助 ----
help:
	@echo "CognitiveWorkflow Makefile 目标:"
	@echo "  install        安装全部依赖（uv sync + pnpm install）"
	@echo "  dev            一键拉起 runtime sidecar + Electron renderer"
	@echo "  build          构建全部子包（Python + TS + Electron 安装包）"
	@echo "  test           跑全部测试（pytest + vitest）"
	@echo "  typecheck      类型检查（mypy + tsc）"
	@echo "  lint           代码规范检查（ruff + eslint）"
	@echo "  format         代码格式化（ruff format + prettier）"
	@echo "  format-check   仅检查格式不修改"
	@echo "  codegen        Pydantic v2 → JSON Schema → TS 类型一键生成"
	@echo "  clean          清理构建产物 / 缓存"
	@echo "  phase-status   显示当前 Phase / 关键里程碑状态"

# ---- 安装 ----
install:
	uv sync --all-extras
	pnpm install --frozen-lockfile=false

# ---- 开发模式 ----
dev:
	@echo "[dev] 启动 runtime sidecar + Electron renderer ..."
	pnpm run dev

# ---- 构建 ----
build:
	uv run python -m build packages/schemas
	uv run python -m build apps/runtime
	pnpm -r run build

# ---- 测试 ----
test: test-py test-js

test-py:
	uv run pytest

test-js:
	pnpm -r run test

# ---- 类型检查 ----
typecheck: typecheck-py typecheck-js

typecheck-py:
	uv run mypy packages/schemas apps/runtime

typecheck-js:
	pnpm -r run typecheck

# ---- Lint ----
lint: lint-py lint-js

lint-py:
	uv run ruff check .

lint-js:
	pnpm -r run lint

# ---- 格式化 ----
format:
	uv run ruff format .
	pnpm run format

format-check:
	uv run ruff format --check .
	pnpm run format:check

# ---- 代码生成 ----
codegen:
	@echo "[codegen] Pydantic v2 → JSON Schema → TS ..."
	uv run python scripts/codegen/generate-json-schemas.py
	pnpm run codegen

# ---- 清理 ----
clean:
	rm -rf dist build .pytest_cache .mypy_cache .ruff_cache .coverage htmlcov
	rm -rf packages/*/dist packages/*/build apps/*/dist apps/*/build
	find . -type d -name "__pycache__" -prune -exec rm -rf {} +
	find . -type d -name ".turbo" -prune -exec rm -rf {} +

# ---- Phase 状态 ----
phase-status:
	@echo "Phase 0  ✅ 协议化 — 18 specs Accepted (2026-06-15)"
	@echo "Phase 1  🟢 进行中 — MVP 闭环"
	@echo "  M1.1   工程地基              [in_progress]"
	@echo "  M1.2   共享 Schema 包        [pending]"
	@echo "  M1.3   Runtime 核心          [pending]"
	@echo "  M1.4   AgentAdapter 首发两家 [pending]"
	@echo "  M1.5   桌面 Shell            [pending]"
	@echo "  M1.6   端到端 demo + 工程基线 [pending]"
	@echo "Phase 2  ⚪ 待启动 — 自动规划 + 草案编辑"
	@echo "Phase 3  ⚪ 待启动 — MCCL 强化 + 多 Adapter"
	@echo "Phase 4  ⚪ 待启动 — 团队化 / 模板化 / 生态"
