"""macOS desktop launcher for the local LawFlow web application."""
from __future__ import annotations

import signal
import socket
import sqlite3
import threading
import time
import webbrowser
import os
import shutil
from pathlib import Path

import uvicorn


def project_count(db_path: Path) -> int:
    if not db_path.is_file():
        return 0
    try:
        with sqlite3.connect(db_path) as conn:
            return int(conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0])
    except (sqlite3.DatabaseError, sqlite3.OperationalError):
        return 0


def migrate_legacy_data(data_dir: Path, legacy_dir: Path) -> bool:
    """首次启动桌面版时，把开发版数据安全复制到 Application Support。"""
    if data_dir.resolve() == legacy_dir.resolve():
        return False
    if project_count(data_dir / "app.db") or not project_count(legacy_dir / "app.db"):
        return False
    data_dir.parent.mkdir(parents=True, exist_ok=True)
    if data_dir.exists() and any(data_dir.iterdir()):
        backup = data_dir.parent / "migration-backups" / ("before-legacy-import-" + time.strftime("%Y%m%d-%H%M%S"))
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(data_dir, backup)
    shutil.copytree(legacy_dir, data_dir, dirs_exist_ok=True)
    return True


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
    data_dir = Path(os.getenv("LAWFLOW_DATA_DIR", str(Path.home() / "Library/Application Support/LawFlow/data"))).expanduser()
    legacy_dir = Path(os.getenv("LAWFLOW_LEGACY_DATA_DIR", str(Path.home() / "Projects/lawflow/data"))).expanduser()
    migrate_legacy_data(data_dir, legacy_dir)
    os.environ["LAWFLOW_DATA_DIR"] = str(data_dir)
    from app.main import app

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
