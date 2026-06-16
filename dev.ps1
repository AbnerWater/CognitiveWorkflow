# =====================================================================
# CognitiveWorkflow — Windows PowerShell 等价 dev 脚本
# =====================================================================
# 用法：.\dev.ps1 <target>
# 等价于 macOS / Linux 上的 `make <target>`
# =====================================================================

param(
    [Parameter(Position=0)]
    [ValidateSet(
        "help", "install", "dev", "build",
        "test", "test-py", "test-js",
        "typecheck", "typecheck-py", "typecheck-js",
        "lint", "lint-py", "lint-js",
        "format", "format-check",
        "codegen", "clean", "phase-status",
        "hooks-install"
    )]
    [string]$Target = "help"
)

$ErrorActionPreference = "Stop"

function Run-Command {
    param([string]$Command)
    Write-Host ">>> $Command" -ForegroundColor Cyan
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) { throw "命令失败：$Command" }
}

switch ($Target) {
    "help" {
        Write-Host "CognitiveWorkflow dev.ps1 目标:" -ForegroundColor Green
        Write-Host "  install         安装全部依赖（uv sync + pnpm install）"
        Write-Host "  hooks-install   安装 pre-commit hooks"
        Write-Host "  dev             一键拉起 runtime sidecar + Electron renderer"
        Write-Host "  build           构建全部子包"
        Write-Host "  test            跑全部测试（pytest + vitest）"
        Write-Host "  typecheck       类型检查（mypy + tsc）"
        Write-Host "  lint            代码规范检查（ruff + eslint）"
        Write-Host "  format          代码格式化（ruff format + prettier）"
        Write-Host "  format-check    仅检查格式不修改"
        Write-Host "  codegen         Pydantic v2 → JSON Schema → TS 类型一键生成"
        Write-Host "  clean           清理构建产物 / 缓存"
        Write-Host "  phase-status    显示当前 Phase 状态"
    }
    "install" {
        Run-Command "uv sync --all-extras"
        Run-Command "pnpm install"
    }
    "hooks-install" {
        Run-Command "uv run pre-commit install"
        Run-Command "uv run pre-commit install --hook-type commit-msg"
    }
    "dev" {
        Run-Command "pnpm run dev"
    }
    "build" {
        Run-Command "uv run python -m build packages/schemas"
        Run-Command "uv run python -m build apps/runtime"
        Run-Command "pnpm -r run build"
    }
    "test" {
        Run-Command "uv run pytest"
        Run-Command "pnpm -r --if-present run test"
    }
    "test-py" { Run-Command "uv run pytest" }
    "test-js" { Run-Command "pnpm -r --if-present run test" }
    "typecheck" {
        Run-Command "uv run mypy packages/schemas apps/runtime"
        Run-Command "pnpm -r --if-present run typecheck"
    }
    "typecheck-py" { Run-Command "uv run mypy packages/schemas apps/runtime" }
    "typecheck-js" { Run-Command "pnpm -r --if-present run typecheck" }
    "lint" {
        Run-Command "uv run ruff check ."
        Run-Command "pnpm -r --if-present run lint"
    }
    "lint-py" { Run-Command "uv run ruff check ." }
    "lint-js" { Run-Command "pnpm -r --if-present run lint" }
    "format" {
        Run-Command "uv run ruff format ."
        Run-Command "pnpm run format"
    }
    "format-check" {
        Run-Command "uv run ruff format --check ."
        Run-Command "pnpm run format:check"
    }
    "codegen" {
        Write-Host "[codegen] Pydantic v2 → JSON Schema → TS ..." -ForegroundColor Cyan
        Run-Command "uv run python scripts/codegen/generate-json-schemas.py"
        Run-Command "pnpm run codegen"
    }
    "clean" {
        Get-ChildItem -Path . -Include "dist","build",".pytest_cache",".mypy_cache",".ruff_cache",".coverage","htmlcov","__pycache__" -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "✅ Cleaned" -ForegroundColor Green
    }
    "phase-status" {
        Write-Host "Phase 0  ✅ 协议化 — 18 specs Accepted (2026-06-15)" -ForegroundColor Green
        Write-Host "Phase 1  🟢 进行中 — MVP 闭环" -ForegroundColor Yellow
        Write-Host "  M1.1   工程地基              [in_progress]"
        Write-Host "  M1.2   共享 Schema 包        [pending]"
        Write-Host "  M1.3   Runtime 核心          [pending]"
        Write-Host "  M1.4   AgentAdapter 首发两家 [pending]"
        Write-Host "  M1.5   桌面 Shell            [pending]"
        Write-Host "  M1.6   端到端 demo + 工程基线 [pending]"
        Write-Host "Phase 2  ⚪ 待启动 — 自动规划 + 草案编辑"
        Write-Host "Phase 3  ⚪ 待启动 — MCCL 强化 + 多 Adapter"
        Write-Host "Phase 4  ⚪ 待启动 — 团队化 / 模板化 / 生态"
    }
}
