"""cw-runtime CLI entry point."""

from __future__ import annotations

import argparse
import socket
import sys
from typing import NoReturn

from cw_runtime.api import RuntimeDependencyError, create_app
from cw_runtime.settings import RuntimeSettings, RuntimeSettingsError


def _serve(settings: RuntimeSettings) -> int:
    try:
        uvicorn = __import__("uvicorn")
    except ModuleNotFoundError as exc:
        if exc.name == "uvicorn":
            raise RuntimeDependencyError(
                "Install the cw_runtime runtime extra before serving the sidecar API."
            ) from exc
        raise

    app = create_app(settings)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((settings.host, settings.port))
    sock.listen(128)
    actual_port = int(sock.getsockname()[1])
    print(f"READY {actual_port}", flush=True)

    config = uvicorn.Config(
        app,
        host=settings.host,
        port=actual_port,
        log_level="info" if settings.dev else "warning",
    )
    server = uvicorn.Server(config)
    server.run(sockets=[sock])
    return 0


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="cw-runtime", description="CognitiveWorkflow Python sidecar")
    parser.add_argument("--http-port", type=int, default=0, help="HTTP 端口（0 = OS 选）")
    parser.add_argument("--dev", action="store_true", help="开发模式")
    parser.add_argument("--version", action="version", version="0.1.0")
    return parser.parse_args(argv)


def main() -> NoReturn:
    args = _parse_args()
    try:
        settings = RuntimeSettings.from_environment(http_port=args.http_port, dev=args.dev)
        exit_code = _serve(settings)
    except (RuntimeSettingsError, RuntimeDependencyError, ValueError) as exc:
        print(f"[cw-runtime] error: {exc}", file=sys.stderr)
        sys.exit(2)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
