#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
PORT="5175"
TASK="DEMO"
TEST_WS="$ROOT/tests/units/works/unit-ws"
LOG_DIR="$ROOT/tests/cases/.logs"
DATE="$(date +%Y%m%d)"

source "$ROOT/tests/cases/_helpers/start-backend-in-ws.sh"

echo "[case:tool-echo] start backend"
bash "$ROOT/tests/cases/_helpers/start-backend-in-ws.sh" "$PORT" "$TEST_WS" "$LOG_DIR"

echo "[case:tool-echo] trigger echo tool"
curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK/tool/echo" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello echo"}' >/dev/null

sleep 0.3

EV_PATH="$TEST_WS/.tasklogs/$TASK/events-$DATE.jsonl"
test -f "$EV_PATH"

REQ_COUNT="$(grep -c '"type":"agent.tool.echo"' "$EV_PATH" || true)"
if [ "$REQ_COUNT" -lt 1 ]; then
  echo "[case:tool-echo][fail] no agent.tool.echo found"
  bash "$ROOT/tests/cases/_helpers/stop-backend.sh" || true
  exit 1
fi

META_PATH="$TEST_WS/.tasklogs/$TASK/meta.json"
test -f "$META_PATH"

COUNT_ECHO="$(node -e 'const f=process.argv[1]; const j=require("fs").readFileSync(f,"utf8"); const o=JSON.parse(j); console.log((o.counts||{})["agent.tool.echo"]||0);' "$META_PATH")"
if [ "$COUNT_ECHO" -lt 1 ]; then
  echo "[case:tool-echo][fail] meta.json counts not updated"
  bash "$ROOT/tests/cases/_helpers/stop-backend.sh" || true
  exit 1
fi

echo "[case:tool-echo][ok] echo event persisted and meta updated"
bash "$ROOT/tests/cases/_helpers/stop-backend.sh" || true
