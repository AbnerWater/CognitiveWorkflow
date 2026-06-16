"""cw-runtime CLI entry point — placeholder for M1.1 phase.

实际 FastAPI 启动逻辑在 M1.3 milestone 落实。
"""

from __future__ import annotations

import argparse
import sys
from typing import NoReturn


def main() -> NoReturn:
    parser = argparse.ArgumentParser(prog="cw-runtime", description="CognitiveWorkflow Python sidecar")
    parser.add_argument("--http-port", type=int, default=0, help="HTTP 端口（0 = OS 选）")
    parser.add_argument("--dev", action="store_true", help="开发模式")
    parser.add_argument("--version", action="version", version="0.1.0")
    args = parser.parse_args()

    print(f"[cw-runtime] M1.1 stub. http_port={args.http_port} dev={args.dev}", file=sys.stderr)
    print("[cw-runtime] FastAPI 启动逻辑将在 M1.3 落实。", file=sys.stderr)
    print("READY 0", flush=True)  # 主进程截获模式：READY <port>
    sys.exit(0)


if __name__ == "__main__":
    main()
