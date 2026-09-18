#!/usr/bin/env python3
"""LawFlow local API helper for Agent Skill use."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_API = "http://127.0.0.1:8080"


def request(api: str, method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    call = urllib.request.Request(api.rstrip("/") + path, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(call, timeout=190) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8")).get("detail", str(error))
        except Exception:
            detail = str(error)
        raise SystemExit(detail) from error
    except urllib.error.URLError as error:
        raise SystemExit(f"无法连接 LawFlow 本地服务（{api}）：{error.reason}。请先启动应用。") from error


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="LawFlow local API CLI")
    root.add_argument("--api", default=DEFAULT_API)
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    commands.add_parser("projects")

    context = commands.add_parser("host-context")
    context.add_argument("--project-id", required=True)
    context.add_argument("--document-id", default="")

    save = commands.add_parser("host-save")
    save.add_argument("--project-id", required=True)
    save.add_argument("--document-id", required=True)
    save.add_argument("--title", required=True)
    save.add_argument("--markdown-file", required=True)
    save.add_argument("--source-block-ids", required=True)
    save.add_argument("--style-profile", default="law_podcast_v4")

    outline = commands.add_parser("app-outline")
    outline.add_argument("--project-id", required=True)
    outline.add_argument("--document-id", required=True)
    outline.add_argument("--title", required=True)
    outline.add_argument("--source-block-ids", required=True)
    outline.add_argument("--style-profile", default="law_podcast_v4")

    generate = commands.add_parser("app-generate")
    generate.add_argument("--outline-id", required=True)
    export = commands.add_parser("export-narrative")
    export.add_argument("--content-id", required=True)
    return root


def main() -> None:
    args = parser().parse_args()
    if args.command == "status":
        result = request(args.api, "GET", "/api/skill/status")
    elif args.command == "projects":
        result = request(args.api, "GET", "/api/projects")
    elif args.command == "host-context":
        query = urllib.parse.urlencode({"document_id": args.document_id})
        result = request(args.api, "GET", f"/api/skill/projects/{args.project_id}/context?{query}")
    elif args.command == "host-save":
        result = request(args.api, "POST", f"/api/projects/{args.project_id}/skill-host-contents", {
            "document_id": args.document_id, "title": args.title,
            "markdown": Path(args.markdown_file).read_text(encoding="utf-8"),
            "source_block_ids": [value for value in args.source_block_ids.split(",") if value],
            "style_profile": args.style_profile,
        })
    elif args.command == "app-outline":
        result = request(args.api, "POST", f"/api/projects/{args.project_id}/narrative-outlines", {
            "document_id": args.document_id, "title": args.title,
            "source_block_ids": [value for value in args.source_block_ids.split(",") if value],
            "style_profile": args.style_profile,
        })
    elif args.command == "app-generate":
        result = request(args.api, "POST", f"/api/narrative-outlines/{args.outline_id}/contents")
    else:
        result = request(args.api, "POST", f"/api/narrative-contents/{args.content_id}/export")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
