#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_SOURCE="$TASK_ROOT/native/wechat-codec"
TASK_BUILD="$(mktemp -d "${TMPDIR:-/tmp}/aiwc-codec-build.XXXXXX")"
trap 'rm -rf "$TASK_BUILD"' EXIT

TASK_FLAGS=(-Wall -Wextra -Werror -Wno-deprecated-declarations -O2 -mmacosx-version-min=12.0)
TASK_SOURCES=("$TASK_SOURCE/codecCrypto.c" "$TASK_SOURCE/codecMetadata.c" "$TASK_SOURCE/codecScan.c" "$TASK_SOURCE/codecOutput.c")

xcrun clang "${TASK_FLAGS[@]}" -arch arm64 "${TASK_SOURCES[@]}" \
  "$TASK_SOURCE/codecSelftest.c" -o "$TASK_BUILD/codecSelftest"
"$TASK_BUILD/codecSelftest"
xcrun clang "${TASK_FLAGS[@]}" -arch arm64 "${TASK_SOURCES[@]}" \
  "$TASK_SOURCE/codecMain.c" -o "$TASK_BUILD/wechat_codec_helper-arm64"
xcrun clang "${TASK_FLAGS[@]}" -arch x86_64 "$TASK_SOURCE/codecUnsupported.c" \
  -o "$TASK_BUILD/wechat_codec_helper-x64"

for TASK_ARCH in arm64 x64; do
  TASK_TARGET="$TASK_ROOT/resources/native/darwin-$TASK_ARCH/wechat_codec_helper"
  mkdir -p "$(dirname "$TASK_TARGET")"
  cp "$TASK_BUILD/wechat_codec_helper-$TASK_ARCH" "$TASK_TARGET"
  /usr/bin/codesign --force --sign - --entitlements \
    "$TASK_ROOT/resources/macos/helper.entitlements.plist" --options runtime "$TASK_TARGET"
  /usr/bin/shasum -a 256 "$TASK_TARGET"
done
