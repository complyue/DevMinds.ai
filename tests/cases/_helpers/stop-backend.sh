#!/usr/bin/env bash
# Stop backend server started by start-backend-in-ws.sh
set -euo pipefail

UNIT_WS="tests/units/works/unit-ws"
PID_FILE="${UNIT_WS}/.backend.pid"

if [ ! -f "${PID_FILE}" ]; then
  echo "[stop-backend] No PID file at ${PID_FILE}. Is backend running?"
  exit 0
fi

PID="$(cat "${PID_FILE}")"
if kill -0 "${PID}" >/dev/null 2>&1; then
  echo "[stop-backend] Stopping backend (PID=${PID})"
  kill "${PID}" || true
  # Wait a moment, force kill if still alive
  sleep 0.5
  if kill -0 "${PID}" >/dev/null 2>&1; then
    echo "[stop-backend] Force killing backend (PID=${PID})"
    kill -9 "${PID}" || true
  fi
else
  echo "[stop-backend] Process ${PID} not running"
fi

rm -f "${PID_FILE}"
echo "[stop-backend] Done. Logs at ${UNIT_WS}/.backend.out"
