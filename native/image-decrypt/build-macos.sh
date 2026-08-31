#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CARGO_BIN="$(command -v cargo || true)"
if [[ -z "${CARGO_BIN}" && -x "${HOME}/.cargo/bin/cargo" ]]; then
  CARGO_BIN="${HOME}/.cargo/bin/cargo"
fi
if [[ -z "${CARGO_BIN}" ]]; then
  echo "cargo not found; install a Rust toolchain first" >&2
  exit 1
fi

"${CARGO_BIN}" test --manifest-path "${SCRIPT_DIR}/Cargo.toml"
"${CARGO_BIN}" build --manifest-path "${SCRIPT_DIR}/Cargo.toml" --release

SOURCE="${SCRIPT_DIR}/target/release/libaiwc_image_native.dylib"
DESKTOP_OUTPUT="${PROJECT_ROOT}/resources/wedecrypt/aiwc-image-native-macos-arm64.node"
CLI_OUTPUT="${PROJECT_ROOT}/AIWC-CLI/native/darwin-arm64/aiwc-image-native-macos-arm64.node"
node "${PROJECT_ROOT}/scripts/sync-image-native.cjs" \
  --platform macos --arch arm64 --lib "${SOURCE}"
cp "${SOURCE}" "${CLI_OUTPUT}"
echo "Synced ${DESKTOP_OUTPUT}"
echo "Synced ${CLI_OUTPUT}"
