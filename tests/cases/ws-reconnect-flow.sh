#!/usr/bin/env bash
set -euo pipefail

# Case E2E: WS 重连与恢复能力
# - 后端以测试工作区为 cwd 启动
# - 前端 Vite dev 启动（默认 5173）
# - 触发 prompt 运行，确认出现 delta
# - 杀掉后端进程，等待 5s 后重启
# - 用 Playwright 观察前端：重连指示→恢复连接→最终完成提示

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
WEB_PORT="${WEB_PORT:-5173}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
BE_LOG="$LOG_DIR/backend-wsreconnect-$(date +%Y%m%d-%H%M%S).log"
FE_LOG="$LOG_DIR/webapp-wsreconnect-$(date +%Y%m%d-%H%M%S).log"

echo "[e2e:ws-reconnect] root=$ROOT_DIR port=$PORT web_port=$WEB_PORT task=$TASK_ID ws=$TEST_WS_DIR mock=$MOCK_DIR"
echo "[e2e:ws-reconnect] logs -> backend=$BE_LOG webapp=$FE_LOG"

command -v curl >/dev/null 2>&1 || { echo "[e2e][fail] curl not found"; exit 1; }
if command -v pnpm >/dev/null 2>&1; then
  TSX_RUN="pnpm dlx tsx"
  WEB_DEV_RUN="pnpm --filter @devminds/webapp dev"
else
  TSX_RUN="npx -y tsx"
  WEB_DEV_RUN="npm --prefix packages/webapp run dev"
fi

ensure_alive() {
  local pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "[e2e][fail] process exited unexpectedly (pid=$pid)"
    exit 1
  fi
}

# 释放占用端口，避免遗留进程冲突（macOS 下使用 lsof）
ensure_port_free() {
  local port="$1"
  local tries=0
  local max_tries=30
  # 杀占用进程
  local pids
  pids="$(lsof -ti tcp:$port || true)"
  if [[ -n "${pids:-}" ]]; then
    echo "[e2e] freeing port :$port (pids=$pids)"
    for pid in $pids; do
      kill "$pid" 2>/dev/null || true
    done
  fi
  # 等待端口真正释放（最多 ~15s）
  while [[ $tries -lt $max_tries ]]; do
    if [[ -z "$(lsof -ti tcp:$port || true)" ]]; then
      echo "[e2e] port :$port is free"
      break
    fi
    tries=$((tries+1))
    sleep 0.5
  done
  if [[ $tries -ge $max_tries ]]; then
    echo "[e2e][warn] port :$port still busy after wait, proceeding"
  fi
}

# 准备测试工作区 .minds 配置
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

start_backend() {
  # 预先释放后端端口并稍候
  ensure_port_free "$PORT"
  sleep 0.5
  (cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/server.ts" >"$BE_LOG" 2>&1 & echo $! >"$BE_LOG.pid") || { echo "[e2e][fail] failed to start backend"; exit 1; }
  BPID="$(cat "$BE_LOG.pid" || true)"
  [[ -z "${BPID:-}" ]] && BPID=$!
  echo "[e2e] backend pid=$BPID (cwd=$TEST_WS_DIR)"
  for i in $(seq 1 80); do
    ensure_alive "$BPID"
    if curl -s "http://localhost:$PORT/api/tasks/$TASK_ID/status" >/dev/null 2>&1; then
      echo "[e2e] backend ready"
      return 0
    fi
    sleep 0.5
  done
  echo "[e2e][fail] backend not ready on :$PORT"
  exit 1
}

start_frontend() {
  # 预先释放前端端口并稍候
  ensure_port_free "$WEB_PORT"
  sleep 0.5
  # 前端从产品包运行，不触及 .minds
  (nohup bash -lc "cd \"$ROOT_DIR\" && $WEB_DEV_RUN" >"$FE_LOG" 2>&1 & echo $! >"$FE_LOG.pid") || { echo "[e2e][fail] failed to start webapp"; exit 1; }
  FPID="$(cat "$FE_LOG.pid" || true)"
  [[ -z "${FPID:-}" ]] && FPID=$!
  echo "[e2e] webapp pid=$FPID"
  for i in $(seq 1 80); do
    ensure_alive "$FPID"
    if curl -s "http://localhost:$WEB_PORT" >/dev/null 2>&1; then
      echo "[e2e] webapp ready"
      return 0
    fi
    sleep 0.5
  done
  echo "[e2e][fail] webapp not ready on :$WEB_PORT"
  exit 1
}

cleanup() {
  [[ -n "${BPID:-}" ]] && kill "$BPID" 2>/dev/null || true
  [[ -n "${FPID:-}" ]] && kill "$FPID" 2>/dev/null || true
}
trap cleanup EXIT

start_backend
start_frontend
ensure_alive "$BPID"
ensure_alive "$FPID"

# 启动 Playwright 测试（浏览器观察，内部点击“推进”）
( cd "$ROOT_DIR" && env TASK_ID="$TASK_ID" WEB_BASE="http://localhost:$WEB_PORT" npx -y playwright test tests/e2e/ws-reconnect.spec.ts ) & PW_PID=$!

# 等待 8s 后杀后端，再 7s 后重启（保证前端已观察到进度/片段）
sleep 8
kill "$BPID" 2>/dev/null || true
echo "[e2e] backend killed (pid=$BPID)"
sleep 7
start_backend

# 等待 Playwright 完成
wait "$PW_PID"

echo "[e2e:ws-reconnect][ok] 前后端断续验证通过：重连与事件补齐、最终输出提示均可见"
