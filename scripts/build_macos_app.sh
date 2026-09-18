#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"
rm -rf build dist/LawFlow.app
pyinstaller --noconfirm --windowed --name LawFlow --osx-bundle-identifier com.donghyq.lawflow --paths "$ROOT_DIR" --add-data "app/static:app/static" --collect-data setuptools scripts/lawflow_desktop.py
codesign --force --deep --sign - dist/LawFlow.app
