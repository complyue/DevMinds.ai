#!/usr/bin/env bash
set -euo pipefail

# Unit: ask minimal loop (request/response) persistence and meta increment
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-unit-ask-$(date +%Y%m%d-%H%M%S).log"

if command -v pnpm >/dev/null 2>&1; then
  TSX_RUN="pnpm dlx tsx"
else
  TSX_RUN="npx -y tsx"
fi

# Run ask runner in unit workspace (foreground, no background to avoid race/overwrites)
( cd "$TEST_WS_DIR" && $TSX_RUN "$ROOT_DIR/packages/backend/src/tools/ask_runner.ts" ) || { echo "[unit][fail] failed to run ask_runner"; exit 1; }

DATE="$(date +"%Y%m%d")"
EVENTS_FILE="$TEST_WS_DIR/.tasklogs/$TASK_ID/events-$DATE.jsonl"
META_PATH="$TEST_WS_DIR/.tasklogs/$TASK_ID/meta.json"

# Check outputs exist
test -f "$EVENTS_FILE" || { echo "[unit][fail] events file missing"; exit 1; }
test -f "$META_PATH" || { echo "[unit][fail] meta.json missing"; exit 1; }

# Validate events using Node (avoid grep ambiguity)
node -e 'const fs=require("fs");const ef=process.argv[1];const lines=fs.readFileSync(ef,"utf8").trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));const hasReq=lines.some(l=>l.type==="agent.ask.request");const hasRes=lines.some(l=>l.type==="agent.ask.response");if(!hasReq||!hasRes){console.error("[unit][fail] ask events missing");console.log(lines.slice(-10));process.exit(1);}console.log("[unit][ok] ask events found");' "$EVENTS_FILE"

# Validate meta via Node
node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));const c=j.counts||{};if(!c["agent.ask.request"]||!c["agent.ask.response"]){console.error("[unit][fail] meta counts missing");console.log(j);process.exit(1);}if(!j.lastTs){console.error("[unit][fail] lastTs missing");console.log(j);process.exit(1);}console.log("[unit][ok] ask minimal loop persisted and meta updated");' "$META_PATH"
