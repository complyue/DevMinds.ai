#!/usr/bin/env bash
set -euo pipefail

echo "[case:ask-await] start backend in test workspace"
tests/cases/_helpers/start-backend-in-ws.sh

TASK_ID="DEMO_ASK"
BASE_URL="http://localhost:5175"

echo "[case:ask-await] create task $TASK_ID"
curl -sS -X POST "$BASE_URL/api/tasks" -H "Content-Type: application/json" -d "{\"id\":\"$TASK_ID\",\"name\":\"Ask Await Demo\"}" >/dev/null

echo "[case:ask-await] trigger run-ask"
curl -sS -X POST "$BASE_URL/api/tasks/$TASK_ID/run-ask" >/dev/null

LOG_DIR="tests/units/works/unit-ws/.tasklogs/$TASK_ID"

# Wait for events file to appear
echo "[case:ask-await] wait for events file"
for i in {1..40}; do
  LATEST=$(ls -1t "$LOG_DIR"/events-*.jsonl 2>/dev/null | head -n1 || true)
  if [[ -n "${LATEST:-}" ]]; then break; fi
  sleep 0.2
done
if [[ -z "${LATEST:-}" ]]; then
  echo "[case:ask-await][fail] no events file found"
  exit 2
fi
echo "[case:ask-await] using $LATEST"

# Wait for ask.request and extract questionId
echo "[case:ask-await] wait for agent.ask.request and extract questionId"
QID=""
for i in {1..60}; do
  if grep -q '"type":"agent.ask.request"' "$LATEST"; then
    QID=$(node -e "const fs=require('fs');const f=process.argv[1];const lines=fs.readFileSync(f,'utf8').trim().split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));const last=lines.filter(x=>x.type==='agent.ask.request').slice(-1)[0];console.log(last?.payload?.questionId||'');" "$LATEST")
    if [[ -n "$QID" ]]; then break; fi
  fi
  sleep 0.2
done
if [[ -z "$QID" ]]; then
  echo "[case:ask-await][fail] questionId not found in ask.request"
  exit 3
fi
echo "[case:ask-await] questionId=$QID"

# Send ask.response via WS helper (legacy control auto-converted to append)
echo "[case:ask-await] send ask.response"
node tests/cases/_helpers/ws-send-control.js "ws://localhost:5175/ws/$TASK_ID" "$(printf '{"kind":"control","type":"agent.ask.response","payload":{"answer":"ok from test","questionId":"%s"}}' "$QID")"

# Wait for agent.run.output containing 'answer received'
echo "[case:ask-await] wait for agent.run.output"
for i in {1..60}; do
  if grep -q '"type":"agent.run.output"' "$LATEST"; then
    if grep -q 'answer received' "$LATEST"; then
      echo "[case:ask-await][ok] output received"
      exit 0
    fi
  fi
  sleep 0.2
done

echo "[case:ask-await][fail] agent.run.output not found or missing expected content"
exit 4
