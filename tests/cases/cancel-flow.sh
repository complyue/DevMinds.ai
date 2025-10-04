#!/usr/bin/env bash
set -euo pipefail

# Case Test: cancel-flow
# 验证取消流程事件序列：
# - 触发 run（或 prompt）
# - 在出现至少一片 agent.run.delta 后发送 cancel
# - 断言事件包含 agent.run.cancel.requested 和 agent.run.cancelled
# - 断言状态在完成后回退为 follow/idle

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-cancel-$(date +%Y%m%d-%H%M%S).log"

echo "[case:cancel-flow] root=$ROOT_DIR port=$PORT task=$TASK_ID test_ws=$TEST_WS_DIR mock_dir=$MOCK_DIR"
echo "[case:cancel-flow] logs -> $LOG_FILE"

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

# 准备测试工作区配置
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

export DEVMINDS_MOCK_DIR="$MOCK_DIR"

start_backend() {
  (cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/server.ts" >"$LOG_FILE" 2>&1 & echo $! >"$LOG_FILE.pid") || { echo "[case][fail] failed to start backend"; exit 1; }
  BPID="$(cat "$LOG_FILE.pid" || true)"
  [[ -z "${BPID:-}" ]] && BPID=$!
  echo "[case:cancel-flow] backend pid=$BPID (cwd=$TEST_WS_DIR)"
  # 等待端口就绪
  for i in $(seq 1 80); do
    ensure_alive "$BPID"
    if curl -s "http://localhost:$PORT/api/tasks/$TASK_ID/status" >/dev/null 2>&1; then
      echo "[case:cancel-flow] backend ready"
      return 0
    fi
    sleep 0.5
  done
  echo "[case][fail] backend not ready on :$PORT after timeout"
  ensure_alive "$BPID"
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

# 触发运行（prompt）
PROMPT_JSON="$(curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/prompt" -H "Content-Type: application/json" -d '{"prompt":"测试取消流程"}' || true)"
echo "[case:cancel-flow] prompt_resp=$PROMPT_JSON"

# 等待至少一片 delta 出现（最长 5s）
FOUND_DELTA=0
for i in $(seq 1 20); do
  ensure_alive "$BPID"
  EVENTS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/events?limit=200" || true)"
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.delta"' && FOUND_DELTA=1 || true
  [[ "$FOUND_DELTA" -eq 1 ]] && break
  sleep 0.25
done
[[ "$FOUND_DELTA" -ne 1 ]] && { echo "[case][fail] no delta before cancel"; tail -n 200 "$LOG_FILE" || true; exit 1; }

# 发送取消
CANCEL_JSON="$(curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/cancel" || true)"
echo "[case:cancel-flow] cancel_resp=$CANCEL_JSON"

# 轮询事件，确认 cancel.requested 与 cancelled 都出现（最长 10s）
FOUND_REQ=0
FOUND_CANCELLED=0
for i in $(seq 1 40); do
  ensure_alive "$BPID"
  EVENTS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/events?limit=200" || true)"
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.cancel.requested"' && FOUND_REQ=1 || true
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.cancelled"' && FOUND_CANCELLED=1 || true
  if [[ "$FOUND_REQ" -eq 1 && "$FOUND_CANCELLED" -eq 1 ]]; then
    break
  fi
  sleep 0.25
done

[[ "$FOUND_REQ" -ne 1 ]] && { echo "[case][fail] missing agent.run.cancel.requested"; tail -n 200 "$LOG_FILE" || true; exit 1; }
[[ "$FOUND_CANCELLED" -ne 1 ]] && { echo "[case][fail] missing agent.run.cancelled"; tail -n 200 "$LOG_FILE" || true; exit 1; }

# 断言状态回退为 follow 或 idle（最长 5s）
STATE_OK=0
for i in $(seq 1 20); do
  ensure_alive "$BPID"
  STATUS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/status" || true)"
  echo "[case:cancel-flow] status=$STATUS_JSON"
  if echo "$STATUS_JSON" | grep -q '"state":"follow"'; then
    STATE_OK=1; break
  fi
  if echo "$STATUS_JSON" | grep -q '"state":"idle"'; then
    STATE_OK=1; break
  fi
  sleep 0.25
done
[[ "$STATE_OK" -ne 1 ]] && { echo "[case][fail] state did not fallback to follow/idle"; tail -n 200 "$LOG_FILE" || true; exit 1; }

echo "[case:cancel-flow][ok] verified: delta observed → cancel.requested → cancel.cancelled → state fallback"