#!/usr/bin/env bash
set -euo pipefail

# Case: events-index-flow
# 验证 .tasklogs/{taskId}/meta.json 增量索引更新（lastTs 与 counts）
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-index-$(date +%Y%m%d-%H%M%S).log"

echo "[case:index-flow] root=$ROOT_DIR port=$PORT task=$TASK_ID ws=$TEST_WS_DIR mock=$MOCK_DIR"
echo "[case:index-flow] logs -> $LOG_FILE"

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
    tail -n 200 "$LOG_FILE" || true
    exit 1
  fi
}

# 准备测试工作区
mkdir -p "$TEST_WS_DIR/.minds/tasks/$TASK_ID" "$TEST_WS_DIR/.minds/skills/coding"
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

# 启动后端（cwd=unit-ws）
( cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/server.ts" >"$LOG_FILE" 2>&1 & echo $! >"$LOG_FILE.pid" ) || { echo "[case][fail] failed to start backend"; exit 1; }
BPID="$(cat "$LOG_FILE.pid" || true)"
[[ -z "${BPID:-}" ]] && BPID=$!
echo "[case:index-flow] backend pid=$BPID (cwd=$TEST_WS_DIR)"
for i in $(seq 1 80); do
  ensure_alive "$BPID"
  if curl -s "http://localhost:$PORT/api/tasks/$TASK_ID/status" >/dev/null 2>&1; then
    echo "[case:index-flow] backend ready"
    break
  fi
  sleep 0.2
done

# 触发一次 prompt 运行
curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/prompt" -H "Content-Type: application/json" -d '{"prompt":"索引验证"}' >/dev/null || true

# 轮询直到出现 agent.run.output 与 agent.run.finished（最长 10s）
FOUND_OUT=0
FOUND_FIN=0
for i in $(seq 1 40); do
  ensure_alive "$BPID"
  EVENTS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/events?limit=500" || true)"
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.output"' && FOUND_OUT=1 || true
  echo "$EVENTS_JSON" | grep -q '"type":"agent.run.finished"' && FOUND_FIN=1 || true
  if [[ "$FOUND_OUT" -eq 1 && "$FOUND_FIN" -eq 1 ]]; then
    break
  fi
  sleep 0.25
done
[[ "$FOUND_OUT" -ne 1 ]] && { echo "[case][fail] missing agent.run.output"; tail -n 200 "$LOG_FILE" || true; kill "$BPID" 2>/dev/null || true; exit 1; }
[[ "$FOUND_FIN" -ne 1 ]] && { echo "[case][fail] missing agent.run.finished"; tail -n 200 "$LOG_FILE" || true; kill "$BPID" 2>/dev/null || true; exit 1; }

# 检查 meta.json
META_PATH="$TEST_WS_DIR/.tasklogs/$TASK_ID/meta.json"
test -f "$META_PATH" || { echo "[case][fail] meta.json not found at $META_PATH"; kill "$BPID" 2>/dev/null || true; exit 1; }

# 字段断言：lastTs 存在；counts 至少包含 started / delta / output / finished（不依赖 jq）
LAST_TS="$(grep -o '"lastTs":[^,]*' "$META_PATH" | head -n1)"
[[ -n "$LAST_TS" ]] || { echo "[case][fail] lastTs missing in meta.json"; cat "$META_PATH"; kill "$BPID" 2>/dev/null || true; exit 1; }

grep -q '"agent.run.started"' "$META_PATH"   || { echo "[case][fail] counts.agent.run.started missing";   cat "$META_PATH"; kill "$BPID" 2>/dev/null || true; exit 1; }
grep -q '"agent.run.delta"' "$META_PATH"     || { echo "[case][fail] counts.agent.run.delta missing";     cat "$META_PATH"; kill "$BPID" 2>/dev/null || true; exit 1; }
grep -q '"agent.run.output"' "$META_PATH"    || { echo "[case][fail] counts.agent.run.output missing";    cat "$META_PATH"; kill "$BPID" 2>/dev/null || true; exit 1; }
grep -q '"agent.run.finished"' "$META_PATH"  || { echo "[case][fail] counts.agent.run.finished missing";  cat "$META_PATH"; kill "$BPID" 2>/dev/null || true; exit 1; }

echo "[case:index-flow][ok] meta.json updated with lastTs and counts for started/delta/output/finished"

# 清理
kill "$BPID" 2>/dev/null || true
