#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

APP_VERSION=${LAWFLOW_VERSION:-$(python3 -c 'from app.version import __version__; print(__version__)')}
ARCHITECTURE=$(uname -m)
APP_PATH="$ROOT_DIR/dist/LawFlow.app"
DMG_PATH="$ROOT_DIR/dist/LawFlow-${APP_VERSION}-macOS-${ARCHITECTURE}.dmg"
SIGNING_IDENTITY=${LAWFLOW_SIGNING_IDENTITY:-}
REQUIRE_SIGNING=${LAWFLOW_REQUIRE_SIGNING:-0}

rm -rf "$ROOT_DIR/build" "$APP_PATH"
rm -f "$DMG_PATH" "$DMG_PATH.sha256"

pyinstaller \
  --noconfirm \
  --windowed \
  --name LawFlow \
  --osx-bundle-identifier com.donghyq.lawflow \
  --paths "$ROOT_DIR" \
  --add-data "app/static:app/static" \
  --collect-data setuptools \
  --collect-all mcp \
  scripts/lawflow_desktop.py

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_VERSION" "$APP_PATH/Contents/Info.plist"

if [[ -n "$SIGNING_IDENTITY" ]]; then
  codesign --force --deep --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$APP_PATH"
elif [[ "$REQUIRE_SIGNING" == "1" ]]; then
  echo "LAWFLOW_REQUIRE_SIGNING=1，但未配置 LAWFLOW_SIGNING_IDENTITY。" >&2
  exit 1
else
  echo "未配置 Developer ID，仅生成供开发验证的临时签名安装包。" >&2
  codesign --force --deep --sign - "$APP_PATH"
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
hdiutil create -volname "LawFlow" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"
shasum -a 256 "$DMG_PATH" > "$DMG_PATH.sha256"

echo "$DMG_PATH"