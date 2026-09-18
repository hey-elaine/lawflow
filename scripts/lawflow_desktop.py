"""macOS desktop launcher for the local LawFlow web application."""
from __future__ import annotations

import signal
import threading
import time
import webbrowser
import os

import uvicorn

from app.main import app


def main() -> None:
    port = int(os.getenv("LAWFLOW_PORT", "8080"))
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
