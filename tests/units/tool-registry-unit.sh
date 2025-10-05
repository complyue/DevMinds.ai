#!/usr/bin/env bash
set -euo pipefail

# Unit: ToolRegistry minimal runner
ROOT="$(pwd)"

echo "[unit] run registry runner"
node "./packages/backend/dist/tools/registry_runner.js" > /tmp/registry.out 2>/tmp/registry.err || true

OUT="$(cat /tmp/registry.out || echo)"
if echo "$OUT" | grep -q '"echoed":"hello-tool"'; then
  echo "[unit][ok] ToolRegistry registered and executed echo tool"
  exit 0
else
  echo "[unit][fail] ToolRegistry echo failed; output: $OUT"
  exit 1
fi
