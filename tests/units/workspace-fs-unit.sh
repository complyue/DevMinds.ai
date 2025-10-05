#!/usr/bin/env bash
set -euo pipefail

# Unit: restricted workspace.fs only allows .minds/.tasklogs under tests workspace cwd
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"

if command -v pnpm >/dev/null 2>&1; then
  TSX_RUN="pnpm dlx tsx"
else
  TSX_RUN="npx -y tsx"
fi

mkdir -p "$TEST_WS_DIR/.minds" "$TEST_WS_DIR/.tasklogs"

OUT_JSON="$( (cd "$TEST_WS_DIR" && $TSX_RUN "$ROOT_DIR/packages/backend/src/tools/fs_runner.ts" --okPath ".minds/tools-fs-unit.txt" --badPath "../outside.txt") )"

echo "$OUT_JSON" | grep -q '"okAllowed":true'      || { echo "[unit][fail] okAllowed not true"; echo "$OUT_JSON"; exit 1; }
echo "$OUT_JSON" | grep -q '"badDenied":true'       || { echo "[unit][fail] badDenied not true"; echo "$OUT_JSON"; exit 1; }
echo "$OUT_JSON" | grep -q '"readBack":"hello-tools-fs"' || { echo "[unit][fail] readBack mismatch"; echo "$OUT_JSON"; exit 1; }
echo "[unit][ok] workspace.fs restrictions validated"
