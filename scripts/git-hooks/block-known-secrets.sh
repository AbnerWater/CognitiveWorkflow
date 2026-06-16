#!/usr/bin/env bash
# 拦截已知凭证前缀进入 commit
# 简单正则；对所有 staged 文本文件执行
set -euo pipefail

# 已知凭证模式（保守集合，避免误伤）
patterns=(
    'sk-ant-[A-Za-z0-9_-]{20,}'                    # Anthropic API key
    'sk-proj-[A-Za-z0-9_-]{20,}'                   # OpenAI project key
    'sk-[A-Za-z0-9]{32,}'                          # OpenAI legacy key
    'AKIA[0-9A-Z]{16}'                             # AWS Access Key
    'AIza[0-9A-Za-z_-]{35}'                        # Google API key
    'ghp_[A-Za-z0-9]{36}'                          # GitHub PAT
    'gho_[A-Za-z0-9]{36}'                          # GitHub OAuth
    'glpat-[A-Za-z0-9_-]{20}'                      # GitLab PAT
)

bad=0
for f in "$@"; do
    [ -f "$f" ] || continue

    # 跳过二进制 / 大文件
    if [ "$(wc -c < "$f")" -gt 1048576 ]; then continue; fi

    for p in "${patterns[@]}"; do
        if grep -nE "$p" "$f" >/dev/null 2>&1; then
            echo "❌ $f 中检测到疑似凭证（pattern: $p）" >&2
            grep -nE "$p" "$f" >&2 || true
            bad=1
        fi
    done
done

if [ $bad -ne 0 ]; then
    echo "" >&2
    echo "   若属误伤，请把字符串移到 .agent-workflow/secure/secrets.encrypted.sqlite，" >&2
    echo "   并通过 secret_ref 间接引用（参考 specs/runtime_harness.md §2.8）。" >&2
    exit 1
fi
