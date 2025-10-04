#!/usr/bin/env bash
set -euo pipefail

# Case E2E: 工具触发与取消
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
WEB_PORT="${WEB_PORT:-5173}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
BE_LOG="$LOG_DIR/backend-toolcancel-$(date +%Y%m%d-%H%M%S).log"
FE_LOG="$LOG_DIR/webapp-toolcancel-$(date +%Y%m%d-%H%M%S).log"

echo "[e2e:tool-cancel] root=$ROOT_DIR port=$PORT web_port=$WEB_PORT task=$TASK_ID ws=$TEST_WS_DIR mock=$MOCK_DIR"
echo "[e2e:tool-cancel] logs -> backend=$BE_LOG webapp=$FE_LOG"

if command -v pnpm >/dev/null 2>&1; then
  TSX_RUN="pnpm dlx tsx"
  WEB_DEV_RUN="pnpm --filter @devminds/webapp dev"
else
  TSX_RUN="npx -y tsx"
  WEB_DEV_RUN="npm --prefix packages/webapp run dev"
fi

ensure_alive() { local pid="$1"; kill -0 "$pid" 2>/dev/null || { echo "[e2e][fail] process exited unexpectedly (pid=$pid)"; exit 1; }; }
ensure_port_free() { local port="$1"; local pids; pids="$(lsof -ti tcp:$port || true)"; [[ -n "${pids:-}" ]] && { echo "[e2e] freeing port :$port (pids=$pids)"; for pid in $pids; do kill "$pid" 2>/dev/null || true; done; sleep 1; }; }

# 准备工作区
mkdir -p "$TEST_WS_DIR/.minds/tasks/$TASK_ID" "$TEST_WS_DIR/.minds/skills/coding"
cat > "$TEST_WS_DIR/.minds/tasks/$TASK_ID/team.md" <<'EOF'
---
defaultMember: alice
members:
  - id: alice
    skill: coding
---
EOF
cat > "$TEST_WS_DIR/.minds/skills/coding/def.md" <<'EOF'
---
providerId: mock
model: long
---
EOF
export DEVMINDS_MOCK_DIR="$MOCK_DIR"

start_backend() {
  ensure_port_free "$PORT"
  (cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/server.ts" >"$BE_LOG" 2>&1 & echo $! >"$BE_LOG.pid") || { echo "[e2e][fail] failed to start backend"; exit 1; }
  BPID="$(cat "$BE_LOG.pid" || true)"; [[ -z "${BPID:-}" ]] && BPID=$!
  echo "[e2e] backend pid=$BPID (cwd=$TEST_WS_DIR)"
  for i in $(seq 1 80); do
    ensure_alive "$BPID"
    curl -s "http://localhost:$PORT/api/tasks/$TASK_ID/status" >/dev/null 2>&1 && { echo "[e2e] backend ready"; return 0; }
    sleep 0.5
  done
  echo "[e2e][fail] backend not ready on :$PORT"; exit 1
}
start_frontend() {
  ensure_port_free "$WEB_PORT"
  (nohup bash -lc "cd \"$ROOT_DIR\" && $WEB_DEV_RUN" >"$FE_LOG" 2>&1 & echo $! >"$FE_LOG.pid") || { echo "[e2e][fail] failed to start webapp"; exit 1; }
  FPID="$(cat "$FE_LOG.pid" || true)"; [[ -z "${FPID:-}" ]] && FPID=$!
  echo "[e2e] webapp pid=$FPID"
  for i in $(seq 1 80); do
    ensure_alive "$FPID"
    curl -s "http://localhost:$WEB_PORT" >/dev/null 2>&1 && { echo "[e2e] webapp ready"; return 0; }
    sleep 0.5
  done
  echo "[e2e][fail] webapp not ready on :$WEB_PORT"; exit 1
}
cleanup() { [[ -n "${BPID:-}" ]] && kill "$BPID" 2>/dev/null || true; [[ -n "${FPID:-}" ]] && kill "$FPID" 2>/dev/null || true; }
trap cleanup EXIT

start_backend
start_frontend
ensure_alive "$BPID"; ensure_alive "$FPID"

# 运行 Playwright 用例
( cd "$ROOT_DIR" && env TASK_ID="$TASK_ID" WEB_BASE="http://localhost:$WEB_PORT" npx -y playwright test tests/e2e/tool-cancel.spec.ts ) & PW_PID=$!
wait "$PW_PID"

echo "[e2e:tool-cancel][ok] 工具触发与取消端到端验证通过"
