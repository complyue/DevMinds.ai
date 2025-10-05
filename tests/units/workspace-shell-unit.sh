#!/usr/bin/env bash
set -euo pipefail

# Unit: restricted workspace.shell allowlist and path guards
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-unit-shell-$(date +%Y%m%d-%H%M%S).log"

if command -v pnpm >/dev/null 2>&1; then
  TSX_RUN="pnpm dlx tsx"
else
  TSX_RUN="npx -y tsx"
fi

# Start backend in unit workspace (reusing backend tsx runtime env)
( cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/tools/shell_runner.ts" >"$LOG_FILE" 2>&1 & echo $! >"$LOG_FILE.pid" ) || { echo "[unit][fail] failed to run shell_runner"; exit 1; }
PID="$(cat "$LOG_FILE.pid" || true)"
[[ -z "${PID:-}" ]] && PID=$!

# Wait for summary file
SUMMARY_PATH="$TEST_WS_DIR/.tasklogs/$TASK_ID/shell-summary.json"
for i in $(seq 1 60); do
  [[ -f "$SUMMARY_PATH" ]] && break
  sleep 0.1
done

test -f "$SUMMARY_PATH" || { echo "[unit][fail] shell-summary.json missing"; kill "$PID" || true; exit 1; }
# Validate using Node to avoid grep ambiguity
node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));const okAllowed=Array.isArray(j.allowed)&&j.allowed.includes("echo")&&j.allowed.includes("ls");if(!okAllowed){console.error("[unit][fail] allowlist missing echo/ls");console.log(j);process.exit(1);}const okRm=(j.disallowedErr||"").includes("Command not allowed: rm");const okOutside=(j.outsideErr||"").includes("Path outside workspace not allowed");if(!okRm||!okOutside){console.error("[unit][fail] disallow checks failed");console.log(j);process.exit(1);}console.log("[unit][ok] workspace.shell allowlist + path guard validated");' "$SUMMARY_PATH"

# Kill runner if still alive
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
fi
