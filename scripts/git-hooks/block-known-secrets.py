#!/usr/bin/env python
"""block-known-secrets.py — 拦截已知凭证前缀进入 git commit。

跨平台 pre-commit hook，与 Bash 版等价（block-known-secrets.sh）。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# 已知凭证模式（保守集合，避免误伤）
# 注意：本文件自身含示例 pattern，故文件名 / 路径自动豁免
PATTERNS = [
    (re.compile(rb"sk-ant-[A-Za-z0-9_-]{20,}"), "Anthropic API key"),
    (re.compile(rb"sk-proj-[A-Za-z0-9_-]{20,}"), "OpenAI project key"),
    (re.compile(rb"sk-[A-Za-z0-9]{32,}"), "OpenAI legacy key"),
    (re.compile(rb"AKIA[0-9A-Z]{16}"), "AWS Access Key"),
    (re.compile(rb"AIza[0-9A-Za-z_-]{35}"), "Google API key"),
    (re.compile(rb"ghp_[A-Za-z0-9]{36}"), "GitHub PAT"),
    (re.compile(rb"gho_[A-Za-z0-9]{36}"), "GitHub OAuth"),
    (re.compile(rb"glpat-[A-Za-z0-9_-]{20}"), "GitLab PAT"),
]

# 自我豁免路径（含 hook 自身 / 文档 / spec 中的"凭证示例"说明）
ALLOWLIST_PATHS = [
    re.compile(r"scripts/git-hooks/block-known-secrets\.(py|sh)$"),
    re.compile(r"\.gitignore$"),
]

MAX_BYTES = 1_048_576  # 1 MiB


def main(argv: list[str]) -> int:
    bad = 0
    for raw in argv[1:]:
        normalized = raw.replace("\\", "/")
        if any(p.search(normalized) for p in ALLOWLIST_PATHS):
            continue

        path = Path(raw)
        if not path.is_file():
            continue
        if path.stat().st_size > MAX_BYTES:
            continue

        try:
            content = path.read_bytes()
        except OSError:
            continue

        for regex, label in PATTERNS:
            for match in regex.finditer(content):
                # 计算行号
                line_no = content[: match.start()].count(b"\n") + 1
                print(
                    f"❌ {raw}:{line_no}  疑似凭证（{label}）",
                    file=sys.stderr,
                )
                bad += 1

    if bad:
        print("", file=sys.stderr)
        print("   若属误伤：", file=sys.stderr)
        print("   - 把字符串移到 .agent-workflow/secure/secrets.encrypted.sqlite", file=sys.stderr)
        print("   - 通过 secret_ref 间接引用（specs/runtime_harness.md §2.8）", file=sys.stderr)
        print("   - 或在 ALLOWLIST_PATHS 内显式豁免该文件", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
