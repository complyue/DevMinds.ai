#!/usr/bin/env bash
set -euo pipefail

# Run all case tests sequentially, fail on first error.
# 可通过环境变量 PORT/TASK_ID/TEST_WS_DIR/MOCK_DIR 覆盖默认值。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_case() {
  local name="$1"
  echo "================ CASE: $name ================"
  bash "$ROOT_DIR/tests/cases/$name.sh"
  echo "================ PASS: $name ================"
}

# 目前已有：
run_case "run-prompt-flow"

# 新增：
run_case "cancel-flow"
run_case "delta-flow"
run_case "ws-reconnect-flow"
run_case "tool-cancel-flow"
run_case "ws-reconnect-flow"

echo "All case tests passed."
