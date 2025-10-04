#!/usr/bin/env bash
set -euo pipefail

# Case Test: delta-flow
# 验证流式片段：
# - 触发 prompt 运行
# - 断言至少一条 agent.run.delta
# - 累积所有 delta 的 payload.delta 字符串，和最终 agent.run.output 的 payload.content 一致

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-5175}"
TASK_ID="${TASK_ID:-DEMO}"
TEST_WS_DIR="${TEST_WS_DIR:-$ROOT_DIR/tests/units/works/unit-ws}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
LOG_DIR="$ROOT_DIR/tests/cases/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-delta-$(date +%Y%m%d-%H%M%S).log"

echo "[case:delta-flow] root=$ROOT_DIR port=$PORT task=$TASK_ID test_ws=$TEST_WS_DIR mock_dir=$MOCK_DIR"
echo "[case:delta-flow] logs -> $LOG_FILE"

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

# 准备测试工作区
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

# 清理上一轮残留事件，避免历史 delta 混入当前校验
# 仅清理测试工作区下的 .tasklogs/{TASK_ID}，不触碰业务包路径
rm -rf "$TEST_WS_DIR/.tasklogs/$TASK_ID" || true

start_backend() {
  (cd "$TEST_WS_DIR" && nohup $TSX_RUN "$ROOT_DIR/packages/backend/src/server.ts" >"$LOG_FILE" 2>&1 & echo $! >"$LOG_FILE.pid") || { echo "[case][fail] failed to start backend"; exit 1; }
  BPID="$(cat "$LOG_FILE.pid" || true)"
  [[ -z "${BPID:-}" ]] && BPID=$!
  echo "[case:delta-flow] backend pid=$BPID (cwd=$TEST_WS_DIR)"
  # 等待端口就绪
  for i in $(seq 1 80); do
    ensure_alive "$BPID"
    if curl -s "http://localhost:$PORT/api/tasks/$TASK_ID/status" >/dev/null 2>&1; then
      echo "[case:delta-flow] backend ready"
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
PROMPT_JSON="$(curl -sS -X POST "http://localhost:$PORT/api/tasks/$TASK_ID/prompt" -H "Content-Type: application/json" -d '{"prompt":"测试流式片段一致性"}' || true)"
echo "[case:delta-flow] prompt_resp=$PROMPT_JSON"

# 轮询收集事件，直到 output 出现或超时（最长 10s）
DELTA_COUNT=0
DELTA_JOINED=""
OUTPUT_CONTENT=""
PREV_COUNT=0
for i in $(seq 1 40); do
  ensure_alive "$BPID"
  EVENTS_JSON="$(curl -sS "http://localhost:$PORT/api/tasks/$TASK_ID/events?limit=500" || true)"
  # 提取所有 delta 片段（简易 JSON 解析基于 grep + sed）
  # 注意：payload.delta 为无换行字符串（后端按固定片长切片）
  DELTAS_ALL="$(echo "$EVENTS_JSON" | grep -o '"type":"agent.run.delta"[^}]*"delta":"[^"]*"' | sed -E 's/.*"delta":"([^"]*)".*/\1/')"
  CURRENT_COUNT="$(echo "$DELTAS_ALL" | grep -c . || true)"
  if [[ "${CURRENT_COUNT:-0}" -gt "${PREV_COUNT:-0}" ]]; then
    NEW_N="$((CURRENT_COUNT - PREV_COUNT))"
    # 仅追加本轮新增的尾部片段，避免重复累计
    DELTAS_NEW="$(echo "$DELTAS_ALL" | tail -n "$NEW_N")"
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      DELTA_JOINED+="$line"
      DELTA_COUNT=$((DELTA_COUNT + 1))
    done <<< "$DELTAS_NEW"
    PREV_COUNT="$CURRENT_COUNT"
  fi
  # 检测最终输出
  OUTPUT_MATCH="$(echo "$EVENTS_JSON" | grep -o '"type":"agent.run.output"[^}]*"content":"[^"]*"' | tail -n1 || true)"
  if [[ -n "$OUTPUT_MATCH" ]]; then
    OUTPUT_CONTENT="$(echo "$OUTPUT_MATCH" | sed -E 's/.*"content":"([^"]*)".*/\1/')"
    break
  fi
  sleep 0.25
done

[[ "$DELTA_COUNT" -lt 1 ]] && { echo "[case][fail] no agent.run.delta observed"; tail -n 200 "$LOG_FILE" || true; exit 1; }
[[ -z "$OUTPUT_CONTENT" ]] && { echo "[case][fail] missing agent.run.output content"; tail -n 200 "$LOG_FILE" || true; exit 1; }

# 校验拼接一致性
if [[ "$DELTA_JOINED" == "$OUTPUT_CONTENT" ]]; then
  echo "[case:delta-flow][ok] delta fragments (${DELTA_COUNT}) match final output (${#OUTPUT_CONTENT} bytes)"
else
  echo "[case][fail] delta joined != output content"
  echo "delta_len=${#DELTA_JOINED} output_len=${#OUTPUT_CONTENT}"
  # 打印差异的前后片段，便于定位
  echo "delta_head: ${DELTA_JOINED:0:160}"
  echo "output_head: ${OUTPUT_CONTENT:0:160}"
  tail -n 200 "$LOG_FILE" || true
  exit 1
fi
