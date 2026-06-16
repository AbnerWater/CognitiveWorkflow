#!/usr/bin/env python
"""block-secure-paths.py — 拦截 .agent-workflow/secure/** 与 cache/** 入 git。

跨平台 pre-commit hook，与 Bash 版等价（block-secure-paths.sh）。
保留 .sh 作为非 Windows 用户的本地 git hooks 备选。
"""

from __future__ import annotations

import re
import sys

BLOCKED_PATTERNS = [
    re.compile(r".*\.agent-workflow/secure/"),
    re.compile(r".*\.agent-workflow/cache/"),
    re.compile(r".*\.agent-workflow/locks/"),
    re.compile(r".*\.agent-workflow/traces/"),
    re.compile(r".*\.encrypted\.sqlite(?:-wal|-shm)?$"),
]


def main(argv: list[str]) -> int:
    blocked = []
    for f in argv[1:]:
        normalized = f.replace("\\", "/")
        for pat in BLOCKED_PATTERNS:
            if pat.match(normalized):
                blocked.append(f)
                break

    if blocked:
        print("❌ 拦截以下文件入 git（CW D-RH-3 / D-RH-6）:", file=sys.stderr)
        for f in blocked:
            print(f"   - {f}", file=sys.stderr)
        print("", file=sys.stderr)
        print("   secure/ / cache/ / locks/ / traces/ 与 *.encrypted.sqlite 永不进 git。", file=sys.stderr)
        print("   若误添加：git rm --cached <path>", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
