import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, statSync, rmSync } from 'fs';
import path from 'path';

describe('M3: task creation/deletion file effects', () => {
  const taskId = 'TDD-M3-UNIT-002';
  const wsRoot = path.join(process.cwd(), 'tests/units/works/unit-ws');
  const logsDir = path.join(wsRoot, '.tasklogs', taskId);

  beforeAll(async () => {
    // Clean previous artifacts to ensure fresh run
    const tasksDir = path.join(wsRoot, '.minds/tasks', taskId);
    const logsDir = path.join(wsRoot, '.tasklogs', taskId);
    try { rmSync(tasksDir, { recursive: true, force: true }); } catch {}
    try { rmSync(logsDir, { recursive: true, force: true }); } catch {}

    await fetch('http://localhost:5175/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, name: 'Unit 002' }),
    }).catch(() => {});
  });

  it('should create .tasklogs/{taskId} and events file on create (to be implemented)', () => {
    // Initially failing: directory may not exist until backend implements
    expect(existsSync(logsDir)).toBe(true);

    const today = new Date();
    const yyyy = today.getFullYear().toString();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const eventsFile = path.join(logsDir, `events-${yyyy}${mm}${dd}.jsonl`);

    expect(existsSync(eventsFile)).toBe(true);
    if (existsSync(eventsFile)) {
      const st = statSync(eventsFile);
      // Should be non-empty after lifecycle events
      expect(st.size).toBeGreaterThan(0);
    }
  });

  it('should remove templates on delete but retain logs dir (policy TBD)', async () => {
    // Delete via API
    await fetch(`http://localhost:5175/api/tasks/${taskId}`, { method: 'DELETE' }).catch(() => {});
    // For policy: templates removed, logs retained
    const templatesDir = path.join(wsRoot, '.minds/tasks', taskId);
    expect(existsSync(templatesDir)).toBe(false);
    // Logs retained
    expect(existsSync(logsDir)).toBe(true);
  });
});
