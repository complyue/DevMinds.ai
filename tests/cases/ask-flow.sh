#!/usr/bin/env bash
set -euo pipefail

# Case: ask minimal APIs — persist request/response events and update meta.json

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_WS_DIR="${TEST_WS_DIR:-"$ROOT_DIR/tests/units/works/unit-ws"}"
PORT="${PORT:-5175}"
TASK_ID="${TASK_ID:-DEMO}"

echo "[case:ask] start backend in test workspace"
bash "$ROOT_DIR/tests/cases/_helpers/start-backend-in-ws.sh"

# Ensure task exists
echo "[case:ask] create task $TASK_ID"
curl -sS -X POST "http://localhost:$PORT/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$TASK_ID\",\"name\":\"Demo\"}" > /dev/null || true

# Send ask request/answer
echo "[case:ask] send ask request"
curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"How are we progressing?"}' > /dev/null

echo "[case:ask] send ask answer"
curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/answer" \
  -H "Content-Type: application/json" \
  -d '{"answer":"We are on M3, tests green."}' > /dev/null

# Verify events and meta
DAY="$(date +%Y%m%d)"
EVENTS_PATH="$TEST_WS_DIR/.tasklogs/$TASK_ID/events-$DAY.jsonl"
META_PATH="$TEST_WS_DIR/.tasklogs/$TASK_ID/meta.json"

echo "[case:ask] verify events file exists: $EVENTS_PATH"
test -f "$EVENTS_PATH"

REQ_COUNT="$(grep -c '"type":"agent.ask.request"' "$EVENTS_PATH" || true)"
RESP_COUNT="$(grep -c '"type":"agent.ask.response"' "$EVENTS_PATH" || true)"
if [ "$REQ_COUNT" -lt 1 ] || [ "$RESP_COUNT" -lt 1 ]; then
  echo "[case:ask][fail] missing ask events (request=$REQ_COUNT, response=$RESP_COUNT)"
  exit 1
fi

echo "[case:ask] verify meta.json contains ask counts"
test -f "$META_PATH"
REQ_IN_META="$(grep -c '"agent.ask.request"' "$META_PATH" || true)"
RESP_IN_META="$(grep -c '"agent.ask.response"' "$META_PATH" || true)"
if [ "$REQ_IN_META" -lt 1 ] || [ "$RESP_IN_META" -lt 1 ]; then
  echo "[case:ask][fail] meta.json missing ask counters"
  exit 1
fi

echo "[case:ask][ok] ask APIs persisted events and meta index updated"
