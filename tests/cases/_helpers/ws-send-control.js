// WebSocket event sender for case tests (append-only transport)
// Usage examples:
//   1) Append wrapper:
//      node tests/cases/_helpers/ws-send-control.js ws://localhost:5175/ws/mytask '{"kind":"append","event":{"ts":"...","taskId":"mytask","type":"agent.ask.request","payload":{"question":"hi","questionId":"q1"}}}'
//   2) Bare event (auto-wrapped):
//      node tests/cases/_helpers/ws-send-control.js ws://localhost:5175/ws/mytask '{"ts":"...","taskId":"mytask","type":"agent.ask.response","payload":{"answer":"ok","questionId":"q1"}}'
//   3) Legacy control (auto-converted to append; ts auto, taskId from URL path):
//      node tests/cases/_helpers/ws-send-control.js ws://localhost:5175/ws/mytask '{"kind":"control","type":"agent.ask.request","payload":{"question":"hi","questionId":"q1"}}'
//
// Exits 0 on successful send; prints minimal logs to stdout; exits non-zero on error.

const WebSocket = require('ws');
const urlMod = require('url');

function usage(code = 1) {
  console.error('Usage: node ws-send-control.js <ws-url> <json-string>');
  process.exit(code);
}

const url = process.argv[2];
const jsonStr = process.argv[3];
if (!url || !jsonStr) usage();

let input;
try {
  input = JSON.parse(jsonStr);
  if (!input || typeof input !== 'object') throw new Error('payload must be object');
} catch (e) {
  console.error('Invalid JSON payload:', e.message);
  usage();
}

// Normalize into { kind:'append', event:{...} }
function normalize(wsUrl, obj) {
  // Already append wrapper
  if (obj.kind === 'append' && obj.event && typeof obj.event === 'object') {
    return obj;
  }
  // Legacy control: build event using type/payload and derive taskId from URL
  if (obj.kind === 'control' && typeof obj.type === 'string') {
    const { pathname } = urlMod.parse(wsUrl);
    // Expect /ws/:taskId
    const parts = (pathname || '/').split('/').filter(Boolean);
    const taskId = parts[1] || parts[0] || '';
    if (!taskId) throw new Error('cannot derive taskId from ws-url');
    const ev = {
      ts: new Date().toISOString(),
      taskId,
      type: obj.type,
      payload: obj.payload ?? {},
    };
    return { kind: 'append', event: ev };
  }
  // Bare event object
  if (obj.ts && obj.taskId && obj.type && 'payload' in obj) {
    return { kind: 'append', event: obj };
  }
  throw new Error('unsupported input: provide append wrapper, bare event, or legacy control');
}

let msg;
try {
  msg = normalize(url, input);
} catch (e) {
  console.error(String(e.message || e));
  process.exit(2);
}

const ws = new WebSocket(url, { handshakeTimeout: 5000 });
const timeoutMs = 4000;
let timer;

function done(ok, err) {
  try { if (timer) clearTimeout(timer); } catch {}
  try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
  if (!ok) {
    if (err) console.error(String(err.message || err));
    process.exit(2);
  }
  process.exit(0);
}

ws.on('open', () => {
  try {
    ws.send(JSON.stringify(msg));
    // wait a brief moment to ensure server processes the message
    timer = setTimeout(() => done(true), 200);
  } catch (e) {
    done(false, e);
  }
});

ws.on('error', (e) => done(false, e));
// Optional: swallow incoming messages; we only ensure send succeeds
ws.on('message', () => {});
