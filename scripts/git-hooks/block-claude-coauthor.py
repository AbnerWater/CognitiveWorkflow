#!/usr/bin/env python
"""block-claude-coauthor.py — 拦截 commit message 内 Co-Authored-By Claude trailer。

触发：commit-msg stage
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PATTERN = re.compile(r"Co-Authored-By:.*Claude", re.IGNORECASE)


def main(argv: list[str]) -> int:
    msg_file = Path(argv[1] if len(argv) > 1 else ".git/COMMIT_EDITMSG")
    if not msg_file.exists():
        return 0

    text = msg_file.read_text(encoding="utf-8", errors="replace")
    if PATTERN.search(text):
        print("❌ commit message 含 'Co-Authored-By: Claude' trailer。", file=sys.stderr)
        print("   按 AGENTS.md §3.5 规则：commit 必须以用户为唯一作者。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
