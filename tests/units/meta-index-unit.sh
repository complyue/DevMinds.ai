#!/usr/bin/env bash
set -euo pipefail

# Unit: meta-index atomic increment and lastTs monotonic update
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-unit-index-$(date +%Y%m%d-%H%M%S).log"

if command -v pnpm >/dev/null 2>&1; then
  TSX_RUN="pnpm dlx tsx"
else
  TSX_RUN="npx -y tsx"
fi

# Prepare workspace
mkdir -p "$TEST_WS_DIR/.minds/tasks/$TASK_ID" "$TEST_WS_DIR/.minds/skills/coding" "$TEST_WS_DIR/.tasklogs/$TASK_ID"
TEAM_MD="$TEST_WS_DIR/.minds/tasks/$TASK_ID/team.md"
SKILL_MD="$TEST_WS_DIR/.minds/skills/coding/def.md"
[[ -f "$TEAM_MD" ]] || cat > "$TEAM_MD" <<'EOF'
---
defaultMember: alice
members:
  - id: alice
    skill: coding
---
EOF
[[ -f "$SKILL_MD" ]] || cat > "$SKILL_MD" <<'EOF'
---
providerId: mock
model: test-model
---
EOF
export DEVMINDS_MOCK_DIR="$MOCK_DIR"

# Start backend in unit workspace
( cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/server.ts" >"$LOG_FILE" 2>&1 & echo $! >"$LOG_FILE.pid" ) || { echo "[unit][fail] failed to start backend"; exit 1; }
BPID="$(cat "$LOG_FILE.pid" || true)"
[[ -z "${BPID:-}" ]] && BPID=$!
for i in $(seq 1 80); do
  if curl -s "http://localhost:$PORT/api/tasks/$TASK_ID/status" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

# Snapshot initial started count
META_PATH="$TEST_WS_DIR/.tasklogs/$TASK_ID/meta.json"
# Read initial started count (do not create/override file)
if [ -f "$META_PATH" ]; then
  COUNT_STARTED_0="$(node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));const v=(j.counts&&j.counts["agent.run.started"])||0;console.log(v);' "$META_PATH")"
else
  COUNT_STARTED_0=0
fi

# Trigger two runs
curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/prompt" -H "Content-Type: application/json" -d '{"prompt":"unit meta 1"}' >/dev/null || true
sleep 0.4
curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/prompt" -H "Content-Type: application/json" -d '{"prompt":"unit meta 2"}' >/dev/null || true

# Wait until finished shows up
for i in $(seq 1 80); do
  EVENTS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/events?limit=500" || true)"
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.finished"' && break || true
  sleep 0.2
done

# Read meta and assert delta >= 2
test -f "$META_PATH" || { echo "[unit][fail] meta.json missing"; kill "$BPID" || true; exit 1; }
LAST_TS_1="$(node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));console.log(j.lastTs||"");' "$META_PATH")"
COUNT_STARTED_1="$(node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));const v=(j.counts&&j.counts["agent.run.started"])||0;console.log(v);' "$META_PATH")"
COUNT_FINISHED_1="$(node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));const v=(j.counts&&j.counts["agent.run.finished"])||0;console.log(v);' "$META_PATH")"

DELTA_STARTED="$(( COUNT_STARTED_1 - COUNT_STARTED_0 ))"
[[ "$DELTA_STARTED" -ge 2 ]] || { echo "[unit][fail] started count delta not >= 2 (before=$COUNT_STARTED_0 after=$COUNT_STARTED_1)"; cat "$META_PATH"; kill "$BPID" || true; exit 1; }
[[ "$COUNT_FINISHED_1" -ge 1 ]] || { echo "[unit][fail] finished count not >= 1"; cat "$META_PATH"; kill "$BPID" || true; exit 1; }

# Trigger one more run to confirm monotonic lastTs and counts increment
curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/prompt" -H "Content-Type: application/json" -d '{"prompt":"unit meta 3"}' >/dev/null || true
for i in $(seq 1 80); do
  EVENTS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/events?limit=500" || true)"
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.finished"' && break || true
  sleep 0.2
done

LAST_TS_2="$(node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));console.log(j.lastTs||"");' "$META_PATH")"
COUNT_STARTED_2="$(node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));const v=(j.counts&&j.counts["agent.run.started"])||0;console.log(v);' "$META_PATH")"

[[ "$LAST_TS_1" != "$LAST_TS_2" ]] || { echo "[unit][fail] lastTs not updated"; cat "$META_PATH"; kill "$BPID" || true; exit 1; }
[[ "$COUNT_STARTED_2" -gt "$COUNT_STARTED_1" ]] || { echo "[unit][fail] started count not increased (prev=$COUNT_STARTED_1 now=$COUNT_STARTED_2)"; cat "$META_PATH"; kill "$BPID" || true; exit 1; }

echo "[unit][ok] meta.json atomic increment and lastTs updated monotonically"
kill "$BPID" 2>/dev/null || true
