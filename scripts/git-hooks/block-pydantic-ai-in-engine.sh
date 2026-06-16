#!/usr/bin/env bash
# 拦截 Engine / Compiler / MCCL / nodes / memory 等模块直接 import pydantic_ai
# 触发条件：受限路径下的 .py 改动
# ADR-0002：所有 LLM 调用必须经 AgentAdapter 协议
set -euo pipefail

bad=0

for f in "$@"; do
    [ -f "$f" ] || continue

    # 仅允许在 adapters/ 子包内 import pydantic_ai
    case "$f" in
        */cw_runtime/adapters/*) continue ;;
    esac

    if grep -nE '^\s*(import|from)\s+pydantic_ai(\s|\.|$)' "$f" >/dev/null 2>&1; then
        echo "❌ $f 中检测到 pydantic_ai import" >&2
        grep -nE '^\s*(import|from)\s+pydantic_ai(\s|\.|$)' "$f" >&2 || true
        bad=1
    fi
done

if [ $bad -ne 0 ]; then
    echo "" >&2
    echo "   ADR-0002：Engine / Compiler / MCCL / nodes 等模块禁止直接依赖 pydantic_ai。" >&2
    echo "   所有 LLM 调用必须经 cw_runtime.adapters.base.AgentAdapter 协议。" >&2
    exit 1
fi
