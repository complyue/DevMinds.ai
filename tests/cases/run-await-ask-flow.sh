#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5175}"
CWD="tests/units/works/unit-ws"
TASK="DEMO_ASK_RUN"

echo "[case:run-await-ask] start backend in test workspace"
bash tests/cases/_helpers/stop-backend.sh >/dev/null 2>&1 || true
START_LOG="[start-backend-in-ws] Starting backend at port ${PORT} with cwd=${CWD}"
bash tests/cases/_helpers/start-backend-in-ws.sh &
sleep 1
for i in {1..50}; do
  if nc -z localhost "${PORT}" &>/dev/null; then break; fi
  sleep 0.2
done
echo "[case:run-await-ask] backend started"

echo "[case:run-await-ask] create task ${TASK}"
curl -s -X POST "http://localhost:${PORT}/api/tasks" -H "Content-Type: application/json" -d "{\"id\":\"${TASK}\"}" >/dev/null

echo "[case:run-await-ask] trigger run with awaitAsk"
curl -s -X POST "http://localhost:${PORT}/api/tasks/${TASK}/run?awaitAsk=1" >/dev/null

LOG_DIR="${CWD}/.tasklogs/${TASK}"
mkdir -p "${LOG_DIR}"

# find latest events-*.jsonl by filename sort
latest_events_file() {
  ls -1 "${LOG_DIR}"/events-*.jsonl 2>/dev/null | sort | tail -n1 || true
}

echo "[case:run-await-ask] wait for events file"
EVF=""
for i in {1..50}; do
  EVF="$(latest_events_file)"
  [[ -n "${EVF}" ]] && [[ -f "${EVF}" ]] && break
  sleep 0.2
done
if [[ -z "${EVF}" ]] || [[ ! -f "${EVF}" ]]; then
  echo "[fail] events file not found in ${LOG_DIR}"
  exit 2
fi
echo "[case:run-await-ask] using ${EVF}"

echo "[case:run-await-ask] wait for agent.ask.request and extract questionId"
QID=""
for i in {1..120}; do
  QID="$(grep '\"agent.ask.request\"' "${EVF}" | sed -E -n 's/.*\"questionId\":\"([^\"]+)\".*/\1/p' | tail -n1 || true)"
  [[ -n "${QID}" ]] && break
  sleep 0.25
done
if [[ -z "${QID}" ]]; then
  echo "[fail] no agent.ask.request or questionId not found"
  tail -n 100 "${EVF}" || true
  exit 2
fi
echo "[case:run-await-ask] questionId=${QID}"

echo "[case:run-await-ask] send ask.response via WS"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PAYLOAD='{"kind":"append","event":{"ts":"'"${TS}"'","taskId":"'"${TASK}"'","type":"agent.ask.response","payload":{"answer":"OK by human","questionId":"'"${QID}"'"}}}'
node tests/cases/_helpers/ws-send-control.js "ws://localhost:${PORT}/ws/${TASK}" "${PAYLOAD}"
SEND_RC=$?
if [[ ${SEND_RC} -ne 0 ]]; then
  echo "[fail] ws-send-control failed rc=${SEND_RC}"
  exit 2
fi

echo "[case:run-await-ask] wait for agent.run.output"
for i in {1..120}; do
  if grep -q '\"agent.run.output\"' "${EVF}"; then
    break
  fi
  sleep 0.25
done
if ! grep -q '\"agent.run.output\"' "${EVF}"; then
  echo "[fail] no agent.run.output"
  tail -n 100 "${EVF}" || true
  exit 2
fi

# Validate the output includes our human answer
if ! grep -q 'OK by human' "${EVF}"; then
  echo "[fail] output missing human answer"
  tail -n 100 "${EVF}" || true
  exit 2
fi

echo "[case:run-await-ask][ok] output received and includes human answer"
