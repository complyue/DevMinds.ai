#!/usr/bin/env bash
set -euo pipefail

# Case Test: Backend prompt flow verification (tests workspace, monitored backend)
# - Starts backend server with cwd=tests/units/works/unit-ws
# - Sets DEVMINDS_MOCK_DIR to tests/units/works/mock-io
# - Monitors backend process and fails fast on unexpected exit
# - Validates status → prompt → events sequence with robust polling

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-$(date +%Y%m%d-%H%M%S).log"

echo "[case:prompt-flow] root=$ROOT_DIR port=$PORT task=$TASK_ID test_ws=$TEST_WS_DIR mock_dir=$MOCK_DIR"
echo "[case:prompt-flow] logs -> $LOG_FILE"

# Dependencies
command -v curl >/dev/null 2>&1 || { echo "[case][fail] curl not found"; exit 1; }
if command -v pnpm >/dev/null 2>&1; then
  TSX_RUN="pnpm dlx tsx"
else
  TSX_RUN="npx -y tsx"
fi

ensure_alive() {
  local pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "[case][fail] backend exited unexpectedly (pid=$pid)"
    echo "----- backend log (tail) -----"
    tail -n 200 "$LOG_FILE" || true
    echo "------------------------------"
    exit 1
  fi
}

# Prepare test workspace .minds config (idempotent)
mkdir -p "$TEST_WS_DIR/.minds/tasks/$TASK_ID" "$TEST_WS_DIR/.minds/skills/coding"
TEAM_MD="$TEST_WS_DIR/.minds/tasks/$TASK_ID/team.md"
SKILL_MD="$TEST_WS_DIR/.minds/skills/coding/def.md"
if [[ ! -f "$TEAM_MD" ]]; then
  cat > "$TEAM_MD" <<'EOF'
---
defaultMember: alice
members:
  - id: alice
    skill: coding
---
EOF
fi
if [[ ! -f "$SKILL_MD" ]]; then
  cat > "$SKILL_MD" <<'EOF'
---
providerId: mock
model: test-model
---
EOF
fi

# Start backend in background with cwd=test workspace, capture logs
export DEVMINDS_MOCK_DIR="$MOCK_DIR"
start_backend() {
  # Launch backend with nohup and record PID
  (cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/server.ts" >"$LOG_FILE" 2>&1 & echo $! >"$LOG_FILE.pid") || { echo "[case][fail] failed to start backend"; exit 1; }
  BPID="$(cat "$LOG_FILE.pid" || true)"
  if [[ -z "${BPID:-}" ]]; then
    echo "[case][warn] pid file missing, attempting fallback to background job pid"
    BPID=$!
  fi
  echo "[case:prompt-flow] backend pid=$BPID (cwd=$TEST_WS_DIR)"
  # Wait for port ready (max 40s), while monitoring process
  for i in $(seq 1 80); do
    ensure_alive "$BPID"
    if curl -s "http://localhost:$PORT/api/tasks/$TASK_ID/status" >/dev/null 2>&1; then
      echo "[case:prompt-flow] backend ready"
      return 0
    fi
    sleep 0.5
  done
  echo "[case][fail] backend not ready on :$PORT after timeout"
  ensure_alive "$BPID" # will print logs if dead
  tail -n 200 "$LOG_FILE" || true
  kill "$BPID" 2>/dev/null || true
  exit 1
}

cleanup() {
  if [[ -n "${BPID:-}" ]]; then
    kill "$BPID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

start_backend
ensure_alive "$BPID"

echo "[case:prompt-flow] check status"
STATUS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/status")"
echo "[case:prompt-flow] status=$STATUS_JSON"
ensure_alive "$BPID"

echo "[case:prompt-flow] trigger prompt run"
PROMPT_JSON="$(curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/prompt" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"请总结 DEMO 任务上下文"}')"
echo "[case:prompt-flow] prompt_resp=$PROMPT_JSON"
ensure_alive "$BPID"

# Poll recent events up to 10s, ensuring required sequence appears
echo "[case:prompt-flow] poll recent events"
FOUND_STARTED=0
FOUND_OUTPUT=0
FOUND_FINISHED=0
for i in $(seq 1 40); do
  ensure_alive "$BPID"
  EVENTS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/events?limit=200" || true)"
  if [[ -z "$EVENTS_JSON" ]]; then
    sleep 0.5
    continue
  fi
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.started"' && FOUND_STARTED=1 || true
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.output"' && FOUND_OUTPUT=1 || true
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.finished"' && FOUND_FINISHED=1 || true
  if [[ "$FOUND_STARTED" -eq 1 && "$FOUND_OUTPUT" -eq 1 && "$FOUND_FINISHED" -eq 1 ]]; then
    break
  fi
  sleep 0.5
done

if [[ "$FOUND_STARTED" -ne 1 ]]; then
  echo "[case][fail] missing agent.run.started"
  tail -n 200 "$LOG_FILE" || true
  exit 1
fi
if [[ "$FOUND_OUTPUT" -ne 1 ]]; then
  echo "[case][fail] missing agent.run.output"
  tail -n 200 "$LOG_FILE" || true
  exit 1
fi
if [[ "$FOUND_FINISHED" -ne 1 ]]; then
  echo "[case][fail] missing agent.run.finished"
  tail -n 200 "$LOG_FILE" || true
  exit 1
fi

# Optional payload check
echo "$EVENTS_JSON" | grep -q '"payload":{"member":' || { echo "[case][fail] missing output payload fields"; tail -n 200 "$LOG_FILE" || true; exit 1; }

echo "[case:prompt-flow][ok] sequence verified: started → output → finished"
