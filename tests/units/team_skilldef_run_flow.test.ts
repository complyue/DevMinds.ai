import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerProvider } from '../../packages/backend/src/providers/registry';
import { promises as fs } from 'fs';
import path from 'path';

const BASE = 'http://localhost:5175';
const TASK = 'DEMO_TEAM_SKILLDEF';

const repoRoot = process.cwd();
const minds = (...p: string[]) => path.join(repoRoot, '.minds', ...p);
const tasklogs = (...p: string[]) => path.join(repoRoot, '.tasklogs', ...p);

type StatusResp = { ok: boolean; status?: { state: 'idle'|'follow'|'run' } };
type EventsResp = { ok: boolean; items?: Array<{ type: string; ts: string; taskId: string; payload?: any }> };

async function httpJson(pathname: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`Non-JSON: ${t}`); }
}

async function poll<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 12000, intervalMs = 200): Promise<T> {
  const start = Date.now();
  let last: any;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Poll timeout. Last: ${JSON.stringify(last)}`);
}

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }).catch(() => {}); }

beforeAll(async () => {
  // Register mock provider handler for tests
  registerProvider('mock', async ({ provider, model, prompt }) => {
    return `mock:${model}:${(prompt || '').slice(0, 20)}`;
  });

  // Prepare .minds/tasks/{TASK}/team.md with YAML frontmatter
  const teamMd = `---
defaultMember: alice
members:
  - id: alice
    skill: coding
  - id: bob
    skill: review
---\nTeam definition`;
  await ensureDir(minds('tasks', TASK));
  await fs.writeFile(minds('tasks', TASK, 'team.md'), teamMd, 'utf8');
  await fs.writeFile(minds('tasks', TASK, 'wip.md'), 'Summarize current task context.', 'utf8');

  // Prepare .minds/skills/coding/def.md with provider config
  const defMd = `---
providerId: mock
model: test-model
---\nSkill definition`;
  await ensureDir(minds('skills', 'coding'));
  await fs.writeFile(minds('skills', 'coding', 'def.md'), defMd, 'utf8');

  // Ensure tasklogs dir exists
  await ensureDir(tasklogs(TASK));


});

afterAll(async () => {
  // cleanup
  try { await fs.rm(minds('tasks', TASK), { recursive: true, force: true }); } catch {}
  try { await fs.rm(minds('skills', 'coding'), { recursive: true, force: true }); } catch {}
  try { await fs.rm(tasklogs(TASK), { recursive: true, force: true }); } catch {}
});

describe('run flow uses team.md and skills/{skill}/def.md', () => {
  it('produces agent.run.* events with member/skill/providerId/model/content', async () => {
    // trigger run
    const runRes = await httpJson(`/api/tasks/${TASK}/run`, { method: 'POST' });
    expect(runRes.ok).toBe(true);

    // wait until finished (state not run)
    await poll<StatusResp>(() => httpJson(`/api/tasks/${TASK}/status`), (s) => s?.ok === true && s.status?.state !== 'run');

    // poll recent events until agent.run.output appears
    const evWithOut = await poll<EventsResp>(
      () => httpJson(`/api/tasks/${TASK}/events?limit=200`) as Promise<EventsResp>,
      (r) => {
        const items = r.items ?? [];
        return items.some(e => e.type === 'agent.run.output' && e.taskId === TASK);
      },
      10000,
      200
    );
    expect(evWithOut.ok).toBe(true);
    const out = (evWithOut.items ?? []).reverse().find(e => e.type === 'agent.run.output' && e.taskId === TASK);
    expect(out).toBeTruthy();
    expect(out?.payload).toBeTruthy();
    // payload fields
    expect(out?.payload.member).toBe('alice');
    expect(out?.payload.skill).toBe('coding');
    expect(out?.payload.providerId).toBe('mock');
    expect(out?.payload.model).toBe('test-model');
    expect(typeof out?.payload.content).toBe('string');
    expect((out?.payload.content || '').length).toBeGreaterThan(0);
  }, 30000);
});
