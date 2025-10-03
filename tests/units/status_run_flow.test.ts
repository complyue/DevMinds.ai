import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:5175';
const TASK = 'DEMO';

type StatusResp = { ok: boolean; status?: { state: 'idle'|'follow'|'run'; clients?: number; running?: boolean } };
type EventsResp = { ok: boolean; items?: Array<{ type: string; ts: string; taskId: string }>; warnings?: any[] };

async function httpJson(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for ${path}: ${text}`);
  }
}

async function poll<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 10000, intervalMs = 200): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Poll timeout. Last value: ${JSON.stringify(last)}`);
}

describe('status → run → status(flow) → events', () => {
  it('should transition to run then back to follow/idle and produce agent.run.* events', async () => {
    // 1) status(before)
    const s1 = (await httpJson(`/api/tasks/${TASK}/status`)) as StatusResp;
    expect(s1.ok).toBe(true);
    expect(s1.status).toBeTruthy();

    // 2) trigger run
    const runRes = await httpJson(`/api/tasks/${TASK}/run`, { method: 'POST' });
    expect(runRes.ok).toBe(true);

    // 3) status(running)
    const sRun = await poll<StatusResp>(
      () => httpJson(`/api/tasks/${TASK}/status`),
      (s) => s?.ok === true && s.status?.state === 'run',
      8000,
      200
    );
    expect(sRun.status?.state).toBe('run');

    // 4) status(after) -> back to follow or idle
    const sAfter = await poll<StatusResp>(
      () => httpJson(`/api/tasks/${TASK}/status`),
      (s) => s?.ok === true && s.status?.state !== 'run',
      12000,
      300
    );
    expect(['idle', 'follow']).toContain(sAfter.status?.state);

    // 5) events contain agent.run.* (take last 20 just in case)
    const ev = (await httpJson(`/api/tasks/${TASK}/events?limit=20`)) as EventsResp;
    expect(ev.ok).toBe(true);
    const items = ev.items ?? [];
    // find presence of at least one agent.run.* type
    const hasRunEvent = items.some((e) => /^agent\.run\./.test(e.type));
    expect(hasRunEvent).toBe(true);
  }, 30000);
});
