#!/usr/bin/env bash
# Start backend server with tests workspace as cwd to ensure .minds/.tasklogs isolation.
set -euo pipefail

# Paths relative to repo root
UNIT_WS="tests/units/works/unit-ws"
MOCK_IO="tests/units/works/mock-io"
BACKEND_DIST="packages/backend/dist/server.js"
PORT="${PORT:-5175}"

# Ensure required dirs
mkdir -p "${UNIT_WS}"
mkdir -p "${MOCK_IO}"
mkdir -p "${UNIT_WS}/.minds"
mkdir -p "${UNIT_WS}/.tasklogs"

# Check backend build exists
if [ ! -f "${BACKEND_DIST}" ]; then
  echo "[start-backend-in-ws] ${BACKEND_DIST} not found. Build backend first: (cd packages/backend && npm run build)"
  exit 1
fi

echo "[start-backend-in-ws] Starting backend at port ${PORT} with cwd=${UNIT_WS}"
echo "[start-backend-in-ws] DEVMINDS_MOCK_DIR -> ${MOCK_IO}"

# Pre-kill any existing listeners on ${PORT} to avoid stale processes
if lsof -t -i :"${PORT}" -Pn >/dev/null 2>&1; then
  echo "[start-backend-in-ws] Killing existing listeners on port ${PORT}"
  kill -9 $(lsof -t -i :"${PORT}" -Pn) || true
  sleep 0.5
fi

# Launch backend in background with proper env and cwd
(
  cd "${UNIT_WS}"
  DEVMINDS_MOCK_DIR="$(pwd)/../mock-io" PORT="${PORT}" node "../../../../${BACKEND_DIST}" > .backend.out 2>&1 &
  echo $! > .backend.pid
)

# Wait briefly and verify port is listening
sleep 1
if lsof -i :"${PORT}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
  echo "[start-backend-in-ws] Backend listening on http://localhost:${PORT}"
else
  echo "[start-backend-in-ws] Warning: backend may not be listening yet. Check ${UNIT_WS}/.backend.out"
fi
