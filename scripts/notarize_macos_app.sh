#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "用法：$0 /path/to/LawFlow.dmg" >&2
  exit 2
fi

DMG_PATH=$1
: "${APPLE_API_KEY_PATH:?缺少 APPLE_API_KEY_PATH}"
: "${APPLE_API_KEY_ID:?缺少 APPLE_API_KEY_ID}"
: "${APPLE_API_ISSUER_ID:?缺少 APPLE_API_ISSUER_ID}"

if [[ ! -f "$DMG_PATH" ]]; then
  echo "安装包不存在：$DMG_PATH" >&2
  exit 1
fi

xcrun notarytool submit "$DMG_PATH" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER_ID" \
  --wait
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"
shasum -a 256 "$DMG_PATH" > "$DMG_PATH.sha256"
