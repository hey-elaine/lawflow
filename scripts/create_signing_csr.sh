#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BUILD_DIR="$ROOT_DIR/build"
KEY_PATH="$BUILD_DIR/lawflow-code-signing.key"
CSR_PATH="$BUILD_DIR/lawflow-code-signing.csr"

mkdir -p "$BUILD_DIR"

if [[ -f "$KEY_PATH" || -f "$CSR_PATH" ]]; then
  echo "已存在 $KEY_PATH 或 $CSR_PATH；如需重新生成，请先删除旧文件。" >&2
  exit 1
fi

openssl req \
  -new \
  -newkey rsa:2048 \
  -nodes \
  -keyout "$KEY_PATH" \
  -out "$CSR_PATH" \
  -subj "/CN=LawFlow Developer ID Application/O=hey-elaine/C=CN"

echo "私钥：$KEY_PATH"
echo "CSR：$CSR_PATH"
echo "请把 CSR 上传到 Apple Developer 后台，下载 .cer 证书后放入 build/，再运行导入命令。"
