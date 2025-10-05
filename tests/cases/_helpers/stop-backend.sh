#!/usr/bin/env bash
# Stop backend server for tests; ensure port is freed even if PID file is absent.
set -euo pipefail

UNIT_WS="tests/units/works/unit-ws"
PID_FILE="${UNIT_WS}/.backend.pid"
PORT="${PORT:-5175}"

# Try PID-based stop (unit workspace)
if [ -f "${PID_FILE}" ]; then
  PID="$(cat "${PID_FILE}")"
  if kill -0 "${PID}" >/dev/null 2>&1; then
    echo "[stop-backend] Stopping backend (PID=${PID})"
    kill "${PID}" || true
    sleep 0.5
    if kill -0 "${PID}" >/dev/null 2>&1; then
      echo "[stop-backend] Force killing backend (PID=${PID})"
      kill -9 "${PID}" || true
    fi
  else
    echo "[stop-backend] Process ${PID} not running"
  fi
  rm -f "${PID_FILE}"
else
  echo "[stop-backend] No PID file at ${PID_FILE}. Will free port :${PORT} directly."
fi

# Port-based kill to handle case scripts that start backend independently
ATTEMPTS=0
MAX_ATTEMPTS=15
while lsof -t -i :"${PORT}" -Pn >/dev/null 2>&1; do
  PIDS="$(lsof -t -i :"${PORT}" -Pn || true)"
  if [ -n "${PIDS}" ]; then
    echo "[stop-backend] Killing listeners on port ${PORT} (pids=${PIDS})"
    kill ${PIDS} 2>/dev/null || true
    sleep 0.4
    # Force kill if still alive
    PIDS2="$(lsof -t -i :"${PORT}" -Pn || true)"
    if [ -n "${PIDS2}" ]; then
      kill -9 ${PIDS2} 2>/dev/null || true
    fi
  fi
  ATTEMPTS=$((ATTEMPTS+1))
  if [ "${ATTEMPTS}" -ge "${MAX_ATTEMPTS}" ]; then
    echo "[stop-backend] Warning: port ${PORT} still occupied after ${MAX_ATTEMPTS} attempts"
    break
  fi
done

# Final check
if lsof -i :"${PORT}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
  echo "[stop-backend] Warning: port ${PORT} appears still busy; check case logs."
else
  echo "[stop-backend] Port ${PORT} is free."
fi

echo "[stop-backend] Done. Logs at ${UNIT_WS}/.backend.out"
