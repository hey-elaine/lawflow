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


def request_text(api: str, method: str, path: str) -> dict:
    call = urllib.request.Request(api.rstrip("/") + path, method=method)
    try:
        with urllib.request.urlopen(call, timeout=190) as response:
            return {"content": response.read().decode("utf-8")}
    except urllib.error.HTTPError as error:
        raise SystemExit(error.read().decode("utf-8", errors="replace")) from error
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
    regenerate = commands.add_parser("regenerate-section")
    regenerate.add_argument("--content-id", required=True)
    regenerate.add_argument("--section-id", required=True)
    section_export = commands.add_parser("export-section")
    section_export.add_argument("--content-id", required=True)
    section_export.add_argument("--section-id", required=True)
    profile_export = commands.add_parser("export-profile")
    profile_export.add_argument("--profile-id", required=True)
    profile_import = commands.add_parser("import-profile")
    profile_import.add_argument("--markdown-file", required=True)
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
    elif args.command == "regenerate-section":
        result = request(args.api, "POST", f"/api/narrative-contents/{args.content_id}/sections/{urllib.parse.quote(args.section_id, safe='')}/regenerate")
    elif args.command == "export-section":
        result = request(args.api, "POST", f"/api/narrative-contents/{args.content_id}/sections/{urllib.parse.quote(args.section_id, safe='')}/export")
    elif args.command == "export-profile":
        result = request_text(args.api, "GET", f"/api/narrative/profiles/{urllib.parse.quote(args.profile_id, safe='')}/export")
    elif args.command == "import-profile":
        result = request(args.api, "POST", "/api/narrative/profiles/import", {"markdown": Path(args.markdown_file).read_text(encoding="utf-8")})
    else:
        result = request(args.api, "POST", f"/api/narrative-contents/{args.content_id}/export")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
