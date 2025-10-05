import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, rmSync } from 'fs';
import path from 'path';

describe('M3: task templates initialization', () => {
  const taskId = 'TDD-M3-UNIT-001';
  const wsRoot = path.join(process.cwd(), 'tests/units/works/unit-ws');
  const base = path.join(wsRoot, '.minds/tasks', taskId);

  beforeAll(async () => {
    // Clean previous artifacts to ensure fresh run
    const tasksDir = path.join(wsRoot, '.minds/tasks', taskId);
    const logsDir = path.join(wsRoot, '.tasklogs', taskId);
    try { rmSync(tasksDir, { recursive: true, force: true }); } catch {}
    try { rmSync(logsDir, { recursive: true, force: true }); } catch {}

    await fetch('http://localhost:5175/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, name: 'Unit 001' }),
    }).catch(() => {});
  });

  it('should create wip/plan/caveats from templates (to be implemented)', () => {
    // TDD: initially expect missing; backend/tool will create later
    const wip = path.join(base, 'wip.md');
    const plan = path.join(base, 'plan.md');
    const caveats = path.join(base, 'caveats.md');

    // Define expected minimal template markers (to verify later)
    const expectedMarkers = ['# WIP', '# Plan', '# Caveats'];

    const anyExists = [wip, plan, caveats].some(p => existsSync(p));
    expect(anyExists).toBe(true);

    if (existsSync(wip)) {
      const wipContent = readFileSync(wip, 'utf-8');
      expect(wipContent).toMatch(/# WIP/);
    }
    if (existsSync(plan)) {
      const planContent = readFileSync(plan, 'utf-8');
      expect(planContent).toMatch(/# Plan/);
    }
    if (existsSync(caveats)) {
      const caveatsContent = readFileSync(caveats, 'utf-8');
      expect(caveatsContent).toMatch(/# Caveats/);
    }
  });
});
