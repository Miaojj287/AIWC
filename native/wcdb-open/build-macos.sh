#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="${TMPDIR:-/tmp}/aiwc-wcdb-open-v2.1.15"
EXPECTED_COMMIT="a62d7f12191843e1f095e3c37f46785ed04ebde8"
OUTPUT_PATH="$PROJECT_ROOT/resources/macos/libWCDBOpen.dylib"
CLI_OUTPUT_PATH="$PROJECT_ROOT/AIWC-CLI/native/darwin-arm64/libWCDBOpen.dylib"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/Tencent/wcdb.git "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" fetch --depth 1 origin tag v2.1.15
git -C "$SOURCE_DIR" checkout --detach FETCH_HEAD

ACTUAL_COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$EXPECTED_COMMIT" ]]; then
  echo "WCDB source verification failed: expected $EXPECTED_COMMIT, got $ACTUAL_COMMIT" >&2
  exit 1
fi

swift build --package-path "$SOURCE_DIR" -c release --product WCDBSwiftDynamic
BUILT_LIBRARY="$(find "$SOURCE_DIR/.build" -path '*/release/libWCDBSwiftDynamic.dylib' -type f -print -quit)"
if [[ -z "$BUILT_LIBRARY" ]]; then
  echo "WCDB build completed but libWCDBSwiftDynamic.dylib was not found" >&2
  exit 1
fi

cp "$BUILT_LIBRARY" "$OUTPUT_PATH"
install_name_tool -id '@rpath/libWCDBOpen.dylib' "$OUTPUT_PATH"
codesign --force --sign - "$OUTPUT_PATH"
mkdir -p "$(dirname "$CLI_OUTPUT_PATH")"
cp "$OUTPUT_PATH" "$CLI_OUTPUT_PATH"
echo "Built $OUTPUT_PATH"
echo "Synced $CLI_OUTPUT_PATH"
