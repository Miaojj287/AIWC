#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT="${PROJECT_ROOT}/resources/macos/wechat_memory_scan_helper"
CLI_OUTPUT="${PROJECT_ROOT}/AIWC-CLI/native/darwin-arm64/wechat_memory_scan_helper"

/usr/bin/clang -O2 -Wall -Wextra -Werror -fblocks "${SCRIPT_DIR}/main.c" -o "${OUTPUT}"
/usr/bin/codesign --force --sign - \
  --entitlements "${PROJECT_ROOT}/resources/macos/image_scan_entitlements.plist" \
  "${OUTPUT}"
mkdir -p "$(dirname "${CLI_OUTPUT}")"
cp "${OUTPUT}" "${CLI_OUTPUT}"
echo "Built ${OUTPUT}"
echo "Synced ${CLI_OUTPUT}"
