"""macOS desktop launcher for the local LawFlow web application."""
from __future__ import annotations

import signal
import socket
import threading
import time
import webbrowser
import os

import uvicorn

from app.main import app


def choose_port() -> int:
    requested = os.getenv("LAWFLOW_PORT")
    candidates = [int(requested)] if requested else list(range(8080, 8090))
    for port in candidates:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("LawFlow 无法找到可用的本地端口，请关闭占用 8080–8089 的程序后重试。")


def main() -> None:
    port = choose_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    worker = threading.Thread(target=server.run, daemon=True)
    worker.start()
    for _ in range(100):
        if server.started:
            webbrowser.open(f"http://127.0.0.1:{port}")
            break
        time.sleep(0.1)

    def stop(*_args):
        server.should_exit = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    worker.join()


if __name__ == "__main__":
    main()
