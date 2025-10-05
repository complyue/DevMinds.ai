#!/usr/bin/env bash
set -euo pipefail

# Run all case tests sequentially, fail on first error.
# 可通过环境变量 PORT/TASK_ID/TEST_WS_DIR/MOCK_DIR 覆盖默认值。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_case() {
  local name="$1"
  echo "================ CASE: $name ================"
  # Ensure previous backend is stopped to free port
  bash "$ROOT_DIR/tests/cases/_helpers/stop-backend.sh" || true
  bash "$ROOT_DIR/tests/cases/$name.sh"
  # Stop backend after case to avoid port conflicts
  bash "$ROOT_DIR/tests/cases/_helpers/stop-backend.sh" || true
  echo "================ PASS: $name ================"
}

# 目前已有：
run_case "run-prompt-flow"

# 新增：
run_case "cancel-flow"
run_case "delta-flow"
run_case "ws-reconnect-flow"
run_case "tool-cancel-flow"
run_case "events-pagination-flow"
run_case "events-index-flow"
run_case "tool-echo-flow"
run_case "ask-flow"
echo "All case tests passed."
