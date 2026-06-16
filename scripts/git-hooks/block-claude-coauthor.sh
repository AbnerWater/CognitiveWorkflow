#!/usr/bin/env bash
# 拦截 commit message 内 Co-Authored-By: Claude trailer
# 触发：commit-msg stage
set -euo pipefail

msg_file="${1:-.git/COMMIT_EDITMSG}"
[ -f "$msg_file" ] || exit 0

if grep -iE 'Co-Authored-By:.*Claude' "$msg_file" >/dev/null 2>&1; then
    echo "❌ commit message 含 'Co-Authored-By: Claude' trailer。" >&2
    echo "   按 AGENTS.md §3.5 规则：commit 必须以用户为唯一作者。" >&2
    exit 1
fi
