import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'fs';
import path from 'path';

function nowTs() {
  return new Date().toISOString();
}

function appendJsonlLine(filePath: string, obj: any) {
  const line = JSON.stringify(obj);
  writeFileSync(filePath, line + '\n', { flag: 'a' });
}

function readMeta(metaPath: string): any {
  if (!existsSync(metaPath)) return { counts: {}, lastTs: '' };
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return { counts: {}, lastTs: '' };
  }
}

function atomicWriteJson(metaPath: string, data: any) {
  const dir = path.dirname(metaPath);
  const tmp = path.join(dir, `meta.tmp-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  // atomic replace
  renameSync(tmp, metaPath);
}

function incCount(meta: any, key: string) {
  if (!meta.counts) meta.counts = {};
  meta.counts[key] = (meta.counts[key] || 0) + 1;
}

async function main() {
  const cwd = process.cwd(); // expected to be tests/units/works/unit-ws
  const taskId = process.env.TASK_ID || 'DEMO';
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

  const logsDir = path.join(cwd, '.tasklogs', taskId);
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
  const eventsFile = path.join(logsDir, `events-${ymd}.jsonl`);
  const metaPath = path.join(logsDir, 'meta.json');

  // Emit request/response pair
  const reqTs = nowTs();
  appendJsonlLine(eventsFile, {
    type: 'agent.ask.request',
    ts: reqTs,
    taskId,
    payload: { question: 'Unit ask: what is 2+2?' },
  });

  const resTs = nowTs();
  appendJsonlLine(eventsFile, {
    type: 'agent.ask.response',
    ts: resTs,
    taskId,
    payload: { answer: '4' },
  });

  // Update meta incrementally
  const meta = readMeta(metaPath);
  incCount(meta, 'agent.ask.request');
  incCount(meta, 'agent.ask.response');
  meta.lastTs = resTs;
  atomicWriteJson(metaPath, meta);

  console.log('[unit][ok] ask runner emitted request/response and updated meta');
}

main().catch((err) => {
  console.error('[unit][fail]', err);
  process.exit(1);
});
