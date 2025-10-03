#!/usr/bin/env bash
set -euo pipefail

# DevMinds.ai unit test runner
# - Starts backend in background
# - Waits until HTTP becomes available
# - Runs Vitest unit tests
# - Cleans up backend process on exit
#
# Usage:
#   bash scripts/run-unit-tests.sh
#
# Future runners:
#   scripts/run-case-test.sh    # for scenario/case tests
#   scripts/run-story-tests.sh  # for story/long-run tests
#
# Env overrides:
#   PORT=5175 LOG=/tmp/devminds_backend.log PIDFILE=/tmp/devminds_backend.pid

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5175}"
LOG="${LOG:-/tmp/devminds_backend.log}"
PIDFILE="${PIDFILE:-/tmp/devminds_backend.pid}"
MOCK_DIR="${MOCK_DIR:-$ROOT_DIR/tests/units/works/mock-io}"
export DEVMINDS_MOCK_DIR="$MOCK_DIR"
TEST_WS="$ROOT_DIR/tests/units/works/unit-ws"
mkdir -p "$TEST_WS"
rm -rf "$TEST_WS/.minds" "$TEST_WS/.tasklogs" || true

cleanup() {
  if [[ -f "$PIDFILE" ]]; then
    PID="$(cat "$PIDFILE" || echo "")"
    if [[ -n "$PID" ]]; then
      kill "$PID" 2>/dev/null || true
    fi
    rm -f "$PIDFILE" || true
  fi
}
trap cleanup EXIT

# Kill any existing process listening on $PORT to avoid EADDRINUSE
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PIDS="$(lsof -ti tcp:${PORT} || true)"
  if [[ -n "${EXISTING_PIDS}" ]]; then
    echo "[unit-runner] Killing existing backend on port ${PORT}: ${EXISTING_PIDS}"
    kill ${EXISTING_PIDS} 2>/dev/null || true
    sleep 0.5
  fi
fi

echo "[unit-runner] Starting backend (port=$PORT)..."
# Prepare mock IO dir for provider apiType=mock
mkdir -p "$MOCK_DIR"
# Preload expected output for team_skilldef test



# Prepare DEMO task team/skill for status_run_flow test to use mock provider
mkdir -p "$TEST_WS/.minds/tasks/DEMO" "$TEST_WS/.minds/skills/coding"
cat > "$TEST_WS/.minds/tasks/DEMO/team.md" <<'EOF'
---
defaultMember: alice
members:
  - id: alice
    skill: coding
---
EOF
cat > "$TEST_WS/.minds/skills/coding/def.md" <<'EOF'
---
providerId: mock
model: test-model
---

Provider: mock
Model: test-model

EOF

# Prepare DEMO_TEAM_SKILLDEF team.md to use coding skill (mapped to mock via def.md)
mkdir -p "$TEST_WS/.minds/tasks/DEMO_TEAM_SKILLDEF"
cat > "$TEST_WS/.minds/tasks/DEMO_TEAM_SKILLDEF/team.md" <<'EOF'
---
defaultMember: alice
members:
  - id: alice
    skill: coding
---
EOF

# Prepare task tree structure for tree_no_meta test
mkdir -p "$TEST_WS/.tasklogs/DEMO/subtasks/child-1"



# Mock engine output for DEMO

# Prepare DEMO_TREE_NO_META data for tree test (isolated in TMP_WS)
mkdir -p "$TEST_WS/.minds/tasks/DEMO_TREE_NO_META"
echo "# WIP" > "$TEST_WS/.minds/tasks/DEMO_TREE_NO_META/wip.md"
mkdir -p "$TEST_WS/.tasklogs/DEMO_TREE_NO_META"
touch "$TEST_WS/.tasklogs/DEMO_TREE_NO_META/events-$(date +%Y%m%d).jsonl"
mkdir -p "$TEST_WS/.tasklogs/DEMO_TREE_NO_META/subtasks/child-1"

# Start backend with mock env var (inline to guarantee inheritance)
( cd "$ROOT_DIR" && pnpm --filter @devminds/backend build )
( cd "$TEST_WS" && DEVMINDS_MOCK_DIR="$MOCK_DIR" PORT="$PORT" node "$ROOT_DIR/packages/backend/dist/server.js" ) > "$LOG" 2>&1 & echo $! > "$PIDFILE"

echo "[unit-runner] Waiting for backend to become ready..."
READY=0
for i in {1..50}; do
  if curl -sf "http://localhost:${PORT}/api/providers" > /dev/null; then
    READY=1
    break
  fi
  sleep 0.2
done

if [[ "$READY" -ne 1 ]]; then
  echo "[unit-runner] Backend failed to start. Last 100 lines of log:"
  tail -n 100 "$LOG" || true
  exit 1
fi
echo "[unit-runner] Backend is ready."

echo "[unit-runner] Running tests (Vitest)..."
( cd "$ROOT_DIR" && pnpm exec vitest --run --dir tests/units )

echo "[unit-runner] Tests finished."
