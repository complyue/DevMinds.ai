#!/usr/bin/env bash
# TDD case: M3 task lifecycle (create/rename/delete) + event persistence
# Rules: run under tests workspace cwd; do NOT touch packages/*/.minds
# Expected backend APIs (to be implemented):
#   POST   /api/tasks         body: { "id": "TASK1", "name": "Task 1" }
#   PATCH  /api/tasks/TASK1   body: { "name": "Task 1 Renamed" }
#   DELETE /api/tasks/TASK1
# File effects (under tests workspace only):
#   .minds/tasks/TASK1/{wip.md,plan.md,caveats.md} created from templates
#   .tasklogs/TASK1/ exists; events-YYYYMMDD.jsonl receives system events
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5175}"
TASK_ID="TDD-M3-CASE-001"
DATE=$(date +"%Y%m%d")
WS_ROOT="tests/units/works/unit-ws"

echo "[M3:TDD] create task"
curl -sS -X POST "${BASE_URL}/api/tasks" -H "Content-Type: application/json" \
  -d "{\"id\":\"${TASK_ID}\",\"name\":\"M3 Case Task\"}"

# Verify files under unit workspace (backend cwd = unit-ws)
# We only assert existence to start; content verified by units.
test -f "${WS_ROOT}/.minds/tasks/${TASK_ID}/wip.md" || { echo "missing wip.md"; exit 1; }
test -f "${WS_ROOT}/.minds/tasks/${TASK_ID}/plan.md" || { echo "missing plan.md"; exit 1; }
test -f "${WS_ROOT}/.minds/tasks/${TASK_ID}/caveats.md" || { echo "missing caveats.md"; exit 1; }
test -d "${WS_ROOT}/.tasklogs/${TASK_ID}" || { echo "missing .tasklogs/${TASK_ID}"; exit 1; }

echo "[M3:TDD] rename task"
curl -sS -X PATCH "${BASE_URL}/api/tasks/${TASK_ID}" -H "Content-Type: application/json" \
  -d "{\"name\":\"M3 Case Task Renamed\"}"

echo "[M3:TDD] check events persisted"
# Expect at least one system event line added for create/rename
EVENT_FILE="${WS_ROOT}/.tasklogs/${TASK_ID}/events-${DATE}.jsonl"
test -f "${EVENT_FILE}" || { echo "missing ${EVENT_FILE}"; exit 1; }
LINES=$(wc -l < "${EVENT_FILE}" || echo 0)
if [ "${LINES}" -lt 1 ]; then
  echo "events file has no lines after lifecycle ops"
  exit 1
fi

echo "[M3:TDD] delete task"
curl -sS -X DELETE "${BASE_URL}/api/tasks/${TASK_ID}"

# After delete: templates removed, logs archived or removed by policy (TBD)
# For initial TDD, we assert templates gone, logs dir remains with events.
test ! -e "${WS_ROOT}/.minds/tasks/${TASK_ID}" || { echo "templates not removed"; exit 1; }
test -d "${WS_ROOT}/.tasklogs/${TASK_ID}" || { echo "logs dir unexpectedly removed"; exit 1; }

echo "[M3:TDD] task_lifecycle.sh OK (will fail until backend implements APIs and workspace.fs)"
