import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const BASE = 'http://localhost:5175';
const TASK = 'DEMO_TREE_NO_META';

const repoRoot = process.cwd();
const minds = (...p: string[]) => path.join(repoRoot, '.minds', ...p);
const tasklogs = (...p: string[]) => path.join(repoRoot, '.tasklogs', ...p);

async function httpJson(pathname: string) {
  const r = await fetch(`${BASE}${pathname}`);
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`Non-JSON: ${t}`); }
}

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }).catch(() => {}); }

beforeAll(async () => {
  // Prepare minimal structure without meta.json
  await ensureDir(minds('tasks', TASK));
  await fs.writeFile(minds('tasks', TASK, 'wip.md'), '# WIP\n', 'utf8');
  await ensureDir(tasklogs(TASK));
  // intentionally NOT creating meta.json
  await fs.writeFile(tasklogs(TASK, `events-${new Date().toISOString().slice(0,10).replace(/-/g,'')}.jsonl`), '', 'utf8');
  // one child subtask directory without meta.json
  await ensureDir(tasklogs(TASK, 'subtasks', 'child-1'));
});

afterAll(async () => {
  // cleanup
  try { await fs.rm(minds('tasks', TASK), { recursive: true, force: true }); } catch {}
  try { await fs.rm(tasklogs(TASK), { recursive: true, force: true }); } catch {}
});

describe('/api/tasks/:id/tree without meta.json', () => {
  it('returns only hierarchy (id, children) without meta', async () => {
    const resp = await httpJson(`/api/tasks/${TASK}/tree`);
    expect(resp.ok).toBe(true);
    expect(resp.root).toBeTruthy();
    expect(resp.root.id).toBe(TASK);
    expect(Array.isArray(resp.root.children)).toBe(true);
    // should list child-1 and no meta field
    const hasChild1 = resp.root.children.some((c: any) => c.id === 'child-1');
    expect(hasChild1).toBe(true);
    // no meta in root or children
    expect(resp.root.meta).toBeUndefined();
    if (resp.root.children.length) {
      expect(resp.root.children[0].meta).toBeUndefined();
    }
  });
});
