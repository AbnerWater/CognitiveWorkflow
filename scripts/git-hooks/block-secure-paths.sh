#!/usr/bin/env bash
# 拦截 .agent-workflow/secure/** 与 .agent-workflow/cache/** 入 git
# 触发：每次 commit 前；命中 → 阻塞
set -euo pipefail

blocked=()

for f in "$@"; do
    case "$f" in
        *.agent-workflow/secure/*|*.agent-workflow/cache/*|*.agent-workflow/locks/*|*.agent-workflow/traces/*)
            blocked+=("$f")
            ;;
        *.encrypted.sqlite|*.encrypted.sqlite-wal|*.encrypted.sqlite-shm)
            blocked+=("$f")
            ;;
    esac
done

if [ ${#blocked[@]} -gt 0 ]; then
    echo "❌ 拦截以下文件入 git（CW D-RH-3 / D-RH-6）:" >&2
    printf '   - %s\n' "${blocked[@]}" >&2
    echo "" >&2
    echo "   secure/ / cache/ / locks/ / traces/ 与 *.encrypted.sqlite 永不进 git。" >&2
    echo "   若误添加，请运行：git rm --cached <path>" >&2
    exit 1
fi
